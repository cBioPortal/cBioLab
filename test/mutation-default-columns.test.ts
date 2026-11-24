// MUT-COL-5 / MUT-COL-18 / MUT-COL-27 (docs/legacy-spec/05-mutations.md): the Mutations table's
// data-dependent default columns, and MUT-STM-5's empty Allele Freq (T) cell. The portal
// (cbioportal-frontend cd8c6df) shows Copy # when some queried study has a COPY_NUMBER_ALTERATION
// profile of datatype DISCRETE (RVPS studyToMolecularProfileDiscreteCna, DiscreteCNACache.isActive),
// Allele Freq (T) when some row of the gene has a non-zero frequency (TumorAlleleFreqColumnFormatter
// .isVisible), and Cancer Type Detailed when the gene's rows hold more than one distinct non-empty
// tumour type (CancerTypeColumnFormatter.isVisible); both row rules read every row of the gene,
// never the search or filters (ResultsViewMutationTable reads dataStore.allData).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS, mutationDefaultColumns } from "../lib/mutation-table.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { Untimed, type ViewRun, type EvaluatedCohort } from "../lib/views/run.ts";
import type { AnalysisDoc, AnalysisResult, ViewParticipation, ViewResult } from "../lib/types.ts";
import type { MutationsView } from "../lib/views/mutations/types.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import type { TableQuery } from "../lib/table-query.ts";
import { renderViewCards } from "./support/render-views.ts";
import { vafEmptyTip } from "../lib/mutation-cell-text.ts";
import { mutationDefaults } from "../lib/views/mutation-defaults.ts";

process.env.GENOME_NEXUS_PIN = "gn-hg19";
process.env.GENOME_NEXUS_GRCH38_PIN = "gn-hg38";

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; });

const ALL = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "copyNumber", "vaf", "mutCount"];
const without = (...ids: string[]) => ALL.filter((id) => !ids.includes(id));

// ---- D: mutationDefaultColumns ------------------------------------------------------------------

test("D1 no facts: all eight defaults, in order", () => {
  assert.deepEqual(MUTATION_DEFAULT_COLUMNS, ALL);
  assert.deepEqual(mutationDefaultColumns({}), ALL);
});

test("D2 discreteCna false drops Copy #; true keeps it", () => {
  assert.deepEqual(mutationDefaultColumns({ discreteCna: false }), without("copyNumber"));
  assert.deepEqual(mutationDefaultColumns({ discreteCna: true }), ALL);
});

test("D3 nonZeroVaf false drops Allele Freq (T); true keeps it", () => {
  assert.deepEqual(mutationDefaultColumns({ nonZeroVaf: false }), without("vaf"));
  assert.deepEqual(mutationDefaultColumns({ nonZeroVaf: true }), ALL);
});

test("D4 cancerTypes 0 or 1 drops Cancer Type Detailed; 2 or more keeps it", () => {
  assert.deepEqual(mutationDefaultColumns({ cancerTypes: 0 }), without("cancerType"));
  assert.deepEqual(mutationDefaultColumns({ cancerTypes: 1 }), without("cancerType"));
  assert.deepEqual(mutationDefaultColumns({ cancerTypes: 2 }), ALL);
  assert.deepEqual(mutationDefaultColumns({ cancerTypes: 3 }), ALL);
});

test("D5 all three facts against: the other five, in order", () => {
  assert.deepEqual(mutationDefaultColumns({ discreteCna: false, nonZeroVaf: false, cancerTypes: 0 }),
    ["sample", "proteinChange", "annotation", "mutationType", "mutCount"]);
  assert.deepEqual(mutationDefaultColumns({ discreteCna: false, nonZeroVaf: false, cancerTypes: 1 }),
    ["sample", "proteinChange", "annotation", "mutationType", "mutCount"]);
});

// ---- R: runMutations over stand-in resolvers ----------------------------------------------------

