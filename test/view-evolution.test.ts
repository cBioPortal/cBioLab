// The evolution view (lib/views/evolution/): one cohort's drawable patients and one patient's
// mutations across their samples — cBioPortal's Genomic Evolution tab. The runner is driven with
// hand-made participants whose tables live in memory; the row sources' SQL and the figure are
// checked on their own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runEvolution, cellsOf } from "../lib/views/evolution/run.ts";
import { evolutionPatientsSource, evolutionMutationsSource, evolutionSamplesSource } from "../lib/views/evolution/sql.ts";
import { evolutionSvg, lineCells, cellText, portalCellTip, LOG_FLOOR } from "../lib/views/evolution/figure.ts";
import { heatmapOrder } from "../lib/views/evolution/order.ts";
import { FS, textWidth } from "../lib/svg-kit.ts";
import { evolutionKind } from "../lib/views/evolution/kind.ts";
import { pageSql } from "../lib/table-query.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import { pagedTable } from "../lib/views/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult, PatientEvent } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { EvolutionView, EvolutionResult, EvolutionMutation, EvolutionCell } from "../lib/views/evolution/types.ts";
import { axisTicks, timelineAxisItems } from "../lib/timeline-tracks.ts";
import { timelineSvg } from "../lib/timeline-svg.ts";
import { palette } from "../lib/svg-kit.ts";
import { kindText } from "./support/kind-text.ts";

type Row = Record<string, unknown>;
type Tables = (table: string, src: RowSource) => Row[];
const base = (label: string) => label.replace(/:(rows|counts|values|rank)$/, "");
const drawableOnly = (src: RowSource) => src.with.includes("WHERE samples >= 2");
/** what the rows source keeps: the query's filters on patient and on samples (min), as the database would */
const filtered = (rows: Row[], q: TableQuery) => {
  const f = q.filters?.patient as { op: string; value: string } | undefined;
  const s = q.filters?.samples as { min?: number } | undefined;
  return rows.filter((r) => (!f || r.patient === f.value) && (!s || Number(r.samples) >= (s.min ?? 0)));
};

function local(conn: string, tables: Tables, opts: { fail?: string; events?: PatientEvent[]; noTimeline?: boolean } = {}) {
  const asked: string[] = [];
  const rows = (l: string, source: (db: string) => RowSource, q: TableQuery) => filtered(tables(base(l), source(conn)), q);
  return {
    asked,
    instance: { id: conn, mode: "patient-level", label: "Local " + conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], limit: number, offset: number) => {
      asked.push(l);
      if (opts.fail) throw new Error(opts.fail);
      return { rows: rows(l, source, q).slice(offset, offset + limit), total: 0 };
    },
    rowsCounts: async (l: string, source: (db: string) => RowSource, q: TableQuery) => {
      asked.push(l);
      const m = new Map<string, { cohort: string; study: string; n: number; all: number }>();
      for (const r of tables(base(l), source(conn))) {
        const k = r.cohort + "|" + r.study;
        const c = m.get(k) || { cohort: String(r.cohort), study: String(r.study), n: 0, all: 0 };
        c.all++;
        m.set(k, c);
      }
      for (const r of rows(l, source, q)) m.get(r.cohort + "|" + r.study)!.n++;
      return [...m.values()];
    },
    rowsValues: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], column: string) => {
      asked.push(l);
      const m = new Map<string, number>();
      for (const r of rows(l, source, q)) m.set(String(r[column]), (m.get(String(r[column])) || 0) + 1);
      return [...m].map(([v, n]) => ({ v, n, lo: v, hi: v }));
    },
    rowsRank: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], study: string, patient: string) => {
      const i = rows(l, source, q).findIndex((r) => r.study === study && r.patient === patient);
      return i < 0 ? null : i;
    },
    ...(opts.noTimeline ? {} : {
      patientTimeline: async (patient: string) => ({ study: "s1", patient, source: { label: "Local" },
        samples: SAMPLES.filter((s) => s.patient === patient).map((s) => ({ id: s.sid, type: s.type })), events: opts.events ?? EVENTS }),
    }),
  };
}
const aggregate = () => ({ instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: { id: "agg" } } });
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "", count: n, samples: n, mode: "" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, extra: Partial<ViewRun> = {}): ViewRun {
  const vNames = Object.keys(cohorts);
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies: [...new Set(vNames.flatMap((n) => cohorts[n].studies))],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }), ...extra,
  };
}
const run = (view: Partial<EvolutionView>, c: ViewRun) => runEvolution({ kind: "evolution", ...view } as EvolutionView, c);
const evo = (v: ViewResult) => (v as ViewResult & { evolution: EvolutionResult }).evolution;

