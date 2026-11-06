// The peer half of federation (lib/federation-api.ts) answering real calls, over a stand-in warehouse
// (setChTransport) that holds three studies: s1 (patient-level), agg_s (held aggregate-only) and a
// consortium study that is never routed. What is checked is each op's contract as the peer serves it:
// refused before anything is read when a cohort carries ids or the study is not this instance's own;
// counts computed in the database and returned in the documented shape; the patient-level ops only
// where FEDERATION_DISCLOSE_PATIENTS allows the study and kind, and only for a study held here at
// patient level.
import { test, describe, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE", "FEDERATION_DISCLOSE_PATIENTS", "FEDERATION_ACCEPT_PATIENT_LEVEL",
  "FEDERATION_HIDE_SQL", "AGGREGATE_ONLY_INSTANCES", "STUDY_DENY", "STUDY_ALLOW_RESTRICTED"]) delete process.env[k];
process.env.AGGREGATE_ONLY_STUDIES = "agg_s";

const { setChTransport } = await import("../lib/ch.ts");
const { answerFederation, federationOps } = await import("../lib/federation-api.ts");
const { resolverFor, PatientLevelResolver, AggregateResolver } = await import("../lib/federation.ts");

type Rows = Record<string, unknown>[];
let sent: string[] = [];
let answers: [RegExp, Rows | ((sql: string) => Rows)][] = [];
/** statements matching this fail, as a database error */
let failOn: RegExp | null = null;
/** answer statements matching `re` with `rows` (the first match wins; routing is always answered) */
const on = (re: RegExp, rows: Rows | ((sql: string) => Rows)) => { answers.push([re, rows]); };
setChTransport(async ({ query }) => {
  sent.push(query);
  if (failOn?.test(query)) throw new Error("ClickHouse error [primary]: stand-in failure");
  let data: Rows = [];
  if (/SELECT cancer_study_identifier AS id, name FROM fed_a\.cancer_study/.test(query))
    data = [{ id: "s1", name: "Study one" }, { id: "agg_s", name: "Aggregate study" }, { id: "genie_c", name: "GENIE v3.1-consortium" }];
  else for (const [re, rows] of answers) if (re.test(query)) { data = typeof rows === "function" ? rows(query) : rows; break; }
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));

const realLog = console.log;
before(() => { console.log = () => {}; });
after(() => { console.log = realLog; });

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

beforeEach(() => { sent = []; answers = []; failOn = null; });

const OQL = { all: [{ kind: "oql", q: "TP53: MUT" }] };
const IDS = { all: [{ kind: "patientList", ids: ["P1"] }] };
const errorOf = (r: { body: unknown }) => (r.body as { error: string }).error;
const ok = (r: { status: number; body: unknown }) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as Record<string, any>; };
/** the statements that read study data, as against routing and metadata */
const dataReads = () => sent.filter((q) => !/AS id, name FROM fed_a\.cancer_study/.test(q));

describe("profiles", () => {
  test("profiles: the study's own, as it describes them (first: a study's profiles are read once per process)", async () => {
    on(/AS profile, gp\.genetic_alteration_type AS type/, [{ s: "s1", profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "Mutations", assay: "", ord: 0, pl: 0 }]);
    const r = ok(await answerFederation("profiles", { study: "s1" }));
    assert.equal(r.study, "s1");
    assert.deepEqual(r.catalog.map((p: { profile: string }) => p.profile), ["mutations"]);
    assert.match(errorOf(await answerFederation("profiles", { study: "nope" })), /unknown study/);
  });

});

