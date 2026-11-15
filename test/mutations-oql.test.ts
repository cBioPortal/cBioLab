// The Mutations tab follows the query's OQL (PR 9 of the OQL series): what needs no database.
// Written from the case table's rows (U*) before the code; each test cites its row and the legacy
// source (cbioportal-frontend at cd8c6df) it was read from:
//   RVPS = src/pages/resultsView/ResultsViewPageStore.ts — 834-836 queryContainsMutationOql, 858 useOql defaults
//          to true, 3644-3680 the tab's mutations filtered by the query's OQL only when useOql AND the query
//          holds mutation OQL
//   OF   = src/shared/lib/oql/oqlfilter.ts — 260-290 doesQueryContainMutationOQL; 498-578 isDatumWantedByOQL /
//          isDatumWantedByOQLLine (a datum is wanted when some line of its gene wants it; a line whose commands
//          all leave it unaddressed — AMP, FUSION, EXP — does not)
//   M    = src/pages/resultsView/mutation/Mutations.tsx — 68-72 the toggle, 185-197 the OqlStatusBanner
//   OSB  = src/shared/components/banners/OqlStatusBanner.tsx — the three sentences, the toggle's two labels,
//          no toggle when unaffected, nothing when the query has no OQL
// Which mutations a filter keeps (U1–U5, U8) is SQL, run against the fixture study in
// scripts/check-results-oql.ts (Mutations section), never read here as text.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as oql from "../lib/oql.ts";
import { oqlHasMutationOql } from "../lib/oql-match.ts";
import { viewOql } from "../lib/views/shared.ts";
import { mutationRowSource } from "../lib/mutation-table.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { resultsLayout, syncDriverCohorts, syncDrivers } from "../app/portal/results-layout.ts";
import { withDrivers } from "../lib/driver-settings.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult, View, CohortDef } from "../lib/types.ts";
import type { RowSource } from "../lib/table-query.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";

// fixed Genome Nexus pins, so variantPins answers from the environment and asks no database
process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";
const HOT = { hg19: "gn-hg19", hg38: "gn-hg38" };

// the new API (lib/oql.ts), read off the module so that this file loads before it exists and each test
// fails on its own
type FilterOpts = { study: string; db: string; oncokbPin?: string | null; drivers?: Record<string, unknown>; hotspotPins?: { hg19: string | null; hg38: string | null } };
const hasMutationOql = (lines: string[]): boolean => {
  const f = (oql as Record<string, unknown>).oqlHasMutationOql;
  assert.equal(typeof f, "function", "lib/oql.ts exports oqlHasMutationOql");
  return (f as (l: string[]) => boolean)(lines);
};
const filterSql = (lines: string[], gene: string, opts: Partial<FilterOpts> = {}): string | null => {
  const f = (oql as Record<string, unknown>).oqlMutationFilterSql;
  assert.equal(typeof f, "function", "lib/oql.ts exports oqlMutationFilterSql");
  return (f as (l: string[], g: string, o: FilterOpts) => string | null)(lines, gene, { study: "s1", db: "c1", ...opts });
};

// ---------------------------------------------------------------------------------------------
// U9: oqlHasMutationOql is doesQueryContainMutationOQL
// ---------------------------------------------------------------------------------------------

