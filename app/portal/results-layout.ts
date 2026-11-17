// The Results page's document, as cBioPortal lays the page out: what was queried (one study or
// several, narrowed by Explore's filters or not), one tab per portal tab, each drawing the queried
// patients; Comparison/Survival alone compares those the gene query alters with the profiled rest. Pure: the page builds it, and so
// can a script that checks the views run.
import type { Clause, CohortDef, Leaf, View } from "../../lib/types.ts";
import type { SelectedProfile } from "../../lib/query-options.ts";
import { parseOql, OQL_PROFILE } from "../../lib/oql-parse.ts";
import { hasOql, oqlHasMutationOql, oqlSublabel, oqlTrackName } from "../../lib/oql-match.ts";
import { ALTERATION_CELLS, cellLabel, pruneCodons } from "../../lib/lollipop.ts";
import { arrange, type PageLayout, type TabBanner } from "./page-doc.ts";
import { compactDrivers, driversOf, withDrivers, type DriverSettings } from "../../lib/driver-settings.ts";
import { fmtInt, fmtPct } from "../../lib/chart/format.ts";
import { survivalDefault } from "./comparison-layout.ts";


/** What a Results page queries. */
export interface ResultsQuery {
  /** one study, or several pooled */
  studies: string[];
  /** Explore's filters, which every group keeps */
  filters: Clause[];
  /** the gene query, one OQL entry each, as the query page's profiles resolve it (lib/query-options.ts resolveQuery) */
  entries: string[];
  /** its genes, in order */
  genes: string[];
  /** the profiles the query's EXP and PROT alterations read (the query page's mRNA and protein choice), when it names them */
  exp?: string;
  prot?: string;
  /** several studies: exp / prot apply to each study holding that profile */
  ifHeld?: boolean;
  /** the profiles the query page selected (the portal's selectedMolecularProfiles), when its options say; every alteration data type held otherwise */
  selected?: SelectedProfile[];
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
   * whether the queried patients carry a structural variant with a queried gene as either partner
   * (svCheckCohort's count), which decides the Structural Variants tab as the portal's
   * `structuralVariants.result.length` does: undefined while it is asked, null when asking failed
   */
  svs?: boolean | null;
  /**
   * only `held` is known yet: lay out the tabs that need nothing else (Plots, Co-expression and
   * Comparison's Clinical and assay sub-tabs follow once the profiles and attributes are known)
   */
  partial?: boolean;
}

type ProfileType = "MUTATION" | "CNA" | "SV";
const ALL_KINDS: ProfileType[] = ["MUTATION", "CNA", "SV"];
const TYPE_WORD: Record<ProfileType, string> = { MUTATION: "mutation", CNA: "copy number", SV: "structural variants" };
/** the profiles Unaltered checks, in words */
const selectionWords = (q: ResultsQuery, held: ResultsData["held"]): string =>
  (q.selected ?? ALL_KINDS.filter((t) => held.every.includes(t) || held.some.includes(t)).map((type) => ({ type }))).map((s) => "profile" in s ? s.profile : TYPE_WORD[s.type]).join(", ");

/**
 * The page's cohorts, as cBioPortal has them (ResultsViewPageStore filteredUnalteredAndProfiledSamples,
 * totallyUnprofiledSamples). Queried: everyone the query covers (the studies, with Explore's
 * filters) — what every tab draws but Comparison/Survival. Altered: the query matches. Unaltered: it
 * does not, and the sample is not wholly unprofiled — in at least one of the query's selected
 * profiles (`q.selected`: mRNA and protein too) on a panel covering at least one queried gene. With
 * no options the selection is every alteration data type the studies hold. A sample profiled in
 * none of them is in neither group; when nothing can be checked, Unaltered is empty.
 */
export function resultsGroups(q: ResultsQuery, held: ResultsData["held"], drivers?: DriverSettings): { cohorts: Record<string, CohortDef>; unchecked: string[] } {
  const scope = q.studies.length === 1 ? { study: q.studies[0] } : { studies: q.studies };
  const isHeld = (t: ProfileType) => held.every.includes(t) || held.some.includes(t);
  const defaults: SelectedProfile[] = ALL_KINDS.filter(isHeld).map((type) => ({ type }));
  // a selection naming nothing Unaltered can check (DNA methylation across studies) checks the alteration
  // data types instead, and the page says so; a type no study holds matches nobody
  const selected: SelectedProfile[] = q.selected?.length ? q.selected : defaults.length ? defaults : [{ type: "MUTATION" }];
  const leaves = selected.map((s) => ({ kind: "profiled", ...s, genes: q.genes, anyGene: true }) as Leaf);
  const profiled: Clause[] = leaves.length > 1 ? [{ any: leaves }] : leaves;
  // EXP / PROT lines whose profile the selection does not check
  const read = (t: string) => t === "EXP" ? q.exp : t === "PROT" ? q.prot : undefined;
  const checks = (t: string) => { const p = read(t); return !!p && selected.some((s) => "profile" in s && s.profile === p); };
  const unchecked: string[] = [];
  for (const entry of q.entries) for (const e of parseOql(entry)) for (const spec of e.specs)
    if (!OQL_PROFILE[spec.type] && !checks(spec.type)) unchecked.push(e.gene + ": " + spec.type);
  // the query as one OQL clause — its ";" is "or" between entries (up to 30), where an `any` group
  // of one clause per line would stop at 8
  const text = q.entries.join("; ");
  const query = { kind: "oql", q: text, ...pinsOf(q), ...(asksDriver(text) ? { drivers: driverSources(drivers) } : {}) };
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

/** the view kinds that read the query's lines (`oql`) with the page's driver settings */
const OQL_DRIVER_KINDS = new Set(["cancertypes", "cooccurrence", "pathwaymap", "datafiles", "hotspots", "mutations"]);

/**
 * The Mutations tab's OQL status, as the portal's OqlStatusBanner says it (Mutations.tsx 185-197):
 * filtered, with "Do not filter by OQL"; not filtered, with "Filter by OQL"; or unaffected when the
 * query narrows no mutation. The switch is the views' `useOql`.
 */
function mutationsBanner(narrows: boolean): TabBanner {
  const on = (vs: View[]) => (vs[0] as unknown as { useOql?: boolean }).useOql !== false;
  if (!narrows) return { text: () => "Your OQL specification does not affect the results below because you have not specified any filters for mutations in this gene." };
  return {
    text: (vs) => on(vs) ? "The results below are filtered by the OQL specification from your query." : "The results below are not filtered by the OQL specification from your query.",
    toggle: {
      label: (vs) => on(vs) ? "Do not filter by OQL" : "Filter by OQL",
      apply: (vs) => vs.map((v) => { const n = { ...v } as Record<string, unknown>; if (on(vs)) n.useOql = false; else delete n.useOql; return n as unknown as View; }),
    },
  };
}
/** does an OQL query name DRIVER anywhere (DRIVER, MUT_DRIVER, AMP_DRIVER, a range's _DRIVER)? */
const asksDriver = (q: string): boolean => { try { return parseOql(q).some((e) => e.specs.some((sp) => sp.driver)); } catch { return false; } };
/** the driver sources of the page's settings: what DRIVER reads in an oql clause (what is hidden is not the clause's) */
const driverSources = (d: DriverSettings | undefined): DriverSettings =>
  compactDrivers({ oncokb: d?.oncokb, hotspots: d?.hotspots, custom: d?.custom, tiers: d?.tiers }) || {};

/**
 * The page's driver settings, the oncoprint's, given to every oql clause of its cohorts that names
 * DRIVER, as the portal's header count, Comparison/Survival and Download follow its settings
 * (putativeDriver). A clause without DRIVER is left alone, so a settings change re-runs nothing there.
 */
export function syncDriverCohorts<D extends { cohorts?: Record<string, CohortDef>; views?: View[] }>(doc: D): D {
  const onco = (doc.views || []).find((v) => v.kind === "oncoprint");
  const sources = driverSources(onco ? driversOf(onco as never) : undefined);
  const fix = (c: Clause): Clause => {
    const x = c as { kind?: string; q?: string; not?: Clause };
    if (x.not) { const inner = fix(x.not); return inner === x.not ? c : { ...c, not: inner } as Clause; }
    if (x.kind !== "oql" || !asksDriver(String(x.q || ""))) return c;
    return JSON.stringify((c as { drivers?: unknown }).drivers) === JSON.stringify(sources) ? c : { ...c, drivers: sources } as Clause;
  };
  // a view that reads the query's OQL itself (`oql`, its lines) and takes driver settings follows them
  const views = (doc.views || []).map((v) => {
    const x = v as unknown as { oql?: unknown; drivers?: unknown };
    if (!OQL_DRIVER_KINDS.has(v.kind) || !Array.isArray(x.oql) || !asksDriver(x.oql.join("; "))) return v;
    return JSON.stringify(x.drivers) === JSON.stringify(sources) ? v : { ...v, drivers: sources } as View;
  });
  let changed = views.some((v, i) => v !== (doc.views || [])[i]);
  const cohorts = Object.fromEntries(Object.entries(doc.cohorts || {}).map(([k, def]) => {
    const all = (def.all || []).map(fix);
    if (all.some((c, i) => c !== (def.all || [])[i])) { changed = true; return [k, { ...def, all }]; }
    return [k, def];
  }));
  return changed ? { ...doc, cohorts, ...(doc.views ? { views } : {}) } : doc;
}

/** the query's EXP / PROT profile choice, as an oql clause and the Download tab carry it */
const pinsOf = (q: ResultsQuery) => ({ ...(q.exp ? { exp: q.exp } : {}), ...(q.prot ? { prot: q.prot } : {}), ...(q.ifHeld && (q.exp || q.prot) ? { ifHeld: true } : {}) });

/**
 * The Mutations tab's lollipop and its table, kept in step as the portal keeps them. The grid's
 * hidden cells become the table's filter on its Alteration column (the cells still shown), and a
 * value filter set on that column from the table becomes the grid's selection. The stems selected
 * on the plot (its `codons`, for the tab's one gene) become the table's filter on its Protein
 * Position column, and a value filter set there from the table selects those stems. A condition or
 * range filter on either column is not a set of cells or codons, so it leaves the plot alone.
 */
export function linkMutations(vs: View[], changed: number): View[] {
  const [lp, tb] = vs as unknown as [{ hide?: string[]; genes?: string[]; codons?: Record<string, number[]> } & View, { gene?: string; filters?: Record<string, unknown> } & View];
  const gene = tb.gene || (lp.genes || [])[0] || "";
  if (changed === 0) {
    const hide = lp.hide || [];
    const picked = (lp.codons || {})[gene] || [];
    const filters = { ...(tb.filters || {}) };
    if (hide.length) filters.alteration = { values: ALTERATION_CELLS.filter((c) => !hide.includes(c)).map(cellLabel) };
    else delete filters.alteration;
    if (picked.length) filters.proteinPos = { values: picked.map(String) };
    else delete filters.proteinPos;
    return [lp, { ...tb, filters: Object.keys(filters).length ? filters : undefined } as View];
  }
  let next = lp;
  const f = (tb.filters || {}).alteration as { values?: string[] } | undefined;
  if (!f || Array.isArray(f.values)) {
    const shown = f ? new Set(f.values) : null;
    const hide = shown ? ALTERATION_CELLS.filter((c) => !shown.has(cellLabel(c))) : [];
    next = { ...next, hide: hide.length ? hide : undefined };
  }
  const pf = (tb.filters || {}).proteinPos as { values?: string[] } | undefined;
  if (!pf || Array.isArray(pf.values)) {
    const picked = [...new Set((pf?.values || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
    next = { ...next, codons: pruneCodons({ ...(next.codons || {}), [gene]: picked }, gene ? [gene] : []) };
  }
  return next === lp ? vs : [next as View, tb];
}

/**
 * The Results page's driver settings are the page's, as the portal's sliders menu is: a change made
 * on one view that takes them (the oncoprint's menu, the plot's) is made on every other, so the
 * tabs agree on what a driver is. The sources travel to every such view; what is hidden (VUS,
 * germline) travels from an oncoprint, since a plot draws every mutation and offers no such
 * filter. A plot follows only when it holds settings — the Results page's own Plots tab does.
 * `prev` and `next` are the page's views before and after one edit.
 */
export function syncDrivers(prev: View[], next: View[]): View[] {
  const takes = (v: View) => v.kind === "oncoprint" || v.kind === "plot";
  const at = next.findIndex((v, i) => takes(v) && prev[i] && v.kind === prev[i].kind &&
    JSON.stringify(driversOf(v as never) ?? null) !== JSON.stringify(driversOf(prev[i] as never) ?? null));
  if (at < 0) return next;
  const from = driversOf(next[at] as never) || {}, fromOncoprint = next[at].kind === "oncoprint";
  return next.map((v, i) => {
    if (i === at || !takes(v)) return v;
    const own = driversOf(v as never) || {};
    const merged = compactDrivers({ hideVus: own.hideVus, hideGermline: own.hideGermline,
      ...(fromOncoprint ? { hideVus: from.hideVus, hideGermline: from.hideGermline } : {}),
      oncokb: from.oncokb, hotspots: from.hotspots, custom: from.custom, tiers: from.tiers });
    if (v.kind === "oncoprint") return withDrivers(v, merged);
    const pv = v as unknown as { drivers?: DriverSettings };
    if (pv.drivers == null) return v;
    // a plot draws every mutation, so it keeps sources alone
    const sources = compactDrivers({ oncokb: from.oncokb, hotspots: from.hotspots, custom: from.custom, tiers: from.tiers }) || {};
    return { ...v, drivers: sources } as View;
  });
}

/**
 * The queried patients with a structural variant in any queried gene (gene 1 or gene 2, as the
 * portal fetches them): the check behind the Structural Variants tab, sent beside the header's
 * count of Altered and Queried rather than as a request of its own.
 */
export function svCheckCohort(q: ResultsQuery): CohortDef {
  const scope = q.studies.length === 1 ? { study: q.studies[0] } : { studies: q.studies };
  return { ...scope, all: [...q.filters, { kind: "oql", q: q.genes.map((g) => g + ": FUSION").join("; ") } as Clause] } as CohortDef;
}

/** The Structural Variants tab's table and the tab's gene chips, the portal's per-gene sub-tabs: one gene's calls at a time. */
const svTab = (genes: string[], queried: string[]) => ({
  title: "Structural Variants",
  views: [{ title: "Structural variants", view: { kind: "sv", genes: [genes[0]], cohorts: queried } as unknown as View }],
  chooser: { label: "gene", options: genes, locks: ["genes"],
    value: (vs: View[]) => String(((vs[0] as unknown as { genes?: string[] }).genes || [genes[0]])[0]),
    // a new gene starts the table's own query over, as the portal's sub-tab does
    apply: (vs: View[], g: string) => [{ ...vs[0], genes: [g], sort: undefined, search: undefined, filters: undefined } as View] },
});

/** the CN Segments tab's whole-genome choice, beside one chip per queried gene */
export const WHOLE_GENOME = "Whole genome";

/**
 * The CN Segments tab as the portal has it: every queried sample's segments as a track, zoomed to
 * one queried gene at a time (the first, to start) or the whole genome — the portal's pills —
 * then the cohort's genome-wide gain and loss frequency beneath.
 */
const cnSegmentsTab = (genes: string[], queried: string[]) => ({
  title: "CN Segments",
  views: [
    { title: "Copy-number segments", view: { kind: "segments", gene: genes[0], cohorts: queried } as unknown as View },
    { title: "Genome-wide copy number", view: { kind: "genome", cohorts: queried } as unknown as View },
  ],
  chooser: { label: "locus", options: [...genes, WHOLE_GENOME], locks: ["gene", "region"],
    value: (vs: View[]) => (vs[0] as unknown as { gene?: string }).gene || WHOLE_GENOME,
    apply: (vs: View[], g: string) => [{ ...vs[0], gene: g === WHOLE_GENOME ? undefined : g, region: undefined } as View, ...vs.slice(1)] },
});

/**
 * The Oncoprint tab's rows: each line of the query its own row, in order, as the portal's oncoprint
 * draws them (OncoprintUtils makeGeneticTrackWith), a gene without OQL bare.
 */
export function oncoprintRows(entries: string[]): string[] {
  return entries.flatMap((x) => parseOql(x)).map(({ gene, specs }) =>
    specs.some((sp) => sp.type === "ANY" && !sp.driver) ? gene : gene + oqlSublabel(specs));
}

/** The Results page as the portal has it, for this query. */
export function resultsLayout(q: ResultsQuery, data: ResultsData): PageLayout {
  const { genes } = q;
  const { cohorts, unchecked } = resultsGroups(q, data.held);
  const multi = q.studies.length > 1;
  const svHeld = data.held.every.includes("SV") || data.held.some.includes("SV");
  // as cBioPortal does: expression across studies only where its rule allows, and co-expression for one study only
  const expr = data.expr && (!multi || data.expressionAcross) ? data.expr : null;
  const plotY = data.partial ? null : expr ? { source: "profile", profile: expr, gene: genes[0] }
    : data.numeric.length ? { source: "clinical", attribute: data.numeric.find((a) => a === "FRACTION_GENOME_ALTERED" || a === "MUTATION_COUNT") || data.numeric[0] } : null;
  // every tab draws the queried patients, as cBioPortal's do; only Comparison/Survival compares groups
  const queried = ["Queried"], both = ["Altered", "Unaltered"];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  // the Mutations tab follows the query's lines where they narrow mutations, as the portal's
  const mutOql = { oql: q.entries, ...(asksDriver(q.entries.join("; ")) ? { drivers: {} } : {}) };
  const queryHasOql = q.entries.some((x) => { try { return parseOql(x).some((e) => hasOql(e.specs)); } catch { return false; } });
  // Mutual Exclusivity's tracks are the query's lines, named as the portal names them (2 or more to pair)
  const meTracks = new Set(q.entries.map((x) => { try { return oqlTrackName(x); } catch { return x; } })).size;
  const left = [
    // what the profiles decide is said once they are known
    ...(data.partial ? [] : [
      !data.expr ? (multi ? "Co-expression (no shared mRNA profile)" : "Co-expression (no mRNA profile)")
        : multi ? "Co-expression (one study at a time)" : null,
      data.expr && multi && !data.expressionAcross ? "expression in Plots (expression data cannot be compared across the selected studies)" : null,
      !plotY ? "Plots (no mRNA profile or numeric clinical attribute)" : null,
    ]),
    meTracks < 2 ? "Mutual Exclusivity (one track)" : null,
    !svHeld ? "Structural Variants (no structural-variant data)"
      : data.svs === false ? "Structural Variants (no structural variant in the queried genes)"
      : data.svs === null ? "Structural Variants (could not check for structural variants in the queried genes)" : null,
    unchecked.length ? "Unaltered checks profiling in the selected profiles (" + selectionWords(q, data.held) + "), not for " + unchecked.join(", ") + ": a sample profiled only for those is in neither group" : null,
    q.selected && !q.selected.length ? "The selected profiles name none Unaltered can check, so it checks the " + selectionWords({ ...q, selected: undefined }, data.held) + " data instead" : null,
  ].filter(Boolean) as string[];
  return arrange({ study: q.studies[0], cohorts }, [
    { title: "Oncoprint", views: [v("Oncoprint", { kind: "oncoprint", genes: oncoprintRows(q.entries), ...pinsOf(q), cohorts: queried })] },
    { title: "Cancer Types Summary", views: [v("Cancer types summary", { kind: "cancertypes", genes, oql: q.entries, ...pinsOf(q),
      ...(asksDriver(q.entries.join("; ")) ? { drivers: {} } : {}), cohorts: queried })] },
    ...(meTracks >= 2 ? [{ title: "Mutual Exclusivity", views: [v("Mutual exclusivity", { kind: "cooccurrence", genes, oql: q.entries, ...pinsOf(q),
      ...(asksDriver(q.entries.join("; ")) ? { drivers: {} } : {}), cohorts: queried })] }] : []),
    ...(plotY ? [{ title: "Plots", views: [v("Plot", { kind: "plot",
      x: expr ? (data.cna ? { source: "profile", profile: data.cna, gene: genes[0] } : { source: "alteration", gene: genes[0], by: "cna" }) : { source: "alteration", gene: genes[0], by: "mutationType" },
      y: plotY, cohorts: queried, points: [{ cohort: "Altered" }, { rule: "outliers" }], drivers: {} })] }] : []),
    // the portal's Mutations tab: one gene at a time, its lollipop over its mutation table
    { title: "Mutations", views: [v("Mutation diagram", { kind: "hotspots", genes: [genes[0]], ...mutOql, cohorts: queried }),
        v("Mutation table", { kind: "mutations", gene: genes[0], ...mutOql, cohorts: queried })],
      ...(queryHasOql ? { banner: mutationsBanner(oqlHasMutationOql(q.entries)) } : {}),
      chooser: { label: "gene", options: genes, locks: ["gene", "genes"],
        value: (vs: View[]) => String(((vs[1] as unknown as { gene?: string }).gene) || genes[0]),
        // a new gene keeps the grid's selection (it is about classes, not this gene) and starts the table's own query over
        apply: (vs: View[], g: string) => linkMutations([{ ...vs[0], genes: [g], codons: undefined } as View, { ...vs[1], gene: g, sort: undefined, search: undefined, filters: undefined } as View], 0) },
      link: linkMutations },
    ...(svHeld && data.svs ? [svTab(genes, queried)] : []),
    ...(expr && !multi ? [{ title: "Co-expression", views: [v("Co-expression with " + genes[0], { kind: "correlates", gene: genes[0], profileType: expr, cohorts: queried })] }] : []),
    { title: "Comparison/Survival", sub: [
      { title: "Overlap", views: [v("Overlap", { kind: "overlap", cohorts: both })] },
      // the survival-type table beside the curves, on the portal's first endpoint; only with survival data once the attributes are known
      ...(data.partial || survivalDefault(data.clinical) ? [{ title: "Survival", views: [v("Survival", { kind: "survival", types: true, partitions: true, testAnySize: true, cohorts: both,
        ...(!data.partial && survivalDefault(data.clinical) !== "OS" ? { endpoint: survivalDefault(data.clinical) } : {}) })] }] : []),
      ...(data.clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", allAttributes: true, rankTests: true, cohorts: both })] }] : []),
      { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation", cohorts: both }),
        v("Copy-number alterations", { kind: "enrichment", alteration: "cna", cohorts: both })] },
      ...(data.assays || []).map((a) => ({ title: a.label, views: [v(a.label, { kind: "assays", profileType: a.profile, cohorts: both })] }))
    ] },
    cnSegmentsTab(genes, queried),
    // the portal's PathwayMapper tab: the pathway holding most of the queried genes, each gene's altered %
    { title: "Pathways", views: [v("Pathways", { kind: "pathwaymap", genes, oql: q.entries, ...pinsOf(q),
      ...(asksDriver(q.entries.join("; ")) ? { drivers: {} } : {}), cohorts: queried })] },
    // the portal's Download tab, after Pathways, last as there: the files of the queried samples for the query's lines
    { title: "Download", views: [v("Download", { kind: "datafiles", oql: q.entries, ...pinsOf(q),
      ...(asksDriver(q.entries.join("; ")) ? { drivers: {} } : {}), cohorts: queried })] }
  ], left, { partial: data.partial || (svHeld && data.svs === undefined) });
}

/**
 * The header's samples line, as the portal adds it when the queried samples outnumber the patients
 * (ONC-STM-2): altered samples of all queried samples, the % rounded to an integer.
 */
export function samplesLine(a: { queried: number; alteredSamples?: number; queriedSamples?: number }): string | null {
  const { alteredSamples: n, queriedSamples: of } = a;
  if (n == null || !of || of === a.queried) return null;
  return fmtInt(n) + " (" + fmtPct(100 * n / of, 0) + ") of " + fmtInt(of) + " queried samples altered";
}
