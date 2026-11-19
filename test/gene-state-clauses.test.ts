// A gene chart's states and the clauses a click on them adds (lib/gene-state-clauses.ts). The copy-
// number chart is cBioPortal's (STS-GS-3): the levels of the study's discrete profile, AMP / GAIN /
// DIPLOID / HETLOSS / HOMDEL with the labels `/api/genomic-data-counts/fetch` gives them, "NA"
// shown as not profiled, and a click filters on the profile's values (genomicDataFilters {value}).
// Whether each clause selects what its state counts is checked live by scripts/check-gene-facets.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CNA_LEVELS, DISCRETE_CNA_PROFILE, cnaLevelLabel, driverOql, geneStatesClauses } from "../lib/gene-state-clauses.ts";

const cna = (values: string[]) => ({ kind: "genomicData", gene: "KRAS", profileType: DISCRETE_CNA_PROFILE, values, ifHeld: true });

describe("the copy-number levels", () => {
  test("the portal's five levels and labels, highest first", () => {
    assert.deepEqual(CNA_LEVELS.map((l) => [l.state, l.value, l.label]), [
      ["amp", 2, "Amplified"], ["gain", 1, "Gained"], ["diploid", 0, "Diploid"],
      ["hetloss", -1, "Heterozygously deleted"], ["del", -2, "Homozygously deleted"]
    ]);
  });
  test("a stored value reads as its level; anything else as itself", () => {
    assert.equal(cnaLevelLabel("1"), "Gained");
    assert.equal(cnaLevelLabel(-1), "Heterozygously deleted");
    assert.equal(cnaLevelLabel("-2"), "Homozygously deleted");
    assert.equal(cnaLevelLabel("ILLOGICAL"), "ILLOGICAL");
  });
});

describe("a copy-number chart's clauses, every alteration counted", () => {
  test("a click matches nobody in a study without the profile, so it runs over several studies", () => {
    const r = geneStatesClauses("KRAS", "CNA", ["amp"], false);
    assert.ok("clauses" in r && (r.clauses[0] as { ifHeld?: boolean }).ifHeld === true);
  });
  const cases: [string, string[], unknown][] = [
    ["one level", ["gain"], { clauses: [cna(["1"])] }],
    ["Diploid alone, without GAIN or HETLOSS", ["diploid"], { clauses: [cna(["0"])] }],
    ["several levels are one clause, any of their values", ["amp", "hetloss"], { clauses: [cna(["2", "-1"])] }],
    ["the levels in the profile's order, whatever the click order", ["del", "amp"], { clauses: [cna(["2", "-2"])] }],
    ["not profiled: no value at any level", ["notProfiled"], { clauses: [{ not: cna(["2", "1", "0", "-1", "-2"]) }] }],
    ["not profiled with levels: none of the levels left unchecked", ["notProfiled", "amp", "gain"], { clauses: [{ not: cna(["0", "-1", "-2"]) }] }],
    ["every state is no filter", ["notProfiled", "amp", "gain", "diploid", "hetloss", "del"], { why: "every state is checked, which is no filter" }],
    ["nothing checked is no filter", [], { why: "no state is checked" }]
  ];
  for (const [name, states, want] of cases)
    test(name, () => assert.deepEqual(geneStatesClauses("KRAS", "CNA", states, false), want));
});

describe("the charts read from called events", () => {
  const prof = (type: string) => ({ kind: "profiled", type, gene: "KRAS" });
  const oql = (q: string) => ({ kind: "oql", q: "KRAS: " + q });
  const cases: [string, "MUTATION" | "CNA", string[], boolean, unknown][] = [
    ["mutated", "MUTATION", ["altered"], false, { clauses: [prof("MUTATION"), oql("MUT")] }],
    ["not mutated: profiled and no mutation", "MUTATION", ["unaltered"], false, { clauses: [prof("MUTATION"), { not: oql("MUT") }] }],
    ["mutation not profiled", "MUTATION", ["notProfiled"], false, { clauses: [{ not: prof("MUTATION") }] }],
    ["mutated or not: profiled", "MUTATION", ["altered", "unaltered"], false, { clauses: [prof("MUTATION")] }],
    ["not profiled with another state refused", "MUTATION", ["altered", "notProfiled"], false,
      { why: "\"Not profiled\" with another state is not one filter — apply them separately" }],
    ["driver mutation", "MUTATION", ["altered"], true, { clauses: [prof("MUTATION"), oql("MUT_DRIVER")] }],
    ["driver amplification", "CNA", ["amp"], true, { clauses: [prof("CNA"), oql("AMP_DRIVER")] }],
    ["driver deletion", "CNA", ["del"], true, { clauses: [prof("CNA"), oql("HOMDEL_DRIVER")] }],
    ["no driver call", "CNA", ["unaltered"], true, { clauses: [prof("CNA"), { not: oql("AMP_DRIVER HOMDEL_DRIVER") }] }],
    ["driver amplification or deletion", "CNA", ["amp", "del"], true, { clauses: [prof("CNA"), oql("AMP_DRIVER HOMDEL_DRIVER")] }],
    ["driver amplification or no driver call: no driver deletion", "CNA", ["amp", "unaltered"], true, { clauses: [prof("CNA"), { not: oql("HOMDEL_DRIVER") }] }]
  ];
  for (const [name, type, states, drivers, want] of cases)
    test(name, () => assert.deepEqual(geneStatesClauses("KRAS", type, states, drivers), want));
});

describe("driver calls", () => {
  test("each call gets _DRIVER", () => {
    assert.equal(driverOql("AMP HOMDEL"), "AMP_DRIVER HOMDEL_DRIVER");
    assert.equal(driverOql("MUT"), "MUT_DRIVER");
  });
});
