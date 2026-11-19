// MUT-LP-4: the lollipop's download offers SVG, PNG and PDF, in that order, named <GENE>_lollipop.<ext>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lollipopFilename, LOLLIPOP_FORMATS } from "../lib/lollipop.ts";

test("D1: the file is named <GENE>_lollipop, without the extension", () => {
  assert.equal(lollipopFilename("KRAS"), "KRAS_lollipop");
});

test("D2: the formats are SVG, PNG and PDF, in that order", () => {
  assert.deepEqual([...LOLLIPOP_FORMATS], ["svg", "png", "pdf"]);
});
