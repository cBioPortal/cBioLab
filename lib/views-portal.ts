// View kinds that close cBioPortal's gaps — the portal's tabs and panels this app did not have,
// rebuilt on its engine: cancertypes (Cancer Types Summary), overlap (the Overlap tab), enrichment
// (Genomic Alterations), assays (the generic-assay tabs: signatures, arm-level CNA, …). Dispatched from lib/views-more.ts's
// runMoreView, so they evaluate cohorts, federate and disclose exactly as the other added views do.
import type { ViewResult, CancertypesView, CancertypesGroup, CancertypesPanel, OverlapView, EnrichmentView, EnrichmentGene, AssaysView, AssaysEntity, AssaysResult } from "./types.ts";
import { cancerTypesSql, cancerTypeSamplesSql, overlapCountsSql, enrichAlteredSql, enrichPanelProfiledSql, enrichWesSql, type EnrichAlteration,
  assayProfileSql, assayMomentsSql, assayValueCountsSql, assayEntityNamesSql } from "./federation-more.ts";
import { fisherExact, chiSquareTest, benjaminiHochberg, welchT, welchAnovaTest, varianceFromMoments } from "./stats.ts";
import { niceCeil } from "./views-more.ts";
import { geneSymbols } from "./gene-tracks.ts";
import { answering, refuse, plural, type ViewCtx } from "./views-more.ts";
import { cancertypesMethod, overlapMethod, enrichmentMethod, assaysMethod } from "./method.ts";

export const PORTAL_VIEW_KINDS = ["cancertypes", "overlap", "enrichment", "assays"] as const;

export function isPortalViewKind(kind: unknown): boolean {
  return (PORTAL_VIEW_KINDS as readonly string[]).includes(String(kind));
}

export async function runPortalView(view: { kind: string }, ctx: ViewCtx): Promise<ViewResult> {
  if (view.kind === "cancertypes") return cancertypesView(view as CancertypesView, ctx);
  if (view.kind === "overlap") return overlapView(view as OverlapView, ctx);
  if (view.kind === "enrichment") return enrichmentView(view as EnrichmentView, ctx);
  if (view.kind === "assays") return assaysView(view as AssaysView, ctx);
  return { kind: view.kind, error: "unknown view kind" };
}

const ATTR_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const zeroGroup = (key: string, label: string): CancertypesGroup =>
  ({ key, label, samples: 0, profiled: 0, altered: 0, mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0 });

// ---------------------------------------------------------------------------
// cancertypes: a gene list's alteration frequency per cancer type

