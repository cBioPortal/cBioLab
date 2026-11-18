/**
 * Live check: the plot's statistics as SQL, run in ClickHouse on values written here, against
 * answers written down by hand from the reference each follows.
 *
 *   B*  lib/plot.ts plotBoxSql — the box's quartiles and median by cbioportal.org's rule
 *       (cbioportal-frontend cd8c6df src/shared/lib/boxPlotUtils.ts calculateBoxPlotModel:
 *       jStat.quartiles, q1 = sorted[round(n/4) − 1], q3 = sorted[round(3n/4) − 1], Math.round
 *       halves up, no interpolation; jStat.median, the mean of the two middle values for even n;
 *       docs/legacy-spec/04-plots.md PLT-STM-8). A group of one has no quartiles there; here q1 =
 *       median = q3 = its value, and the figure draws no box.
 *   S*  lib/plot.ts plotStatsSql — Spearman's ρ with tied values sharing their average rank
 *       (PLT-STM-5), against scipy 1.18.1 spearmanr, and its independence of row order.
 *   K*, M*, N*  colouring a plot by one gene (PLT-CL-8, PLT-STM-14…17), the case table
 *       cases-gene-colour.md, from cbioportal-frontend cd8c6df: K1–K12 lib/plot.ts oncoprintClassSql,
 *       the oncoprint's mutation class (src/shared/components/oncoprint/DataUtils.ts:102-122
 *       getOncoprintMutationType, src/shared/lib/oql/AccessorsForOqlFilter.ts:44-104
 *       getSimplifiedMutationType), on literal rows; M1/M2 axisSelect `by: "topMutationType"` and N1/N2
 *       `by: "copyNumberSv"` over every sample of coadread_tcga_pan_can_atlas_2018
 *       (src/shared/components/plots/PlotsTabUtils.tsx:2963-2996, 2072-2088, 2210-2258), against
 *       cbioportal.org's counts and, for the structural-variant and not-profiled counts, this
 *       script's own reading of the warehouse.
 *   L*  lib/plot.ts axisSelect — a categorical axis's labels as the portal writes them, counted
 *       over every sample of coadread_tcga_pan_can_atlas_2018 (docs/legacy-spec/04-plots.md §3:
 *       PLT-DT-3 Mutation Type, DT-4 Mutated vs Wild-type, DT-9 Variant vs No Variant, DT-11
 *       discrete copy number; cbioportal-frontend cd8c6df PlotsTabUtils.tsx; counts from
 *       docs/legacy-spec/parity/04-plots.md §3 Q6). L5/L6 are the cox and logistic covariates'
 *       labels (`labels: "model"`), which keep cBioLab's own ("Not mutated", "Structural variant").
 *       L1 KRAS mutation type: ⊆ {Missense, Inframe, Truncating, Splice, Promoter, Other,
 *          Multiple, No mutation, Not profiled}, has "No mutation", no "Not mutated"
 *       L2 KRAS mutated: {Mutated, No mutation, Not profiled}
 *       L3 TCF7L2 SV: ⊆ {With Structural Variants, No Structural Variants, Not profiled for
 *          structural variants}; With Structural Variants = 4
 *       L4 KRAS gistic: Deep Deletion 1, Shallow Deletion 67, Diploid 390, Gain 128, Amplification 6
 *       L5 L2 with labels "model": {Mutated, Not mutated, Not profiled}
 *       L6 L3 with labels "model": ⊆ {Structural variant, No structural variant, Not profiled}
 *       L7 the resolver's coxRows reads a covariate with those labels: KRAS mutated has "Not mutated", not "No mutation"
 *   C*  lib/plot.ts plotScatterPointsSql — a scatter's points coloured and ringed (PLT-CL-8,
 *       PLT-SC-6; cbioportal-frontend cd8c6df PlotsTabUtils.tsx:1877-2397), rows C1–C3 of the case
 *       table for colouring a scatter's points: over coadread_tcga_pan_can_atlas_2018, every sample,
 *       x AGE, y FRACTION_GENOME_ALTERED, each row carries `c` / `r`, the case's category from the
 *       colorSel / ringSel given ("" where it has none), counted against a separate query joining the
 *       axis selects.
 *   T*  lib/federation.ts plotAxisKinds / plot (its clinicalMetaSql) and, T11, lib/clinical-titles.ts titledAxes — an axis's title as the portal writes it (PLT-DT-19;
 *       cbioportal-frontend cd8c6df PlotsTabUtils.tsx getAxisLabel): a clinical attribute by its
 *       display name, " (log2(value + 1))" after it on a log scale, and the colour axis likewise.
 *       Read against the warehouse's coadread_tcga_pan_can_atlas_2018, all samples; the names are
 *       cbioportal.org's for that study (REST clinical-attributes). Case table rows T7–T10.
 *   F*  a box plot's Filter categories and Sort Categories by Median (PLT-AX-9, PLT-AX-10, PLT-STM-9;
 *       cbioportal-frontend cd8c6df PlotsTab.tsx:5396-5420): F1 lib/plot.ts keptCategoriesSql on
 *       literal rows; F2–F5 the filter in the plot's request (plotSelects), over
 *       coadread_tcga_pan_can_atlas_2018 FGA by Cancer Type Detailed, every sample (scorecard
 *       docs/legacy-spec/parity/04-plots.md Q5: Colon 370 · Mucinous 58 · Rectal 155, medians
 *       0.2268 · 0.1140 · 0.2973 on cbioportal.org):
 *       F2 kept Colon and Rectal: those two boxes alone, each the unfiltered plot's own; F3 the
 *       coverage is the unfiltered plot's; F4 the case-level queries (points, outliers, ranked)
 *       return only the kept categories' cases; F5 the view sorted by median: Mucinous, Colon, Rectal.
 *
 * Run: node --env-file=.env.local scripts/check-plot-stats.ts
 */
