// The Mutations view's default-column facts taken from the counts' summaries, and the order of its
// queries (lib/views/mutations/run.ts runMutations, lib/views/mutation-defaults.ts). The rules for
// the defaults themselves are test/mutation-default-columns.test.ts's (R4: Allele Freq (T) is kept
// when some row has a non-zero frequency; R5: Cancer Type Detailed when more than one distinct
// non-empty type); here, where the facts come from and when each query is asked:
//   M1  no search, first page, no values: the facts come from the counts' summaries; rowsValues is
//       not called; rowsCounts is asked with summarize = MUTATION_FACT_COLUMNS; R4/R5's rules hold
//       (a truncated cancer-type list keeps the column; types union across databases)
//   M2  no search, counts without `sums` (an older backend): the facts fall back to rowsValues for vaf
//       and cancerType, with an empty query, giving the same defaults
//   M3  with a search: the facts' values are asked first (empty query); the page and counts get the
//       facts' defaults
//   M4  the clinical Freq is asked before the rows' counts answer
//   M5  a later page or a column's values: no Freq; in values mode without a search the facts are
//       asked as values queries and the defaults still follow them
//   M6  a failing Freq refuses the view with its message; a failing count refuses the view
// The stand-in harness is test/mutation-default-columns.test.ts's, extended.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { runMutations } from "../lib/views/mutations/run.ts";
import * as mutationDefaultsModule from "../lib/views/mutation-defaults.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { TableQuery } from "../lib/table-query.ts";

process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

const ALL = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "copyNumber", "vaf", "mutCount"];
const without = (...ids: string[]) => ALL.filter((id) => !ids.includes(id));
const FACT_COLUMNS = [{ column: "vaf", numeric: true }, { column: "cancerType", numeric: false }];

