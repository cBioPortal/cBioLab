// Viewing options and sort keys live in the spec, so they are validated there — in the pure
// module, so a CLI drawing local tables never has to reach the database. Defaults
// filled in, unknown options and bad values rejected loudly rather than ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDisplay, normalizeSort } from "../lib/oncoprint-assemble.ts";

test("display defaults", () => {
  const drivers = { oncokb: true, custom: true, tiers: null, annotated: true, hideVus: false, hideGermline: false };
  assert.deepEqual(normalizeDisplay(undefined), { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true, colorByGermline: true,
    hideVUS: false, annotate: "oncokb", hideGermline: false, drivers, whiteBackground: false });
  assert.deepEqual(normalizeDisplay({ showUnaltered: false, gaps: "pct" }),
    { showUnaltered: false, whitespace: true, gaps: "pct", clinicalLegends: "all", colorByType: true, colorByGermline: true,
      hideVUS: false, annotate: "oncokb", hideGermline: false, drivers, whiteBackground: false });
  assert.equal(normalizeDisplay({ annotate: "none" }).annotate, "none");
  assert.throws(() => normalizeDisplay({ annotate: "hotspots" } as never), /annotate.*oncokb, none/);
});

test("display: driver settings fold in, the older spellings read as their defaults", () => {
  // annotate "none" is every source off, so nothing is told apart and hiding VUS has nothing to hide
  const off = normalizeDisplay({ annotate: "none", hideVUS: true });
  assert.equal(off.annotate, "none");
  assert.equal(off.hideVUS, false);
  assert.equal(normalizeDisplay({ hideVUS: true }).hideVUS, true);
  // the view's settings override the older keys
  assert.equal(normalizeDisplay({ annotate: "none" }, { custom: true }).annotate, "oncokb");
  assert.equal(normalizeDisplay({ hideVUS: true }, { hideVus: false }).hideVUS, false);
  const d = normalizeDisplay(undefined, { oncokb: false, custom: false, tiers: ["Tier 1"], hideGermline: true });
  assert.deepEqual(d.drivers, { oncokb: false, custom: false, tiers: ["Tier 1"], annotated: true, hideVus: false, hideGermline: true });
  assert.equal(d.hideGermline, true);
  assert.throws(() => normalizeDisplay(undefined, { hotspots: true }), /Cancer Hotspots is not loaded/);
  assert.throws(() => normalizeDisplay(undefined, { hideVUS: true } as never), /unknown setting 'hideVUS'.*hideVus/);
  assert.throws(() => normalizeDisplay(undefined, [] as never), /drivers must be an object/);
  assert.throws(() => normalizeDisplay({ colorByGermline: "no" } as never), /must be true or false/);
});

test("display rejects unknown options and bad values, naming what is accepted", () => {
  assert.throws(() => normalizeDisplay({ showUnalterd: true } as never), /unknown option 'showUnalterd'.*showUnaltered/s);
  assert.throws(() => normalizeDisplay({ gaps: "yes" } as never), /display.gaps.*none, gaps, pct, pct-left/);
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
