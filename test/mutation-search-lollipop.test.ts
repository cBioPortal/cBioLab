// The mutation table's search and column filters narrow the lollipop and its badges (MUT-TB-3,
// MUT-FM-1, MUT-FM-3, MUT-STM-4): the table's query reaches the lollipop view as its `table`
// (app/portal/results-layout.ts linkMutations: L), the hotspots view checks it (lib/views/hotspots/run.ts:
// V, narrowing only a patient-level study's counts), the federation API and the remote client never
// carry it (R), and the lollipop's SQL takes the table's row keys — (sid, change, type, rk) — for the
// named gene alone, its totals never (S, K). Row ids are the spec
// table's. What the narrowing gives on real rows is run against the fixture study by
// scripts/check-mutation-search-lollipop.ts (F).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE", "FEDERATION_DISCLOSE_PATIENTS", "FEDERATION_ACCEPT_PATIENT_LEVEL",
  "FEDERATION_HIDE_SQL", "AGGREGATE_ONLY_INSTANCES", "AGGREGATE_ONLY_STUDIES", "STUDY_DENY", "STUDY_ALLOW_RESTRICTED", "GENOME_NEXUS_PIN", "GENOME_NEXUS_GRCH38_PIN"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const fed = await import("../lib/federation.ts");
const { lollipopChangesSql, lollipopTypesSql, lollipopTotalsSql, PatientLevelResolver, AggregateResolver } = fed;
const mt = await import("../lib/mutation-table.ts");
const { resultsLayout, linkMutations } = await import("../app/portal/results-layout.ts");
const { answerFederation } = await import("../lib/federation-api.ts");
const { RemoteAggregateResolver } = await import("../lib/federation-remote.ts");
const { runHotspots } = await import("../lib/views/hotspots/run.ts");
const { Untimed } = await import("../lib/views/run.ts");
type View = import("../lib/types.ts").View;
type ViewResult = import("../lib/types.ts").ViewResult;
type ViewRun = import("../lib/views/run.ts").ViewRun;
type EvaluatedCohort = import("../lib/views/run.ts").EvaluatedCohort;
type ViewParticipation = import("../lib/types.ts").ViewParticipation;
type Rows = { gene: string; search?: string; filters?: Record<string, unknown>; columns?: string[] };
type Lollipop = (def: unknown, genes: string[], minCount?: number, oql?: unknown, rows?: Rows) => Promise<unknown>;

// a stand-in warehouse: every statement answers no rows (routing answers the one study, a size one patient)
setChTransport(async ({ query }) => {
  const data = /SELECT cancer_study_identifier AS id, name FROM fed_a\.cancer_study/.test(query) ? [{ id: "s1", name: "Study one" }]
    : /AS patients, uniqExact\(sid\) AS samples/.test(query) ? [{ patients: 1, samples: 1 }] : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });

/** a value with absent, null and empty-object fields dropped: an empty trailing option is no option */
const norm = (x: unknown): unknown => {
  const empty = (v: unknown) => v == null || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
  if (Array.isArray(x)) { const a = x.map(norm); while (a.length && empty(a[a.length - 1])) a.pop(); return a; }
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([, v]) => !empty(v)).map(([k, v]) => [k, norm(v)]));
  return x;
};

// ---------------------------------------------------------------- L: the table's query reaches the lollipop
const LP = { kind: "hotspots", genes: ["KRAS"], cohorts: ["Queried"] } as unknown as View;
const TB = { kind: "mutations", gene: "KRAS", cohorts: ["Queried"] } as unknown as View;
const tableOf = (vs: View[]) => (vs[0] as unknown as { table?: Rows }).table;
const tb = (extra: Record<string, unknown>) => ({ ...TB, ...extra }) as unknown as View;
const lp = (extra: Record<string, unknown>) => ({ ...LP, ...extra }) as unknown as View;

