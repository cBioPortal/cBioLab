// OQL DRIVER in the cohorts follows the page's driver settings: an oql clause may carry `drivers`
// (lib/driver-settings.ts), which compileCohortDef checks for shape and for the Genome Nexus pins
// Cancer Hotspots needs; the Results page's Altered and Unaltered cohorts carry the oncoprint
// view's settings when the query has DRIVER, and follow them as they change. Row ids are the case
// table's (D*). The SQL itself is run against the fixture in scripts/check-hotspot-drivers.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { compileCohortDef } from "../lib/cohort2.ts";
import { oqlCasesSql } from "../lib/oql.ts";
import * as RL from "../app/portal/results-layout.ts";
import { withDrivers, type DriverSettings } from "../lib/driver-settings.ts";
import type { AnalysisDoc, CohortDef, View } from "../lib/types.ts";

// syncDriverCohorts and resultsGroups' third argument do not exist yet: read through the module so
// each test fails on its own rather than the whole file failing to load
const resultsGroups = RL.resultsGroups as unknown as (q: unknown, held: unknown, drivers?: DriverSettings) => { cohorts: Record<string, CohortDef>; unchecked: string[] };
const syncDriverCohorts = (doc: AnalysisDoc): AnalysisDoc => {
  const f = (RL as unknown as { syncDriverCohorts?: (d: AnalysisDoc) => AnalysisDoc }).syncDriverCohorts;
  assert.equal(typeof f, "function", "results-layout.ts exports syncDriverCohorts");
  return f!(doc);
};

const study = "s1", db = "cbio";
const PINS = { hg19: "x", hg38: null };
const compile = (clause: Record<string, unknown>, ctx: Record<string, unknown> = {}) =>
  compileCohortDef({ study, all: [{ kind: "oql", ...clause } as never] } as CohortDef, { oncokbPin: "v7.5", study, db, ...ctx } as never);

test("D11: an oql clause's drivers of the wrong shape is refused with resolveDrivers' message", () => {
  const q = "KRAS: MUT_DRIVER";
  assert.throws(() => compile({ q, drivers: "yes" }, { hotspotPins: PINS }), /drivers must be an object/);
  assert.throws(() => compile({ q, drivers: ["oncokb"] }, { hotspotPins: PINS }), /drivers must be an object/);
  assert.throws(() => compile({ q, drivers: { onkokb: false } }, { hotspotPins: PINS }), /drivers: unknown setting 'onkokb'/);
  assert.throws(() => compile({ q, drivers: { hotspots: "no" } }, { hotspotPins: PINS }), /drivers\.hotspots must be true or false/);
  assert.throws(() => compile({ q, drivers: { tiers: "Tier 1" } }, { hotspotPins: PINS }), /drivers\.tiers is a list/);
  // checked whatever the query: a clause without DRIVER still states its settings correctly
  assert.throws(() => compile({ q: "KRAS: MUT", drivers: { onkokb: false } }, { hotspotPins: PINS }), /drivers: unknown setting/);
});

test("D10: drivers asking for Cancer Hotspots need the Genome Nexus pins in the compile context", () => {
  const q = "KRAS: MUT_DRIVER";
  assert.throws(() => compile({ q, drivers: {} }), /Genome Nexus/i, "defaults ask for hotspots: refused without pins, never silently OncoKB-only");
  assert.throws(() => compile({ q, drivers: { oncokb: false } }), /Genome Nexus/i);
  assert.doesNotThrow(() => compile({ q, drivers: {} }, { hotspotPins: PINS }));
  assert.doesNotThrow(() => compile({ q, drivers: {} }, { hotspotPins: { hg19: null, hg38: "y" } }));
  assert.doesNotThrow(() => compile({ q, drivers: { hotspots: false } }), "hotspots off: no pins needed");
  assert.doesNotThrow(() => compile({ q, drivers: { hotspots: false, oncokb: false, custom: false, tiers: [] } }), "D4: every source off compiles");
  // standalone DRIVER and a range with DRIVER take the same rule (D7, D8)
  assert.throws(() => compile({ q: "KRAS: DRIVER", drivers: {} }), /Genome Nexus/i);
  assert.throws(() => compile({ q: "KRAS: MUT_(10-15)_DRIVER", drivers: {} }), /Genome Nexus/i);
  assert.doesNotThrow(() => compile({ q: "KRAS: DRIVER", drivers: {} }, { hotspotPins: PINS }));
  assert.doesNotThrow(() => compile({ q: "KRAS: MUT_(10-15)_DRIVER", drivers: {} }, { hotspotPins: PINS }));
});

