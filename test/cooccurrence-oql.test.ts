// Mutual Exclusivity follows the query's OQL (PR 6 of the OQL series): what needs no database.
// Written from the case table's rows (M*) before the code; each test cites its row and the legacy
// source (cbioportal-frontend at cd8c6df) it was read from:
//   RVS  = src/pages/resultsView/ResultsViewPageStore.ts 2193-2215 isSampleAlteredMap (one entry per query line)
//   RVSU = src/pages/resultsView/ResultsViewPageStoreUtils.ts 473-597 getSampleAlteredMap, 599-619 getSingleGeneResultKey
//          (a line equal to the default OQL is named by its gene, any other by unparseOQLQueryLine less its ";")
//   MET  = src/pages/resultsView/mutualExclusivity/MutualExclusivityTab.tsx 102 (fewer than 2 tracks: no analysis)
//   RVP  = src/pages/resultsView/ResultsViewPage.tsx 235-244 (the tab is hidden while the map has fewer than 2 tracks)
// The SQL (which samples a track counts altered, which are profiled) is run against the fixture study
// in scripts/check-results-oql.ts, never read here as text.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { runCooccurrence } from "../lib/views/cooccurrence/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import { RemoteAggregateResolver } from "../lib/federation-remote.ts";
import { resultsLayout, syncDriverCohorts, syncDrivers } from "../app/portal/results-layout.ts";
import { withDrivers } from "../lib/driver-settings.ts";
import type { ViewResult, ViewParticipation, View, CohortDef } from "../lib/types.ts";
import type { Instance, PairCounts } from "../lib/federation.ts";
import { PRIMARY } from "../lib/ch.ts";

type Asked = { def: unknown; pairs: [string, string][]; oql: Record<string, unknown> | undefined };

/** one participant whose pairCounts answers every pair asked with the same four counts, recording what it was asked */
function ctx() {
  const asked: Asked[] = [];
  const cohort: EvaluatedCohort = { studies: ["s1"], count: 50, samples: 60, text: "",
    perStudy: { s1: { sql: "SELECT 1", count: 50, samples: 60, mode: "patient-level" } } } as never;
  const site = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    pairCounts: async (def: unknown, pairs: [string, string][], oql?: Record<string, unknown>): Promise<PairCounts[]> => {
      asked.push({ def, pairs, oql });
      return pairs.map(([a, b]) => ({ a, b, both: 3, onlyA: 7, onlyB: 9, neither: 41, profiled: 60 }));
    },
  };
  const run: ViewRun = {
    doc: { study: "s1", cohorts: { Queried: { study: "s1" } }, views: [] } as never,
    cohorts: { Queried: cohort }, resolvers: { s1: site } as never, vNames: ["Queried"], vStudies: ["s1"],
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7.5", studyProfiles: async () => ({ profiles: ["mutations", "cna"], gaProfiles: [] }),
  };
  return { run, asked };
}
const run = async (view: Record<string, unknown>) => {
  const c = ctx();
  const r = await runCooccurrence({ kind: "cooccurrence", cohorts: ["Queried"], ...view } as never, c.run);
  return { r: (r instanceof Untimed ? r.result : r) as ViewResult, asked: c.asked };
};
const err = (r: ViewResult) => String((r as { error?: string }).error || "");
const pairsOf = (r: ViewResult) => ((r as unknown as { pairs?: { a: string; b: string }[] }).pairs || []).map((p) => [p.a, p.b]);
const sorted = (xs: string[][]) => xs.map((p) => p.join(" / ")).sort();
/** every pair the participants were asked, across calls */
const askedPairs = (asked: Asked[]) => asked.flatMap((a) => a.pairs);

// ---------------------------------------------------------------------------------------------
// the tracks: one per line, named by its gene or its line
// ---------------------------------------------------------------------------------------------

