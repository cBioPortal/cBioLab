/**
 * Live check: an oncoprint patient column's clinical value, when the patient has several samples.
 *
 * The rule (lib/oncoprint.ts clinicalSql, the portal's fillClinicalTrackDatum) is SQL, which a unit
 * test can only read as text. This runs it against the committed fixture study on connection b
 * (test/fixtures/peer-study, whose FX-P01…FX-P04 have two samples each) and compares every value
 * with one written down by hand from the fixture's files:
 *
 *   - a patient-level row wins;
 *   - a NUMBER: the mean of its samples' values that are numbers, MUTATION_COUNT their max, and no
 *     value when none is a number;
 *   - a NUMBER's value is a number only when the whole text is one ("1e3", ".5"), a patient row's
 *     too; the portal's parseFloat reads "12abc" as 12 and "0x10" as 0, which we do not (a Gleason
 *     "4+3" would read as 4: docs/PORTAL-PARITY.md, ONC-TT-12);
 *   - a STRING: the value when the samples agree exactly, "Mixed" when they differ, even when the
 *     values look like numbers or differ only in case;
 *   - any other datatype (BOOLEAN) as a STRING; the portal draws nothing for one;
 *   - with the query restricted to some samples, only those samples count.
 *
 * And a heatmap's patient value (heatmapSql, assayHeatmapSql; the portal's fillHeatmapTrackDatum):
 * its samples' value furthest from 0, sign kept, a positive one on a ± tie whatever order the rows
 * arrive in, values that are not numbers left out. The fixture has no expression or generic-assay
 * profile, so these run over scratch copies of the two value tables on the same connection.
 * And a row's EXP / PROT values (expressionEventsSql, read for lib/oql-match.ts eventWanted /
 * oqlLevel; the portal's fillGeneticTrackDatum counts each sample's datum): one row per SAMPLE,
 * unaggregated — a patient with two samples gives two rows, both with the patient's id, in patient
 * columns — values that are not numbers left out, another gene or profile never read; run over a
 * scratch copy of the value tables, as the heatmaps are.
 * And the oncoprint's Tracks › Clinical rows for the fixture (Explore's facets through trackAttrs
 * and clinicalTrackRows, as the Results page builds them): every declared attribute listed, at 0%
 * where the selection has no value; a sample attribute's Freq over the queried samples; ties by
 * stored priority, then name.
 * And the Tabular download's names: each clinical row's display name (clinicalNamesSql: the
 * meta header's first line; none for an unknown attribute or the computed mutation spectrum), and
 * each profile's alteration type and datatype (profileInventorySql: its meta file's).
 * And a gene row's OQL (lib/oql-match.ts over genomicEventsSql's rows): a row with a position range
 * reads its gene's mutations with their own protein positions, the same rows as without, and its
 * range picks the patients written down from the fixture's MAF; the cohort's OQL SQL (oqlCasesSql)
 * picks the same patients; a protein change matches whatever its case; a mutation typed Fusion is
 * no mutation to MUT (FX-P44's EGFR-SEPT14).
 *
 * Run: node --env-file=.env.local scripts/check-oncoprint-values.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines; scripts/gate.sh sets them).
 */
import { chQuery, chWrite, connById } from "../lib/ch.ts";
import { assayHeatmapSql, buildContract, clinicalNamesSql, clinicalSql, genomicEventsSql, heatmapSql, profileInventorySql } from "../lib/oncoprint.ts";
import { oqlCasesSql, oqlEventsSql, parseOql } from "../lib/oql.ts";
import { eventWanted } from "../lib/oql-match.ts";
import { buildExplore } from "../lib/explore.ts";
import { clinicalTrackRows, trackAttrs, trackFreqText, tracksMenuRows } from "../app/_oncoprint/track-edits.ts";

const STUDY = "cbiolab_peer_fixture";

