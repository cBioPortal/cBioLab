// "Query this study" from the Cancer Types Summary popover (lib/views/cancertypes/tip.ts cancertypesStudyQuery):
// {query, options} or {why}. Each test is a row of the case table; `why` rows assert only that a reason is given.
//
//  Q1  measure "driver"                                          → why
//  Q2  drivers {oncokb:false}                                    → why
//  Q3  drivers {} / undefined                                    → query, no refusal
//  Q4  view.exp set                                              → why
//  Q5  view.prot set                                             → why
//  Q6  oql ["KRAS: AMP","TP53"], gene KRAS                       → "KRAS: AMP"
//  Q7  oql with two KRAS lines, gene KRAS                        → both, in order
//  Q8  oql, All (gene null)                                      → every line
//  Q9  no oql, gene tab                                          → the gene
//  Q10 no oql, All                                               → genes joined by "\n"
//  Q11 oql with no line for the gene                             → why
//  Q12 page null                                                 → options null
//  Q13 page caseSet "w_mut"                                      → why
//  Q14 page caseSet "-1"                                         → why
//  Q15 page default profiles (all "*"), caseSet "all"            → options null
//  Q16 page missing one default kind                             → why
//  Q17 page with an mrna profile chosen                          → why
//  Q18 page with a study's profile id instead of "*"             → why
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import { defaultProfiles, EVERY_STUDY, type QueryOptions } from "../lib/query-options.ts";
import { cancertypesStudyQuery } from "../lib/views/cancertypes/tip.ts";

const prof = (study: string, suffix: string, type: string, datatype: string, order: number): ProfileInfo =>
  ({ profile: suffix, type, datatype, name: suffix, study, order, analysis: true });
const catalog: ProfileInfo[] = ["s1", "s2"].flatMap((s) => [
  prof(s, "mutations", "MUTATION_EXTENDED", "MAF", 1),
  prof(s, "gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", 2),
  prof(s, "structural_variants", "STRUCTURAL_VARIANT", "SV", 3),
]);
const page = (o: Partial<QueryOptions> = {}): QueryOptions =>
  ({ profiles: { mut: EVERY_STUDY, cna: EVERY_STUDY, sv: EVERY_STUDY }, z: "2.0", rppaZ: "2.0", caseSet: "all", ...o });
const genes = ["KRAS", "TP53"];
const run = (view: Parameters<typeof cancertypesStudyQuery>[0], gene: string | null = null, p: QueryOptions | null = null) =>
  cancertypesStudyQuery(view, genes, gene, p, catalog);
const isWhy = (r: object) => assert.ok("why" in r, JSON.stringify(r));

test("catalog default profiles are every kind as \"*\"", () =>
  assert.deepEqual(defaultProfiles(catalog, 2), { mut: "*", sv: "*", cna: "*" }));

test("Q1 measure driver → why", () => isWhy(run({ measure: "driver" })));
test("Q2 non-default drivers → why", () => isWhy(run({ drivers: { oncokb: false } as never })));
test("Q3 drivers {} or undefined → query", () => {
  assert.deepEqual(run({ drivers: {} }), { query: "KRAS\nTP53", options: null });
  assert.deepEqual(run({ drivers: undefined }), { query: "KRAS\nTP53", options: null });
});
test("Q4 exp → why", () => isWhy(run({ exp: "mrna_zscores" })));
test("Q5 prot → why", () => isWhy(run({ prot: "rppa_zscores" })));
test("Q6 gene tab keeps that gene's line", () =>
  assert.deepEqual(run({ oql: ["KRAS: AMP", "TP53"] }, "KRAS"), { query: "KRAS: AMP", options: null }));
test("Q7 two lines of the gene, in order", () =>
  assert.deepEqual(run({ oql: ["KRAS: AMP", "TP53", "KRAS: MUT"] }, "KRAS"), { query: "KRAS: AMP\nKRAS: MUT", options: null }));
test("Q8 All keeps every line", () =>
  assert.deepEqual(run({ oql: ["KRAS: AMP", "TP53"] }), { query: "KRAS: AMP\nTP53", options: null }));
test("Q9 no oql, gene tab → the gene", () => assert.deepEqual(run({}, "TP53"), { query: "TP53", options: null }));
test("Q10 no oql, All → genes", () => assert.deepEqual(run({}), { query: "KRAS\nTP53", options: null }));
test("Q11 gene with no line → why", () => isWhy(run({ oql: ["TP53"] }, "KRAS")));
test("Q12 page null → options null", () => assert.deepEqual(run({}, "KRAS", null), { query: "KRAS", options: null }));
test("Q13 caseSet w_mut → why", () => isWhy(run({}, "KRAS", page({ caseSet: "w_mut" }))));
test("Q14 caseSet -1 → why", () => isWhy(run({}, "KRAS", page({ caseSet: "-1", cases: { set: "x", level: "sample" } }))));
test("Q15 default page → options null", () => assert.deepEqual(run({}, "KRAS", page()), { query: "KRAS", options: null }));
test("Q16 missing a kind → why", () => isWhy(run({}, "KRAS", page({ profiles: { mut: "*", cna: "*" } }))));
test("Q17 mrna chosen → why", () =>
  isWhy(run({}, "KRAS", page({ profiles: { mut: "*", cna: "*", sv: "*", mrna: "mrna_zscores" } }))));
test("Q18 a study's profile id → why", () =>
  isWhy(run({}, "KRAS", page({ profiles: { mut: "mutations", cna: "*", sv: "*" } }))));
