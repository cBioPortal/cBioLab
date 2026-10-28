// The driver-negative view's per-gene tests, on fixed inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dnegTest } from "../lib/views/drivernegative/run.ts";
import { fisherExact } from "../lib/stats.ts";

test("per gene: whole-exome patients join every gene's denominator, Fisher and BH, untested genes counted", () => {
  const altered = new Map<string, [number, number]>([["NTRK1", [12, 1]], ["TP53", [40, 60]], ["RARE", [1, 1]]]);
  const profiled = new Map<string, [number, number]>([["NTRK1", [90, 190]], ["TP53", [90, 190]]]);
  const { tested, untested } = dnegTest(altered, profiled, [10, 10], 5);
  assert.equal(untested, 1);
  const nt = tested.find((g) => g.gene === "NTRK1")!;
  assert.deepEqual(nt.profiled, [100, 200]);
  assert.equal(nt.p, fisherExact(12, 88, 1, 199));
  assert.ok(nt.log2Ratio! > 0 && nt.q >= nt.p);
  assert.equal(tested[0].gene, "NTRK1");
});

test("a gene profiled in only one group is not tested", () => {
  const { tested, untested } = dnegTest(new Map([["X", [6, 0]]]), new Map(), [0, 4], 5);
  assert.equal(tested.length, 0);
  assert.equal(untested, 1);
});