import { chQuery, DB } from "../lib/ch.ts";
import { axisSelect, keptCategoriesSql, oncoprintClassSql, plotBoxSql, plotScatterPointsSql, plotStatsSql, type AxisCtx, type PlotAxis, type PlotRequest } from "../lib/plot.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { sq } from "../lib/compiler.ts";
import { OQL_NOT_PROFILED } from "../lib/plot-oql.ts";
import { resolverFor, hasFederatedPlot, plotCasesOf } from "../lib/federation.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { titledAxes } from "../lib/clinical-titles.ts";
import { runAnalysis } from "../lib/analysis.ts";
import { oncokbPin } from "../lib/annotation.ts";

/** [row id, values, expected q1, median, q3, lo, hi] */
type BoxCase = [string, number[], number, number, number, number, number];
const BOXES: BoxCase[] = [
  ["B1 n = 1: no quartiles in the portal; the value itself here", [468.29], 468.29, 468.29, 468.29, 468.29, 468.29],
  ["B2 n = 2: round(0.5) = 1, round(1.5) = 2", [3, 1], 1, 2, 3, 1, 3],
  ["B3 n = 3: round(0.75) = 1, round(2.25) = 2 (q3 is the median)", [5, 1, 3], 1, 3, 3, 1, 5],
  ["B4 n = 4: round(1) = 1, round(3) = 3; median the mean of the middle two", [4, 1, 3, 2], 1, 2.5, 3, 1, 4],
  ["B5 n = 6: round(1.5) = 2, round(4.5) = 5 (halves up)", [60, 10, 50, 20, 40, 30], 20, 35, 50, 10, 60],
  ["B6 n = 7: round(1.75) = 2, round(5.25) = 5", [7, 6, 5, 4, 3, 2, 1], 2, 4, 5, 1, 7],
  ["B7 n = 10: round(2.5) = 3, round(7.5) = 8 (halves up)", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 3, 5.5, 8, 1, 10],
  ["B8 ties: 1 1 5 5 5 9 9 9", [5, 5, 5, 1, 1, 9, 9, 9], 1, 5, 9, 1, 9],
  ["B9 negative values", [-2.5, -1, 0, 4], -2.5, -0.5, 0, -2.5, 4],
];

/** [row id, x, y, expected ρ] — scipy.stats.spearmanr */
type RankCase = [string, number[], number[], number];
const RANKS: RankCase[] = [
  ["S1 ties on both axes", [1, 2, 2, 3, 4, 4, 4, 7], [2, 1, 3, 3, 5, 0, 5, 9], 0.5777400584843706],
  ["S2 the same pairs in the reverse order", [7, 4, 4, 4, 3, 2, 2, 1], [9, 5, 0, 5, 3, 3, 1, 2], 0.5777400584843706],
];

let failures = 0, checks = 0;
const ok = (pass: boolean, what: string, detail: string) => {
  checks++; if (!pass) failures++;
  console.log((pass ? "PASS " : "FAIL ") + what + "  [" + detail + "]");
};
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
const lit = (v: number) => (Number.isFinite(v) ? String(v) : "NULL");