describe("U9: oqlHasMutationOql — some line has a MUT command with a constraint or a modifier, or a standalone DRIVER (OF 260-290)", () => {
  const yes: string[][] = [
    ["KRAS: MISSENSE"], ["KRAS: NONSENSE"], ["KRAS: INFRAME"], ["KRAS: SPLICE"], ["KRAS: TRUNC"],   // a class (constr_type class)
    ["KRAS: MUT=G12D"],                                                                              // a change (constr_type name)
    ["KRAS: MUT_(10-15)"], ["EGFR: MUT_(748-800*)"],                                                  // a RANGE modifier
    ["KRAS: MUT_DRIVER"], ["KRAS: DRIVER_MUT"], ["KRAS: MISSENSE_DRIVER"],                           // a DRIVER modifier on MUT
    ["KRAS: DRIVER"],                                                                                // standalone DRIVER (alteration_type any)
    ["KRAS: AMP", "TP53: MUT=R175H"], ["KRAS", "TP53: TRUNC"],                                       // any line of the query
    ["KRAS: AMP MUT=G12D"], ["KRAS: MUT MUT=G12D"],                                                  // any command of the line
  ];
  const no: string[][] = [
    ["KRAS"], ["KRAS", "TP53"],                         // bare genes
    ["KRAS: MUT"], ["KRAS: MUT", "TP53: MUT"],          // MUT with no constraint or modifier
    ["KRAS: AMP"], ["KRAS: HOMDEL"], ["KRAS: AMP HOMDEL"], ["KRAS: MUT AMP"],
    ["KRAS: FUSION"], ["KRAS: EXP>2"], ["KRAS: PROT<=-1.5"],
    ["KRAS: AMP_DRIVER"], ["ALK: FUSION_DRIVER"],       // DRIVER on a copy-number or fusion command: alteration_type is not mut or any
    [],
  ];
  for (const lines of yes) test("true: " + (lines.join("; ") || "(none)"), () => assert.equal(hasMutationOql(lines), true));
  for (const lines of no) test("false: " + (lines.join("; ") || "(none)"), () => assert.equal(hasMutationOql(lines), false));
});

// ---------------------------------------------------------------------------------------------
// oqlMutationFilterSql: when there is no filter (null), and when there is one that keeps nothing
// ---------------------------------------------------------------------------------------------

describe("oqlMutationFilterSql: null when nothing is filtered for this gene (RVPS 3649, OF 520-578)", () => {
  test("U6 no mutation OQL in the lines: null for every gene, AMP alone included (unaffected, not 'none wanted')", () => {
    for (const lines of [["KRAS", "TP53"], ["KRAS: MUT"], ["KRAS: AMP"], ["KRAS: AMP", "TP53: HOMDEL"], ["KRAS: MUT", "TP53: FUSION"]])
      for (const gene of ["KRAS", "TP53"]) assert.equal(filterSql(lines, gene), null, lines.join("; ") + " / " + gene);
  });
  test("U4 mutation OQL elsewhere in the query, but this gene has a line wanting every mutation: null", () => {
    assert.equal(filterSql(["KRAS: MUT", "TP53: MUT=R175H"], "KRAS"), null, "its line is MUT");
    assert.equal(filterSql(["KRAS", "TP53: MUT=R175H"], "KRAS"), null, "its line is bare (the default OQL holds MUT)");
    assert.equal(filterSql(["KRAS: MUT=G12D MUT"], "KRAS"), null, "a plain MUT beside a constrained one wants them all");
    assert.equal(filterSql(["KRAS: MUT=G12D", "KRAS: MUT AMP"], "KRAS"), null, "a second line of the gene with MUT wants them all");
  });
  test("U1/U3/U8: a constrained line of the gene gives a filter", () => {
    for (const lines of [["KRAS: MUT=G12D"], ["KRAS: MISSENSE"], ["KRAS: MUT_(10-15)"], ["KRAS: MUT=G12D", "KRAS: MUT=G13D"], ["KRAS: AMP MUT=G12D"]]) {
      const s = filterSql(lines, "KRAS");
      assert.equal(typeof s, "string", lines.join("; "));
      assert.ok(s!.trim().length > 0, lines.join("; "));
    }
    const s = filterSql(["KRAS: MUT_DRIVER"], "KRAS", { oncokbPin: "v7" });
    assert.equal(typeof s, "string", "MUT_DRIVER at a pin");
  });
  test("U5 the query has mutation OQL and this gene's only line wants none (AMP), or it has no line: a filter, never null", () => {
    for (const [lines, gene] of [[["KRAS: AMP", "TP53: MUT=R175H"], "KRAS"], [["KRAS: FUSION", "TP53: MUT=R175H"], "KRAS"],
      [["KRAS: EXP>=2", "TP53: MUT=R175H"], "KRAS"], [["TP53: MUT=R175H"], "KRAS"]] as [string[], string][])
      assert.equal(typeof filterSql(lines, gene), "string", lines.join("; ") + " / " + gene + ": null would show every mutation");
  });
  test("a line the parser refuses is refused with the parser's message", () => {
    assert.throws(() => filterSql(["KRAS: MUT=G12D", "TP53: GAIN"], "KRAS"), /GAIN is not supported/);
  });
});

