// The exported .ipynb must be a notebook anyone's Jupyter will open, and it must carry
// everything it needs: no install, no network, no credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assembleContract } from "../lib/oncoprint-assemble.ts";
import { localInput, parseTsv } from "../lib/oncoprint-local.ts";
import { packContract } from "../lib/oncoprint-binary.ts";
import { unpackContract } from "../lib/oncoprint-binary.ts";
import { notebookStats, oncoprintNotebook } from "../lib/notebook.ts";

const FIX = "test/fixtures/oncoprint/";
const contract = () => assembleContract(localInput({
  events: parseTsv(readFileSync(FIX + "events.tsv", "utf8")), clinical: parseTsv(readFileSync(FIX + "clinical.tsv", "utf8")),
  coverage: parseTsv(readFileSync(FIX + "coverage.tsv", "utf8")), groupBy: "CANCER_TYPE", sort: "STAGE" }));

function pkg(): string {
  const dir = join("python", "cohortlab");
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir)) if (f.endsWith(".py") || f === "style.json") files["cohortlab/" + f] = readFileSync(join(dir, f), "utf8");
  return gzipSync(Buffer.from(JSON.stringify(files), "utf8")).toString("base64");
}

const build = (o: Partial<Parameters<typeof oncoprintNotebook>[0]> = {}) => {
  const c = contract();
  return oncoprintNotebook({
    spec: { study: "fixture", genes: ["TP53", "KRAS"] },
    contractB64: gzipSync(packContract(c)).toString("base64"),
    packageB64: pkg(), stats: notebookStats(c), origin: "https://cohort-lab.example", ...o
  }) as any;
};

test("it is nbformat 4, all cells well formed", () => {
  const nb = build();
  assert.equal(nb.nbformat, 4);
  assert.ok(nb.metadata.kernelspec.name === "python3");
  for (const c of nb.cells) {
    assert.ok(c.cell_type === "code" || c.cell_type === "markdown");
    assert.ok(Array.isArray(c.source) && c.source.length);
    if (c.cell_type === "code") { assert.deepEqual(c.outputs, []); assert.equal(c.execution_count, null); }
  }
  assert.ok(nb.cells.filter((c: any) => c.cell_type === "code").length >= 5);
});

test("the payload cell carries the package as committed", () => {
  const cell = build().cells.find((c: any) => String(c.source.join("")).includes("PACKAGE = "));
  const b64 = /PACKAGE = "([^"]+)"/.exec(cell.source.join(""))![1];
  const files = JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
  assert.ok(files["cohortlab/api.py"].includes("class Oncoprint"));
  // style.json is generated from lib/oncoprint-style.ts; without it the package cannot import
  assert.ok(files["cohortlab/style.json"].length > 100);
});

test("the payload cell carries this figure, and it unpacks to the same contract", () => {
  const c = contract();
  const cell = build().cells.find((x: any) => String(x.source.join("")).includes("CONTRACT = "));
  const b64 = /CONTRACT = "([^"]+)"/.exec(cell.source.join(""))![1];
  const raw = gunzipSync(Buffer.from(b64, "base64"));
  const back = unpackContract(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  assert.equal(back.n, c.columns.length);
  assert.deepEqual(back.tracks.map((t) => t.label), c.tracks.map((t) => t.label));
});

test("the spec travels too, so the notebook can ask the server for a fresh contract", () => {
  const nb = build({ spec: { study: "msk_chord_2024", genes: ["TP53"] } });
  assert.deepEqual(nb.metadata.cohortlab.spec, { study: "msk_chord_2024", genes: ["TP53"] });
  assert.ok(nb.cells.some((c: any) => c.source.join("").includes("from_server")));
});

test("a cut link says so in the notebook, not only on the page that made it", () => {
  const nb = build({ cut: "this link carries a cut of the figure — the first 1,000 of 40,000 ids" });
  assert.ok(nb.cells[0].source.join("").includes("the first 1,000 of 40,000 ids"));
  assert.ok(nb.metadata.cohortlab.cut);
});
