// The portal's two percent formats on the Download tab's gene alteration frequency
// (RDL-2.3, RDL-2.4, RDL-2.5, RDL-STM-2): getPercentage for the table text, percentAltered for the download value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalPercentage, portalPercentAltered } from "../lib/chart/format.ts";

const percentage: [string, number, string][] = [
  ["G1", 0, "0%"],
  ["G2", 0.004, "<1%"],
  ["G3", 0.0099, "<1%"],
  ["G4", 0.01, "1%"],
  ["G5", 408 / 594, "69%"],
  ["G6", 0.025, "3%"],
  ["G7", 0.374, "37%"],
  ["G8", 1, "100%"],
];

for (const [id, proportion, expected] of percentage) {
  test(id + ": portalPercentage(" + proportion + ") is " + expected, () => {
    assert.equal(portalPercentage(proportion), expected);
  });
}

const altered: [string, number, number, string][] = [
  ["P1", 5, 0, "N/P"],
  ["P2", 0, 10, "0%"],
  ["P3", 1, 40, "2.5%"],
  ["P4", 1, 50, "2%"],
  ["P5", 3, 100, "3%"],
  ["P6", 29, 1000, "2.9%"],
  ["P7", 408, 594, "69%"],
  ["P8", 1, 3, "33%"],
  ["P9", 1, 2500, "0%"],
  ["P10", 1, 1000, "0.1%"],
  ["P11", 10, 10, "100%"],
];

for (const [id, a, s, expected] of altered) {
  test(id + ": portalPercentAltered(" + a + ", " + s + ") is " + expected, () => {
    assert.equal(portalPercentAltered(a, s), expected);
  });
}
