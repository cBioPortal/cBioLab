// The molecular-subtype view's group pooling, on fixed inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { molTopGroups, POLE_HOTSPOTS } from "../lib/views/molsubtype/run.ts";
import { kindText } from "./support/kind-text.ts";
import { molsubtypeKind } from "../lib/views/molsubtype/kind.ts";

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

test("no test between groups or cohorts, a median never reached, and why survival was not tested", () => {
  const [t] = kindText(molsubtypeKind, { molsubtype: { classifierLabel: "ProMisE", msi: "MSI score", p53: "TP53 mutation", subtypes: ["POLE", "NSMP"], by: "AGE",
    panels: [{ cohort: "A", counts: [1, 3], classified: 4, notClassifiable: 1 }], cohortTest: null,
    survival: [{ cohort: "A", curves: [{ subtype: "POLE", n: 1, events: 0, median: null }], logrank: null, noTest: "too few deaths to test" }] } });
  assert.ok(t.includes("A (4 classified, 1 not classifiable): POLE 1 (25.0%), NSMP 3 (75.0%)"), t);
  assert.ok(!/chi-squared/.test(t), t);
  assert.ok(t.includes("POLE n=1, 0 deaths, median not reached; too few deaths to test"), t);
});
