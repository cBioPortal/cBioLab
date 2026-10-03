"use client";
// cBioPortal's Comparison page for 2–6 cohorts, laid out as the portal lays it out. The cohorts
// arrive in an analysis document (?doc=, the lab's own link encoding); only its study and cohorts
// are read — its views are the lab's, not this page's.
import { useSearchParams } from "next/navigation";
import type { AnalysisDoc, View } from "../../../lib/types";
import { PortalTabs, type PortalTab } from "../PortalTabs";
import { useStudyKnown, expressionProfile } from "../study-known";

const CLINICAL_SHOWN = 8;

function decodeDoc(b64: string | null): AnalysisDoc | null {
  if (!b64) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); }
  catch { return null; }
}

export default function ComparisonPage() {
  const q = useSearchParams();
  const doc = decodeDoc(q.get("doc"));
  const study = (doc?.study || "").replace(/[^A-Za-z0-9._-]/g, "");
  const names = Object.keys(doc?.cohorts || {});
  const { known, error } = useStudyKnown(study);
  const head = <header className="portal-head"><a href="/lab">cbio-lab</a> <span className="meta">· Comparison page</span>
    <h1>{names.join(" vs ") || "Comparison"} {study && <span className="meta">in {study}</span>}</h1></header>;
  if (!doc || !study) return <main className="portal-main">{head}<p className="note">Open this page from an analysis in the lab (&ldquo;Comparison page&rdquo;), which hands it the cohorts.</p></main>;
  if (names.length < 2 || names.length > 6) return <main className="portal-main">{head}<p className="note">a comparison page compares 2 to 6 cohorts; this analysis has {names.length}</p></main>;
  if (error) return <main className="portal-main">{head}<p className="note">{error}</p></main>;
  if (!known) return <main className="portal-main">{head}<div className="loading-block"><span className="spinner" /> loading {study}…</div></main>;

  const expr = expressionProfile(known.profiles);
  const ga = known.gaProfiles.find((p) => /signature/i.test(p) && /contribution/i.test(p)) || known.gaProfiles.find((p) => !/methylation/i.test(p)) || null;
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const tabs: PortalTab[] = [
    { title: "Overlap", views: [v("Overlap", { kind: "overlap" })] },
    { title: "Survival", views: [v("Survival", { kind: "survival" })] },
    ...(known.clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: known.clinical.slice(0, CLINICAL_SHOWN) })] }] : []),
    { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation" }), v("Copy-number alterations", { kind: "enrichment", alteration: "cna" }),
      v("Structural variants", { kind: "enrichment", alteration: "sv" })] },
    ...(expr && names.length === 2 ? [{ title: "mRNA", views: [v("mRNA", { kind: "diffexpr", profileType: expr })] }] : []),
    ...(ga ? [{ title: "Generic Assays", views: [v(ga, { kind: "assays", profileType: ga })] }] : []),
    { title: "Clinical Data", views: [v("Clinical data", { kind: "table" })] }
  ];
  const left = [!known.clinical.length && "Clinical (no attributes)", !(expr && names.length === 2) && "mRNA (" + (expr ? "compares exactly two cohorts" : "no mRNA profile") + ")",
    !ga && "Generic Assays (no generic-assay profile)"].filter(Boolean) as string[];
  return <main className="portal-main">{head}<PortalTabs study={study} cohorts={doc.cohorts} tabs={tabs} left={left} /></main>;
}
