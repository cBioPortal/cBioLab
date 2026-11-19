// The Download tab's DRIVER follows the page's driver settings (PR 8 of the OQL series): what needs no database.
// Written from the case table's rows (L*) before the code; legacy (cbioportal-frontend at cd8c6df):
//   DT = src/pages/resultsView/download/DownloadTab.tsx — the lists, matrix and case table come from the
//        OQL-filtered data, whose DRIVER is the datum's putativeDriver (ResultsViewPageStoreUtils 134-152)
// L1–L4 (which samples a line alters under each setting) are run against the fixture study in
// scripts/check-results-oql.ts (Download section), never read here as text.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runDatafiles } from "../lib/views/datafiles/run.ts";
import { oqlEventsSql } from "../lib/oql.ts";
import { resultsLayout, syncDriverCohorts, syncDrivers } from "../app/portal/results-layout.ts";
import { withDrivers } from "../lib/driver-settings.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult, View, CohortDef } from "../lib/types.ts";
import type { RowSource } from "../lib/table-query.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { DatafilesView } from "../lib/views/datafiles/types.ts";

// fixed Genome Nexus pins, so variantPins answers from the environment and asks no database
process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";
const HOT = { hg19: "gn-hg19", hg38: "gn-hg38" };

const MUT: ProfileInfo[] = [{ profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "mutations", order: 0 }];
type Row = Record<string, unknown>;
/** a participant that records every row source it is handed and the statements it is asked to aggregate */
function local() {
  const sources: RowSource[] = [], asked: string[] = [];
  return {
    sources, asked, catalog: MUT,
    instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
    cohortSql: () => "SELECT 1",
    viewAggregate: async (l: string) => { asked.push(l); return [{ n: 1, altered: 0, unaltered: 1, alt_0: 0, prof_0: 1, off_0: 0 }]; },
    rowsPage: async (l: string, source: (db: string) => RowSource) => { asked.push(l); sources.push(source("c1")); return { rows: [] as Row[], total: 0 }; },
    rowsCounts: async (l: string, source: (db: string) => RowSource) => { asked.push(l); sources.push(source("c1")); return []; },
    rowsValues: async (l: string) => { asked.push(l); return []; },
    rowsRank: async () => null,
  };
}
const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 1, samples: 1, mode: "" } }, count: 1, samples: 0, text: "" };
function ctx(r: ReturnType<typeof local>): ViewRun {
  return {
    doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] } as never,
    cohorts: { Q: cohort }, resolvers: { s1: r } as never, vNames: ["Q"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7", studyProfiles: async () => ({ profiles: [], gaProfiles: [], catalog: MUT }),
  };
}
const LINE = "PIK3CA: MUT_DRIVER";
const run = (view: Record<string, unknown>, r = local()) => runDatafiles({ kind: "datafiles", oql: [LINE], ...view } as DatafilesView, ctx(r));
const err = (v: ViewResult) => String((v as { error?: string }).error || "");
/** the line's events statement as oqlEventsSql builds it for this study, with or without the settings; the case table's with its notes */
const events = (extra: Record<string, unknown> = {}) => oqlEventsSql(LINE, { oncokbPin: "v7", profiles: [], pins: {}, study: "s1", db: "c1", ...extra });

describe("L5: malformed drivers are refused with resolveDrivers' message (ours)", () => {
  for (const [drivers, msg] of [[{ nope: true }, /unknown setting 'nope'/], ["yes", /drivers must be an object/],
    [{ hotspots: "no" }, /drivers\.hotspots must be true or false/], [{ tiers: "Tier 1" }, /drivers\.tiers is a list/]] as const)
    test(JSON.stringify(drivers), async () => {
      const r = local();
      const v = await run({ drivers }, r);
      assert.match(err(v), msg, err(v) || JSON.stringify(v).slice(0, 200));
      assert.deepEqual(r.asked, [], "refused before any query");
    });
});

