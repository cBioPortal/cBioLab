// The Results page's document, as cBioPortal lays the page out: what was queried (one study or
// several, narrowed by Explore's filters or not), one tab per portal tab, each drawing the queried
// patients; Comparison/Survival alone compares those the gene query alters with the profiled rest. Pure: the page builds it, and so
// can a script that checks the views run.
import type { Clause, CohortDef, View } from "../../lib/types.ts";
import { parseOql, OQL_PROFILE } from "../../lib/oql-parse.ts";
import { ALTERATION_CELLS, cellLabel } from "../../lib/lollipop.ts";
import { arrange, type PageLayout } from "./page-doc.ts";

const CLINICAL_SHOWN = 8;

/** What a Results page queries. */
export interface ResultsQuery {
  /** one study, or several pooled */
  studies: string[];
  /** Explore's filters, which every group keeps */
  filters: Clause[];
  /** the gene query, one OQL entry each */
  entries: string[];
  /** its genes, in order */
  genes: string[];
}

/** What the queried studies hold, as far as the page's tabs need it. */
export interface ResultsData {
  /** an mRNA profile the studies share, when they have one */
  expr: string | null;
  /** a discrete copy-number profile, the Plots tab's x axis beside expression */
  cna: string | null;
  /** clinical attributes, most covered first */
  clinical: string[];
  /** numeric clinical attributes, for a Plots tab without expression */
  numeric: string[];
  /** whether expression may be compared across these studies (crossStudyExpression in lib/results-settings.ts); true for one study */
  expressionAcross: boolean;
  /** the genomic data types every queried study holds, and those only some do */
  held: { every: ProfileType[]; some: ProfileType[] };
  /** one generic-assay profile per kind, each a sub-tab of Comparison/Survival (assayComparisonProfiles) */
  assays?: { label: string; profile: string }[];
  /**
   * only `held` is known yet: lay out the tabs that need nothing else (Plots, Co-expression and
   * Comparison's Clinical and assay sub-tabs follow once the profiles and attributes are known)
   */
  partial?: boolean;
}

type ProfileType = "MUTATION" | "CNA" | "SV";
const TYPE_WORD: Record<ProfileType, string> = { MUTATION: "mutation", CNA: "copy-number", SV: "structural-variant" };

/**
 * The page's cohorts, as cBioPortal has them. Queried: everyone the query covers (the studies, with
 * Explore's filters) — what every tab draws but Comparison/Survival. Altered: the query matches.
 * Unaltered: it does not, AND the patient was profiled for every entry's gene and data type — a
 * patient whose panel omits a queried gene is not known to be unaltered in it, so is in neither
 * (cBioPortal's "unaltered and profiled"; the page names the rest). The profiling is one clause per
 * data type naming every gene that needs it, so a long query stays within a cohort's clauses. A data
 * type counts only where every queried study holds it: brca_tcga has no structural variants, so a
 * bare gene there asks for mutation and copy-number profiling, and a type only some of the studies
 * hold is named rather than required (requiring it would drop every patient of the studies without it).
 */
export function resultsGroups(q: ResultsQuery, held: ResultsData["held"]): { cohorts: Record<string, CohortDef>; unchecked: string[] } {
  const scope = q.studies.length === 1 ? { study: q.studies[0] } : { studies: q.studies };
  const byType = new Map<ProfileType, string[]>(), unchecked: string[] = [];
  for (const entry of q.entries) {
    for (const e of parseOql(entry)) {
      for (const spec of e.specs) {
        const types = OQL_PROFILE[spec.type];
        if (!types) { unchecked.push(e.gene + ": " + spec.type); continue; }
        for (const type of types) {
          if (!held.every.includes(type)) continue;
          const genes = byType.get(type) || [];
          if (!genes.includes(e.gene)) byType.set(type, [...genes, e.gene]);
        }
      }
    }
  }
  const profiled = [...byType].map(([type, genes]) => ({ kind: "profiled", type, genes }) as Clause);
  // the query as one OQL clause — its ";" is "or" between entries (up to 30), where an `any` group
  // of one clause per line would stop at 8
  const query = { kind: "oql", q: q.entries.join("; ") };
  const def = (all: Clause[]) => ({ ...scope, all: [...q.filters, ...all] }) as CohortDef;
  return {
    // Altered and Unaltered first: the comparison's figures draw them in the first two series colours, and the page's swatches follow this order
    cohorts: {
      Altered: def([query as Clause]),
      Unaltered: def([{ not: query } as Clause, ...profiled]),
      Queried: def([]),
    },
    unchecked,
  };
}

/**
 * The Mutations tab's lollipop grid and its table, kept in step as the portal keeps them: the grid's
 * hidden cells become the table's filter on its Alteration column (the cells still shown), and a
 * value filter set on that column from the table becomes the grid's selection. A condition filter
 * there ("contains …") is not a set of cells, so it leaves the grid alone.
 */
