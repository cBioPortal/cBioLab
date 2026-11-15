// Pathways follows the query's OQL (PR 7 of the OQL series): what needs no database.
// Written from the case table's rows (P*) before the code; each test cites its row and the legacy
// source (cbioportal-frontend at cd8c6df) it was read from:
//   RVPM = src/pages/resultsView/pathwayMapper/ResultsViewPathwayMapper.tsx
//          89-92 the node data are the query genes' and the other pathway genes';
//          113-137 per query LINE, getAlterationData over the line's OQL-filtered data;
//          139-172 the pathway's other genes, with no OQL of their own (any alteration);
//          205-215 the OQL banner (tabReflectsOql: the tab follows the query's OQL)
//   OU   = src/shared/components/oncoprint/OncoprintUtils.ts 1026-1070 getAlterationData,
//          928-958 alterationInfoForOncoprintTrackData / getAlterationInfo (altered AND sequenced
//          for the line's gene, over those sequenced)
// The SQL (which samples a gene's lines alter, which are profiled) is run against the fixture study
// in scripts/check-results-oql.ts, never read here as text.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runPathwayMap } from "../lib/views/pathwaymap/run.ts";
import { LIBRARY_GENES } from "../lib/views/pathwaymap/library.ts";
import { resultsLayout, syncDriverCohorts, syncDrivers } from "../app/portal/results-layout.ts";
import { withDrivers } from "../lib/driver-settings.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation, View, CohortDef } from "../lib/types.ts";
import type { PathwayMapResult } from "../lib/views/pathwaymap/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type GC = { profiled: number; altered: number };
type Row = Record<string, unknown>;
type Asked = { kind: "geneCounts" | "viewAggregate"; label?: string; cohort: string; site: string };

/**
 * A hand-made participant: geneCounts answers every gene from `gc` (any alteration, as today), and
 * viewAggregate answers the lines' counts from `lines` (one row per gene of the lines that carry OQL,
 * as lineCountsSql returns them), after building the statement it was handed so that what the view
 * passes the builder (its exp / prot pins, its profiles) is exercised. It records what it was asked.
 */
function participant(id: string, gc: Record<string, Record<string, GC>>, lines: Record<string, Row[]>, asked: Asked[]) {
  return {
    instance: { id, mode: "patient-level", label: id, conn: PRIMARY },
    async geneCounts(def: { name: string }, genes: string[]) {
      asked.push({ kind: "geneCounts", cohort: def.name, site: id });
      const d = gc[def.name] ?? {};
      return genes.map((g) => ({ gene: g, profiled: d[g]?.profiled ?? 0, altered: d[g]?.altered ?? 0, driver: 0,
        byType: { mutation: { profiled: 0, altered: 0 }, cna: { profiled: 0, altered: 0 }, structuralVariant: { profiled: 0, altered: 0 } } }));
    },
    async viewAggregate(label: string, def: { name: string }, build: (c: string, s: string, d: string) => unknown) {
      asked.push({ kind: "viewAggregate", label, cohort: def.name, site: id });
      build("SELECT 1", id, "db");
      return lines[def.name] ?? [];
    },
  };
}
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, profiles: string[] = ["mutations", "cna", "structural_variants"]): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0], name: n }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7.5", studyProfiles: async () => ({ profiles, gaProfiles: [] }),
  };
}
const pmOf = (r: ViewResult) => (r as unknown as { pathwaymap?: PathwayMapResult }).pathwaymap;
const err = (r: ViewResult) => String((r as { error?: string }).error || "");
const cell = (r: ViewResult, gene: string, c = 0) => pmOf(r)!.genes.find((x) => x.gene === gene)!.cells[c];

// two studies, one cohort: s1 profiles KRAS, NRAS, TP53 (100 samples); s2 NRAS, TP53 (50)
const GC1 = { A: { KRAS: { profiled: 100, altered: 30 }, NRAS: { profiled: 100, altered: 5 }, TP53: { profiled: 100, altered: 40 }, EGFR: { profiled: 100, altered: 12 } } };
const GC2 = { A: { NRAS: { profiled: 50, altered: 5 }, TP53: { profiled: 50, altered: 10 }, EGFR: { profiled: 50, altered: 4 } } };
function two(lines1: Row[] = [], lines2: Row[] = [], profiles?: string[]) {
  const asked: Asked[] = [];
  const c = ctx({ A: cohort({ s1: 100, s2: 50 }) },
    { s1: participant("s1", GC1, { A: lines1 }, asked), s2: participant("s2", GC2, { A: lines2 }, asked) }, profiles);
  return { c, asked };
}
const run = async (view: Record<string, unknown>, lines1: Row[] = [], lines2: Row[] = [], profiles?: string[]) => {
  const { c, asked } = two(lines1, lines2, profiles);
  const r = await runPathwayMap({ kind: "pathwaymap", ...view } as never, c);
  return { r, asked };
};

