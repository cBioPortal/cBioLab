// A gene chart's states and the clauses a click on them adds (lib/gene-state-clauses.ts). The copy-
// number chart is cBioPortal's (STS-GS-3): the levels of the study's discrete profile, AMP / GAIN /
// DIPLOID / HETLOSS / HOMDEL with the labels `/api/genomic-data-counts/fetch` gives them, "NA"
// shown as not profiled, and a click filters on the profile's values (genomicDataFilters {value}).
// Whether each clause selects what its state counts is checked live by scripts/check-gene-facets.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CNA_LEVELS, DISCRETE_CNA_PROFILE, MUTATION_TYPE_PROFILE, appliedMutationTypes, cnaLevelLabel, driverOql, geneStatesClauses, mutationTypeLabel, mutationTypesClause } from "../lib/gene-state-clauses.ts";
import { compileCohortDef } from "../lib/cohort2.ts";

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

// The Mutation Type Counts table (STS-OT-3): a click filters on the mutation types of the gene, as the
// portal's mutationDataFilters {categorization: MUTATION_TYPE, values}.
describe("a gene's mutation types", () => {
  test("labelled as the portal labels them", () => {
    assert.deepEqual(["In_Frame_Ins", "Missense_Mutation", "Splice_Site", "5'Flank"].map(mutationTypeLabel),
      ["In Frame Ins", "Missense Mutation", "Splice Site", "5'Flank"]);
  });

  test("the checked types are one clause; none, or more than one clause holds, is refused by name", () => {
    assert.deepEqual(mutationTypesClause("KRAS", ["Missense_Mutation", "Nonsense_Mutation"]),
      { clauses: [{ kind: "genomicData", gene: "KRAS", profileType: MUTATION_TYPE_PROFILE, values: ["Missense_Mutation", "Nonsense_Mutation"] }] });
    assert.deepEqual(mutationTypesClause("KRAS", []), { why: "no mutation type is checked" });
    const many = Array.from({ length: 21 }, (_, i) => "T" + i);
    assert.deepEqual(mutationTypesClause("KRAS", many), { why: "one filter holds at most 20 mutation types; 21 are checked" });
  });

  test("the applied rows: the types the draft's clauses on this gene hold, and no other gene's", () => {
    const def = { all: [
      { kind: "genomicData", gene: "KRAS", profileType: MUTATION_TYPE_PROFILE, values: ["Missense_Mutation"] },
      { kind: "genomicData", gene: "KRAS", profileType: MUTATION_TYPE_PROFILE, values: ["Nonsense_Mutation", "Missense_Mutation"] },
      { kind: "genomicData", gene: "TP53", profileType: MUTATION_TYPE_PROFILE, values: ["Splice_Site"] },
      cna(["2"]),
    ] };
    assert.deepEqual(appliedMutationTypes(def, "KRAS"), ["Missense_Mutation", "Nonsense_Mutation"]);
    assert.deepEqual(appliedMutationTypes(null, "KRAS"), []);
  });

  test("the clause compiles to the samples with a mutation of the gene of any of the types, every mutation counted", () => {
    const ctx = { study: "coadread", db: "cbio", profiles: ["gistic"] };
    const sql = compileCohortDef({ all: [{ kind: "genomicData", gene: "kras", profileType: MUTATION_TYPE_PROFILE, values: ["Missense_Mutation", "In_Frame_Ins"] }] } as never, ctx);
    assert.match(sql, /FROM cbio\.genomic_event_derived/);
    assert.match(sql, /variant_type = 'mutation'\s+AND hugo_gene_symbol = 'KRAS' AND mutation_type IN \('Missense_Mutation','In_Frame_Ins'\)/);
    assert.doesNotMatch(sql, /mutation_status/, "uncalled mutations too, as the portal's filter (glioma_msk_2018 ABL1: 6 samples)");
    const bad = (leaf: object) => () => compileCohortDef({ all: [{ kind: "genomicData", gene: "KRAS", profileType: MUTATION_TYPE_PROFILE, ...leaf }] } as never, ctx);
    assert.throws(bad({}), /profileType 'MUTATION_TYPE' needs values\[\]/);
    assert.throws(bad({ values: ["Missense_Mutation"], range: { gt: 1 } }), /takes values\[\] \(mutation types such as Missense_Mutation\) only/);
    assert.throws(bad({ values: Array.from({ length: 21 }, (_, i) => "T" + i) }), /genomicData clause on KRAS: at most 20 values; this lists 21/);
  });
});
