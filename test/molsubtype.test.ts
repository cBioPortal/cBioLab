// The molecular-subtype view's group pooling, on fixed inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { molTopGroups, POLE_HOTSPOTS } from "../lib/views/molsubtype.ts";

const g = (counts: number[], nc = 0): { counts: number[]; classified: number; notClassifiable: number; why: Record<string, number> } => ({ counts, classified: counts.reduce((a, b) => a + b, 0), notClassifiable: nc, why: nc ? { "no MSI call": nc } : {} });

test("the largest groups are kept and the rest pooled into a named Other, counts and reasons summed", () => {
  const groups = new Map([["EUR", g([5, 10, 20, 30], 3)], ["AFR", g([1, 2, 15, 3], 1)], ["EAS", g([1, 1, 2, 2])], ["SAS", g([0, 1, 1, 1], 2)]]);
  const r = molTopGroups(groups, 2, 4);
  assert.deepEqual(r.groups.map((x) => x.label), ["EUR", "AFR", "Other (2)"]);
  assert.deepEqual(r.groups[2].counts, [1, 2, 3, 3]);
  assert.equal(r.groups[2].notClassifiable, 2);
  assert.deepEqual(r.groups[2].why, { "no MSI call": 2 });
  assert.deepEqual(r.pooled, ["EAS", "SAS"]);
});

test("the POLE hotspots are protein changes the SQL accepts", () => {
  for (const h of POLE_HOTSPOTS) assert.match(h, /^[A-Z][0-9]{1,5}[A-Z*]$/);
  assert.ok(POLE_HOTSPOTS.includes("P286R") && POLE_HOTSPOTS.includes("V411L"));
});