// ---------------------------------------------------------------------------------------------
// P8: refusals
// ---------------------------------------------------------------------------------------------

describe("P8: a line the parser refuses, or a line of two genes, is refused naming it (ours)", () => {
  test("GAIN / HETLOSS: the parser's message, naming the line, before any query runs", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT=G12D", "TP53: GAIN"] });
    assert.match(err(r), /GAIN is not supported/, "got " + JSON.stringify(r).slice(0, 300));
    assert.match(err(r), /TP53: GAIN/, "names the line: " + err(r));
    assert.equal(pmOf(r), undefined);
    assert.deepEqual(asked, [], "no participant was asked");
    assert.match(err((await run({ oql: ["KRAS: HETLOSS"] })).r), /HETLOSS is not supported/);
    assert.ok(err((await run({ oql: ["KRAS: EXP"] })).r), "EXP without a threshold is refused");
  });
  test("a line naming two genes is refused: one gene per line", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT; TP53"] });
    assert.ok(err(r), "refused; got " + JSON.stringify(r).slice(0, 200));
    assert.match(err(r), /oql/, err(r));
    assert.deepEqual(asked, []);
  });
  test("oql must be a non-empty list of lines", async () => {
    for (const oql of [[], "KRAS: MUT", [""]]) {
      const { r, asked } = await run({ oql });
      assert.ok(err(r), JSON.stringify(oql) + " refused");
      assert.deepEqual(asked, [], JSON.stringify(oql));
    }
  });
  test("drivers that are not driver settings are refused", async () => {
    const { r, asked } = await run({ oql: ["KRAS: MUT_DRIVER"], drivers: { nope: true } });
    assert.match(err(r), /unknown setting 'nope'/, err(r));
    assert.deepEqual(asked, []);
  });
  test("more than 100 genes across the lines is refused, as the query genes are", async () => {
    const oql = Array.from({ length: 101 }, (_, i) => "G" + i + ": MUT");
    assert.match(err((await run({ oql })).r), /at most 100 query genes; this asks for 101/);
  });
});

// ---------------------------------------------------------------------------------------------
// P7: the query genes are the lines' genes
// ---------------------------------------------------------------------------------------------

describe("P7: with oql, the query genes are the lines' genes, in order, once each (RVPM 113-137: one datum per line)", () => {
  test("two lines of one gene and a bare line: TP53, KRAS, NRAS", async () => {
    const { r } = await run({ oql: ["TP53: MUT", "KRAS: AMP", "TP53: HOMDEL", "NRAS"] },
      [{ gene: "TP53", altered: 33 }, { gene: "KRAS", altered: 2 }]);
    assert.equal(err(r), "");
    assert.deepEqual(pmOf(r)!.query, ["TP53", "KRAS", "NRAS"]);
    assert.equal(pmOf(r)!.queryFrom, "genes");
  });
  test("the lines win over genes given beside them; the lines alone are enough", async () => {
    const lines = [{ gene: "KRAS", altered: 7 }];
    assert.deepEqual(pmOf((await run({ genes: ["EGFR"], oql: ["KRAS: MUT=G12D", "TP53"] }, lines)).r)!.query, ["KRAS", "TP53"]);
    assert.deepEqual(pmOf((await run({ oql: ["KRAS: MUT=G12D", "TP53"] }, lines)).r)!.query, ["KRAS", "TP53"]);
  });
  test("a gene's case in a line is the gene's symbol (\"kras: amp\" is KRAS)", async () => {
    const { r } = await run({ oql: ["kras: amp"] }, [{ gene: "KRAS", altered: 1 }]);
    assert.deepEqual(pmOf(r)!.query, ["KRAS"]);
  });
  test("every library gene still comes back, so another pathway re-runs nothing (RVPM 139-172)", async () => {
    const { r } = await run({ oql: ["KRAS: MUT=G12D"] }, [{ gene: "KRAS", altered: 7 }]);
    assert.equal(pmOf(r)!.genes.length, LIBRARY_GENES.length);
  });
});

