// View kinds that close cBioPortal's gaps — the portal's tabs and panels this app did not have,
// rebuilt on its engine: cancertypes (Cancer Types Summary), overlap (the Overlap tab), enrichment
// (Genomic Alterations), assays (the generic-assay tabs: signatures, arm-level CNA, …), correlates
// (Co-expression), table (Clinical Data). Dispatched from lib/views-more.ts's
// runMoreView, so they evaluate cohorts, federate and disclose exactly as the other added views do.
import type { ViewResult, CancertypesView, CancertypesGroup, CancertypesPanel, OverlapView, EnrichmentView, EnrichmentGene, AssaysView, AssaysEntity, AssaysResult, CorrelatesView, CorrelatesGene, TableView, MutationsView } from "./types.ts";
import { cancerTypesSql, cancerTypeSamplesSql, overlapCountsSql, enrichAlteredSql, enrichPanelProfiledSql, enrichWesSql, type EnrichAlteration,
  assayProfileSql, assayMomentsSql, assayValueCountsSql, assayEntityNamesSql, correlatesMomentsSql, geneCytobandsSql } from "./federation-more.ts";
import { fisherExact, chiSquareTest, benjaminiHochberg, welchT, welchAnovaTest, varianceFromMoments, pearsonFromMoments, pearsonR, fisherZMeta } from "./stats.ts";
import { niceCeil } from "./views-more.ts";
import { geneSymbols } from "./gene-tracks.ts";
import { answering, refuse, plural, type ViewCtx, type MoreResolver } from "./views-more.ts";
import { isPatientLevel, type PatientLevelCapable } from "./federation.ts";
import { tableAttributesSql, clinicalRowSource, idColumns, TABLE_COLUMNS_MAX, type TableColumn } from "./clinical-table.ts";
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS, mutationRowSource, type TablePart } from "./mutation-table.ts";
import { checkQuery, cleanQuery, describeQuery, mergeValues, shownColumns, type ColumnValues, type RowSource, type TableQuery } from "./table-query.ts";
import { cancertypesMethod, overlapMethod, enrichmentMethod, assaysMethod, correlatesMethod, tableMethod, mutationsMethod } from "./method.ts";

export const PORTAL_VIEW_KINDS = ["cancertypes", "overlap", "enrichment", "assays", "correlates", "table", "mutations"] as const;

export function isPortalViewKind(kind: unknown): boolean {
  return (PORTAL_VIEW_KINDS as readonly string[]).includes(String(kind));
}

export async function runPortalView(view: { kind: string }, ctx: ViewCtx): Promise<ViewResult> {
  if (view.kind === "cancertypes") return cancertypesView(view as CancertypesView, ctx);
  if (view.kind === "overlap") return overlapView(view as OverlapView, ctx);
  if (view.kind === "enrichment") return enrichmentView(view as EnrichmentView, ctx);
  if (view.kind === "assays") return assaysView(view as AssaysView, ctx);
  if (view.kind === "correlates") return correlatesView(view as CorrelatesView, ctx);
  if (view.kind === "table") return tableView(view as TableView, ctx);
  if (view.kind === "mutations") return mutationsView(view as MutationsView, ctx);
  return { kind: view.kind, error: "unknown view kind" };
}

const ATTR_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const zeroGroup = (key: string, label: string): CancertypesGroup =>
  ({ key, label, samples: 0, profiled: 0, altered: 0, mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0 });

/** Cytobands for the genes a table lists, from the first participant that can answer; a gene it
 *  does not know (or no answer at all) is left without one rather than failing the view. */