const DISCRETE_CNA: ProfileInfo = { profile: "gistic", type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", name: "Putative copy-number alterations from GISTIC", order: 0 };
const CONTINUOUS_CNA: ProfileInfo = { profile: "linear_CNA", type: "COPY_NUMBER_ALTERATION", datatype: "CONTINUOUS", name: "Capped relative linear copy-number values", order: 1 };
const LOG2_CNA: ProfileInfo = { profile: "log2CNA", type: "COPY_NUMBER_ALTERATION", datatype: "LOG2-VALUE", name: "Log2 copy-number values", order: 2 };
const DISCRETE_MRNA: ProfileInfo = { profile: "mrna_discrete", type: "MRNA_EXPRESSION", datatype: "DISCRETE", name: "mRNA, discrete", order: 3 };
const MUTATIONS: ProfileInfo = { profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "Mutations", order: 4 };

/** what rowsValues answers per column: numeric "vaf" as [{lo, hi, n}], text "cancerType" as [{v, n}] */
type Answers = { vaf?: Record<string, unknown>[]; cancerType?: Record<string, unknown>[] };
const VAF_SOME = [{ lo: 0.003, hi: 0.31, n: 4 }];
const VAF_NONE: Record<string, unknown>[] = [];
const TWO_TYPES = [{ v: "Colon Adenocarcinoma", n: 3 }, { v: "Rectal Adenocarcinoma", n: 2 }];
const ONE_TYPE = [{ v: "Colon Adenocarcinoma", n: 5 }];

type Call = { label: string; q: TableQuery; defaults: string[]; column?: string };
type Calls = { values: Call[]; page: Call[]; counts: Call[]; lollipop?: unknown[][] };

function standIn(cohort: string, study: string, answers: Answers, calls: Calls, conn = "c1", rows: Record<string, unknown>[] = [{ sid: study + "-S1", vaf: 0.3, vafText: "0.30" }]) {
  return {
    instance: { id: conn, mode: "patient-level", label: "Local " + conn, conn: { id: conn, db: conn } },
    cohortSql: () => "SELECT 1",
    lollipopCounts: async (...args: unknown[]) => { (calls.lollipop ??= []).push(args); return { changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }; },
    rowsPage: async (label: string, _src: unknown, q: TableQuery, defaults: string[]) => {
      calls.page.push({ label, q, defaults });
      return { rows: rows.map((r) => ({ cohort: cohort, study, patient: String(r.sid), ...r })), total: rows.length };
    },
    rowsCounts: async (label: string, _src: unknown, q: TableQuery, defaults: string[]) => {
      calls.counts.push({ label, q, defaults });
      return [{ cohort, study, n: rows.length, all: rows.length }];
    },
    rowsValues: async (label: string, _src: unknown, q: TableQuery, defaults: string[], column: string) => {
      calls.values.push({ label, q, defaults, column });
      return column === "vaf" ? answers.vaf ?? [] : column === "cancerType" ? answers.cancerType ?? [] : [];
    },
    rowsRank: async () => null,
  };
}

type StudySetup = { catalog?: ProfileInfo[]; unanswered?: true; answers: Answers; conn?: string; rows?: Record<string, unknown>[] };
function ctxFor(studies: Record<string, StudySetup>, calls: Calls): ViewRun {
  const ids = Object.keys(studies);
  const cohort: EvaluatedCohort = { studies: ids, perStudy: Object.fromEntries(ids.map((s) => [s, { sql: "", count: 10, samples: 10, mode: "" }])), count: 10 * ids.length, samples: 10 * ids.length, text: "" };
  return {
    doc: { study: ids[0], cohorts: { Q: { study: ids[0] } }, views: [] } as never,
    cohorts: { Q: cohort },
    resolvers: Object.fromEntries(ids.map((s) => [s, standIn("Q", s, studies[s].answers, calls, studies[s].conn, studies[s].rows)])) as never,
    vNames: ["Q"], vStudies: ids,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7",
    studyProfiles: async (study: string) => ({ profiles: ["mutations"], gaProfiles: [], ...(studies[study].catalog ? { catalog: studies[study].catalog } : {}), ...(studies[study].unanswered ? { unanswered: true as const } : {}) }),
  };
}

type Mutations = { shown: string[]; defaults: string[]; rows: { sample: string; values: (string | number | null)[] }[] };
const newCalls = (): Calls => ({ values: [], page: [], counts: [] });
async function run(studies: Record<string, StudySetup>, view: Partial<MutationsView> = {}, calls = newCalls()) {
  const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100, ...view } as MutationsView, ctxFor(studies, calls));
  const res = (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: Mutations; error?: string };
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  return { res, m: res.mutations!, calls };
}
const keep = { vaf: VAF_SOME, cancerType: TWO_TYPES };