const DISCRETE_CNA: ProfileInfo = { profile: "gistic", type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", name: "Putative copy-number alterations from GISTIC", order: 0 };
const MUTATIONS: ProfileInfo = { profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "Mutations", order: 4 };
const CAT = [MUTATIONS, DISCRETE_CNA];

type Summary =
  | { column: string; numeric: true; min: number | null; max: number | null }
  | { column: string; numeric: false; values: string[]; truncated: boolean };
/** what rowsValues answers per column: numeric "vaf" as [{lo, hi, n}], text "cancerType" as [{v, n}] */
type Answers = { vaf?: Record<string, unknown>[]; cancerType?: Record<string, unknown>[] };
const VAF_SOME = [{ lo: 0.003, hi: 0.31, n: 4 }];
const VAF_NONE: Record<string, unknown>[] = [];
const TWO_TYPES = [{ v: "Colon Adenocarcinoma", n: 3 }, { v: "Rectal Adenocarcinoma", n: 2 }];
const ONE_TYPE = [{ v: "Colon Adenocarcinoma", n: 5 }];

/** the counts' summaries that say what `answers` say */
function sumsOf(a: Answers, truncated = false): Summary[] {
  const v = (a.vaf ?? []).filter((r) => Number(r.n) > 0);
  return [
    { column: "vaf", numeric: true, min: v.length ? Math.min(...v.map((r) => Number(r.lo))) : null, max: v.length ? Math.max(...v.map((r) => Number(r.hi))) : null },
    { column: "cancerType", numeric: false, values: (a.cancerType ?? []).map((r) => String(r.v)), truncated },
  ];
}

type Call = { label: string; q: TableQuery; defaults: string[]; column?: string; summarize?: unknown };
type Calls = { values: Call[]; page: Call[]; counts: Call[]; freq: string[]; events: string[] };
const newCalls = (): Calls => ({ values: [], page: [], counts: [], freq: [], events: [] });

type StudySetup = {
  catalog?: ProfileInfo[]; answers: Answers; conn?: string; rows?: Record<string, unknown>[];
  /** the counts' sums for this study: given, or none (an older backend's count) */
  sums?: Summary[];
  /** the count waits on this before answering */
  countsWait?: () => Promise<unknown>;
  countsFails?: Error; freqFails?: Error;
};

function standIn(cohort: string, study: string, s: StudySetup, calls: Calls, sameDb: [string, StudySetup][] = [[study, s]]) {
  const conn = s.conn ?? "c1";
  const rows = s.rows ?? [{ sid: study + "-S1", vaf: 0.3, vafText: "0.30" }];
  return {
    instance: { id: conn, mode: "patient-level", label: "Local " + conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    viewMeta: async () => [],
    viewAggregate: async (label: string) => {
      calls.events.push("aggregate:" + label);
      if (label === "mutations:clinical-freq") {
        calls.freq.push(study);
        if (s.freqFails) throw s.freqFails;
        return [{ a: "", n: 10 }];
      }
      return [];
    },
    lollipopCounts: async () => ({ changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }),
    rowsPage: async (label: string, _src: unknown, q: TableQuery, defaults: string[]) => {
      calls.events.push("page");
      calls.page.push({ label, q, defaults });
      return { rows: rows.map((r) => ({ cohort, study, patient: String(r.sid), ...r })), total: rows.length };
    },
    rowsCounts: async (label: string, _src: unknown, q: TableQuery, defaults: string[], summarize?: unknown) => {
      calls.events.push("counts-asked");
      calls.counts.push({ label, q, defaults, summarize });
      if (s.countsWait) await s.countsWait();
      if (s.countsFails) throw s.countsFails;
      calls.events.push("counts-done");
      const asked = Array.isArray(summarize) && summarize.length > 0;
      // one count per database: it answers for every study held there, as a real one does
      return sameDb.map(([st, x]) => {
        const n = (x.rows ?? [1]).length;
        return { cohort, study: st, n, all: n, ...(asked && x.sums ? { sums: x.sums } : {}) };
      });
    },
    rowsValues: async (label: string, _src: unknown, q: TableQuery, defaults: string[], column: string) => {
      calls.events.push("values:" + column);
      calls.values.push({ label, q, defaults, column });
      return column === "vaf" ? s.answers.vaf ?? [] : column === "cancerType" ? s.answers.cancerType ?? [] : [{ v: "G12D", n: 1 }];
    },
    rowsRank: async () => null,
  };
}

function ctxFor(studies: Record<string, StudySetup>, calls: Calls, extra: Partial<ViewRun> = {}): ViewRun {
  const ids = Object.keys(studies);
  const cohort: EvaluatedCohort = { studies: ids, perStudy: Object.fromEntries(ids.map((s) => [s, { sql: "", count: 10, samples: 10, mode: "" }])), count: 10 * ids.length, samples: 10 * ids.length, text: "" };
  return {
    doc: { study: ids[0], cohorts: { Q: { study: ids[0] } }, views: [] } as never,
    cohorts: { Q: cohort },
    resolvers: Object.fromEntries(ids.map((s) => [s, standIn("Q", s, studies[s], calls, ids.filter((o) => (studies[o].conn ?? "c1") === (studies[s].conn ?? "c1")).map((o) => [o, studies[o]]))])) as never,
    vNames: ["Q"], vStudies: ids,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7",
    studyProfiles: async (study: string) => ({ profiles: ["mutations"], gaProfiles: [], ...(studies[study].catalog ? { catalog: studies[study].catalog } : {}) }),
    ...extra,
  };
}

type Mutations = { shown: string[]; defaults: string[]; rows: { sample: string; values: (string | number | null)[] }[] };
async function attempt(studies: Record<string, StudySetup>, view: Partial<MutationsView> = {}, calls = newCalls(), extra: Partial<ViewRun> = {}) {
  try {
    const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100, ...view } as MutationsView, ctxFor(studies, calls, extra));
    const res = (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: Mutations; error?: string };
    return { res, error: res.error, calls };
  } catch (e) {
    return { res: undefined, error: String((e as Error)?.message ?? e), calls };
  }
}
async function run(studies: Record<string, StudySetup>, view: Partial<MutationsView> = {}, calls = newCalls(), extra: Partial<ViewRun> = {}) {
  const { res, error } = await attempt(studies, view, calls, extra);
  assert.equal(error, undefined, JSON.stringify(res ?? error).slice(0, 300));
  return { res: res!, m: res!.mutations!, calls };
}
/** a study whose counts carry the summaries of `answers`, and whose values queries would say the same */
const viaSums = (answers: Answers, more: Partial<StudySetup> = {}): StudySetup => ({ catalog: CAT, answers, sums: sumsOf(answers), ...more });
const factsAskedAsValues = (calls: Calls) => calls.values.filter((c) => c.column === "vaf" || c.column === "cancerType");

