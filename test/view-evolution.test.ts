// The evolution view (lib/views/evolution/): one cohort's drawable patients and one patient's
// mutations across their samples — cBioPortal's Genomic Evolution tab. The runner is driven with
// hand-made participants whose tables live in memory; the row sources' SQL and the figure are
// checked on their own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runEvolution, cellsOf } from "../lib/views/evolution/run.ts";
import { evolutionPatientsSource, evolutionMutationsSource, evolutionSamplesSource } from "../lib/views/evolution/sql.ts";
import { evolutionSvg, lineCells, cellText, LOG_FLOOR } from "../lib/views/evolution/figure.ts";
import { evolutionKind } from "../lib/views/evolution/kind.ts";
import { pageSql } from "../lib/table-query.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import { pagedTable } from "../lib/views/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult, PatientEvent } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { EvolutionView, EvolutionResult, EvolutionMutation } from "../lib/views/evolution/types.ts";

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
    assert.deepEqual(evo(w).display, { chart: "heatmap", logScale: true, dataRange: true });
    assert.match(w.caveat!, /The heatmap colours each sample's VAF/);
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
    const out: string[] = [];
    evolutionKind.text!(v as never, { out, pFmt: String, caveatOf: () => "", noteOf: () => "", plotUnit: () => "", methodOf: () => "" });
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
    const m = (st: string[]): EvolutionMutation => ({ gene: "G", proteinChange: "P", mutationType: "", cells: st.map((s) => ({ status: s as never, vaf: s === "absent" ? 0 : 0.3, alt: null, ref: null })) });
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