/** [patient, attribute, expected value; null = no value] */
const EXPECTED: [string, string, string | null][] = [
  ["FX-P01", "AGE", "83"],                                        // a patient row
  ["FX-P01", "MUTATION_COUNT", "2"], ["FX-P02", "MUTATION_COUNT", "3"],   // 2 and 1, 3 and 1 loci: the max, not the mean
  ["FX-P03", "MUTATION_COUNT", "4"], ["FX-P04", "MUTATION_COUNT", "3"],
  ["FX-P01", "FRACTION_GENOME_ALTERED", "0.346"],                 // (0.354 + 0.338) / 2
  ["FX-P02", "FRACTION_GENOME_ALTERED", "0.213"],                 // (0.104 + 0.322) / 2
  ["FX-P01", "KI67_INDEX", "15"],                                 // 10 and 20
  ["FX-P02", "KI67_INDEX", "30"],                                 // 30 and ">90": the one that is a number
  ["FX-P03", "KI67_INDEX", null],                                 // "high" twice: none is a number
  ["FX-P01", "SAMPLE_TYPE", "Mixed"], ["FX-P04", "SAMPLE_TYPE", "Mixed"],   // Primary and Metastasis
  ["FX-P01", "CANCER_TYPE", "Non-Small Cell Lung Cancer"],        // the samples agree
  ["FX-P01", "TUMOR_GRADE", "Mixed"],                             // a STRING of "1" and "2": not their mean
  ["FX-P02", "TUMOR_GRADE", "2"],
  ["FX-P05", "SAMPLE_TYPE", "Primary"],                           // one sample: its own value
  // a NUMBER's value counts only when the whole text is a number (the portal's parseFloat: 506, 2, -0.5, 12, 0, 12)
  ["FX-P01", "PARSE_PROBE", "1000"],                              // "12abc" and "1e3": only 1e3 is a number
  ["FX-P02", "PARSE_PROBE", "4"],                                 // "0x10" and "4"
  ["FX-P03", "PARSE_PROBE", "0.5"],                               // ".5" and "abc"
  ["FX-P04", "PARSE_PROBE", "-2"],                                // "-2" and "1,5"
  ["FX-P05", "PARSE_PROBE", null],                                // one sample, "12abc"
  ["FX-P06", "PARSE_PROBE", null],                                // one sample, "0x10"
  ["FX-P07", "PARSE_PROBE", "1000"],                              // one sample, "1e3"
  ["FX-P08", "PARSE_PROBE", "7"],                                 // one sample, "7"
  ["FX-P01", "PATIENT_SCORE", null],                              // a patient row is held to the same rule
  ["FX-P02", "PATIENT_SCORE", "1000"],
  // a STRING's values are compared as exact strings
  ["FX-P01", "SITE_LABEL", "Mixed"],                              // "Lung" and "lung"
  ["FX-P02", "SITE_LABEL", "Mixed"],                              // "Left  Lung" and "Left Lung"
  ["FX-P03", "SITE_LABEL", "Lung"],
  // a BOOLEAN is collapsed as a STRING is (the portal draws nothing for it)
  ["FX-P01", "FLAG_BOOL", "TRUE"],                                // TRUE and TRUE
  ["FX-P02", "FLAG_BOOL", "Mixed"],                               // TRUE and FALSE
  ["FX-P05", "FLAG_BOOL", "TRUE"],                                // one sample
  ["FX-P01", "PATIENT_FLAG", "TRUE"]                              // a patient row
];

/** The query restricted to some samples: a patient's value comes from its samples in the query only. */
const QUERY_SAMPLES = ["FX-P01-T2", "FX-P02-T2", "FX-P05-T1"];
const EXPECTED_RESTRICTED: [string, string, string | null][] = [
  ["FX-P01", "MUTATION_COUNT", "1"],                              // T2's 1 locus, not T1's 2
  ["FX-P01", "FRACTION_GENOME_ALTERED", "0.338"],                 // T2's own, not the mean
  ["FX-P01", "SAMPLE_TYPE", "Metastasis"],                        // not "Mixed"
  ["FX-P01", "PARSE_PROBE", "1000"],                              // T2's "1e3"
  ["FX-P02", "KI67_INDEX", null],                                 // T2's ">90" only
  ["FX-P02", "SITE_LABEL", "Left Lung"],
  ["FX-P01", "AGE", "83"],                                        // a patient row is not a sample's
  ["FX-P05", "SAMPLE_TYPE", "Primary"],
  ["FX-P03", "SAMPLE_TYPE", null]                                 // no sample in the query
];

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }
const attrs = [...new Set(EXPECTED.map((e) => e[1]))];
const rows = (await chQuery<{ pid: string; k: string; v: string }>(clinicalSql(attrs, STUDY, conn.db, "patient"), conn)).data;
ok("the fixture study is on connection b", rows.length > 0, rows.length + " values");