{
  const rows = BOXES.flatMap(([, vs], i) => vs.map((v, j) => "('B" + i + "-" + j + "', 'g" + i + "', " + lit(v) + ")"));
  const vals = "SELECT * FROM values('id String, g String, v Float64', " + rows.join(", ") + ")";
  const sql = plotBoxSql("SELECT id, v FROM (" + vals + ")", "SELECT id, g AS v FROM (" + vals + ")", "SELECT 1");
  const got = new Map((await chQuery<Record<string, unknown>>(sql)).data.map((r) => [String(r.g), r]));
  BOXES.forEach(([id, vs, q1, med, q3, lo, hi], i) => {
    const r = got.get("g" + i);
    const q = r ? (r.q as unknown[]).map(Number) : [];
    const have = r ? [Number(r.n), q[0], q[1], q[2], Number(r.lo), Number(r.hi)] : [];
    const want = [vs.length, q1, med, q3, lo, hi];
    ok(!!r && want.every((w, k) => close(have[k], w)), id, "n q1 median q3 lo hi: " + have.join(" ") + (r ? "" : "(no row)") + " — expected " + want.join(" "));
  });
}

for (const [id, x, y, rho] of RANKS) {
  const vals = (a: number[]) => "SELECT * FROM values('id String, v Float64', " + a.map((v, i) => "('c" + i + "', " + lit(v) + ")").join(", ") + ")";
  const sql = plotStatsSql(vals(x), vals(y), "SELECT 1");
  const r = (await chQuery<Record<string, unknown>>(sql)).data[0] || {};
  ok(close(Number(r.spearman), rho), id, "ρ " + r.spearman + " — expected " + rho);
}


// ---- colouring by a gene (cases-gene-colour.md) ---------------------------

/** [row id, mutation type, protein change, expected class] — getOncoprintMutationType */
const CLASSES: [string, string, string, string][] = [
  ["K1", "Missense_Mutation", "", "Missense"],
  ["K2", "Splice_Region", "", "Splice"],
  ["K3", "In_Frame_Ins", "", "Inframe"],
  ["K4", "indel", "", "Inframe"],
  ["K5", "Nonframeshift_Insertion", "", "Inframe"],
  ["K6", "Frame_Shift_Del", "", "Truncating"],
  ["K7", "Nonsense_Mutation", "", "Truncating"],
  ["K8", "Translation_Start_Site", "", "Truncating"],
  ["K9", "Nonstop_Mutation", "", "Truncating"],
  ["K10", "5'Flank", "", "Other"],
  ["K11", "5'Flank", "Promoter", "Promoter"],
  ["K12", "Silent", "", "Other"],
];
{
  try {
    const rows = CLASSES.map(([id, mt, pc]) => "(" + sq(id) + ", " + sq(mt) + ", " + sq(pc) + ")").join(", ");
    const sql = "SELECT id, " + oncoprintClassSql("mt", "pc") + " AS c FROM values('id String, mt String, pc String', " + rows + ")";
    const got = new Map((await chQuery<{ id: string; c: string }>(sql)).data.map((r) => [r.id, r.c]));
    for (const [id, mt, pc, want] of CLASSES) ok(got.get(id) === want, id + " oncoprintClassSql(" + mt + ", '" + pc + "')", "got " + got.get(id) + " — expected " + want);
  } catch (e) {
    for (const [id, , , want] of CLASSES) ok(false, id + " oncoprintClassSql", "threw: " + String((e as Error).message).slice(0, 200) + " — expected " + want);
  }
}

const COAD = "coadread_tcga_pan_can_atlas_2018";
const cohortSql = compileCohortDef({ all: [] } as never, { study: COAD, db: DB });
const show = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => l + " " + n).join(", ");
/** every coadread sample's label on one axis, counted */
async function labelCounts(a: PlotAxis, pin: string | null = null): Promise<Map<string, number>> {
  const sel = axisSelect(a, { study: COAD, db: DB, unit: "sample", cohortSql, oncokbPin: pin }, "cat");
  const sql = "WITH cohort AS (" + cohortSql + ")\nSELECT v, count() AS n FROM (" + sel + ") GROUP BY v";
  return new Map((await chQuery<{ v: string; n: string }>(sql)).data.map((r) => [String(r.v), Number(r.n)]));
}
/** [row id, expected label counts]: compares every label, the expected ones and any other */
const sameCounts = (id: string, got: Map<string, number>, want: Record<string, number>) => {
  const labels = new Set([...got.keys(), ...Object.keys(want)]);
  const bad = [...labels].filter((l) => (got.get(l) ?? 0) !== (want[l] ?? 0));
  ok(!bad.length, id, "got " + show(got) + " — expected " + Object.entries(want).map(([l, n]) => l + " " + n).join(", ") +
    (bad.length ? " (differs: " + bad.join(", ") + ")" : ""));
};
const guarded = async (id: string, f: () => Promise<void>) => {
  try { await f(); } catch (e) { ok(false, id, "threw: " + String((e as Error).message).slice(0, 300)); }
};

