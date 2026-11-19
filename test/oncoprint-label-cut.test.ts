// A track label in the OncoPrint's gutter (ONC-LY-2), from the legacy source (cbioportal-frontend @ cd8c6df):
//   LV = packages/oncoprintjs/src/js/oncoprintlabelview.ts: isNecessaryToShortenLabel 259-261 (longer
//        than getMaximumLabelLength), shortenLabelIfNecessary 262-268 (its first max − 3 characters
//        and "..."), getMaximumLabelLength 508-510 (18).
// Cases:
//   L1  18 characters or fewer: printed whole
//   L2  19 or more: the first 15 and "...", 18 in all
//   L3  a merged row keeps its brackets (ours alone: the portal's merged rows have none) and cuts
//       inside them by the same rule, 18 in all
//   L4  the server SVG prints the cut label
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { truncateLabel, trackLabelText } from "../lib/oncoprint-style.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";

describe("ONC-LY-2: the gutter's label cut", () => {
  test("L1 18 characters or fewer: whole", () => {
    assert.equal(truncateLabel("Profiled for ABCDE"), "Profiled for ABCDE");
    assert.equal(truncateLabel("KRAS"), "KRAS");
  });
  test("L2 past 18: the first 15 and \"...\"", () => {
    assert.equal(truncateLabel("Profiled for ABCDEF"), "Profiled for AB...");
    assert.equal(truncateLabel("Profiled for copy number alterations"), "Profiled for co...");
  });
  test("L3 a merged row: brackets kept, cut inside to 18 in all", () => {
    assert.equal(trackLabelText({ label: "TP53 pathway", members: ["TP53", "MDM2"] }), "[TP53 pathway]");
    assert.equal(trackLabelText({ label: "a very long pathway name", members: ["A", "B"] }), "[a very long p...]");
    assert.equal(trackLabelText({ label: "sixteen chars ok", members: ["A", "B"] }), "[sixteen chars ok]");
  });
  test("L4 the server SVG prints the cut label", () => {
    const svg = contractToSvg({
      study: "s", unit: "patient", groups: [{ name: "all", start: 0, count: 1 }], columns: ["P1"], stats: {},
      conventions: { cna: "", notProfiled: "", frequencyDenominator: "", annotation: "", lineGap: 0, sort: [] },
      tracks: [{ kind: "gene", label: "A_VERY_LONG_GENE_NAME_1", cells: [0], freqPct: 0 }]
    } as any);
    assert.match(svg, />A_VERY_LONG_GEN\.\.\.<\/text>/);
  });
});