export function linkMutations(vs: View[], changed: number): View[] {
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

/** The Results page as the portal has it, for this query. */
export function resultsLayout(q: ResultsQuery, data: ResultsData): PageLayout {
  const { genes } = q;
  const { cohorts, unchecked } = resultsGroups(q, data.held);
  const partly = data.held.some.filter((t) => q.entries.some((x) => parseOql(x).some((e) => e.specs.some((sp) => OQL_PROFILE[sp.type]?.includes(t)))));
  const multi = q.studies.length > 1;
  // as cBioPortal does: expression across studies only where its rule allows, and co-expression for one study only
  const expr = data.expr && (!multi || data.expressionAcross) ? data.expr : null;
  const plotY = data.partial ? null : expr ? { source: "profile", profile: expr, gene: genes[0] }
    : data.numeric.length ? { source: "clinical", attribute: data.numeric.find((a) => a === "FRACTION_GENOME_ALTERED" || a === "MUTATION_COUNT") || data.numeric[0] } : null;
  // every tab draws the queried patients, as cBioPortal's do; only Comparison/Survival compares groups
  const queried = ["Queried"], both = ["Altered", "Unaltered"];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const left = [
    // what the profiles decide is said once they are known
    ...(data.partial ? [] : [
      !data.expr ? (multi ? "Co-expression (no shared mRNA profile)" : "Co-expression (no mRNA profile)")
        : multi ? "Co-expression (one study at a time)" : null,
      data.expr && multi && !data.expressionAcross ? "expression in Plots (expression data cannot be compared across the selected studies)" : null,
      !plotY ? "Plots (no mRNA profile or numeric clinical attribute)" : null,
    ]),
    genes.length < 2 ? "Mutual Exclusivity (one gene)" : null,
    unchecked.length ? "Unaltered includes patients without data for " + unchecked.join(", ") + ", which cannot be checked for profiling" : null,
    partly.length ? "Unaltered is not checked for " + partly.map((t) => TYPE_WORD[t]).join(" or ") + " profiling, which only some of the selected studies hold" : null,
  ].filter(Boolean) as string[];
  return arrange({ study: q.studies[0], cohorts }, [
    { title: "Oncoprint", views: [v("Oncoprint", { kind: "oncoprint", genes, cohorts: queried })] },
    { title: "Cancer Types Summary", views: [v("Cancer types summary", { kind: "cancertypes", genes, cohorts: queried })] },
    ...(genes.length >= 2 ? [{ title: "Mutual Exclusivity", views: [v("Mutual exclusivity", { kind: "cooccurrence", genes, cohorts: queried })] }] : []),
    ...(plotY ? [{ title: "Plots", views: [v("Plot", { kind: "plot",
      x: expr ? (data.cna ? { source: "profile", profile: data.cna, gene: genes[0] } : { source: "alteration", gene: genes[0], by: "cna" }) : { source: "alteration", gene: genes[0], by: "mutationType" },
      y: plotY, cohorts: queried, points: [{ cohort: "Altered" }, { rule: "outliers" }] })] }] : []),
    // the portal's Mutations tab: one gene at a time, its lollipop over its mutation table
    { title: "Mutations", views: [v("Mutation diagram", { kind: "hotspots", genes: [genes[0]], cohorts: queried }),
        v("Mutation table", { kind: "mutations", gene: genes[0], cohorts: queried })],
      chooser: { label: "gene", options: genes, locks: ["gene", "genes"],
        value: (vs: View[]) => String(((vs[1] as unknown as { gene?: string }).gene) || genes[0]),
        // a new gene keeps the grid's selection (it is about classes, not this gene) and starts the table's own query over
        apply: (vs: View[], g: string) => linkMutations([{ ...vs[0], genes: [g] } as View, { ...vs[1], gene: g, sort: undefined, search: undefined, filters: undefined } as View], 0) },
      link: linkMutations },
    ...(expr && !multi ? [{ title: "Co-expression", views: [v("Co-expression with " + genes[0], { kind: "correlates", gene: genes[0], profileType: expr, cohorts: queried })] }] : []),
    { title: "Comparison/Survival", sub: [
      { title: "Overlap", views: [v("Overlap", { kind: "overlap", cohorts: both })] },
      { title: "Survival", views: [v("Survival", { kind: "survival", cohorts: both })] },
      ...(data.clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: data.clinical.slice(0, CLINICAL_SHOWN), cohorts: both })] }] : []),
      { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation", cohorts: both }),
        v("Copy-number alterations", { kind: "enrichment", alteration: "cna", cohorts: both })] },
      ...(data.assays || []).map((a) => ({ title: a.label, views: [v(a.label, { kind: "assays", profileType: a.profile, cohorts: both })] }))
    ] },
    { title: "CN Segments", views: [v("Genome-wide copy number", { kind: "genome", cohorts: queried })] }
  ], left, { partial: data.partial });
}