test("R1 a study whose catalog has a COPY_NUMBER_ALTERATION / DISCRETE profile: Copy # in the defaults", async () => {
  const { m } = await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep } });
  assert.deepEqual(m.defaults, ALL);
  assert.deepEqual(m.shown, ALL, "a view naming no columns shows the defaults");
});

test("R2 no DISCRETE copy-number profile (CONTINUOUS, LOG2-VALUE, or a DISCRETE profile of another type): no Copy #", async (t) => {
  for (const [name, catalog] of [["CONTINUOUS only", [MUTATIONS, CONTINUOUS_CNA]], ["CONTINUOUS and LOG2-VALUE", [MUTATIONS, CONTINUOUS_CNA, LOG2_CNA]],
    ["a DISCRETE mRNA profile", [MUTATIONS, DISCRETE_MRNA]], ["mutations only", [MUTATIONS]]] as [string, ProfileInfo[]][]) {
    await t.test(name, async () => {
      const { m } = await run({ s1: { catalog, answers: keep } });
      assert.deepEqual(m.defaults, without("copyNumber"));
      assert.deepEqual(m.shown, without("copyNumber"));
    });
  }
});

test("R3 two queried studies, only one with a DISCRETE copy-number profile: Copy # kept", async (t) => {
  await t.test("the second study has it", async () => {
    const { m } = await run({ s1: { catalog: [MUTATIONS, CONTINUOUS_CNA], answers: keep }, s2: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep } });
    assert.ok(m.defaults.includes("copyNumber"), m.defaults.join(","));
  });
  await t.test("the first study has it, the two in separate databases", async () => {
    const { m } = await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep }, s2: { catalog: [MUTATIONS], answers: keep, conn: "c2" } });
    assert.ok(m.defaults.includes("copyNumber"), m.defaults.join(","));
  });
  await t.test("neither has it", async () => {
    const { m } = await run({ s1: { catalog: [MUTATIONS, CONTINUOUS_CNA], answers: keep }, s2: { catalog: [MUTATIONS], answers: keep, conn: "c2" } });
    assert.ok(!m.defaults.includes("copyNumber"), m.defaults.join(","));
  });
});

test("R4 Allele Freq (T): dropped when no row has a frequency (max null), kept for a max of 0.003", async (t) => {
  const cat = [MUTATIONS, DISCRETE_CNA];
  await t.test("no row has one", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_NONE, cancerType: TWO_TYPES } } });
    assert.deepEqual(m.defaults, without("vaf"));
  });
  await t.test("rows answer n 0", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: [{ lo: null, hi: null, n: 0 }], cancerType: TWO_TYPES } } });
    assert.deepEqual(m.defaults, without("vaf"));
  });
  await t.test("a frequency of 0 is no frequency (the portal's test is truthiness)", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: [{ lo: 0, hi: 0, n: 3 }], cancerType: TWO_TYPES } } });
    assert.deepEqual(m.defaults, without("vaf"));
  });
  await t.test("max 0.003", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: [{ lo: 0.003, hi: 0.003, n: 1 }], cancerType: TWO_TYPES } } });
    assert.deepEqual(m.defaults, ALL);
  });
  await t.test("one of two databases has one", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_NONE, cancerType: TWO_TYPES } }, s2: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: TWO_TYPES }, conn: "c2" } });
    assert.deepEqual(m.defaults, ALL);
  });
});