await guarded("M1 KRAS topMutationType, coadread, no drivers", async () => {
  const got = await labelCounts({ source: "alteration", gene: "KRAS", by: "topMutationType" } as never);
  sameCounts("M1 KRAS topMutationType, coadread, no drivers", got,
    { Missense: 216, Truncating: 1, Inframe: 1, "Not mutated": 316, "Not profiled for mutations": 60 });
});

await guarded("M2 KRAS topMutationType, coadread, with drivers", async () => {
  // the study's own driver calls when it has any; else OncoKB at the store's pin; else nothing to call drivers with
  const own = Number((await chQuery<{ n: string }>("SELECT count() AS n FROM " + DB + ".genomic_event_derived WHERE cancer_study_identifier = " + sq(COAD) +
    " AND variant_type = 'mutation' AND (driver_filter != '' OR driver_tiers_filter != '')")).data[0]?.n || 0);
  const pin = own ? null : await oncokbPin();
  if (!own && !pin) {
    console.log("SKIP M2 KRAS topMutationType with drivers  [coadread has no cbp_driver / cbp_driver_tiers calls and this instance has no OncoKB pin]");
    return;
  }
  const drivers = own ? { oncokb: false, hotspots: false, custom: true } : { oncokb: true, hotspots: false, custom: false };
  const source = own ? "the study's cbp_driver (" + own + " annotated mutations)" : "OncoKB " + pin + " (coadread has no cbp_driver calls)";
  const got = await labelCounts({ source: "alteration", gene: "KRAS", by: "topMutationType", drivers } as never, pin);
  const split = ["Missense", "Inframe", "Truncating", "Splice"].flatMap((c) => [c + " (Driver)", c + " (VUS)"]);
  const allowed = new Set([...split, "Promoter", "Promoter (VUS)", "Other", "Other (VUS)"]);
  const strays = [...got.keys()].filter((l) => !allowed.has(l) && l !== "Not mutated" && l !== "Not profiled for mutations");
  const mutated = [...got.entries()].filter(([l]) => allowed.has(l)).reduce((a, [, n]) => a + n, 0);
  ok(!strays.length && mutated === 218 && got.get("Not mutated") === 316 && got.get("Not profiled for mutations") === 60,
    "M2 KRAS topMutationType, coadread, drivers from " + source,
    "got " + show(got) + " — expected only <Class> (Driver|VUS) for Missense/Inframe/Truncating/Splice and Promoter/Other never (Driver)" +
    (strays.length ? " (unexpected: " + strays.join(", ") + ")" : "") + "; mutated " + mutated + " of 218; Not mutated 316; Not profiled for mutations 60");
});

/** this script's own reading: a sample is profiled for a gene in a type when its panel is WES or lists the gene */
const profiledSql = (gene: string, type: string) =>
  "SELECT DISTINCT sp.sample_unique_id FROM " + DB + ".sample_to_gene_panel_derived sp\n" +
  " WHERE sp.cancer_study_identifier = " + sq(COAD) + " AND sp.alteration_type = " + sq(type) + "\n" +
  "   AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (SELECT gene_panel_id FROM " + DB + ".gene_panel_to_gene_derived WHERE gene = " + sq(gene) + "))";
const svSamplesSql = (gene: string) =>
  "SELECT DISTINCT sample_unique_id FROM " + DB + ".genomic_event_derived WHERE cancer_study_identifier = " + sq(COAD) +
  " AND hugo_gene_symbol = " + sq(gene) + " AND variant_type = 'structural_variant'";
/** per sample of the study: CNA-profiled, SV-profiled, has an SV of the gene */
async function ringFacts(gene: string) {
  const sql = "SELECT countIf(has_sv) AS sv, countIf(has_sv AND cp) AS svCna, countIf(NOT cp AND NOT has_sv) AS np, count() AS total FROM (\n" +
    "SELECT sd.sample_unique_id IN (" + profiledSql(gene, "COPY_NUMBER_ALTERATION") + ") AS cp,\n" +
    "       sd.sample_unique_id IN (" + profiledSql(gene, "STRUCTURAL_VARIANT") + ") AS vp,\n" +
    "       sd.sample_unique_id IN (" + svSamplesSql(gene) + ") AS has_sv\n" +
    "FROM " + DB + ".sample_derived sd WHERE sd.cancer_study_identifier = " + sq(COAD) + ")";
  const r = (await chQuery<Record<string, string>>(sql)).data[0];
  return { sv: Number(r.sv), svCna: Number(r.svCna), np: Number(r.np), total: Number(r.total) };
}