describe("M1: a line with OQL is its own track, named by its gene and its written-back line (RVSU 599-619)", () => {
  test("oql [\"KRAS: MUT=G12D\", \"TP53\"]: the tracks \"KRAS: MUT=G12D\" and \"TP53\", one pair, asked and reported by those names", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT=G12D", "TP53"] });
    assert.equal(err(r), "");
    assert.deepEqual(askedPairs(asked), [["KRAS: MUT=G12D", "TP53"]]);
    assert.deepEqual(pairsOf(r), [["KRAS: MUT=G12D", "TP53"]]);
  });
  test("with oql, the view's genes give way to the lines (the Results page sends both)", async () => {
    const { r, asked } = await run({ genes: ["KRAS", "TP53", "EGFR"], oql: ["KRAS: MUT=G12D", "TP53"] });
    assert.equal(err(r), "");
    assert.deepEqual(askedPairs(asked), [["KRAS: MUT=G12D", "TP53"]], "EGFR is not a track");
  });
  test("the name is the line written back, as the portal's unparseOQLQueryLine writes it", async () => {
    const { asked } = await run({ oql: ["KRAS: MISSENSE", "TP53: MUT HOMDEL", "EGFR: AMP;", "STK11: MUT_DRIVER"] });
    const tracks = [...new Set(askedPairs(asked).flat())];
    assert.deepEqual(tracks.sort(), ["EGFR: AMP", "KRAS: MUT=MISSENSE", "STK11: MUT_DRIVER", "TP53: MUT HOMDEL"]);
  });
  test("several tracks: every two of them, in line order, once each (MET 64-102)", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT=G12D", "TP53", "EGFR: AMP"] });
    assert.deepEqual(askedPairs(asked), [["KRAS: MUT=G12D", "TP53"], ["KRAS: MUT=G12D", "EGFR: AMP"], ["TP53", "EGFR: AMP"]]);
    assert.deepEqual(sorted(pairsOf(r)), sorted([["KRAS: MUT=G12D", "TP53"], ["KRAS: MUT=G12D", "EGFR: AMP"], ["TP53", "EGFR: AMP"]]));
  });
});

describe("M2: a bare line's track is its gene (RVSU 607-613: its alterations equal the default OQL)", () => {
  test("\"TP53\" and \"TP53:\" are both the track \"TP53\"", async () => {
    for (const tp53 of ["TP53", "TP53:"]) {
      const { r, asked } = await run({ oql: ["KRAS: AMP", tp53] });
      assert.equal(err(r), "", tp53);
      assert.deepEqual(askedPairs(asked), [["KRAS: AMP", "TP53"]], tp53);
    }
  });
  test("two bare lines are asked as two genes, as before the change", async () => {
    const { asked } = await run({ oql: ["KRAS", "TP53"] });
    assert.deepEqual(askedPairs(asked), [["KRAS", "TP53"]]);
  });
  test("a view without oql pairs its genes as before", async () => {
    const { r, asked } = await run({ genes: ["KRAS", "TP53"] });
    assert.equal(err(r), "");
    assert.deepEqual(askedPairs(asked), [["KRAS", "TP53"]]);
  });
});

describe("M3: two lines of one gene are two tracks, paired with each other (RVS: one entry per line)", () => {
  test("oql [\"KRAS: AMP\", \"KRAS: MUT\"]: the pair KRAS: AMP / KRAS: MUT", async () => {
    const { r, asked } = await run({ oql: ["KRAS: AMP", "KRAS: MUT"] });
    assert.equal(err(r), "", "two tracks of one gene are enough");
    assert.deepEqual(askedPairs(asked), [["KRAS: AMP", "KRAS: MUT"]]);
    assert.deepEqual(pairsOf(r), [["KRAS: AMP", "KRAS: MUT"]]);
  });
  test("a bare line and an OQL line of one gene are two tracks", async () => {
    const { asked } = await run({ oql: ["KRAS", "KRAS: MUT=G12D"] });
    assert.deepEqual(askedPairs(asked), [["KRAS", "KRAS: MUT=G12D"]]);
  });
});

