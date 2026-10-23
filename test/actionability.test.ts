// The actionability view's grouping, on fixed inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { topGroups } from "../lib/views/actionability.ts";

test("the largest groups are kept and the rest pooled into a named Other, counts conserved", () => {
  const g = (n: number, l1: number) => ({ sequenced: n, levels: [l1, 0, 0, 0, 0, n - l1], resistance: [1, 0] });
  const { groups, pooled } = topGroups(new Map([["A", g(50, 10)], ["B", g(30, 3)], ["C", g(5, 1)], ["D", g(8, 2)]]), 2);
  assert.deepEqual(groups.map((x) => x.label), ["A", "B", "Other (2)"]);
  assert.deepEqual(pooled, ["D", "C"]);
  assert.equal(groups[2].sequenced, 13); assert.deepEqual(groups[2].levels, [3, 0, 0, 0, 0, 10]); assert.deepEqual(groups[2].resistance, [2, 0]);
  assert.equal(topGroups(new Map([["A", g(5, 1)]]), 3).pooled, undefined);
});