describe("aggregates", () => {
  test("a cohort carrying ids is refused by the peer itself, before anything is read", async () => {
    const r = await answerFederation("aggregates", { study: "s1", cohort: IDS, genes: ["TP53"] });
    assert.equal(r.status, 422);
    assert.match(errorOf(r), /explicit sample or patient list; identifiers are not accepted across instances/);
    assert.equal(sent.length, 0);
  });

  test("a study this instance does not hold is refused by name: unknown, withheld by policy, or a peer's", async () => {
    assert.match(errorOf(await answerFederation("aggregates", { study: "nope", cohort: {} })), /unknown study 'nope'/);
    assert.match(errorOf(await answerFederation("aggregates", { study: "genie_c", cohort: {} })), /consortium\/private-access and is excluded/);
    await withEnv({ FEDERATION_PEERS: "far=http://peer.invalid/v1" }, async () => {
      const r = await answerFederation("aggregates", { study: "far", cohort: {} });
      assert.equal(r.status, 422);
      assert.match(errorOf(r), /study 'far' is not held by this instance/, "never relayed to the peer that holds it");
    });
  });

  test("the cohort's size and each aggregate asked for, computed in the database; nothing asked for, nothing run", async () => {
    on(/AS patients/, [{ patients: 12, samples: 15 }]);
    on(/SELECT gene, count\(\) AS n, sum\(v\) AS sx/, [{ gene: "TP53", n: 4, sx: 2.5, sxx: 7 }]);
    on(/LIMIT 100 BY gene/, [{ gene: "TP53", variant: "R175H", mtype: "Missense_Mutation", pos: "175", n: 3 }, { gene: "TP53", variant: "X_splice", mtype: "Splice", pos: "", n: 2 }]);
    on(/distinct_variants/, [{ gene: "TP53", n: 5, distinct_variants: 2 }]);
    on(/AS endpoint/, [{ endpoint: "OS" }, { endpoint: "PFS" }]);
    const body = ok(await answerFederation("aggregates", { study: "s1", cohort: OQL, variantGenes: ["TP53"], minCount: 2, momentGenes: ["TP53"],
      profileType: "mrna_seq_v2_rsem_zscores", survivalEndpoints: true }));
    assert.equal(body.study, "s1");
    assert.deepEqual([body.count, body.samples], [12, 15], "count is the cohort's patients, samples its samples");
    assert.deepEqual(body.profileMoments, [{ gene: "TP53", n: 4, sum: 2.5, sumsq: 7 }]);
    assert.deepEqual(body.variantCounts, { minCount: 2, variants: [
      { gene: "TP53", variant: "R175H", type: "Missense_Mutation", pos: 175, n: 3 },
      { gene: "TP53", variant: "X_splice", type: "Splice", pos: null, n: 2 }], totals: [{ gene: "TP53", n: 5, distinctVariants: 2 }] });
    assert.deepEqual(body.survivalEndpoints, ["OS", "PFS"]);
    assert.ok(/HAVING n >= 2/.test(dataReads().find((q) => /LIMIT 100 BY gene/.test(q))!), "the suppression floor is applied here, in the query");
    assert.deepEqual([body.geneCounts, body.survivalCounts, body.pairCounts, body.attributeStats, body.pairMoments], [[], [], [], [], []]);
    for (const k of ["lollipopCounts", "timelineSpan", "eventCourse", "treatmentSequence", "sequenceKeys"]) assert.equal(k in body, false, k);
    assert.equal(body.oncokbPin, "v-test");
    assert.equal(typeof body.cohortSql, "string");
    assert.deepEqual(body.queries.map((q: { label: string }) => q.label).sort(), ["geneMutationTotals", "profileMoments", "variantCounts"]);
    assert.equal(body.source.name, "primary");
  });

  test("an aggregate-only study answers the same counts; the timeline aggregates come back under their own keys", async () => {
    on(/AS patients/, [{ patients: 3, samples: 3 }]);
    on(/AS interval_events|interval_events/, [{ et: "TREATMENT", pts: 2, events: 5, days: 30, first_day: 0, last_day: 29, interval_events: 1 }]);
    on(/AS label/, [{ k: "AGENT", label: "Agent", pts: 2, values: 3 }]);
    const body = ok(await answerFederation("aggregates", { study: "agg_s", cohort: OQL, timelineSpan: true, sequenceKeys: "TREATMENT" }));
    assert.match(body.instance, /aggregate-only/);
    assert.deepEqual(body.timelineSpan, [{ eventType: "TREATMENT", patients: 2, events: 5, days: 30, firstDay: 0, lastDay: 29, intervalEvents: 1 }]);
    assert.deepEqual(body.sequenceKeys, [{ key: "AGENT", label: "Agent", patients: 2, values: 3 }]);
  });

  test("a study that treats its schema as sensitive (FEDERATION_HIDE_SQL=1) answers without its SQL", async () => {
    on(/AS patients/, [{ patients: 1, samples: 1 }]);
    await withEnv({ FEDERATION_HIDE_SQL: "1" }, async () => {
      const body = ok(await answerFederation("aggregates", { study: "s1", cohort: { all: [] } }));
      assert.deepEqual([body.cohortSql, body.queries], [null, null]);
    });
  });

  test("a study's survival endpoints read as none when its metadata cannot be read", async () => {
    failOn = /AS endpoint/;
    const res = await resolverFor("s1", {});
    assert.deepEqual(await res.survivalEndpoints(), []);
  });
});