// ---- M1: the facts from the counts' summaries ------------------------------------------------------

test("M1 MUTATION_FACT_COLUMNS is vaf (numeric) and cancerType (text)", () => {
  assert.deepEqual((mutationDefaultsModule as Record<string, unknown>).MUTATION_FACT_COLUMNS, FACT_COLUMNS);
});

test("M1 no search, first page: the counts are asked with the fact columns, and no values query runs", async () => {
  const calls = newCalls();
  const { m } = await run({ s1: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }) }, {}, calls);
  assert.equal(calls.values.length, 0, "rowsValues called: " + JSON.stringify(calls.values.map((c) => c.column)));
  assert.ok(calls.counts.length >= 1);
  assert.ok(calls.counts.some((c) => JSON.stringify(c.summarize) === JSON.stringify(FACT_COLUMNS)), JSON.stringify(calls.counts.map((c) => c.summarize)));
  assert.deepEqual(m.defaults, ALL);
});

test("M1 filters and a sort but no search: still from the summaries", async () => {
  const calls = newCalls();
  const { m } = await run({ s1: viaSums({ vaf: VAF_NONE, cancerType: TWO_TYPES }) }, { filters: { cancerType: { values: ["Colon Adenocarcinoma"] } }, sort: { column: "proteinChange" } }, calls);
  assert.equal(factsAskedAsValues(calls).length, 0, JSON.stringify(calls.values.map((c) => c.column)));
  assert.deepEqual(m.defaults, without("vaf"));
});

test("M1 Allele Freq (T) from the summaries: max null or 0 drops it; 0.003 keeps it; one of two databases with one keeps it", async (t) => {
  const cases: [string, Record<string, StudySetup>, string[]][] = [
    ["no row has one (max null)", { s1: viaSums({ vaf: VAF_NONE, cancerType: TWO_TYPES }) }, without("vaf")],
    ["a frequency of 0 is no frequency", { s1: viaSums({ vaf: [{ lo: 0, hi: 0, n: 3 }], cancerType: TWO_TYPES }) }, without("vaf")],
    ["max 0.003", { s1: viaSums({ vaf: [{ lo: 0.003, hi: 0.003, n: 1 }], cancerType: TWO_TYPES }) }, ALL],
    ["one of two databases has one", { s1: viaSums({ vaf: VAF_NONE, cancerType: TWO_TYPES }), s2: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }, { conn: "c2" }) }, ALL],
  ];
  for (const [name, studies, want] of cases) {
    await t.test(name, async () => {
      const calls = newCalls();
      const { m } = await run(studies, {}, calls);
      assert.equal(calls.values.length, 0, "no values query");
      assert.deepEqual(m.defaults, want);
    });
  }
});