// Cohort A of study s1: P1 (three samples; T2 not sequenced with a panel covering EGFR), P2 (two samples,
// no allele counts), P3 (one sample). Only P1 is drawable.
const EVERYONE: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", samples: 3, mutations: 3, withVaf: 2 },
  { cohort: "A", study: "s1", patient: "P2", samples: 2, mutations: 1, withVaf: 0 },
  { cohort: "A", study: "s1", patient: "P3", samples: 1, mutations: 4, withVaf: 4 },
];
const SAMPLES = [
  { patient: "P1", sid: "T2", type: "Metastasis", panel: "IMPACT341" },
  { patient: "P1", sid: "T1", type: "Primary", panel: "IMPACT410" },
  { patient: "P1", sid: "T3", type: "Recurrence", panel: "" },
];
const EVENTS: PatientEvent[] = [
  { type: "Specimen", start: 0, end: null, attrs: [["SAMPLE_ID", "T1"]] },
  { type: "Specimen", start: 300, end: null, attrs: [["SAMPLE_ID", "T2"]] },
  { type: "Specimen", start: 700, end: null, attrs: [["SAMPLE_ID", "T3"]] },
];
const cell = (o: number, sid: string, st: string, f: number | null, ac: number | null = null, rc: number | null = null) => [o, sid, st, f, ac, rc];
const MUTS: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", sid: "T1", gene: "TP53", proteinChange: "R273H", mutationType: "Missense_Mutation", samples: "T1, T2", vafs: "1: 0.50 · 2: 0.25 · 3: not profiled", maxVaf: 0.5, called: 2, start: "7577120",
    cells: [cell(1, "T1", "called", 0.5, 50, 50), cell(2, "T2", "called", 0.25, 25, 75), cell(3, "T3", "np", null)] },
  { cohort: "A", study: "s1", patient: "P1", sid: "T2", gene: "EGFR", proteinChange: "L858R", mutationType: "Missense_Mutation", samples: "T2", vafs: "1: not found · 2: 0.40 · 3: 0.05 uncalled", maxVaf: 0.4, called: 1,
    cells: [cell(1, "T1", "absent", 0, 0, 100), cell(2, "T2", "called", 0.4, 40, 60), cell(3, "T3", "uncalled", 0.05, 5, 95)] },
  { cohort: "A", study: "s1", patient: "P1", sid: "T1", gene: "KRAS", proteinChange: "G12D", mutationType: "Missense_Mutation", samples: "T1", vafs: "1: called, no reads · 2: not found · 3: not profiled", maxVaf: null, called: 1,
    cells: [cell(1, "T1", "noVaf", null), cell(2, "T2", "absent", null), cell(3, "T3", "np", null)] },
];
const study = (o: { everyone?: Row[]; muts?: Row[] } = {}): Tables => (table, src) => {
  switch (table) {
    case "evolution": case "evolution:everyone": case "evolution:member": {
      const all = o.everyone ?? EVERYONE;
      return drawableOnly(src) ? all.filter((r) => Number(r.samples) >= 2 && Number(r.withVaf) > 0) : all;
    }
    case "evolution:samples": return SAMPLES.map((s) => ({ cohort: "A", study: "s1", patient: s.patient, sid: s.sid, panel: s.panel }));
    case "evolution:mutations": return o.muts ?? MUTS;
    default: throw new Error("unexpected table " + table);
  }
};
const one = (t: Tables = study(), extra: Partial<ViewRun> = {}, opts: Parameters<typeof local>[2] = {}) => ctx({ A: cohort({ s1: 3 }) }, { s1: local("db1", t, opts) }, extra);