describe("L linking the table's search and filters to the lollipop", () => {
  test("L1 the table gets search \"G12D\": the lollipop's table = { gene: KRAS, search: \"G12D\" }", () => {
    const out = linkMutations([LP, tb({ search: "G12D" })], 1);
    assert.deepEqual(norm(tableOf(out)), { gene: "KRAS", search: "G12D" });
  });

  test("L1 table.gene is the table's gene", () => {
    const out = linkMutations([lp({ genes: ["TP53"] }), tb({ gene: "TP53", search: "R175H" })], 1);
    assert.deepEqual(norm(tableOf(out)), { gene: "TP53", search: "R175H" });
  });

  test("L2 the table's filters {mutationType, alteration, proteinPos}: table.filters holds mutationType only; alteration and proteinPos still become hide / codons", () => {
    const filters = { mutationType: { values: ["Missense"] }, alteration: { values: ["Missense · Driver"] }, proteinPos: { values: ["12"] } };
    const out = linkMutations([LP, tb({ filters })], 1);
    const r = tableOf(out);
    assert.ok(r, "the lollipop has a table");
    assert.equal(r!.gene, "KRAS");
    assert.deepEqual(r!.filters, { mutationType: { values: ["Missense"] } });
    // what today's link makes of the two, unchanged
    const today = linkMutations([LP, tb({ filters: { alteration: filters.alteration, proteinPos: filters.proteinPos } })], 1);
    const v = out[0] as unknown as { hide?: string[]; codons?: Record<string, number[]> };
    const t = today[0] as unknown as { hide?: string[]; codons?: Record<string, number[]> };
    assert.ok(v.hide && v.hide.length > 0, "the alteration filter still hides grid cells");
    assert.deepEqual(v.hide, t.hide);
    assert.deepEqual(v.codons, { KRAS: [12] });
  });

  test("L3 the table's columns set: table.columns is it", () => {
    const columns = ["sample", "proteinChange", "center"];
    const out = linkMutations([LP, tb({ search: "broad", columns })], 1);
    assert.deepEqual(tableOf(out)?.columns, columns);
    assert.equal(tableOf(out)?.search, "broad");
  });

  test("L4 search cleared and no other filter: table removed from the lollipop", () => {
    const had = lp({ table: { gene: "KRAS", search: "G12D" } });
    assert.equal(tableOf(linkMutations([had, TB], 1)), undefined);
    assert.equal(tableOf(linkMutations([had, tb({ search: "" })], 1)), undefined);
  });

  test("L5 changed = 0 (the lollipop changed): table untouched", () => {
    const had = lp({ table: { gene: "KRAS", search: "G12D" } });
    const out = linkMutations([had, tb({ search: "Q61H" })], 0);
    assert.deepEqual(tableOf(out), { gene: "KRAS", search: "G12D" });
  });

  test("L6 the gene chooser's apply (a new gene): the lollipop's table removed", () => {
    const rq = { studies: ["a"], filters: [], entries: ["KRAS", "TP53"], genes: ["KRAS", "TP53"] };
    const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
      held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
    const l = resultsLayout(rq as never, rdata);
    const tab = l.tabs.find((t) => t.title === "Mutations") as unknown as { views: number[]; chooser: { apply: (vs: View[], g: string) => View[] } };
    assert.ok(tab && tab.chooser, "the Mutations tab has a gene chooser");
    const [v0, v1] = tab.views.map((i) => l.doc.views![i]);
    const linked = linkMutations([v0, { ...v1, search: "G12D" } as View], 1);
    assert.ok(tableOf(linked), "the search reached the lollipop first");
    const next = tab.chooser.apply([linked[0], { ...linked[1], search: "G12D" } as View], "TP53");
    assert.equal(tableOf(next), undefined);
    assert.equal((next[1] as unknown as { search?: string }).search, undefined, "the table's search is cleared");
  });
});

