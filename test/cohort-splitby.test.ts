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
});