test("M1 Cancer Type Detailed from the summaries: '' is not a type; two keep it; a truncated list keeps it; types union across databases", async (t) => {
  const cases: [string, Record<string, StudySetup>, string[]][] = [
    ['["", "Colon Adenocarcinoma"]: one type', { s1: viaSums({ vaf: VAF_SOME, cancerType: [{ v: "", n: 4 }, { v: "Colon Adenocarcinoma", n: 2 }] }) }, without("cancerType")],
    ["one type only", { s1: viaSums({ vaf: VAF_SOME, cancerType: ONE_TYPE }) }, without("cancerType")],
    ["no types", { s1: viaSums({ vaf: VAF_SOME, cancerType: [] }) }, without("cancerType")],
    ["two types", { s1: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }) }, ALL],
    ["a truncated list", { s1: { catalog: CAT, answers: {}, sums: sumsOf({ vaf: VAF_SOME, cancerType: ONE_TYPE }, true) } }, ALL],
    ["one type in each of two databases, different", { s1: viaSums({ vaf: VAF_SOME, cancerType: [{ v: "Colon Adenocarcinoma", n: 1 }] }),
      s2: viaSums({ vaf: VAF_SOME, cancerType: [{ v: "Rectal Adenocarcinoma", n: 1 }] }, { conn: "c2" }) }, ALL],
    ["the same one type in each of two databases", { s1: viaSums({ vaf: VAF_SOME, cancerType: ONE_TYPE }), s2: viaSums({ vaf: VAF_SOME, cancerType: ONE_TYPE }, { conn: "c2" }) }, without("cancerType")],
    ["two studies in one database, one type each, different", { s1: viaSums({ vaf: VAF_SOME, cancerType: [{ v: "Colon Adenocarcinoma", n: 1 }] }),
      s2: viaSums({ vaf: VAF_SOME, cancerType: [{ v: "Rectal Adenocarcinoma", n: 1 }] }) }, ALL],
  ];
  for (const [name, studies, want] of cases) {
    await t.test(name, async () => {
      const calls = newCalls();
      const { m } = await run(studies, {}, calls);
      assert.equal(calls.values.length, 0, "no values query");
      assert.deepEqual(m.defaults, want);
    });
  }
});

test("M1 the page and counts receive the summaries' defaults, shown follows them", async () => {
  const calls = newCalls();
  const { m } = await run({ s1: viaSums({ vaf: VAF_NONE, cancerType: ONE_TYPE }) }, {}, calls);
  assert.deepEqual(m.defaults, without("vaf", "cancerType"));
  assert.deepEqual(m.shown, without("vaf", "cancerType"));
});

// ---- M2: counts without sums -------------------------------------------------------------------

test("M2 no search, counts without sums: the facts are asked as values queries with an empty query, same defaults", async (t) => {
  const cases: [string, Answers, string[]][] = [
    ["no frequency, two types", { vaf: VAF_NONE, cancerType: TWO_TYPES }, without("vaf")],
    ["a frequency, one type", { vaf: VAF_SOME, cancerType: ONE_TYPE }, without("cancerType")],
    ["both", { vaf: VAF_SOME, cancerType: TWO_TYPES }, ALL],
  ];
  for (const [name, answers, want] of cases) {
    await t.test(name, async () => {
      const calls = newCalls();
      const { m } = await run({ s1: { catalog: CAT, answers } }, { filters: { mutationType: { values: ["Missense_Mutation"] } } }, calls);
      assert.deepEqual(m.defaults, want);
      for (const col of ["vaf", "cancerType"]) {
        const asked = calls.values.filter((c) => c.column === col);
        assert.ok(asked.length >= 1, col + " asked: " + JSON.stringify(calls.values.map((c) => c.column)));
        for (const c of asked) {
          assert.ok(!(c.q.search || "").trim(), col + " with a search");
          assert.deepEqual(Object.keys(c.q.filters || {}), [], col + " with filters");
        }
      }
    });
  }
});

test("M2 one database's counts carry sums and another's do not: the facts still reach every database", async () => {
  const calls = newCalls();
  const { m } = await run({ s1: viaSums({ vaf: VAF_NONE, cancerType: ONE_TYPE }), s2: { catalog: CAT, answers: { vaf: VAF_SOME, cancerType: [{ v: "Rectal Adenocarcinoma", n: 1 }] }, conn: "c2" } }, {}, calls);
  assert.deepEqual(m.defaults, ALL, "s2's frequency and second type count");
});

// ---- M3: with a search -----------------------------------------------------------------------------