// ---------------------------------------------------------------- V: the hotspots view checks `table`
type Args = unknown[];
/** a participant that records what the lollipop asks of it */
function local(mode: "patient-level" | "aggregate-only" = "patient-level", id = "c1") {
  const lollipop: Args[] = [];
  return {
    lollipop,
    instance: { id, mode, label: "Local " + id, conn: { id, db: id } },
    cohortSql: () => "SELECT 1",
    lollipopCounts: async (...args: Args) => { lollipop.push(args); return { changes: [], types: [], totals: [], cohortSamples: 10, minCount: 1, annotated: true }; },
  };
}
const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "", count: 10, samples: 10, mode: "" } }, count: 10, samples: 10, text: "" };
function ctx(r: ReturnType<typeof local>): ViewRun {
  return {
    doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] } as never,
    cohorts: { Q: cohort }, resolvers: { s1: r } as never, vNames: ["Q"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7", studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
  } as ViewRun;
}
const resultOf = (r: ViewResult | InstanceType<typeof Untimed>): ViewResult => r instanceof Untimed ? r.result : r;
const run = async (view: Record<string, unknown>) => {
  const r = local();
  const res = resultOf(await runHotspots({ kind: "hotspots", genes: ["KRAS", "TP53"], cohorts: ["Q"], ...view } as never, ctx(r)));
  return { r, res, err: String((res as { error?: string }).error || "") };
};

describe("V the hotspots view checks table", () => {
  test("V1 table.gene not among the view's genes: refused, naming it", async () => {
    const { r, err } = await run({ table: { gene: "EGFR", search: "L858R" } });
    assert.match(err, /EGFR/);
    assert.equal(r.lollipop.length, 0, "nothing asked");
  });

  test("V2 table.filters naming an unknown column: refused with the table's own checkQuery message", async () => {
    const { r, err } = await run({ table: { gene: "KRAS", filters: { noSuchColumn: { values: ["x"] } } } });
    assert.match(err, /filters\.noSuchColumn: not a column/);
    assert.equal(r.lollipop.length, 0, "nothing asked");
  });

  test("V2 table.columns naming an unknown column: refused", async () => {
    const { err } = await run({ table: { gene: "KRAS", search: "x", columns: ["noSuchColumn"] } });
    assert.match(err, /unknown column noSuchColumn/);
  });

  test("V3 table omitted: the lollipop is asked as today, with no 6th argument", async () => {
    const { r, err } = await run({});
    assert.equal(err, "");
    assert.equal(r.lollipop.length, 1);
    assert.equal(r.lollipop[0][5], undefined, "no rows argument: " + JSON.stringify(r.lollipop[0]));
  });

  test("V table given and valid: passed to lollipopCounts as its 6th argument", async () => {
    const rows = { gene: "KRAS", search: "G12D", filters: { mutationType: { values: ["Missense"] } } };
    const { r, err, res } = await run({ table: rows });
    assert.equal(err, "", JSON.stringify(res).slice(0, 300));
    assert.equal(r.lollipop.length, 1);
    const got = r.lollipop[0][5] as Rows;
    assert.equal(got?.gene, "KRAS");
    assert.equal(got?.search, "G12D");
    assert.deepEqual(got?.filters, rows.filters);
  });

  test("V5 a cohort over a patient-level and an aggregate-only study: only the patient-level one is narrowed; the note names the other as counted whole", async () => {
    const pl = local("patient-level", "c1"), agg = local("aggregate-only", "c2");
    const two: EvaluatedCohort = { studies: ["s1", "s2"], perStudy: { s1: { sql: "", count: 10, samples: 10, mode: "" }, s2: { sql: "", count: 7, samples: 7, mode: "" } },
      count: 17, samples: 17, text: "" };
    const c = { ...ctx(pl), cohorts: { Q: two }, resolvers: { s1: pl, s2: agg } as never, vStudies: ["s1", "s2"] } as ViewRun;
    const res = resultOf(await runHotspots({ kind: "hotspots", genes: ["KRAS", "TP53"], cohorts: ["Q"], table: { gene: "KRAS", search: "G12D" } } as never, c));
    assert.equal(String((res as { error?: string }).error || ""), "", JSON.stringify(res).slice(0, 300));
    assert.equal(pl.lollipop.length, 1);
    assert.equal(agg.lollipop.length, 1);
    assert.deepEqual(norm(pl.lollipop[0][5]), { gene: "KRAS", search: "G12D" }, "the patient-level study gets the narrowing");
    assert.equal(agg.lollipop[0][5], undefined, "the aggregate-only study gets none: " + JSON.stringify(agg.lollipop[0]));
    const note = String((res as { note?: string }).note || "");
    assert.match(note, /\bs2\b[^.]*counted whole/, note);
    assert.doesNotMatch(note, /\bs1\b[^.]*counted whole/, "the narrowed study is not named as counted whole");
  });

  for (const [what, table] of [
    ["only alteration / proteinPos filters", { gene: "KRAS", filters: { alteration: { values: ["Missense · VUS"] }, proteinPos: { values: ["12"] } } }],
    ["only a sort", { gene: "KRAS", sort: { column: "proteinChange", desc: true } }],
    ["a blank search and only a proteinPos filter", { gene: "KRAS", search: "  ", filters: { proteinPos: { values: ["12"] } } }],
  ] as [string, Record<string, unknown>][]) {
    test("V6 table holding " + what + ": no 6th argument (nothing narrows)", async () => {
      const { r, err, res } = await run({ table });
      assert.equal(err, "", JSON.stringify(res).slice(0, 300));
      assert.equal(r.lollipop.length, 1);
      assert.equal(r.lollipop[0][5], undefined, "got " + JSON.stringify(r.lollipop[0][5]));
    });
  }
});