describe("L1/L2/L4: the runner hands the settings to the line's SQL (DT; the rows themselves: check-results-oql.ts)", () => {
  test("L4 no drivers: the line's events are oqlEventsSql's at the pin alone, as before", async () => {
    const r = local();
    assert.equal(err(await run({}, r)), "");
    assert.ok(r.sources.length > 0, "the case table was asked");
    for (const s of r.sources) assert.ok(s.with.includes(events({ notes: true })), "the case table's events without settings");
  });
  for (const [row, drivers] of [["L1", {}], ["L2", { oncokb: false }]] as const)
    test(row + " drivers " + JSON.stringify(drivers) + ": the line's events carry them and the hotspot pins", async () => {
      const r = local();
      assert.equal(err(await run({ drivers }, r)), "");
      assert.ok(r.sources.length > 0);
      const want = events({ drivers, hotspotPins: HOT });
      assert.notEqual(want, events(), "the settings change the statement");
      for (const s of r.sources) assert.ok(s.with.includes(events({ drivers, hotspotPins: HOT, notes: true })), "the case table's events under the settings");
    });
});

// ---------------------------------------------------------------------------------------------
// L6, L7: the Results page
// ---------------------------------------------------------------------------------------------
const rq = (entries: string[]) =>
  ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))] });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
type DlView = { kind: string; oql?: string[]; drivers?: unknown };
const dlView = (doc: { views?: View[] }) => (doc.views || []).find((v) => v.kind === "datafiles") as unknown as DlView;
const oqlClause = (def: CohortDef) => (def.all || []).find((c) => (c as { kind?: string }).kind === "oql") as Record<string, unknown>;

describe("L6/L7: the Results page's Download view carries the page's driver settings when a line names DRIVER (DT)", () => {
  test("L6 a DRIVER query: drivers, as the Altered cohort's clause carries them", () => {
    for (const entries of [["KRAS: MUT_DRIVER"], ["TP53: DRIVER", "KRAS"], ["BRAF: MUT_(500-600)_DRIVER"]]) {
      const l = resultsLayout(rq(entries) as never, rdata);
      const v = dlView(l.doc);
      assert.deepEqual(v.oql, entries);
      assert.ok("drivers" in v, entries.join("; "));
      assert.deepEqual(v.drivers, oqlClause(l.doc.cohorts!.Altered).drivers, entries.join("; "));
    }
  });
  test("L7 a query without DRIVER: no drivers", () => {
    for (const entries of [["KRAS"], ["KRAS: MUT=G12D", "TP53: HOMDEL"], ["EGFR: AMP"]])
      assert.ok(!("drivers" in dlView(resultsLayout(rq(entries) as never, rdata).doc)), entries.join("; "));
  });
  test("L6 a change to the oncoprint's settings reaches a DRIVER Download view (OQL_DRIVER_KINDS, syncDriverCohorts)", () => {
    const l = resultsLayout(rq(["KRAS: MUT_DRIVER", "TP53"]) as never, rdata);
    const views = l.doc.views || [];
    const at = views.findIndex((v) => v.kind === "oncoprint");
    const nextViews = views.map((v, i) => i === at ? withDrivers(v as never, { hotspots: false }) as unknown as View : v);
    const doc = syncDriverCohorts({ ...l.doc, views: syncDrivers(views, nextViews) });
    assert.deepEqual(dlView(doc).drivers, { hotspots: false });
    // L7: a Download view without DRIVER stays without
    const plain = resultsLayout(rq(["KRAS: MUT=G12D", "TP53"]) as never, rdata);
    const pv = plain.doc.views || [];
    const pat = pv.findIndex((v) => v.kind === "oncoprint");
    const pdoc = syncDriverCohorts({ ...plain.doc, views: syncDrivers(pv, pv.map((v, i) => i === pat ? withDrivers(v as never, { hotspots: false }) as unknown as View : v)) });
    assert.ok(!("drivers" in dlView(pdoc)), JSON.stringify(dlView(pdoc)));
  });
});