test("D9: a clause without drivers compiles as today, with or without Genome Nexus pins", () => {
  for (const q of ["KRAS: MUT_DRIVER", "KRAS: DRIVER", "KRAS: MUT_(10-15)_DRIVER", "KRAS: MUT"]) {
    assert.doesNotThrow(() => compile({ q }), q);
    assert.equal(compile({ q }, { hotspotPins: PINS }), compile({ q }), q + ": the pins change nothing without drivers");
  }
});

const held = { every: ["MUTATION", "CNA", "SV"], some: [] };
const rq = (entries: string[]) => ({ studies: ["s"], filters: [], entries, genes: [...new Set(entries.map((e) => e.split(":")[0].trim()))] });
const oqlOf = (def: CohortDef) => (def.all || []).find((c) => (c as { kind?: string }).kind === "oql") as Record<string, unknown> | undefined;
const notOf = (def: CohortDef) => ((def.all || []).find((c) => (c as { not?: unknown }).not) as { not: Record<string, unknown> } | undefined)?.not;

test("D12: a query with DRIVER: Altered's and Unaltered's oql clause carry the page's driver settings", () => {
  for (const entries of [["KRAS: MUT_DRIVER"], ["TP53: DRIVER"], ["ERBB2: AMP_DRIVER"], ["BRAF: MUT_(500-600)_DRIVER"], ["KRAS", "TP53: MUT_DRIVER"]]) {
    const d = { hotspots: false, oncokb: false };
    const { cohorts } = resultsGroups(rq(entries), held, d);
    assert.deepEqual(oqlOf(cohorts.Altered), { kind: "oql", q: entries.join("; "), drivers: d }, entries.join("; "));
    assert.deepEqual(notOf(cohorts.Unaltered), { kind: "oql", q: entries.join("; "), drivers: d }, entries.join("; ") + " (Unaltered's not)");
    // no settings given: the defaults, stated
    const dflt = resultsGroups(rq(entries), held).cohorts;
    assert.deepEqual(oqlOf(dflt.Altered)!.drivers, {}, entries.join("; ") + " without settings");
    assert.deepEqual(notOf(dflt.Unaltered)!.drivers, {});
    assert.deepEqual(dflt.Queried.all, []);
  }
});

test("D13: a query without DRIVER carries no drivers, whatever the settings", () => {
  for (const entries of [["KRAS"], ["KRAS: MUT"], ["ERBB2: AMP", "TP53: MUT_(100-200)"], ["TP53: TRUNC"]]) {
    const { cohorts } = resultsGroups(rq(entries), held, { hotspots: false, oncokb: false });
    assert.ok(!("drivers" in oqlOf(cohorts.Altered)!), entries.join("; "));
    assert.ok(!("drivers" in notOf(cohorts.Unaltered)!), entries.join("; ") + " (Unaltered's not)");
  }
});

const data = { expr: null, cna: null, clinical: [], numeric: [], expressionAcross: true, held: { every: ["MUTATION", "CNA"], some: [] } } as unknown as Parameters<typeof RL.resultsLayout>[1];

test("D12/D13: the Results page's layout passes the oncoprint's settings (none yet: the defaults)", () => {
  const drv = RL.resultsLayout(rq(["KRAS: MUT_DRIVER"]) as never, data).doc.cohorts;
  assert.deepEqual(oqlOf(drv.Altered)!.drivers, {});
  assert.deepEqual(notOf(drv.Unaltered)!.drivers, {});
  const plain = RL.resultsLayout(rq(["KRAS: MUT"]) as never, data).doc.cohorts;
  assert.ok(!("drivers" in oqlOf(plain.Altered)!));
  assert.ok(!("drivers" in notOf(plain.Unaltered)!));
});

