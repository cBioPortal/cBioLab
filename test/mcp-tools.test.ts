// The MCP tools (mcp/tools.ts), called the way a client calls them: through the SDK's in-memory
// transport, so each tool's input schema is enforced exactly as /api/mcp enforces it. Expected
// values come from what each tool's description promises the client, the docs and the lib
// functions it delegates to. The warehouse is a stand-in (setChTransport), the engine is the
// ToolEngine seam, and the campaign ledger is the tests' in-process Postgres.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_DB = "testdb";
process.env.STUDY_ID = "test_study";
process.env.PORTAL_URL = "https://portal.example";

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { registerTools } = await import("../mcp/tools.ts");
const { setChTransport } = await import("../lib/ch.ts");
const { LINE_TYPE } = await import("../lib/compiler.ts");
const { renderDslMarkdown, AGENT_GRAMMAR, EXAMPLES } = await import("../lib/dsl-reference.ts");
const { matchesSearch } = await import("../lib/example-features.ts");
const { decodeUrlJson } = await import("../lib/url-json.ts");
const { assembleContract } = await import("../lib/oncoprint-assemble.ts");
const { localInput, parseTsv } = await import("../lib/oncoprint-local.ts");
const { HYPOTHESIS_GRAMMAR } = await import("../lib/hypothesis.ts");
const { startPostgres } = await import("./support/postgres.ts");

type Engine = Parameters<typeof registerTools>[1];
type Result = { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };

// ---------- the stand-ins ----------

/** The studies the warehouse holds, unless a test's own route says otherwise: test_study (the
 *  configured STUDY_ID) and msk_chord_2024 (campaign_create's default). */
const HOLDS: [RegExp, Record<string, unknown>[]][] = [
  [/SELECT count\(\) AS n FROM testdb\.cancer_study WHERE cancer_study_identifier = 'test_study'/, [{ n: 1 }]],
  [/SELECT cancer_study_identifier AS id, name FROM testdb\.cancer_study/, [{ id: "test_study", name: "Test study" }, { id: "msk_chord_2024", name: "MSK-CHORD" }]],
];

/** The warehouse: each statement answered by the first route whose pattern it matches. */
let routes: [RegExp, Record<string, unknown>[]][] = [];
let statements: string[] = [];
setChTransport(async (st) => {
  statements.push(st.query);
  const hit = routes.find(([re]) => re.test(st.query)) ?? HOLDS.find(([re]) => re.test(st.query));
  const data = hit ? hit[1] : [];
  return JSON.stringify({ meta: [], data, rows: data.length, statistics: { rows_read: 4321, elapsed: 0, bytes_read: 0 } });
});

const engineUnused: Engine = {
  runAnalysis: async () => { throw new Error("runAnalysis not expected here"); },
  buildContract: async () => { throw new Error("buildContract not expected here"); },
};

async function connect(engine: Engine = engineUnused) {
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, engine);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    client,
    call: async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result,
    close: async () => { await client.close(); await server.close(); },
  };
}

const textOf = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const imagesOf = (r: Result) => r.content.filter((c) => c.type === "image");
const isPng = (b64: string) => Buffer.from(b64, "base64").subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

const FIX = new URL("./fixtures/oncoprint/", import.meta.url);
const fixtureContract = () => assembleContract(localInput({
  events: parseTsv(readFileSync(new URL("events.tsv", FIX), "utf8")),
  clinical: parseTsv(readFileSync(new URL("clinical.tsv", FIX), "utf8")),
  coverage: parseTsv(readFileSync(new URL("coverage.tsv", FIX), "utf8")), groupBy: "CANCER_TYPE" }));

beforeEach(() => { routes = []; statements = []; });
after(() => setChTransport(null));

// ---------- the registry ----------

describe("the tool list a client sees", () => {
  test("lists every tool, each with a description", async () => {
    const c = await connect();
    try {
      const { tools } = await c.client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [
        "campaign_check_hypothesis", "campaign_create", "campaign_lock", "campaign_register", "campaign_report", "campaign_run",
        "derive_treatment_lines", "describe_dsl", "describe_study", "query_cohort", "render_oncoprint", "run_analysis"]);
      for (const t of tools) assert.ok((t.description || "").length > 40, t.name + " has no real description");
      const q = tools.find((t) => t.name === "query_cohort")!;
      assert.deepEqual([...(q.inputSchema.required || [])].sort(), ["a", "rel"], "query_cohort requires an anchor and a relation");
    } finally { await c.close(); }
  });

  test("an unknown tool is an error result, not a crash", async () => {
    const c = await connect();
    try {
      const r = await c.call("no_such_tool");
      assert.equal(r.isError, true);
      assert.match(textOf(r), /no_such_tool/);
    } finally { await c.close(); }
  });
});

// ---------- describe_dsl ----------

