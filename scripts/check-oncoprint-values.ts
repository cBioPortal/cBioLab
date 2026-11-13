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
 *   - anything else: the value when the samples agree, "Mixed" when they differ, even when the
 *     values look like numbers.
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
  ["FX-P05", "SAMPLE_TYPE", "Primary"]                            // one sample: its own value
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

for (const [pid, attr, want] of EXPECTED) {
  const got = rows.find((r) => r.pid === pid && r.k === attr)?.v ?? null;
  const same = want === null || got === null ? got === want
    : Number.isFinite(Number(want)) ? Math.abs(Number(got) - Number(want)) <= 1e-9 : got === want;
  ok(`${pid} ${attr}`, same, "ours " + JSON.stringify(got) + ", expected " + JSON.stringify(want));
}

console.log(`\n${EXPECTED.length - failures + 1}/${EXPECTED.length + 1} oncoprint value checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