test("R5 Cancer Type Detailed: '' is not a type; two distinct types keep it", async (t) => {
  const cat = [MUTATIONS, DISCRETE_CNA];
  await t.test('["", "Colon Adenocarcinoma"]: one type', async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: [{ v: "", n: 4 }, { v: "Colon Adenocarcinoma", n: 2 }] } } });
    assert.deepEqual(m.defaults, without("cancerType"));
  });
  await t.test("one type only", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: ONE_TYPE } } });
    assert.deepEqual(m.defaults, without("cancerType"));
  });
  await t.test("no rows", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: [] } } });
    assert.deepEqual(m.defaults, without("cancerType"));
  });
  await t.test('["Colon Adenocarcinoma", "Rectal Adenocarcinoma"]: two types', async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: TWO_TYPES } } });
    assert.deepEqual(m.defaults, ALL);
  });
  await t.test("one type in each of two databases, different: two types", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: [{ v: "Colon Adenocarcinoma", n: 1 }] } },
      s2: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: [{ v: "Rectal Adenocarcinoma", n: 1 }] }, conn: "c2" } });
    assert.deepEqual(m.defaults, ALL);
  });
  await t.test("the same one type in each of two databases: one type", async () => {
    const { m } = await run({ s1: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: ONE_TYPE } },
      s2: { catalog: cat, answers: { vaf: VAF_SOME, cancerType: ONE_TYPE }, conn: "c2" } });
    assert.deepEqual(m.defaults, without("cancerType"));
  });
});

test("R6 a view naming its columns shows them, whatever the facts; the defaults still follow the facts", async () => {
  const { m } = await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: { vaf: VAF_NONE, cancerType: TWO_TYPES } } }, { columns: ["sample", "vaf"] });
  assert.deepEqual(m.shown, ["sample", "vaf"]);
  assert.deepEqual(m.defaults, without("vaf"));
});

test("R7 the facts' values queries are asked with an empty query, even when the view has a search and filters", async () => {
  const calls = newCalls();
  const view = { search: "G12", filters: { cancerType: { values: ["Colon Adenocarcinoma"] } }, sort: { column: "proteinChange" } };
  await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep } }, view, calls);
  const asked = (col: string) => calls.values.filter((c) => c.column === col);
  for (const col of ["vaf", "cancerType"]) {
    assert.ok(asked(col).length >= 1, "rowsValues asked for " + col + ": " + JSON.stringify(calls.values.map((c) => c.column)));
    for (const c of asked(col)) {
      assert.ok(!(c.q.search || "").trim(), col + " asked with a search: " + JSON.stringify(c.q));
      assert.deepEqual(Object.keys(c.q.filters || {}), [], col + " asked with filters: " + JSON.stringify(c.q));
    }
  }
  assert.ok(calls.page.length && calls.page.every((c) => c.q.search === "G12" && !!c.q.filters?.cancerType), "the page itself keeps the view's query: " + JSON.stringify(calls.page.map((c) => c.q)));
});

test("R8 with a search, the page and counts queries receive the facts' defaults", async () => {
  const calls = newCalls();
  await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: { vaf: VAF_NONE, cancerType: TWO_TYPES } } }, { search: "G12" }, calls);
  assert.ok(calls.page.length >= 1 && calls.counts.length >= 1, "rowsPage " + calls.page.length + ", rowsCounts " + calls.counts.length);
  for (const c of [...calls.page, ...calls.counts]) assert.deepEqual(c.defaults, without("vaf"), c.label);
  const none = newCalls();
  await run({ s1: { catalog: [MUTATIONS], answers: { vaf: VAF_NONE, cancerType: ONE_TYPE } } }, { search: "G12" }, none);
  assert.ok(none.page.length >= 1 && none.counts.length >= 1);
  for (const c of [...none.page, ...none.counts]) assert.deepEqual(c.defaults, ["sample", "proteinChange", "annotation", "mutationType", "mutCount"], c.label);
});

