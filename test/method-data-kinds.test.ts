// The files a view's Python script reads (lib/method-data.ts), kind by kind: each is assembled
// from the view's own recorded queries exactly as the view assembled its numbers — rows summed
// across studies per cohort, a cohort profiled for a gene it never altered still listed, missing
// values never counted — and the default runner runs a recorded query on the instance that owns
// its study, wrapped in a row cap (the cap itself — a million rows — is too slow to
// trip in a unit test). The warehouse is a stand-in (setChTransport).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "CH_RUN_CACHE", "LOOPBACK_PEER", "STUDY_DENY"]) delete process.env[k];

const { setChTransport } = await import("../lib/ch.ts");
const { methodFiles, ExportRefused } = await import("../lib/method-data.ts");
type ViewResult = import("../lib/types.ts").ViewResult;

type Row = Record<string, unknown>;
const view = (kind: string, python: string, queries: { study: string; label: string; sql: string }[], extra: Row = {}): ViewResult => ({
  kind, cohorts: ["A", "B"], queries,
  method: { steps: [], implementation: { functions: [], file: "x.ts", commit: null }, python, check: {} },
  ...extra,
} as unknown as ViewResult);
const read = (...files: string[]) => files.map((f) => "pd.read_csv(\"" + f + "\")").join("\n");
/** a runner answering each recorded query by its SQL text */
const runner = (bySql: Record<string, Row[]>) => async (_study: string, sql: string) => bySql[sql] ?? [];
const lines = (csv: string) => csv.trimEnd().split("\n");

describe("Cox", () => {
  const fetch = (scope?: string) => ({ kind: "fetch", title: "Fetch", detail: "rows", scope });
  test("one file per fitted cohort, named from the cohort, each row tagged with its study", async () => {
    const v = view("cox", read("cox_rows_Smokers_2.csv", "cox_rows_Never.csv"), [
      { study: "s1", label: "coxRows:a", sql: "q1" },
      { study: "s2", label: "coxRows:b", sql: "q2" },
      { study: "s1", label: "coxRows:c", sql: "q3" },
      { study: "s1", label: "other", sql: "ignored" },
    ]);
    v.method!.steps = [fetch("Smokers (2) · s1"), fetch("Smokers (2) · s2"), fetch("Never · s1")] as never;
    const { files, missing } = await methodFiles(v, runner({ q1: [{ t: 1, e: 1 }], q2: [{ t: 2, e: 0 }], q3: [{ t: 3, e: 1 }] }));
    assert.deepEqual(missing, []);
    assert.deepEqual(lines(files["cox_rows_Smokers_2.csv"]), ["study,t,e", "s1,1,1", "s2,2,0"]);
    assert.deepEqual(lines(files["cox_rows_Never.csv"]), ["study,t,e", "s1,3,1"]);
  });
  test("a single fitted cohort without a scope is cox_rows.csv, a header even with no rows", async () => {
    const v = view("cox", read("cox_rows.csv"), [{ study: "s1", label: "coxRows:x", sql: "q" }]);
    v.method!.steps = [fetch()] as never;
    const { files } = await methodFiles(v, runner({}));
    assert.equal(files["cox_rows.csv"], "study\n");
  });
  test("fetch steps that do not line up with the queries are refused, not guessed at", async () => {
    const v = view("cox", read("cox_rows.csv"), [{ study: "s1", label: "coxRows:x", sql: "q" }]);
    v.method!.steps = [fetch(), fetch()] as never;
    await assert.rejects(methodFiles(v, runner({})), (e: unknown) => e instanceof ExportRefused && e.status === 422 && /do not line up/.test(e.message));
  });
});