await guarded("N1 KRAS copyNumberSv, coadread", async () => {
  const f = await ringFacts("KRAS");
  const got = await labelCounts({ source: "alteration", gene: "KRAS", by: "copyNumberSv" } as never);
  const id = "N1 KRAS copyNumberSv, coadread (warehouse: " + f.sv + " samples with a KRAS SV, " + f.svCna + " of them CNA-profiled; " +
    f.np + " not profiled for copy number and with no SV → Not profiled (invariant 7); " + f.total + " samples)";
  const cna: Record<string, number> = { "Deep Deletion": 1, "Shallow Deletion": 67, Diploid: 390, Gain: 128, Amplification: 6 };
  if (!f.svCna) sameCounts(id, got, { ...cna, ...(f.sv ? { "Structural Variant": f.sv } : {}), ...(f.np ? { "Not profiled": f.np } : {}) });
  else {
    // an SV outranks the copy-number call of a CNA-profiled sample; which level it leaves is not in the table, so the levels are checked as a sum
    const levels = Object.keys(cna).reduce((a, l) => a + (got.get(l) ?? 0), 0);
    const want = 592 - f.svCna;
    const total = [...got.values()].reduce((a, n) => a + n, 0);
    ok(levels === want && got.get("Structural Variant") === f.sv && (got.get("Not profiled") ?? 0) === f.np && total === 594, id,
      "got " + show(got) + " — expected the five levels to sum to " + want + ", Structural Variant " + f.sv + ", Not profiled " + f.np + ", total 594");
  }
});

await guarded("N2 TCF7L2 copyNumberSv, coadread", async () => {
  const f = await ringFacts("TCF7L2");
  const got = await labelCounts({ source: "alteration", gene: "TCF7L2", by: "copyNumberSv" } as never);
  ok(got.get("Structural Variant") === 4 && f.sv === 4, "N2 TCF7L2 copyNumberSv, coadread",
    "got Structural Variant " + (got.get("Structural Variant") ?? 0) + " (all: " + show(got) + "); warehouse " + f.sv + " samples with a TCF7L2 SV — expected 4 (cbioportal.org API)");
});

/** [row id, axis, model labels, labels allowed, labels required, exact counts] */
type LabelCase = [string, PlotAxis, boolean, string[], string[], Record<string, number>];
const COADREAD = "coadread_tcga_pan_can_atlas_2018";
const KRAS_MUT: PlotAxis = { source: "alteration", gene: "KRAS", by: "mutated" };
const TCF7L2_SV: PlotAxis = { source: "alteration", gene: "TCF7L2", by: "sv" };
const SV_LABELS = ["With Structural Variants", "No Structural Variants", "Not profiled for structural variants"];
const LABELS: LabelCase[] = [
  ["L1 KRAS Mutation Type: the portal's classes and \"No mutation\" (PLT-DT-3)", { source: "alteration", gene: "KRAS", by: "mutationType" }, false,
    ["Missense", "Inframe", "Truncating", "Splice", "Promoter", "Other", "Multiple", "No mutation", "Not profiled"], ["No mutation"], {}],
  ["L2 KRAS Mutated vs Wild-type: Mutated / No mutation / Not profiled (PLT-DT-4)", KRAS_MUT, false,
    ["Mutated", "No mutation", "Not profiled"], ["Mutated", "No mutation", "Not profiled"], {}],
  ["L3 TCF7L2 Variant vs No Variant: the portal's SV labels, 4 with one (PLT-DT-9)", TCF7L2_SV, false,
    SV_LABELS, ["With Structural Variants"], { "With Structural Variants": 4 }],
  ["L4 KRAS gistic: the portal's copy-number levels and Q6's row totals (PLT-DT-11)", { source: "molecular", profileType: "gistic", gene: "KRAS", discrete: true }, false,
    ["Deep Deletion", "Shallow Deletion", "Diploid", "Gain", "Amplification"], ["Deep Deletion", "Shallow Deletion", "Diploid", "Gain", "Amplification"],
    { "Deep Deletion": 1, "Shallow Deletion": 67, "Diploid": 390, "Gain": 128, "Amplification": 6 }],
  ["L5 KRAS mutated as a model covariate keeps \"Not mutated\"", KRAS_MUT, true,
    ["Mutated", "Not mutated", "Not profiled"], ["Mutated", "Not mutated", "Not profiled"], {}],
  ["L6 TCF7L2 SV as a model covariate keeps cBioLab's labels", TCF7L2_SV, true,
    ["Structural variant", "No structural variant", "Not profiled"], [], {}],
];