// ---------------------------------------------------------------------------------------------
// the runners: a filter only when it applies (U6, U7), a bad line refused
// ---------------------------------------------------------------------------------------------

type Args = unknown[];
/** a participant that records what the lollipop and the table ask of it */
function local() {
  const lollipop: Args[] = [], sources: RowSource[] = [], asked: string[] = [];
  return {
    lollipop, sources, asked,
    instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
    cohortSql: () => "SELECT 1",
    lollipopCounts: async (...args: Args) => { lollipop.push(args); asked.push("lollipop"); return { changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }; },
    rowsPage: async (l: string, source: (db: string) => RowSource) => { asked.push(l); sources.push(source("c1")); return { rows: [], total: 0 }; },
    rowsCounts: async (l: string, source: (db: string) => RowSource) => { asked.push(l); sources.push(source("c1")); return []; },
    rowsValues: async (l: string) => { asked.push(l); return []; },
    rowsRank: async () => null,
  };
}
const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 10, samples: 10, mode: "" } }, count: 10, samples: 10, text: "" };
function ctx(r: ReturnType<typeof local>): ViewRun {
  return {
    doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] } as never,
    cohorts: { Q: cohort }, resolvers: { s1: r } as never, vNames: ["Q"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7", studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
  };
}
const resultOf = (r: ViewResult | Untimed): ViewResult => r instanceof Untimed ? r.result : r;
const err = (r: ViewResult | Untimed) => String((resultOf(r) as { error?: string }).error || "");
/** arguments as a value: an absent, null or empty trailing option is no option */
const norm = (x: unknown): unknown => {
  const empty = (v: unknown) => v == null || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
  if (Array.isArray(x)) { const a = x.map(norm); while (a.length && empty(a[a.length - 1])) a.pop(); return a; }
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([, v]) => v != null).map(([k, v]) => [k, norm(v)]));
  return x;
};
const lollipopArgs = async (view: Record<string, unknown>) => {
  const r = local();
  const res = await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"], ...view } as never, ctx(r));
  assert.equal(err(res), "", JSON.stringify(resultOf(res)).slice(0, 300));
  assert.equal(r.lollipop.length, 1, "one lollipop request");
  return norm(r.lollipop[0]);
};
const tableSources = async (view: Record<string, unknown>) => {
  const r = local();
  const res = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], ...view } as MutationsView, ctx(r));
  assert.equal(err(res), "", JSON.stringify(res).slice(0, 300));
  assert.ok(r.sources.length > 0, "the table was asked");
  return r.sources;
};