describe("aggregate kinds", () => {
  test("differential expression sums each cohort's moments per gene across studies", async () => {
    const v = view("diffexpr", read("diffexpr_moments.csv"), [
      { study: "s1", label: "diffexpr:moments:A", sql: "a1" },
      { study: "s2", label: "diffexpr:moments:A", sql: "a2" },
      { study: "s1", label: "diffexpr:moments:B", sql: "b1" },
      { study: "s1", label: "diffexpr:other", sql: "skip" },
    ]);
    const { files } = await methodFiles(v, runner({
      a1: [{ gene: "TP53", n: 2, sx: 3, sxx: 5 }], a2: [{ gene: "TP53", n: "1", sx: "1.5", sxx: "2.25" }, { gene: "EGFR", n: 1, sx: 1, sxx: 1 }],
      b1: [{ gene: "TP53", n: 4, sx: 4, sxx: 4 }], skip: [{ gene: "X", n: 99, sx: 0, sxx: 0 }],
    }));
    assert.deepEqual(lines(files["diffexpr_moments.csv"]), ["cohort,gene,n,sx,sxx", "A,TP53,3,4.5,7.25", "A,EGFR,1,1,1", "B,TP53,4,4,4"]);
  });

  test("enrichment: profiled is panel samples plus whole-exome samples, never below altered, and an unaltered cohort is still listed", async () => {
    const v = view("enrichment", read("enrichment_counts.csv"), [
      { study: "s1", label: "enrichment:altered:A", sql: "alt" },
      { study: "s1", label: "enrichment:panels:A", sql: "pan" },
      { study: "s1", label: "enrichment:wes:A", sql: "wesA" },
      { study: "s1", label: "enrichment:panels:B", sql: "panB" },
      { study: "s1", label: "enrichment:wes:B", sql: "wesB" },
      { study: "s1", label: "something:else", sql: "skip" },
    ]);
    const { files } = await methodFiles(v, runner({
      alt: [{ gene: "KRAS", altered: 7 }, { gene: "TP53", altered: 30 }],
      pan: [{ gene: "KRAS", profiled: 10 }],
      wesA: [{ n: 5 }],
      panB: [{ gene: "KRAS", profiled: 4 }],
      wesB: [{ n: 8 }],
    }));
    assert.deepEqual(lines(files["enrichment_counts.csv"]), [
      "cohort,gene,altered,profiled",
      "A,KRAS,7,15",
      "A,TP53,30,30", // 0 panel + 5 WES is fewer than the 30 altered
      "B,KRAS,0,12",
      "B,TP53,0,8",
    ]);
  });

  test("assays: moments and called-value counts are summed across studies; a missing value is never a category", async () => {
    const v = view("assays", read("assays_moments.csv", "assays_counts.csv"), [
      { study: "s1", label: "assays:moments:A", sql: "m1" },
      { study: "s2", label: "assays:moments:A", sql: "m2" },
      { study: "s1", label: "assays:values:A", sql: "v1" },
      { study: "s2", label: "assays:values:A", sql: "v2" },
      { study: "s1", label: "assays:other:A", sql: "skip" },
    ]);
    const { files, missing } = await methodFiles(v, runner({
      m1: [{ entity: "PD-L1", n: 2, sx: 4, sxx: 10 }], m2: [{ entity: "PD-L1", n: 1, sx: 1, sxx: 1 }],
      v1: [{ entity: "MSI", value: " High ", n: 3 }, { entity: "MSI", value: "NA", n: 50 }, { entity: "MSI", value: null, n: 9 }],
      v2: [{ entity: "MSI", value: "High", n: 2 }, { entity: "MSI", value: "nan", n: 1 }, { entity: "MSI", value: "Low", n: 4 }],
    }));
    assert.deepEqual(missing, []);
    assert.deepEqual(lines(files["assays_moments.csv"]), ["cohort,entity,n,sx,sxx", "A,PD-L1,3,5,11"]);
    assert.deepEqual(lines(files["assays_counts.csv"]), ["cohort,entity,value,n", "A,MSI,High,5", "A,MSI,Low,4"]);
  });

  test("assays builds only the files the script reads", async () => {
    const v = view("assays", read("assays_counts.csv"), [{ study: "s1", label: "assays:moments:A", sql: "m1" }]);
    const { files } = await methodFiles(v, runner({ m1: [{ entity: "X", n: 1, sx: 1, sxx: 1 }] }));
    assert.deepEqual(Object.keys(files), ["assays_counts.csv"]);
  });

  test("composition: each group's per-part moments summed over its studies; a group with no rows is listed with zeros", async () => {
    const v = view("composition", read("composition_moments.csv"), [
      { study: "s1", label: "composition:moments:A", sql: "c1" },
      { study: "s2", label: "composition:moments:A", sql: "c2" },
      { study: "s1", label: "not:composition", sql: "skip" },
    ], { composition: { parts: [{ id: "T" }, { id: "B" }], groups: [{ cohort: "A" }, { cohort: "B" }] } });
    const { files } = await methodFiles(v, runner({
      c1: [{ n: 2, sx: [0.5, 1.5], sxx: [0.25, 1.25] }],
      c2: [{ n: 0, sx: null, sxx: null }, { n: 1, sx: ["0.5", "0.5"], sxx: ["0.25", "0.25"] }],
    }));
    assert.deepEqual(lines(files["composition_moments.csv"]), [
      "cohort,part,n,sx,sxx", "A,T,3,1,0.5", "A,B,3,2,1.5", "B,T,0,0,0", "B,B,0,0,0",
    ]);
  });

  test("a composition view that was not drawn has nothing to rebuild, and says so", async () => {
    const v = view("composition", read("composition_moments.csv"), [{ study: "s1", label: "composition:moments:A", sql: "c1" }]);
    const { files, missing } = await methodFiles(v, runner({}));
    assert.deepEqual(files, {});
    assert.deepEqual(missing, ["composition_moments.csv"]);
  });

  test("correlates: the per-study sums in the script's column order, extra columns dropped", async () => {
    const v = view("correlates", read("correlates_sums.csv"), [
      { study: "s1", label: "correlates:moments", sql: "x" }, { study: "s2", label: "correlates:moments", sql: "y" },
    ]);
    const r = { gene: "G", n: 3, sx: 1, sy: 2, sxy: 3, sxx: 4, syy: 5, rsx: 6, rsy: 7, rsxy: 8, rsxx: 9, rsyy: 10, junk: "z" };
    const { files } = await methodFiles(v, runner({ x: [r], y: [{ ...r, gene: "H" }] }));
    assert.deepEqual(lines(files["correlates_sums.csv"]), [
      "study,gene,n,sx,sy,sxy,sxx,syy,rsx,rsy,rsxy,rsxx,rsyy", "s1,G,3,1,2,3,4,5,6,7,8,9,10", "s2,H,3,1,2,3,4,5,6,7,8,9,10",
    ]);
  });

  test("a view without queries still gets a header-only file", async () => {
    const v = view("logistic", read("logistic_rows.csv"), []);
    delete (v as unknown as Row).queries;
    const { files } = await methodFiles(v, runner({}));
    assert.equal(files["logistic_rows.csv"], "study\n");
  });
});

describe("the default runner", () => {
  const sent: string[] = [];
  setChTransport(async ({ query }) => {
    sent.push(query);
    const data = /cancer_study/.test(query) ? [{ id: "s1", name: "Study one" }]
      : [{ y: 1, c0: 2 }];
    return JSON.stringify({ meta: [], data, rows: data.length });
  });
  after(() => setChTransport(null));

  test("runs the recorded query on the study's own instance, wrapped in a row cap", async () => {
    const v = view("logistic", read("logistic_rows.csv"), [{ study: "s1", label: "logisticRows", sql: "SELECT y, c0 FROM t" }]);
    const { files } = await methodFiles(v);
    assert.deepEqual(lines(files["logistic_rows.csv"]), ["study,y,c0", "s1,1,2"]);
    const q = sent.find((s) => s.includes("SELECT y, c0 FROM t"))!;
    assert.match(q, /^SELECT \* FROM \(\nSELECT y, c0 FROM t\n\) LIMIT 1000001/);
  });

});