async function cytobands(ok: Record<string, MoreResolver>, genes: string[]): Promise<Map<string, string>> {
  const first = Object.values(ok)[0];
  if (!first || !genes.length) return new Map();
  const rows = await first.moreMeta("cytobands", (s, d) => geneCytobandsSql(genes, s, d)).catch(() => []);
  return new Map(rows.map((r) => [String(r.gene), String(r.cytoband || "")]));
}

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
  const unit: "patient" | "sample" = view.unit === "sample" ? "sample" : "patient";
  const attribute = groupBy === "study" ? null : groupBy;

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("cancertypes", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const perSite: { cohort: string; study: string; groups: number; profiled: number }[] = [];
  const panels: CancertypesPanel[] = [];
  const COUNTS = ["samples", "profiled", "altered", "mutation", "amp", "homdel", "sv", "multiple"] as const;
  const ALL_KEY = "\x01all";
  const cohortTotal = new Map<string, { profiled: number; altered: number; samples: number }>();
  // groups at or over the floor, most altered first; the rest pooled into one, counted
  const arrange = (all: CancertypesGroup[]) => {
    const named = all.map((g) => ({ ...g, label: g.key === "" ? "(no " + (attribute || "study") + " value)" : g.label }));
    const keep = named.filter((g) => g.profiled >= minSamples).sort((a, b) => b.altered / b.profiled - a.altered / a.profiled || b.profiled - a.profiled);
    const small = named.filter((g) => g.profiled < minSamples);
    let pooled: CancertypesPanel["pooled"];
    if (small.length) {
      const p = zeroGroup("__pooled__", small.length + " smaller group" + (small.length === 1 ? "" : "s"));
      p.profiledFor = { mutation: 0, cna: 0, sv: 0 };
      for (const g of small) {
        for (const k of COUNTS) p[k] += g[k];
        for (const k of ["mutation", "cna", "sv"] as const) p.profiledFor[k] += g.profiledFor?.[k] || 0;
      }
      pooled = { ...p, count: small.length };
    }
    return { groups: keep, ...(pooled ? { pooled } : {}) };
  };
  for (const n of vNames) {
    // gene "*" is the genes together; every other key one gene
    const byGene = new Map<string, Map<string, CancertypesGroup>>();
    const totals = new Map<string, { samples: number; profiledFor: { mutation: number; cna: number; sv: number }; label: string }>();
    const get = (gene: string, k: string, label: string) => {
      let m = byGene.get(gene); if (!m) { m = new Map(); byGene.set(gene, m); }
      let g = m.get(k); if (!g) { g = zeroGroup(k, label); m.set(k, g); } else if (!g.label && label) g.label = label;
      return g;
    };
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [rows, tot] = await Promise.all([
        ok[st].moreAggregate("cancertypes:" + n, def, (c, s, d) => cancerTypesSql(c, s, d, genes, attribute, pin, measure, unit)),
        ok[st].moreAggregate("cancertypes:samples:" + n, def, (c, s, d) => cancerTypeSamplesSql(c, s, d, attribute, unit))
      ]);
      let profiled = 0;
      for (const r of rows) {
        if (r.grp === ALL_KEY) {
          if (r.gene === "*") { const t = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 }; t.profiled += Number(r.profiled); t.altered += Number(r.altered); cohortTotal.set(n, t); }
          continue;
        }
        const g = get(String(r.gene), String(r.grp), String(r.label || r.grp));
        g.profiled += Number(r.profiled); g.altered += Number(r.altered); if (r.gene === "*") profiled += Number(r.profiled);
        g.mutation += Number(r.mutation); g.amp += Number(r.amp); g.homdel += Number(r.homdel); g.sv += Number(r.sv); g.multiple += Number(r.multiple);
      }
      for (const r of tot) {
        if (r.grp === ALL_KEY) { const t = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 }; t.samples += Number(r.samples); cohortTotal.set(n, t); continue; }
        const t = totals.get(String(r.grp)) || { samples: 0, profiledFor: { mutation: 0, cna: 0, sv: 0 }, label: String(r.grp) };
        t.samples += Number(r.samples); t.profiledFor.mutation += Number(r.mut); t.profiledFor.cna += Number(r.cna); t.profiledFor.sv += Number(r.sv);
        totals.set(String(r.grp), t);
      }
      perSite.push({ cohort: n, study: st, groups: rows.filter((r) => r.gene === "*").length, profiled });
    }));
    // every group with units appears, profiled or not; each carries its totals
    for (const [k, t] of totals) get("*", k, t.label);
    for (const m of byGene.values()) for (const g of m.values()) {
      const t = totals.get(g.key);
      if (t) { g.samples = t.samples; g.profiledFor = { ...t.profiledFor }; }
    }
    const all = [...(byGene.get("*") || new Map()).values()];
    // the cohort's own totals count each unit once, though a patient can sit in two groups
    const ct = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 };
    panels.push({ cohort: n, samples: ct.samples, profiled: ct.profiled, altered: ct.altered, ...arrange(all),
      ...(genes.length > 1 ? { perGene: genes.map((gene) => ({ gene, ...arrange([...(byGene.get(gene) || new Map()).values()]) })) } : {}) });
  }
  if (!panels.some((p) => p.profiled)) return refuse("cancertypes", ctx, "no " + unit + " in " + (vNames.length === 1 ? "this cohort" : "these cohorts") +
    " was profiled for " + (genes.length === 1 ? genes[0] : "any of " + genes.join(", ")));
  const multi = ctx.vStudies.length > 1;
  const groupWord = attribute ? attribute : "study";
  return {
    kind: "cancertypes", cohorts: vNames,
    cancertypes: { groupBy: groupWord, measure, genes, minSamples, show, unit, panels, ...(excluded.length ? { excluded } : {}) },
    method: cancertypesMethod({ genes, groupBy: groupWord, measure, oncokbPin: pin, minSamples, unit, perSite,
      panels: panels.map((p) => ({ cohort: p.cohort, groups: p.groups.length, pooled: p.pooled ? p.pooled.count : 0, profiled: p.profiled, altered: p.altered })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: (unit === "patient" ? "Patients" : "Samples") + " altered in at least one of " + (genes.length === 1 ? genes[0] : genes.length + " genes") + " per " + groupWord + " group, over the " + unit + "s profiled for at least one of them" +
      " (the union of their panels, as an oncoprint's merged row counts it). " +
      (measure === "driver" ? "Only OncoKB drivers (" + pin + ") count. " : "Any mutation, high-level copy-number change (amplification, deep deletion) or structural variant counts; low-level gains and losses do not. ") +
      "A " + unit + " with more than one kind of alteration across the genes counts once, under \"multiple\". " +
      (unit === "patient" ? "A patient counts in every group one of their samples falls in, profiled if any of those samples is, altered if any is. " : "Samples are counted, not patients: a patient with two samples counts twice. ") +
      (attribute ? attribute + " is read per sample and folded on case and whitespace; samples with no value form their own group. " : "") +
      "Groups with fewer than " + plural(minSamples, "profiled " + unit) + " are pooled into one bar rather than dropped. " +
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
  const byMask = new Map<number, number>(), samplesByMask = new Map<number, number>();
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
      samplesByMask.set(global, (samplesByMask.get(global) || 0) + Number(r.samples || 0));
      patients += n;
    }
    perSite.push({ study: st, cohorts: here, patients });
  }));
  const intersections = [...byMask].filter(([m]) => m > 0)
    .map(([m, n]) => ({ members: vNames.filter((_, i) => m & (1 << i)), n, samples: samplesByMask.get(m) || 0 }))
    .sort((a, b) => b.n - a.n || a.members.length - b.members.length);
  const union = intersections.reduce((a, x) => a + x.n, 0);
  const sets = vNames.map((n) => {
    const mine = intersections.filter((x) => x.members.includes(n));
    return { name: n, size: mine.reduce((a, x) => a + x.n, 0), samples: mine.reduce((a, x) => a + x.samples, 0) };
  });
  const mismatch = sets.filter((s) => s.size !== cohorts[s.name].count && !excluded.some((e) => cohorts[s.name].studies.includes(e.study)));
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "overlap", cohorts: vNames,
    overlap: { sets, intersections, union, ...(excluded.length ? { excluded } : {}) },
    method: overlapMethod({ cohorts: vNames, perSite, union, intersections: intersections.length }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Patients in exactly the marked cohorts and none of the others, for every combination that has any — computed inside each study's database, which returns one count per combination. " +
      (vNames.length <= 3 ? "A cohort is a set of patients, so each patient's samples go wherever the patient does: the samples diagram counts the same patterns in samples. " : "") +
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
  const bands = await cytobands(ok, rows.map((g) => g.gene));
  for (const g of rows) { const b = bands.get(g.gene); if (b) g.cytoband = b; }
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

// ---------------------------------------------------------------------------
// correlates: one gene's expression against every gene's

const CORR_SHOW_MAX = 250;

async function correlatesView(view: CorrelatesView, ctx: ViewCtx): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length !== 1) return refuse("correlates", ctx, "a correlates view reads one cohort; this one draws " + vNames.length + " — name one in cohorts");
  const cn = vNames[0];
  const [gene] = geneSymbols([view.gene]);
  if (!gene) return refuse("correlates", ctx, "gene names the query gene, e.g. ESR1");
  const pt = String(view.profileType || ""), other = String(view.otherProfile || pt);
  if (!PROFILE_NAME.test(pt) || !PROFILE_NAME.test(other)) return refuse("correlates", ctx, "profileType names a continuous molecular profile, e.g. rna_seq_v2_mrna");
  const show = view.show == null ? 100 : Math.floor(Number(view.show));
  if (!(show >= 1 && show <= CORR_SHOW_MAX)) return refuse("correlates", ctx, "show is 1 to " + CORR_SHOW_MAX + " genes in each direction");
  const minN = view.minN == null ? 10 : Math.floor(Number(view.minN));
  if (!(minN >= 4 && minN <= 100000)) return refuse("correlates", ctx, "minN is 4 to 100000");
  if (!cohorts[cn].count) return refuse("correlates", ctx, "nothing to correlate: cohort “" + cn + "” is empty");

  const { ok, excluded } = answering(ctx);
  const inventory = await Promise.all(cohorts[cn].studies.filter((st) => ok[st]).map(async (st) => ({ st, profiles: (await ctx.studyProfiles(st)).profiles })));
  const holders = inventory.filter((x) => x.profiles.includes(pt) && x.profiles.includes(other)).map((x) => x.st);
  for (const x of inventory) if (!holders.includes(x.st)) excluded.push({ study: x.st, reason: "has no " + [pt, other].filter((p, i, a) => a.indexOf(p) === i && !x.profiles.includes(p)).join(" or ") + " profile" });
  if (!holders.length) {
    const avail = [...new Set(inventory.flatMap((x) => x.profiles))].filter((p) => p !== "cna").sort();
    return refuse("correlates", ctx, "no study in “" + cn + "” has “" + (pt === other ? pt : pt + "” and “" + other) + "” — " + (avail.length ? "available: " + avail.join(", ") : "these studies have no molecular profiles"));
  }
  type Sums = { n: number; sx: number; sy: number; sxy: number; sxx: number; syy: number };
  const zero = (): Sums => ({ n: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });
  const pooled = new Map<string, Sums>();
  const perStudy = new Map<string, { study: string; m: Sums; rk: Sums }[]>();
  const rows: { study: string; gene: string; m: Sums; rk: Sums }[] = [];
  await Promise.all(holders.map(async (st) => {
    const out = await ok[st].moreAggregate("correlates:moments", doc.cohorts[cn], (c, s, d) => correlatesMomentsSql(c, s, d, gene, pt, other));
    for (const r of out) {
      const g = String(r.gene);
      const m = { n: Number(r.n), sx: Number(r.sx), sy: Number(r.sy), sxy: Number(r.sxy), sxx: Number(r.sxx), syy: Number(r.syy) };
      const rk = { n: Number(r.n), sx: Number(r.rsx), sy: Number(r.rsy), sxy: Number(r.rsxy), sxx: Number(r.rsxx), syy: Number(r.rsyy) };
      rows.push({ study: st, gene: g, m, rk });
      const t = pooled.get(g) || zero();
      for (const k of Object.keys(t) as (keyof Sums)[]) t[k] += m[k];
      pooled.set(g, t);
      perStudy.set(g, [...(perStudy.get(g) || []), { study: st, m, rk }]);
    }
  }));
  if (!pooled.size) return refuse("correlates", ctx, "no patient in “" + cn + "” has a value for " + gene + " on “" + pt + "”" + (excluded.length ? " in the studies that hold it" : ""));
  const multi = holders.length > 1;
  const tested: CorrelatesGene[] = [];
  let untested = 0;
  for (const [g, m] of pooled) {
    if (g === gene && pt === other) continue;   // a gene against itself is 1 by construction
    const pr = pearsonFromMoments(m);
    let rho: number | null, rhoP: number;
    if (multi) { const meta = fisherZMeta(perStudy.get(g)!.map((x) => ({ r: pearsonR(x.rk), n: x.rk.n }))); rho = meta.r; rhoP = meta.p; }
    else { const sp = pearsonFromMoments(perStudy.get(g)![0].rk); rho = sp.r; rhoP = sp.p; }
    if (m.n < minN || rho == null || pr.r == null) { untested++; continue; }
    tested.push({ gene: g, n: m.n, rho, rhoP, q: 1, r: pr.r, p: pr.p });
  }
  if (!tested.length) return refuse("correlates", ctx, "no gene had at least " + minN + " patients with a value for both it and " + gene + ", and any spread");
  benjaminiHochberg(tested.map((g) => g.rhoP)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => b.rho! - a.rho! || a.gene.localeCompare(b.gene));
  const positive = tested.filter((g) => g.rho! > 0).slice(0, show);
  const negative = tested.filter((g) => g.rho! < 0).reverse().slice(0, show);
  const bands = await cytobands(ok, [...positive, ...negative].map((g) => g.gene));
  for (const g of [...positive, ...negative]) { const b = bands.get(g.gene); if (b) g.cytoband = b; }
  const bins = new Map<number, number>();
  for (const g of tested) { const b = Math.min(39, Math.floor((g.rho! + 1) / 0.05)); bins.set(b, (bins.get(b) || 0) + 1); }
  const histogram = Array.from({ length: 40 }, (_, b) => [Math.round((-1 + b * 0.05) * 100) / 100, bins.get(b) || 0] as [number, number]);
  const significant = tested.filter((g) => g.q < 0.05).length;
  const reported = [...positive, ...negative];
  return {
    kind: "correlates", cohorts: [cn],
    correlates: { gene, profileType: pt, otherProfile: other, cohort: cn, tested: tested.length, untested, significant, minN, rhoFrom: multi ? "meta" : "rank",
      positive, negative, histogram, ...(excluded.length ? { excluded } : {}) },
    method: correlatesMethod({ gene, profileType: pt, otherProfile: other, cohort: cn, minN, multi, tested: tested.length, untested,
      perSite: holders.map((st) => ({ study: st, genes: rows.filter((r) => r.study === st).length, patients: cohorts[cn].perStudy[st]?.count || 0 })),
      sums: rows.map((r) => ({ study: r.study, gene: r.gene, ...r.m, rsx: r.rk.sx, rsy: r.rk.sy, rsxy: r.rk.sxy, rsxx: r.rk.sxx, rsyy: r.rk.syy })),
      results: reported.map((g) => ({ gene: g.gene, rho: g.rho!, rhoP: g.rhoP, q: g.q, r: g.r!, p: g.p })) }),
    participation: ctx.participationFor(cohorts[cn].studies, false),
    ...(cohorts[cn].studies.length > 1 ? { studies: cohorts[cn].studies } : {}),
    caveat: gene + " on “" + pt + "” against every gene on “" + other + "”, over the patients in “" + cn + "” with both values (a patient's samples averaged, as the heatmap takes them). " +
      "Ranked by Spearman's ρ, as the portal ranks, with Pearson's r beside it; q is Benjamini–Hochberg over ρ's p across all " + tested.length.toLocaleString("en-US") + " genes tested. " +
      (multi ? "Pearson's r pools every study's sums (exact); ρ is each study's own, combined by Fisher z weighted by size, since ranks do not add across studies. " : "") +
      "A correlation is not a regulatory link: genes that rise together across a cohort often both track a third thing — a subtype, the tumour's purity, proliferation. " +
      untested.toLocaleString("en-US") + " genes were not tested: fewer than " + minN + " patients with both values, or no spread." +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

// ---------------------------------------------------------------------------
// table views: the clinical table and the mutation table, on lib/table-query.ts

const TABLE_ROWS_MAX = 1000;
/** rows one page request may take (the download's chunk) */
export const TABLE_CHUNK = 10000;

/** Who may hand over rows: patient-level participants; the rest are named with their patients. */
function rowHolders(ctx: ViewCtx) {
  const holders = ctx.vStudies.filter((st) => isPatientLevel(ctx.resolvers[st]));
  const excluded = ctx.vStudies.filter((st) => !holders.includes(st)).map((st) => ({
    study: st, reason: ctx.resolvers[st].instance.id === "peer" ? "a remote peer, which does not disclose patients" : "aggregate-only: it does not disclose patients",
    patients: ctx.vNames.reduce((n, c) => n + (ctx.cohorts[c].perStudy[st]?.count || 0), 0) }));
  return { holders, excluded };
}

/** The column ids a query reads besides what is shown: its filters, its sort, and — for search — the shown ones. */
function queryReads(q: TableQuery, shown: string[]): string[] {
  return [...new Set([...Object.keys(q.filters || {}), ...(q.sort ? [q.sort.column] : []), ...((q.search || "").trim() ? shown : [])])];
}

type Rows = { rows: Record<string, unknown>[]; lists: { cohort: string; study: string; total: number; all: number }[]; total: number; all: number; offset: number; groups: number; values?: ColumnValues };

/**
 * A table view's rows: its parts grouped per database instance (a group's parts are combined and
 * sorted together in its database), counted, and the page asked for taken walking the groups in
 * order — one group, one query. With RunOpts.values, a column's values instead of rows.
 * `source(parts, reads)` builds the table's row source; `reads` names the columns a query needs
 * ("all" for a page), so a count need not carry every column.
 */
async function runRows(ctx: ViewCtx, label: string, holders: string[], q: TableQuery, defaults: string[], shown: string[], size: number,
  source: (parts: TablePart[], reads: string[] | "all") => (db: string) => RowSource, values?: { column: string; numeric: boolean }): Promise<Rows> {
  type PL = Pick<PatientLevelCapable, "rowsPage" | "rowsCounts" | "rowsValues">;
  const groups: { resolver: PL; parts: TablePart[]; total: number }[] = [];
  const byConn = new Map<string, number>();
  for (const cn of ctx.vNames) for (const st of ctx.cohorts[cn].studies.filter((x) => holders.includes(x))) {
    const r = ctx.resolvers[st], k = r.instance.conn.id;
    if (!byConn.has(k)) { byConn.set(k, groups.length); groups.push({ resolver: r as unknown as PL, parts: [], total: 0 }); }
    groups[byConn.get(k)!].parts.push({ cohort: cn, study: st, cohortSql: r.cohortSql(ctx.doc.cohorts[cn]) });
  }
  const reads = queryReads(q, shown);
  if (values) {
    const got = await Promise.all(groups.map((g) => g.resolver.rowsValues(label + ":values", source(g.parts, [...reads, values.column]), q, defaults, values.column)));
    return { rows: [], lists: [], total: 0, all: 0, offset: 0, groups: groups.length, values: mergeValues(values.column, values.numeric, got as Record<string, unknown>[][]) };
  }
  const lists: Rows["lists"] = [];
  let all = 0;
  await Promise.all(groups.map(async (g) => {
    const counts = await g.resolver.rowsCounts(label + ":counts", source(g.parts, reads), q, defaults);
    for (const p of g.parts) {
      const c = counts.find((x) => x.cohort === p.cohort && x.study === p.study);
      lists.push({ cohort: p.cohort, study: p.study, total: c?.n || 0, all: c?.all || 0 });
      g.total += c?.n || 0; all += c?.all || 0;
    }
  }));
  const total = groups.reduce((n, g) => n + g.total, 0);
  const want = ctx.page ? { offset: Math.max(0, Math.floor(ctx.page.offset)), limit: Math.min(TABLE_CHUNK, Math.max(1, Math.floor(ctx.page.limit))) } : { offset: 0, limit: size };
  const rows: Record<string, unknown>[] = [];
  let skip = want.offset;
  for (const g of groups) {
    if (rows.length >= want.limit) break;
    if (skip >= g.total) { skip -= g.total; continue; }
    const page = await g.resolver.rowsPage(label + ":rows", source(g.parts, "all"), q, defaults, want.limit - rows.length, skip);
    rows.push(...page.rows); skip = 0;
  }
  const order = (l: { cohort: string; study: string }) => ctx.vNames.indexOf(l.cohort) * 1000 + ctx.vStudies.indexOf(l.study);
  lists.sort((a, b) => order(a) - order(b));
  return { rows, lists, total, all, offset: want.offset, groups: groups.length };
}

/** A view's query as the document gives it, with an older `sort.attribute` read as `sort.column`. */
function viewQuery(view: TableQuery & { attributes?: string[]; sort?: { column?: string; attribute?: string; desc?: boolean } }): TableQuery {
  const s = view.sort as { column?: string; attribute?: string; desc?: boolean } | undefined;
  const column = s ? s.column || s.attribute : undefined;
  return cleanQuery({
    columns: view.columns || view.attributes,
    search: view.search,
    filters: view.filters,
    sort: column ? { column: String(column), ...(s!.desc ? { desc: true } : {}) } : undefined,
  });
}

/** The words every table view's caveat ends with: the order, the query, the paging, the databases, who is left out. */
function tableTail(r: Rows, q: TableQuery, cols: { id: string; name: string }[], what: string, defaultOrder: string, excluded: { study: string; reason: string; patients: number }[], multiCohort: boolean): string {
  const sortCol = q.sort ? cols.find((c) => c.id === q.sort!.column) : null;
  const filtered = describeQuery(q, cols);
  return (filtered ? "Showing " + r.total.toLocaleString("en-US") + " of " + plural(r.all, what) + ": " + filtered + ". " : plural(r.total, what) + ". ") +
    "Sorted " + (sortCol ? "by " + sortCol.name + (q.sort!.desc ? " (highest first)" : "") + ", missing values last," : defaultOrder) +
    " across " + (r.lists.length > 1 ? "every cohort and study together" : "the cohort") + "; every page is a slice of that one order, and the download holds every row kept, with every column. " +
    (r.groups > 1 ? "These studies live in " + r.groups + " separate databases, so each database's rows are sorted together and listed in turn. " : "") +
    (multiCohort ? "A patient in two cohorts is listed under each. " : "") +
    (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + "; " + plural(e.patients, "patient") + " in these cohorts)").join(", ") + "." : "");
}