// ---------------------------------------------------------------------------------------------
// P1–P4: the counts
// ---------------------------------------------------------------------------------------------

describe("P1: a gene with a line carrying OQL is altered where its lines match, over the samples profiled for it (RVPM 113-137, OU 928-958)", () => {
  test("KRAS: AMP MUT=G12D — the lines' count replaces any alteration; profiled as before", async () => {
    const { r } = await run({ oql: ["KRAS: AMP MUT=G12D"] }, [{ gene: "KRAS", altered: 7 }]);
    assert.equal(err(r), "");
    assert.deepEqual(cell(r, "KRAS"), { cohort: "A", profiled: 100, altered: 7, pct: 7 }, "not geneCounts' 30");
  });
  test("summed across studies: each participant's line count, over the profiled summed as before", async () => {
    const { r } = await run({ oql: ["EGFR: AMP"] }, [{ gene: "EGFR", altered: 3 }], [{ gene: "EGFR", altered: 1 }]);
    assert.deepEqual(cell(r, "EGFR"), { cohort: "A", profiled: 150, altered: 4, pct: 2.67 });
  });
  test("a participant whose lines match nothing (no row for the gene) counts 0, not its any-alteration count", async () => {
    const { r } = await run({ oql: ["EGFR: AMP"] }, [{ gene: "EGFR", altered: 3 }], []);
    assert.deepEqual(cell(r, "EGFR"), { cohort: "A", profiled: 150, altered: 3, pct: 2 }, "s2's geneCounts 4 is not added");
    const { r: r0 } = await run({ oql: ["EGFR: AMP"] });
    assert.deepEqual(cell(r0, "EGFR"), { cohort: "A", profiled: 150, altered: 0, pct: 0 }, "profiled, nothing matched: 0%, not N/P");
  });
  test("the lines' counts are asked through the participant's view aggregates, per cohort and study", async () => {
    const { asked } = await run({ oql: ["KRAS: AMP MUT=G12D"] }, [{ gene: "KRAS", altered: 7 }]);
    const va = asked.filter((a) => a.kind === "viewAggregate");
    assert.deepEqual(va.map((a) => a.site).sort(), ["s1", "s2"]);
    assert.ok(va.every((a) => a.cohort === "A"));
    assert.ok(va.every((a) => /pathwaymap/.test(a.label || "")), "labelled as the view's: " + JSON.stringify(va.map((a) => a.label)));
    assert.ok(asked.some((a) => a.kind === "geneCounts"), "geneCounts still gives every gene's profiled and the rest's altered");
  });
  test("the method record checks the % the reader sees: the lines' count (invariant 12)", async () => {
    const { r } = await run({ oql: ["KRAS: AMP MUT=G12D"] }, [{ gene: "KRAS", altered: 7 }]);
    assert.equal(r.method!.check!["pathwaymap:KRAS:A:pct"].v, 7);
  });
  test("the caveat says the query genes follow their lines, not that every alteration counts (RVPM 205-215: the tab reflects OQL)", async () => {
    const { r } = await run({ oql: ["KRAS: AMP MUT=G12D"] }, [{ gene: "KRAS", altered: 7 }]);
    assert.doesNotMatch(r.caveat!, /whatever narrower OQL/, r.caveat!);
    assert.match(r.caveat!, /OQL/, "says what the lines decide: " + r.caveat!);
  });
});

describe("P2: a pathway gene not in the query: any alteration, as today (RVPM 139-172)", () => {
  test("NRAS and TP53 beside a KRAS line keep geneCounts' counts", async () => {
    const { r } = await run({ oql: ["KRAS: AMP MUT=G12D"] }, [{ gene: "KRAS", altered: 7 }]);
    assert.deepEqual(cell(r, "NRAS"), { cohort: "A", profiled: 150, altered: 10, pct: 6.67 });
    assert.deepEqual(cell(r, "TP53"), { cohort: "A", profiled: 150, altered: 50, pct: 33.33 });
    assert.deepEqual(cell(r, "BRAF"), { cohort: "A", profiled: 0, altered: 0, pct: null }, "profiled nowhere: N/P");
  });
});