describe("plot: a whole plot, or one site's piece of a pooled one", () => {
  const SPEC = { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "SEX" }, unit: "patient" };
  const COHORT = { all: [] };
  const plot = (op: string, extra: Record<string, unknown> = {}) => answerFederation("plot", { study: "s1", cohort: COHORT, op, spec: SPEC, ...extra });
  const KINDS = { kinds: { xk: "cat", yk: "cat" } };

  test("an id list in the cohort or the highlight is refused before anything is read", async () => {
    for (const r of [await answerFederation("plot", { study: "s1", cohort: IDS, op: "plot", spec: SPEC }),
      await answerFederation("plot", { study: "s1", cohort: COHORT, op: "highlightCount", spec: SPEC, highlight: IDS })]) {
      assert.equal(r.status, 422);
      assert.match(errorOf(r), /explicit sample or patient list/);
    }
    assert.equal(sent.length, 0);
  });

  test("an op missing what it needs is refused naming it", async () => {
    assert.match(errorOf(await plot("extent")), /^extent needs kinds$/);
    assert.match(errorOf(await plot("bins", KINDS)), /^bins needs bins$/);
    assert.match(errorOf(await plot("bins", { ...KINDS, bins: [4, 4] })), /^bins needs extent$/);
    assert.match(errorOf(await plot("violin", { ...KINDS, violinBins: 8 })), /^violin needs range$/);
    assert.match(errorOf(await plot("highlightCount")), /^highlightCount needs highlight$/);
    assert.match(errorOf(await plot("highlightBox", { highlight: OQL })), /^highlightBox needs kinds$/);
  });

  test("an axis the study cannot read is refused by the peer, as a local view's would be", async () => {
    const r = await answerFederation("plot", { study: "s1", cohort: COHORT, op: "plot", spec: { x: { source: "clinical", attribute: "bad name!" }, y: SPEC.y } });
    assert.equal(r.status, 422);
    assert.match(errorOf(r), /x axis: 'bad name!' is not a clinical attribute name/);
  });

  test("each piece answers in its documented shape, and the axes' kinds need no cohort", async () => {
    on(/AS a, upper\(cam\.datatype\) AS dt/, [{ a: "AGE", dt: "NUMBER" }, { a: "SEX", dt: "STRING" }]);
    on(/SELECT x AS cx, y AS cy/, [{ cx: "F", cy: "yes", n: "4" }]);
    on(/AS vx0/, [{ g: "F", b: "2", n: "3" }, { g: "M", b: "0", n: "1" }]);
    on(/quantilesExact/, [{ g: "F", n: 5, lo: 1, hi: 9, q: [2, 4, 6] }]);
    on(/AS bx/, [{ bx: 1, by: 2, n: 3 }]);
    on(/uniqExact\(pid\) AS n, uniqExact\(sid\) AS ns/, [{ n: "6", ns: "8" }]);
    const kinds = ok(await plot("axisKinds"));
    assert.deepEqual(kinds.result, { xk: "num", yk: "cat", shape: "box", xLabel: kinds.result.xLabel, yLabel: kinds.result.yLabel });
    assert.equal(kinds.cohortSql, null, "the axes alone decide their kinds");
    assert.deepEqual(ok(await plot("table", KINDS)).result, [{ cx: "F", cy: "yes", n: 4 }]);
    assert.deepEqual(ok(await plot("violin", { kinds: { xk: "num", yk: "cat" }, violinBins: 8, range: [0, 100] })).result,
      [{ g: "F", b: 2, n: 3 }, { g: "M", b: 0, n: 1 }]);
    assert.match(sent.find((q) => /AS vx0/.test(q))!, /WHERE x >= x0 AND x <= x1/, "the bins are cut over the shared range every site was given");
    const ext = { x0: 0, x1: 10, y0: 0, y1: 5 };
    assert.deepEqual(ok(await plot("highlightBins", { highlight: OQL, kinds: { xk: "num", yk: "num" }, bins: [4, 4], extent: ext })).result, [{ bx: 1, by: 2, n: 3 }]);
    assert.deepEqual(ok(await plot("highlightBox", { highlight: OQL, kinds: { xk: "num", yk: "cat" } })).result,
      [{ g: "F", n: 5, lo: 1, hi: 9, q1: 2, median: 4, q3: 6 }]);
    assert.equal(ok(await plot("highlightCount", { highlight: OQL })).result, 6);
    const b = ok(await plot("table", KINDS));
    assert.equal(typeof b.cohortSql, "string");
    assert.ok(b.queries.every((q: { label: string }) => q.label.startsWith("plot:")));
  });

  test("a coloured density splits each bin by class", async () => {
    on(/AS vx0/, [{ g: "F", b: 1, c: "I", n: 2 }, { g: "F", b: 1, c: null, n: 1 }]);
    const r = ok(await answerFederation("plot", { study: "s1", cohort: COHORT, op: "violin", kinds: { xk: "num", yk: "cat" }, violinBins: 8, range: [0, 1],
      spec: { ...SPEC, colorBy: { source: "clinical", attribute: "STAGE" } } }));
    assert.deepEqual(r.result, [{ g: "F", b: 1, n: 2, c: "I" }, { g: "F", b: 1, n: 1, c: "" }]);
  });
});