describe("evolution: what it refuses", () => {
  test("a view over other than one cohort, or a malformed setting", async () => {
    assert.match((await run({}, ctx({ A: cohort({ s1: 1 }), B: cohort({ s1: 1 }) }, { s1: local("db1", study()) }))).error!, /steps through one cohort's patients; this one draws 2/);
    assert.match((await run({ rows: 0 }, one())).error!, /^rows \(the page size of the patient list\) is 1 to 1000/);
    assert.match((await run({ patient: "P1" } as never, one())).error!, /^patient is \{study, id\}/);
    assert.match((await run({ chart: "bars" } as never, one())).error!, /^chart is "line"/);
    assert.match((await run({ logScale: "yes" } as never, one())).error!, /^logScale is true or false/);
    assert.match((await run({ sort: { column: "gene" } }, one())).error!, /sort\.column gene is not a column/);
    assert.match((await run({ mutations: [] } as never, one())).error!, /^mutations is the mutation table's query/);
    assert.match((await run({ mutations: { rows: 5000 } }, one())).error!, /^mutations\.rows \(the table's page size\) is 1 to 1000/);
    assert.match((await run({ mutations: { columns: ["cna"] } }, one())).error!, /^mutations: unknown column cna/);
    assert.match((await run({}, one(study(), { table: "cna" }))).error!, /^table is mutations, or none/);
  });

  test("no participant that may disclose a patient, or a named patient outside the cohort's studies", async () => {
    assert.equal((await run({}, ctx({ A: cohort({ agg: 4 }) }, { agg: aggregate() }))).error,
      "no study here may disclose a patient's mutations (agg: aggregate-only: it does not disclose patients)");
    const c = ctx({ A: cohort({ s1: 2, agg: 1 }) }, { s1: local("db1", study()), agg: aggregate() });
    assert.match((await run({ patient: { study: "s9", id: "P1" } }, c)).error!, /^patient P1 is named in s9, which this view's cohort does not span/);
    assert.match((await run({ patient: { study: "agg", id: "X" } }, c)).error!, /^agg is aggregate-only: it does not disclose patients, so its patients' mutations cannot be shown/);
  });

  test("a named patient with one sample, or no allele counts, is refused saying which; one outside the cohort too", async () => {
    assert.equal((await run({ patient: { study: "s1", id: "P3" } }, one())).error, "P3 has 1 sample; following mutations across samples needs at least two");
    assert.equal((await run({ patient: { study: "s1", id: "P2" } }, one())).error,
      "P2's 1 called mutation carry no allele counts (variant and reference reads) in any sample, so there is no allele frequency to draw");
    assert.equal((await run({ patient: { study: "s1", id: "P9" } }, one())).error, "P9 is not a patient of this cohort in s1");
  });

  test("a cohort with no drawable patient says why: one patient's reason, or the counts", async () => {
    assert.equal((await run({}, one(study({ everyone: [EVERYONE[2]] })))).error, "P3 has 1 sample; following mutations across samples needs at least two");
    assert.equal((await run({}, one(study({ everyone: [EVERYONE[2], { ...EVERYONE[2], patient: "P4" }] })))).error,
      "no patient of this cohort can be drawn: of its 2 patients, none has two or more samples — the Genomic Evolution view needs both");
    assert.equal((await run({}, one(study({ everyone: EVERYONE.slice(1) })))).error,
      "no patient of this cohort can be drawn: of its 2 patients, only 1 patient has two or more samples, and their mutations carry no allele counts (variant and reference reads) — the Genomic Evolution view needs both");
    assert.match((await run({ filters: { patient: { op: "equals", value: "P9" } } }, one())).error!, /^the patient list's query keeps none of the 1 patient that can be drawn/);
  });

  test("a participant without a timeline, and a failing query, are refused with their message", async () => {
    assert.equal((await run({}, one(study(), {}, { noTimeline: true }))).error, "s1 cannot disclose a patient's samples and timeline");
    assert.equal((await run({}, one(study(), {}, { fail: "warehouse down" }))).error, "warehouse down");
  });
});

describe("evolution: the patient drawn", () => {
  test("the list holds drawable patients only; the first is drawn with its samples in collection order, days and panels", async () => {
    const v = await run({}, one());
    assert.equal(v.error, undefined, String(v.error));
    const e = evo(v);
    assert.deepEqual(e.rows.map((r) => r.patient), ["P1"]);
    assert.deepEqual(e.patient!.samples.map((s) => [s.id, s.label, s.day, s.panel]), [["T1", "1", 0, "IMPACT410"], ["T2", "2", 300, "IMPACT341"], ["T3", "3", 700, null]]);
    assert.equal(e.x, "time");
    assert.equal(e.noDay, undefined);
    assert.deepEqual(e.drawn!.map((m) => m.gene), ["TP53", "EGFR"], "KRAS has no VAF in any sample: listed, not drawn");
    assert.equal(e.noVaf, 1);
    assert.deepEqual(e.drawn![1].cells.map((c) => c.status), ["absent", "called", "uncalled"]);
    assert.equal(e.mutations!.total, 3);
    assert.deepEqual(e.position, { index: 0, prev: null, next: null });
    assert.match(v.caveat!, /^P1: 3 samples in collection order, placed by the day each was collected/);
    assert.match(v.caveat!, /3 mutations; 2 are drawn — 1 mutation with no allele counts in any sample is listed but not drawn\./);
    assert.match(v.caveat!, /or the sample was not sequenced for mutations \(T3\) — never 0 \(1 such cell here\)/);
    assert.ok(v.method && v.method.steps.length === 3);
    assert.equal(pagedTable(v), e);
    assert.equal(pagedTable(v, "mutations"), e.mutations);
    assert.equal(pagedTable(v, "cna"), undefined);
  });

  test("sequence when asked, or forced and said when a sample has no collection day", async () => {
    assert.equal(evo(await run({ sequential: true }, one())).x, "sequence");
    const v = await run({}, one(study(), {}, { events: EVENTS.slice(0, 2) }));
    assert.equal(evo(v).x, "sequence");
    assert.deepEqual(evo(v).noDay, ["T3"]);
    assert.match(v.caveat!, /drawn in sequence because 1 sample's collection day is recorded|drawn in sequence because 1 sample's/);
    assert.match(evo(await run({}, one(study(), {}, { events: [] }))).noDay!.join(), /T1,T2,T3/);
  });

  test("the table's query decides what is drawn, and is described", async () => {
    const v = await run({ patient: { study: "s1", id: "P1" }, mutations: { filters: { gene: { op: "equals", value: "TP53" } } } }, one());
    assert.equal(v.error, undefined);
    assert.match(v.caveat!, /3 of 3 mutations kept by the table's query \(rows Gene/);
    const w = await run({ chart: "heatmap", logScale: true, dataRange: true }, one(study({ muts: [MUTS[2]] })));
    assert.deepEqual(evo(w).drawn, []);
    assert.equal(evo(w).noVaf, 1);
    assert.deepEqual(evo(w).display, { chart: "heatmap", logScale: true, dataRange: true, expandGaps: false, transpose: false, cluster: true, mutationLabels: true });
    assert.match(w.caveat!, /The heatmap has .*; it colours each sample's VAF/);
  });

  test("past the figure's limit nothing is drawn and the limit is named; the table is still listed", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ ...MUTS[0], proteinChange: "X" + i }));
    const v = await run({}, one(study({ muts: many })));
    const e = evo(v);
    assert.equal(e.drawn, null);
    assert.match(e.undrawn!, /keeps 1,001 mutations; one figure draws at most 1,000/);
    assert.equal(e.mutations!.rows.length, 25);
    assert.equal(evolutionSvg(v as never, { width: 800 }), null);
    assert.match(v.caveat!, /Not drawn: the mutation table's query keeps 1,001 mutations/);
  });

  test("a page of the patient list, a page of the mutation table, and a column's values", async () => {
    const list = evo(await run({}, one(study(), { page: { offset: 0, limit: 10 } })));
    assert.equal(list.patient, null);
    assert.equal(list.rows.length, 1);
    const page = evo(await run({}, one(study(), { page: { offset: 1, limit: 2 }, table: "mutations" })));
    assert.deepEqual(page.mutations!.rows.map((r) => r.values[1]), ["EGFR", "KRAS"]);
    assert.equal(page.patient!.id, "P1");
    const vv = await run({ patient: { study: "s1", id: "P1" } }, one(study(), { values: "gene", table: "mutations" }));
    assert.equal(vv.error, undefined, String(vv.error));
    assert.ok(evo(vv).mutations!.values);
    const none = await run({}, one(study({ everyone: [] }), { page: { offset: 0, limit: 2 }, table: "mutations" }));
    assert.match(none.error!, /no patient with two or more samples and allele counts/);
  });

  test("the results text lists each drawn mutation by sample, and the table", async () => {
    const v = await run({}, one());
    const out = kindText(evolutionKind, v);
    assert.match(out[0], /P1 \(s1\); samples in order: 1 = T1 \(Primary\), day 0; 2 = T2 \(Metastasis\), day 300; 3 = T3 \(Recurrence\), day 700, not sequenced for mutations/);
    assert.match(out[0], /TP53 R273H: 1 VAF 0\.50 \(50 of 100 reads\); 2 VAF 0\.25 \(25 of 100 reads\); 3 not profiled/);
    assert.match(out[0], /EGFR L858R: 1 not found \(0 of 100 reads\); 2 VAF 0\.40 \(40 of 100 reads\); 3 uncalled, VAF 0\.05 \(5 of 100 reads\)/);
    assert.match(out[0], /Mutation table: 3 rows/);
    assert.equal(evolutionKind.title!(v as never), "Genomic evolution — P1");
  });
});

describe("evolution: cells, lines and the figure", () => {
  const S = ["T1", "T2", "T3"];
  test("cellsOf reads the query's tuples in sample order; a sample it does not name is not profiled; an unknown state throws", () => {
    const c = cellsOf([cell(2, "T2", "called", 0.123456, 1, 7), { 0: 1, 1: "T1", 2: "absent", 3: null, 4: null, 5: null }], S);
    assert.deepEqual(c.map((x) => x.status), ["absent", "called", "np"]);
    assert.equal(c[1].vaf, 0.1235);
    assert.deepEqual(cellsOf(null, ["T1"]), [{ status: "np", vaf: null, alt: null, ref: null }]);
    assert.throws(() => cellsOf([cell(1, "T1", "weird", null)], S), /unexpected mutation state weird/);
  });

  test("a line runs from the first to the last sample with variant reads, as the portal trims it", () => {
    const m = (st: string[]): EvolutionMutation => ({ key: "G|P", gene: "G", proteinChange: "P", mutationType: "", cells: st.map((s) => ({ status: s as never, vaf: s === "absent" ? 0 : 0.3, alt: null, ref: null })) });
    assert.deepEqual(lineCells(m(["absent", "called", "np", "absent", "uncalled", "absent"])).map((x) => x.i), [1, 2, 3, 4]);
    assert.deepEqual(lineCells(m(["absent", "np"])), []);
    assert.equal(cellText({ status: "noVaf", vaf: null, alt: null, ref: null }), "called, no allele counts");
    assert.equal(cellText({ status: "absent", vaf: null, alt: null, ref: null }), "not found");
    assert.equal(cellText({ status: "np", vaf: null, alt: null, ref: null }), "not profiled");
  });

  test("every display draws, with no text too small, outside or overprinted, at each card width", async () => {
    for (const view of [{}, { sequential: true }, { logScale: true }, { logScale: true, dataRange: true }, { dataRange: true }, { chart: "heatmap" as const }]) {
      const v = await run(view, one());
      for (const width of [560, 936, 1352]) {
        const svg = evolutionSvg(v as never, { width, theme: "light" })!;
        assert.ok(svg.startsWith("<svg"), JSON.stringify(view));
        assert.deepEqual(lintSvg(svg), [], JSON.stringify(view) + " at " + width);
      }
    }
    const heat = evolutionSvg(await run({ chart: "heatmap" }, one()) as never, { width: 800 })!;
    assert.match(heat, /TP53 R273H in 3 \(T3\): not profiled/);
    assert.match(heat, /EGFR L858R in 3 \(T3\): uncalled, VAF 0\.05/);
    const line = evolutionSvg(await run({ logScale: true }, one()) as never, { width: 800 })!;
    assert.match(line, /stroke-dasharray="3 3"/, "not profiled is bridged, dashed — never drawn at 0");
    assert.equal(LOG_FLOOR, 0.001);
    const same = await run({}, one(study(), {}, { events: EVENTS.map((e) => ({ ...e, start: 5 })) }));
    assert.deepEqual(lintSvg(evolutionSvg(same as never, { width: 700 })!), [], "samples collected the same day stack");
  });
});

describe("evolution: the time axis is the patient timeline's axis", () => {
  const sp = (id: string, start: number): PatientEvent => ({ type: "Specimen", start, end: null, attrs: [["SAMPLE_ID", id]] });
  const events: PatientEvent[] = [sp("T1", 0), sp("T2", 461), sp("T3", 1343), { type: "Treatment", start: 1854, end: null, attrs: [] }];
  const timed = (view: Partial<EvolutionView> = {}) => run(view, one(study(), {}, { events }));

  test("time mode carries the timeline's trimmed ticks, covering events beyond the last sample", async () => {
    const e = evo(await timed());
    assert.equal(e.x, "time");
    assert.ok(e.axis);
    assert.equal(e.axis![0].start, -20);
    assert.equal(e.axis![e.axis!.length - 1].end, 1874);
    assert.deepEqual(e.axis, axisTicks(timelineAxisItems(events), true).ticks);
  });

  test("sequence mode has no axis", async () => {
    const e = evo(await timed({ sequential: true }));
    assert.equal(e.x, "sequence");
    assert.equal(e.axis, undefined);
  });

  test("expandGaps keeps long empty runs as ordinary ticks; without it they are cut", async () => {
    const far = [sp("T1", 0), sp("T2", 2500), sp("T3", 2500)];
    const open = evo(await run({ expandGaps: true }, one(study(), {}, { events: far }))).axis!;
    assert.deepEqual(open, axisTicks(timelineAxisItems(far), false).ticks);
    assert.ok(open.every((t) => !t.trim));
    const cut = evo(await run({}, one(study(), {}, { events: far }))).axis!;
    assert.ok(cut.some((t) => t.trim));
  });

  test("expandGaps is true or false", async () => {
    const r = await run({ expandGaps: "yes" } as never, one());
    assert.match(r.error!, /expandGaps/);
    assert.match(r.error!, /true or false/);
  });

  test("the figure labels years, or falls back to the days title without an axis", async () => {
    const v = await timed();
    const svg = evolutionSvg(v as never, { width: 900 })!;
    assert.match(svg, />0</);
    assert.match(svg, />1y</);
    assert.doesNotMatch(svg, /Days from diagnosis/);
    const bare = structuredClone(v) as typeof v & { evolution: EvolutionResult };
    delete bare.evolution.axis;
    assert.match(evolutionSvg(bare as never, { width: 900 })!, /Days from diagnosis/);
  });
});

describe("evolution: the axis by the rule table (R1–R7)", () => {
  const sp = (id: string, start: number): PatientEvent => ({ type: "Specimen", start, end: null, attrs: [["SAMPLE_ID", id]] });
  // like lgg_ucsf_2014 P04: samples at 0/461/1075/1343, an event at 1854
  const P04: PatientEvent[] = [sp("T1", 0), sp("T2", 461), sp("T4", 1075), sp("T3", 1343), { type: "Treatment", start: 1854, end: null, attrs: [] }];
  const FAR: PatientEvent[] = [sp("T1", 0), sp("T2", 2500), sp("T3", 2500)];
  const on = (events: PatientEvent[], view: Partial<EvolutionView> = {}) => run(view, one(study(), {}, { events }));
  const verticals = (svg: string) => [...svg.matchAll(/<line x1="([-\d.]+)" x2="([-\d.]+)" y1="([-\d.]+)" y2="([-\d.]+)" stroke="([^"]+)"[^>]*>/g)]
    .filter((m) => m[1] === m[2]).map((m) => ({ x: Number(m[1]), y1: Number(m[3]), y2: Number(m[4]), stroke: m[5], tag: m[0] }));

  test("E6 R1: the axis is present for the line chart placed by day", async () => {
    const e = evo(await on(P04));
    assert.equal(e.display.chart, "line");
    assert.equal(e.x, "time");
    assert.ok(e.axis && e.axis.length > 0);
  });

  test("E7 R1: no axis for the heatmap, nor for sequential or forced-sequence placement", async () => {
    assert.equal(evo(await on(P04, { chart: "heatmap" })).axis, undefined);
    const seq = evo(await on(P04, { sequential: true }));
    assert.equal(seq.x, "sequence");
    assert.equal(seq.axis, undefined);
    const forced = evo(await on(P04.filter((e) => attrId(e) !== "T3")));
    assert.equal(forced.x, "sequence");
    assert.equal(forced.axis, undefined);
  });

  test("E8 R2: an event with an empty or blank type, outside the others' range, does not extend the axis", async () => {
    const extra: PatientEvent[] = [...P04, { type: "", start: 6000, end: null, attrs: [] }, { type: "   ", start: -3000, end: -2900, attrs: [] }];
    const e = evo(await on(extra));
    const plain = evo(await on(P04));
    assert.deepEqual(e.axis, plain.axis);
    assert.equal(e.axis![0].start, -20);
    assert.equal(e.axis![e.axis!.length - 1].end, 1874);
  });

  test("E9 R2: the axis is axisTicks(timelineAxisItems(events), !expandGaps), and ends where timelineSvg's axis does", async () => {
    const extra: PatientEvent[] = [...P04, { type: "", start: 6000, end: null, attrs: [] }];
    for (const expandGaps of [false, true]) {
      for (const events of [extra, FAR]) {
        const e = evo(await on(events, { expandGaps }));
        assert.deepEqual(e.axis, axisTicks(timelineAxisItems(events), !expandGaps).ticks);
        const { layout } = timelineSvg({ study: "s1", patient: "P1", events, samples: [], source: { label: "Local" } }, { expandGaps });
        const tl = axisTicks(layout.rows.flatMap((r) => r.items), !expandGaps).ticks;
        assert.equal(e.axis![e.axis!.length - 1].end, tl[tl.length - 1].end);
        assert.deepEqual(e.axis, tl);
      }
    }
  });

  test("E10 R3: display.expandGaps is false by default and true when the view sets it", async () => {
    assert.equal(evo(await on(P04)).display.expandGaps, false);
    assert.equal(evo(await on(P04, { expandGaps: true })).display.expandGaps, true);
    assert.equal(evo(await on(P04, { chart: "heatmap", expandGaps: true })).display.expandGaps, true);
  });

  test("E11 R4: the caveat says empty stretches are cut only when some tick is cut", async () => {
    const v = await on(FAR);
    assert.ok(evo(v).axis!.some((t) => t.trim));
    assert.match(v.caveat!, /empty stretches of four or more years cut/);
    const w = await on(P04);
    assert.ok(!evo(w).axis!.some((t) => t.trim));
    assert.doesNotMatch(w.caveat!, /empty stretches of four or more years cut/);
  });

  test("E12 R4: with expandGaps the caveat says every year shown and not cut", async () => {
    const v = await on(FAR, { expandGaps: true });
    assert.match(v.caveat!, /every year shown/);
    assert.doesNotMatch(v.caveat!, /cut/);
  });

  test("E13 R4: no gap and no expandGaps mentions neither", async () => {
    const v = await on(P04);
    assert.match(v.caveat!, /timeline axis/);
    assert.doesNotMatch(v.caveat!, /cut/);
    assert.doesNotMatch(v.caveat!, /every year shown/);
  });

  test("E14 R4: the heatmap's caveat does not mention the timeline axis", async () => {
    for (const events of [P04, FAR]) {
      const v = await on(events, { chart: "heatmap" });
      assert.equal(evo(v).x, "time");
      assert.doesNotMatch(v.caveat!, /timeline axis/);
    }
  });

  test("E15 R5: the line chart at width 900 for P04 draws month ticks", async () => {
    const v = await on(P04);
    const svg = evolutionSvg(v as never, { width: 900, theme: "light" })!;
    const ticks = verticals(svg).filter((l) => Math.abs(l.y2 - l.y1 - 3) < 0.05);
    assert.ok(ticks.length > 0, "month ticks (3 px) under the axis");
    assert.match(svg, />4m</);
  });

  test("E16 R7: the time axis is titled", async () => {
    const svg = evolutionSvg(await on(P04) as never, { width: 900 })!;
    assert.match(svg, /Time from diagnosis, when each sample was collected/);
  });

  test("E17 R7: a cut draws a dashed guide up through the plot", async () => {
    const svg = evolutionSvg(await on(FAR) as never, { width: 900, theme: "light" })!;
    const g = svg.match(/<g transform="translate\([^"]*\)"><title>\d+ years with no events, cut<\/title>.*?<\/g>/);
    assert.ok(g, "a cut group");
    const guide = verticals(g![0]).find((l) => /stroke-dasharray/.test(l.tag));
    assert.ok(guide, "dashed guide in the cut");
    assert.equal(guide!.y1, 14, "from the plot's top");
    assert.ok(guide!.y2 > 14 + 220, "down to the axis");
  });

  test("E18 R7: the day-0 year line is muted; other year lines use the line colour", async () => {
    const p = palette("light");
    const svg = evolutionSvg(await on(P04) as never, { width: 900, theme: "light" })!;
    const guides = verticals(svg).filter((l) => l.y1 === 14 && !/stroke-dasharray/.test(l.tag));
    assert.equal(guides.length, 6, "years 0 to 5y");
    assert.equal(guides[0].stroke, p.muted);
    assert.ok(guides.slice(1).every((l) => l.stroke === p.line), JSON.stringify(guides.map((l) => l.stroke)));
  });
});

const attrId = (e: PatientEvent) => e.attrs.find(([k]) => k === "SAMPLE_ID")?.[1];

describe("evolution: its row sources name one patient and live only with patient-level participants", () => {
  const part = { cohort: "c", study: "x", cohortSql: "SELECT '' AS pid" };
  test("the SQL reads what the view says it reads", () => {
    const list = pageSql(evolutionPatientsSource([part], "db"), {}, [], 10, 0);
    assert.match(list, /c\.pid AS patient/);
    assert.match(list, /WHERE samples >= 2 AND withVaf > 0/);
    assert.doesNotMatch(pageSql(evolutionPatientsSource([part], "db", false), {}, [], 10, 0), /WHERE samples >= 2/);
    assert.throws(() => evolutionPatientsSource([], "db"), /at least one part/);
    const m = pageSql(evolutionMutationsSource(part, "P-1", "db", ["S1", "S2"]), {}, [], 10, 0);
    assert.match(m, /'P-1' AS patient/);
    assert.match(m, /alteration_type = 'MUTATION_EXTENDED'/);
    assert.match(m, /molecularProfileId NOT LIKE '%uncalled%'/);
    assert.match(m, /ifNull\(mutationType, ''\) != 'Fusion'/);
    assert.match(m, /indexOf\(\['S1', 'S2'\], s\.sid\)/);
    assert.match(pageSql(evolutionMutationsSource(part, "P-1", "db", []), {}, [], 10, 0), /CAST\(\[\] AS Array\(String\)\)/);
    assert.match(pageSql(evolutionSamplesSource(part, "P-1", "db"), {}, [], 10, 0), /AS sid, ifNull\(pn\.panel, ''\) AS panel/);
    // a sample id reaches SQL only through sq()
    assert.match(pageSql(evolutionMutationsSource(part, "P-1", "db", ["a'b"]), {}, [], 10, 0), /'a\\'b'/);
  });
});

describe("evolution: the heatmap's drawing order", () => {
  const mut = (gene: string, proteinChange: string, vafs: (number | null)[]): EvolutionMutation => ({
    key: gene + "|" + proteinChange, gene, proteinChange, mutationType: "Missense_Mutation",
    cells: vafs.map((v) => v == null ? { status: "np" as const, vaf: null, alt: null, ref: null } : { status: v === 0 ? "absent" as const : "called" as const, vaf: v, alt: null, ref: null }),
  });
  const A = mut("TP53", "R273H", [0.5, 0.1, 0.9, 0.3]);
  const B = mut("KRAS", "G12D", [0.05, 0.95, 0.05, 0.95]);
  const C = mut("EGFR", "L858R", [0.5, 0.1, 0.9, 0.3]);
  const perm = (a: number[], n: number) => assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: n }, (_, i) => i));
  const adjacent = (a: number[], i: number, j: number) => assert.equal(Math.abs(a.indexOf(i) - a.indexOf(j)), 1, a.join());
  const combos = [false, true].flatMap((transpose) => [false, true].map((cluster) => ({ transpose, cluster })));

  test("HM9 (R1; replaces the earlier table-order expectation for transpose false): without clustering the mutations sort by \"GENE pChange\" in both orientations, the samples stay in order", () => {
    const drawn = [A, B, C];
    for (const transpose of [false, true]) {
      assert.deepEqual(heatmapOrder(drawn, 4, { transpose, cluster: false }), { mutations: [2, 1, 0], samples: [0, 1, 2, 3] }, "transpose " + transpose);
      // the same gene: the protein change decides, by localeCompare
      const d = [mut("TP53", "R273H", [0.1]), mut("TP53", "R175H", [0.2]), mut("BRAF", "V600E", [0.3]), mut("tp53", "A1B", [0.4])];
      const names = d.map((m) => m.gene + " " + m.proteinChange);
      const want = names.map((_, i) => i).sort((a, b) => names[a].localeCompare(names[b]));
      const r = heatmapOrder(d, 1, { transpose, cluster: false });
      assert.deepEqual(r.mutations, want, "transpose " + transpose);
      assert.deepEqual(r.mutations.map((i) => names[i]), [...names].sort((a, b) => a.localeCompare(b)));
      assert.deepEqual(r.samples, [0]);
      assert.deepEqual(heatmapOrder(drawn, 6, { transpose, cluster: false }).samples, [0, 1, 2, 3, 4, 5]);
    }
  });

  test("clustering puts identical mutations, and identical samples, side by side in either orientation", () => {
    for (const transpose of [false, true]) {
      const r = heatmapOrder([A, B, C], 4, { transpose, cluster: true });
      adjacent(r.mutations, 0, 2);
    }
    const x = mut("G1", "a", [0.2, 0.8, 0.4]);
    const y = mut("G2", "b", [0.9, 0.1, 0.9]);
    const z = mut("G3", "c", [0.2, 0.8, 0.4]);
    for (const transpose of [false, true]) {
      const r = heatmapOrder([x, y, z], 3, { transpose, cluster: true });
      adjacent(r.samples, 0, 2);
    }
  });

  test("every option combination yields permutations, with not-profiled and absent cells too", () => {
    const drawn = [A, B, C, mut("NP", "x", [null, null, null, null]), mut("AB", "y", [0, null, 0, 0.2])];
    for (const o of combos) {
      for (const d of [[A, B, C], drawn, [A]]) {
        const r = heatmapOrder(d, 4, o);
        perm(r.mutations, d.length);
        perm(r.samples, 4);
      }
    }
  });
});

describe("evolution: the heatmap's display settings", () => {
  test("transpose, cluster and mutationLabels must be true or false", async () => {
    for (const [k, v] of [["transpose", "yes"], ["cluster", 1], ["mutationLabels", "no"]] as const) {
      const e = (await run({ [k]: v } as never, one())).error!;
      assert.ok(e.includes(k) && e.includes("true or false"), e);
    }
  });

  test("the display echoes them, defaulting to transpose false, cluster true, mutationLabels true", async () => {
    const d = evo(await run({ chart: "heatmap" }, one())).display;
    assert.deepEqual([d.transpose, d.cluster, d.mutationLabels], [false, true, true]);
    const off = evo(await run({ chart: "heatmap", cluster: false, transpose: true, mutationLabels: false }, one())).display;
    assert.deepEqual([off.transpose, off.cluster, off.mutationLabels], [true, false, false]);
  });
});

describe("evolution: the heatmap's order, layout and labels (HM10–HM17)", () => {
  /** a mutation row for P1's three samples, every cell called */
  const mrow = (gene: string, proteinChange: string, vafs: number[] = [0.5, 0.25, 0.1]): Row => ({
    cohort: "A", study: "s1", patient: "P1", sid: "T1", gene, proteinChange, mutationType: "Missense_Mutation", samples: "T1", vafs: "", maxVaf: 0.5, called: 3,
    cells: vafs.map((f, j) => cell(j + 1, "T" + (j + 1), "called", f, Math.round(f * 100), 100 - Math.round(f * 100))),
  });
  const manyRows = (n: number) => Array.from({ length: n }, (_, i) => mrow("G" + String(i).padStart(3, "0"), "X" + i, [((i * 37) % 100) / 100, ((i * 53) % 100) / 100, ((i * 71) % 100) / 100]));
  const heat = async (view: Partial<EvolutionView>, muts?: Row[]) => {
    const v = await run({ chart: "heatmap", ...view }, one(muts ? study({ muts }) : study()));
    assert.equal(v.error, undefined, String(v.error));
    return v;
  };
  const svgOf = (v: ViewResult, width = 760) => evolutionSvg(v as never, { width, theme: "light" })!;
  const svgWidth = (svg: string) => Number(/viewBox="0 0 ([\d.]+) /.exec(svg)![1]);
  /** the default layout's columns, left to right: the mutation each draws and its first cell rect */
  const columns = (svg: string) => svg.split('<g class="evo-row"').slice(1).map((chunk) => {
    const m = /<g data-s="\d+"><title>([^<]*?) in [^<]*<\/title><rect x="([^"]+)" y="[^"]+" width="([^"]+)"/.exec(chunk)!;
    return { name: m[1], x: Number(m[2]), w: Number(m[3]) };
  });
  /** the rotated mutation labels, in drawing order */
  const rotated = (svg: string) => [...svg.matchAll(/<text x="([^"]+)" y="[^"]+"[^>]*transform="rotate\(90 [^"]*"[^>]*>(?:<title>([^<]*)<\/title>)?([^<]*)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), title: m[2] ?? null, shown: m[3] }));
  const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const ariaLabel = (svg: string) => unesc(/aria-label="([^"]*)"/.exec(svg)![1]);
  const SORTED = ["EGFR L858R", "KRAS G12D", "TP53 R273H"];
  const fixture = [mrow("TP53", "R273H"), mrow("KRAS", "G12D", [0.9, 0.05, 0.9]), mrow("EGFR", "L858R")];

  test("HM10 (R1): unclustered, the SVG draws the mutations by name in both orientations", async () => {
    const v = await heat({ cluster: false }, fixture);
    assert.deepEqual(columns(svgOf(v)).map((c) => c.name), SORTED);
    const t = svgOf(await heat({ cluster: false, transpose: true }, fixture));
    const rows = t.split('<g class="evo-row"').slice(1).map((ch) => /<title>([^<]*?) in /.exec(ch)![1]);
    assert.deepEqual(rows, SORTED);
  });

  test("HM11 (R2): the result carries heatmapOrder only for the heatmap, equal to heatmapOrder(drawn, samples, display)", async () => {
    for (const transpose of [false, true]) for (const cluster of [false, true]) {
      const e = evo(await heat({ transpose, cluster }, fixture));
      assert.ok(e.heatmapOrder, "transpose " + transpose + " cluster " + cluster);
      assert.deepEqual(e.heatmapOrder, heatmapOrder(e.drawn!, e.patient!.samples.length, e.display));
    }
    assert.equal(evo(await run({}, one(study({ muts: fixture })))).heatmapOrder, undefined);
    assert.equal(evo(await run({ chart: "line" }, one(study({ muts: fixture })))).heatmapOrder, undefined);
  });

  test("HM12 (R2): the SVG draws in the result's heatmapOrder, a supplied order included", async () => {
    const v = await heat({ cluster: false }, fixture);
    const e = evo(v);
    const names = e.drawn!.map((m) => m.gene + " " + m.proteinChange);
    assert.deepEqual(columns(svgOf(v)).map((c) => c.name), e.heatmapOrder!.mutations.map((i) => names[i]));
    const reversed = { ...v, evolution: { ...e, heatmapOrder: { mutations: [...e.heatmapOrder!.mutations].reverse(), samples: e.heatmapOrder!.samples } } } as ViewResult;
    const cols = columns(svgOf(reversed)).map((c) => c.name);
    assert.deepEqual(cols, [...SORTED].reverse());
    assert.notEqual(cols[0], columns(svgOf(v))[0].name, "a reversed order changes which mutation comes first");
  });

  test("HM13 (R3): the default layout keeps every column inside the SVG, widening past the requested width when it must", async () => {
    const v = await heat({}, manyRows(300));
    const svg = svgOf(v, 760);
    const W = svgWidth(svg);
    assert.ok(W > 760, "width " + W);
    const cols = columns(svg);
    assert.equal(cols.length, 300);
    const last = cols[cols.length - 1];
    assert.ok(last.x + last.w <= W, "last column ends at " + (last.x + last.w) + ", svg width " + W);
    for (const c of cols) assert.ok(c.x >= 0 && c.x + c.w <= W, c.name);
    assert.equal(svgWidth(svgOf(await heat({}, fixture), 760)), 760, "few mutations keep the requested width");
  });

  test("HM14 (R4): a column is at least a label's height with labels on, 6 px with them off", async () => {
    for (const rows of [manyRows(300), fixture]) {
      for (const cols of [columns(svgOf(await heat({}, rows))), columns(svgOf(await heat({ cluster: false }, rows)))])
        for (const c of cols) assert.ok(c.w + 1 >= FS.small + 2, "labels on: column " + (c.w + 1));
      for (const c of columns(svgOf(await heat({ mutationLabels: false }, rows)))) assert.ok(c.w + 1 >= 6, "labels off: column " + (c.w + 1));
    }
  });

  test("HM15 (R5): each rotated label's baseline sits FS.small*0.35 left of its column's centre, inside the column", async () => {
    for (const rows of [fixture, manyRows(300)]) {
      const svg = svgOf(await heat({}, rows));
      const cols = columns(svg), labels = rotated(svg);
      assert.equal(labels.length, cols.length);
      cols.forEach((c, k) => {
        const colW = c.w + 1, centre = c.x + colW / 2, x = labels[k].x;
        assert.ok(Math.abs(x - (centre - FS.small * 0.35)) <= 0.11, `column ${k}: label x ${x}, centre ${centre}`);
        assert.ok(x >= c.x && x < centre, `column ${k}: label x ${x} outside [${c.x}, ${centre})`);
        assert.equal(unesc(labels[k].title ?? labels[k].shown), c.name, "the label names its column's mutation");
      });
    }
    assert.equal(rotated(svgOf(await heat({ mutationLabels: false }, fixture))).length, 0);
  });

  test("HM16 (R6): a name wider than ~134 px is ellipsized with its full name in a <title>; no label's text is wider than 134 px", async () => {
    const long = "p.Lys123_Ala456delinsGlnSerThrTrpTyrValProGluAspArg";
    const name = "ABCDEFGHIJ " + long;
    assert.ok(textWidth(name, FS.small) > 134);
    const svg = svgOf(await heat({}, [...fixture, mrow("ABCDEFGHIJ", long)]));
    const labels = rotated(svg);
    const cut = labels.find((l) => l.title != null);
    assert.ok(cut, "the long name's label carries a <title>");
    assert.equal(unesc(cut!.title!), name);
    assert.match(cut!.shown, /…$/);
    assert.ok(name.startsWith(unesc(cut!.shown).slice(0, -1)));
    for (const l of labels) assert.ok(textWidth(unesc(l.shown), FS.small) <= 134, l.shown + " is " + textWidth(unesc(l.shown), FS.small));
    for (const l of labels.filter((x) => x.title == null)) assert.ok(SORTED.includes(unesc(l.shown)), "a short name is drawn whole");
  });

  test("HM17 (R7): the SVG's title and the caveat name the orientation and the order", async () => {
    const cases = [
      { view: {}, title: "heatmap, a row per sample, clustered", orient: "a row per sample and a column per mutation", clustered: true },
      { view: { transpose: true }, title: "heatmap, a row per mutation, clustered", orient: "a row per mutation and a column per sample", clustered: true },
      { view: { cluster: false }, title: "heatmap, a row per sample", orient: "a row per sample and a column per mutation", clustered: false },
      { view: { transpose: true, cluster: false }, title: "heatmap, a row per mutation", orient: "a row per mutation and a column per sample", clustered: false },
    ];
    for (const c of cases) {
      const v = await heat(c.view, fixture);
      const t = ariaLabel(svgOf(v));
      assert.ok(t.includes(c.title), JSON.stringify(c.view) + ": " + t);
      if (!c.clustered) assert.doesNotMatch(t, /clustered/, t);
      assert.ok(v.caveat!.includes(c.orient), JSON.stringify(c.view));
      if (c.clustered) assert.match(v.caveat!, /clustered/);
      else { assert.match(v.caveat!, /the mutations by name/); assert.doesNotMatch(v.caveat!, /clustered/); }
    }
  });
});

