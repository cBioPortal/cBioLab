// The alterations view (lib/views/alterations/run.ts): one cohort's patient list and one patient's
// Mutations, Copy Number Alterations and Structural Variants tables, as cBioPortal's patient view.
// Driven with hand-made participants whose tables live in memory.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { vafSort, alterationSource } from "../lib/patient-alterations.ts";
import { runAlterations } from "../lib/views/alterations/run.ts";
import { ALTERATION_COLUMNS, ALTERATION_DEFAULT_COLUMNS } from "../lib/patient-alterations.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { AlterationsView, AlterationsResult } from "../lib/views/alterations/types.ts";

type Row = Record<string, unknown>;
/** a table's rows, by its label (alterations, alterations:samples, alterations:mutations, …) and the row source the view built */
type Tables = (table: string, src: RowSource) => Row[];
const base = (label: string) => label.replace(/:(rows|counts|values|rank|member)$/, "");
/** the patient list's member check is a filter on the patient column alone, so a row the list's own query drops (`_out`) counts there */
const filtered = (rows: Row[], q: TableQuery) => {
  const f = q.filters?.patient as { op: string; value: string } | undefined;
  return f ? rows.filter((r) => r.patient === f.value).map(({ _out, ...r }) => r) : rows;
};
/** the cohort's samples of a patient: the source keeps only those of the patient's samples the cohort holds */
const cohortOnly = (src: RowSource) => src.with.includes("SELECT * FROM (");

/** A patient-level participant whose tables are `tables`; a row marked `_out` counts in `all` only. */
function local(conn: string, tables: Tables, opts: { fail?: string } = {}) {
  const asked: string[] = [];
  const rows = (l: string, source: (db: string) => RowSource, q: TableQuery) => filtered(tables(base(l), source(conn)), q);
  const kept = (l: string, source: (db: string) => RowSource, q: TableQuery) => rows(l, source, q).filter((r) => !r._out);
  return {
    asked,
    instance: { id: conn, mode: "patient-level", label: "Local " + conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], limit: number, offset: number) => {
      asked.push(l);
      if (opts.fail) throw new Error(opts.fail);
      return { rows: kept(l, source, q).slice(offset, offset + limit), total: 0 };
    },
    rowsCounts: async (l: string, source: (db: string) => RowSource, q: TableQuery) => {
      asked.push(l);
      const m = new Map<string, { cohort: string; study: string; n: number; all: number }>();
      for (const r of rows(l, source, q)) {
        const k = r.cohort + "|" + r.study;
        const c = m.get(k) || { cohort: String(r.cohort), study: String(r.study), n: 0, all: 0 };
        c.all++; if (!r._out) c.n++;
        m.set(k, c);
      }
      return [...m.values()];
    },
    rowsValues: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], column: string) => {
      asked.push(l);
      const m = new Map<string, number>();
      for (const r of kept(l, source, q)) m.set(String(r[column]), (m.get(String(r[column])) || 0) + 1);
      return [...m].map(([v, n]) => ({ v, n, lo: v, hi: v }));
    },
    rowsRank: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], study: string, patient: string) => {
      asked.push(l);
      const i = kept(l, source, q).findIndex((r) => r.study === study && r.patient === patient);
      return i < 0 ? null : i;
    },
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
const run = (view: Partial<AlterationsView>, c: ViewRun) => runAlterations({ kind: "alterations", ...view } as AlterationsView, c);
const alt = (v: ViewResult) => (v as ViewResult & { alterations: AlterationsResult }).alterations;

// Cohort A of study s1: P1 (two samples: S1b a primary, S1a a metastasis; only S1a in the cohort) and P2
// (one sample). P1 has one mutation and one CNA call, P2 nothing. P9 is a patient of the study outside A.
const LIST: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", samples: 2, mutations: 1, cna: 1, sv: 0 },
  { cohort: "A", study: "s1", patient: "P2", samples: 1, mutations: 0, cna: 0, sv: 0 },
];
const P1_SAMPLES = [{ cohort: "A", study: "s1", patient: "P1", sid: "S1a", type: "Metastasis" }, { cohort: "A", study: "s1", patient: "P1", sid: "S1b", type: "Primary" }];
const MUT: Row[] = [{ cohort: "A", study: "s1", patient: "P1", sid: "S1a", gene: "KRAS", proteinChange: "G12D", oncogenicity: "Oncogenic", level: "LEVEL_1",
  mutationType: "Missense_Mutation", copy: null, freq: 12.345, vaf: 10 / 57, altCount: "", refCount: null, start: "25398284" }];