const compare = (got: { pid: string; k: string; v: string }[], expected: typeof EXPECTED, tag: string) => {
  for (const [pid, attr, want] of expected) {
    const found = got.filter((r) => r.pid === pid && r.k === attr);
    const v = found[0]?.v ?? null;
    const same = found.length > 1 ? false : want === null || v === null ? v === want
      : Number.isFinite(Number(want)) ? Math.abs(Number(v) - Number(want)) <= 1e-9 : v === want;
    ok(`${tag}${pid} ${attr}`, same, "ours " + (found.length > 1 ? found.length + " rows" : JSON.stringify(v)) + ", expected " + JSON.stringify(want));
  }
};
compare(rows, EXPECTED, "");

const restrictedAttrs = [...new Set(EXPECTED_RESTRICTED.map((e) => e[1]))];
const inQuery = "SELECT arrayJoin([" + QUERY_SAMPLES.map((s) => "'" + s + "'").join(",") + "])";
const restricted = (await chQuery<{ pid: string; k: string; v: string }>(clinicalSql(restrictedAttrs, STUDY, conn.db, "patient", inQuery), conn)).data;
compare(restricted, EXPECTED_RESTRICTED, "samples " + QUERY_SAMPLES.join(",") + ": ");

// ---- heatmaps -------------------------------------------------------------------------------
/** [patient, its samples' values in arrival order, expected; null = no value] */
const HEAT: [string, (string | null)[], number | null][] = [
  ["H1", ["2", "-5"], -5],          // furthest from 0, sign kept (the portal's signed-vs-abs bug gives 2: docs/PORTAL-PARITY.md)
  ["H2", ["-5", "2"], -5],
  ["H3", ["-3", "3"], 3],           // a ± tie: the positive one, in either order
  ["H4", ["3", "-3"], 3],
  ["H5", ["NA", "2"], 2],           // not a number: left out
  ["H6", ["NaN"], null],
  ["H7", ["1.7"], 1.7],
  ["H8", ["1", "3", "-2"], 3],
  ["H9", ["", "-0.5"], -0.5]        // an empty value is no value
];
const scratch = "cbiolab_check_heatmaps";
const run = (sql: string) => chWrite(sql, conn);
await run("CREATE DATABASE IF NOT EXISTS " + scratch);
for (const t of ["genetic_alteration_derived", "sample_derived", "generic_assay_data_derived"])
  await run("CREATE OR REPLACE TABLE " + scratch + "." + t + " AS " + conn.db + "." + t);
const sid = (p: string, i: number) => "hs_" + p + "-S" + (i + 1);
const lit = (v: string | null) => v === null ? "NULL" : "'" + v + "'";
for (const [p, vals] of HEAT) {
  // one statement per sample, so the rows arrive in the order written
  for (let i = 0; i < vals.length; i++) {
    await run("INSERT INTO " + scratch + ".sample_derived (sample_unique_id, patient_unique_id) VALUES ('" + sid(p, i) + "', 'hs_" + p + "')");
    await run("INSERT INTO " + scratch + ".genetic_alteration_derived (sample_unique_id, cancer_study_identifier, hugo_gene_symbol, profile_type, alteration_value) VALUES ('" +
      sid(p, i) + "', 'hs', 'G1', 'mrna_z', " + lit(vals[i]) + ")");
    await run("INSERT INTO " + scratch + ".generic_assay_data_derived (sample_unique_id, patient_unique_id, entity_stable_id, profile_type, profile_stable_id, value) VALUES ('" +
      sid(p, i) + "', 'hs_" + p + "', 'E1', 'assay', 'hs_assay', " + lit(vals[i]) + ")");
  }
}
type HeatRow = { pid: string; gene: string; v: number | string };
const heat = (await chQuery<HeatRow>(heatmapSql("mrna_z", ["G1"], "hs", scratch, "patient"), conn)).data;
const assay = (await chQuery<HeatRow>(assayHeatmapSql("assay", ["E1"], "hs", scratch, "patient"), conn)).data;
for (const [tag, got] of [["heatmap", heat], ["generic assay", assay]] as const)
  for (const [p, vals, want] of HEAT) {
    const found = got.filter((r) => r.pid === p);
    const v = found.length ? Number(found[0].v) : null;
    ok(`${tag} ${p} [${vals.join(", ")}]`, found.length <= 1 && (want === null ? v === null : v !== null && Math.abs(v - want) <= 1e-9),
      "ours " + JSON.stringify(v) + ", expected " + JSON.stringify(want));
  }