async function tableView(view: TableView, ctx: ViewCtx): Promise<ViewResult> {
  const { vNames } = ctx;
  { const e = ctx.overLimit("a table view", 6, vNames.length); if (e) return refuse("table", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  const unit: "sample" | "patient" = view.unit === "patient" ? "patient" : "sample";
  const show = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(show >= 1 && show <= TABLE_ROWS_MAX)) return refuse("table", ctx, "rows (the page size) is 1 to " + TABLE_ROWS_MAX);
  const q = viewQuery(view);
  if (q.columns && q.columns.some((a) => typeof a !== "string" || !ATTR_NAME.test(a) && !["patient", "sample", "samples"].includes(a)))
    return refuse("table", ctx, "columns is a list of column ids: patient, " + (unit === "sample" ? "sample" : "samples") + " and clinical attribute ids, e.g. [\"patient\", \"CANCER_TYPE\", \"AGE\"]");

  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return refuse("table", ctx, "no study here may disclose patients' rows (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");

  const all: TableColumn[] = [];
  for (const st of holders) {
    for (const m of await (ctx.resolvers[st] as MoreResolver).moreMeta("table:attributes", tableAttributesSql)) {
      if (all.some((c) => c.id === m.id)) continue;
      all.push({ id: String(m.id), name: String(m.name || m.id), per: Number(m.patient) === 1 ? "patient" : "sample", numeric: String(m.datatype).toUpperCase() === "NUMBER" });
    }
  }
  const usable = unit === "patient" ? all.filter((c) => c.per === "patient") : all;
  const ids = idColumns(unit);
  const known = [...ids, ...usable];
  const bad = checkQuery(q, known);
  if (bad) {
    const sampleAttr = unit === "patient" && [...(q.columns || []), ...Object.keys(q.filters || {}), ...(q.sort ? [q.sort.column] : [])].find((a) => all.some((c) => c.id === a && c.per === "sample"));
    return refuse("table", ctx, sampleAttr ? sampleAttr + " is a sample attribute; a per-patient table holds patient attributes only" : bad);
  }
  // the attributes the table holds: every one, unless the studies record more than a table carries
  const named = new Set([...(q.columns || []), ...Object.keys(q.filters || {}), ...(q.sort ? [q.sort.column] : [])]);
  const held = usable.length <= TABLE_COLUMNS_MAX ? usable
    : [...usable.filter((c) => named.has(c.id)), ...usable.filter((c) => !named.has(c.id))].slice(0, TABLE_COLUMNS_MAX);
  const defaults = [...ids.map((c) => c.id), ...held.map((c) => c.id)];

  let r: Rows;
  try {
    r = await runRows(ctx, "table", holders, q, defaults, shownColumns(q, known, defaults), show,
      (parts, reads) => (db) => clinicalRowSource(parts, db, unit, reads === "all" ? held : held.filter((c) => reads.includes(c.id))),
      ctx.values ? { column: ctx.values, numeric: !!known.find((c) => c.id === ctx.values)?.numeric } : undefined);
  } catch (e) { return refuse("table", ctx, (e as Error).message); }
  const columns = [...ids.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric })), ...held.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }))];
  const shown = shownColumns(q, columns, defaults);
  const rows = r.rows.map((x) => {
    const m = (x.m || {}) as Record<string, string>;
    const own: Record<string, string> = { patient: String(x.patient ?? ""), sample: String(x.sample ?? ""), samples: String(x.samples ?? "") };
    return { cohort: String(x.cohort), study: String(x.study), patient: own.patient, sample: own.sample, values: columns.map((c) => c.id in own && ids.some((i) => i.id === c.id) ? own[c.id] : m[c.id] ?? "") };
  });
  const table = { unit, columns, shown, defaults, query: q, rows, offset: r.offset, pageSize: show, lists: r.lists, total: r.total, all: r.all,
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) };
  if (ctx.page || ctx.values) return { kind: "table", cohorts: vNames, table, participation: ctx.participationFor(ctx.vStudies, true) };
  const one = unit === "sample" ? "sample" : "patient";
  return {
    kind: "table", cohorts: vNames,
    table,
    method: tableMethod({ unit, cohorts: vNames, columns: held.length, query: q, queryText: describeQuery(q, columns), sortName: q.sort ? columns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null,
      shown: rows.length, lists: r.lists, excluded, instances: r.groups }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "One row per " + one + (unit === "sample" ? " of each cohort's patients, carrying its patient's attributes too" : "") +
      ", with " + plural(held.length, "attribute") + " as each study recorded them" + (held.length < usable.length ? " (of " + usable.length + "; name others in columns)" : "") +
      " — vocabularies are not harmonized across studies. " +
      tableTail(r, q, columns, one, "by patient and sample id", excluded, vNames.length > 1)
  };
}

