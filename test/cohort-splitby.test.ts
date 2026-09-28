// Auto-split a cohort by a facet ("split by RECEPTOR_STATUS_PRIMARY"): resolveSplitBy decides
// which values become their own arm and which pool into a disclosed "Other", via an injected
// distribution callback so the decision logic is checked without a live database. A separate
// live check (against a real study) covers the real attributeStats wiring end to end.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveSplitBy, SPLIT_BY_MAX_ARMS_CEILING, type AttributeDistribution } from "../lib/cohort-splitby.ts";
import type { CohortDef, SplitBy } from "../lib/types.ts";

const cat = (values: { v: string; n: number }[], per: "patient" | "sample" = "patient"): AttributeDistribution =>
  ({ kind: "cat", per, values });

const BASE: CohortDef = { all: [{ kind: "oql", q: "TP53: MUT" }] };
const sb = (over: Partial<SplitBy> = {}): SplitBy => ({ cohort: "base", attribute: "SUBTYPE", ...over });

describe("resolveSplitBy", () => {
  test("everything fits under maxArms and minCount: one arm per value, no Other", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 30 }, { v: "C", n: 20 }]);
    const r = await resolveSplitBy(sb(), [], BASE, async () => dist);
    assert.equal(r.arms.length, 3);
    assert.deepEqual(r.otherValues, []);
    // most frequent first
    assert.deepEqual(r.arms.map((a) => a.name), [
      "base — SUBTYPE: A", "base — SUBTYPE: B", "base — SUBTYPE: C"
    ]);
  });

  test("ties break alphabetically, for a deterministic, reproducible order", async () => {
    const dist = cat([{ v: "Z", n: 10 }, { v: "A", n: 10 }, { v: "M", n: 10 }]);
    const r = await resolveSplitBy(sb(), [], BASE, async () => dist);
    assert.deepEqual(r.arms.map((a) => a.name.split(": ")[1]), ["A", "M", "Z"]);
  });

  test("more distinct values than maxArms: top (maxArms-1) get their own arm, the rest pool into Other", async () => {
    const dist = cat([
      { v: "A", n: 100 }, { v: "B", n: 90 }, { v: "C", n: 80 }, { v: "D", n: 70 },
      { v: "E", n: 60 }, { v: "F", n: 50 }, { v: "G", n: 40 }, { v: "H", n: 30 },
    ]);
    const r = await resolveSplitBy(sb({ maxArms: 4 }), [], BASE, async () => dist);
    assert.deepEqual(r.arms.map((a) => a.name.split(": ")[1]), ["A", "B", "C", "Other"]);
    assert.deepEqual(r.otherValues.sort(), ["D", "E", "F", "G", "H"].sort());
  });

  test("a value below minCount always pools into Other, even with room under maxArms", async () => {
    const dist = cat([{ v: "A", n: 100 }, { v: "B", n: 50 }, { v: "C", n: 3 }]);
    const r = await resolveSplitBy(sb({ minCount: 10, maxArms: 8 }), [], BASE, async () => dist);
    assert.deepEqual(r.arms.map((a) => a.name.split(": ")[1]), ["A", "B", "Other"]);
    assert.deepEqual(r.otherValues, ["C"]);
  });

  test("the Other arm's def requires a recorded value AND excludes every promoted value", async () => {
    const dist = cat([{ v: "A", n: 100 }, { v: "B", n: 90 }, { v: "C", n: 5 }]);
    const r = await resolveSplitBy(sb({ maxArms: 3, minCount: 10 }), [], BASE, async () => dist);
    const other = r.arms.find((a) => a.name.endsWith("Other"))!;
    assert.deepEqual(other.def.all, [
      { kind: "oql", q: "TP53: MUT" },
      { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "!=", value: "" },
      { not: { any: [
        { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "=", value: "A" },
        { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "=", value: "B" },
      ] } },
    ]);
  });

  test("a value-arm's def splices in the base cohort's own clauses, unmodified, plus the equality leaf", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 50 }]);
    const r = await resolveSplitBy(sb(), [], BASE, async () => dist);
    assert.deepEqual(r.arms[0].def.all, [
      { kind: "oql", q: "TP53: MUT" },
      { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "=", value: "A" },
    ]);
  });

  test("a sample-level attribute's arms carry per:\"sample\", read from the distribution itself", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 50 }], "sample");
    const r = await resolveSplitBy(sb(), [], BASE, async () => dist);
    assert.equal((r.arms[0].def.all![1] as any).per, "sample");
  });

  test("a numeric attribute is refused — split needs a categorical, not a threshold", async () => {
    await assert.rejects(
      () => resolveSplitBy(sb(), [], BASE, async () => ({ kind: "num", per: "patient" })),
      /numeric/);
  });

  test("a site that declined to answer (e.g. over its own value cap) surfaces that reason", async () => {
    await assert.rejects(
      () => resolveSplitBy(sb(), [], BASE, async () => ({ kind: "cat", per: "patient", skipped: "more than 200 distinct values" })),
      /more than 200 distinct values/);
  });

  test("fewer than 2 values clear minCount: refused, not silently split into one arm", async () => {
    await assert.rejects(
      () => resolveSplitBy(sb({ minCount: 10 }), [], BASE, async () => cat([{ v: "A", n: 100 }, { v: "B", n: 3 }])),
      /not enough variation/);
  });

  test("no patient has any recorded value at all: refused", async () => {
    await assert.rejects(
      () => resolveSplitBy(sb(), [], BASE, async () => cat([])),
      /no patient.*has a recorded value/);
  });

  test("an invalid attribute name is refused before any lookup runs", async () => {
    await assert.rejects(
      () => resolveSplitBy(sb({ attribute: "bad name!" }), [], BASE, async () => { throw new Error("should not be called"); }),
      /not a valid attribute name/);
  });

  test("maxArms out of range (too low, too high, non-integer) is refused, not clamped", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 50 }]);
    for (const bad of [1, SPLIT_BY_MAX_ARMS_CEILING + 1, 3.5]) {
      await assert.rejects(() => resolveSplitBy(sb({ maxArms: bad }), [], BASE, async () => dist), /maxArms/);
    }
  });

  test("minCount out of range (zero, negative, non-integer) is refused, not clamped", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 50 }]);
    for (const bad of [0, -1, 2.5]) {
      await assert.rejects(() => resolveSplitBy(sb({ minCount: bad }), [], BASE, async () => dist), /minCount/);
    }
  });

  test("an arm name colliding with an existing document cohort is refused", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 50 }]);
    await assert.rejects(
      () => resolveSplitBy(sb(), ["base — SUBTYPE: A"], BASE, async () => dist),
      /same name as an existing cohort/);
  });

  test("naming none of attribute/gene/oql is refused", async () => {
    await assert.rejects(
      () => resolveSplitBy({ cohort: "base" }, [], BASE, async () => { throw new Error("should not be called"); }),
      /name exactly one of attribute, gene, or oql/);
  });

  test("naming both attribute and gene is refused", async () => {
    await assert.rejects(
      () => resolveSplitBy({ cohort: "base", attribute: "SUBTYPE", gene: "TP53" }, [], BASE,
        async () => { throw new Error("should not be called"); }),
      /name exactly one of attribute, gene, or oql/);
  });

  test("naming attribute alongside oql is refused too", async () => {
    await assert.rejects(
      () => resolveSplitBy({ cohort: "base", attribute: "SUBTYPE", oql: ["TP53: MUT"] }, [], BASE,
        async () => { throw new Error("should not be called"); }),
      /name exactly one of attribute, gene, or oql/);
  });

  test("otherArmName is set only when an Other arm actually exists", async () => {
    const withOther = await resolveSplitBy(sb({ maxArms: 3, minCount: 10 }),
      [], BASE, async () => cat([{ v: "A", n: 100 }, { v: "B", n: 90 }, { v: "C", n: 5 }]));
    assert.equal(withOther.otherArmName, "base — SUBTYPE: Other");
    const noOther = await resolveSplitBy(sb(), [], BASE, async () => cat([{ v: "A", n: 50 }, { v: "B", n: 50 }]));
    assert.equal(noOther.otherArmName, undefined);
  });

  test("overlapCheckDef is set once 2+ named arms exist, matching any of their own equality leaves", async () => {
    const dist = cat([{ v: "A", n: 50 }, { v: "B", n: 30 }, { v: "C", n: 20 }]);
    const r = await resolveSplitBy(sb(), [], BASE, async () => dist);
    assert.deepEqual(r.overlapCheckDef!.all, [
      { kind: "oql", q: "TP53: MUT" },
      { any: [
        { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "=", value: "A" },
        { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "=", value: "B" },
        { kind: "clinical", attribute: "SUBTYPE", per: "patient", op: "=", value: "C" },
      ] },
    ]);
  });

  test("overlapCheckDef is omitted with only 1 named arm — nothing to overlap with", async () => {
    const dist = cat([{ v: "A", n: 100 }, { v: "B", n: 90 }, { v: "C", n: 5 }]);
    const r = await resolveSplitBy(sb({ maxArms: 2, minCount: 10 }), [], BASE, async () => dist);
    assert.equal(r.arms.map((a) => a.name.split(": ")[1]).filter((n) => n !== "Other").length, 1);
    assert.equal(r.overlapCheckDef, undefined);
  });
});