describe("the runners pass a filter only when it applies (RVPS 3644-3680)", () => {
  // no Genome Nexus: the lollipop draws its axis from the codons seen
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });

  const NO_MUT_OQL = [["KRAS", "TP53"], ["KRAS: MUT"], ["KRAS: AMP"]];
  test("U6 lollipop: lines without mutation OQL ask exactly what no lines ask", async () => {
    const base = await lollipopArgs({});
    for (const lines of NO_MUT_OQL) assert.deepEqual(await lollipopArgs({ oql: lines }), base, lines.join("; "));
  });
  test("U7 lollipop: useOql false asks exactly what no lines ask", async () => {
    const base = await lollipopArgs({});
    assert.deepEqual(await lollipopArgs({ oql: ["KRAS: MUT=G12D"], useOql: false }), base);
  });
  test("U1 lollipop: KRAS: MUT=G12D (useOql unset, so true — RVPS 858) asks for something else", async () => {
    const base = await lollipopArgs({});
    assert.notDeepEqual(await lollipopArgs({ oql: ["KRAS: MUT=G12D"] }), base);
    assert.notDeepEqual(await lollipopArgs({ oql: ["KRAS: MUT=G12D"], useOql: true }), base);
  });

  test("U6 table: lines without mutation OQL build the same statements as no lines", async () => {
    const base = await tableSources({});
    for (const lines of NO_MUT_OQL) assert.deepEqual(await tableSources({ oql: lines }), base, lines.join("; "));
  });
  test("U7 table: useOql false builds the same statements as no lines", async () => {
    const base = await tableSources({});
    assert.deepEqual(await tableSources({ oql: ["KRAS: MUT=G12D"], useOql: false }), base);
  });
  test("U1 table: KRAS: MUT=G12D puts oqlMutationFilterSql's condition into every statement", async () => {
    const base = await tableSources({});
    const got = await tableSources({ oql: ["KRAS: MUT=G12D"] });
    assert.notDeepEqual(got, base);
    const cond = filterSql(["KRAS: MUT=G12D"], "KRAS", { oncokbPin: "v7" })!;
    for (const s of got) assert.ok(s.with.includes(cond), "the statement holds the filter");
  });
  test("U3 table: MUT_DRIVER with the view's drivers reads them, with the hotspot pins", async () => {
    const lines = ["KRAS: MUT_DRIVER"];
    const want = filterSql(lines, "KRAS", { oncokbPin: "v7", drivers: {}, hotspotPins: HOT })!;
    assert.notEqual(want, filterSql(lines, "KRAS", { oncokbPin: "v7" }), "the settings change the condition");
    for (const s of await tableSources({ oql: lines, drivers: {} })) assert.ok(s.with.includes(want), "the filter under the view's settings");
  });

  test("a line the parser refuses is refused by both views, before any query, with the parser's message", async () => {
    for (const lines of [["KRAS: MUT=G12D", "TP53: GAIN"], ["KRAS: HETLOSS"]]) {
      const r = local();
      const h = await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"], oql: lines } as never, ctx(r));
      assert.match(err(h), /is not supported/, "hotspots: " + lines.join("; "));
      const m = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], oql: lines } as never, ctx(r));
      assert.match(err(m), /is not supported/, "mutations: " + lines.join("; "));
      assert.deepEqual(r.asked, [], "no query ran");
    }
  });
  test("oql is one gene per line (as the other views' oql): a line naming two genes, or an empty line, is refused", async () => {
    for (const lines of [["KRAS: MUT=G12D; TP53"], [""]]) {
      const r = local();
      assert.ok(err(await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"], oql: lines } as never, ctx(r))), "hotspots: " + JSON.stringify(lines));
      assert.ok(err(await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], oql: lines } as never, ctx(r))), "mutations: " + JSON.stringify(lines));
      assert.deepEqual(r.asked, []);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// U11, U12: the Results page
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[]) =>
  ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))] });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
type MutView = View & { kind: string; oql?: string[]; useOql?: boolean; drivers?: unknown; genes?: string[]; gene?: string };
const byKind = (doc: { views?: View[] }, kind: string) => (doc.views || []).find((v) => v.kind === kind) as MutView;
const oqlClause = (def: CohortDef) => (def.all || []).find((c) => (c as { kind?: string }).kind === "oql") as Record<string, unknown>;
type Banner = { text: (views: View[]) => string | null; toggle?: { label: (views: View[]) => string; apply: (views: View[]) => View[] } };
const mutTab = (entries: string[]) => {
  const l = resultsLayout(rq(entries) as never, rdata);
  const tab = l.tabs.find((t) => t.title === "Mutations")!;
  const views = tab.views!.map((i) => l.doc.views![i]);
  return { l, tab, views, banner: (tab as unknown as { banner?: Banner }).banner };
};