describe("study-level ops", () => {
  test("facets: an id-carrying draft is refused before anything is read", async () => {
    const r = await answerFederation("facets", { study: "s1", draft: IDS });
    assert.equal(r.status, 422);
    assert.match(errorOf(r), /draft contains an explicit sample or patient list/);
    assert.equal(sent.length, 0);
  });

  test("facets: what Explore shows of a study, as counts, with the retired combined gene list left empty", async () => {
    const r = ok(await answerFederation("facets", { study: "s1", draft: null, geneSearch: "TP" }));
    assert.deepEqual(r.genes, []);
    assert.equal(r.source.name, "primary");
    assert.ok(dataReads().length > 0, "computed against this instance's database");
  });

  test("studies: every study this instance holds directly, with its counts", async () => {
    on(/AS patients, uniqExact\(sd\.sample_unique_id\) AS samples/, [{ id: "s1", name: "Study one", toc: "luad", patients: 4, samples: 5 }]);
    const r = ok(await answerFederation("studies", {}));
    assert.deepEqual(r.studies.map((x: { id: string }) => x.id), ["s1"]);
    assert.equal(r.source.name, "primary");
  });

  test("studies, answered as a simulated peer: only the peer connection's own", async () => {
    const { asLoopbackPeer } = await import("../lib/loopback-peer.ts");
    on(/AS patients, uniqExact\(sd\.sample_unique_id\) AS samples/, [{ id: "s1", name: "Study one", toc: "luad", patients: 4, samples: 5 }]);
    await withEnv({ LOOPBACK_PEER: "a" }, async () => {
      const r = ok(await asLoopbackPeer(() => answerFederation("studies", {})));
      assert.deepEqual(r.studies.map((x: { id: string }) => x.id), ["s1"]);
    });
  });

  test("catalog: a held study's vocabulary and counts; a study it does not hold is refused", async () => {
    on(/SELECT count\(\) AS n FROM fed_a\.cancer_study WHERE/, [{ n: 1 }]);
    on(/AS n FROM fed_a\.sample_derived/, [{ n: 9 }]);
    on(/FROM line_events/, [{ n_pat: 2, n_ev: 3 }]);
    const r = ok(await answerFederation("catalog", { study: "s1" }));
    assert.equal(r.study, "s1");
    assert.equal(r.totalPatients, 9);
    assert.equal(r.source.name, "primary");
    assert.match(errorOf(await answerFederation("catalog", { study: "nope" })), /unknown study 'nope'/);
  });
});

