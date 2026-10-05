"use client";
// cBioPortal's Comparison page for 2–6 cohorts, laid out as the portal lays it out. The cohorts
// arrive in an analysis document (?doc=, the lab's own link encoding); the page's views replace
// any the link carries unless they are this page's own (a link made on this page), so every
// setting changed here travels in the same ?doc= (page-doc.ts).
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { AnalysisDoc, View } from "../../../lib/types";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown, expressionProfile, type StudyKnown } from "../study-known";
import { arrange, decodeDoc, usePageDoc, type PageLayout } from "../page-doc";

const CLINICAL_SHOWN = 8;

function comparisonLayout(linked: AnalysisDoc, study: string, known: StudyKnown): PageLayout {
  const names = Object.keys(linked.cohorts || {});
  const expr = expressionProfile(known.profiles);
  const ga = known.gaProfiles.find((p) => /signature/i.test(p) && /contribution/i.test(p)) || known.gaProfiles.find((p) => !/methylation/i.test(p)) || null;
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const left = [!known.clinical.length && "Clinical (no attributes)", !(expr && names.length === 2) && "mRNA (" + (expr ? "compares exactly two cohorts" : "no mRNA profile") + ")",
    !ga && "Generic Assays (no generic-assay profile)"].filter(Boolean) as string[];
  return arrange({ study, cohorts: linked.cohorts }, [
    { title: "Overlap", views: [v("Overlap", { kind: "overlap" })] },
    { title: "Survival", views: [v("Survival", { kind: "survival" })] },
    ...(known.clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: known.clinical.slice(0, CLINICAL_SHOWN) })] }] : []),
    { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation" }), v("Copy-number alterations", { kind: "enrichment", alteration: "cna" }),
      v("Structural variants", { kind: "enrichment", alteration: "sv" })] },
    ...(expr && names.length === 2 ? [{ title: "mRNA", views: [v("mRNA", { kind: "diffexpr", profileType: expr })] }] : []),
    ...(ga ? [{ title: "Generic Assays", views: [v(ga, { kind: "assays", profileType: ga })] }] : []),
    { title: "Clinical Data", views: [v("Clinical data", { kind: "table" })] }
  ], left);
}

export default function ComparisonPage() {
  const q = useSearchParams();
  const linked = useMemo(() => decodeDoc(q.get("doc")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const study = (linked?.study || "").replace(/[^A-Za-z0-9._-]/g, "");
  const names = Object.keys(linked?.cohorts || {});
  const { known, error } = useStudyKnown(study);
  const fresh = useMemo(() => linked && known && names.length >= 2 && names.length <= 6 ? comparisonLayout(linked, study, known) : null, [linked, known, study, names.length]);
  const page = usePageDoc(fresh, linked);
  const head = <header className="portal-head"><a href="/lab">cbio-lab</a> <span className="meta">· Group comparison</span>
    <div className="portal-summary"><div>
      <h1>{known ? known.name : study || "Comparison"}</h1>
      {known && <span>{names.length} groups: {names.join(", ")}</span>}
    </div></div></header>;
  if (!linked || !study) return <main className="portal-main">{head}<p className="note">This page compares the cohorts of an analysis document passed as <code>?doc=</code> (the lab&apos;s own link encoding); none was given.</p></main>;
  if (names.length < 2 || names.length > 6) return <main className="portal-main">{head}<p className="note">a comparison page compares 2 to 6 cohorts; this analysis has {names.length}</p></main>;
  if (error) return <main className="portal-main">{head}<p className="note">{error}</p></main>;
  if (!fresh || !page.doc) return <main className="portal-main">{head}<div className="loading-block"><span className="spinner" /> loading {study}…</div></main>;
  return <main className="portal-main">{head}
    {page.note && <p className="note">{page.note}</p>}
    <PortalTabs doc={page.doc} tabs={fresh.tabs} titles={fresh.titles} left={fresh.left} open={page.open} onOpen={page.openTab} onDoc={page.update}
      catalog={{ attrs: known!.attrs, profiles: known!.profiles, loading: false }} />
  </main>;
}