// ---------------------------------------------------------------- S: the SQL takes the row keys of one gene; totals never
const COHORT = "SELECT 'P1' AS pid, 'S1' AS sid";
const STUDY = "paad_x", DB = "db", PIN = "v1";
const HOT = { hg19: "g1", hg38: null };
const GENES = ["KRAS", "TP53"];
const KEYS = "SELECT 'ROWKEY_MARK' AS sid, 'G12D' AS proteinChange, 'Missense_Mutation' AS mutationType, '12:25398284-25398284:C>T' AS rk";
type Sql = (...a: unknown[]) => unknown;
const withKeys = (f: Sql, gene: string) => String(f(COHORT, GENES, STUDY, 1, PIN, DB, HOT, undefined, undefined, undefined, { gene, keys: KEYS }));
/** the text before each place the keys are read: the condition they sit in */
const ahead = (sql: string, n = 400) => [...sql.matchAll(/ROWKEY_MARK/g)].map((m) => sql.slice(Math.max(0, m.index! - n), m.index!));

describe("S the lollipop's SQL with rowKeys", () => {
  for (const [name, f] of [["changes", lollipopChangesSql], ["types", lollipopTypesSql]] as [string, Sql][]) {
    test("S " + name + " SQL with rowKeys reads the keys, under the named gene", () => {
      const plain = String(f(COHORT, GENES, STUDY, 1, PIN, DB, HOT));
      assert.equal(String(f(COHORT, GENES, STUDY, 1, PIN, DB, HOT, undefined, undefined, undefined, undefined)), plain, "rowKeys omitted: as today");
      const k = withKeys(f, "KRAS");
      assert.notEqual(k, plain);
      const at = ahead(k);
      assert.ok(at.length > 0, "the keys are in the SQL");
      for (const b of at) assert.match(b, /'KRAS'/, "the keys restrict KRAS's rows");
      const t = withKeys(f, "TP53");
      for (const b of ahead(t)) assert.match(b, /'TP53'/, "named TP53: the keys restrict TP53's rows");
      assert.notEqual(t, k, "the named gene is what the keys restrict");
    });
  }

  test("S lollipopTotalsSql is unaffected (it takes no rowKeys)", () => {
    const plain = String(lollipopTotalsSql(COHORT, GENES, STUDY, DB));
    assert.doesNotMatch(plain, /ROWKEY_MARK/);
    assert.ok(lollipopTotalsSql.length <= 6, "no new parameter on lollipopTotalsSql");
  });

  test("S the resolver with rows: changes and types narrowed by the table's query for KRAS; totals the same SQL as without", async () => {
    const r = new PatientLevelResolver("s1", { oncokbPin: PIN }, { id: PRIMARY.id, mode: "patient-level", label: "stand-in", conn: PRIMARY });
    await (r as unknown as { lollipopCounts: (...a: unknown[]) => Promise<unknown> }).lollipopCounts({ all: [] }, GENES, 1, undefined);
    const plain = Object.fromEntries(r.queries.filter((q) => q.label.startsWith("lollipop:")).map((q) => [q.label, q.sql]));
    const r2 = new PatientLevelResolver("s1", { oncokbPin: PIN }, { id: PRIMARY.id, mode: "patient-level", label: "stand-in", conn: PRIMARY });
    await (r2 as unknown as { lollipopCounts: (...a: unknown[]) => Promise<unknown> }).lollipopCounts({ all: [] }, GENES, 1, undefined, undefined, { gene: "KRAS", search: "Zq9Search" });
    const rows = Object.fromEntries(r2.queries.filter((q) => q.label.startsWith("lollipop:")).map((q) => [q.label, q.sql]));
    assert.ok(plain["lollipop:totals"] && rows["lollipop:totals"], "totals ran both times");
    assert.equal(rows["lollipop:totals"], plain["lollipop:totals"], "totals ignore the table's query");
    for (const l of ["lollipop:changes", "lollipop:types"]) {
      assert.ok(rows[l], l + " ran");
      assert.match(rows[l], /Zq9Search/i, l + " carries the search");
      assert.notEqual(rows[l], plain[l]);
    }
  });

  test("B2 the patient-level resolver with rows.gene not among the genes: refused, naming the gene", async () => {
    const r = new PatientLevelResolver("s1", { oncokbPin: PIN }, { id: PRIMARY.id, mode: "patient-level", label: "stand-in", conn: PRIMARY });
    await assert.rejects(() => (r as unknown as { lollipopCounts: Lollipop }).lollipopCounts({ all: [] }, ["KRAS"], 1, undefined, undefined, { gene: "EGFR", search: "L858R" }), /EGFR/);
  });

  test("S mutationRowKeysSql leaves out the alteration and proteinPos filters, keeps mutationType", () => {
    const keysSql = (mt as unknown as { mutationRowKeysSql: (...a: unknown[]) => string }).mutationRowKeysSql;
    assert.equal(typeof keysSql, "function", "lib/mutation-table.ts exports mutationRowKeysSql");
    const part = { cohort: "c", study: STUDY, cohortSql: COHORT };
    const k = (q: Record<string, unknown>) => keysSql(part, DB, "KRAS", PIN, HOT, undefined, q);
    const none = k({});
    assert.equal(k({ filters: { alteration: { values: ["Missense · VUS"] } } }), none);
    assert.equal(k({ filters: { proteinPos: { values: ["12"] } } }), none);
    assert.notEqual(k({ filters: { mutationType: { values: ["IF del"] } } }), none);
    assert.notEqual(k({ search: "G12D" }), none);
    assert.match(none, /\bsid\b[\s\S]*\bproteinChange\b[\s\S]*ifNull\(mutationType, ''\) AS mutationType/);
  });

  test("K mutationRowKeysSql selects a 4th key column rk: the row's chromosome:start-end:ref>alt (rowKeySql)", () => {
    const m = mt as unknown as { mutationRowKeysSql: (...a: unknown[]) => string; rowKeySql?: (...a: string[]) => string };
    assert.equal(typeof m.rowKeySql, "function", "lib/mutation-table.ts exports rowKeySql");
    const sql = m.mutationRowKeysSql({ cohort: "c", study: STUDY, cohortSql: COHORT }, DB, "KRAS", PIN, HOT, undefined, { search: "G12D" });
    const rk = m.rowKeySql!("chr", "start", "end", "ref", "var");
    assert.match(rk, /\bchr\b[\s\S]*':'[\s\S]*\bstart\b[\s\S]*'-'[\s\S]*\bend\b[\s\S]*':'[\s\S]*\bref\b[\s\S]*'>'[\s\S]*\bvar\b/, "chromosome:start-end:ref>alt");
    const select = sql.slice(sql.lastIndexOf("SELECT sid,"));
    assert.ok(select.startsWith("SELECT sid, proteinChange, ifNull(mutationType, '') AS mutationType, " + rk + " AS rk FROM rows"), select.slice(0, 400));
  });

  for (const [name, f] of [["changes", lollipopChangesSql], ["types", lollipopTypesSql]] as [string, Sql][]) {
    test("K " + name + " SQL with rowKeys matches on (sid, change, ifNull(mtype,''), rk); a mutation's rk from its own call, a fusion's from site 1", () => {
      const rowKeySql = (mt as unknown as { rowKeySql?: (...a: string[]) => string }).rowKeySql;
      assert.equal(typeof rowKeySql, "function", "lib/mutation-table.ts exports rowKeySql");
      const k = withKeys(f, "KRAS");
      assert.match(k, /\(sid, change, ifNull\(mtype, ''\), rk\) IN \(\s*SELECT 'ROWKEY_MARK'/);
      assert.ok(k.includes(rowKeySql!("chr", "startPosition", "endPosition", "referenceAllele", "tumorSeqAllele") + " AS rk"), "the mutation rows carry rk");
      assert.ok(k.includes(rowKeySql!("v.chr", "v.start", "NULL", "NULL", "NULL") + " AS rk"), "the fusion rows carry rk, from site 1");
      assert.match(k, /sv\.site1_chromosome AS chr, sv\.site1_position AS start/, "the fusion's chromosome and position are site 1's");
    });
  }
});

// ---------------------------------------------------------------- R: the remote path never carries the table's query
describe("R the remote path never carries the table's search or filters", () => {
  test("R1 the federation API has no lollipopRows: a request carrying it answers, and lollipopCounts gets no 6th argument (zod strips the unknown key)", async () => {
    const seen: unknown[][] = [];
    const protos = [PatientLevelResolver.prototype, AggregateResolver.prototype] as unknown as Record<string, unknown>[];
    for (const p of protos) assert.equal(Object.hasOwn(p, "lollipopCounts"), false, "lollipopCounts is inherited from BaseResolver");
    const fake = async (...args: unknown[]) => {
      seen.push(args);
      return { changes: [], types: [], totals: [], cohortSamples: 0, minCount: 1, annotated: false };
    };
    for (const p of protos) p.lollipopCounts = fake;
    const rows = { gene: "KRAS", search: "G12D", filters: { mutationType: { values: ["Missense"] } }, columns: ["sample", "proteinChange"] };
    try {
      const with_ = await answerFederation("aggregates", { study: "s1", cohort: { all: [] }, lollipopGenes: ["KRAS"], lollipopRows: rows });
      assert.equal(with_.status, 200, "the unknown key is stripped, not refused: " + JSON.stringify(with_.body));
      const without = await answerFederation("aggregates", { study: "s1", cohort: { all: [] }, lollipopGenes: ["KRAS"] });
      assert.equal(without.status, 200, JSON.stringify(without.body));
    } finally {
      for (const p of protos) delete p.lollipopCounts;
    }
    assert.equal(seen.length, 2);
    assert.equal(seen[0][5], undefined, "lollipopRows is not passed on: " + JSON.stringify(seen[0]));
    assert.ok(seen[0].length <= 5, "no 6th argument: " + JSON.stringify(seen[0]));
    assert.equal(seen[1][5], undefined);
  });

  test("R2 the remote resolver with rows throws, naming the study, and sends nothing; without rows it asks as before", async () => {
    const bodies: Record<string, unknown>[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ study: "s1", count: 1, samples: 1, oncokbPin: null,
        lollipopCounts: { changes: [], types: [], totals: [], cohortSamples: 1, minCount: 1, annotated: false } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const r = new RemoteAggregateResolver("s1", "http://peer.invalid/api/federation/v1", { id: "peer", mode: "aggregate-only", label: "test peer", conn: PRIMARY });
      const remote = r as unknown as { lollipopCounts: Lollipop };
      await assert.rejects(() => remote.lollipopCounts({ all: [] }, ["KRAS"], 1, undefined, undefined, { gene: "KRAS", search: "FX-P05-T1" }), /\bs1\b/);
      assert.equal(bodies.length, 0, "nothing sent");
      await remote.lollipopCounts({ all: [] }, ["KRAS"], 1);
    } finally { globalThis.fetch = original; }
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0].lollipopGenes, ["KRAS"]);
    assert.equal("lollipopRows" in bodies[0], false);
  });
});