describe("the patient-level ops: only under FEDERATION_DISCLOSE_PATIENTS", () => {
  const ROWS = { study: "s1", table: "timeline", parts: [{ cohort: "A", cohortDef: { all: [] } }], source: "Coordinator <b>X</b>", defaults: ["patient"], mode: "page" };

  test("without rules the ops do not exist", async () => {
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: undefined }, async () => {
      for (const op of ["patient-rows", "patient-timeline", "plot-cases", "oncoprint-columns"]) {
        assert.equal(federationOps().has(op), false);
        assert.equal((await answerFederation(op, {})).status, 404);
      }
    });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "   " }, () => { assert.equal(federationOps().has("patient-rows"), false, "blank rules are no rules"); });
  });

  test("a study the rules do not allow for the table's kind is refused, before anything is read", async () => {
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:timeline" }, async () => {
      const r = await answerFederation("patient-rows", { ...ROWS, table: "alterations" });
      assert.equal(r.status, 422);
      assert.match(errorOf(r), /^s1 is not a study this instance discloses patient alterations of$/);
      assert.equal(dataReads().length, 0);
      assert.match(errorOf(await answerFederation("patient-timeline", { study: "other", patient: "P1" })), /other is not a study this instance discloses/);
    });
  });

  test("a study held only in aggregate is never disclosed, whatever the rules say", async () => {
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "*:*" }, async () => {
      const r = await answerFederation("patient-rows", { ...ROWS, study: "agg_s" });
      assert.equal(r.status, 422);
      assert.match(errorOf(r), /agg_s is not held here at patient level/);
    });
  });

  test("the request is checked before it runs: ids, columns, the subject, the OncoKB version", async () => {
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:*" }, async () => {
      const cases: [Record<string, unknown>, RegExp][] = [
        [{ parts: [{ cohort: "A", cohortDef: IDS }] }, /identifier lists are not accepted across instances/],
        [{ query: { sort: { column: "secret" } } }, /sort\.column secret is not a column/],
        [{ defaults: ["nope"] }, /defaults name unknown columns/],
        [{ table: "alterations:samples", defaults: [] }, /alterations:samples is one patient's table; subject names the patient/],
        [{ table: "alterations:mutations", defaults: [], subject: { patient: "P 1; DROP" } }, /one patient's table; subject names the patient/],
        [{ oncokbPin: "v1' OR 1=1" }, /not an OncoKB version/],
        [{ mode: "values" }, /values needs one of the table's columns/],
        [{ mode: "values", column: "secret" }, /values needs one of the table's columns/],
        [{ mode: "rank" }, /rank needs a patient id/],
        [{ mode: "rank", patient: "a b" }, /rank needs a patient id/],
      ];
      for (const [over, re] of cases) {
        const r = await answerFederation("patient-rows", { ...ROWS, ...over });
        assert.equal(r.status, 422, JSON.stringify(over));
        assert.match(errorOf(r), re, JSON.stringify(over));
      }
    });
  });

  test("each mode answers from this instance's database: a page, the counts, a column's values, a patient's place", async () => {
    on(/AS idx/, [{ idx: 4 }]);
    on(/AS all/, [{ cohort: "A", study: "s1", n: 3, all: 5 }]);
    on(/./, (q) => /total/.test(q) ? [{ patient: "P1", total: 1 }] : [{ v: "x", n: 2 }]);
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:timeline" }, async () => {
      const page = ok(await answerFederation("patient-rows", ROWS));
      assert.equal(page.table, "timeline");
      assert.ok(Array.isArray(page.rows));
      assert.equal("samples" in page, false, "the timeline has no sample scope");
      assert.equal("oncokbPin" in page, false, "only the annotated tables say which OncoKB version");
      assert.deepEqual(ok(await answerFederation("patient-rows", { ...ROWS, mode: "counts" })).counts, [{ cohort: "A", study: "s1", n: 3, all: 5 }]);
      const values = ok(await answerFederation("patient-rows", { ...ROWS, mode: "values", column: "events" }));
      assert.ok(Array.isArray(values.values));
      assert.equal(ok(await answerFederation("patient-rows", { ...ROWS, mode: "rank", patient: "P1" })).rank, 4);
      assert.ok(sent.every((q) => !q.includes("<b>")), "the caller's label reaches SQL only cleaned");
    });
  });

  test("an annotated table says which OncoKB version annotated it: this instance's own pin first", async () => {
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:alterations" }, async () => {
      const r = ok(await answerFederation("patient-rows", { ...ROWS, table: "alterations:mutations", defaults: [], subject: { patient: "P1" }, samples: "cohort", oncokbPin: "v9" }));
      assert.equal(r.oncokbPin, "v-test");
      assert.equal(r.samples, "cohort");
      await withEnv({ ONCOKB_PIN: undefined }, async () => {
        const r2 = ok(await answerFederation("patient-rows", { ...ROWS, table: "alterations:cna", defaults: [], subject: { patient: "P1" }, oncokbPin: "v9" }));
        assert.equal(r2.oncokbPin, "v9", "the caller's version, when this instance pins none");
        assert.equal(r2.samples, "patient");
      });
      const sv = ok(await answerFederation("patient-rows", { ...ROWS, table: "alterations:sv", defaults: [], subject: { patient: "P1" } }));
      assert.equal("oncokbPin" in sv, false);
      ok(await answerFederation("patient-rows", { ...ROWS, table: "alterations:samples", defaults: [], subject: { patient: "P1" } }));
      ok(await answerFederation("patient-rows", { ...ROWS, table: "alterations", defaults: [] }));
    });
  });

  test("patient-timeline: one patient's record, refused for a malformed id or a patient with none", async () => {
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1" }, async () => {
      assert.match(errorOf(await answerFederation("patient-timeline", { study: "s1", patient: "P 1" })), /^not a patient id$/);
      assert.match(errorOf(await answerFederation("patient-timeline", { study: "s1", patient: "P9" })), /P9 has no record in s1/);
      on(/sample_unique_id|SAMPLE/i, [{ id: "S1", type: "Primary" }]);
      const r = ok(await answerFederation("patient-timeline", { study: "s1", patient: "P1" }));
      assert.deepEqual([r.study, r.patient], ["s1", "P1"]);
      assert.ok(r.samples.length >= 1);
    });
  });

  test("plot-cases: refused where the rules allow only other kinds, and checked before it runs", async () => {
    const SPEC = { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "SEX" } };
    const cases = (extra: Record<string, unknown>) => answerFederation("plot-cases", { study: "s1", cohort: { all: [] }, spec: SPEC, ...extra });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:timeline+alterations" }, async () => {
      assert.match(errorOf(await cases({ op: "points" })), /s1 is not a study this instance discloses plot cases of/);
    });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:plot" }, async () => {
      assert.match(errorOf(await cases({ op: "points", highlight: IDS })), /identifier lists are not accepted/);
      assert.match(errorOf(await cases({ op: "outliers", outside: [] })), /outliers needs outside and cap/);
      assert.match(errorOf(await cases({ op: "ranked", rank: { by: "x", n: 3 } })), /ranked needs rank and kinds/);
      assert.match(errorOf(await cases({ op: "highlightPoints", kinds: { xk: "num", yk: "cat" } })), /highlightPoints needs highlight and kinds/);
    });
  });

  test("plot-cases: the cases a plot draws, with their ids; none for a pair of the wrong shape, none past the cap", async () => {
    const SPEC = { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "WEIGHT" } };
    on(/AS a, upper\(cam\.datatype\) AS dt/, [{ a: "AGE", dt: "NUMBER" }, { a: "WEIGHT", dt: "NUMBER" }]);
    on(/AS id/, [{ id: "P1", x: "1", y: "2" }, { id: "P2", x: 3, y: 4 }]);
    const cases = (extra: Record<string, unknown>) => answerFederation("plot-cases", { study: "s1", cohort: { all: [] }, spec: SPEC, ...extra });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:plot" }, async () => {
      assert.deepEqual(ok(await cases({ op: "scatterPoints", cap: 10 })).points, [{ id: "P1", x: 1, y: 2 }, { id: "P2", x: 3, y: 4 }]);
      assert.equal(ok(await cases({ op: "scatterPoints", cap: 1 })).points, null, "past the cap: none, never the first `cap`");
      assert.deepEqual(ok(await cases({ op: "scatterPoints", cap: 10, sparse: { grid: [4, 4], extent: { x0: 0, x1: 1, y0: 0, y1: 1 }, cellMax: 2 } })).points.length, 2);
      assert.deepEqual(ok(await cases({ op: "points" })).points, [], "a scatter has no box points");
      assert.deepEqual(ok(await cases({ op: "ranked", rank: { by: "residual", n: 2, slope: 1, intercept: 0 }, kinds: { xk: "num", yk: "num" } })).points,
        [{ id: "P1", x: 1, y: 2 }, { id: "P2", x: 3, y: 4 }]);
      assert.deepEqual(ok(await cases({ op: "ranked", rank: { by: "x", n: 2 }, kinds: { xk: "cat", yk: "cat" } })).points, [], "a table has no ranked cases");
      assert.deepEqual(ok(await cases({ op: "highlightPoints", highlight: OQL, kinds: { xk: "num", yk: "num" }, cap: 5 })).points.length, 2);
      assert.equal(ok(await cases({ op: "highlightPoints", highlight: OQL, kinds: { xk: "num", yk: "num" }, cap: 1 })).points, null);
      assert.deepEqual(ok(await cases({ op: "highlightPoints", highlight: OQL, kinds: { xk: "cat", yk: "cat" } })).points, []);
    });
  });

  test("plot-cases on a box: values by group, the outliers past given whiskers with their total", async () => {
    const SPEC = { x: { source: "clinical", attribute: "AGE" }, y: { source: "clinical", attribute: "SEX" } };
    on(/AS a, upper\(cam\.datatype\) AS dt/, [{ a: "AGE", dt: "NUMBER" }, { a: "SEX", dt: "STRING" }]);
    on(/AS total/, [{ id: "P1", g: "F", v: "90", total: "7" }]);
    on(/AS id|\bid\b/, [{ id: "P1", g: "F", v: "40" }]);
    const cases = (extra: Record<string, unknown>) => answerFederation("plot-cases", { study: "s1", cohort: { all: [] }, spec: SPEC, ...extra });
    await withEnv({ FEDERATION_DISCLOSE_PATIENTS: "s1:plot" }, async () => {
      assert.deepEqual(ok(await cases({ op: "outliers", cap: 5, outside: [{ g: "F", loWhisker: 10, hiWhisker: 80 }] })).points, { points: [{ id: "P1", g: "F", v: 90 }], total: 7 });
      assert.deepEqual(ok(await cases({ op: "ranked", rank: { by: "y", n: 1 }, kinds: { xk: "num", yk: "cat" } })).points.map((p: { id: string }) => p.id), ["P1"]);
      assert.deepEqual(ok(await cases({ op: "scatterPoints" })).points, [], "a box has no scatter points");
    });
  });
});

