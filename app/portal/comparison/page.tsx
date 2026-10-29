"use client";
// cBioPortal's Comparison page for 2–20 cohorts, at most 6 compared at once, laid out as the portal lays it out. The cohorts
// arrive in an analysis document (?doc=, the lab's own link encoding); the page's views replace
// any the link carries unless they are this page's own (a link made on this page). A setting
// changed here travels as ?changes= beside the cohorts (page-doc.ts). As on the portal, a group can
// be taken out of every tab and put back (?off=), and the groups compared with or without the
// samples they share (?overlap=exclude, lib/partition-arms.ts's exclusiveCohorts).
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AnalysisDoc, View } from "../../../lib/types";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown, expressionProfile, assayComparisonProfiles, type StudyKnown } from "../study-known";
import { arrange, decodeDoc, decodeParam, encodeParam, syncUrl, usePageDoc, type PageLayout } from "../page-doc";
import { COMPARISON_MAX_ACTIVE, COMPARISON_MAX_GROUPS, exclusiveCohorts } from "../../../lib/partition-arms.ts";
import { Choice } from "../../_ui/choice.tsx";
import { PortalSummary, PortalLoading } from "../portal-chrome.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { fmtInt } from "../../../lib/chart/format.ts";

const CLINICAL_SHOWN = 8;

/** the page's tabs; before the study's profiles and attributes are known (`known` null), those that need neither */
function comparisonLayout(linked: AnalysisDoc, study: string, known: StudyKnown | null): PageLayout {
  const names = Object.keys(linked.cohorts || {});
  const expr = known && expressionProfile(known.profileCatalog);
  const assays = known ? assayComparisonProfiles(known.profileCatalog) : [];
  const clinical = known?.clinical || [];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const left = !known ? [] : [!clinical.length && "Clinical (no attributes)", !(expr && names.length === 2) && "mRNA (" + (expr ? "compares exactly two cohorts" : "no mRNA profile") + ")",
    !assays.length && "Generic Assays (no generic-assay profile)"].filter(Boolean) as string[];
  return arrange({ study, cohorts: linked.cohorts }, [
    { title: "Overlap", views: [v("Overlap", { kind: "overlap" })] },
    { title: "Survival", views: [v("Survival", { kind: "survival" })] },
    ...(clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: clinical.slice(0, CLINICAL_SHOWN) })] }] : []),
    { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation" }), v("Copy-number alterations", { kind: "enrichment", alteration: "cna" }),
      v("Structural variants", { kind: "enrichment", alteration: "sv" })] },
    ...(expr && names.length === 2 ? [{ title: "mRNA", views: [v("mRNA", { kind: "diffexpr", profileType: expr })] }] : []),
    ...assays.map((a) => ({ title: a.label, views: [v(a.label, { kind: "assays", profileType: a.profile })] })),
    { title: "Clinical Data", views: [v("Clinical data", { kind: "table" })] }
  ], left, { partial: !known });
}

export default function ComparisonPage() {
  const q = useSearchParams();
  const linked = useMemo(() => decodeDoc(q.get("doc")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const study = (linked?.study || "").replace(/[^A-Za-z0-9._-]/g, "");
  const names = Object.keys(linked?.cohorts || {});
  const { basics, known, error } = useStudyKnown(study);
  // a link without ?off= opens on its first groups, as many as the page compares at once
  const [off, setOff] = useState<string[]>(() => (decodeParam<string[]>(q.get("off")) || names.slice(COMPARISON_MAX_ACTIVE)).filter((n) => names.includes(n)));
  const sizeOk = names.length >= 2 && names.length <= COMPARISON_MAX_GROUPS && names.length - off.length <= COMPARISON_MAX_ACTIVE;
  const [exclude, setExclude] = useState(() => q.get("overlap") === "exclude");
  // the groups every tab compares: those not taken out, without their shared samples when asked
  const compared = useMemo(() => {
    const on = Object.fromEntries(Object.entries(linked?.cohorts || {}).filter(([n]) => !off.includes(n)));
    if (!exclude) return { cohorts: on, refused: null };
    try { return { cohorts: exclusiveCohorts(on), refused: null }; }
    catch (e) { return { cohorts: on, refused: (e as Error).message }; }
  }, [linked, off, exclude]);
  const fresh = useMemo(() => linked && basics && sizeOk ? comparisonLayout({ ...linked, cohorts: compared.cohorts }, study, known) : null,
    [linked, compared, basics, known, study, sizeOk]);
  const input = useMemo(() => linked && { dsl: linked.dsl, study: linked.study, cohorts: linked.cohorts }, [linked]);
  const page = usePageDoc(fresh, input);
  // sizes as the tabs report them, for the groups as they are compared now
  const comparedKey = JSON.stringify(compared.cohorts);
  const [sized, setSized] = useState<{ key: string; c: Record<string, number> } | null>(null);
  const counts = sized?.key === comparedKey ? sized.c : null;
  const toggle = (n: string) => {
    const next = off.includes(n) ? off.filter((x) => x !== n) : [...off, n];
    setOff(next);
    const usual = names.slice(COMPARISON_MAX_ACTIVE);
    syncUrl({ off: next.length === usual.length && next.every((x) => usual.includes(x)) ? null : encodeParam(next) });
  };
  const overlap = (v: string) => { setExclude(v === "exclude"); syncUrl({ overlap: v === "exclude" ? "exclude" : null }); };
  const shell = (body: React.ReactNode) => <><SiteHeader page="group comparison" /><main className="analysis-main">{body}</main></>;
  if (!linked || !study) return shell(<p className="note">This page compares the cohorts of an analysis document passed as <code>?doc=</code> (the lab&apos;s own link encoding); none was given.</p>);
  if (!sizeOk) return shell(<p className="note">a comparison page holds 2 to {COMPARISON_MAX_GROUPS} cohorts and compares at most {COMPARISON_MAX_ACTIVE} at once; this link has {names.length}{off.length ? ", " + (names.length - off.length) + " of them compared" : ""}</p>);
  if (error) return shell(<div className="error">{error}</div>);
  const ready = !!(page.layout && page.doc);
  return shell(<>
    <PortalSummary eyebrow="Group comparison" title={basics ? basics.name : study} study={study}
      detail={known && <span className="tabular-nums">{fmtInt(known.samples)} samples · {fmtInt(known.patients)} patients</span>}
      groups={names} counts={counts} left={fresh?.left || []} off={off} onToggleGroup={toggle} maxOn={COMPARISON_MAX_ACTIVE}
      action={<Choice value={exclude ? "exclude" : "include"} onChange={overlap} title="samples in more than one group" className="overlapchoice"
        options={[["include", "Overlapping samples: include"], ["exclude", "Overlapping samples: exclude"]]} />} />
    {page.note && <p className="note">{page.note}</p>}
    {compared.refused && <p className="note">Overlapping samples are still included: {compared.refused}.</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs doc={page.doc!} tabs={page.layout!.tabs} titles={page.layout!.titles} partial={page.layout!.partial} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known?.attrs || [], profiles: known?.profiles || [], profileCatalog: known?.profileCatalog || [], loading: !known }}
          onCounts={(c) => setSized((o) => o?.key === comparedKey ? o : { key: comparedKey, c })} />}
  </>);
}
