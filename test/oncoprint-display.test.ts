// Viewing options and sort keys live in the spec, so they are validated there — in the pure
// module, so a CLI drawing local tables never has to reach the database. Defaults
// filled in, unknown options and bad values rejected loudly rather than ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDisplay, normalizeSort } from "../lib/oncoprint-assemble.ts";

test("display defaults", () => {
  assert.deepEqual(normalizeDisplay(undefined), { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all" });
  assert.deepEqual(normalizeDisplay({ showUnaltered: false, gaps: "pct" }),
    { showUnaltered: false, whitespace: true, gaps: "pct", clinicalLegends: "all" });
});

test("display rejects unknown options and bad values, naming what is accepted", () => {
  assert.throws(() => normalizeDisplay({ showUnalterd: true } as never), /unknown option 'showUnalterd'.*showUnaltered/s);
  assert.throws(() => normalizeDisplay({ gaps: "yes" } as never), /display.gaps.*none, gaps, pct/);
  assert.throws(() => normalizeDisplay({ whitespace: "yes" } as never), /must be true or false/);
  assert.throws(() => normalizeDisplay({ colors: { TYPE: { x: "red" } } }), /not a #rrggbb colour/);
  assert.throws(() => normalizeDisplay({ colors: { TYPE: "#ff0000" } } as never), /must be \{value: color\}/);
});

test("style and colour overrides pass through, only when present", () => {
  assert.equal("style" in normalizeDisplay({}), false);
  const d = normalizeDisplay({ style: { palette: { unaltered: "#f0f0f0" } }, colors: { TYPE: { Lung: "#0072B2" } } });
  assert.deepEqual(d.style, { palette: { unaltered: "#f0f0f0" } });
  assert.deepEqual(d.colors, { TYPE: { Lung: "#0072B2" } });
});

test("sort keys: strings, the '-' prefix, objects, the default, and the cap of four", () => {
  assert.deepEqual(normalizeSort(undefined), [{ track: "genomic", dir: "asc" }]);
  assert.deepEqual(normalizeSort([]), [{ track: "genomic", dir: "asc" }]);
  assert.deepEqual(normalizeSort(["CANCER_TYPE", "-AGE"]), [{ track: "CANCER_TYPE", dir: "asc" }, { track: "AGE", dir: "desc" }]);
  assert.deepEqual(normalizeSort([{ track: "AGE", dir: "desc" }, { track: "SEX" }]), [{ track: "AGE", dir: "desc" }, { track: "SEX", dir: "asc" }]);
  assert.equal(normalizeSort(["a", "b", "c", "d", "e"]).length, 4);
});