describe("describe_dsl", () => {
  test("by default returns the compact agent grammar and the numbered example index, not the full reference", async () => {
    const c = await connect();
    try {
      const r = await c.call("describe_dsl");
      assert.notEqual(r.isError, true);
      const t = textOf(r);
      assert.ok(t.startsWith(AGENT_GRAMMAR), "the grammar the in-app assistant reads comes first");
      assert.match(t, new RegExp(`Worked examples \\(${EXAMPLES.length}\\):`));
      assert.match(t, new RegExp("\\n1\\. " + EXAMPLES[0].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\[views: "));
      assert.match(t, new RegExp(`\\n${EXAMPLES.length}\\. `));
      assert.match(t, /`example: N`/);
      assert.ok(t.length < renderDslMarkdown().length / 4, `default is ${t.length} characters`);
    } finally { await c.close(); }
  });

  test("`full: true` returns the generated reference the docs are made from", async () => {
    const c = await connect();
    try {
      const t = textOf(await c.call("describe_dsl", { full: true }));
      assert.equal(t, renderDslMarkdown());
      assert.match(t, /OncoprintSpec/);
      assert.match(t, /federat/i);
    } finally { await c.close(); }
  });

  test("`example: N` returns that example's document as numbered in docs/dsl.md", async () => {
    const c = await connect();
    try {
      const t = textOf(await c.call("describe_dsl", { example: 4 }));
      assert.ok(t.startsWith(`### Example 4: ${EXAMPLES[3].title}`));
      assert.ok(t.includes(JSON.stringify(EXAMPLES[3].doc, null, 2)));
      assert.ok(renderDslMarkdown().includes(t.slice(0, t.indexOf("```json"))), "the same numbering and text as the reference");
      assert.match(t, /run_analysis/);
    } finally { await c.close(); }
  });

  test("an example number out of range is refused, naming the range", async () => {
    const c = await connect();
    try {
      const r = await c.call("describe_dsl", { example: EXAMPLES.length + 1 });
      assert.equal(r.isError, true);
      assert.match(textOf(r), new RegExp(`no example ${EXAMPLES.length + 1}; examples are numbered 1-${EXAMPLES.length}`));
    } finally { await c.close(); }
  });

  test("`search` filters the index to the examples whose every word matches, keeping their numbers", async () => {
    const c = await connect();
    try {
      const t = textOf(await c.call("describe_dsl", { search: "lollipop" }));
      const hits = EXAMPLES.map((e, i) => ({ e, n: i + 1 })).filter(({ e }) => matchesSearch(e, "lollipop"));
      assert.ok(hits.length > 0 && hits.length < EXAMPLES.length);
      assert.match(t, new RegExp(`matching "lollipop" \\(${hits.length} of ${EXAMPLES.length}\\)`));
      for (const { n } of hits) assert.match(t, new RegExp(`\\n${n}\\. `));
      assert.doesNotMatch(t, /Document shape:/, "a search returns the index alone");
      assert.match(textOf(await c.call("describe_dsl", { search: "zzzz-no-such-example" })), /\(none —/);
    } finally { await c.close(); }
  });
});

// ---------- run_analysis ----------

describe("run_analysis", () => {
  const survival = JSON.parse(readFileSync(new URL("./snapshots/survival.json", import.meta.url), "utf8"));
  const doc = { study: "ucec_msk_2018", cohorts: { "MSI-H": { all: [] }, MSS: { all: [] } }, views: [{ kind: "survival", cohorts: ["MSI-H", "MSS"] }] };
  const resultWith = (views: unknown[]) => ({ ...survival, involvedStudies: ["ucec_msk_2018"], oncokbPin: null, stats: { ms: 7 }, views });
  let saved: string | undefined;
  before(() => { saved = process.env.APP_BASE_URL; process.env.APP_BASE_URL = "https://lab.example"; });
  after(() => { if (saved == null) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved; });

  test("runs the document through the engine and returns counts, the figure as a PNG, and an editor link to this exact document", async () => {
    const seen: unknown[] = [];
    const c = await connect({ ...engineUnused, runAnalysis: async (d) => { seen.push(d); return resultWith([survival.views[0]]) as never; } });
    try {
      const r = await c.call("run_analysis", { document: doc });
      assert.notEqual(r.isError, true);
      assert.deepEqual(seen, [doc], "the engine receives the document as sent");
      const imgs = imagesOf(r);
      assert.equal(imgs.length, 1);
      assert.equal(imgs[0].mimeType, "image/png");
      assert.ok(isPng(imgs[0].data!), "the image is a PNG");
      const t = textOf(r);
      assert.match(t, /ucec_msk_2018/);
      assert.match(t, /Figures attached, in order:\n {2}1\. .*MSI-H vs MSS/);
      const link = /https:\/\/lab\.example\/lab\?doc=(\S+)/.exec(t);
      assert.ok(link, "an interactive-editor link on APP_BASE_URL");
      assert.deepEqual(decodeUrlJson(link[1]), doc, "the link opens this exact document");
      assert.match(t, /SQL/, "the link's page is named as the provenance");
    } finally { await c.close(); }
  });

  test("a view that failed or has no figure attaches no image", async () => {
    const c = await connect({ ...engineUnused, runAnalysis: async () => resultWith([{ ...survival.views[0], error: "too few patients" }, { kind: "not-a-kind", cohorts: [] }]) as never });
    try {
      const r = await c.call("run_analysis", { document: doc });
      assert.equal(imagesOf(r).length, 0);
      assert.doesNotMatch(textOf(r), /Figures attached/);
      assert.match(textOf(r), /lab\?doc=/);
    } finally { await c.close(); }
  });

  test("figures past what is attached are named, not silently dropped", async () => {
    const c = await connect({ ...engineUnused, runAnalysis: async () => resultWith(Array(6).fill(survival.views[0])) as never });
    try {
      const r = await c.call("run_analysis", { document: doc });
      const n = imagesOf(r).length;
      assert.ok(n >= 1 && n <= 6);
      if (n < 6) assert.match(textOf(r), new RegExp(`\\(${6 - n} further figures not attached — open the editor link below\\)`));
    } finally { await c.close(); }
  });

  test("one figure past the cap is named in the singular", async () => {
    const c = await connect({ ...engineUnused, runAnalysis: async () => resultWith(Array(5).fill(survival.views[0])) as never });
    try {
      const r = await c.call("run_analysis", { document: doc });
      if (imagesOf(r).length === 4) assert.match(textOf(r), /\(1 further figure not attached/);
    } finally { await c.close(); }
  });

  test("returns every view's figure as an image, as its description promises",
    { todo: "description says \"Every view's figure is returned as an image\"; code attaches at most 4 (MAX_FIGURES, mcp/tools.ts:112-119)" },
    async () => {
      const c = await connect({ ...engineUnused, runAnalysis: async () => resultWith(Array(6).fill(survival.views[0])) as never });
      try { assert.equal(imagesOf(await c.call("run_analysis", { document: doc })).length, 6); }
      finally { await c.close(); }
    });

  test("an oncoprint view is drawn from its own SVG", async () => {
    const contract = fixtureContract();
    const { contractToSvg } = await import("../lib/oncoprint-svg.ts");
    const svg = contractToSvg(contract, 400);
    const c = await connect({ ...engineUnused, runAnalysis: async () => resultWith([{ kind: "oncoprint", cohorts: [], svg,
      nColumns: 12, genes: [{ gene: "TP53", driverPct: 27.3, anyPct: 45.5 }], annotation: "driver flags from the input" }]) as never });
    try {
      const r = await c.call("run_analysis", { document: { ...doc, views: [{ kind: "oncoprint", genes: ["TP53"] }] } });
      assert.notEqual(r.isError, true, textOf(r));
      assert.equal(imagesOf(r).length, 1);
      assert.ok(isPng(imagesOf(r)[0].data!));
      assert.match(textOf(r), /1\. Oncoprint/);
    } finally { await c.close(); }
  });

  test("a document the engine refuses comes back as REJECTED with the reason and a pointer to describe_dsl", async () => {
    const c = await connect({ ...engineUnused, runAnalysis: async () => { throw new Error("unknown study: nope"); } });
    try {
      const t = textOf(await c.call("run_analysis", { document: { study: "nope", cohorts: {}, views: [] } }));
      assert.match(t, /^REJECTED: unknown study: nope/);
      assert.match(t, /describe_dsl/);
    } finally { await c.close(); }
  });

  test("a missing document is an error result naming the argument", async () => {
    const c = await connect();
    try {
      const r = await c.call("run_analysis", {});
      assert.equal(r.isError, true);
      assert.match(textOf(r), /document/);
    } finally { await c.close(); }
  });
});

// ---------- describe_study ----------

describe("describe_study", () => {
  test("lists event types with patient and event counts, their attribute values, the derived line type and the caveats", async () => {
    routes = [
      [/AS n_pat, count\(\) AS n_ev\nFROM testdb\.clinical_event/, [{ t: "Treatment", n_pat: 1200, n_ev: 34567 }, { t: "Diagnosis", n_pat: 900, n_ev: 950 }]],
      [/AS v, uniqExact\(patient_unique_id\)/, [
        { t: "Treatment", k: "AGENT", v: "CARBOPLATIN" },
        ...Array.from({ length: 12 }, (_, i) => ({ t: "Treatment", k: "SUBTYPE", v: "S" + i })),
      ]],
      [/SELECT combo, count\(\) AS n FROM line_events/, [{ combo: "CARBOPLATIN+PEMETREXED" }, { combo: "PEMBROLIZUMAB" }]],
    ];
    const c = await connect();
    try {
      const r = await c.call("describe_study");
      assert.notEqual(r.isError, true);
      const t = textOf(r);
      assert.match(t, /Study: test_study/);
      assert.match(t, /https:\/\/portal\.example\/study\/summary\?id=test_study/);
      assert.match(t, /- Treatment: 1,200 pts \| 34,567 events/);
      assert.match(t, /- Diagnosis: 900 pts \| 950 events/);
      assert.match(t, /AGENT: CARBOPLATIN/);
      assert.match(t, /SUBTYPE: S0, S1, .*S9, …/, "a long value list is cut and says so");
      assert.doesNotMatch(t, /S10/);
      assert.match(t, new RegExp("- " + LINE_TYPE.replace(/[()]/g, "\\$&") + ": derived"));
      assert.match(t, /CARBOPLATIN\+PEMETREXED, PEMBROLIZUMAB/);
      assert.match(t, /Caveats: .*Prior medications/);
      assert.ok(statements.every((s) => !/\btestdb\b/.test(s) || /test_study/.test(s)), "every statement is scoped to the study");
    } finally { await c.close(); }
  });

  test("`study` describes another study the warehouse holds, every statement scoped to it", async () => {
    routes = [[/FROM testdb\.cancer_study WHERE cancer_study_identifier = 'other_study'/, [{ n: 1 }]]];
    const c = await connect();
    try {
      const r = await c.call("describe_study", { study: "other_study" });
      assert.notEqual(r.isError, true, textOf(r));
      assert.match(textOf(r), /Study: other_study/);
      assert.ok(statements.every((s) => !/\btestdb\b/.test(s) || /other_study/.test(s)), "every statement is scoped to the requested study");
      assert.ok(statements.every((s) => !/test_study/.test(s)));
    } finally { await c.close(); }
  });

  test("a requested study the warehouse does not hold is refused by that name", async () => {
    const c = await connect();
    try {
      const r = await c.call("describe_study", { study: "no_such_study" });
      assert.equal(r.isError, true, textOf(r));
      assert.match(textOf(r), /unknown study 'no_such_study'/);
    } finally { await c.close(); }
  });

  test("a study the warehouse does not hold is refused by name (invariant 1)", async () => {
    routes = [[/FROM testdb\.cancer_study WHERE cancer_study_identifier = 'test_study'/, [{ n: 0 }]]];
    const c = await connect();
    try {
      const r = await c.call("describe_study");
      assert.equal(r.isError, true, textOf(r));
      assert.match(textOf(r), /unknown study 'test_study'/);
    } finally { await c.close(); }
  });
});

// ---------- query_cohort ----------

describe("query_cohort", () => {
  const answerCohort = (matched: number, denom: number, pids: string[], hist: Record<string, unknown>[] = []) => {
    routes = [
      [/AS matched/, [{ matched, denom }]],
      [/AS pid/, pids.map((pid) => ({ pid }))],
      [/AS bucket, count\(\) AS n FROM \(\n {2}SELECT sel_a/, hist],
    ];
  };

  test("counts the cohort against the anchor denominator and links sample patients", async () => {
    answerCohort(25, 100, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
    const c = await connect();
    try {
      const r = await c.call("query_cohort", { a: { eventType: "Treatment" }, rel: { type: "NONE" } });
      assert.notEqual(r.isError, true);
      const t = textOf(r);
      assert.match(t, /Cohort: 25 patients \(of 100 with the anchor event, 25\.0%\)/);
      assert.match(t, /https:\/\/portal\.example\/patient\?studyId=test_study&caseId=P1/);
      assert.match(t, /scanning 4,321 rows/);
      assert.doesNotMatch(t, /Days from A to/, "no histogram outside BEFORE");
      assert.doesNotMatch(t, /CAVEATS/);
    } finally { await c.close(); }
  });

  test("an anchor no patient has gives 0, not a division by zero", async () => {
    answerCohort(0, 0, []);
    const c = await connect();
    try {
      const t = textOf(await c.call("query_cohort", { a: { eventType: "Nothing" }, rel: { type: "NONE" } }));
      assert.match(t, /Cohort: 0 patients \(of 0 with the anchor event, 0%\)/);
      assert.doesNotMatch(t, /NaN/);
    } finally { await c.close(); }
  });

  test("BEFORE returns the days-from-A-to-B histogram", async () => {
    answerCohort(10, 40, ["P1"], [{ bucket: 0, n: 3 }, { bucket: 10, n: 7 }]);
    const c = await connect();
    try {
      const t = textOf(await c.call("query_cohort", { a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" }, rel: { type: "BEFORE", maxDays: 120 } }));
      // the compiler buckets a 120-day window into 12 buckets of 10 days
      assert.match(t, /Days from A to first subsequent B \(bucket=10d\): 0–9d:3 {2}10–19d:7/);
    } finally { await c.close(); }
  });

  test("BEFORE with nothing in the window prints no empty histogram", async () => {
    answerCohort(0, 40, []);
    const c = await connect();
    try {
      const t = textOf(await c.call("query_cohort", { a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" }, rel: { type: "BEFORE", maxDays: 30 } }));
      assert.doesNotMatch(t, /Days from A/);
    } finally { await c.close(); }
  });

  test("an absence query without observed:true carries the absence caveat, marked NOT applied", async () => {
    answerCohort(5, 50, ["P1"]);
    const c = await connect();
    try {
      const t = textOf(await c.call("query_cohort", { a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" }, rel: { type: "NOT_FOLLOWED_BY", withinDays: 90 } }));
      assert.match(t, /CAVEATS \(tell the user\): Absence query.*NOT applied/);
    } finally { await c.close(); }
  });

  test("with observed:true the absence caveat says the guard was applied", async () => {
    answerCohort(5, 50, ["P1"]);
    const c = await connect();
    try {
      const t = textOf(await c.call("query_cohort", { a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" }, rel: { type: "NOT_FOLLOWED_BY", withinDays: 90, observed: true } }));
      assert.match(t, /Absence query.*was applied\./);
      assert.doesNotMatch(t, /NOT applied/);
    } finally { await c.close(); }
  });

  test("'first' without priorGuard warns that first means first observed; with it, no warning and the query is guarded", async () => {
    answerCohort(5, 50, ["P1"]);
    const c = await connect();
    try {
      const a = { eventType: "Treatment", occurrence: "FIRST" };
      assert.match(textOf(await c.call("query_cohort", { a, rel: { type: "NONE" } })), /CAVEATS.*Prior medications to MSK/);
      statements = [];
      const guarded = textOf(await c.call("query_cohort", { a, rel: { type: "NONE" }, priorGuard: true }));
      assert.doesNotMatch(guarded, /Prior medications to MSK/);
      assert.ok(statements.some((s) => /nopriormed/.test(s)), "the guard reaches the SQL");
    } finally { await c.close(); }
  });

  test("a derived treatment-line selector carries the lines caveat and uses the given gap", async () => {
    answerCohort(5, 50, ["P1"]);
    const c = await connect();
    try {
      const t = textOf(await c.call("query_cohort", { a: { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" }, lineGap: 45 }));
      assert.match(t, /Treatment lines are DERIVED/);
      assert.ok(statements.some((s) => /\b45\b/.test(s)), "lineGap reaches the line derivation");
    } finally { await c.close(); }
  });

  test("returns a plain-language readback of the cohort definition",
    { todo: "description promises \"a plain-language readback (echo it to the user to confirm intent)\"; the response has counts, links and caveats but no readback (mcp/tools.ts:171-184)" },
    async () => {
      answerCohort(5, 50, ["P1"]);
      const c = await connect();
      try {
        const t = textOf(await c.call("query_cohort", { a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" }, rel: { type: "BEFORE", maxDays: 30 } }));
        assert.match(t, /Diagnosis[\s\S]*Treatment[\s\S]*30 days/i);
      } finally { await c.close(); }
    });

  for (const [what, args, msg] of [
    ["no anchor", { rel: { type: "NONE" } }, /a\b/],
    ["no relation", { a: { eventType: "X" } }, /rel/],
    ["an unknown relation type", { a: { eventType: "X" }, rel: { type: "AFTER" } }, /rel|type/],
    ["four attribute filters", { a: { eventType: "X", attrs: [1, 2, 3, 4].map((i) => ({ key: "K" + i, value: "v" })) }, rel: { type: "NONE" } }, /attrs|3/],
    ["BEFORE without its required maxDays", { a: { eventType: "X" }, b: { eventType: "Y" }, rel: { type: "BEFORE" } }, /maxDays/],
    ["NOT_FOLLOWED_BY without its required withinDays", { a: { eventType: "X" }, b: { eventType: "Y" }, rel: { type: "NOT_FOLLOWED_BY" } }, /withinDays/],
    ["a relation with no B", { a: { eventType: "X" }, rel: { type: "DURING" } }, /eventType/],
    ["a negative lineGap", { a: { eventType: "X" }, rel: { type: "NONE" }, lineGap: -1 }, /lineGap/],
  ] as [string, Record<string, unknown>, RegExp][]) {
    test(`${what} is an error result that says what is wrong, and no query is sent`, async () => {
      const c = await connect();
      try {
        const r = await c.call("query_cohort", args);
        assert.equal(r.isError, true, textOf(r));
        assert.match(textOf(r), msg);
        assert.deepEqual(statements, []);
      } finally { await c.close(); }
    });
  }
});

// ---------- derive_treatment_lines ----------

describe("derive_treatment_lines", () => {
  const answerLines = () => {
    routes = [
      [/AS bucket, count\(\) AS n FROM \(\n {2}SELECT patient_id, max\(line_no\)/, [{ bucket: 1, n: 1500 }, { bucket: 2, n: 600 }, { bucket: 8, n: 12 }]],
      [/AS line1, l2\.combo AS line2/, [{ line1: "CARBOPLATIN", line2: "PEMBROLIZUMAB", n: 42 }]],
    ];
  };

  test("returns the lines-per-patient distribution and the top 1L→2L transitions, with the default 90-day gap", async () => {
    answerLines();
    const c = await connect();
    try {
      const t = textOf(await c.call("derive_treatment_lines", {}));
      assert.match(t, /Lines per patient \(gap=90d\): 1:1,500 {2}2:600 {2}8\+:12/);
      assert.match(t, /Top 1L→2L transitions: CARBOPLATIN→PEMBROLIZUMAB:42/);
      assert.match(t, /CAVEAT \(tell the user\): Treatment lines are DERIVED.*Prior medications/, "without the guard, line numbers are relative to MSK");
    } finally { await c.close(); }
  });

  test("with guard, says it is restricted to 'No prior medications' patients and the query is guarded", async () => {
    answerLines();
    const c = await connect();
    try {
      const t = textOf(await c.call("derive_treatment_lines", { gap: 30, guard: true }));
      assert.match(t, /gap=30d, 'No prior medications' only/);
      assert.doesNotMatch(t, /Prior medications to MSK/);
      assert.ok(statements.some((s) => /nopriormed/.test(s)));
    } finally { await c.close(); }
  });

  for (const gap of [0, 4000, "ninety"])
    test(`gap ${JSON.stringify(gap)} is refused as an error result`, async () => {
      const c = await connect();
      try {
        const r = await c.call("derive_treatment_lines", { gap });
        assert.equal(r.isError, true);
        assert.match(textOf(r), /gap/);
        assert.deepEqual(statements, []);
      } finally { await c.close(); }
    });
});

// ---------- render_oncoprint ----------

describe("render_oncoprint", () => {
  let saved: string | undefined;
  before(() => { saved = process.env.APP_BASE_URL; process.env.APP_BASE_URL = "https://lab.example"; });
  after(() => { if (saved == null) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved; });

  const capture = (contract = fixtureContract()) => {
    const specs: any[] = [];
    return { specs, engine: { ...engineUnused, buildContract: async (s: any) => { specs.push(s); return contract; } } as Engine };
  };

  test("returns a PNG and the per-gene statistics on panel-aware denominators", async () => {
    const { specs, engine } = capture();
    const c = await connect(engine);
    try {
      const r = await c.call("render_oncoprint", { genes: ["TP53", "KRAS", "EGFR"] });
      assert.notEqual(r.isError, true);
      assert.equal(r.content[0].type, "image");
      assert.equal(r.content[0].mimeType, "image/png");
      assert.ok(isPng(r.content[0].data!));
      const t = textOf(r);
      assert.match(t, /Oncoprint: 12 patients in groups Lung\(5\), Colon\(4\), Breast\(3\)/);
      // the fixture's TP53 is altered in 5 of the 11 patients profiled for it, not 5 of all 12
      assert.match(t, /TP53: [\d.]+% driver \/ 45\.5% any \(\d+\/5\/11 driver\/altered\/profiled\)/);
      assert.match(t, /KRAS: .*\/10 driver\/altered\/profiled/);
      assert.match(t, /striped = not profiled/);
      assert.match(t, /Annotations: driver flags from the input/);
      assert.equal(specs.length, 1);
      assert.deepEqual(specs[0].genes, ["TP53", "KRAS", "EGFR"]);
      assert.equal(specs[0].cohort, null, "no cohort means all patients");
      assert.equal(specs[0].layout, null);
    } finally { await c.close(); }
  });

  test("`study` reaches the spec; without it the spec names no study and the engine's default applies", async () => {
    const { specs, engine } = capture();
    const c = await connect(engine);
    try {
      await c.call("render_oncoprint", { genes: ["TP53"], study: "msk_met_2021" });
      await c.call("render_oncoprint", { genes: ["TP53"] });
      assert.equal(specs[0].study, "msk_met_2021");
      assert.equal("study" in specs[1], false);
    } finally { await c.close(); }
  });

  test("its provenance, interactive, CLI and notebook links all carry the spec it rendered", async () => {
    const { specs, engine } = capture();
    const c = await connect(engine);
    try {
      const t = textOf(await c.call("render_oncoprint", { genes: ["TP53"], clinical: ["AGE"], sort: ["-AGE"] }));
      for (const path of ["/provenance", "/oncoprint-lab", "/oncoprint-lab/cli", "/oncoprint-lab/python"]) {
        const m = new RegExp("https://lab\\.example" + path + "\\?spec=([\\w-]+)").exec(t);
        assert.ok(m, "a " + path + " link");
        assert.deepEqual(JSON.parse(Buffer.from(m[1], "base64url").toString()), specs[0]);
      }
      assert.deepEqual(specs[0].clinical, ["AGE"]);
      assert.deepEqual(specs[0].sort, ["-AGE"]);
    } finally { await c.close(); }
  });

  test("a mock annotation source is called out as illustrative", async () => {
    const contract = fixtureContract();
    contract.conventions.annotation = "MOCK (no OncoKB token)";
    const { engine } = capture(contract);
    const c = await connect(engine);
    try {
      const t = textOf(await c.call("render_oncoprint", { genes: ["TP53"] }));
      assert.match(t, /ANNOTATION SOURCE \(tell the user\): MOCK \(no OncoKB token\).*illustrative only/);
      assert.doesNotMatch(t, /version-pinned/);
    } finally { await c.close(); }
  });

  test("a single group's count is not listed as groups", async () => {
    const contract = fixtureContract();
    contract.groups = [{ name: "all", start: 0, count: 12 } as never];
    const { engine } = capture(contract);
    const c = await connect(engine);
    try {
      const t = textOf(await c.call("render_oncoprint", { genes: ["TP53"] }));
      assert.match(t, /Oncoprint: 12 patients\./);
    } finally { await c.close(); }
  });

  test("cohort, groups, derived-event tracks and heatmaps reach the spec", async () => {
    const { specs, engine } = capture();
    const c = await connect(engine);
    const dsl = { a: { eventType: "Treatment" }, rel: { type: "NONE" } };
    try {
      await c.call("render_oncoprint", { genes: ["TP53"], cohort: dsl });
      assert.deepEqual(specs[0].cohort, { dsl });
      const groups = [{ name: "g1", dsl }, { name: "g2", dsl }];
      await c.call("render_oncoprint", { genes: ["TP53"], groups,
        derivedEventTracks: [{ label: "Reached 2L", expression: dsl }], heatmap: [{ profileType: "mrna_median_Zscores" }] });
      assert.deepEqual(specs[1].layout, { groupBy: { kind: "cohorts", groups } });
      assert.deepEqual(specs[1].derivedEvents, [{ label: "Reached 2L", expression: dsl }]);
      assert.deepEqual(specs[1].heatmap, [{ profileType: "mrna_median_Zscores" }]);
      assert.equal("sort" in specs[0], false, "no sort key when none asked for");
    } finally { await c.close(); }
  });

  test("an explicit patient list overrides the cohort", async () => {
    const { specs, engine } = capture();
    const c = await connect(engine);
    try {
      await c.call("render_oncoprint", { genes: ["TP53"], cohort: { a: { eventType: "Treatment" }, rel: { type: "NONE" } }, patientList: ["P1", "P2"] });
      assert.deepEqual(specs[0].cohort, { dsl: { patients: ["P1", "P2"] } });
    } finally { await c.close(); }
  });

  for (const [what, args] of [
    ["no genes", { genes: [] }],
    ["13 genes", { genes: Array.from({ length: 13 }, (_, i) => "G" + i) }],
    ["five groups", { genes: ["TP53"], groups: Array.from({ length: 5 }, (_, i) => ({ name: "g" + i, dsl: { a: { eventType: "X" }, rel: { type: "NONE" } } })) }],
  ] as [string, Record<string, unknown>][])
    test(`${what} is refused as an error result before anything is built`, async () => {
      const { specs, engine } = capture();
      const c = await connect(engine);
      try {
        const r = await c.call("render_oncoprint", args);
        assert.equal(r.isError, true);
        assert.match(textOf(r), /genes|groups/);
        assert.equal(specs.length, 0);
      } finally { await c.close(); }
    });

  test("an engine refusal (unknown profile, unknown study) comes back as an error result with its message", async () => {
    const c = await connect({ ...engineUnused, buildContract: async () => { throw new Error("unknown profile 'x'; this study has: mrna"); } });
    try {
      const r = await c.call("render_oncoprint", { genes: ["TP53"], heatmap: [{ profileType: "x" }] });
      assert.equal(r.isError, true);
      assert.match(textOf(r), /unknown profile 'x'; this study has: mrna/);
    } finally { await c.close(); }
  });
});

// ---------- hypothesis campaigns ----------

describe("hypothesis campaigns", () => {
  /** Engine stand-in: arm sizes per cohort name, and a compare row per gene for each half. */
  const P = { TP53: { discovery: 0.0005, validation: 0.004 }, KRAS: { discovery: 0.6, validation: 0.6 } } as Record<string, { discovery: number; validation: number }>;
  const runs: any[] = [];
  const run = async (doc: any) => {
    runs.push(doc);
    if (doc.study === "broken") throw new Error("no such study: broken");
    const part = JSON.stringify(doc).includes('"part":"validation"') ? "validation" : "discovery";
    const cohorts = Object.fromEntries(Object.keys(doc.cohorts).map((n) => [n, { count: n === "tiny" ? 3 : 200 }]));
    const views = (doc.views || []).map((v: any) => ({
      kind: "compare", cohorts: v.cohorts,
      rows: v.genes.map((gene: string) => ({ gene, pAny: P[gene][part as "discovery"], pDriver: null,
        cells: [{ cohort: v.cohorts[0], anyPct: 40, any: 40, profiled: 100 }, { cohort: v.cohorts[1], anyPct: 10, any: 10, profiled: 100 }] })),
    }));
    return { involvedStudies: [doc.study], oncokbPin: null, stats: { ms: 1 }, cohorts, views } as never;
  };
  const engine: Engine = { ...engineUnused, runAnalysis: run };
  const arm = (v: string) => ({ all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: [v] }] });
  const hyp = (gene: string, statement: string, first = "early", direction = "higher") => ({
    statement, rationale: "literature",
    doc: { study: "test_study", cohorts: { [first]: arm("A"), late: arm("B") }, views: [{ kind: "compare", genes: [gene], cohorts: [first, "late"] }] },
    primary: { view: 0, stat: "compare", gene }, direction,
  });

  let c: Awaited<ReturnType<typeof connect>>;
  before(async () => { await startPostgres(); c = await connect(engine); });
  after(async () => { await c.close(); });
  beforeEach(() => { runs.length = 0; });

  const idOf = (t: string) => /Campaign ([0-9a-f-]{36}) created/.exec(t)?.[1];

  test("campaign_create returns the campaign id, its fixed plan, its page and the hypothesis format", async () => {
    const t = textOf(await c.call("campaign_create", { question: "What predicts early failure?", study: "test_study" }));
    const id = idOf(t);
    assert.ok(id, t);
    assert.match(t, /created for test_study/);
    assert.ok(t.includes("/campaign/" + id));
    assert.match(t, /FDR 0\.1 .*replication p < 0\.05.*arms ≥ 25/);
    assert.ok(t.includes(HYPOTHESIS_GRAMMAR));
  });

  test("campaign_create without a study uses the default study", async () => {
    assert.match(textOf(await c.call("campaign_create", { question: "Any question here" })), /created for msk_chord_2024/);
  });

  test("campaign_create refuses a malformed study id and a too-short question", async () => {
    assert.match(textOf(await c.call("campaign_create", { question: "A real question", study: "bad id; drop" })), /^REJECTED: invalid study id/);
    const r = await c.call("campaign_create", { question: "abc" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /question/);
  });

  test("campaign_create refuses a study that does not exist, by name (invariant 1)", async () => {
    assert.match(textOf(await c.call("campaign_create", { question: "A real question", study: "no_such_study_anywhere" })),
      /REJECTED: .*unknown study 'no_such_study_anywhere'/);
  });

  test("campaign_check_hypothesis reports discovery-half sizes only, without running any view", async () => {
    const t = textOf(await c.call("campaign_check_hypothesis", { hypothesis: hyp("TP53", "TP53 is more often altered in early failure") }));
    assert.equal(t, 'TESTABLE. Discovery-half group sizes: {"early":200,"late":200}');
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].views, [], "checking runs no view, so it cannot see an outcome");
    assert.match(JSON.stringify(runs[0].cohorts), /"part":"discovery"/, "and only on the discovery half");
  });

  test("campaign_check_hypothesis: small arms, malformed hypotheses and engine refusals are NOT TESTABLE with the reason", async () => {
    const small = textOf(await c.call("campaign_check_hypothesis", { hypothesis: hyp("TP53", "tiny arm", "tiny") }));
    assert.match(small, /^NOT TESTABLE: "tiny" has 3 patients in the discovery half \(minimum 25\) \(sizes: \{"tiny":3,"late":200\}\)$/);
    const bad = { ...hyp("TP53", "wrong stat"), primary: { view: 0, stat: "survival" } };
    assert.match(textOf(await c.call("campaign_check_hypothesis", { hypothesis: bad })), /^NOT TESTABLE: primary\.stat is "survival" but view 0 is a compare view$/);
    const broken = hyp("TP53", "broken");
    delete (broken.doc as { study?: string }).study;
    assert.match(textOf(await c.call("campaign_check_hypothesis", { hypothesis: broken, study: "broken" })),
      /^NOT TESTABLE: rejected by the engine: no such study: broken/, "the study argument fills a document without one");
  });

  test("campaign_check_hypothesis without a hypothesis is an error result", async () => {
    const r = await c.call("campaign_check_hypothesis", {});
    assert.equal(r.isError, true);
    assert.match(textOf(r), /hypothesis/);
  });

  test("the whole workflow: register, lock, run, report — nulls included", async () => {
    const id = idOf(textOf(await c.call("campaign_create", { question: "What predicts early failure?", study: "test_study" })))!;

    const reg = textOf(await c.call("campaign_register", { campaign_id: id, hypotheses: [
      hyp("TP53", "TP53 is more often altered in early failure"),
      hyp("KRAS", "KRAS is more often altered in early failure"),
      hyp("TP53", "A tiny arm", "tiny"),
      { ...hyp("TP53", "Malformed"), primary: { view: 3, stat: "compare", gene: "TP53" } },
      hyp("TP53", "The same TP53 test, reworded"),
    ] }));
    assert.match(reg, /^Registered 3:/);
    assert.match(reg, /#1 testable \{(?=.*"early":200)(?=.*"late":200).*\}: TP53 is more often altered/);
    assert.match(reg, /#2 testable .*: KRAS/);
    assert.match(reg, /#3 UNTESTABLE — "tiny" has 3 patients.*: A tiny arm/, "a small arm stays on the record");
    assert.match(reg, /Rejected 2 \(fix and resubmit\):/);
    assert.match(reg, /"Malformed": primary\.view must index one of the document's views/);
    assert.match(reg, /"The same TP53 test, reworded": the same test is already registered as #1/);

    const researcher = textOf(await c.call("campaign_register", { campaign_id: id, source: "researcher",
      hypotheses: [hyp("KRAS", "KRAS lower in early failure", "early", "lower")] }));
    assert.match(researcher, /^Registered 1:\n {2}#4 testable/);
    assert.doesNotMatch(researcher, /Rejected/);

    const before = textOf(await c.call("campaign_report", { campaign_id: id }));
    assert.match(before, /status: draft/);
    assert.match(before, /Funnel: 4 registered → 3 testable → 0 tested/);

    const lock = textOf(await c.call("campaign_lock", { campaign_id: id }));
    assert.match(lock, /^Locked at \S+\. Receipt \(sha256 over every registered test\): [0-9a-f]{64}\n3 testable hypotheses will be run\.$/);

    assert.match(textOf(await c.call("campaign_register", { campaign_id: id, hypotheses: [hyp("EGFR", "late addition")] })),
      /^REJECTED: campaign is locked/, "nothing is added after the lock");
    assert.match(textOf(await c.call("campaign_lock", { campaign_id: id })), /^REJECTED: campaign is already locked/);

    const report = textOf(await c.call("campaign_run", { campaign_id: id }));
    assert.match(report, /status: complete/);
    assert.match(report, /Funnel: 4 registered → 3 testable → 3 tested → 1 nominal \(p<0\.05\) → 1 survived correction → 1 replicated/);
    assert.match(report, /#1 \[replicated\] TP53 is more often altered/);
    assert.match(report, /#2 \[not-supported\] KRAS is more often altered/);
    assert.match(report, /#3 \[untestable\] A tiny arm/);
    assert.match(report, /#4 \[not-supported\] KRAS lower in early failure \(researcher\)/);
    assert.ok(runs.some((d) => JSON.stringify(d.cohorts).includes('"part":"validation"')), "the survivor was replicated on the held-out half");

    assert.equal(textOf(await c.call("campaign_report", { campaign_id: id })), report, "the report reads back the same state");
  });

  test("an empty campaign cannot be locked, and a draft cannot be run", async () => {
    const id = idOf(textOf(await c.call("campaign_create", { question: "Nothing registered yet" })))!;
    assert.match(textOf(await c.call("campaign_lock", { campaign_id: id })), /^REJECTED: nothing to lock: no hypothesis is testable/);
    assert.match(textOf(await c.call("campaign_run", { campaign_id: id })), /^REJECTED: lock the campaign first/);
  });

  test("a campaign that does not exist is reported as such by every campaign tool", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    for (const tool of ["campaign_report", "campaign_lock", "campaign_run"])
      assert.equal(textOf(await c.call(tool, { campaign_id: missing })), "REJECTED: no such campaign: " + missing, tool);
    assert.equal(textOf(await c.call("campaign_register", { campaign_id: missing, hypotheses: [hyp("TP53", "x")] })), "REJECTED: no such campaign: " + missing);
    assert.equal(textOf(await c.call("campaign_report", { campaign_id: "not-an-id" })), "REJECTED: invalid campaign id");
  });

  test("register without hypotheses, or with too long an id, is an error result", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const empty = await c.call("campaign_register", { campaign_id: id, hypotheses: [] });
    assert.equal(empty.isError, true);
    assert.match(textOf(empty), /hypotheses/);
    const long = await c.call("campaign_report", { campaign_id: "x".repeat(41) });
    assert.equal(long.isError, true);
    assert.match(textOf(long), /campaign_id/);
  });
});