async function cancertypesView(view: CancertypesView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = ctx.overLimit("a cancertypes view", 2, vNames.length); if (e) return refuse("cancertypes", ctx, e.replace("at most 2", "at most 2 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("cancertypes", ctx, (e as Error).message); }
  if (!genes.length) return refuse("cancertypes", ctx, "a cancertypes view needs genes");
  { const e = ctx.overLimit("a cancertypes view", 30, genes.length); if (e) return refuse("cancertypes", ctx, e.replace("at most 30", "at most 30 genes")); }
  const groupBy = String(view.groupBy || "CANCER_TYPE").trim();
  if (groupBy !== "study" && !ATTR_NAME.test(groupBy)) return refuse("cancertypes", ctx, "groupBy is a sample attribute name or \"study\"; got " + JSON.stringify(groupBy).slice(0, 40));
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin) return refuse("cancertypes", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const minSamples = view.minSamples == null ? 10 : Math.floor(Number(view.minSamples));
  if (!(minSamples >= 1 && minSamples <= 1000)) return refuse("cancertypes", ctx, "minSamples is 1 to 1000");
  const show: "frequency" | "count" = view.show === "count" ? "count" : "frequency";
  const attribute = groupBy === "study" ? null : groupBy;

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("cancertypes", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const perSite: { cohort: string; study: string; groups: number; profiled: number }[] = [];
  const panels: CancertypesPanel[] = [];
  for (const n of vNames) {
    const byKey = new Map<string, CancertypesGroup>();
    const get = (k: string, label: string) => { let g = byKey.get(k); if (!g) { g = zeroGroup(k, label); byKey.set(k, g); } else if (!g.label && label) g.label = label; return g; };
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [rows, totals] = await Promise.all([
        ok[st].moreAggregate("cancertypes:" + n, def, (c, s, d) => cancerTypesSql(c, s, d, genes, attribute, pin, measure)),
        ok[st].moreAggregate("cancertypes:samples:" + n, def, (c, s, d) => cancerTypeSamplesSql(c, s, d, attribute))
      ]);
      let profiled = 0;
      for (const r of rows) {
        const g = get(String(r.grp), String(r.label || r.grp));
        g.profiled += Number(r.profiled); g.altered += Number(r.altered); profiled += Number(r.profiled);
        g.mutation += Number(r.mutation); g.amp += Number(r.amp); g.homdel += Number(r.homdel); g.sv += Number(r.sv); g.multiple += Number(r.multiple);
      }
      for (const r of totals) get(String(r.grp), String(r.grp)).samples += Number(r.samples);
      perSite.push({ cohort: n, study: st, groups: rows.length, profiled });
    }));
    const all = [...byKey.values()].map((g) => ({ ...g, label: g.key === "" ? "(no " + (attribute || "study") + " value)" : g.label }));
    const keep = all.filter((g) => g.profiled >= minSamples).sort((a, b) => b.altered / b.profiled - a.altered / a.profiled || b.profiled - a.profiled);
    const small = all.filter((g) => g.profiled < minSamples);
    let pooled: CancertypesPanel["pooled"];
    if (small.length) {
      const p = zeroGroup("__pooled__", small.length + " smaller group" + (small.length === 1 ? "" : "s"));
      for (const g of small) for (const k of ["samples", "profiled", "altered", "mutation", "amp", "homdel", "sv", "multiple"] as const) p[k] += g[k];
      pooled = { ...p, count: small.length };
    }
    const sum = (k: "samples" | "profiled" | "altered") => all.reduce((a, g) => a + g[k], 0);
    panels.push({ cohort: n, samples: sum("samples"), profiled: sum("profiled"), altered: sum("altered"), groups: keep, ...(pooled ? { pooled } : {}) });
  }
  if (!panels.some((p) => p.profiled)) return refuse("cancertypes", ctx, "no sample in " + (vNames.length === 1 ? "this cohort" : "these cohorts") +
    " was profiled for " + (genes.length === 1 ? genes[0] : "any of " + genes.join(", ")));
  const multi = ctx.vStudies.length > 1;
  const groupWord = attribute ? attribute : "study";
  return {
    kind: "cancertypes", cohorts: vNames,
    cancertypes: { groupBy: groupWord, measure, genes, minSamples, show, panels, ...(excluded.length ? { excluded } : {}) },
    method: cancertypesMethod({ genes, groupBy: groupWord, measure, oncokbPin: pin, minSamples, perSite,
      panels: panels.map((p) => ({ cohort: p.cohort, groups: p.groups.length, pooled: p.pooled ? p.pooled.count : 0, profiled: p.profiled, altered: p.altered })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Samples altered in at least one of " + (genes.length === 1 ? genes[0] : genes.length + " genes") + " per " + groupWord + " group, over the samples profiled for at least one of them" +
      " (the union of their panels, as an oncoprint's merged row counts it). " +
      (measure === "driver" ? "Only OncoKB drivers (" + pin + ") count. " : "Any mutation, high-level copy-number change (amplification, deep deletion) or structural variant counts; low-level gains and losses do not. ") +
      "A sample with more than one kind of alteration across the genes counts once, under \"multiple\". Samples are counted, not patients: a patient with two samples counts twice. " +
      (attribute ? attribute + " is read per sample and folded on case and whitespace; samples with no value form their own group. " : "") +
      "Groups with fewer than " + plural(minSamples, "profiled sample") + " are pooled into one bar rather than dropped. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; values are matched by name, not harmonized. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// overlap: how the cohorts' patients intersect

const OVERLAP_COHORT_LIMIT = 6;

async function overlapView(_view: OverlapView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length < 2) return refuse("overlap", ctx, "an overlap view needs at least two cohorts to intersect; this one draws " + vNames.length);
  { const e = ctx.overLimit("an overlap view", OVERLAP_COHORT_LIMIT, vNames.length); if (e) return refuse("overlap", ctx, e.replace("at most " + OVERLAP_COHORT_LIMIT, "at most " + OVERLAP_COHORT_LIMIT + " cohorts")); }
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("overlap", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // per study, only the cohorts that reach it can hold its patients; their bits are mapped back
  const byMask = new Map<number, number>();
  const perSite: { study: string; cohorts: string[]; patients: number }[] = [];
  await Promise.all(Object.keys(ok).map(async (st) => {
    const here = vNames.filter((n) => cohorts[n].studies.includes(st));
    if (!here.length) return;
    const rows = await ok[st].moreAggregateMany("overlap", here.map((n) => doc.cohorts[n]), overlapCountsSql);
    let patients = 0;
    for (const r of rows) {
      const local = Number(r.mask), n = Number(r.n);
      let global = 0;
      here.forEach((name, i) => { if (local & (1 << i)) global |= 1 << vNames.indexOf(name); });
      byMask.set(global, (byMask.get(global) || 0) + n);
      patients += n;
    }
    perSite.push({ study: st, cohorts: here, patients });
  }));
  const intersections = [...byMask].filter(([m]) => m > 0)
    .map(([m, n]) => ({ members: vNames.filter((_, i) => m & (1 << i)), n }))
    .sort((a, b) => b.n - a.n || a.members.length - b.members.length);
  const union = intersections.reduce((a, x) => a + x.n, 0);
  const sets = vNames.map((n) => ({ name: n, size: intersections.filter((x) => x.members.includes(n)).reduce((a, x) => a + x.n, 0) }));
  const mismatch = sets.filter((s) => s.size !== cohorts[s.name].count && !excluded.some((e) => cohorts[s.name].studies.includes(e.study)));
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "overlap", cohorts: vNames,
    overlap: { sets, intersections, union, ...(excluded.length ? { excluded } : {}) },
    method: overlapMethod({ cohorts: vNames, perSite, union, intersections: intersections.length }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Patients in exactly the marked cohorts and none of the others, for every combination that has any — computed inside each study's database, which returns one count per combination. " +
      plural(union, "patient") + " are in at least one of the " + vNames.length + " cohorts. " +
      (multi ? "A patient in two studies is two patients here: ids are study-qualified, so overlap is only ever found within a study. " : "") +
      (mismatch.length ? "WARNING: " + mismatch.map((s) => s.name).join(", ") + " counted differently here than as a cohort — the definition was evaluated twice and gave two answers. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// enrichment: every gene's alteration frequency, compared between cohorts

const ENRICH_ROWS = 300;
const ALTERATION_WORD: Record<EnrichAlteration, string> = {
  mutation: "mutation", cna: "amplification or deep deletion", amp: "amplification", homdel: "deep deletion", sv: "structural variant"
};

async function enrichmentView(view: EnrichmentView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  if (vNames.length < 2) return refuse("enrichment", ctx, "an enrichment view compares two or more cohorts; this one draws " + vNames.length);
  { const e = ctx.overLimit("an enrichment view", 6, vNames.length); if (e) return refuse("enrichment", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  const alteration = (view.alteration || "mutation") as EnrichAlteration;
  if (!(alteration in ALTERATION_WORD)) return refuse("enrichment", ctx, "alteration is mutation, cna, amp, homdel or sv; got " + JSON.stringify(view.alteration).slice(0, 30));
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin) return refuse("enrichment", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const minAltered = view.minAltered == null ? 5 : Math.floor(Number(view.minAltered));
  if (!(minAltered >= 1 && minAltered <= 10000)) return refuse("enrichment", ctx, "minAltered is 1 to 10000");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("enrichment", ctx, "label is 0 to 40 genes");
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("enrichment", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("enrichment", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // per cohort and gene: altered samples, and samples profiled (panel samples + whole-exome samples)
  const altered = new Map<string, number>(), panel = new Map<string, number>(), wes = new Map<string, number>();
  const genes = new Set<string>();
  const perSite: { cohort: string; study: string; genes: number; wes: number }[] = [];
  await Promise.all(vNames.flatMap((n) => cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
    const def = doc.cohorts[n];
    const [a, pr, w] = await Promise.all([
      ok[st].moreAggregate("enrichment:altered:" + n, def, (c, s, d) => enrichAlteredSql(c, s, d, alteration, pin, measure === "driver")),
      ok[st].moreAggregate("enrichment:panels:" + n, def, (c, s, d) => enrichPanelProfiledSql(c, s, d, alteration)),
      ok[st].moreAggregate("enrichment:wes:" + n, def, (c, s, d) => enrichWesSql(c, s, d, alteration))
    ]);
    for (const r of a) { const k = n + "\t" + r.gene; altered.set(k, (altered.get(k) || 0) + Number(r.altered)); genes.add(String(r.gene)); }
    for (const r of pr) { const k = n + "\t" + r.gene; panel.set(k, (panel.get(k) || 0) + Number(r.profiled)); }
    const wn = Number(w[0]?.n || 0);
    wes.set(n, (wes.get(n) || 0) + wn);
    perSite.push({ cohort: n, study: st, genes: a.length, wes: wn });
  })));
  const two = vNames.length === 2;
  const tested: EnrichmentGene[] = [];
  let untested = 0;
  for (const g of genes) {
    const cells = vNames.map((n) => {
      const alt = altered.get(n + "\t" + g) || 0;
      // a sample can be altered in a gene its panel does not list (an off-panel call): it was measured
      const profiled = Math.max(alt, (panel.get(n + "\t" + g) || 0) + (wes.get(n) || 0));
      return { cohort: n, altered: alt, profiled, pct: profiled ? Math.round(1000 * alt / profiled) / 10 : null };
    });
    const total = cells.reduce((a, c) => a + c.altered, 0);
    if (total < minAltered || cells.some((c) => !c.profiled)) { untested++; continue; }
    const p = two
      ? fisherExact(cells[0].altered, cells[0].profiled - cells[0].altered, cells[1].altered, cells[1].profiled - cells[1].altered)
      : chiSquareTest(cells.map((c) => [c.altered, c.profiled - c.altered])).p;
    const shares = cells.map((c) => c.altered / c.profiled);
    const best = shares.indexOf(Math.max(...shares));
    tested.push({ gene: g, cells, ...(two ? { log2Ratio: shares[0] > 0 && shares[1] > 0 ? Math.log2(shares[0] / shares[1]) : null } : {}),
      p, q: 1, enrichedIn: vNames[best] });
  }
  if (!tested.length) return refuse("enrichment", ctx, "no gene had at least " + minAltered + " altered samples (" + ALTERATION_WORD[alteration] + ") across these cohorts, profiled in each of them");
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => a.p - b.p || a.gene.localeCompare(b.gene));
  const rows = tested.slice(0, ENRICH_ROWS);
  const labels = rows.slice(0, label).map((g) => g.gene);
  let grid: NonNullable<ViewResult["enrichment"]>["grid"];
  if (two) {
    const lp = (p: number) => -Math.log10(Math.max(1e-300, p));
    const finite = tested.map((g) => g.log2Ratio).filter((x): x is number => x != null);
    const xMax = niceCeil(Math.max(1, ...finite.map(Math.abs)));
    const yMax = niceCeil(Math.max(1, ...tested.map((g) => lp(g.p))));
    const nx = 80, ny = 50, cells = new Map<string, number>();
    for (const g of tested.slice(ENRICH_ROWS)) {
      const x = g.log2Ratio == null ? (g.cells[0].altered ? xMax : -xMax) : g.log2Ratio;
      const bx = Math.min(nx - 1, Math.max(0, Math.floor((x + xMax) / (2 * xMax) * nx)));
      const by = Math.min(ny - 1, Math.floor(lp(g.p) / yMax * ny));
      cells.set(bx + "," + by, (cells.get(bx + "," + by) || 0) + 1);
    }
    grid = { xMax, yMax, nx, ny, cells: [...cells].map(([k, c]) => { const [x, y] = k.split(",").map(Number); return [x, y, c] as [number, number, number]; }) };
  }
  const significant = tested.filter((g) => g.q < 0.05).length;
  const test = two ? "two-sided Fisher's exact test" : "Pearson chi-squared test (altered vs not × cohort)";
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "enrichment", cohorts: vNames,
    enrichment: { alteration: ALTERATION_WORD[alteration], measure, groups: vNames, tested: tested.length, untested, significant, minAltered, test,
      rows, ...(grid ? { grid } : {}), labels, ...(excluded.length ? { excluded } : {}) },
    method: enrichmentMethod({ alteration: ALTERATION_WORD[alteration], measure, oncokbPin: pin, cohorts: vNames, minAltered, test, two, perSite,
      tested: tested.length, untested, results: rows.map((g) => ({ gene: g.gene, p: g.p, q: g.q })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Every gene's " + ALTERATION_WORD[alteration] + " frequency in each cohort, counted in SAMPLES over the samples profiled for that gene " +
      "(a panel that lists it, or whole-exome; a sample altered off-panel counts as measured)" +
      (alteration === "mutation" ? ", uncalled mutations excluded as the portal excludes them" : alteration === "sv" ? "" : ", high-level copy number only") + ". " +
      (measure === "driver" ? "Only OncoKB drivers (" + pin + ") count. " : "") +
      tested.length.toLocaleString("en-US") + " genes tested with a " + test + "; q is Benjamini–Hochberg across all of them. " +
      untested.toLocaleString("en-US") + " altered genes were not tested: fewer than " + minAltered + " altered samples across the cohorts, or not profiled in one of them. " +
      (two ? "The log ratio is log2 of the first cohort's altered share over the second's, undefined (drawn at the edge) when either is zero. " : "") +
      "A gene enriched here is more often altered, not necessarily more important: a cohort holding hypermutated tumours (MSI-high, POLE) is enriched for mutations in almost every gene at once — exclude them in the cohort definition to see past that. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// assays: every entity of one generic-assay profile, compared between cohorts

const ASSAY_ROWS = 300;
/** past this many entities a profile is refused rather than compared: the per-cohort answer
 *  carries a row per entity, and a probe-level profile has hundreds of thousands */
const ASSAY_MAX_ENTITIES = 20000;
const PROFILE_NAME = /^[A-Za-z0-9_.-]{1,96}$/;
/** values a categorical assay uses for "not called"; counted apart, never a category */
const MISSING_VALUES = new Set(["", "NA", "N/A", "NaN", "nan", "null", "NULL"]);

async function assaysView(view: AssaysView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length < 2) return refuse("assays", ctx, "an assays view compares two or more cohorts; this one draws " + vNames.length);
  { const e = ctx.overLimit("an assays view", 6, vNames.length); if (e) return refuse("assays", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  const pt = String(view.profileType || "");
  if (!PROFILE_NAME.test(pt)) return refuse("assays", ctx, "profileType names a generic-assay profile, e.g. mutational_signatures_contribution_v2");
  const minN = view.minN == null ? 3 : Math.floor(Number(view.minN));
  if (!(minN >= 2 && minN <= 10000)) return refuse("assays", ctx, "minN is 2 to 10000");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("assays", ctx, "label is 0 to 40 entities");
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("assays", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty");

  const { ok, excluded } = answering(ctx);
  const inventory = await Promise.all(Object.keys(ok).map(async (st) => ({ st, ga: (await ctx.studyProfiles(st)).gaProfiles })));
  const holders = inventory.filter((x) => x.ga.includes(pt)).map((x) => x.st);
  for (const x of inventory) if (!x.ga.includes(pt)) excluded.push({ study: x.st, reason: "has no " + pt + " profile" });
  if (!holders.length) {
    const avail = [...new Set(inventory.flatMap((x) => x.ga))].sort();
    return refuse("assays", ctx, "no study here has a generic-assay profile “" + pt + "” — " + (avail.length ? "available: " + avail.join(", ") : "these studies have no generic-assay profiles"));
  }
  const metas = await Promise.all(holders.map(async (st) => ({ st, m: (await ok[st].moreMeta("assays:profile", (s, d) => assayProfileSql(s, d, pt)))[0] || {} })));
  const assayType = String(metas[0].m.generic_assay_type || "");
  if (metas.some((x) => String(x.m.generic_assay_type || "") === "METHYLATION"))
    return refuse("assays", ctx, "“" + pt + "” is per-probe methylation: hundreds of thousands of probes per study, more than this view compares (at most " +
      ASSAY_MAX_ENTITIES.toLocaleString("en-US") + " entities) — compare chosen probes with a plot view, or split cohorts on one with a genericAssay clause");
  const categorical = (dt: unknown) => /^(CATEGORICAL|BINARY)$/i.test(String(dt));
  const kinds = new Set(metas.map((x) => categorical(x.m.datatype)));
  if (kinds.size > 1) return refuse("assays", ctx, "“" + pt + "” is categorical in " + metas.filter((x) => categorical(x.m.datatype)).map((x) => x.st).join(", ") +
    " and numeric in " + metas.filter((x) => !categorical(x.m.datatype)).map((x) => x.st).join(", ") + "; compare one kind at a time");
  const isCat = categorical(metas[0].m.datatype);
  const patientLevel = metas.every((x) => Number(x.m.patient_level) === 1);
  const unit: "samples" | "patients" = patientLevel ? "patients" : "samples";

  // numeric: n, Σx, Σx² per (cohort, entity); categorical: count per (cohort, entity, value)
  const mom = new Map<string, { n: number; sx: number; sxx: number }>();
  const counts = new Map<string, Map<string, number>>();
  const entities = new Set<string>();
  const names = new Map<string, string>();
  let missing = 0;
  const perSite: { cohort: string; study: string; rows: number }[] = [];
  await Promise.all([
    ...holders.map(async (st) => {
      for (const r of await ok[st].moreMeta("assays:names", (s, d) => assayEntityNamesSql(s, d, pt))) if (!names.has(String(r.entity))) names.set(String(r.entity), String(r.name));
    }),
    ...vNames.flatMap((n) => cohorts[n].studies.filter((st) => holders.includes(st)).map(async (st) => {
      const def = doc.cohorts[n];
      if (isCat) {
        const rows = await ok[st].moreAggregate("assays:values:" + n, def, (c, s, d) => assayValueCountsSql(c, s, d, pt));
        for (const r of rows) {
          const v = String(r.value ?? "").trim(), c = Number(r.n);
          if (MISSING_VALUES.has(v)) { missing += c; continue; }
          const k = n + "\t" + r.entity;
          entities.add(String(r.entity));
          const m = counts.get(k) || new Map<string, number>();
          m.set(v, (m.get(v) || 0) + c); counts.set(k, m);
        }
        perSite.push({ cohort: n, study: st, rows: rows.length });
      } else {
        const rows = await ok[st].moreAggregate("assays:moments:" + n, def, (c, s, d) => assayMomentsSql(c, s, d, pt));
        for (const r of rows) {
          const k = n + "\t" + r.entity, cur = mom.get(k) || { n: 0, sx: 0, sxx: 0 };
          cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx); mom.set(k, cur);
          missing += Number(r.other);
          entities.add(String(r.entity));
        }
        perSite.push({ cohort: n, study: st, rows: rows.length });
      }
    }))
  ]);
  if (!entities.size) return refuse("assays", ctx, "none of these cohorts' " + unit + " has a value in “" + pt + "”");
  if (entities.size > ASSAY_MAX_ENTITIES) return refuse("assays", ctx, "“" + pt + "” has " + entities.size.toLocaleString("en-US") + " entities with values here; an assays view compares at most " + ASSAY_MAX_ENTITIES.toLocaleString("en-US"));

  const two = vNames.length === 2;
  const tested: AssaysEntity[] = [];
  let untested = 0;
  const valueTotals = new Map<string, number>();
  for (const e of [...entities].sort()) {
    const name = names.get(e) || e;
    if (isCat) {
      const per = vNames.map((n) => counts.get(n + "\t" + e) || new Map<string, number>());
      const vals = [...new Set(per.flatMap((m) => [...m.keys()]))].sort();
      for (const m of per) for (const [v, c] of m) valueTotals.set(v, (valueTotals.get(v) || 0) + c);
      const cells = vNames.map((n, i) => ({ cohort: n, n: [...per[i].values()].reduce((a, b) => a + b, 0), values: Object.fromEntries(vals.map((v) => [v, per[i].get(v) || 0])) }));
      if (vals.length < 2 || cells.some((c) => c.n < minN)) { untested++; continue; }
      const table = per.map((m) => vals.map((v) => m.get(v) || 0));
      const x = chiSquareTest(table);
      // the cell furthest above what independence expects says where the difference is
      const total = cells.reduce((a, c) => a + c.n, 0);
      let best = { r: -Infinity, cohort: vNames[0], value: vals[0] };
      vals.forEach((v, j) => {
        const col = table.reduce((a, row) => a + row[j], 0);
        cells.forEach((c, i) => { const exp = c.n * col / total; const r = exp > 0 ? (table[i][j] - exp) / Math.sqrt(exp) : 0; if (r > best.r) best = { r, cohort: c.cohort, value: v }; });
      });
      tested.push({ entity: e, name, cells, statistic: x.chi2, p: x.p, q: 1, higherIn: best.cohort, value: best.value });
    } else {
      const cells = vNames.map((n) => {
        const m = mom.get(n + "\t" + e) || { n: 0, sx: 0, sxx: 0 };
        const mean = m.n ? m.sx / m.n : null, v = varianceFromMoments(m.n, m.sx, m.sxx);
        return { cohort: n, n: m.n, mean, sd: m.n >= 2 ? Math.sqrt(v) : null, v };
      });
      const flat = cells.every((c) => c.v <= 1e-12 * (1 + (c.mean || 0) ** 2));
      if (cells.some((c) => c.n < minN) || flat) { untested++; continue; }
      let statistic: number, p: number;
      if (two) { const w = welchT(cells[0].n, cells[0].mean!, cells[0].v, cells[1].n, cells[1].mean!, cells[1].v); statistic = w.t; p = w.p; }
      else { const w = welchAnovaTest(cells.map((c) => ({ n: c.n, mean: c.mean!, variance: c.v }))); statistic = w.f; p = w.p; }
      const means = cells.map((c) => c.mean!);
      tested.push({ entity: e, name, cells: cells.map(({ v, ...c }) => { void v; return c; }),
        ...(two ? { diff: means[0] - means[1] } : {}), statistic, p, q: 1, higherIn: vNames[means.indexOf(Math.max(...means))] });
    }
  }
  if (!tested.length) return refuse("assays", ctx, "no entity of “" + pt + "” had at least " + minN + " " + unit + " with a value in every cohort" + (isCat ? " and two different values" : " and any spread"));
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => a.p - b.p || a.entity.localeCompare(b.entity));
  const rows = tested.slice(0, ASSAY_ROWS);
  // only what is significant is named on the figure
  const labels = rows.filter((g) => g.q < 0.05).slice(0, label).map((g) => g.entity);
  let grid: AssaysResult["grid"];
  if (two && !isCat) {
    const lp = (p: number) => -Math.log10(Math.max(1e-300, p));
    const xMax = niceCeil(Math.max(1e-9, ...tested.map((g) => Math.abs(g.diff!))));
    const yMax = niceCeil(Math.max(1, ...tested.map((g) => lp(g.p))));
    const nx = 80, ny = 50, cellMap = new Map<string, number>();
    for (const g of tested.slice(ASSAY_ROWS)) {
      const bx = Math.min(nx - 1, Math.max(0, Math.floor((g.diff! + xMax) / (2 * xMax) * nx)));
      const by = Math.min(ny - 1, Math.floor(lp(g.p) / yMax * ny));
      cellMap.set(bx + "," + by, (cellMap.get(bx + "," + by) || 0) + 1);
    }
    grid = { xMax, yMax, nx, ny, cells: [...cellMap].map(([k, c]) => { const [x, y] = k.split(",").map(Number); return [x, y, c] as [number, number, number]; }) };
  }
  const significant = tested.filter((g) => g.q < 0.05).length;
  const test = isCat ? "Pearson chi-squared test (cohort × value)" : two ? "Welch's t-test" : "Welch's ANOVA";
  const values = isCat ? [...valueTotals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v) : undefined;
  const profileName = String(metas[0].m.name || pt);
  const multi = holders.length > 1;
  return {
    kind: "assays", cohorts: vNames,
    assays: { profileType: pt, profileName, assayType, datatype: isCat ? "categorical" : "numeric", unit, groups: vNames, tested: tested.length, untested, significant, minN, test,
      ...(values ? { values } : {}), missing, rows, ...(grid ? { grid } : {}), labels, ...(excluded.length ? { excluded } : {}) },
    method: assaysMethod({ profileType: pt, categorical: isCat, unit, cohorts: vNames, minN, test, perSite, tested: tested.length, untested, missing,
      moments: isCat ? [] : [...mom].map(([k, m]) => { const [cohort, entity] = k.split("\t"); return { cohort, entity, ...m }; }),
      counts: isCat ? [...counts].flatMap(([k, m]) => { const [cohort, entity] = k.split("\t"); return [...m].map(([value, n]) => ({ cohort, entity, value, n })); }) : [],
      results: rows.map((g) => ({ entity: g.entity, p: g.p, q: g.q })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Every entity of “" + profileName + "” (" + pt + ") compared across the cohorts, one value per " + unit.replace(/s$/, "") + " as the study recorded it" +
      (unit === "samples" ? ", from every sample of each cohort's patients" : "") + ". " +
      (isCat
        ? "Values NA or blank mean not called and are left out (" + missing.toLocaleString("en-US") + " of them), not treated as a category. Each entity is tested with a " + test + " on its counts, no continuity correction; the χ² approximation is thin where a value is rare. "
        : "Values that are not numbers (a limit such as \">8\", or NA) are left out (" + missing.toLocaleString("en-US") + " of them). Each entity is tested with " + test +
          " from each cohort's n, mean and variance; with thousands of " + unit + " a tiny difference is significant, so read the means too. ") +
      tested.length.toLocaleString("en-US") + " entities tested; q is Benjamini–Hochberg across all of them. " +
      untested.toLocaleString("en-US") + " were not tested: fewer than " + minN + " " + unit + " with a value in some cohort" + (isCat ? ", or a single value throughout" : ", or no spread") + ". " +
      (multi ? "Counts and moments are summed across " + holders.length + " studies; overlap is not deduplicated and no batch correction is made. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