describe("M4: identical names collapse to one track (RVSU 520-527: the map is keyed by name)", () => {
  test("the same line twice is one track", async () => {
    const { asked } = await run({ oql: ["KRAS: AMP", "TP53", "KRAS: AMP"] });
    assert.deepEqual(askedPairs(asked), [["KRAS: AMP", "TP53"]]);
  });
  test("lines written differently but written back the same are one track (\"TP53\", \"TP53:\"; \"EGFR: AMP\", \"EGFR: AMP;\")", async () => {
    const { asked } = await run({ oql: ["TP53", "EGFR: AMP", "TP53:", "EGFR: AMP;"] });
    assert.deepEqual(askedPairs(asked), [["TP53", "EGFR: AMP"]]);
  });
});

describe("M8: fewer than 2 tracks is the view's \"needs at least 2\" error (MET 102)", () => {
  for (const oql of [["KRAS: MUT=G12D"], ["KRAS: AMP", "KRAS: AMP"], ["TP53", "TP53:"]])
    test(JSON.stringify(oql) + " is refused, and nothing is counted", async () => {
      const { r, asked } = await run({ oql });
      assert.match(err(r), /at least 2/, JSON.stringify(r).slice(0, 200));
      assert.deepEqual(asked, []);
    });
});

describe("M9: a line the parser refuses, or one naming two genes, is refused naming it", () => {
  test("GAIN (lib/oql-parse.ts: only high-level copy number is stored)", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT=G12D", "TP53: GAIN"] });
    assert.match(err(r), /GAIN is not supported/, err(r));
    assert.match(err(r), /TP53: GAIN/, "names the line: " + err(r));
    assert.deepEqual(asked, []);
  });
  test("a malformed line", async () => {
    const { r, asked } = await run({ oql: ["KRAS: EXP", "TP53"] });
    assert.ok(err(r), "EXP without a threshold is refused");
    assert.deepEqual(asked, []);
  });
  test("a line naming two genes is refused, naming it: one gene per line", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT; TP53", "EGFR"] });
    assert.ok(err(r), "refused");
    assert.match(err(r), /KRAS: MUT; TP53/, err(r));
    assert.deepEqual(asked, []);
  });
  test("an empty line list is refused", async () => {
    const { r, asked } = await run({ oql: [] });
    assert.ok(err(r));
    assert.deepEqual(asked, []);
  });
});

describe("M13: a line with OQL is named by its line even when it equals the profiles' default (ours; documented)", () => {
  test("\"KRAS: MUT FUSION\" (CNA deselected on the query page) is the track \"KRAS: MUT FUSION\"; the portal names it KRAS", async () => {
    const { asked } = await run({ oql: ["KRAS: MUT FUSION", "TP53"] });
    assert.deepEqual(askedPairs(asked), [["KRAS: MUT FUSION", "TP53"]]);
  });
});

// ---------------------------------------------------------------------------------------------
// M6, M7, M11: what the runner hands each participant beside the pairs
// ---------------------------------------------------------------------------------------------