const CNA: Row[] = [{ cohort: "A", study: "s1", patient: "P1", sid: "S1a", gene: "MYC", cna: "AMP", oncogenicity: "Likely Oncogenic", level: "", cytoband: "8q24.21", freq: 3.06 }];
const study = (o: { list?: Row[]; samples?: Row[]; mut?: Row[]; cna?: Row[]; sv?: Row[]; profiled?: Row[] } = {}): Tables => (table, src) => {
  switch (table) {
    case "alterations": return o.list ?? LIST;
    // the cohort's samples of the patient: the source filters the patient's samples to the cohort's
    case "alterations:samples": return (o.samples ?? P1_SAMPLES).filter((s) => !cohortOnly(src) || s.sid === "S1a");
    case "alterations:mutations": return o.mut ?? MUT;
    case "alterations:cna": return o.cna ?? CNA;
    case "alterations:sv": return o.sv ?? [];
    // the mixed-panel counts: no mixed panel unless a test supplies rows
    case "alterations:mixed-mutations": case "alterations:mixed-cna": return [];
    case "alterations:profiled": return o.profiled ?? [];
    default: throw new Error("unexpected table " + table);
  }
};
const one = (t: Tables = study(), extra: Partial<ViewRun> = {}) => ctx({ A: cohort({ s1: 2 }) }, { s1: local("db1", t) }, extra);

