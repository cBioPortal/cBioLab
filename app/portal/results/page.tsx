"use client";
// cBioPortal's Results page for a gene query, laid out as the portal lays it out: patients altered
// in any of the genes against the rest, one tab per portal tab. ?study=<id>&genes=KRAS,NRAS; the
// page's state — every setting changed on it — is one analysis document in ?doc= (page-doc.ts).
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CohortDef, View } from "../../../lib/types";
import { PortalTabs } from "../PortalTabs";
import { useStudyKnown, expressionProfile, discreteCnaProfile, type StudyKnown } from "../study-known";
import { arrange, decodeDoc, usePageDoc, type PageLayout } from "../page-doc";
import { ALTERATION_CELLS, cellLabel } from "../../../lib/lollipop";
import { Button } from "../../_ui/button";
import { TB } from "../../_ui/toolbar.ts";
import { Pencil } from "lucide-react";
import { fmtInt } from "../../../lib/chart/format.ts";
import { PortalHeader, PortalSummary } from "../portal-chrome.tsx";
import { QueryEditor, RESULTS_MAX_GENES } from "../query-editor.tsx";
import { checkGeneQuery } from "../../../lib/gene-query.ts";

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
function resultsLayout(study: string, entries: string[], genes: string[], known: StudyKnown): PageLayout {
  // the query decides the groups, entry by entry; the views draw its genes
  const cohorts: Record<string, CohortDef> = {
    Altered: { all: [{ any: entries.map((q) => ({ kind: "oql", q })) }] } as CohortDef,
    Unaltered: { all: entries.map((q) => ({ not: { kind: "oql", q } })) } as CohortDef,
  };
  const expr = expressionProfile(known.profileCatalog), cna = discreteCnaProfile(known.profileCatalog);
  // the portal plots and correlates over every queried sample, not one group
  if (expr) cohorts["All patients"] = { all: [] } as CohortDef;
  const both = ["Altered", "Unaltered"];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const left = [!expr && "Plots and Co-expression (no mRNA profile)", genes.length < 2 && "Mutual Exclusivity (one gene)"].filter(Boolean) as string[];
  return arrange({ study, cohorts }, [
    { title: "Oncoprint", views: [v("Oncoprint", { kind: "oncoprint", genes, cohorts: both })] },
    { title: "Cancer Types Summary", views: [v("Cancer types summary", { kind: "cancertypes", genes, cohorts: ["Altered"] })] },
    ...(genes.length >= 2 ? [{ title: "Mutual Exclusivity", views: [v("Mutual exclusivity", { kind: "cooccurrence", genes, cohorts: both })] }] : []),
    ...(expr ? [{ title: "Plots", views: [v("Plot", { kind: "plot", x: cna ? { source: "profile", profile: cna, gene: genes[0] } : { source: "alteration", gene: genes[0], by: "cna" },
      y: { source: "profile", profile: expr, gene: genes[0] }, cohorts: ["All patients"], points: [{ cohort: "Altered" }] })] }] : []),
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
  const queryText = q.get("genes") || "";
  const check = useMemo(() => checkGeneQuery(queryText, "oql"), [queryText]);
  const genes = check.genes;
  const queryError = check.error || check.entries.filter((e) => e.error).map((e) => e.text + ": " + e.error).join("; ") || null;
  const filtered = check.entries.some((e) => e.meaning !== "any alteration");
  const linked = useMemo(() => decodeDoc(q.get("doc")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const { known, error } = useStudyKnown(study);
  const fresh = useMemo(() => known && genes.length && genes.length <= RESULTS_MAX_GENES && !queryError ? resultsLayout(study, check.entries.map((e) => e.text), genes, known) : null, [known, study, check, genes, queryError]);
  const page = usePageDoc(fresh, linked);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [editing, setEditing] = useState(false);
  const queried = known?.patients || 0;
  const altered = counts?.Altered;
  const shell = (body: React.ReactNode) => <><PortalHeader page="query results" /><main className="analysis-main">{body}</main></>;
  if (!study || !genes.length) return shell(
    <section data-tw className="mb-4 rounded-lg border bg-card px-4.5 py-4">
      <div className="text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">Query</div>
      <p className="mt-1 mb-4 text-md text-muted-foreground">A study and up to {RESULTS_MAX_GENES} genes: the page shows the patients altered in any of them against the rest, tab by tab, as cBioPortal&apos;s Results page does.</p>
      <QueryEditor study={study} query={queryText} />
    </section>);
  if (queryError) return shell(<><div className="error">this query cannot be read — {queryError}</div><QueryEditor study={study} query={queryText} /></>);
  if (genes.length > RESULTS_MAX_GENES) return shell(<p className="note">a results page takes at most {RESULTS_MAX_GENES} genes, the oncoprint&apos;s rows; this asks for {genes.length}</p>);
  if (error) return shell(<div className="error">{error}</div>);
  const ready = !!(fresh && page.doc);
  return shell(<>
    <PortalSummary eyebrow="Query results" title={known ? known.name : study} study={study} genes={check.entries.map((e) => e.text)}
      detail={known && <span className="tabular-nums">{fmtInt(known.samples)} samples · {fmtInt(known.patients)} patients</span>}
      groups={Object.keys(fresh?.doc.cohorts || {})} counts={counts} left={fresh?.left || []}
      stat={altered != null && queried ? { value: altered, of: queried, label: "queried patients altered in " + (check.entries.length === 1 ? check.entries[0].text : "any of the " + check.entries.length + " query lines") } : null}
      action={<Button variant="outline" size="sm" className={TB} aria-expanded={editing} onClick={() => setEditing((e) => !e)}><Pencil />Modify query</Button>}>
      {filtered && <p className="mt-2.5 mb-0 text-sm text-muted-foreground">The query&apos;s OQL decides who is Altered; the oncoprint and the gene tabs draw every alteration of {genes.length === 1 ? "its gene" : "its genes"}.</p>}
      {editing && <QueryEditor study={study} query={queryText} className="mt-4 border-t pt-4" />}
    </PortalSummary>
    {page.note && <p className="note">{page.note}</p>}
    {!ready
      ? <><div className="skeleton mb-4 h-10" /><div className="card viewcard viewloading" aria-busy="true"><div className="skeleton skeleton-view" /></div></>
      : <PortalTabs doc={page.doc!} tabs={fresh!.tabs} titles={fresh!.titles} open={page.open} onOpen={page.openTab} onDoc={page.update}
          catalog={{ attrs: known!.attrs, profiles: known!.profiles, profileCatalog: known!.profileCatalog, loading: false }}
          onCounts={(c) => setCounts((o) => o || c)} />}
  </>);
}
