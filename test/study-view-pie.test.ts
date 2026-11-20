// The Study View pie (STS-PIE-2, STS-PIE-3, STS-PIE-7), from docs/legacy-spec/30-study-summary.md §3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PIE_AREA, PIE_UNSELECTED, pieLabelFits, pieRadius } from "../lib/study-view-pie.ts";
import { portalPieCount } from "../lib/chart/format.ts";

test("PIE-2: a 1 × 1 card's pie, radius min(w, h) / 2 − 20", () => {
  assert.deepEqual(PIE_AREA, { w: 193, h: 150 });
  assert.equal(pieRadius(PIE_AREA.w, PIE_AREA.h), 55);
});

test("PIE-3: a slice past a quarter always shows its count; a smaller one only where it fits", () => {
  assert.equal(pieLabelFits(0.26, 55, 500), true);
  assert.equal(pieLabelFits(0.25, 55, 500), false, "a quarter exactly is held to the fit");
  // tan(π·0.1/2)·(55/5)·2 = 3.48 px: no room for a label
  assert.equal(pieLabelFits(0.1, 55, 10), false);
  // tan(π·0.2/2)·22 = 7.15
  assert.equal(pieLabelFits(0.2, 55, 7), true);
  assert.equal(pieLabelFits(0.2, 55, 8), false);
});

test("PIE-3: the count as numeral 0.[0]a, upper-cased", () => {
  assert.equal(portalPieCount(312), "312");
  assert.equal(portalPieCount(1234), "1.2K");
  assert.equal(portalPieCount(1000), "1K");
  assert.equal(portalPieCount(1500000), "1.5M");
  assert.equal(portalPieCount(0), "0");
});

test("PIE-7: values left out of the chart's filter are grey at half opacity", () => {
  assert.deepEqual(PIE_UNSELECTED, { fill: "#D3D3D3", opacity: 0.5 });
});
