/**
 * Live check: a facet click selects every spelling of the value it shows.
 *
 * Asserted against the database, because the source tripwire in
 * test/value-folding.test.ts can only see that both sides call the same helper —
 * not that the resulting cohort is the right size.
 *
 *   1. EITHER SPELLING, SAME COHORT. Compiling `= 'Female'` and `= 'FEMALE'`
 *      must return identical patient sets. Before folding they returned 1,097
 *      and 1,987.
 *   2. THE COHORT IS THE WHOLE GROUP. That set must equal an independently
 *      computed count over all variants — not merely equal to each other, which
 *      two compensating errors would also satisfy.
 *
 * The cases are chosen because they are the ones that were most wrong:
 * breast_msk_2025 GENDER and RACE were 35.6% and 35.9% short.
 *
 * Run: node --env-file=.env.local scripts/check-value-folding.ts
 */
import { compileCohortDef } from "../lib/cohort2.ts";
import { chQuery, connById } from "../lib/ch.ts";
import { canonicalClinicalValue } from "../lib/event-names.ts";

const CASES = [
  { conn: "a", study: "breast_msk_2025", attr: "GENDER", spellings: ["Female", "FEMALE"] },
  { conn: "a", study: "breast_msk_2025", attr: "RACE", spellings: ["White", "WHITE"] },
  { conn: "a", study: "msk_chord_2024", attr: "METASTATIC_SITE", spellings: ["Lymph Node", "Lymph node"] },
  { conn: "b", study: "genie_public", attr: "DEAD", spellings: ["False", "FALSE"] }
] as const;

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

for (const c of CASES) {
  const conn = connById(c.conn);
  if (!conn) { ok(`${c.study} ${c.attr}: connection ${c.conn}`, false, "no such connection"); continue; }
  const db = conn.db;

  // independent ground truth: distinct cases over every variant of the label
  const folded = canonicalClinicalValue(c.spellings[0]);
  const truth = Number((await chQuery<{ n: string }>(
    `SELECT uniqExact(patient_unique_id) AS n FROM ${db}.clinical_data_derived\n` +
    `WHERE cancer_study_identifier = '${c.study}' AND attribute_name = '${c.attr}'\n` +
    `  AND lowerUTF8(trimBoth(attribute_value)) = '${folded}'`, conn)).data[0].n);

  const sizes: number[] = [];
  for (const spelling of c.spellings) {
    const sql = compileCohortDef(
      { all: [{ kind: "clinical", attribute: c.attr, op: "=", value: spelling }] } as never,
      { study: c.study, db });
    sizes.push(Number((await chQuery<{ n: string }>(`SELECT uniqExact(pid) AS n FROM (${sql})`, conn)).data[0].n));
  }

  const label = `${c.study} ${c.attr}`;
  ok(`${label}: every spelling selects the same cohort`,
    new Set(sizes).size === 1 && sizes[0] > 0,
    c.spellings.map((s, i) => `${s}=${sizes[i]}`).join(" "));
  ok(`${label}: that cohort is the whole folded group`,
    sizes[0] === truth,
    sizes[0] === truth ? `${truth} patients, independently confirmed` : `got ${sizes[0]}, independent count ${truth}`);
}

// A guard on the rule's SCOPE: folding must not have quietly merged values that
// differ by more than case and whitespace. If this number grows, someone
// widened the rule.
{
  const conn = connById("a")!;
  const over = await chQuery<{ n: string }>(
    `SELECT count() AS n FROM (
       SELECT lowerUTF8(trimBoth(attribute_value)) AS f
       FROM ${conn.db}.clinical_data_derived
       GROUP BY f, attribute_name, cancer_study_identifier
       HAVING uniqExact(replaceAll(replaceAll(lowerUTF8(trimBoth(attribute_value)), '-', ''), ' ', '')) > 1)`, conn);
  ok("folding merged nothing beyond case and whitespace", Number(over.data[0].n) === 0,
    `${over.data[0].n} folded groups whose members differ by more than case/space`);
}

console.log(failures ? `\n${failures} value-folding check(s) FAILED` : "\nall value-folding checks passed");
process.exit(failures ? 1 : 0);
