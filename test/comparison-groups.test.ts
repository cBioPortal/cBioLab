// Explore's "Compare groups": a chart's items or a numeric attribute's cuts as the comparison page's cohorts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { comparisonCohorts, exclusiveCohorts, quantilePoints, rangeArms, COMPARISON_MAX_GROUPS } from "../lib/partition-arms.ts";
import type { Clause, Leaf, PartitionArm } from "../lib/types.ts";

const age = (range: { gt?: number; lte?: number }): Clause => ({ kind: "clinical", attribute: "AGE", range });
const inRange = (x: number, r: { gt?: number; lte?: number }) => (r.gt == null || x > r.gt) && (r.lte == null || x <= r.lte);

describe("quantilePoints", () => {
  test("median and quartiles", () => {
    assert.deepEqual(quantilePoints(2), [0.5]);
    assert.deepEqual(quantilePoints(4), [0.25, 0.5, 0.75]);
  });
  test("refuses what is not a group count", () => {
    for (const n of [1, 0, 2.5, 11]) assert.throws(() => quantilePoints(n), /whole number from 2 to 10/);
  });
});

describe("rangeArms", () => {
  test("quartile cuts give four intervals that cover every value exactly once", () => {
    const arms = rangeArms("AGE", [52, 61, 70], age);
    assert.deepEqual(arms.map((a) => a.name), ["AGE ≤ 52", "AGE 52–61", "AGE 61–70", "AGE > 70"]);
    for (const x of [-5, 52, 52.0001, 61, 65, 70, 70.5, 1e6]) {
      const hits = arms.filter((a) => inRange(x, (a.where as { range: { gt?: number; lte?: number } }).range));
      assert.equal(hits.length, 1, "value " + x + " lands in " + hits.length + " arms");
    }
  });
  test("tied cuts collapse, so no interval is empty by construction", () => {
    const arms = rangeArms("TMB", [1, 1, 3], age);
    assert.deepEqual(arms.map((a) => a.name), ["TMB ≤ 1", "TMB 1–3", "TMB > 3"]);
  });
  test("a cut that is not a number is dropped, and none at all is refused", () => {
    assert.equal(rangeArms("AGE", [NaN, 50], age).length, 2);
    assert.throws(() => rangeArms("AGE", [], age), /no values to cut/);
  });
});

describe("comparisonCohorts", () => {
  const arms: PartitionArm[] = [
    { name: "KRAS: MUT", where: { kind: "oql", q: "KRAS: MUT" } },
    { name: "TP53: MUT", where: { kind: "oql", q: "TP53: MUT" } }
  ];
  const base: Clause[] = [{ kind: "clinical", attribute: "SEX", values: ["Female"] }];
  test("each arm is a cohort of the selection's clauses and its own, where the selection is", () => {
    const c = comparisonCohorts({ study: "luad_tcga" }, base, arms);
    assert.deepEqual(Object.keys(c), ["KRAS: MUT", "TP53: MUT"]);
    assert.deepEqual(c["TP53: MUT"], { study: "luad_tcga", all: [base[0], arms[1].where] });
    const multi = comparisonCohorts({ studies: ["a", "b"] }, [], arms);
    assert.deepEqual(multi["KRAS: MUT"], { studies: ["a", "b"], all: [arms[0].where] });
  });
  test("two arms with one name are both kept", () => {
    const c = comparisonCohorts({}, [], [arms[0], { ...arms[1], name: "KRAS: MUT" }]);
    assert.deepEqual(Object.keys(c), ["KRAS: MUT", "KRAS: MUT 2"]);
  });
  test("refuses fewer than 2 groups, more than the page takes, and more clauses than a cohort takes", () => {
    assert.throws(() => comparisonCohorts({}, [], [arms[0]]), /at least 2 groups/);
    const many = Array.from({ length: COMPARISON_MAX_GROUPS + 1 }, (_, i) => ({ name: "g" + i, where: arms[0].where }));
    assert.throws(() => comparisonCohorts({}, [], many), new RegExp("holds at most " + COMPARISON_MAX_GROUPS + " groups"));
    assert.throws(() => comparisonCohorts({}, Array(8).fill(base[0]), arms), /at most 8/);
  });
});

describe("exclusiveCohorts", () => {
  const base: Clause = { kind: "clinical", attribute: "SEX", values: ["Female"] };
  const kras: Clause = { kind: "oql", q: "KRAS: MUT" }, tp53: Clause = { kind: "oql", q: "TP53: MUT" }, egfr: Clause = { kind: "oql", q: "EGFR: MUT" };
  test("each group loses the samples of the others: its own conditions and not any other's", () => {
    const c = exclusiveCohorts({ K: { study: "s", all: [base, kras] }, T: { study: "s", all: [base, tp53] }, E: { study: "s", all: [base, egfr] } });
    assert.deepEqual(c.K, { study: "s", all: [base, kras, { not: { any: [tp53, egfr] } }] });
    assert.deepEqual(c.E.all, [base, egfr, { not: { any: [kras, tp53] } }]);
  });
  test("a group defined by a negation is subtracted by requiring what it negates", () => {
    const c = exclusiveCohorts({ A: { all: [base, kras] }, notA: { all: [base, { not: kras as Leaf }] } });
    assert.deepEqual(c.A.all, [base, kras]);
    assert.deepEqual(c.notA.all, [base, { not: kras }, { not: { any: [kras] } }]);
  });
  test("refuses what it cannot subtract exactly", () => {
    assert.throws(() => exclusiveCohorts({ A: { all: [base, kras] }, B: { all: [tp53, egfr] } }), /differs from “A” in 2 conditions/);
    assert.throws(() => exclusiveCohorts({ A: { all: [base, kras] }, B: { all: [base] } }), /lies wholly within “B”/);
    assert.throws(() => exclusiveCohorts({ A: { study: "x", all: [kras] }, B: { study: "y", all: [tp53] } }), /different studies/);
  });
});