/** A row's value in a column, from the query's row (numbers as numbers, the annotation spelled out as the SQL spells it). */
function mutationValue(r: Record<string, unknown>, id: string): string | number | null {
  const num = (x: unknown) => x == null || x === "" ? null : Number(x);
  switch (id) {
    case "sample": return String(r.sid ?? "");
    case "annotation": {
      const o = String(r.oncogenicity || ""), lv = String(r.level || "");
      return o ? o + (lv ? " · " + lv.replace(/^LEVEL_/, "Level ") : "") : "";
    }
    case "vaf": return r.vaf == null ? null : Math.round(Number(r.vaf) * 1000) / 1000;
    case "altCount": case "refCount": case "mutCount": case "start": case "end": return num(r[id]);
    default: return r[id] == null ? "" : String(r[id]);
  }
}

async function mutationsView(view: MutationsView, ctx: ViewCtx): Promise<ViewResult> {
  const { vNames, pin } = ctx;
  { const e = ctx.overLimit("a mutations view", 6, vNames.length); if (e) return refuse("mutations", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  let gene: string;
  try { [gene] = geneSymbols([view.gene]); } catch (e) { return refuse("mutations", ctx, (e as Error).message); }
  if (!gene) return refuse("mutations", ctx, "a mutations view needs a gene, e.g. KRAS");
  const size = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(size >= 1 && size <= TABLE_ROWS_MAX)) return refuse("mutations", ctx, "rows (the page size) is 1 to " + TABLE_ROWS_MAX);
  const q = viewQuery(view);
  const bad = checkQuery(q, MUTATION_COLUMNS);
  if (bad) return refuse("mutations", ctx, bad);

  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return refuse("mutations", ctx, "no study here may disclose patients' mutations (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  let r: Rows;
  try {
    r = await runRows(ctx, "mutations", holders, q, MUTATION_DEFAULT_COLUMNS, shownColumns(q, MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS), size, (parts) => (db) => mutationRowSource(parts, db, gene, pin),
      ctx.values ? { column: ctx.values, numeric: !!MUTATION_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined);
  } catch (e) { return refuse("mutations", ctx, (e as Error).message); }
  const rows = r.rows.map((x) => ({ cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? ""),
    values: MUTATION_COLUMNS.map((c) => mutationValue(x, c.id)) }));
  const shown = shownColumns(q, MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS);
  const mutations = { gene, columns: MUTATION_COLUMNS, shown, defaults: MUTATION_DEFAULT_COLUMNS, query: q, rows, offset: r.offset, pageSize: size, lists: r.lists, total: r.total, all: r.all, oncokbPin: pin,
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) };
  if (ctx.page || ctx.values) return { kind: "mutations", cohorts: vNames, mutations, participation: ctx.participationFor(ctx.vStudies, true) };
  return {
    kind: "mutations", cohorts: vNames, mutations,
    method: mutationsMethod({ gene, cohorts: vNames, oncokbPin: pin, queryText: describeQuery(q, MUTATION_COLUMNS),
      sortName: q.sort ? MUTATION_COLUMNS.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null, desc: !!q.sort?.desc,
      shown: rows.length, lists: r.lists, excluded, instances: r.groups }),
    participation: ctx.participationFor(ctx.vStudies, true),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Every " + gene + " mutation call in " + (vNames.length > 1 ? "each cohort's" : "the cohort's") + " samples, one row per call; uncalled mutations are left out, as the portal leaves them out. " +
      (pin ? "Annotation is OncoKB " + pin + " (oncogenicity and its highest sensitivity level for the gene). " : "No OncoKB version is pinned here, so the annotation column is empty. ") +
      "Allele frequency is variant reads over variant + reference reads; # Mut in Sample is the study's own MUTATION_COUNT, blank where it records none. " +
      tableTail(r, q, MUTATION_COLUMNS, "mutation", "drivers first, then by codon", excluded, vNames.length > 1)
  };
}
