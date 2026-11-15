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
 * And the oncoprint's Tracks › Clinical rows for the fixture (Explore's facets through trackAttrs
 * and clinicalTrackRows, as the Results page builds them): every declared attribute listed, at 0%
 * where the selection has no value; a sample attribute's Freq over the queried samples; ties by
 * stored priority, then name.
 * And the Tabular download's names: each clinical row's display name (clinicalNamesSql: the
 * meta header's first line; none for an unknown attribute or the computed mutation spectrum), and
 * each profile's alteration type and datatype (profileInventorySql: its meta file's).
 *
 * Run: node --env-file=.env.local scripts/check-oncoprint-values.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines; scripts/gate.sh sets them).
 */
import { chQuery, chWrite, connById } from "../lib/ch.ts";
import { assayHeatmapSql, clinicalNamesSql, clinicalSql, heatmapSql, profileInventorySql } from "../lib/oncoprint.ts";
import { buildExplore } from "../lib/explore.ts";
import { clinicalTrackRows, trackAttrs, trackFreqText } from "../app/_oncoprint/track-edits.ts";

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

const total = EXPECTED.length + EXPECTED_RESTRICTED.length + 1 + 2 * HEAT.length + MENU.length + 2 + NAMES.length + 1 + KINDS.length;
console.log(`\n${total - failures}/${total} oncoprint value checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