test("D14: syncDriverCohorts gives every DRIVER oql clause the oncoprint's settings, and leaves the rest", () => {
  const q = "KRAS: MUT_DRIVER";
  const profiled = { kind: "profiled", type: "MUTATION", genes: ["KRAS"] };
  const filter = { kind: "clinical", attribute: "SEX", values: ["Female"] };
  const other = { kind: "oql", q: "TP53: MUT" };
  const onco = withDrivers({ kind: "oncoprint", genes: ["KRAS"], cohorts: ["Queried"] } as never, { hotspots: false }) as unknown as View;
  const doc = {
    study: "s",
    cohorts: {
      Altered: { study: "s", all: [filter, { kind: "oql", q, drivers: {} }] },
      Unaltered: { study: "s", all: [filter, { not: { kind: "oql", q, drivers: {} } }, profiled] },
      Queried: { study: "s", all: [filter] },
      Mine: { study: "s", all: [other, { kind: "oql", q: "BRAF: DRIVER" }] },
    },
    views: [onco, { kind: "mutations", gene: "KRAS", cohorts: ["Queried"] } as unknown as View],
  } as unknown as AnalysisDoc;
  const out = syncDriverCohorts(doc);
  assert.deepEqual(out.cohorts.Altered.all, [filter, { kind: "oql", q, drivers: { hotspots: false } }]);
  assert.deepEqual(out.cohorts.Unaltered.all, [filter, { not: { kind: "oql", q, drivers: { hotspots: false } } }, profiled]);
  assert.deepEqual(out.cohorts.Queried, doc.cohorts.Queried);
  assert.deepEqual(out.cohorts.Mine.all, [other, { kind: "oql", q: "BRAF: DRIVER", drivers: { hotspots: false } }], "a DRIVER clause without settings takes them; one without DRIVER is left");
  assert.deepEqual(out.views, doc.views);
  // the oncoprint back to the defaults: the clauses state the defaults
  const back = syncDriverCohorts({ ...out, views: [withDrivers(onco as never, undefined) as unknown as View, ...out.views!.slice(1)] });
  assert.deepEqual(oqlOf(back.cohorts.Altered)!.drivers, {});
  assert.deepEqual(notOf(back.cohorts.Unaltered)!.drivers, {});
  assert.deepEqual(back.cohorts.Mine.all![0], other);
});

test("D15: syncDrivers carries hotspots from one view to the others, as it carries oncokb, custom and tiers", () => {
  const onco = { kind: "oncoprint", genes: ["TP53"] } as unknown as View;
  const plot = { kind: "plot", x: {}, y: {}, drivers: {} } as unknown as View;
  const onco2 = { kind: "oncoprint", genes: ["KRAS"] } as unknown as View;
  const before = [onco, plot, onco2];
  const after = RL.syncDrivers(before, [withDrivers(onco as never, { hotspots: false }) as View, plot, onco2]);
  assert.deepEqual((after[1] as unknown as { drivers: unknown }).drivers, { hotspots: false }, "the plot");
  assert.deepEqual((after[2] as unknown as { drivers: unknown }).drivers, { hotspots: false }, "another oncoprint");
  // from the plot back to the oncoprints
  const fromPlot = RL.syncDrivers(after, [after[0], { ...after[1], drivers: { hotspots: false, oncokb: false } } as View, after[2]]);
  assert.deepEqual((fromPlot[0] as unknown as { drivers: unknown }).drivers, { hotspots: false, oncokb: false });
  // hotspots back on: the others follow
  const on = RL.syncDrivers(after, [withDrivers(after[0] as never, undefined) as View, after[1], after[2]]);
  assert.deepEqual((on[1] as unknown as { drivers: unknown }).drivers, {});
  assert.equal((on[2] as unknown as { drivers?: unknown }).drivers, undefined);
});

test("D10/D11 (oqlCasesSql itself): settings asking for hotspots need the pins; malformed settings are refused", () => {
  const at = { oncokbPin: "v7.5", study: "s", db: "cbio", unit: "patient" as const };
  assert.throws(() => oqlCasesSql("KRAS: MUT_DRIVER", { ...at, drivers: {} }), /Genome Nexus/i);
  assert.doesNotThrow(() => oqlCasesSql("KRAS: MUT_DRIVER", { ...at, drivers: {}, hotspotPins: PINS }));
  assert.throws(() => oqlCasesSql("KRAS: MUT_DRIVER", { ...at, drivers: "yes" as never, hotspotPins: PINS }), /drivers must be an object/);
  assert.throws(() => oqlCasesSql("KRAS: MUT_DRIVER", { ...at, drivers: { onkokb: false } as never, hotspotPins: PINS }), /unknown setting 'onkokb'/);
});