test("M3 with a search: the facts' values are asked first, with an empty query; page and counts get their defaults", async () => {
  const calls = newCalls();
  await run({ s1: viaSums({ vaf: VAF_NONE, cancerType: TWO_TYPES }) }, { search: "G12" }, calls);
  const firstFact = calls.events.findIndex((e) => e === "values:vaf" || e === "values:cancerType");
  const firstRows = calls.events.findIndex((e) => e === "page" || e === "counts-asked");
  assert.ok(firstFact >= 0, "the facts are asked as values: " + calls.events.join(", "));
  assert.ok(firstRows > firstFact, "before the page and counts: " + calls.events.join(", "));
  for (const c of factsAskedAsValues(calls)) assert.ok(!(c.q.search || "").trim(), "the facts' query has no search: " + JSON.stringify(c.q));
  assert.ok(calls.page.length >= 1 && calls.counts.length >= 1);
  for (const c of [...calls.page, ...calls.counts]) assert.deepEqual(c.defaults, without("vaf"), c.label);
  assert.ok(calls.page.every((c) => c.q.search === "G12"), "the page keeps the search");
});

// ---- M4: the clinical Freq beside the rows ---------------------------------------------------------

test("M4 the clinical Freq is asked before the rows' counts answer", async () => {
  const calls = newCalls();
  let freqBefore = false;
  const waitForFreq = async () => {
    for (let i = 0; i < 150 && !calls.freq.length; i++) await new Promise((r) => setTimeout(r, 10));
    freqBefore = calls.freq.length > 0;
  };
  const t0 = Date.now();
  await run({ s1: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }, { countsWait: waitForFreq }) }, {}, calls);
  assert.ok(calls.freq.length >= 1, "the Freq was asked: " + calls.events.join(", "));
  assert.ok(freqBefore, "the Freq was asked while the counts were still waiting: " + calls.events.join(", "));
  assert.ok(Date.now() - t0 < 1400, "no wait for the timeout");
});

// ---- M5: later pages and values mode ---------------------------------------------------------------

test("M5 a later page: no clinical Freq", async () => {
  const calls = newCalls();
  await run({ s1: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }) }, {}, calls, { page: { offset: 100, limit: 100 } });
  assert.deepEqual(calls.freq, []);
});

test("M5 a column's values without a search: no Freq; the facts are asked as values queries and the result's defaults follow them", async () => {
  const calls = newCalls();
  const { res, error } = await attempt({ s1: viaSums({ vaf: VAF_NONE, cancerType: TWO_TYPES }) }, {}, calls, { values: "proteinChange" });
  assert.equal(error, undefined);
  assert.deepEqual(calls.freq, []);
  for (const col of ["vaf", "cancerType"]) assert.ok(calls.values.some((c) => c.column === col && !(c.q.search || "").trim()), col + " asked: " + calls.events.join(", "));
  assert.ok(calls.values.some((c) => c.column === "proteinChange"), "the column's values were asked: " + calls.events.join(", "));
  const m = res?.mutations as (Mutations & { defaults?: string[] }) | undefined;
  if (m?.defaults) assert.deepEqual(m.defaults, without("vaf"), "the result's defaults");
});

test("M5 a column's values with a search: the facts are asked first, and the column's values query gets their defaults", async () => {
  const calls = newCalls();
  const { error } = await attempt({ s1: viaSums({ vaf: VAF_NONE, cancerType: TWO_TYPES }) }, { search: "G12" }, calls, { values: "proteinChange" });
  assert.equal(error, undefined);
  assert.deepEqual(calls.freq, []);
  const firstFact = calls.events.findIndex((e) => e === "values:vaf" || e === "values:cancerType");
  const col = calls.events.indexOf("values:proteinChange");
  assert.ok(firstFact >= 0 && col > firstFact, calls.events.join(", "));
  for (const c of calls.values.filter((x) => x.column === "proteinChange")) {
    assert.equal(c.q.search, "G12");
    assert.deepEqual(c.defaults, without("vaf"));
  }
});

// ---- M6: failures ----------------------------------------------------------------------------------

test("M6 a failing Freq refuses the view with its message", async () => {
  const { error } = await attempt({ s1: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }, { freqFails: new Error("freq broke here") }) });
  assert.ok(error && error.includes("freq broke here"), "refused with the Freq's message: " + error);
});

test("M6 a failing count refuses the view", async () => {
  const { error } = await attempt({ s1: viaSums({ vaf: VAF_SOME, cancerType: TWO_TYPES }, { countsFails: new Error("counts broke here") }) });
  assert.ok(error, "the view is refused");
  assert.ok(error.includes("counts broke here"), error);
});
