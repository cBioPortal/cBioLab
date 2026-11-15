/**
 * Live check: which mutation statuses are germline, as SQL run in ClickHouse — lib/driver-sql.ts
 * germlineStatusSql, which the Mutations tab's somatic count (lib/federation.ts lollipopTotalsSql)
 * and the oncoprint's germline mark (germlineCondSql) read. The rule is cbioportal.org's
 * GERMLINE_REGEXP, /germline/i (cbioportal-frontend cd8c6df src/shared/lib/MutationUtils.tsx 232,
 * used by somaticMutationRate 295): a status containing "germline" in any case.
 *
 *   G*  each spelling, written here, against the regexp's answer
 *   W1  the Mutations tab's somatic samples on a study whose germline calls are spelled "Germline":
 *       ov_tcga_pub BRCA1, 11 — what cbioportal.org's API gave on 2026-11-15 (37 BRCA1-mutated
 *       samples, 26 of their mutations "Germline", 11 "Somatic"); "!= 'GERMLINE'" counted 37.
 *
 * Run: node --env-file=.env.local scripts/check-germline-status.ts
 */
import { chQuery, DB } from "../lib/ch.ts";
import { germlineStatusSql } from "../lib/driver-sql.ts";
import { lollipopTotalsSql } from "../lib/federation.ts";

/** [row id, status (null: NULL), germline by /germline/i] */
const STATUSES: [string, string | null, boolean][] = [
  ["G1 upper case, as most studies write it", "GERMLINE", true],
  ["G2 capitalised (13 studies in the warehouse)", "Germline", true],
  ["G3 lower case (all_stjude_2013)", "germline", true],
  ["G4 inside a longer status: the regexp is not anchored", "LikelyGermline", true],
  ["G5 somatic", "Somatic", false],
  ["G6 SOMATIC", "SOMATIC", false],
  ["G7 NA", "NA", false],
  ["G8 empty", "", false],
  ["G9 NULL: the regexp tests the string \"null\"", null, false],
];

let failures = 0, checks = 0;
const ok = (pass: boolean, what: string, detail: string) => {
  checks++; if (!pass) failures++;
  console.log((pass ? "PASS " : "FAIL ") + what + "  [" + detail + "]");
};

{
  const lit = (s: string | null) => s === null ? "NULL" : "'" + s.replace(/'/g, "''") + "'";
  // as lollipopTotalsSql reads mutation_derived's Nullable mutationStatus
  const sql = "SELECT i, toUInt8(" + germlineStatusSql("ifNull(s, '')") + ") AS g FROM values('i UInt32, s Nullable(String)', " +
    STATUSES.map(([, s], i) => "(" + i + ", " + lit(s) + ")").join(", ") + ") ORDER BY i";
  const got = (await chQuery<{ i: number; g: number }>(sql)).data;
  STATUSES.forEach(([id, s, want], i) => {
    const g = got.find((r) => Number(r.i) === i);
    ok(!!g && (Number(g.g) === 1) === want, id, JSON.stringify(s) + " → " + (g ? (Number(g.g) ? "germline" : "not germline") : "no row") + ", expected " + (want ? "germline" : "not"));
  });
}

{
  const study = "ov_tcga_pub";
  const cohort = "SELECT replaceOne(patient_unique_id, '" + study + "_', '') AS pid, replaceOne(sample_unique_id, '" + study + "_', '') AS sid " +
    "FROM " + DB + ".sample_derived WHERE cancer_study_identifier = '" + study + "'";
  const r = (await chQuery<Record<string, unknown>>(lollipopTotalsSql(cohort, ["BRCA1"], study, DB))).data[0] || {};
  ok(Number(r.somatic_samples) === 11, "W1 " + study + " BRCA1: samples with a somatic mutation, its germline calls spelled \"Germline\"",
    "somatic samples " + r.somatic_samples + ", expected 11 (cbioportal.org)");
}

console.log(failures ? "\n" + failures + " of " + checks + " germline status checks FAILED" : "\nall " + checks + " germline status checks passed");
process.exit(failures ? 1 : 0);