await run("DROP DATABASE IF EXISTS " + scratch);

// ---- a row's EXP / PROT values ---------------------------------------------------------------
// imported by name at run time: the function is the change under test, and its absence fails this
// section alone
const expressionEventsSql = (await import("../lib/oncoprint.ts") as Record<string, unknown>).expressionEventsSql as
  ((profileType: string, genes: string[], study: string, db: string, unit: "patient" | "sample", samples?: string | null) => string) | undefined;
/** [patient, its samples' values in arrival order; null = a NULL value] */
const EXPR: [string, (string | null)[]][] = [
  ["X1", ["2.5", "-3"]],            // X8: two samples, both rows back, unaggregated
  ["X2", ["2.5", "3", "-3"]],       // X9
  ["X3", ["1", "2.5"]],             // X10
  ["X4", ["NA", "2.5"]],            // not a number: left out
  ["X5", ["", null]],               // nothing: no row
];
/** the rows expected in patient columns: [pid, z], every sample's that is a number */
const EXPR_PATIENT: [string, number][] = [["X1", 2.5], ["X1", -3], ["X2", 2.5], ["X2", 3], ["X2", -3], ["X3", 1], ["X3", 2.5], ["X4", 2.5]];
let exprChecks = 0;
const exprOk = (name: string, pass: boolean, detail: string) => { exprChecks++; ok(name, pass, detail); };
if (typeof expressionEventsSql !== "function") {
  exprOk("expression events: lib/oncoprint.ts exports expressionEventsSql", false, "not exported");
} else {
  const xs = "cbiolab_check_expression";
  await run("CREATE DATABASE IF NOT EXISTS " + xs);
  for (const t of ["genetic_alteration_derived", "sample_derived"])
    await run("CREATE OR REPLACE TABLE " + xs + "." + t + " AS " + conn.db + "." + t);
  const xsid = (p: string, i: number) => "xs_" + p + "-S" + (i + 1);
  const value = (sample: string, gene: string, profile: string, v: string | null) =>
    run("INSERT INTO " + xs + ".genetic_alteration_derived (sample_unique_id, cancer_study_identifier, hugo_gene_symbol, profile_type, alteration_value) VALUES ('" +
      sample + "', 'xs', '" + gene + "', '" + profile + "', " + lit(v) + ")");
  for (const [p, vals] of EXPR)
    for (let i = 0; i < vals.length; i++) {
      await run("INSERT INTO " + xs + ".sample_derived (sample_unique_id, patient_unique_id) VALUES ('" + xsid(p, i) + "', 'xs_" + p + "')");
      await value(xsid(p, i), "KRAS", "mrna_z", vals[i]);
      await value(xsid(p, i), "TP53", "mrna_z", "9");          // another gene: not read
      await value(xsid(p, i), "KRAS", "rppa_z", "7");          // another profile: not read
    }
  type ExprRow = { pid: string; gene: string; z: number | string };
  const got = async (unit: "patient" | "sample", samples?: string) =>
    (await chQuery<ExprRow>(expressionEventsSql("mrna_z", ["KRAS"], "xs", xs, unit, samples ?? null), conn)).data;
  const norm = (rows: ExprRow[]) => rows.map((r) => r.pid + "|" + r.gene + "|" + Number(r.z)).sort();
  const want = (rows: [string, number][]) => rows.map(([p, v]) => p + "|KRAS|" + v).sort();
  const patient = await got("patient");
  exprOk("expression events, patient columns: one row per sample with a number, the patient's id, unaggregated",
    JSON.stringify(norm(patient)) === JSON.stringify(want(EXPR_PATIENT)), "ours " + JSON.stringify(norm(patient)));
  exprOk("expression events: X1's two samples both come back (2.5 and -3)",
    JSON.stringify(norm(patient.filter((r) => r.pid === "X1"))) === JSON.stringify(want([["X1", 2.5], ["X1", -3]])), JSON.stringify(patient.filter((r) => r.pid === "X1")));
  exprOk("expression events: 'NA' left out, X4's 2.5 kept", norm(patient.filter((r) => r.pid === "X4")).join() === "X4|KRAS|2.5",
    JSON.stringify(patient.filter((r) => r.pid === "X4")));
  exprOk("expression events: X5's empty and NULL values give no row", !patient.some((r) => r.pid === "X5"), "");
  exprOk("expression events: every z is a number", patient.every((r) => Number.isFinite(Number(r.z)) && r.z !== null && r.z !== ""), "");
  const sample = await got("sample");
  const wantSample = EXPR.flatMap(([p, vals]) => vals.map((v, i) => [p + "-S" + (i + 1), v] as [string, string | null]))
    .filter(([, v]) => v !== null && v !== "" && Number.isFinite(Number(v))).map(([s, v]) => [s, Number(v)] as [string, number]);
  exprOk("expression events, sample columns: each sample its own id", JSON.stringify(norm(sample)) === JSON.stringify(want(wantSample)),
    "ours " + JSON.stringify(norm(sample)));
  const only = await got("patient", "SELECT arrayJoin(['X1-S2'])");
  exprOk("expression events: only the query's samples count", JSON.stringify(norm(only)) === JSON.stringify(want([["X1", -3]])), "ours " + JSON.stringify(norm(only)));
  await run("DROP DATABASE IF EXISTS " + xs);
}

