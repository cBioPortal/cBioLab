// The driver-annotation settings (lib/driver-settings.ts): defaults as cBioPortal's server config
// sets them, loud refusal of what this warehouse cannot answer, the one per-event rule the
// oncoprint applies, and the same rule as SQL for views that classify in the database. Then the
// plot's Driver-vs-VUS axis and its split mutation types (lib/plot.ts), the plot runner carrying
// the view's settings onto its axes, and the Results page sharing one setting across its tabs.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveDrivers, compactDrivers, isDriverEvent, driverSourceText, isGermlineStatus, driversOf, withDrivers, forData } from "../lib/driver-settings.ts";
import { driverCondSql, germlineCondSql } from "../lib/driver-sql.ts";
import { axisSelect, axisLabel, categoryColor } from "../lib/plot.ts";
import { withDrivers as plotWithDrivers } from "../lib/views/plot/run.ts";
import { syncDrivers } from "../app/portal/results-layout.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import type { View } from "../lib/types.ts";

test("defaults: OncoKB, custom calls and every tier count; nothing is hidden", () => {
  assert.deepEqual(resolveDrivers(undefined), { oncokb: true, custom: true, tiers: null, annotated: true, hideVus: false, hideGermline: false });
  assert.deepEqual(resolveDrivers({ tiers: ["Tier 2", "Tier 1", "Tier 2"] }).tiers, ["Tier 2", "Tier 1"]);
  // no source on: nothing is told apart, so there is nothing to hide (the portal disables the box)
  const off = resolveDrivers({ oncokb: false, custom: false, tiers: [], hideVus: true });
  assert.equal(off.annotated, false);
  assert.equal(off.hideVus, false);
  assert.equal(resolveDrivers({ oncokb: false, custom: false }).annotated, true, "tiers omitted: every tier still counts");
});

test("what this warehouse cannot answer, or a misspelt setting, is refused by name", () => {
  assert.throws(() => resolveDrivers({ hotspots: true }), /Cancer Hotspots is not loaded.*oncokb.*custom.*tiers/s);
  assert.equal(resolveDrivers({ hotspots: false }).oncokb, true);
  assert.throws(() => resolveDrivers({ hideVUS: true } as never), /unknown setting 'hideVUS' \(accepted: oncokb, hotspots, custom, tiers, hideVus, hideGermline\)/);
  assert.throws(() => resolveDrivers({ oncokb: "yes" } as never), /drivers.oncokb must be true or false/);
  assert.throws(() => resolveDrivers({ tiers: "Tier 1" } as never), /list of cbp_driver_tiers values/);
  assert.throws(() => resolveDrivers({ tiers: [""] }), /list of cbp_driver_tiers values/);
  assert.throws(() => resolveDrivers({ tiers: Array.from({ length: 51 }, (_, i) => "T" + i) }), /at most 50 tiers; this names 51/);
  assert.throws(() => resolveDrivers("x" as never), /drivers must be an object/);
});

test("every tier is a source only where the data has a tier", () => {
  const offBoth = resolveDrivers({ oncokb: false, custom: false, hideVus: true });
  assert.deepEqual(forData(offBoth, false), { ...offBoth, annotated: false, hideVus: false });
  assert.equal(forData(offBoth, true), offBoth, "with tiers in the data they count");
  const some = resolveDrivers(undefined);
  assert.equal(forData(some, false), some, "another source is on");
  const named = resolveDrivers({ oncokb: false, custom: false, tiers: ["A"] });
  assert.equal(forData(named, false), named, "named tiers are the reader's choice");
});

test("compactDrivers writes only what differs from the defaults", () => {
  assert.equal(compactDrivers({ oncokb: true, custom: true, hideVus: false }), undefined);
  assert.deepEqual(compactDrivers({ oncokb: false, tiers: [], hideGermline: true }), { oncokb: false, tiers: [], hideGermline: true });
});