describe("PTB-GE-LC-6: portalCellTip, the portal's Genomic Evolution tooltip", () => {
  const cell = (status: EvolutionCell["status"], vaf: number | null = null, alt: number | null = null, ref: number | null = null): EvolutionCell => ({ status, vaf, alt, ref });
  const tip = (c: EvolutionCell) => portalCellTip(c, "P04_Rec1", "TP53");
  const cases: [string, EvolutionCell, string][] = [
    ["T1 called with counts", cell("called", 0.6923, 54, 24), "VAF: 0.69 (54 reads of 78 total)"],
    ["T2 called without counts", cell("called"), "Mutated, but we don't have VAF data."],
    ["T3 noVaf", cell("noVaf"), "Mutated, but we don't have VAF data."],
    ["T4 uncalled with counts", cell("uncalled", 0.12, 3, 22), "Mutation uncalled (VAF: 0.12 (3 reads of 25 total))"],
    ["T5 uncalled without counts", cell("uncalled"), "Mutation uncalled"],
    ["T6 absent with counts", cell("absent", null, 0, 40), "Mutation not detected (VAF: 0.00 (0 reads of 40 total))"],
    ["T7 absent without counts", cell("absent"), "Mutation not detected"],
    ["T8 not profiled", cell("np"), "P04_Rec1 is not sequenced for TP53 mutations."],
  ];
  for (const [name, c, want] of cases) test(name, () => assert.equal(tip(c), want));
});