describe("the local resolvers, directly", () => {
  test("a percentile of a numeric attribute, or none when the cohort has no value", async () => {
    const res = await resolverFor("s1", {}) as InstanceType<typeof PatientLevelResolver>;
    on(/quantileExact\(0\.25\)/, [{ q: "41.5" }]);
    assert.equal(await res.attributeQuantile({ all: [] }, "AGE", 0.25), 41.5);
    answers = [];
    on(/quantileExact/, [{ q: "" }]);
    assert.equal(await res.attributeQuantile({ all: [] }, "AGE", 0.5), null);
  });

  test("how far a locked cohort has drifted: counts only, and the statement that measured it", async () => {
    const res = await resolverFor("s1", {}) as InstanceType<typeof PatientLevelResolver>;
    assert.ok(res instanceof PatientLevelResolver);
    on(/AS present/, [{ present: "10", now: "12", entered: "3", left: "1" }]);
    const d = await res.lockDrift(OQL as never, { all: [] } as never);
    assert.deepEqual({ ...d, sql: typeof d.sql }, { present: 10, now: 12, entered: 3, left: 1, sql: "string" });
    assert.match(d.sql, /AS present/);
  });

  test("an aggregate-only study's resolver compiles no id list, and has no member list to give", async () => {
    const res = await resolverFor("agg_s", {});
    assert.ok(res instanceof AggregateResolver);
    assert.throws(() => res.cohortSql(IDS as never), /aggregate-only/);
    assert.equal("members" in res, false);
  });
});

