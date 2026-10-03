"use client";
// cBioPortal's Results page for a gene query, laid out as the portal lays it out: patients altered
// in any of the genes against the rest, one tab per portal tab. ?study=<id>&genes=KRAS,NRAS
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CohortDef, View } from "../../../lib/types";
import { PortalTabs, type PortalTab } from "../PortalTabs";
import { useStudyKnown, expressionProfile } from "../study-known";

const CLINICAL_SHOWN = 8;

export default function ResultsPage() {
  const q = useSearchParams();
  const study = (q.get("study") || "").replace(/[^A-Za-z0-9._-]/g, "");
  const genes = [...new Set((q.get("genes") || "").split(/[\s,;]+/).map((g) => g.trim().toUpperCase()).filter((g) => /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)))];
  const { known, error } = useStudyKnown(study);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const altered = counts?.Altered;
  const head = <header className="portal-head"><a href="/lab">cbio-lab</a> <span className="meta">· Results</span>
    <div className="portal-summary">
      <div>
        <h1>{known ? known.name : study || "Results"}</h1>
        {known && <span>All samples ({known.samples.toLocaleString()} samples / {known.patients.toLocaleString()} patients) — {genes.join(", ")}</span>}
      </div>
      {known && altered != null && <strong>Queried genes are altered in {altered.toLocaleString()} ({Math.round(100 * altered / (known.patients || 1))}%) of queried patients</strong>}
    </div></header>;
  if (!study || !genes.length) return (
    <main className="portal-main">{head}
      <form className="card" method="get">
        <label className="tbfield">study <input name="study" defaultValue={study} placeholder="msk_chord_2024" /></label>{" "}
        <label className="tbfield">genes <input name="genes" defaultValue={genes.join(" ")} placeholder="KRAS NRAS BRAF" /></label>{" "}
        <button className="tbbtn" type="submit">show</button>
      </form>
    </main>);
  if (genes.length > 12) return <main className="portal-main">{head}<p className="note">a results page takes at most 12 genes, the oncoprint&apos;s rows; this asks for {genes.length}</p></main>;
  if (error) return <main className="portal-main">{head}<p className="note">{error}</p></main>;
  if (!known) return <main className="portal-main">{head}<div className="loading-block"><span className="spinner" /> loading {study}…</div></main>;

  const cohorts: Record<string, CohortDef> = {
    Altered: { all: [{ any: genes.map((g) => ({ kind: "oql", q: g })) }] } as CohortDef,
    Unaltered: { all: genes.map((g) => ({ not: { kind: "oql", q: g } })) } as CohortDef,
  };
  const expr = expressionProfile(known.profiles);
  // the portal correlates over every queried sample, not one group
  if (expr) cohorts["All patients"] = { all: [] } as CohortDef;
  const both = ["Altered", "Unaltered"];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const tabs: PortalTab[] = [
    { title: "Oncoprint", views: [v("Oncoprint", { kind: "oncoprint", genes, cohorts: both })] },
    { title: "Cancer Types Summary", views: [v("Cancer types summary", { kind: "cancertypes", genes, cohorts: ["Altered"] })] },
    ...(genes.length >= 2 ? [{ title: "Mutual Exclusivity", views: [v("Mutual exclusivity", { kind: "cooccurrence", genes, cohorts: both })] }] : []),
    ...(expr ? [{ title: "Plots", views: [v(genes[0] + " copy number vs mRNA", { kind: "plot", x: { source: "alteration", gene: genes[0], by: "cna" }, y: { source: "molecular", profileType: expr, gene: genes[0] }, cohorts: both })] }] : []),
    { title: "Mutations", views: [v("Mutations", { kind: "hotspots", genes: genes.slice(0, 6), cohorts: ["Altered"] })] },
    ...(expr ? [{ title: "Co-expression", views: [v("Co-expression with " + genes[0], { kind: "correlates", gene: genes[0], profileType: expr, cohorts: ["All patients"] })] }] : []),
    { title: "Comparison/Survival", sub: [
      { title: "Overlap", views: [v("Overlap", { kind: "overlap", cohorts: both })] },
      { title: "Survival", views: [v("Survival", { kind: "survival", cohorts: both })] },
      ...(known.clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: known.clinical.slice(0, CLINICAL_SHOWN), cohorts: both })] }] : []),
      { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation", cohorts: both }),
        v("Copy-number alterations", { kind: "enrichment", alteration: "cna", cohorts: both })] }
    ] },
    { title: "CN Segments", views: [v("Genome-wide copy number", { kind: "genome", cohorts: both })] }
  ];
  const left = [!expr && "Plots and Co-expression (no mRNA profile)", genes.length < 2 && "Mutual Exclusivity (one gene)"].filter(Boolean) as string[];
  return <main className="portal-main">{head}<PortalTabs study={study} cohorts={cohorts} tabs={tabs} left={left} onCounts={(c) => setCounts((o) => o || c)} /></main>;
}