describe("resolveSplitBy: oql mode", () => {
  const sbOql = (over: Partial<SplitBy> = {}): SplitBy => ({ cohort: "base", oql: ["TP53: MUT", "KRAS: MUT"], ...over });
  const noDistribution = async (): Promise<AttributeDistribution> => { throw new Error("should not be called"); };

  test("produces one arm per query, plus a trailing Other arm for whoever matches none", async () => {
    const r = await resolveSplitBy(sbOql(), [], BASE, noDistribution);
    assert.deepEqual(r.arms.map((a) => a.name), [
      "base — TP53: MUT", "base — KRAS: MUT", "base — Other"
    ]);
    assert.equal(r.otherArmName, "base — Other");
    assert.deepEqual(r.oql, ["TP53: MUT", "KRAS: MUT"]);
  });

  test("each named arm's def splices in the base cohort's own clauses plus that one query as an OQL leaf", async () => {
    const r = await resolveSplitBy(sbOql(), [], BASE, noDistribution);
    assert.deepEqual(r.arms[0].def.all, [{ kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "TP53: MUT" }]);
    assert.deepEqual(r.arms[1].def.all, [{ kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "KRAS: MUT" }]);
  });

  test("the Other arm's def negates \"any of\" every query given", async () => {
    const r = await resolveSplitBy(sbOql(), [], BASE, noDistribution);
    const other = r.arms.find((a) => a.name === "base — Other")!;
    assert.deepEqual(other.def.all, [
      { kind: "oql", q: "TP53: MUT" },
      { not: { any: [{ kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "KRAS: MUT" }] } },
    ]);
  });

  test("overlapCheckDef matches any of the named queries — never Other", async () => {
    const r = await resolveSplitBy(sbOql(), [], BASE, noDistribution);
    assert.deepEqual(r.overlapCheckDef!.all, [
      { kind: "oql", q: "TP53: MUT" },
      { any: [{ kind: "oql", q: "TP53: MUT" }, { kind: "oql", q: "KRAS: MUT" }] },
    ]);
  });

  test("a single query still works — no overlap possible, so overlapCheckDef is omitted", async () => {
    const r = await resolveSplitBy(sbOql({ oql: ["TP53: MUT"] }), [], BASE, noDistribution);
    assert.equal(r.arms.length, 2); // the query's arm + Other
    assert.equal(r.overlapCheckDef, undefined);
  });

  test("whitespace-only and duplicate-after-trim entries are dropped before counting", async () => {
    const r = await resolveSplitBy(sbOql({ oql: [" TP53: MUT ", "  ", "KRAS: MUT"] }), [], BASE, noDistribution);
    assert.deepEqual(r.arms.map((a) => a.name), ["base — TP53: MUT", "base — KRAS: MUT", "base — Other"]);
  });

  test("an empty oql list is refused", async () => {
    await assert.rejects(() => resolveSplitBy(sbOql({ oql: [] }), [], BASE, noDistribution), /needs at least 1 query/);
  });

  test("more queries than the arm ceiling is refused", async () => {
    const many = Array.from({ length: SPLIT_BY_MAX_ARMS_CEILING + 1 }, (_, i) => "GENE" + i + ": MUT");
    await assert.rejects(() => resolveSplitBy(sbOql({ oql: many }), [], BASE, noDistribution), /takes at most/);
  });

  test("invalid OQL syntax is refused with the offending query named", async () => {
    await assert.rejects(
      () => resolveSplitBy(sbOql({ oql: ["not valid oql {{{"] }), [], BASE, noDistribution),
      /not valid OQL/);
  });

  test("maxArms alongside oql is refused, not silently ignored", async () => {
    await assert.rejects(() => resolveSplitBy(sbOql({ maxArms: 4 }), [], BASE, noDistribution), /maxArms.*only apply.*attribute/);
  });

  test("minCount alongside oql is refused, not silently ignored", async () => {
    await assert.rejects(() => resolveSplitBy(sbOql({ minCount: 5 }), [], BASE, noDistribution), /minCount.*only apply.*attribute/);
  });

  test("an arm name colliding with an existing document cohort is refused", async () => {
    await assert.rejects(
      () => resolveSplitBy(sbOql(), ["base — TP53: MUT"], BASE, noDistribution),
      /same name as an existing cohort/);
  });
});

