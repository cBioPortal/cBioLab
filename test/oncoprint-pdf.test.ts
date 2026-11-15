// The oncoprint's PDF export (ONC-DL-2): the "Export image…" dialog's PDF format draws the same
// server SVG the SVG export saves onto one page its size (app/_oncoprint/pdf.ts), as the portal's
// svgToPdfDownload does (cbioportal-frontend-commons/src/lib/svgToPdfDownload.ts: a jsPDF page in
// points of the SVG's width × height, svg2pdf at scale 1, a font embedded so any character prints).
//
// Only the length helper is testable without a browser; the rest of the case table is checked from
// a real download in test/e2e/analysis-controls.cjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { svgLengthPt } from "../app/_oncoprint/pdf.ts";

const BROWSER = { skip: "browser: test/e2e/analysis-controls.cjs" };

describe("oncoprint PDF export", () => {
  describe("P10 svgLengthPt turns an SVG length into points (ours)", () => {
    test("inches: 8.5in is 612 pt, the default page width", () => {
      assert.equal(svgLengthPt("8.5in"), 612);
    });
    test("points pass through: 100pt is 100", () => {
      assert.equal(svgLengthPt("100pt"), 100);
    });
    test("a unitless length is CSS px, 0.75 pt each: 800 is 600", () => {
      assert.equal(svgLengthPt("800"), 600);
    });
    test("px is 0.75 pt: 800px is 600", () => {
      assert.equal(svgLengthPt("800px"), 600);
    });
    test("an empty string is NaN, not 0", () => {
      assert.ok(Number.isNaN(svgLengthPt("")), "got " + svgLengthPt(""));
    });
    test("a missing attribute (null) is NaN, not 0", () => {
      assert.ok(Number.isNaN(svgLengthPt(null)), "got " + svgLengthPt(null));
    });
    test("auto is NaN", () => {
      assert.ok(Number.isNaN(svgLengthPt("auto")), "got " + svgLengthPt("auto"));
    });
  });

  test("P1 the dialog's format list is PNG, SVG, PDF (ours; the portal puts PDF in its Download menu)", BROWSER);
  test("P2 the PDF has exactly one page", BROWSER);
  test("P3 the page is the SVG's width × height in points: 612 pt wide at 8.5 in", BROWSER);
  test("P4 landscape when wider than tall, else portrait; the MediaBox is width × height either way", BROWSER);
  test("P5 text stays text: the gene labels are extractable", BROWSER);
  test("P6 IBM Plex Sans is embedded as a FontFile2 (ours: our UI font, where the portal fetches FreeSans)", BROWSER);
  test("P7 the same figure as the SVG export: labels, gutter %, cells, legend", BROWSER);
  test("P8 the file is named oncoprint-<study>-<w>in.pdf (ours; the portal saves oncoprint.pdf)", BROWSER);
  test("P9 a failed server SVG shows the dialog's error and saves no file (ours)", BROWSER);
});