describe("U11: the Results page's Mutations views carry the query's lines (RVPS 3644-3680)", () => {
  test("both views: oql is the query's entries, as the Download tab's", () => {
    const entries = ["KRAS: MUT=G12D", "TP53: HOMDEL", "EGFR"];
    const { l, views } = mutTab(entries);
    assert.deepEqual(views.map((v) => v.kind), ["hotspots", "mutations"]);
    for (const v of views as MutView[]) {
      assert.deepEqual(v.oql, entries, v.kind);
      assert.ok(!("useOql" in v), v.kind + ": useOql is unset (true) by default (RVPS 858)");
    }
    assert.deepEqual((views[0] as MutView).oql, (byKind(l.doc, "datafiles") as MutView).oql);
  });
  test("drivers only when a line names DRIVER: then the Altered cohort's settings", () => {
    for (const entries of [["KRAS: MUT_DRIVER"], ["TP53: DRIVER", "KRAS"], ["BRAF: MUT_(500-600)_DRIVER"]]) {
      const { l, views } = mutTab(entries);
      for (const v of views as MutView[]) {
        assert.ok("drivers" in v, v.kind + ": " + entries.join("; "));
        assert.deepEqual(v.drivers, oqlClause(l.doc.cohorts!.Altered).drivers, v.kind + ": " + entries.join("; "));
      }
    }
    for (const entries of [["KRAS"], ["KRAS: MUT=G12D", "TP53: HOMDEL"], ["EGFR: AMP"]])
      for (const v of mutTab(entries).views as MutView[]) assert.ok(!("drivers" in v), v.kind + ": " + entries.join("; "));
  });
  test("a change to the oncoprint's driver settings reaches both DRIVER views (OQL_DRIVER_KINDS holds hotspots and mutations)", () => {
    const l = resultsLayout(rq(["KRAS: MUT_DRIVER", "TP53"]) as never, rdata);
    const views = l.doc.views || [];
    const at = views.findIndex((v) => v.kind === "oncoprint");
    const doc = syncDriverCohorts({ ...l.doc, views: syncDrivers(views, views.map((v, i) => i === at ? withDrivers(v as never, { hotspots: false }) as unknown as View : v)) });
    assert.deepEqual(byKind(doc, "hotspots").drivers, { hotspots: false });
    assert.deepEqual(byKind(doc, "mutations").drivers, { hotspots: false });
  });
  test("choosing another gene keeps the lines and the toggle on both views", () => {
    const { tab, views } = mutTab(["KRAS: MUT=G12D", "TP53: MUT=R175H"]);
    const off = views.map((v) => ({ ...v, useOql: false }) as View);
    const next = tab.chooser!.apply(off, "TP53") as MutView[];
    assert.deepEqual([next[0].genes, next[1].gene], [["TP53"], "TP53"]);
    for (const v of next) { assert.deepEqual(v.oql, ["KRAS: MUT=G12D", "TP53: MUT=R175H"], v.kind); assert.equal(v.useOql, false, v.kind); }
  });
});

const FILTERED = "The results below are filtered by the OQL specification from your query.";
const NOT_FILTERED = "The results below are not filtered by the OQL specification from your query.";
const UNAFFECTED = "Your OQL specification does not affect the results below because you have not specified any filters for mutations in this gene.";