// ---- the Tracks › Clinical rows ----------------------------------------------------------------
const menu = async (draft?: unknown) => {
  const r = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true, ...(draft ? { draft: draft as never } : {}) } as never);
  return clinicalTrackRows(trackAttrs(r), r.totals);
};
const whole = await menu(), female = await menu({ all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] });
const freq = (rows: typeof whole, a: string) => { const x = rows.find((r) => r.attribute === a); return x ? trackFreqText(x.pct) : "(not listed)"; };
/** [selection, rows, attribute, Freq], counted by hand from the fixture's data_clinical_*.txt (59 samples; 33 of the women's; FX-P45–FX-P53, the structural-variant samples, hold none of these values) */
const MENU: [string, typeof whole, string, string][] = [
  ["all", whole, "PARSE_PROBE", "20.3%"], ["all", whole, "TUMOR_GRADE", "6.8%"], ["all", whole, "FLAG_BOOL", "8.5%"],
  ["SEX = Female", female, "PARSE_PROBE", "21.2%"], ["SEX = Female", female, "FLAG_BOOL", "9.1%"],
  ["SEX = Female", female, "PATIENT_FLAG", "0%"]          // no woman has a value: listed, at 0%
];
for (const [tag, rows, a, want] of MENU) ok(`tracks menu (${tag}) ${a}`, freq(rows, a) === want, "ours " + freq(rows, a) + ", expected " + want);
ok("tracks menu lists all 20 declared attributes", whole.length === 20, String(whole.length));
// at 100%: MUTATION_COUNT first (stored priority 30, the rest 1), then by display name (CANCER_TYPE is at 98%: FX-P41-T1's is blank)
const top = whole.slice(0, 3).map((r) => r.attribute).join(", ");
ok("tracks menu order: stored priority, then name", top === "MUTATION_COUNT, AGE, DEAD", top);

// ---- clinical tracks typed by the declared datatype ---------------------------------------------
// data_clinical_sample.txt: KI67_INDEX is declared NUMBER, its values 10, 20, 30, ">90", "high", "high"
// (3 numbers, so the old ">10 distinct" rule drew categories); TUMOR_GRADE is declared STRING, "1" once, "2" three times
let typeChecks = 0;
const typeOk = (name: string, pass: boolean, detail: string) => { typeChecks++; ok(name, pass, detail); };
{
  const c = await buildContract({ study: STUDY, genes: ["KRAS"], unit: "sample", clinical: ["KI67_INDEX", "TUMOR_GRADE"] } as never);
  const ki = c.tracks.find((t) => t.label === "KI67_INDEX")!, tg = c.tracks.find((t) => t.label === "TUMOR_GRADE")!;
  const drawn = (ki.values || []).filter((x) => x != null && !Number.isNaN(x as number)).map(Number).sort((x, y) => x - y);
  typeOk("a NUMBER with 3 distinct numbers is a bar track, its text values no data",
    ki.numeric === true && ki.min === 10 && ki.max === 30 && JSON.stringify(drawn) === "[10,20,30]", JSON.stringify({ numeric: ki.numeric, min: ki.min, max: ki.max, drawn }));
  typeOk("a STRING of numbers is a category track", !tg.numeric && JSON.stringify(tg.categories) === '["2","1"]', JSON.stringify(tg.categories));
}