test("the rule: any source on that calls it; a passenger call does not overrule OncoKB", () => {
  const all = resolveDrivers(undefined);
  const yes = () => true, no = () => false;
  assert.equal(isDriverEvent({}, all, yes), true, "OncoKB alone");
  assert.equal(isDriverEvent({ df: "Putative_Passenger" }, all, yes), true, "a passenger call is not a veto, as in the portal");
  assert.equal(isDriverEvent({ df: "Putative_Driver" }, all, no), true);
  assert.equal(isDriverEvent({ df: "putative_driver" }, all, no), false, "the portal matches Putative_Driver exactly");
  assert.equal(isDriverEvent({ df: "Unknown" }, all, no), false);
  assert.equal(isDriverEvent({ dt: "Tier 3" }, all, no), true, "every tier counts by default");
  const t1 = resolveDrivers({ tiers: ["Tier 1"] });
  assert.equal(isDriverEvent({ dt: "Tier 3" }, t1, no), false);
  assert.equal(isDriverEvent({ dt: "Tier 1" }, t1, no), true);
  const noOnco = resolveDrivers({ oncokb: false });
  let asked = false;
  assert.equal(isDriverEvent({}, noOnco, () => (asked = true)), false);
  assert.equal(asked, false, "OncoKB is not consulted when it is off");
  assert.equal(isDriverEvent({ df: "Putative_Driver" }, resolveDrivers({ custom: false }), no), false);
});

test("germline is the portal's /Germline/i on the mutation status", () => {
  for (const s of ["Germline", "GERMLINE", "germline", "likely germline"]) assert.equal(isGermlineStatus(s), true, s);
  for (const s of ["Somatic", "", null, "Unknown", "SOMATIC_VS_POOL"]) assert.equal(isGermlineStatus(s), false, String(s));
  assert.equal(germlineCondSql("g"), "(g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0)");
});

