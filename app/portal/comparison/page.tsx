"use client";
// cBioPortal's Comparison page for 2–6 cohorts, laid out as the portal lays it out. The cohorts
// arrive in an analysis document (?doc=, the lab's own link encoding); the page's views replace
// any the link carries unless they are this page's own (a link made on this page). A setting
// changed here travels as ?changes= beside the cohorts (page-doc.ts).
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AnalysisDoc, View } from "../../../lib/types";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown, expressionProfile, assayComparisonProfiles, type StudyKnown } from "../study-known";
import { arrange, decodeDoc, usePageDoc, type PageLayout } from "../page-doc";
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
  const fresh = useMemo(() => linked && basics && names.length >= 2 && names.length <= 6 ? comparisonLayout(linked, study, known) : null, [linked, basics, known, study, names.length]);
  const input = useMemo(() => linked && { dsl: linked.dsl, study: linked.study, cohorts: linked.cohorts }, [linked]);
  const page = usePageDoc(fresh, input);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const shell = (body: React.ReactNode) => <><SiteHeader page="group comparison" /><main className="analysis-main">{body}</main></>;
  if (!linked || !study) return shell(<p className="note">This page compares the cohorts of an analysis document passed as <code>?doc=</code> (the lab&apos;s own link encoding); none was given.</p>);
  if (names.length < 2 || names.length > 6) return shell(<p className="note">a comparison page compares 2 to 6 cohorts; this analysis has {names.length}</p>);
  if (error) return shell(<div className="error">{error}</div>);
  const ready = !!(page.layout && page.doc);
  return shell(<>
    <PortalSummary eyebrow="Group comparison" title={basics ? basics.name : study} study={study}
      detail={known && <span className="tabular-nums">{fmtInt(known.samples)} samples · {fmtInt(known.patients)} patients</span>}
      groups={names} counts={counts} left={fresh?.left || []} />
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <PortalLoading />
      : <PortalTabs doc={page.doc!} tabs={page.layout!.tabs} titles={page.layout!.titles} partial={page.layout!.partial} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known?.attrs || [], profiles: known?.profiles || [], profileCatalog: known?.profileCatalog || [], loading: !known }}
          onCounts={(c) => setCounts((o) => o || c)} />}
  </>);
}
