"use client";
// cBioPortal's Results page for a gene query, laid out as the portal lays it out: patients altered
// in any of the genes against the rest, one tab per portal tab. ?study=<id>&genes=KRAS,NRAS; the
// page's state — every setting changed on it — is one analysis document in ?doc= (page-doc.ts).
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CohortDef, View } from "../../../lib/types";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown, expressionProfile, type StudyKnown } from "../study-known";
import { arrange, decodeDoc, usePageDoc, type PageLayout } from "../page-doc";
import { ALTERATION_CELLS, cellLabel } from "../../../lib/lollipop";
import { Button } from "../../_ui/button";
import { Input } from "../../_ui/input";
import { FIELD } from "../../_ui/toolbar.ts";
import { cn } from "../../../lib/cn";

const CLINICAL_SHOWN = 8;

/**
 * The Mutations tab's lollipop grid and its table, kept in step as the portal keeps them: the grid's
 * hidden cells become the table's filter on its Alteration column (the cells still shown), and a
 * value filter set on that column from the table becomes the grid's selection. A condition filter
 * there ("contains …") is not a set of cells, so it leaves the grid alone.
 */
function linkMutations(vs: View[], changed: number): View[] {
  const [lp, tb] = vs as unknown as [{ hide?: string[] } & View, { filters?: Record<string, unknown> } & View];
  if (changed === 0) {
    const hide = lp.hide || [];
    const filters = { ...(tb.filters || {}) };
    if (hide.length) filters.alteration = { values: ALTERATION_CELLS.filter((c) => !hide.includes(c)).map(cellLabel) };
    else delete filters.alteration;
    return [lp, { ...tb, filters: Object.keys(filters).length ? filters : undefined } as View];
  }
  const f = (tb.filters || {}).alteration as { values?: string[] } | undefined;
  if (f && !Array.isArray(f.values)) return vs;
  const shown = f ? new Set(f.values) : null;
  const hide = shown ? ALTERATION_CELLS.filter((c) => !shown.has(cellLabel(c))) : [];
  return [{ ...lp, hide: hide.length ? hide : undefined } as View, tb];
}

/** The Results page as the portal has it, for this study and genes. */
function resultsLayout(study: string, genes: string[], known: StudyKnown): PageLayout {
  const cohorts: Record<string, CohortDef> = {
    Altered: { all: [{ any: genes.map((g) => ({ kind: "oql", q: g })) }] } as CohortDef,
    Unaltered: { all: genes.map((g) => ({ not: { kind: "oql", q: g } })) } as CohortDef,
  };
  const expr = expressionProfile(known.profiles);
  // the portal correlates over every queried sample, not one group
  if (expr) cohorts["All patients"] = { all: [] } as CohortDef;
  const both = ["Altered", "Unaltered"];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const left = [!expr && "Plots and Co-expression (no mRNA profile)", genes.length < 2 && "Mutual Exclusivity (one gene)"].filter(Boolean) as string[];
  return arrange({ study, cohorts }, [
    { title: "Oncoprint", views: [v("Oncoprint", { kind: "oncoprint", genes, cohorts: both })] },
    { title: "Cancer Types Summary", views: [v("Cancer types summary", { kind: "cancertypes", genes, cohorts: ["Altered"] })] },
    ...(genes.length >= 2 ? [{ title: "Mutual Exclusivity", views: [v("Mutual exclusivity", { kind: "cooccurrence", genes, cohorts: both })] }] : []),
    ...(expr ? [{ title: "Plots", views: [v(genes[0] + " copy number vs mRNA", { kind: "plot", x: { source: "alteration", gene: genes[0], by: "cna" }, y: { source: "molecular", profileType: expr, gene: genes[0] }, cohorts: both })] }] : []),
    // the portal's Mutations tab: one gene at a time, its lollipop over its mutation table
    { title: "Mutations", views: [v("Mutation diagram", { kind: "hotspots", genes: [genes[0]], cohorts: ["Altered"] }),
        v("Mutation table", { kind: "mutations", gene: genes[0], cohorts: ["Altered"] })],
      chooser: { label: "gene", options: genes, locks: ["gene", "genes"],
        value: (vs) => String(((vs[1] as unknown as { gene?: string }).gene) || genes[0]),
        // a new gene keeps the grid's selection (it is about classes, not this gene) and starts the table's own query over
        apply: (vs, g) => linkMutations([{ ...vs[0], genes: [g] } as View, { ...vs[1], gene: g, sort: undefined, search: undefined, filters: undefined } as View], 0) },
      link: linkMutations },
    ...(expr ? [{ title: "Co-expression", views: [v("Co-expression with " + genes[0], { kind: "correlates", gene: genes[0], profileType: expr, cohorts: ["All patients"] })] }] : []),
    { title: "Comparison/Survival", sub: [
      { title: "Overlap", views: [v("Overlap", { kind: "overlap", cohorts: both })] },
      { title: "Survival", views: [v("Survival", { kind: "survival", cohorts: both })] },
      ...(known.clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: known.clinical.slice(0, CLINICAL_SHOWN), cohorts: both })] }] : []),
      { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation", cohorts: both }),
        v("Copy-number alterations", { kind: "enrichment", alteration: "cna", cohorts: both })] }
    ] },
    { title: "CN Segments", views: [v("Genome-wide copy number", { kind: "genome", cohorts: both })] }
  ], left);
}

export default function ResultsPage() {
  const q = useSearchParams();
  const study = (q.get("study") || "").replace(/[^A-Za-z0-9._-]/g, "");
  const genesParam = q.get("genes") || "";
  const genes = useMemo(() => [...new Set(genesParam.split(/[\s,;]+/).map((g) => g.trim().toUpperCase()).filter((g) => /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)))], [genesParam]);
  const linked = useMemo(() => decodeDoc(q.get("doc")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const { known, error } = useStudyKnown(study);
  const fresh = useMemo(() => known && genes.length && genes.length <= 12 ? resultsLayout(study, genes, known) : null, [known, study, genes]);
  const page = usePageDoc(fresh, linked);
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
        <label className="tbfield">study <Input name="study" defaultValue={study} placeholder="msk_chord_2024" className={cn(FIELD, "w-48")} /></label>{" "}
        <label className="tbfield">genes <Input name="genes" defaultValue={genes.join(" ")} placeholder="KRAS NRAS BRAF" className={cn(FIELD, "w-48")} /></label>{" "}
        <Button size="sm" className="h-ctl px-3 text-md" type="submit">show</Button>
      </form>
    </main>);
  if (genes.length > 12) return <main className="portal-main">{head}<p className="note">a results page takes at most 12 genes, the oncoprint&apos;s rows; this asks for {genes.length}</p></main>;
  if (error) return <main className="portal-main">{head}<p className="note">{error}</p></main>;
  if (!fresh || !page.doc) return <main className="portal-main">{head}<div className="loading-block"><span className="spinner" /> loading {study}…</div></main>;
  return <main className="portal-main">{head}
    {page.note && <p className="note">{page.note}</p>}
    <PortalTabs doc={page.doc} tabs={fresh.tabs} titles={fresh.titles} left={fresh.left} open={page.open} onOpen={page.openTab} onDoc={page.update}
      catalog={{ attrs: known!.attrs, profiles: known!.profiles, loading: false }}
      onCounts={(c) => setCounts((o) => o || c)} />
  </main>;
}