describe("alterations: what it refuses", () => {
  test("a view over other than exactly one cohort", async () => {
    const v = await run({}, ctx({ A: cohort({ s1: 1 }), B: cohort({ s1: 1 }) }, { s1: local("db1", study()) }));
    assert.match(v.error!, /steps through one cohort's patients; this one draws 2/);
  });

  test("a page size outside 1 to 1000, for the list and for each table", async () => {
    assert.match((await run({ rows: 0 }, one())).error!, /^rows \(the page size of the patient list\) is 1 to 1000/);
    assert.match((await run({ cna: { rows: 5000 } }, one())).error!, /^cna\.rows \(the table's page size\) is 1 to 1000/);
  });

  test("a patient that is not {study, id} with a valid id", async () => {
    for (const patient of ["P1", { study: "s1" }, { study: "s1", id: "P 1" }])
      assert.match((await run({ patient } as never, one())).error!, /^patient is \{study, id\}/);
  });

  test("an unknown column in the list's query or a table's, named with its table", async () => {
    assert.match((await run({ sort: { column: "gene" } }, one())).error!, /sort\.column gene is not a column/);
    assert.match((await run({ mutations: { columns: ["cna"] } }, one())).error!, /^mutations: unknown column cna/);
  });

  test("a table's query that is not an object", async () => {
    assert.match((await run({ sv: [] } as never, one())).error!, /^sv is that table's query/);
    assert.match((await run({ cna: "x" } as never, one())).error!, /^cna is that table's query/);
  });

  test("samples other than patient or cohort", async () => {
    assert.match((await run({ samples: "all" } as never, one())).error!, /^samples is "patient"/);
  });

  test("a table request naming no table of the view", async () => {
    assert.match((await run({}, one(study(), { table: "drugs" }))).error!, /^table is one of mutations, cna, sv/);
  });

  test("no participant that may disclose a patient's alterations", async () => {
    assert.equal((await run({}, ctx({ A: cohort({ agg: 4 }) }, { agg: aggregate() }))).error,
      "no study here may disclose a patient's alterations (agg: aggregate-only: it does not disclose patients)");
  });

  test("a named patient of a study the cohort does not span, or of one that does not disclose patients", async () => {
    const c = ctx({ A: cohort({ s1: 2, agg: 1 }) }, { s1: local("db1", study()), agg: aggregate() });
    assert.match((await run({ patient: { study: "s9", id: "P1" } }, c)).error!, /^patient P1 is named in s9, which this view's cohort does not span \(s1, agg\)/);
    assert.equal((await run({ patient: { study: "agg", id: "X1" } }, c)).error,
      "agg is aggregate-only: it does not disclose patients, so its patients' alterations cannot be shown");
  });

  test("a named patient who is not one of the cohort's patients", async () => {
    assert.equal((await run({ patient: { study: "s1", id: "P9" } }, one())).error, "P9 is not a patient of this cohort in s1");
  });

  test("a failing query is refused with its message", async () => {
    assert.equal((await run({}, ctx({ A: cohort({ s1: 2 }) }, { s1: local("db1", study(), { fail: "warehouse down" }) }))).error, "warehouse down");
  });
});

describe("alterations: the list and the first patient's tables", () => {
  test("with no patient named, the list's first patient, with every sample numbered and each of the three tables", async () => {
    const v = await run({}, one());
    assert.equal(v.error, undefined, String(v.error));
    const a = alt(v);
    assert.deepEqual(a.rows.map((r) => r.patient), ["P1", "P2"]);
    assert.equal(a.total, 2);
    assert.deepEqual(a.patient && { study: a.patient.study, id: a.patient.id, samples: a.patient.samples.map((s) => s.id) },
      { study: "s1", id: "P1", samples: ["S1b", "S1a"] });
    assert.equal(a.patient!.shown, undefined, "samples: patient reads every sample, so no subset is named");
    assert.deepEqual(a.position, { index: 0, prev: null, next: { study: "s1", id: "P2" } });
    assert.deepEqual(Object.keys(a.tables), ["mutations", "cna", "sv"]);
    assert.equal(a.tables.sv!.total, 0);
    assert.equal(a.oncokbPin, null);
    assert.ok(v.method);
    assert.match(v.caveat!, /^P1 — Mutations: 1 row; Copy Number Alterations: 1 row; Structural Variants: 0 rows\. /);
    assert.match(v.caveat!, /No OncoKB version is pinned here, so the annotation columns are empty\./);
    assert.doesNotMatch(v.caveat!, /Copy # on a mutation/, "P1 has two samples, so Copy # is not shown and the caveat does not explain it");
    assert.match(v.caveat!, /The patient list: 2 patients\. Sorted with patients who have any alteration first, then by patient id across the cohort;/);
  });

  test("each cell as the table shows it: OncoKB's call with its level, numbers as numbers, allele frequency as the source gives it (its SQL rounds it to 4 places, once: check:patient-vaf V), and Cohort % to 1, blanks", async () => {
    const t = alt(await run({ mutations: { columns: ["gene", "annotation", "vaf", "freq", "altCount", "refCount", "copy", "start"] } }, one())).tables;
    const cols = t.mutations!.columns.map((c) => c.id);
    const row = Object.fromEntries(cols.map((id, i) => [id, t.mutations!.rows[0].values[i]]));
    assert.equal(row.annotation, "Oncogenic · Level 1");
    assert.equal(row.vaf, 10 / 57, "not rounded again in the runner: the source already holds the 4-place value the filter reads");
    assert.equal(row.freq, 12.345, "Cohort % is passed unrounded so the browser rounds it once (A1)");
    assert.equal(row.altCount, null, "an empty number is missing, not 0");
    assert.equal(row.refCount, null);
    assert.equal(row.copy, "", "missing text is blank");
    assert.equal(row.start, 25398284);
    assert.equal(row.mutationType, "Missense", "the portal's label, which the column filters and searches");
    assert.equal(t.mutations!.rows[0].detail?.mutationType, "Missense_Mutation", "the stored type rides in the detail");
    assert.equal(t.mutations!.rows[0].sample, "S1a");
    assert.deepEqual(t.mutations!.shown, ["gene", "annotation", "vaf", "freq", "altCount", "refCount", "copy", "start"]);
    const cna = Object.fromEntries(t.cna!.columns.map((c, i) => [c.id, t.cna!.rows[0].values[i]]));
    assert.equal(cna.annotation, "Likely Oncogenic", "no level, no level suffix");
  });

  test("A1 (PAT-STM-2): the Cohort % cell is unrounded in both the mutations and cna tables (the browser rounds it once)", async () => {
    const mut = [{ ...MUT[0], freq: 72.47191 }];
    const cna = [{ ...CNA[0], freq: 72.47191 }];
    const t = alt(await run({ mutations: { columns: ["gene", "freq"] }, cna: { columns: ["gene", "freq"] } }, one(study({ mut, cna })))).tables;
    for (const k of ["mutations", "cna"] as const) {
      const i = t[k]!.columns.findIndex((c) => c.id === "freq");
      assert.equal(t[k]!.rows[0].values[i], 72.47191, k);
    }
  });

  test("a pinned OncoKB version is named; a table's query is described in its line", async () => {
    const mut = [...MUT, { ...MUT[0], gene: "TP53", _out: true }];
    const v = await run({ mutations: { search: "kras" } }, one(study({ mut }), { pin: "v4.1" }));
    assert.equal(alt(v).oncokbPin, "v4.1");
    assert.match(v.caveat!, /Mutations: 1 of 2 rows \(rows containing “kras” in a shown column\)/);
    assert.match(v.caveat!, /Annotation is OncoKB v4\.1/);
  });

  test("an empty cohort: no patient, no tables, and the caveat says so", async () => {
    const v = await run({}, one(study({ list: [] })));
    const a = alt(v);
    assert.equal(a.patient, null);
    assert.equal(a.position, null);
    assert.deepEqual(a.tables, {});
    assert.match(v.caveat!, /^No patient to list: the cohort's patient list is empty\. /);
  });

  test("an aggregate-only study beside the local one is listed as left out", async () => {
    const v = await run({}, ctx({ A: cohort({ s1: 2, agg: 3 }) }, { s1: local("db1", study()), agg: aggregate() }));
    assert.deepEqual(alt(v).excluded, [{ study: "agg", reason: "aggregate-only: it does not disclose patients", patients: 3 }]);
    assert.deepEqual(v.studies, ["s1", "agg"]);
  });
});

describe("alterations: a named patient", () => {
  test("placed in the list's order, with the patients either side", async () => {
    const a = alt(await run({ patient: { study: "s1", id: "P2" } }, one(study({ samples: [{ cohort: "A", study: "s1", patient: "P2", sid: "S2", type: "Primary" }] }))));
    assert.equal(a.patient!.id, "P2");
    assert.deepEqual(a.position, { index: 1, prev: { study: "s1", id: "P1" }, next: null });
  });

  test("a cohort patient the list's query leaves out is still shown, with no position", async () => {
    const list = [LIST[0], { ...LIST[1], _out: true }];
    const v = await run({ patient: { study: "s1", id: "P2" }, filters: { mutations: { min: 1 } } } as never, one(study({ list, samples: [] })));
    assert.equal(v.error, undefined, String(v.error));
    assert.equal(alt(v).patient!.id, "P2");
    assert.equal(alt(v).position, null);
  });

  test("samples: cohort reads only the cohort's samples, each keeping its number among all the patient's", async () => {
    const v = await run({ samples: "cohort" }, one());
    const a = alt(v);
    assert.deepEqual(a.patient!.samples.map((s) => s.id), ["S1b", "S1a"]);
    assert.deepEqual(a.patient!.shown, ["S1a"]);
    assert.match(v.caveat!, /Only 1 sample of P1's 2 is in the cohort, and the tables read only it \(samples: "cohort"\)/);
    assert.match(v.caveat!, /Copy # on a mutation is the gene's deep calls anywhere in the cohort's samples of the patient\./);
  });
});

describe("alterations: a page or a column's values", () => {
  test("a page of the patient list: the list alone, no patient, no tables", async () => {
    const a = alt(await run({}, one(study(), { page: { offset: 1, limit: 1 } })));
    assert.deepEqual(a.rows.map((r) => r.patient), ["P2"]);
    assert.equal(a.patient, null);
    assert.deepEqual(a.tables, {});
  });

  test("a page of one table: the list's first patient's, that table alone", async () => {
    const v = await run({}, one(study(), { page: { offset: 0, limit: 10 }, table: "cna" }));
    const a = alt(v);
    assert.deepEqual(Object.keys(a.tables), ["cna"]);
    assert.equal(a.tables.cna!.rows[0].values[1], "MYC");
    assert.equal(a.patient!.id, "P1");
    assert.deepEqual(a.patient!.samples, [], "a page request carries no samples");
    assert.equal(a.total, 0);
  });

  test("a page of the named patient's table", async () => {
    const a = alt(await run({ patient: { study: "s1", id: "P1" } }, one(study(), { page: { offset: 0, limit: 10 }, table: "mutations" })));
    assert.equal(a.patient!.id, "P1");
    assert.equal(a.tables.mutations!.total, 1);
  });

  test("a table page when the cohort has no patients is refused", async () => {
    assert.match((await run({}, one(study({ list: [] }), { page: { offset: 0, limit: 10 }, table: "sv" }))).error!,
      /^the cohort's patient list is empty, so there is no patient's sv table to page/);
  });

  test("a column's values: of a table, or of the patient list", async () => {
    const t = alt(await run({}, one(study(), { values: "gene", table: "mutations" }))).tables.mutations!;
    assert.deepEqual(t.values, { column: "gene", numeric: false, values: [{ value: "KRAS", n: 1 }], truncated: false });
    const l = alt(await run({}, one(study(), { values: "mutations" })));
    assert.deepEqual(l.values, { column: "mutations", numeric: true, min: 0, max: 1, n: 2 }, "a numeric column's values are its range");
  });
});

// the peer pages each table itself; it answers with its own OncoKB version
const peer = (tables: Tables) => {
  const reqs: Record<string, unknown>[] = [];
  return {
    reqs,
    instance: { id: "peer", mode: "aggregate-only", label: "Peer Hospital", conn: { id: "peer" } }, peerUrl: "http://peer.invalid", patientKinds: new Set(["alterations"]),
    patientRows: async (req: { table: string; mode: string; query: TableQuery; limit?: number; offset?: number; patient?: string; column?: string }) => {
      reqs.push(req as never);
      const rows: Row[] = filtered(tables(req.table, { with: req.table === "alterations:samples" && (req as { samples?: string }).samples === "cohort" ? "SELECT * FROM (" : "" } as RowSource), req.query)
        .map((r) => ({ ...r, study: "p" }));
      const kept = rows.filter((r) => !r._out);
      switch (req.mode) {
        case "counts": return { counts: [{ cohort: "A", study: "p", n: kept.length, all: rows.length }], oncokbPin: "peer-v2" };
        case "page": return { rows: kept.slice(req.offset!, req.offset! + req.limit!), oncokbPin: "peer-v2" };
        case "rank": { const i = kept.findIndex((r) => r.patient === req.patient); return { rank: i < 0 ? null : i }; }
        default: return { values: [] };
      }
    },
  };
};
describe("alterations: a federation peer that serves patient alterations", () => {

  test("the peer's patient is drawn from its own tables, marked as from the peer, annotated with the peer's OncoKB version", async () => {
    const p = peer(study());
    const v = await run({}, ctx({ A: cohort({ p: 2 }) }, { p }, { pin: "local-v1" }));
    assert.equal(v.error, undefined, String(v.error));
    const a = alt(v);
    assert.deepEqual(a.patient!.source, { label: "Peer Hospital", remote: true });
    assert.equal(a.oncokbPin, "peer-v2", "the version the peer annotated with, not this instance's");
    assert.match(v.caveat!, /P1's tables come from Peer Hospital via federation, computed in its database\./);
    assert.match(v.caveat!, /Patients of p come from Peer Hospital via federation/);
    assert.ok(p.reqs.some((r) => r.table === "alterations:mutations" && r.oncokbPin === "local-v1"), "the peer is told this instance's pin");
  });

  test("a named patient the peer's list leaves out is checked for membership by the peer", async () => {
    const p = peer(study({ list: [LIST[0], { ...LIST[1], _out: true }] }));
    const ok = await run({ patient: { study: "p", id: "P2" } }, ctx({ A: cohort({ p: 2 }) }, { p }));
    assert.equal(ok.error, undefined, String(ok.error));
    assert.ok(p.reqs.some((r) => r.table === "alterations" && r.mode === "counts" && JSON.stringify(r.query).includes("P2")));
    const no = await run({ patient: { study: "p", id: "P9" } }, ctx({ A: cohort({ p: 2 }) }, { p: peer(study()) }));
    assert.equal(no.error, "P9 is not a patient of this cohort in p");
  });

  test("a peer that never names its OncoKB version leaves the patient's pin null", async () => {
    const p = peer(study());
    const answer = p.patientRows;
    p.patientRows = async (req) => { const a = await answer(req) as Record<string, unknown>; delete a.oncokbPin; return a as never; };
    const a = alt(await run({}, ctx({ A: cohort({ p: 2 }) }, { p }, { pin: "local-v1" })));
    assert.equal(a.oncokbPin, null);
  });

  test("V1 (PAT-MT-2, PAT-CNA-4): the mutations table has no Samples column and has Copy # for a one-sample patient, the reverse for two", async () => {
    const shown = async (view: Partial<AlterationsView>, t: Tables) => alt(await run(view, one(t))).tables.mutations!.shown!;
    const one1 = await shown({ patient: { study: "s1", id: "P2" } }, study({ samples: [{ cohort: "A", study: "s1", patient: "P2", sid: "S2", type: "Primary" }] }));
    assert.ok(!one1.includes("samples") && one1.includes("copy"), one1.join());
    const two = await shown({}, study());
    assert.ok(two.includes("samples") && !two.includes("copy"), two.join());
    const coh = await shown({ samples: "cohort" }, study());
    assert.ok(!coh.includes("samples"), "1 of 2 samples in the cohort: " + coh.join());
  });
});

describe("alterations: PAT-STM-12 sample order", () => {
  const T = [{ cohort: "A", study: "s1", patient: "P1", sid: "T01", type: "Primary" }, { cohort: "A", study: "s1", patient: "P1", sid: "T02", type: "Primary" }];
  const build = (patientTimeline: () => Promise<unknown>, withs: string[] = []) => {
    const t: Tables = (table, src) => { withs.push(src.with); return table === "alterations:samples" ? T : study()(table, src); };
    return { ...local("db1", t), patientTimeline };
  };
  const mine = { patient: { study: "s1", id: "P1" } } as never;
  test("A1 PAT-STM-12: the patient's samples are numbered by their events, and the sources get the order [T02, T01]", async () => {
    const withs: string[] = [];
    const resolver = build(async () => ({ events: [{ type: "Sample acquisition", start: -40, end: null, attrs: [["SAMPLE_ID", "T01"]] }, { type: "Sample acquisition", start: -56, end: null, attrs: [["SAMPLE_ID", "T02"]] }], samples: [], source: { label: "x" } }), withs);
    const v = await run(mine, ctx({ A: cohort({ s1: 2 }) }, { s1: resolver }));
    const ps = alt(v).patient!.samples;
    assert.deepEqual(ps.map((s) => s.id), ["T02", "T01"]);
    assert.deepEqual(ps.map((s) => s.label), ["1", "2"]);
    const ordered = withs.filter((w) => w.includes("T01") && w.includes("T02"));
    assert.ok(ordered.length > 0, "a source names both samples");
    assert.ok(ordered.every((w) => w.indexOf("T02") < w.indexOf("T01")), "T02 precedes T01 in the source");
  });
  test("A2 PAT-STM-12: a refused timeline does not refuse the view; the caveat says why", async () => {
    const resolver = build(async () => { throw new Error("timeline refused"); });
    const v = await run(mine, ctx({ A: cohort({ s1: 2 }) }, { s1: resolver }));
    assert.equal(v.error, undefined, String(v.error));
    assert.ok(alt(v).patient, "tables present");
    assert.match(String(v.caveat), /timeline refused/);
  });
});

describe("PAT-SV-3: the structural variant table's columns", () => {
  const P1 = { study: "s1", id: "P1" };
  test("PAT-SV-3 SV1: the default SV columns, in the portal's order, without Breakpoint Type", () => {
    assert.deepEqual(ALTERATION_DEFAULT_COLUMNS.sv, ["samples", "gene1", "gene2", "status", "class", "eventInfo", "connectionType"]);
    assert.ok(!ALTERATION_DEFAULT_COLUMNS.sv.includes("breakpointType"));
  });

  test("PAT-SV-3 SV2: column order gene1 < gene2 < status < class < eventInfo < connectionType < breakpointType", () => {
    const ids: string[] = ALTERATION_COLUMNS.sv.map((c) => c.id);
    const order = ["gene1", "gene2", "status", "class", "eventInfo", "connectionType", "breakpointType"].map((id) => ids.indexOf(id));
    assert.ok(order.every((i) => i >= 0), "all present");
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test("PAT-SV-3 SV3: Status is the one SV column that is not sortable", async () => {
    const unsorted = (cols: { id: string; unsorted?: boolean }[]) => cols.filter((c) => c.unsorted).map((c) => c.id);
    assert.deepEqual(unsorted(ALTERATION_COLUMNS.sv), ["status"]);
    const a = alt(await run({ patient: P1 }, one()));
    const cols = a.tables.sv!.columns as { id: string; unsorted?: boolean }[];
    assert.equal(cols.find((c) => c.id === "status")!.unsorted, true);
    assert.deepEqual(unsorted(cols), ["status"]);
  });

  test("PAT-SV-3 SV4: sorting SV by status is refused", async () => {
    const v = await run({ patient: P1, sv: { sort: { column: "status" } } } as never, one());
    assert.match(v.error!, /status is not sortable/);
  });
});

describe("allele frequency and per-sample reads", () => {
  const cell = async (mut: Row[], id: string) => {
    const t = alt(await run({ mutations: { columns: ["gene", "vaf"] } }, one(study({ mut })))).tables.mutations!;
    return { t, v: t.rows[0].values[t.columns.map((c) => c.id).indexOf(id)] };
  };
  test("V1 PAT-MT-3: the vaf cell is the source's value, not rounded again (the SQL rounds it once, to 4 places, for cell, filter and search alike)", async () => {
    assert.equal((await cell([{ ...MUT[0], vaf: 0.1754 }], "vaf")).v, 0.1754);
    assert.equal((await cell([{ ...MUT[0], vaf: 0.006 }], "vaf")).v, 0.006);
  });
  test("D1 PAT-MT-3: a row's reads become detail.reads in sample order", async () => {
    const { t } = await cell([{ ...MUT[0], reads: [["S1", 38, 157], ["S2", 190, 90]] }], "gene");
    assert.deepEqual(t.rows[0].detail?.reads, [{ sample: "S1", alt: 38, ref: 157 }, { sample: "S2", alt: 190, ref: 90 }]);
  });
  test("D2 PAT-MT-3: a row with no reads has no reads in its detail", async () => {
    const { t } = await cell(MUT, "gene");
    assert.equal(t.rows[0].detail?.reads, undefined);
  });
  test("D3 PAT-STM-2: a row's Cohort counts become detail.cohort, the keyword only when it has one (coadread APC 387, 376 of 534)", async () => {
    const { t } = await cell([{ ...MUT[0], cohortN: "387", cohortKwN: "376", cohortOf: "534", keyword: "APC truncating" }], "gene");
    assert.deepEqual(t.rows[0].detail?.cohort, { n: 387, of: 534, keyword: "APC truncating", keywordN: 376 });
    const bare = await cell([{ ...MUT[0], cohortN: 3, cohortKwN: 0, cohortOf: 534, keyword: "" }], "gene");
    assert.deepEqual(bare.t.rows[0].detail?.cohort, { n: 3, of: 534 });
    assert.equal((await cell(MUT, "gene")).t.rows[0].detail?.cohort, undefined, "no counts read, none carried");
  });
});

describe("not-profiled samples (PAT-GP-2)", () => {
  /** the mutations table's SQL as the run asks it, with the result */
  const asked = async (view: Partial<AlterationsView>, mut: Row[] = MUT) => {
    let sql = "";
    const base = study({ mut });
    const t: Tables = (table, src) => { if (table === "alterations:mutations") sql = src.with; return base(table, src); };
    const m = alt(await run(view, one(t))).tables.mutations!;
    return { sql, m };
  };
  test("with several samples in view, each row's panel coverage is worked out and its uncovered samples ride in its detail", async () => {
    const { sql, m } = await asked({}, [{ ...MUT[0], notProfiled: ["S1b"] }]);
    assert.match(sql, /miss AS \(SELECT gene, length\(np\) AS n, np FROM/);
    assert.deepEqual(m.rows[0].detail?.notProfiled, ["S1b"]);
  });
  test("one sample in view: no coverage asked, nothing in the detail", async () => {
    const { sql, m } = await asked({ samples: "cohort" }, [{ ...MUT[0], notProfiled: [] }]);
    assert.doesNotMatch(sql, /miss AS/);
    assert.equal(m.rows[0].detail?.notProfiled, undefined);
  });
});

describe("vafSort", () => {
  test("S1 PAT-STM-1: samples' VAFs compared one by one in sample order, null last either way", () => {
    assert.equal(vafSort(2)("DESC"), "isNull(vafs[1]) ASC, vafs[1] DESC, isNull(vafs[2]) ASC, vafs[2] DESC");
    assert.equal(vafSort(2)("ASC"), "isNull(vafs[1]) ASC, vafs[1] ASC, isNull(vafs[2]) ASC, vafs[2] ASC");
  });
  test("S2 PAT-STM-1: no samples listed sorts by vaf, null last", () => {
    assert.equal(vafSort(0)("DESC"), "vaf DESC NULLS LAST");
    assert.equal(vafSort(0)("ASC"), "vaf ASC NULLS LAST");
  });
});

describe("PAT-MT-6: the gene filter (legacy GeneFilterMenu, PAT-STM-15)", () => {
  const withMixed = (mut: number, cna: number): Tables => (table, src) => {
    if (table === "alterations:mixed-mutations") return Array.from({ length: mut }, () => ({ cohort: "A", study: "s1" }));
    if (table === "alterations:mixed-cna") return Array.from({ length: cna }, () => ({ cohort: "A", study: "s1" }));
    return study()(table, src);
  };

  test("PAT-MT-6 GF1: genesProfiled other than any or all is refused, naming genesProfiled", async () => {
    const v = await run({ genesProfiled: "some" } as never, one());
    assert.match(v.error!, /genesProfiled/);
  });

  test("PAT-MT-6 GF2: genesProfiled all and any are not refused (local patient)", async () => {
    for (const genesProfiled of ["all", "any"] as const) {
      const v = await run({ genesProfiled }, one());
      assert.equal(v.error, undefined, genesProfiled + ": " + String(v.error));
    }
  });

  test("PAT-MT-6 GF3: the inAll column is numeric, offered by mutations and cna, and not a default", () => {
    for (const t of ["mutations", "cna"] as const) {
      const c = ALTERATION_COLUMNS[t].find((x) => x.id === "inAll");
      assert.ok(c, t + " has inAll");
      assert.equal(c!.numeric, true);
      assert.equal(c!.name, "Profiled in all samples");
      assert.ok(!ALTERATION_DEFAULT_COLUMNS[t].includes("inAll"), t + " does not show inAll by default");
    }
  });

  test("PAT-MT-6 GF4: with 2 samples in view, mixedPanels is read from the mixed-mutations and mixed-cna counts", async () => {
    const v = await run({}, one(withMixed(2, 0)));
    assert.equal(v.error, undefined, String(v.error));
    assert.deepEqual(alt(v).mixedPanels, { mutations: true, cna: false });
  });

  test("PAT-MT-6 GF4b: with 1 sample in view, no mixed panel and the mixed counts are never asked", async () => {
    const t = withMixed(2, 2);
    const p = local("db1", (table, src) => table === "alterations:samples" ? [P1_SAMPLES[0]] : t(table, src));
    const v = await run({}, ctx({ A: cohort({ s1: 2 }) }, { s1: p }));
    assert.equal(v.error, undefined, String(v.error));
    assert.deepEqual(alt(v).mixedPanels, { mutations: false, cna: false });
    assert.ok(!p.asked.some((l) => l === "alterations:mixed-mutations" || l === "alterations:mixed-cna"), p.asked.join());
  });

  test("PAT-MT-6 GF5: coverage is computed and kept on by cover (text smoke test)", () => {
    const part = { cohort: "A", study: "s1", cohortSql: "SELECT 1" };
    const w = (cover: { genes: "any" | "all"; inAll: boolean }) => alterationSource("mutations", part, "P1", "db", null, [], "patient", cover).with;
    const all = w({ genes: "all", inAll: false });
    assert.ok(all.includes("inAll = 1") && all.includes("miss AS"));
    const any = w({ genes: "any", inAll: false });
    assert.ok(!any.includes("inAll = 1") && !any.includes("miss AS"));
    const shown = w({ genes: "any", inAll: true });
    assert.ok(shown.includes("miss AS") && !shown.includes("inAll = 1"));
  });

  test("PAT-MT-6 GF6: genesProfiled all is refused for a peer's patient, naming federation; any is not", async () => {
    const c = () => ctx({ A: cohort({ p: 2 }) }, { p: peer(study()) });
    const v = await run({ genesProfiled: "all" }, c());
    assert.match(v.error!, /genesProfiled/);
    assert.match(v.error!, /federation/);
    const ok = await run({ genesProfiled: "any" }, c());
    assert.equal(ok.error, undefined, String(ok.error));
  });

  test("PAT-MT-6 GF7: genesProfiled all says so in the caveat", async () => {
    const v = await run({ genesProfiled: "all" }, one());
    assert.equal(v.error, undefined, String(v.error));
    assert.match(v.caveat!, /genes profiled in every sample in view/);
  });
});

describe("PAT-NP-1 / PAT-CNA-2 / PAT-SV-2: which samples a study profiled", () => {
  // each flag: 1 the sample is in the study's profile for that table, 0 it is not, -1 the study has no such profile
  const flags = (sid: string, mutations: number, cna: number, sv: number): Row => ({ sid, mutations, cna, sv });

  test("NP1: a table the study has no profile for is study:false with nobody profiled; the others list their profiled samples", async () => {
    const t = study({ profiled: [flags("S1", 1, -1, 1), flags("S2", 1, -1, 0)] });
    const a = alt(await run({}, one(t)));
    assert.deepEqual(a.profiling, {
      mutations: { study: true, profiled: ["S1", "S2"] },
      cna: { study: false, profiled: [] },
      sv: { study: true, profiled: ["S1"] },
    });
  });

  test("NP2: every flag 1 profiles both samples in every table", async () => {
    const t = study({ profiled: [flags("S1", 1, 1, 1), flags("S2", 1, 1, 1)] });
    const a = alt(await run({}, one(t)));
    const all = { study: true, profiled: ["S1", "S2"] };
    assert.deepEqual(a.profiling, { mutations: all, cna: all, sv: all });
  });

  // NP3 skipped: the harness's peer resolver serves only alterations tables through patientRows and has no
  // "alterations:profiled" mode, so there is no peer behaviour here to assert.
});
