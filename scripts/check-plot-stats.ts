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
 *   T*  lib/federation.ts plotAxisKinds / plot — an axis's title as the portal writes it (PLT-DT-19;
 *       cbioportal-frontend cd8c6df PlotsTabUtils.tsx getAxisLabel): a clinical attribute by its
 *       display name, " (log2(value + 1))" after it on a log scale, and the colour axis likewise.
 *       Read against the warehouse's coadread_tcga_pan_can_atlas_2018, all samples; the names are
 *       cbioportal.org's for that study (REST clinical-attributes). Case table rows T7–T10.
 *
 * Run: node --env-file=.env.local scripts/check-plot-stats.ts
 */
import { chQuery, DB } from "../lib/ch.ts";
import * as plot from "../lib/plot.ts";
import { plotBoxSql, plotStatsSql, axisSelect, type PlotAxis } from "../lib/plot.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { sq } from "../lib/compiler.ts";
import { resolverFor, hasFederatedPlot } from "../lib/federation.ts";
import { studyProfiles } from "../lib/analysis.ts";
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
  const classSql = (plot as Record<string, unknown>).oncoprintClassSql as ((mt: string, pc: string) => string) | undefined;
  if (typeof classSql !== "function") {
    for (const [id, mt, pc, want] of CLASSES) ok(false, id + " oncoprintClassSql(" + mt + ", '" + pc + "')", "lib/plot.ts exports no oncoprintClassSql — expected " + want);
  } else {
    try {
      const rows = CLASSES.map(([id, mt, pc]) => "(" + sq(id) + ", " + sq(mt) + ", " + sq(pc) + ")").join(", ");
      const sql = "SELECT id, " + classSql("mt", "pc") + " AS c FROM values('id String, mt String, pc String', " + rows + ")";
      const got = new Map((await chQuery<{ id: string; c: string }>(sql)).data.map((r) => [r.id, r.c]));
      for (const [id, mt, pc, want] of CLASSES) ok(got.get(id) === want, id + " oncoprintClassSql(" + mt + ", '" + pc + "')", "got " + got.get(id) + " — expected " + want);
    } catch (e) {
      for (const [id, , , want] of CLASSES) ok(false, id + " oncoprintClassSql", "threw: " + String((e as Error).message).slice(0, 200) + " — expected " + want);
    }
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
  const sql = "SELECT countIf(has_sv) AS sv, countIf(has_sv AND cp) AS svCna, countIf(NOT cp AND NOT vp) AS np, countIf(NOT cp AND vp AND NOT has_sv) AS diploidExtra, count() AS total FROM (\n" +
    "SELECT sd.sample_unique_id IN (" + profiledSql(gene, "COPY_NUMBER_ALTERATION") + ") AS cp,\n" +
    "       sd.sample_unique_id IN (" + profiledSql(gene, "STRUCTURAL_VARIANT") + ") AS vp,\n" +
    "       sd.sample_unique_id IN (" + svSamplesSql(gene) + ") AS has_sv\n" +
    "FROM " + DB + ".sample_derived sd WHERE sd.cancer_study_identifier = " + sq(COAD) + ")";
  const r = (await chQuery<Record<string, string>>(sql)).data[0];
  return { sv: Number(r.sv), svCna: Number(r.svCna), np: Number(r.np), diploidExtra: Number(r.diploidExtra), total: Number(r.total) };
}

await guarded("N1 KRAS copyNumberSv, coadread", async () => {
  const f = await ringFacts("KRAS");
  const got = await labelCounts({ source: "alteration", gene: "KRAS", by: "copyNumberSv" } as never);
  const id = "N1 KRAS copyNumberSv, coadread (warehouse: " + f.sv + " samples with a KRAS SV, " + f.svCna + " of them CNA-profiled; " +
    f.np + " profiled for neither; " + f.diploidExtra + " SV-profiled only, no SV → Diploid; " + f.total + " samples)";
  const cna: Record<string, number> = { "Deep Deletion": 1, "Shallow Deletion": 67, Diploid: 390 + f.diploidExtra, Gain: 128, Amplification: 6 };
  if (!f.svCna) sameCounts(id, got, { ...cna, ...(f.sv ? { "Structural Variant": f.sv } : {}), ...(f.np ? { "Not profiled": f.np } : {}) });
  else {
    // an SV outranks the copy-number call of a CNA-profiled sample; which level it leaves is not in the table, so the levels are checked as a sum
    const levels = Object.keys(cna).reduce((a, l) => a + (got.get(l) ?? 0), 0);
    const want = 592 + f.diploidExtra - f.svCna;
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
{
  const STUDY = "coadread_tcga_pan_can_atlas_2018";
  const r = await resolverFor(STUDY, { oncokbPin: await oncokbPin(), ...(await studyProfiles(STUDY)) });
  const clin = (attribute: string, log?: boolean): PlotAxis => ({ source: "clinical", attribute, ...(log ? { log: true } : {}) });
  const FGA = clin("FRACTION_GENOME_ALTERED");
  const is = (id: string, what: string, got: unknown, want: string) => ok(got === want, id + " " + what, JSON.stringify(got) + " — expected " + JSON.stringify(want));

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
}

console.log(failures ? "\n" + failures + " of " + checks + " plot statistics checks FAILED" : "\nall " + checks + " plot statistics checks passed");
process.exit(failures ? 1 : 0);