// ---- the automatic rows: listed, counted and hidden ----------------------------------------------
// every fixture sample has a mutations panel in data_gene_panel_matrix.txt (59 of 59), and its
// patients hold one or two samples, so the figure draws # Samples per Patient by itself
let autoChecks = 0;
const autoOk = (name: string, pass: boolean, detail: string) => { autoChecks++; ok(name, pass, detail); };
{
  const r = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true } as never) as { totals: { patients: number; samples: number }; dataTypes: { alterationType: string; n: number }[] };
  const sequenced = Math.max(0, ...r.dataTypes.filter((d) => d.alterationType === "MUTATION_EXTENDED").map((d) => d.n));
  autoOk("samples profiled for mutations (the spectrum's Freq)", sequenced === 59, "ours " + sequenced);
  const shown = await buildContract({ study: STUDY, genes: ["KRAS"] } as never);
  const hidden = await buildContract({ study: STUDY, genes: ["KRAS"], hideTracks: ["# Samples per Patient"] } as never);
  const labels = (c: typeof shown) => c.tracks.map((t) => t.label).join(" | ");
  autoOk("# Samples per Patient drawn by itself, and named in conventions.autoTracks",
    labels(shown) === "# Samples per Patient | KRAS" && JSON.stringify(shown.conventions.autoTracks) === '["# Samples per Patient"]', labels(shown));
  autoOk("hideTracks leaves it out of the figure, still named in conventions.autoTracks",
    labels(hidden) === "KRAS" && JSON.stringify(hidden.conventions.autoTracks) === '["# Samples per Patient"]', labels(hidden));
  const rows = tracksMenuRows({ attrs: trackAttrs(r as never), totals: r.totals, spectrum: true, sequenced, autoTracks: shown.conventions.autoTracks || [] });
  const head = rows.slice(0, 2).map((x) => x.label + " " + trackFreqText(x.pct)).join(", ");
  // the spectrum first; then MUTATION_COUNT (100%, stored priority 30) ahead of # Samples per Patient (100%, priority 0)
  autoOk("tracks menu leads with the spectrum, then by Freq and priority", head === "Mutation spectrum 100.0%, Mutation Count 100.0%", head);
}

// ---- the Tabular download's row names and types -------------------------------------------------
/** [attribute, display name from the fixture's data_clinical_*.txt header; null = none] */
const NAMES: [string, string | null][] = [
  ["SEX", "Sex"], ["KI67_INDEX", "Ki-67 Index"], ["FRACTION_GENOME_ALTERED", "Fraction Genome Altered"],
  ["PATIENT_FLAG", "Patient Flag"], ["NO_SUCH_ATTRIBUTE", null], ["MUTATION_SPECTRUM", null]
];
const nameSql = clinicalNamesSql(NAMES.map(([a]) => a), STUDY, conn.db)!;
const names = new Map((await chQuery<{ a: string; n: string }>(nameSql, conn)).data.map((r) => [r.a, r.n]));
for (const [a, want] of NAMES) ok(`display name ${a}`, (names.get(a) ?? null) === want, "ours " + JSON.stringify(names.get(a) ?? null) + ", expected " + JSON.stringify(want));
ok("display names: no attribute of another study", names.size === NAMES.filter(([, n]) => n).length, String(names.size));
/** [profile type, its meta file's genetic_alteration_type and datatype] */
const KINDS: [string, string][] = [["mutations", "MUTATION_EXTENDED MAF"], ["cna", "COPY_NUMBER_ALTERATION DISCRETE"]];
const kinds = new Map((await chQuery<{ pt: string; type: string; datatype: string }>(profileInventorySql(STUDY, conn.db), conn)).data.map((r) => [r.pt, r.type + " " + r.datatype]));
for (const [pt, want] of KINDS) ok(`profile kind ${pt}`, kinds.get(pt) === want, "ours " + kinds.get(pt) + ", expected " + want);

// ---- a gene row's OQL ----------------------------------------------------------------------------
type Ev = { pid: string; gene: string; vt: string; mt: string; mv: string; cna: string; ps: number | null; pe: number | null };
const evRows = async (genes: string[], unit: "patient" | "sample", ranged: string[]): Promise<Ev[]> =>
  (await chQuery<Record<string, unknown>>(genomicEventsSql(genes, STUDY, conn.db, unit, null, ranged), conn)).data.map((r) =>
    ({ pid: String(r.pid), gene: String(r.gene), vt: String(r.vt), mt: String(r.mt ?? ""), mv: String(r.mv ?? ""), cna: String(r.cna ?? ""),
      ps: r.ps == null ? null : Number(r.ps), pe: r.pe == null ? null : Number(r.pe) }));