describe("U12: the Mutations tab's banner and toggle (M 185-197, OSB)", () => {
  test("mutation OQL, filtering on: 'filtered', and 'Do not filter by OQL' sets useOql false on both views", () => {
    const { banner, views } = mutTab(["KRAS: MUT=G12D", "TP53"]);
    assert.ok(banner, "the tab has a banner");
    assert.equal(banner!.text(views), FILTERED);
    assert.ok(banner!.toggle, "with a toggle");
    assert.equal(banner!.toggle!.label(views), "Do not filter by OQL");
    const off = banner!.toggle!.apply(views) as MutView[];
    assert.equal(off.length, 2);
    for (const v of off) assert.equal(v.useOql, false, v.kind);
    assert.deepEqual(off.map((v) => v.kind), ["hotspots", "mutations"]);
  });
  test("filtering off: 'not filtered', and 'Filter by OQL' removes useOql from both views", () => {
    const { banner, views } = mutTab(["KRAS: MUT=G12D", "TP53"]);
    const off = banner!.toggle!.apply(views);
    assert.equal(banner!.text(off), NOT_FILTERED);
    assert.equal(banner!.toggle!.label(off), "Filter by OQL");
    const on = banner!.toggle!.apply(off) as MutView[];
    for (const v of on) assert.ok(!("useOql" in v), v.kind + ": " + JSON.stringify(v));
    assert.equal(banner!.text(on), FILTERED);
    // the rest of each view is kept
    assert.deepEqual(on.map((v) => v.oql), [views[0], views[1]].map((v) => (v as MutView).oql));
  });
  test("OQL without mutation OQL: the unaffected sentence, and no toggle", () => {
    for (const entries of [["KRAS: AMP"], ["KRAS: MUT", "TP53"], ["KRAS: HOMDEL", "TP53: FUSION"], ["KRAS: AMP_DRIVER"]]) {
      const { banner, views } = mutTab(entries);
      assert.ok(banner, entries.join("; "));
      assert.equal(banner!.text(views), UNAFFECTED, entries.join("; "));
      assert.equal(banner!.toggle, undefined, entries.join("; "));
    }
  });
  test("no OQL at all (bare genes): no banner text", () => {
    for (const entries of [["KRAS"], ["KRAS", "TP53"]]) {
      const { banner, views } = mutTab(entries);
      assert.equal(banner ? banner.text(views) : null, null, entries.join("; "));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// the pieces the views are built from, each tested where it lives
describe("U6/U7/U9 (the pieces): what decides whether the Mutations tab is filtered", () => {
  test("oql-match's oqlHasMutationOql is the one lib/oql.ts re-exports (OF 260-290)", () => {
    assert.equal(oqlHasMutationOql(["KRAS: AMP"]), false);
    assert.equal(oqlHasMutationOql(["KRAS", "TP53: MUT"]), false);
    assert.equal(oqlHasMutationOql(["KRAS: AMP", "TP53: MUT=R175H"]), true);
    assert.equal(oqlHasMutationOql(["KRAS: DRIVER"]), true);
    assert.equal(oql.oqlHasMutationOql, oqlHasMutationOql);
  });
  test("viewOql: the lines to follow only when they narrow mutations and useOql is not false", () => {
    assert.deepEqual(viewOql({ oql: ["KRAS: MUT=G12D"] }), { oql: { lines: ["KRAS: MUT=G12D"] } });
    assert.deepEqual(viewOql({ oql: ["KRAS: MUT=G12D"], useOql: false }), {}, "U7");
    assert.deepEqual(viewOql({ oql: ["KRAS: AMP"] }), {}, "U6: no mutation OQL");
    assert.deepEqual(viewOql({}), {});
    assert.ok("error" in viewOql({ oql: ["KRAS: MUT=G12D"], useOql: "no" }));
  });
  test("the table's statement carries the gene's filter, and none without lines (U1, U6)", () => {
    const parts = [{ cohort: "A", study: "s1", cohortSql: "SELECT 'p' AS pid, 's' AS sid" }];
    const pins = { hg19: null, hg38: null };
    const lines = { lines: ["KRAS: MUT=G12D"] };
    const withLines = mutationRowSource(parts, "c1", "KRAS", null, pins, lines).with;
    const filter = oql.oqlMutationFilterSql(lines.lines, "KRAS", { study: "s1", db: "c1", oncokbPin: null })!;
    assert.ok(withLines.includes(filter), "the filter is ANDed into the table's mutations");
    assert.ok(!mutationRowSource(parts, "c1", "KRAS", null, pins).with.includes("IN (\n  SELECT g.sample_unique_id"));
  });
});