describe("M6/M7: the view's drivers, exp, prot and ifHeld go to the participant with the pairs", () => {
  test("each is passed as the view has it", async () => {
    const drivers = { hotspots: false };
    const { r, asked } = await run({ oql: ["STK11: MUT_DRIVER", "KRAS: EXP>=2", "EGFR: PROT<=-2"], drivers,
      exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores", ifHeld: true });
    assert.equal(err(r), "");
    assert.equal(asked.length, 1);
    const o = asked[0].oql || {};
    assert.deepEqual(o.drivers, drivers);
    assert.equal(o.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.equal(o.prot, "rppa_Zscores");
    assert.equal(o.ifHeld, true);
  });
  test("a view without them passes none", async () => {
    const { asked } = await run({ oql: ["KRAS: MUT=G12D", "TP53"] });
    const o = asked[0].oql || {};
    for (const k of ["drivers", "exp", "prot", "ifHeld"]) assert.equal(o[k], undefined, k);
  });
});

describe("M11: a remote participant receives the track names and the driver / profile settings (ours)", () => {
  const URL_ = "http://peer.invalid/api/federation/v1";
  const INST: Instance = { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY };
  const DEF = { all: [{ kind: "oql", q: "TP53: MUT" }] } as never;
  const realLog = console.log;
  before(() => { console.log = () => {}; });
  after(() => { console.log = realLog; });
  type Call = { op: string; body: Record<string, unknown> };
  const withPeer = async (answer: Record<string, unknown>, fn: (calls: Call[]) => Promise<void>) => {
    const original = globalThis.fetch;
    const calls: Call[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ op: String(url).split("/").pop()!, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try { await fn(calls); } finally { globalThis.fetch = original; }
  };
  const ANSWER = { study: "s1", instance: "peer", count: 7, samples: 9, geneCounts: [], survivalCounts: [], attributeStats: [], pairMoments: [],
    variantCounts: { variants: [], totals: [], minCount: 1 }, profileMoments: [], oncokbPin: null,
    pairCounts: [{ a: "KRAS: MUT=G12D", b: "TP53", both: 1, onlyA: 2, onlyB: 3, neither: 4, profiled: 10 }] };

  test("the aggregates call carries the pairs by track name and pairOql; the answer's rows are returned", async () => {
    await withPeer(ANSWER, async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      const oql = { drivers: { oncokb: true, hotspots: false }, exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores", ifHeld: true };
      const rows = await (r.pairCounts as (d: unknown, p: [string, string][], o?: unknown) => Promise<PairCounts[]>)(DEF, [["KRAS: MUT=G12D", "TP53"]], oql);
      assert.deepEqual(rows, ANSWER.pairCounts);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].op, "aggregates");
      assert.deepEqual(calls[0].body.pairs, [["KRAS: MUT=G12D", "TP53"]]);
      assert.deepEqual(calls[0].body.pairOql, oql, "the settings travel; the peer's own pin, profiles and hotspot pins are its own");
      for (const k of ["oncokbPin", "profiles", "hotspotPins"]) assert.ok(!(k in (calls[0].body.pairOql as object)), k + " is the peer's, not sent");
    });
  });
  test("without oql the call is as before: no pairOql", async () => {
    await withPeer(ANSWER, async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      await r.pairCounts(DEF, [["KRAS", "TP53"]]);
      assert.deepEqual(calls[0].body, { study: "s1", cohort: DEF, pairs: [["KRAS", "TP53"]] });
    });
  });
  test("an id-carrying cohort is still refused before anything is sent", async () => {
    await withPeer(ANSWER, async (calls) => {
      const r = new RemoteAggregateResolver("s1", URL_, INST);
      const IDS = { all: [{ kind: "patientList", ids: ["P1"] }] } as never;
      await assert.rejects((r.pairCounts as (d: unknown, p: [string, string][], o?: unknown) => Promise<PairCounts[]>)(IDS, [["KRAS: AMP", "TP53"]], { exp: "x" }));
      assert.equal(calls.length, 0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// M10: the Results page
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[], extra: Record<string, unknown> = {}) =>
  ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))], ...extra });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
type MexView = { kind: string; genes?: unknown; oql?: string[]; exp?: string; prot?: string; ifHeld?: boolean; drivers?: unknown };
const mexView = (doc: { views?: View[] }) => (doc.views || []).find((v) => v.kind === "cooccurrence") as unknown as MexView | undefined;
const mexTab = (l: ReturnType<typeof resultsLayout>) => l.tabs.find((t) => t.title === "Mutual Exclusivity");
const oqlClause = (def: CohortDef) => (def.all || []).find((c) => (c as { kind?: string }).kind === "oql") as Record<string, unknown>;

describe("M10: the Results page's Mutual Exclusivity view carries the query's OQL (RVS: isSampleAlteredMap per line)", () => {
  test("oql is the query's entries, as the Download and Cancer Types tabs carry them", () => {
    const entries = ["KRAS: MUT=G12D", "TP53: HOMDEL", "EGFR"];
    const l = resultsLayout(rq(entries) as never, rdata);
    const v = mexView(l.doc)!;
    assert.ok(v, "laid out");
    assert.deepEqual(v.oql, entries);
    const dl = (l.doc.views || []).find((x) => x.kind === "datafiles") as unknown as { oql: string[] };
    assert.deepEqual(v.oql, dl.oql);
  });
  test("the query's exp / prot / ifHeld travel with the lines", () => {
    const entries = ["KRAS: EXP>=2", "TP53"];
    const one = mexView(resultsLayout(rq(entries, { exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" }) as never, rdata).doc)!;
    assert.equal(one.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.equal(one.prot, "rppa_Zscores");
    assert.ok(!("ifHeld" in one));
    const many = mexView(resultsLayout(rq(entries, { studies: ["a", "b"], exp: "rna_seq_v2_mrna_median_Zscores", ifHeld: true }) as never, rdata).doc)!;
    assert.equal(many.ifHeld, true);
    const none = mexView(resultsLayout(rq(entries) as never, rdata).doc)!;
    assert.ok(!("exp" in none) && !("prot" in none) && !("ifHeld" in none), JSON.stringify(none));
  });
  test("drivers only when a line names DRIVER: then the page's settings, as the Altered cohort's clause carries them", () => {
    for (const entries of [["KRAS: MUT_DRIVER", "TP53"], ["TP53: DRIVER", "KRAS"]]) {
      const l = resultsLayout(rq(entries) as never, rdata);
      const v = mexView(l.doc)!;
      assert.ok("drivers" in v, entries.join("; "));
      assert.deepEqual(v.drivers, oqlClause(l.doc.cohorts!.Altered).drivers, entries.join("; "));
    }
    for (const entries of [["KRAS", "TP53"], ["KRAS: MUT=G12D", "TP53: HOMDEL"]])
      assert.ok(!("drivers" in mexView(resultsLayout(rq(entries) as never, rdata).doc)!), entries.join("; "));
  });
  test("a change to the oncoprint's driver settings reaches a DRIVER Mutual Exclusivity view (syncDriverCohorts)", () => {
    const l = resultsLayout(rq(["KRAS: MUT_DRIVER", "TP53"]) as never, rdata);
    const views = l.doc.views || [];
    const at = views.findIndex((v) => v.kind === "oncoprint");
    const nextViews = views.map((v, i) => i === at ? withDrivers(v as never, { hotspots: false }) as unknown as View : v);
    const doc = syncDriverCohorts({ ...l.doc, views: syncDrivers(views, nextViews) });
    assert.deepEqual(mexView(doc)!.drivers, { hotspots: false });
    const plain = resultsLayout(rq(["KRAS: MUT=G12D", "TP53"]) as never, rdata);
    const pv = plain.doc.views || [];
    const pat = pv.findIndex((v) => v.kind === "oncoprint");
    const pdoc = syncDriverCohorts({ ...plain.doc, views: syncDrivers(pv, pv.map((v, i) => i === pat ? withDrivers(v as never, { hotspots: false }) as unknown as View : v)) });
    assert.ok(!("drivers" in mexView(pdoc)!));
  });
  test("the tab is laid out from 2 tracks, not 2 genes: \"KRAS: AMP; KRAS: MUT\" has it (RVP 235-244)", () => {
    const l = resultsLayout(rq(["KRAS: AMP", "KRAS: MUT"]) as never, rdata);
    assert.ok(mexTab(l), "two lines of one gene: the tab is there");
    assert.deepEqual(mexView(l.doc)!.oql, ["KRAS: AMP", "KRAS: MUT"]);
    assert.ok(!l.left.some((x) => /Mutual Exclusivity/.test(x)), "and not listed as left out: " + JSON.stringify(l.left));
  });
  test("one track has no tab, and says why: a single line, or one line twice (the portal's map is keyed by track name)", () => {
    for (const entries of [["KRAS"], ["KRAS: AMP", "KRAS: AMP"]]) {
      const l = resultsLayout(rq(entries) as never, rdata);
      assert.equal(mexTab(l), undefined, entries.join("; "));
      assert.equal(mexView(l.doc), undefined, entries.join("; "));
      assert.ok(l.left.some((x) => /Mutual Exclusivity/.test(x)), entries.join("; ") + ": " + JSON.stringify(l.left));
    }
  });
});