describe("a whole plot over one study (op 'plot')", () => {
  const COHORT = { all: [] };
  const META = (kinds: Record<string, string>) => on(/AS a, upper\(cam\.datatype\) AS dt/, Object.entries(kinds).map(([a, dt]) => ({ a, dt })));
  const whole = (x: string, y: string, extra: Record<string, unknown> = {}) => answerFederation("plot", { study: "s1", cohort: COHORT, op: "plot",
    spec: { x: { source: "clinical", attribute: x }, y: { source: "clinical", attribute: y }, unit: "patient", ...extra } });

  test("a scatter: counts per grid cell, correlations and coverage — never a point", async () => {
    META({ AGE: "NUMBER", WEIGHT: "NUMBER" });
    on(/AS x1, min\(y\) AS y0/, [{ n: 20, x0: 1, x1: 9, y0: 2, y1: 8 }]);
    on(/AS pearson/, [{ pearson: "0.5", spearman: "", slope: 2, intercept: "x" }]);
    on(/AS bx/, [{ bx: 0, by: 1, n: 20 }]);
    on(/AS total/, [{ total: 30, nx: 25, ny: 22, multi: 1 }]);
    const r = ok(await whole("AGE", "WEIGHT", { bins: [8, 4] })).result;
    assert.equal(r.shape, "scatter");
    assert.equal(r.n, 20);
    assert.deepEqual(r.extent, { x0: 1, x1: 9, y0: 2, y1: 8 });
    assert.deepEqual(r.grid, [8, 4]);
    assert.deepEqual(r.bins, [{ bx: 0, by: 1, n: 20 }]);
    assert.equal(r.stats.pearson, 0.5);
    assert.equal(r.stats.spearman, null, "a correlation the database could not compute is none, not zero");
    assert.equal(r.stats.intercept, null);
    assert.equal(typeof r.stats.pPearson, "number");
    assert.deepEqual(r.coverage, { total: 30, nx: 25, ny: 22, multi: 1 });
    assert.equal("id" in (r.bins[0] as object), false);
  });

  test("a scatter with no case on both axes says so, and a coverage it could not read is left out", async () => {
    META({ AGE: "NUMBER", WEIGHT: "NUMBER" });
    on(/AS x1, min\(y\) AS y0/, [{ n: 0 }]);
    failOn = /AS total/;
    const r = ok(await whole("AGE", "WEIGHT")).result;
    assert.deepEqual([r.shape, r.n, r.note], ["scatter", 0, "no patient has a value on both axes"]);
    assert.equal("coverage" in r, false);
  });

  test("a contingency table: its cells, or refused past the category cap rather than truncated", async () => {
    META({ SEX: "STRING", STAGE: "STRING" });
    on(/uniqExact\(x\) AS kx/, [{ n: 9, kx: 2, ky: 3 }]);
    on(/SELECT x AS cx, y AS cy/, [{ cx: "F", cy: "I", n: 5 }, { cx: "M", cy: "II", n: 4 }]);
    const r = ok(await whole("SEX", "STAGE")).result;
    assert.equal(r.shape, "table");
    assert.deepEqual(r.cells, [{ cx: "F", cy: "I", n: 5 }, { cx: "M", cy: "II", n: 4 }]);
    answers = [];
    META({ SEX: "STRING", STAGE: "STRING" });
    on(/uniqExact\(x\) AS kx/, [{ n: 900, kx: 2, ky: 151 }]);
    const refused = await whole("SEX", "STAGE");
    assert.equal(refused.status, 422);
    assert.match(errorOf(refused), /151 distinct categories on one axis and 150 is the most/);
    answers = [];
    META({ SEX: "STRING", STAGE: "STRING" });
    assert.equal(ok(await whole("SEX", "STAGE")).result.note, "no patient has a value on both axes");
  });

  test("a box: quartiles and Tukey whiskers per group, its density, and a legend when coloured", async () => {
    META({ AGE: "NUMBER", SEX: "STRING", GRADE: "STRING" });
    on(/quantilesExact/, [{ g: "F", n: 4, lo: 1, hi: 100, q: [10, 20, 30] }, { g: "M", n: 2, lo: 5, hi: 6, q: [5, 5.5, 6] }]);
    on(/AS vx0/, [{ g: "F", b: 0, c: "G1", n: 4, vx0: 1, vx1: 60 }]);
    const r = ok(await whole("SEX", "AGE", { colorBy: { source: "clinical", attribute: "GRADE" } })).result;
    assert.equal(r.shape, "box");
    assert.equal(r.n, 6, "the cases of every group");
    const f = r.groups[0];
    assert.deepEqual([f.q1, f.median, f.q3], [10, 20, 30]);
    assert.ok(f.hiWhisker <= 60 && f.hiWhisker >= 30, "the whisker reaches at most 1.5 IQR past the box: " + f.hiWhisker);
    assert.deepEqual(r.violin, [{ g: "F", b: 0, n: 4, c: "G1" }]);
    assert.deepEqual(r.violinExtent, [1, 60]);
    assert.deepEqual(r.legend.map((l: { label: string }) => l.label), ["G1"]);
  });

  test("a box past the category cap is refused, not cut", async () => {
    META({ AGE: "NUMBER", SEX: "STRING" });
    on(/quantilesExact/, Array.from({ length: 151 }, (_, i) => ({ g: "g" + i, n: 1, lo: 1, hi: 1, q: [1, 1, 1] })));
    assert.match(errorOf(await whole("AGE", "SEX")), /more than 150 groups on the categorical axis/);
  });

  test("an attribute whose type the study's metadata cannot say is refused by name, not guessed", async () => {
    failOn = /AS a, upper\(cam\.datatype\) AS dt/;
    assert.match(errorOf(await whole("AGE", "SEX")), /clinical attribute 'AGE' is not declared by this study, so its type is unknown/);
  });
});