describe("P3: a bare line counts any alteration, as today (RVPM: the default OQL)", () => {
  test("TP53 beside KRAS: MUT=G12D: geneCounts' TP53", async () => {
    const { r } = await run({ oql: ["KRAS: MUT=G12D", "TP53"] }, [{ gene: "KRAS", altered: 7 }]);
    assert.deepEqual(cell(r, "TP53"), { cohort: "A", profiled: 150, altered: 50, pct: 33.33 });
    assert.deepEqual(cell(r, "KRAS"), { cohort: "A", profiled: 100, altered: 7, pct: 7 });
  });
  test("bare lines alone draw exactly what the same genes draw without oql", async () => {
    const withOql = (await run({ oql: ["KRAS", "NRAS", "TP53"] })).r;
    const without = (await run({ genes: ["KRAS", "NRAS", "TP53"] })).r;
    assert.equal(err(withOql), "");
    assert.deepEqual(pmOf(withOql)!.genes, pmOf(without)!.genes);
    assert.deepEqual(pmOf(withOql)!.query, pmOf(without)!.query);
    assert.deepEqual(pmOf(withOql)!.ranked, pmOf(without)!.ranked);
  });
});

describe("P4: two lines of one gene: the node counts samples either line alters (ours: union; the portal hands PathwayMapper two data, RVPM 113-137)", () => {
  test("KRAS: AMP and KRAS: MUT: one node, the lines' one count, the gene in the query once", async () => {
    const { r } = await run({ oql: ["KRAS: AMP", "KRAS: MUT"] }, [{ gene: "KRAS", altered: 12 }]);
    assert.equal(err(r), "");
    assert.deepEqual(pmOf(r)!.query, ["KRAS"]);
    assert.equal(pmOf(r)!.genes.filter((g) => g.gene === "KRAS").length, 1);
    assert.deepEqual(cell(r, "KRAS"), { cohort: "A", profiled: 100, altered: 12, pct: 12 });
  });
});

describe("P5/P6 (SQL builder): the view's exp / prot reach the lines' statement (OF 1005-1060)", () => {
  const sqlMod = () => import("../lib/views/pathwaymap/sql.ts");
  test("a study with no mRNA or protein profile is refused, naming what it has (lib/oql.ts expressionProfileFor)", async () => {
    const { lineCountsSql } = await sqlMod();
    assert.throws(() => lineCountsSql("SELECT 1", "s", "db", ["KRAS: EXP>=2"], { profiles: ["mutations"] }), /OQL EXP requires an mRNA profile; this study has: mutations/);
    assert.throws(() => lineCountsSql("SELECT 1", "s", "db", ["KRAS: PROT<=-2"], { profiles: ["mutations", "mrna_seq_zscores"] }), /OQL PROT requires an protein profile/);
  });
  test("with the profiles the statement builds; a named profile the study lacks is refused by name", async () => {
    const { lineCountsSql } = await sqlMod();
    const profiles = ["mutations", "mrna_seq_zscores", "rppa_zscores"];
    assert.doesNotThrow(() => lineCountsSql("SELECT 1", "s", "db", ["KRAS: EXP>=2", "EGFR: PROT<=-2", "TP53"], { profiles }));
    assert.throws(() => lineCountsSql("SELECT 1", "s", "db", ["KRAS: EXP>=2"], { profiles, pins: { EXP: "nope_zscores" } }), /nope_zscores/);
  });
  test("through the runner: the view's exp is the pin its lines read", async () => {
    const profiles = ["mutations", "cna", "rna_seq_v2_mrna_median_Zscores"];
    const msg = await run({ oql: ["KRAS: EXP>=2"], exp: "nope_zscores" }, [], [], profiles).then(({ r }) => err(r), (e: Error) => e.message);
    assert.match(msg, /nope_zscores/, "refused naming the pinned profile");
    const ok = await run({ oql: ["KRAS: EXP>=2"], exp: "rna_seq_v2_mrna_median_Zscores" }, [{ gene: "KRAS", altered: 4 }], [], profiles);
    assert.equal(err(ok.r), "");
    assert.equal(cell(ok.r, "KRAS").altered, 4);
  });
});

// ---------------------------------------------------------------------------------------------
// P9: the Results page
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[], extra: Record<string, unknown> = {}) =>
  ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))], ...extra });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