test("R8b without a search, the counts are asked with the fact columns and, when they answer them, no values query runs", async () => {
  const calls = newCalls();
  const st = standIn("Q", "s1", {}, calls);
  const counts = st.rowsCounts;
  const asked: unknown[] = [];
  const withSums = async (label: string, src: unknown, q: TableQuery, defaults: string[], summarize?: unknown) => {
    asked.push(summarize);
    const rows = await counts(label, src, q, defaults);
    return rows.map((r) => ({ ...r, sums: [{ column: "vaf", numeric: true, min: null, max: null }, { column: "cancerType", numeric: false, values: ["Colon Adenocarcinoma", "Rectal Adenocarcinoma"], truncated: false }] }));
  };
  const ctx = ctxFor({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep } }, calls);
  ctx.resolvers = { s1: { ...st, rowsCounts: withSums } } as never;
  const r = await runMutations({ kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100 } as MutationsView, ctx);
  const res = (r instanceof Untimed ? r.result : r) as ViewResult & { mutations?: Mutations; error?: string };
  assert.equal(res.error, undefined);
  assert.ok(asked.some((a) => JSON.stringify(a) === JSON.stringify([{ column: "vaf", numeric: true }, { column: "cancerType", numeric: false }])), JSON.stringify(asked));
  assert.equal(calls.values.length, 0, "rowsValues called: " + JSON.stringify(calls.values.map((c) => c.column)));
  assert.deepEqual(res.mutations!.defaults, without("vaf"), "the defaults follow the counts' summaries, not the values answers");
});

test("R9 a study whose peer did not describe its profiles (unanswered) leaves Copy # unknown, so kept; a mutations-only catalog drops it", async () => {
  const { m } = await run({ s1: { catalog: [], unanswered: true, answers: keep } });
  assert.ok(m.defaults.includes("copyNumber"), m.defaults.join(","));
  const { m: only } = await run({ s1: { catalog: [MUTATIONS], answers: keep } });
  assert.ok(!only.defaults.includes("copyNumber"), only.defaults.join(","));
});

test("R10 a mutations-only study and a local study with no profiles at all (an empty catalog that answered): no Copy #, as legacy", async () => {
  const { m } = await run({ s1: { catalog: [MUTATIONS], answers: keep }, s2: { catalog: [], answers: keep } });
  assert.ok(!m.defaults.includes("copyNumber"), m.defaults.join(","));
});

test("R11 a study with a discrete CNA profile settles Copy # whatever another study's peer answered", async () => {
  const { m } = await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep }, s2: { catalog: [], unanswered: true, answers: keep } });
  assert.ok(m.defaults.includes("copyNumber"), m.defaults.join(","));
  const { m: unknown } = await run({ s1: { catalog: [MUTATIONS], answers: keep }, s2: { catalog: [], unanswered: true, answers: keep } });
  assert.ok(unknown.defaults.includes("copyNumber"), "no discrete profile known, one study unanswered: kept as unknown");
});

// ---- H: the hotspots view narrowed by the table -------------------------------------------------

async function hot(table: Record<string, unknown>, catalog: ProfileInfo[] = [MUTATIONS, DISCRETE_CNA]) {
  const calls = newCalls();
  const r = await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"], table } as never,
    ctxFor({ s1: { catalog, answers: { vaf: VAF_NONE, cancerType: ONE_TYPE } } }, calls));
  const res = (r instanceof Untimed ? r.result : r) as ViewResult & { error?: string };
  assert.equal(res.error, undefined, JSON.stringify(res).slice(0, 300));
  assert.equal(calls.lollipop?.length, 1, "lollipopCounts asked once");
  return { rows: calls.lollipop![0][5] as { columns?: string[]; filters?: unknown }, calls };
}

test("H1 a table search with no columns: lollipopCounts gets the facts' defaults as columns", async () => {
  const { rows } = await hot({ gene: "KRAS", search: "G12" });
  assert.deepEqual(rows?.columns, ["sample", "proteinChange", "annotation", "mutationType", "copyNumber", "mutCount"]);
});

test("H2 a table naming its columns: lollipopCounts gets exactly those", async () => {
  const { rows } = await hot({ gene: "KRAS", search: "G12", columns: ["sample", "vaf"] });
  assert.deepEqual(rows?.columns, ["sample", "vaf"]);
});