let oqlChecks = 0;
const oqlOk = (name: string, pass: boolean, detail: string) => { oqlChecks++; ok(name, pass, detail); };
for (const unit of ["patient", "sample"] as const) {
  const plain = await evRows(["KRAS", "EGFR"], unit, []), ranged = await evRows(["KRAS", "EGFR"], unit, ["EGFR"]);
  const key = (e: Ev) => [e.pid, e.gene, e.vt, e.mt, e.mv, e.cna].join("|");
  oqlOk(`ranged events, ${unit} columns: the same rows`, JSON.stringify(plain.map(key).sort()) === JSON.stringify(ranged.map(key).sort()), plain.length + " and " + ranged.length + " rows");
  const egfr = ranged.filter((e) => e.gene === "EGFR" && e.vt === "mutation");
  oqlOk(`ranged events, ${unit} columns: every EGFR mutation has its positions`, egfr.length > 0 && egfr.every((e) => e.ps != null && e.pe != null), egfr.length + " rows");
}
const egfrEvents = await evRows(["EGFR"], "patient", ["EGFR"]);
const drawn = (line: string) => [...new Set(egfrEvents.filter((e) => eventWanted(parseOql(line)[0].specs, e, false)).map((e) => e.pid))].sort().join(" ");
const casesOf = async (line: string) => (await chQuery<{ pid: string }>(oqlCasesSql(line, { study: STUDY, db: conn.db, unit: "patient" }), conn)).data.map((r) => r.pid).sort().join(" ");
/** [line, the patients its row draws, from the MAF: E746_A750del 746-750 (P22 P24 P26 P28), SP3 3-4 and SP4 4-5 (P21), SP7 7-8 (P27), SP11 11-12 (P25), SP12 12-13 (P28), SP10fs no position (P24)] */
const RANGES: [string, string][] = [
  ["EGFR: MUT_(747-747)", "FX-P22 FX-P24 FX-P26 FX-P28"],
  ["EGFR: MUT_(745-751*)", "FX-P22 FX-P24 FX-P26 FX-P28"],
  ["EGFR: MUT_(747-751*)", ""],
  ["EGFR: MUT_(1-12)", "FX-P21 FX-P25 FX-P27 FX-P28"],
  ["EGFR: MUT_(1-12*)", "FX-P21 FX-P25 FX-P27"],
];
for (const [line, want] of RANGES) {
  oqlOk(`oncoprint row ${line}`, drawn(line) === want, "ours " + JSON.stringify(drawn(line)) + ", expected " + JSON.stringify(want));
  const cases = await casesOf(line);
  oqlOk(`cohort ${line} picks the row's patients`, cases === want, "ours " + JSON.stringify(cases) + ", expected " + JSON.stringify(want));
}
const g12c = "FX-P01 FX-P06 FX-P10 FX-P11 FX-P16";
for (const line of ["KRAS: MUT=G12C", "KRAS: MUT=g12c", "KRAS: g12c"])
  oqlOk(`cohort ${line}`, await casesOf(line) === g12c, "ours " + JSON.stringify(await casesOf(line)));
const p44 = egfrEvents.filter((e) => e.pid === "FX-P44" && e.vt === "mutation");
const wantedP44 = p44.filter((e) => eventWanted(parseOql("EGFR: MUT")[0].specs, e, false)).map((e) => e.mv);
oqlOk("oncoprint row EGFR: MUT leaves out the Fusion-typed mutation", p44.length === 9 && wantedP44.length === 8 && !wantedP44.includes("EGFR-SEPT14"), JSON.stringify(wantedP44));
const evLabels = async (line: string) => (await chQuery<{ ev: string }>(oqlEventsSql(line, { study: STUDY, db: conn.db }), conn)).data.map((r) => r.ev);
oqlOk("cohort events EGFR: MUT leave out the Fusion-typed mutation; a bare EGFR keeps it",
  !(await evLabels("EGFR: MUT")).includes("EGFR-SEPT14") && (await evLabels("EGFR")).includes("EGFR-SEPT14"), "");

const total = typeChecks + autoChecks + exprChecks + oqlChecks + EXPECTED.length + EXPECTED_RESTRICTED.length + 1 + 2 * HEAT.length + MENU.length + 2 + NAMES.length + 1 + KINDS.length;
console.log(`\n${total - failures}/${total} oncoprint value checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