describe("resolveSplitBy: gene mode", () => {
  const sbGene = (over: Partial<SplitBy> = {}): SplitBy => ({ cohort: "base", gene: "TP53", ...over });
  // never called in gene mode — proves it, rather than merely not testing it
  const noDistribution = async (): Promise<AttributeDistribution> => { throw new Error("should not be called"); };

  test("produces exactly two arms — Mutated and Not mutated — via OQL, no distribution lookup", async () => {
    const r = await resolveSplitBy(sbGene(), [], BASE, noDistribution);
    assert.deepEqual(r.arms.map((a) => a.name), ["base — TP53: Mutated", "base — TP53: Not mutated"]);
    assert.deepEqual(r.otherValues, []);
  });

  test("the Mutated arm's def splices in the base cohort's own clauses plus a plain OQL leaf", async () => {
    const r = await resolveSplitBy(sbGene(), [], BASE, noDistribution);
    assert.deepEqual(r.arms[0].def.all, [
      { kind: "oql", q: "TP53: MUT" },
      { kind: "oql", q: "TP53: MUT" },
    ]);
  });

  test("the Not-mutated arm's def negates the same OQL leaf", async () => {
    const r = await resolveSplitBy(sbGene(), [], BASE, noDistribution);
    assert.deepEqual(r.arms[1].def.all, [
      { kind: "oql", q: "TP53: MUT" },
      { not: { kind: "oql", q: "TP53: MUT" } },
    ]);
  });

  test("the gene symbol is trimmed and uppercased", async () => {
    const r = await resolveSplitBy(sbGene({ gene: "  tp53  " }), [], BASE, noDistribution);
    assert.equal(r.arms[0].name, "base — TP53: Mutated");
  });

  test("an invalid gene symbol is refused", async () => {
    await assert.rejects(() => resolveSplitBy(sbGene({ gene: "not a gene!" }), [], BASE, noDistribution),
      /not a valid gene symbol/);
  });

  test("maxArms alongside gene is refused, not silently ignored", async () => {
    await assert.rejects(() => resolveSplitBy(sbGene({ maxArms: 8 }), [], BASE, noDistribution),
      /maxArms\/minCount only apply when splitting by attribute/);
  });

  test("minCount alongside gene is refused, not silently ignored", async () => {
    await assert.rejects(() => resolveSplitBy(sbGene({ minCount: 10 }), [], BASE, noDistribution),
      /maxArms\/minCount only apply when splitting by attribute/);
  });

  test("an arm name colliding with an existing document cohort is refused", async () => {
    await assert.rejects(
      () => resolveSplitBy(sbGene(), ["base — TP53: Mutated"], BASE, noDistribution),
      /same name as an existing cohort/);
  });
});