describe("attribute statistics, as a peer answers them", () => {
  const COHORT = { all: [] };
  beforeEach(() => on(/AS patients/, [{ patients: 8, samples: 8 }]));
  test("the most frequent values when asked for a top few, the rest counted in `distinct`", async () => {
    on(/AS a, upper\(cam\.datatype\) AS dt/, [{ a: "SEX", dt: "STRING" }]);
    on(/./, (q) => /attribute_value|AS per/.test(q) ? [{ a: "SEX", per: "patient", v: "F", n: 3 }, { a: "SEX", per: "patient", v: "M", n: 5 }, { a: "SEX", per: "patient", v: "U", n: 3 }] : []);
    const r = ok(await answerFederation("aggregates", { study: "s1", cohort: COHORT, attributes: ["SEX"], attributeTopValues: 2 }));
    assert.deepEqual(r.attributeStats, [{ attribute: "SEX", per: "patient", kind: "cat", values: [{ v: "M", n: 5 }, { v: "F", n: 3 }], distinct: 3 }]);
  });

  test("past the value cap a categorical attribute is skipped with the reason, never truncated", async () => {
    on(/AS a, upper\(cam\.datatype\) AS dt/, [{ a: "CODE", dt: "STRING" }]);
    on(/./, (q) => /attribute_value|AS per/.test(q) ? Array.from({ length: 201 }, (_, i) => ({ a: "CODE", per: "sample", v: "c" + i, n: 1 })) : []);
    const r = ok(await answerFederation("aggregates", { study: "s1", cohort: COHORT, attributes: ["CODE"] }));
    assert.match(r.attributeStats[0].skipped, /more than 200 distinct values in s1; a contingency test on a truncated table would be wrong/);
  });

  test("an attribute the study's metadata does not declare (or cannot be read) is reported skipped, not sniffed", async () => {
    failOn = /AS a, upper\(cam\.datatype\) AS dt/;
    const r = ok(await answerFederation("aggregates", { study: "s1", cohort: COHORT, attributes: ["SEX"] }));
    assert.deepEqual(r.attributeStats, [{ attribute: "SEX", per: "patient", kind: "cat", skipped: "not declared by s1" }]);
  });

  test("a treatment's label keys read as none when the query fails, rather than failing the call", async () => {
    on(/AS patients/, [{ patients: 1, samples: 1 }]);
    failOn = /AS label/;
    const r = ok(await answerFederation("aggregates", { study: "s1", cohort: COHORT, sequenceKeys: "TREATMENT" }));
    assert.equal("sequenceKeys" in r, true);
    assert.deepEqual(r.sequenceKeys, []);
  });
});