test("H3 filters but no search: no defaults computed, no columns added", async () => {
  const { rows, calls } = await hot({ gene: "KRAS", filters: { mutationType: { values: ["Missense"] } } });
  assert.equal(calls.values.length, 0, "rowsValues called: " + JSON.stringify(calls.values.map((c) => c.column)));
  assert.equal(rows?.columns, undefined);
  assert.ok(rows?.filters, "the filters still reach the lollipop");
});

// ---- C: the Allele Freq (T) cell -----------------------------------------------------------------

test("C1 the mutations card: a row without a frequency has an empty Allele Freq (T) cell tipped 'Data not available.'; 0.31 is written", async () => {
  const rows = [
    { sid: "S-empty", vaf: null, vafText: "", altCount: null, refCount: 300, proteinChange: "G12C" },
    { sid: "S-null", vaf: null, vafText: "", altCount: null, refCount: 200, proteinChange: "G12D" },
    { sid: "S-value", vaf: 0.31, vafText: "0.31", altCount: 31, refCount: 69, proteinChange: "G12V" },
  ];
  const view = { kind: "mutations", gene: "KRAS", cohorts: ["Q"], rows: 100, columns: ["sample", "vaf"] } as MutationsView;
  const { res } = await run({ s1: { catalog: [MUTATIONS, DISCRETE_CNA], answers: keep, rows } }, view);
  const at = MUTATION_COLUMNS.findIndex((c) => c.id === "vaf");
  const m = res.mutations!;
  // the empty cell as the result may carry it: '' and null both
  const empty = m.rows.find((r) => r.sample === "S-empty")!;
  empty.values[at] = "";
  const nul = m.rows.find((r) => r.sample === "S-null")!;
  nul.values[at] = null;
  const doc = { study: "s1", cohorts: { Q: { study: "s1" } }, views: [view] } as unknown as AnalysisDoc;
  const result = { study: "s1", involvedStudies: ["s1"], oncokbPin: "v7", cohorts: { Q: { count: 10, samples: 10, text: "", studies: ["s1"] } },
    views: [res], stats: { ms: 0 } } as unknown as AnalysisResult;
  const html = renderViewCards(doc, result);
  const rowOf = (sample: string) => {
    const tr = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((x) => x[0]).find((x) => x.includes(sample));
    assert.ok(tr, "no table row for " + sample + " in " + html.slice(0, 2000));
    const cells = [...tr.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)].map((x) => x[0]);
    assert.ok(cells.length >= 2, "cells of " + sample + ": " + tr);
    return cells[cells.length - 1];
  };
  const text = (cell: string) => cell.replace(/<[^>]*>/g, "").trim();
  for (const s of ["S-empty", "S-null"]) {
    const cell = rowOf(s);
    assert.equal(text(cell), "", s + ": the cell has no text: " + cell);
    assert.match(cell, /data-tip="Data not available\."/, s + ": " + cell);
  }
  const cell = rowOf("S-value");
  assert.equal(text(cell), "0.31", cell);
  assert.doesNotMatch(cell, /Data not available/, cell);
});

test("C2 vafEmptyTip: the portal's NA tip for a cell with no frequency, none for one with", () => {
  for (const x of [null, undefined, ""]) assert.equal(vafEmptyTip(x), "Data not available.");
  for (const x of ["0.31", "0.0030", 0.5]) assert.equal(vafEmptyTip(x), null);
});

test("M1 mutationDefaults: no participant may list rows, so nothing is known and every default column is kept", async () => {
  const ctx = { vStudies: ["s1"], vNames: ["Q"], cohorts: { Q: { studies: ["s1"], perStudy: {} } }, resolvers: { s1: { instance: { id: "a", mode: "aggregate-only", label: "a", conn: { id: "a", db: "a" } } } } } as unknown as ViewRun;
  assert.deepEqual(await mutationDefaults(ctx, [], "KRAS", undefined, undefined), MUTATION_DEFAULT_COLUMNS);
});