{
  const cohortSql = compileCohortDef(null, { study: COADREAD });
  for (const [id, axis, model, allowed, required, counts] of LABELS) {
    try {
      // `labels` is the covariates' switch on AxisCtx (lib/federation.ts coxRows / logisticRows)
      const ctx = { study: COADREAD, unit: "sample", cohortSql, ...(model ? { labels: "model" } : {}) } as AxisCtx;
      const sql = "WITH cohort AS (" + cohortSql + "),\n     xs AS (" + axisSelect(axis, ctx, "cat") + ")\nSELECT v, count() AS n FROM xs GROUP BY v ORDER BY v";
      const got = new Map((await chQuery<{ v: string; n: string }>(sql)).data.map((r) => [String(r.v), Number(r.n)]));
      const stray = [...got.keys()].filter((l) => !allowed.includes(l));
      const lacking = required.filter((l) => !got.has(l));
      const off = Object.entries(counts).filter(([l, n]) => got.get(l) !== n);
      ok(!stray.length && !lacking.length && !off.length, id,
        [...got].map(([l, n]) => l + " " + n).join(", ") +
        (stray.length ? " — unexpected " + stray.join(", ") : "") + (lacking.length ? " — missing " + lacking.join(", ") : "") +
        (off.length ? " — expected " + off.map(([l, n]) => l + " " + n).join(", ") : ""));
    } catch (e) { ok(false, id, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
  }
}

{
  const study = "coadread_tcga_pan_can_atlas_2018";
  const cohortSql = compileCohortDef(null, { study });
  const ctx = { study, unit: "sample" as const, cohortSql };
  const sel = (a: PlotAxis, kind: "num" | "cat") => axisSelect(a, ctx, kind);
  const xSel = sel({ source: "clinical", attribute: "AGE" }, "num");
  const ySel = sel({ source: "clinical", attribute: "FRACTION_GENOME_ALTERED" }, "num");
  const kras = sel({ source: "alteration", gene: "KRAS", by: "mutated" }, "cat");
  const sex = sel({ source: "clinical", attribute: "SEX" }, "cat");
  const rowsOf = async (colorSel?: string, ringSel?: string) =>
    (await chQuery<Record<string, unknown>>(plotScatterPointsSql(xSel, ySel, cohortSql, undefined, undefined, colorSel, ringSel))).data;
  /** per category of `catSel`, the plotted samples (a value on both axes), "" for one without a category */
  const countsBy = async (catSel: string) => new Map((await chQuery<Record<string, unknown>>(
    "WITH cohort AS (" + cohortSql + "),\n     xs AS (" + xSel + "),\n     ys AS (" + ySel + "),\n     cs AS (" + catSel + ")\n" +
    "SELECT ifNull(cs.v, '') AS k, count() AS n FROM xs INNER JOIN ys ON ys.id = xs.id LEFT JOIN cs ON cs.id = xs.id GROUP BY k")).data
    .map((r) => [String(r.k), Number(r.n)]));
  const tally = (rows: Record<string, unknown>[], col: string) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r[col] == null ? "(missing)" : String(r[col]); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const show = (m: Map<string, number>) => [...m].sort().map(([k, n]) => (k || "\"\"") + "=" + n).join(" ");
  const caseRow = async (id: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { ok(false, id, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
  };

  // the plotted samples, counted by a separate join (581 on cbioportal.org when the scorecard read Q4)
  const plotted = [...(await countsBy(sex)).values()].reduce((a, n) => a + n, 0);
  await caseRow("C1 no colour or ring: every plotted sample", async () => {
    const rows = await rowsOf();
    ok(rows.length === plotted, "C1 no colour or ring: every plotted sample", "rows " + rows.length + " — expected " + plotted);
  });

  await caseRow("C2 colorSel KRAS mutated", async () => {
    const rows = await rowsOf(kras);
    const c = tally(rows, "c");
    const allowed = new Set(["Mutated", "Not mutated", "No mutation", OQL_NOT_PROFILED, "Not profiled"]);
    const want = (await countsBy(kras)).get("Mutated") || 0;
    ok(rows.length === plotted && [...c.keys()].every((k) => allowed.has(k)) && (c.get("Mutated") || 0) === want,
      "C2 colorSel KRAS mutated: every c a KRAS category, Mutated counted as a separate join counts it",
      "rows " + rows.length + ", c: " + show(c) + " — expected " + plotted + " rows, Mutated=" + want);
  });

  await caseRow("C3 colorSel KRAS mutated, ringSel SEX", async () => {
    const rows = await rowsOf(kras, sex);
    const r = tally(rows, "r");
    const want = await countsBy(sex);
    const keys = new Set([...r.keys(), ...want.keys()]);
    ok(rows.length === plotted && [...r.keys()].every((k) => k === "Male" || k === "Female" || k === "") &&
      [...keys].every((k) => (r.get(k) || 0) === (want.get(k) || 0)),
    "C3 colorSel KRAS mutated, ringSel SEX: every r Male, Female or \"\", counted as a separate join counts them",
    "rows " + rows.length + ", r: " + show(r) + " — expected " + plotted + " rows, " + show(want));
  });
}

{
  const STUDY = "coadread_tcga_pan_can_atlas_2018";
  const r = await resolverFor(STUDY, { oncokbPin: await oncokbPin(), ...(await studyProfiles(STUDY)) });
  const clin = (attribute: string, log?: boolean): PlotAxis => ({ source: "clinical", attribute, ...(log ? { log: true } : {}) });
  const FGA = clin("FRACTION_GENOME_ALTERED");
  const is = (id: string, what: string, got: unknown, want: string) => ok(got === want, id + " " + what, JSON.stringify(got) + " — expected " + JSON.stringify(want));

  // the resolver titles its own plot's axes (so a remote peer's plot is named); the other views
  // title theirs through lib/clinical-titles.ts, whose query runs here through viewMeta (T11)
  const titled = (axes: Record<string, PlotAxis | undefined>) => titledAxes(axes, { [STUDY]: r }, [STUDY]);
  if (!hasFederatedPlot(r)) ok(false, "T7 plotAxisKinds", STUDY + "'s resolver has no plotAxisKinds");
  else {
    const k = await r.plotAxisKinds({ x: clin("MUTATION_COUNT"), y: FGA });
    is("T7", "plotAxisKinds xLabel", k.xLabel, "Mutation Count");
    is("T7", "plotAxisKinds yLabel", k.yLabel, "Fraction Genome Altered");
  }

  const t8 = await r.plot(null, { x: clin("CANCER_TYPE_DETAILED"), y: FGA, unit: "sample" });
  is("T8", "plot x.label", t8.x.label, "Cancer Type Detailed");
  is("T8", "plot y.label", t8.y.label, "Fraction Genome Altered");

  const t9 = await r.plot(null, { x: clin("AGE"), y: clin("FRACTION_GENOME_ALTERED", true), unit: "sample" });
  is("T9", "plot x.label", t9.x.label, "Diagnosis Age");
  is("T9", "plot y.label (log)", t9.y.label, "Fraction Genome Altered (log2(value + 1))");

  const t10 = await r.plot(null, { x: clin("CANCER_TYPE_DETAILED"), y: FGA, unit: "sample", colorBy: clin("SEX") });
  is("T10", "plot colorLabel (" + t10.shape + ")", t10.colorLabel, "Sex");

  // L7 a cox covariate is read by the resolver with the model's labels: the reference level its
  // documents name ("Not mutated") is a value it returns, the plot's "No mutation" is not
  const cox = await (r as unknown as { coxRows(d: null, e: string, c: PlotAxis[]): Promise<{ rows: { values: (string | number)[] }[] }> })
    .coxRows(null, "OS", [{ source: "alteration", gene: "KRAS", by: "mutated" }]);
  const levels = new Set(cox.rows.map((x) => String(x.values[0])));
  ok(levels.has("Not mutated") && !levels.has("No mutation"), "L7 coxRows: KRAS mutated as a covariate keeps \"Not mutated\"", [...levels].join(", "));
  // T11 the other views' step: titledAxes, its clinicalMetaSql run through the resolver's viewMeta
  const t11 = await titled({ a: clin("MUTATION_COUNT"), b: clin("SEX"), c: clin("NOT_AN_ATTRIBUTE_HERE") });
  is("T11", "titledAxes MUTATION_COUNT", t11.a?.source === "clinical" ? t11.a.label : undefined, "Mutation Count");
  is("T11", "titledAxes SEX", t11.b?.source === "clinical" ? t11.b.label : undefined, "Sex");
  ok(t11.c?.source === "clinical" && t11.c.label === undefined, "T11 titledAxes: an attribute the study does not declare keeps no label", JSON.stringify(t11.c));
}

// ---- a box plot's Filter categories and Sort Categories by Median -----------
{
  const rows = [["c1", "Colon"], ["c2", "Colon"], ["c3", "Rectal"], ["c4", "O'Brien"], ["c5", "Mucinous"], ["c6", null]] as const;
  const vals = "SELECT * FROM values('id String, v Nullable(String)', " + rows.map(([id, v]) => "(" + sq(id) + ", " + (v == null ? "NULL" : sq(v)) + ")").join(", ") + ")";
  await guarded("F1 keptCategoriesSql", async () => {
    const got = (await chQuery<{ id: string }>("SELECT id FROM (" + keptCategoriesSql(vals, ["Colon", "O'Brien", "Absent"]) + ") ORDER BY id")).data.map((r) => r.id);
    ok(got.join() === "c1,c2,c4", "F1 keptCategoriesSql keeps Colon and O'Brien (quoted), nothing else, never a NULL", "got " + got.join(", ") + " — expected c1, c2, c4");
  });
}
{
  const STUDY = "coadread_tcga_pan_can_atlas_2018";
  const r = await resolverFor(STUDY, { oncokbPin: await oncokbPin(), ...(await studyProfiles(STUDY)) });
  const open: PlotRequest = { x: { source: "clinical", attribute: "CANCER_TYPE_DETAILED" }, y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" }, unit: "sample" };
  await guarded("F2–F4 the filter in the plot's request", async () => {
    const all = await r.plot(null, open);
    const name = (part: string) => (all.groups || []).find((g) => g.g.toLowerCase().includes(part))?.g;
    const colon = name("colon adeno"), rectal = name("rectal"), mucinous = name("mucinous");
    if (!colon || !rectal || !mucinous) throw new Error("coadread's Cancer Type Detailed has no Colon, Rectal or Mucinous group: " + (all.groups || []).map((g) => g.g).join(", "));
    const kept = [colon, rectal];
    const spec: PlotRequest = { ...open, categories: kept };
    const f = await r.plot(null, spec);
    const want = (all.groups || []).filter((g) => kept.includes(g.g));
    const same = (a: typeof want, b: typeof want) => JSON.stringify([...a].sort((x, y) => x.g < y.g ? -1 : 1)) === JSON.stringify([...b].sort((x, y) => x.g < y.g ? -1 : 1));
    ok(same(f.groups || [], want) && f.n === want.reduce((a, g) => a + g.n, 0), "F2 categories [Colon, Rectal]: those boxes alone, each the unfiltered plot's own",
      (f.groups || []).map((g) => g.g + " n " + g.n + " median " + g.median).join("; ") + " (n " + f.n + ") — expected " + want.map((g) => g.g + " n " + g.n + " median " + g.median).join("; "));
    ok(JSON.stringify(f.coverage) === JSON.stringify(all.coverage) && !!all.coverage, "F3 the filtered plot's coverage is the unfiltered plot's",
      JSON.stringify(f.coverage) + " — expected " + JSON.stringify(all.coverage));
    const rc = plotCasesOf(r);
    if (!rc) { console.log("SKIP F4  [" + STUDY + "'s participant may not show cases]"); return; }
    const pts = await rc.plotPoints(null, spec) || [];
    const ws = (f.groups || []).map(({ g, loWhisker, hiWhisker }) => ({ g, loWhisker, hiWhisker }));
    const outs = (await rc.plotOutlierPoints(null, spec, 1000, ws)).points;
    const ranked = await rc.plotRankedPoints(null, spec, "cat", "num", { by: "y", n: 5 });
    const strays = [...pts, ...outs, ...ranked].map((p) => "g" in p ? p.g : "").filter((g) => !kept.includes(g));
    ok(!strays.length && pts.length === f.n && ranked.length > 0, "F4 points, outliers and ranked cases under the filter are the kept categories' alone",
      "points " + pts.length + " (n " + f.n + "), outliers " + outs.length + ", ranked " + ranked.length + (strays.length ? "; outside the filter: " + [...new Set(strays)].join(", ") : ""));
  });
  await guarded("F5 sorted by median", async () => {
    const res = await runAnalysis({ study: STUDY, cohorts: { All: { all: [] } },
      views: [{ kind: "plot", cohorts: ["All"], unit: "sample", points: [], sortByMedian: true, x: open.x, y: open.y }] } as never);
    const v = res.views[0] as { error?: string; plot?: { groups?: { g: string; median: number }[] } };
    if (v.error) throw new Error(v.error);
    const gs = (v.plot?.groups || []).map((g) => g.g);
    const at = (part: string) => gs.findIndex((g) => g.toLowerCase().includes(part));
    const m = at("mucinous"), c = at("colon adeno"), rr = at("rectal");
    const ascending = (v.plot?.groups || []).every((g, i, a) => !i || a[i - 1].median <= g.median);
    ok(m >= 0 && m < c && c < rr && ascending, "F5 FGA by Cancer Type Detailed, sorted by median: Mucinous, Colon, Rectal (the portal's 0.1140 < 0.2268 < 0.2973), every box ascending",
      (v.plot?.groups || []).map((g) => g.g + " " + g.median).join(" · "));
  });
}

console.log(failures ? "\n" + failures + " of " + checks + " plot statistics checks FAILED" : "\nall " + checks + " plot statistics checks passed");
process.exit(failures ? 1 : 0);