type PmView = { kind: string; genes?: unknown; oql?: string[]; exp?: string; prot?: string; ifHeld?: boolean; drivers?: unknown; cohorts?: string[] };
const pmView = (doc: { views?: View[] }) => (doc.views || []).find((v) => v.kind === "pathwaymap") as unknown as PmView;
const oqlClause = (def: CohortDef) => (def.all || []).find((c) => (c as { kind?: string }).kind === "oql") as Record<string, unknown>;

describe("P9: the Results page's Pathways view carries the query's OQL (RVPM 113-137, 205-215)", () => {
  test("oql is the query's entries, as the Download tab's", () => {
    const entries = ["KRAS: MUT=G12D", "TP53: HOMDEL", "EGFR"];
    const l = resultsLayout(rq(entries) as never, rdata);
    const v = pmView(l.doc);
    assert.deepEqual(v.oql, entries);
    const dl = (l.doc.views || []).find((x) => x.kind === "datafiles") as unknown as { oql: string[] };
    assert.deepEqual(v.oql, dl.oql, "the same lines the Download tab follows");
    assert.deepEqual(v.cohorts, ["Queried"]);
  });
  test("the query's exp / prot / ifHeld travel with the lines", () => {
    const entries = ["KRAS: EXP>=2", "TP53"];
    const one = pmView(resultsLayout(rq(entries, { exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" }) as never, rdata).doc);
    assert.equal(one.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.equal(one.prot, "rppa_Zscores");
    assert.ok(!("ifHeld" in one));
    const many = pmView(resultsLayout(rq(entries, { studies: ["a", "b"], exp: "rna_seq_v2_mrna_median_Zscores", ifHeld: true }) as never, rdata).doc);
    assert.equal(many.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.equal(many.ifHeld, true);
    const none = pmView(resultsLayout(rq(entries) as never, rdata).doc);
    assert.ok(!("exp" in none) && !("prot" in none) && !("ifHeld" in none), JSON.stringify(none));
  });
  test("drivers only when a line names DRIVER: then the page's settings, as the Altered cohort's clause carries them", () => {
    for (const entries of [["KRAS: MUT_DRIVER"], ["TP53: DRIVER", "KRAS"], ["BRAF: MUT_(500-600)_DRIVER"]]) {
      const l = resultsLayout(rq(entries) as never, rdata);
      const v = pmView(l.doc);
      assert.ok("drivers" in v, entries.join("; "));
      assert.deepEqual(v.drivers, oqlClause(l.doc.cohorts!.Altered).drivers, entries.join("; "));
    }
    for (const entries of [["KRAS"], ["KRAS: MUT=G12D", "TP53: HOMDEL"], ["EGFR: AMP"]])
      assert.ok(!("drivers" in pmView(resultsLayout(rq(entries) as never, rdata).doc)), entries.join("; "));
  });
  test("a change to the oncoprint's driver settings reaches a DRIVER Pathways view (OQL_DRIVER_KINDS, syncDriverCohorts)", () => {
    const l = resultsLayout(rq(["KRAS: MUT_DRIVER", "TP53"]) as never, rdata);
    const views = l.doc.views || [];
    const at = views.findIndex((v) => v.kind === "oncoprint");
    const nextViews = views.map((v, i) => i === at ? withDrivers(v as never, { hotspots: false }) as unknown as View : v);
    const doc = syncDriverCohorts({ ...l.doc, views: syncDrivers(views, nextViews) });
    assert.deepEqual(pmView(doc).drivers, { hotspots: false });
    const plain = resultsLayout(rq(["KRAS: MUT=G12D", "TP53"]) as never, rdata);
    const pv = plain.doc.views || [];
    const pat = pv.findIndex((v) => v.kind === "oncoprint");
    const pdoc = syncDriverCohorts({ ...plain.doc, views: syncDrivers(pv, pv.map((v, i) => i === pat ? withDrivers(v as never, { hotspots: false }) as unknown as View : v)) });
    assert.ok(!("drivers" in pmView(pdoc)));
  });
  test("the page's note lists Pathways among the tabs the query's OQL decides", () => {
    const src = readFileSync(new URL("../app/portal/results/page.tsx", import.meta.url), "utf8");
    const note = src.split("\n").find((l) => /OQL decides/.test(l)) || "";
    assert.ok(note, "the note is there");
    assert.match(note.split(/the other gene tabs/)[0], /Pathways/, "named among the tabs the OQL decides, not the others: " + note.trim());
  });
});
