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
 * Run: node --env-file=.env.local scripts/check-oncoprint-values.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines; scripts/gate.sh sets them).
 */
import { chQuery, connById } from "../lib/ch.ts";
import { clinicalSql } from "../lib/oncoprint.ts";

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

const total = EXPECTED.length + EXPECTED_RESTRICTED.length + 1;
console.log(`\n${total - failures}/${total} oncoprint value checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