test("the rule as SQL: the sources that are on, OR'd; none is 0", () => {
  const sql = driverCondSql(resolveDrivers({ tiers: ["Tier 1", "it's"] }), "v7.5", "g");
  assert.match(sql, /g\.driver_filter = 'Putative_Driver'/);
  assert.match(sql, /g\.driver_tiers_filter IN \('Tier 1', 'it\\'s'\)/, "tier values reach SQL only through sq()");
  assert.match(sql, /oncokb_version = 'v7\.5' AND is_driver/);
  assert.match(driverCondSql(resolveDrivers(undefined), "v"), /driver_tiers_filter != ''/);
  assert.doesNotMatch(driverCondSql(resolveDrivers(undefined), null), /oncokb_annotation/, "no pin: OncoKB adds nothing, and the caller says so");
  assert.equal(driverCondSql(resolveDrivers({ oncokb: false, custom: false, tiers: [] }), "v"), "0");
});

test("the source a caption names", () => {
  assert.equal(driverSourceText(resolveDrivers({ oncokb: false, custom: false, tiers: [] }), null), "none — no driver source is switched on, so nothing is called a driver");
  assert.equal(driverSourceText(resolveDrivers({ custom: false, tiers: ["A"] }), "OncoKB v1 (pinned)"), "OncoKB v1 (pinned) + custom driver tiers A");
});

const ctx = { study: "s", db: "db", unit: "sample" as const, cohortSql: "SELECT pid, sid FROM c", oncokbPin: "v7.5" };

test("plot: Driver vs VUS per case, by the view's sources", () => {
  const sql = axisSelect({ source: "alteration", gene: "TP53", by: "driver", drivers: { custom: false } }, ctx, "cat");
  assert.match(sql, /countIf\(g\.variant_type = 'mutation' AND g\.drv = 1\) > 0, 'Driver', 'VUS'/);
  assert.match(sql, /toUInt8\(\(driver_tiers_filter != ''/);
  assert.doesNotMatch(sql, /driver_filter = 'Putative_Driver'/, "custom calls are off");
  assert.match(sql, /oncokb_version = 'v7\.5'/);
  assert.equal(axisLabel({ source: "alteration", gene: "TP53", by: "driver" }), "TP53 driver vs VUS");
  // OncoKB on with no store to read: refused rather than silently calling nothing
  assert.throws(() => axisSelect({ source: "alteration", gene: "TP53", by: "driver" }, { ...ctx, oncokbPin: null }, "cat"),
    /needs the version-pinned OncoKB store.*switch drivers\.oncokb off/s);
  assert.doesNotThrow(() => axisSelect({ source: "alteration", gene: "TP53", by: "driver", drivers: { oncokb: false } }, { ...ctx, oncokbPin: null }, "cat"));
});

test("plot: a mutation type splits into (Driver) and (VUS) only when the axis holds settings with a source on", () => {
  const plain = axisSelect({ source: "alteration", gene: "TP53", by: "mutationType" }, ctx, "cat");
  assert.doesNotMatch(plain, /\(Driver\)|drv/);
  const split = axisSelect({ source: "alteration", gene: "TP53", by: "mutationType", drivers: {} }, ctx, "cat");
  assert.match(split, /' \(Driver\)'/);
  assert.match(split, /' \(VUS\)'/);
  const none = axisSelect({ source: "alteration", gene: "TP53", by: "mutationType", drivers: { oncokb: false, custom: false, tiers: [] } }, ctx, "cat");
  assert.doesNotMatch(none, /\(Driver\)/, "no source on: nothing to split by");
});

test("plot colours: a split class takes the oncoprint's driver or VUS colour for its class", () => {
  const missense = STYLE.glyph.mutation.priority.find((m) => m.bit === "MISSENSE")!;
  assert.equal(categoryColor("Missense (Driver)"), missense.color);
  assert.equal(categoryColor("Missense (VUS)"), missense.vus);
  assert.equal(categoryColor("Truncating (VUS)"), STYLE.glyph.mutation.priority.find((m) => m.bit === "TRUNCATING")!.vus);
  assert.equal(categoryColor("Multiple (Driver)"), STYLE.palette.text);
  assert.equal(categoryColor("Driver"), STYLE.glyph.mutation.single.color);
  assert.equal(categoryColor("VUS"), STYLE.glyph.mutation.single.vus);
});

test("the plot runner puts the view's sources on each mutation axis, never its filters", () => {
  const x = { source: "alteration" as const, gene: "TP53", by: "mutationType" as const };
  const y = { source: "clinical" as const, attribute: "AGE" };
  assert.deepEqual(plotWithDrivers({ x, y }, undefined), { x, y }, "no settings: the axes as given");
  const r = plotWithDrivers({ x, y, colorBy: { source: "alteration", gene: "KRAS", by: "driver" } }, { oncokb: false, hideVus: true, hideGermline: true });
  assert.deepEqual(r.x, { ...x, drivers: { oncokb: false } });
  assert.deepEqual(r.y, y);
  assert.deepEqual(r.colorBy, { source: "alteration", gene: "KRAS", by: "driver", drivers: { oncokb: false } });
  assert.throws(() => plotWithDrivers({ x, y }, { hotspots: true }), /Cancer Hotspots/);
  // an axis that names its own settings keeps them
  const own = { ...x, drivers: { custom: false } };
  assert.deepEqual(plotWithDrivers({ x: own, y }, { oncokb: false }).x, own);
});

test("an oncoprint view's settings: the older display spellings read, and dropped on write", () => {
  assert.deepEqual(driversOf({ display: { annotate: "none", hideVUS: true } }), { oncokb: false, custom: false, tiers: [], hideVus: true });
  assert.deepEqual(driversOf({ display: { hideVUS: true }, drivers: { hideVus: false } }), undefined);
  const v = withDrivers({ kind: "oncoprint", display: { annotate: "none", gaps: "pct" } }, { hideGermline: true });
  assert.deepEqual(v, { kind: "oncoprint", display: { gaps: "pct" }, drivers: { hideGermline: true } });
  assert.deepEqual(withDrivers({ kind: "oncoprint", display: { hideVUS: true }, drivers: { oncokb: false } }, undefined), { kind: "oncoprint" });
});

test("Results: a change to one view's settings is made on every view that takes them", () => {
  const onco = { kind: "oncoprint", genes: ["TP53"] } as unknown as View;
  const plot = { kind: "plot", x: {}, y: {}, drivers: {} } as unknown as View;
  const lone = { kind: "plot", x: {}, y: {} } as unknown as View;
  const table = { kind: "mutations", gene: "TP53" } as unknown as View;
  const before = [onco, plot, lone, table];
  // from the oncoprint: the sources and the filters; the plot keeps sources alone
  const after = syncDrivers(before, [withDrivers(onco as never, { custom: false, hideVus: true }) as View, plot, lone, table]);
  assert.deepEqual((after[0] as never as { drivers: unknown }).drivers, { custom: false, hideVus: true });
  assert.deepEqual((after[1] as never as { drivers: unknown }).drivers, { custom: false });
  assert.equal(after[2], lone, "a plot that holds no settings is left alone");
  assert.equal(after[3], table);
  // from the plot: its sources reach the oncoprint, whose filters stay as they were
  const fromPlot = syncDrivers(after, [after[0], { ...after[1], drivers: { oncokb: false } } as View, lone, table]);
  assert.deepEqual((fromPlot[0] as never as { drivers: unknown }).drivers, { oncokb: false, hideVus: true });
  // an edit that changes no setting changes nothing else
  const other = [{ ...onco, sort: ["TP53"] } as View, plot, lone, table];
  assert.equal(syncDrivers(before, other), other);
});
