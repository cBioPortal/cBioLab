// The site's WebMCP tools, run against stand-ins for the browser and the page: registration,
// window.cohortLab, and the analysis page's edit discipline (engine first, page only on accept).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// a stand-in for Chrome's WebMCP origin trial, and the globals a page has
const registered = new Map<string, any>();
(globalThis as any).window = globalThis;
(globalThis as any).document = { modelContext: {
  registerTool: (t: any) => { if (registered.has(t.name)) throw new Error("duplicate"); registered.set(t.name, t); },
  unregisterTool: (n: string) => registered.delete(n)
} };

const { exposeTools } = await import("../lib/webmcp.ts");
const { installLabTools } = await import("../app/lab/agent-tools.ts");
const { analysisText } = await import("../lib/result-text.ts");

const text = async (name: string, args: any = {}) => (await registered.get(name).execute(args)).content[0].text as string;

describe("exposeTools: one tool list, two ways in", () => {
  test("registers with WebMCP, publishes window.cohortLab, and cleans both up", async () => {
    const t = exposeTools("test", [{ name: "echo", description: "echo it", inputSchema: {}, run: async (a: any) => a.x }], { echo: (x: string) => x });
    assert.equal(t.webmcp, true);
    assert.ok(registered.has("echo"));
    assert.equal(await (globalThis as any).cohortLab.call("echo", { x: "hi" }), "hi");
    assert.match((globalThis as any).cohortLab.help(), /test page[\s\S]*echo: echo it/);
    assert.equal(await text("echo", { x: "via webmcp" }), "via webmcp");
    t.cleanup();
    assert.equal(registered.has("echo"), false);
    assert.equal((globalThis as any).cohortLab, undefined);
  });
  test("a thrown error comes back as a REJECTED result, not an exception", async () => {
    const t = exposeTools("test", [{ name: "boom", description: "", inputSchema: {}, run: async () => { throw new Error("nope"); } }], {});
    const r = await registered.get("boom").execute({});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /^REJECTED: nope/);
    t.cleanup();
  });
});

// ---- the analysis page, with a fake bridge ------------------------------------------------
const cohort = (count: number) => ({ count, text: "", studies: ["s1"], sql: "" });
function fakePage() {
  const page: any = {
    doc: { study: "s1", cohorts: { a: { all: [] } }, views: [] },
    result: null, busy: false, error: null, tab: "analysis", study: "s1", savedAs: null,
    commits: 0,
    // the "engine": rejects any view of kind "bad", errors any compare view on gene "ERR"
    validate: async (d: any) => {
      if ((d.views || []).some((v: any) => v.kind === "bad")) throw new Error("unknown view kind bad");
      return { study: "s1", involvedStudies: ["s1"], oncokbPin: null, stats: { ms: 1 }, params: {},
        cohorts: Object.fromEntries(Object.keys(d.cohorts).map((n) => [n, cohort(n === "empty" ? 0 : 100)])),
        views: (d.views || []).map((v: any) => v.genes?.includes("ERR") ? { kind: v.kind, error: "no such gene ERR" } : { kind: v.kind, rows: [] }) };
    },
    commit: (d: any, r: any) => { page.doc = d; page.result = r; page.commits++; },
    goTab: () => {}, runExample: () => {}, save: async () => {}, link: () => "link"
  };
  return page;
}

describe("analysis tools: the engine decides, the page follows", () => {
  let page: any, t: any;
  beforeEach(() => { t?.cleanup(); page = fakePage(); t = installLabTools(() => page); });

  test("an accepted edit reaches the page", async () => {
    const r = await text("analysis_add_view", { view: { kind: "compare", genes: ["TP53"] } });
    assert.match(r, /applied/);
    assert.equal(page.doc.views[0].kind, "compare");
  });
  test("an engine rejection leaves the page untouched", async () => {
    const before = page.doc;
    const r = await text("analysis_add_view", { view: { kind: "bad" } });
    assert.match(r, /REJECTED by the engine, page unchanged — unknown view kind bad/);
    assert.equal(page.doc, before);
    assert.equal(page.commits, 0);
  });
  test("an error in the view the edit touched rejects it; one elsewhere does not", async () => {
    await text("analysis_add_view", { view: { kind: "compare", genes: ["ERR"] } }).then((r) => assert.match(r, /REJECTED, page unchanged — view 0 \(compare\): no such gene ERR/));
    assert.equal(page.commits, 0);
  });
  test("a cohort matching nobody is applied, with a warning", async () => {
    const r = await text("analysis_set_cohort", { name: "empty", definition: { all: [] } });
    assert.match(r, /applied[\s\S]*WARNING: "empty" matches 0 patients/);
  });
  test("removing a cohort drops it from views that listed it", async () => {
    page.doc = { study: "s1", cohorts: { a: { all: [] }, b: { all: [] } }, views: [{ kind: "survival", cohorts: ["a", "b"] }] };
    await text("analysis_remove_cohort", { name: "b" });
    assert.deepEqual(page.doc.views[0].cohorts, ["a"]);
  });
  test("update_view merges, and null removes a key", async () => {
    page.doc = { ...page.doc, views: [{ kind: "survival", endpoint: "OS", cohorts: ["a"] }] };
    await text("analysis_update_view", { index: 0, patch: { endpoint: "PFS", cohorts: null } });
    assert.deepEqual(page.doc.views[0], { kind: "survival", endpoint: "PFS" });
  });
  test("a bad index is refused with the valid range", async () => {
    assert.match(await text("analysis_remove_view", { index: 3 }), /no view 3: the document has 0/);
  });
  test("undo walks back through the assistant's edits", async () => {
    // the history is page-wide on purpose (it survives a remount), so empty what earlier tests left
    while (!/Nothing to undo/.test(await text("analysis_undo"))) { /* drain */ }
    page = fakePage(); t.cleanup(); t = installLabTools(() => page);
    const start = page.doc;
    await text("analysis_add_view", { view: { kind: "survival" } });
    await text("analysis_add_view", { view: { kind: "compare", genes: ["TP53"] } });
    assert.equal(page.doc.views.length, 2);
    await text("analysis_undo");
    assert.equal(page.doc.views.length, 1);
    await text("analysis_undo");
    assert.deepEqual(page.doc, start);
    assert.match(await text("analysis_undo"), /Nothing to undo/);
  });
});

describe("the shared result text", () => {
  test("survival reports its log-rank test", () => {
    const out = analysisText({ study: "s1", cohorts: {}, views: [{ kind: "survival" }] } as any, {
      study: "s1", involvedStudies: ["s1"], oncokbPin: null, stats: { ms: 1 }, cohorts: {},
      views: [{ kind: "survival", curves: [{ cohort: "a", points: [], median: 10, n: 50, events: 20 }], logrank: { chi2: 5, p: 0.025, df: 1, observed: [], expected: [], variance: 1, strata: 1 }, caveat: "c" }]
    } as any);
    assert.match(out.join("\n"), /log-rank p=0\.0250/);
  });
  test("an oncoprint the page draws itself is described, not skipped", () => {
    const out = analysisText({ study: "s1", cohorts: {}, views: [{ kind: "oncoprint" }] } as any, {
      study: "s1", involvedStudies: ["s1"], oncokbPin: null, stats: { ms: 1 }, cohorts: {},
      views: [{ kind: "oncoprint", cohorts: ["a"], spec: { genes: ["TP53", "KRAS"] } }]
    } as any);
    assert.match(out.join("\n"), /Oncoprint of 2 gene track\(s\) across a — drawn in the page/);
  });
});
