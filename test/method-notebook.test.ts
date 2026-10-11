// The method-record notebook: the files its script reads are rebuilt from the view's own recorded
// queries, a view with rows from a federated peer is refused, and the notebook is bounded in size.
import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { ExportRefused, hasRemoteRows, methodFiles, wantedFiles, MAX_CSV_CHARS } from "../lib/method-data.ts";
import { methodNotebook, importedModules, NOTEBOOK_MAX_BYTES } from "../lib/method-notebook.ts";
import type { ViewResult } from "../lib/types.ts";

const SCRIPT = [
  "import pandas as pd", "import statsmodels.api as sm", "", "RESULT = {}",
  "df = pd.read_csv(\"logistic_rows.csv\")", "RESULT[\"a\"] = 1.0", "",
  "# for the check that this script reproduces the view (scripts/check-method-scripts.ts)",
  "print(\"METHOD_RESULT \" + str(RESULT))",
].join("\n");

const view = (o: Partial<ViewResult> = {}): ViewResult => ({
  kind: "logistic", cohorts: ["A", "B"],
  queries: [{ study: "s1", label: "logisticRows", sql: "SELECT 1 AS y, 2 AS c0" }],
  method: { steps: [{ kind: "fetch", title: "Fetch", detail: "rows" }], implementation: { functions: [], file: "x.ts", commit: null },
    python: SCRIPT, check: { a: { v: 1 } } },
  ...o,
} as ViewResult);

const run = async (study: string, sql: string) => {
  assert.equal(study, "s1"); assert.match(sql, /SELECT 1/);
  return [{ y: 1, c0: "a,b" }, { y: 0, c0: "c" }];
};

test("a script's unembedded inputs are the pd.read_csv files it names", () => {
  assert.deepEqual(wantedFiles(SCRIPT), ["logistic_rows.csv"]);
  assert.deepEqual(wantedFiles("df = pd.read_csv(io.StringIO(\"x\"))"), []);
  assert.deepEqual(importedModules(SCRIPT), ["pandas", "statsmodels"]);
});

test("the files are built from the view's recorded queries, quoting values that need it", async () => {
  const { files, missing } = await methodFiles(view(), run);
  assert.deepEqual(missing, []);
  assert.equal(files["logistic_rows.csv"], "study,y,c0\ns1,1,\"a,b\"\ns1,0,c\n");
});

test("a view whose script carries its own input needs no files, even with remote queries", async () => {
  const v = view({ queries: [{ study: "p", label: "geneCounts", sql: "x", remote: true }], method: { ...view().method!, python: "RESULT = {}" } });
  assert.deepEqual(await methodFiles(v, run), { files: {}, missing: [] });
});

test("rows from a federated peer are refused", async () => {
  const remote = view({ queries: [{ study: "s1", label: "logisticRows", sql: "x", remote: true }] });
  assert.equal(hasRemoteRows(remote), true);
  await assert.rejects(methodFiles(remote, run), (e: unknown) => e instanceof ExportRefused && e.status === 403 && /federated/.test(e.message));
  const viaParticipation = view({ participation: { studies: [{ study: "p", mode: "aggregate-only", instance: "peer", remote: true }], requiresPatientLevel: false, aggregateOnly: ["p"] } });
  await assert.rejects(methodFiles(viaParticipation, run), (e: unknown) => e instanceof ExportRefused && e.status === 403);
});

test("a kind whose file no recorded query can rebuild is reported, not shipped broken", async () => {
  const v = view({ kind: "compare", method: { ...view().method!, python: "df = pd.read_csv(\"geneCounts.csv\")" } });
  assert.deepEqual(await methodFiles(v, run), { files: {}, missing: ["geneCounts.csv"] });
});

test("too much data is refused with the limit named", async () => {
  const big = async () => [{ y: 1, c0: "x".repeat(MAX_CSV_CHARS) }];
  await assert.rejects(methodFiles(view(), big), (e: unknown) => e instanceof ExportRefused && e.status === 413);
});

const build = (files: Record<string, string>) => methodNotebook({
  view: view(), method: view().method!, files, missing: [], doc: { study: "s1" }, viewIndex: 0, origin: "http://x" }) as any;

test("the notebook is nbformat 4.5 with unique cell ids, installs only what the script imports, and ends in a check", () => {
  const nb = build({ "logistic_rows.csv": "study,y\ns1,1\n" });
  assert.equal(nb.nbformat, 4); assert.equal(nb.nbformat_minor, 5);
  const ids = nb.cells.map((c: any) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const src = (c: any) => c.source.join("");
  const setup = nb.cells.find((c: any) => c.cell_type === "code" && /TESTED =/.test(src(c)));
  assert.match(src(setup), /"statsmodels"/); assert.match(src(setup), /"pandas"/); assert.doesNotMatch(src(setup), /lifelines/);
  const script = nb.cells.find((c: any) => c.cell_type === "code" && /read_csv/.test(src(c)) && !/PAYLOAD/.test(src(c)));
  assert.doesNotMatch(src(script), /METHOD_RESULT/);
  assert.match(src(nb.cells.at(-2)) + src(nb.cells.at(-1)), /numbers match/);
});

test("the embedded data round-trips", () => {
  const nb = build({ "logistic_rows.csv": "study,y\ns1,1\n" });
  const cell = nb.cells.find((c: any) => /PAYLOAD = /.test(c.source.join(""))).source.join("");
  const b64 = /PAYLOAD = "([^"]+)"/.exec(cell)![1];
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString()), { "logistic_rows.csv": "study,y\ns1,1\n" });
});

test("a notebook over the size limit is refused", () => {
  // incompressible data, so the gzipped payload is itself over the limit
  const noise = randomBytes(NOTEBOOK_MAX_BYTES).toString("base64");
  assert.throws(() => build({ "logistic_rows.csv": noise }), (e: unknown) => e instanceof ExportRefused && e.status === 413 && /limit/.test(e.message));
});
