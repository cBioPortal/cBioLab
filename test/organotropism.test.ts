// The organotropism view's per-cell test, on fixed inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orgCell, flagLabel } from "../lib/views/organotropism/run.ts";
import { cochranMantelHaenszel } from "../lib/stats.ts";

test("a cell's strata become 2×2 tables, pooled for display and tested by CMH", () => {
  const strata = [{ n: 100, withSite: 30, altered: 20, both: 10 }, { n: 50, withSite: 10, altered: 25, both: 8 }];
  const c = orgCell("LIVER", "TP53", strata, 5);
  assert.deepEqual([c.withSite, c.withAltered, c.without, c.withoutAltered], [40, 18, 110, 27]);
  const t = cochranMantelHaenszel([{ a: 10, b: 10, c: 20, d: 60 }, { a: 8, b: 17, c: 2, d: 23 }]);
  assert.equal(c.p, t.p);
  assert.equal(c.or, t.oddsRatio);
  assert.equal(c.strata, 2);
  assert.ok(c.log2Or! > 0);
});

test("a cell short of altered, with-site or without-site patients is not tested", () => {
  assert.equal(orgCell("BONE", "EGFR", [{ n: 100, withSite: 30, altered: 4, both: 2 }], 5).p, null);
  assert.equal(orgCell("BONE", "EGFR", [{ n: 100, withSite: 97, altered: 40, both: 39 }], 5).p, null);
  assert.equal(orgCell("BONE", "EGFR", [], 5).withSite, 0);
});

test("flag suffixes read as labels", () => {
  assert.equal(flagLabel("CNS_BRAIN"), "CNS Brain");
  assert.equal(flagLabel("ADRENAL_GLAND"), "Adrenal Gland");
});
