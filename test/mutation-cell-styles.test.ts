// MUT-COL-6, MUT-COL-19 (docs/legacy-spec/05-mutations.md): the Protein Change cell's Germline tag and the MS cell's S/G badge
import { test } from "node:test";
import assert from "node:assert/strict";
import { proteinChangeCell, mutationStatusCell } from "../lib/mutation-cell-text.ts";
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS } from "../lib/mutation-table.ts";
import { renderViewCards } from "./support/render-views.ts";
import type { AnalysisDoc, AnalysisResult } from "../lib/types.ts";

test("P1 a somatic protein change is shown as is, untagged", () => {
  const c = proteinChangeCell("V600E", "Somatic");
  assert.equal(c.shown, "V600E");
  assert.equal(c.germline, false);
});

test("P2 a status matching /germline/i tags the protein change", () => {
  for (const s of ["Germline", "GERMLINE", "Germline_LOH"]) assert.equal(proteinChangeCell("V600E", s).germline, true, s);
});

test("P3 an empty, missing or other status does not tag it", () => {
  for (const s of ["", null, "LOH"]) assert.equal(proteinChangeCell("V600E", s).germline, false, String(s));
});

test("P4 TruncatedText's cut: 40 characters plus a buffer of 2 shown whole, longer cut to 40 and ...", () => {
  const c42 = "A".repeat(20) + "B".repeat(22);
  const c43 = "C".repeat(20) + "D".repeat(23);
  const a = proteinChangeCell(c42, "Somatic");
  assert.equal(a.shown, c42);
  assert.equal(a.full, c42);
  const b = proteinChangeCell(c43, "Somatic");
  assert.equal(b.shown, c43.slice(0, 40) + "...");
  assert.equal(b.full, c43);
});

test("S1 a status containing somatic is S with the raw value as tip", () => {
  for (const s of ["Somatic", "SOMATIC", "somatic_LOH"]) assert.deepEqual(mutationStatusCell(s), { kind: "somatic", text: "S", tip: s });
});

test("S2 a status containing germline is G with the raw value as tip", () => {
  for (const s of ["Germline", "germline", "Germline_LOH"]) assert.deepEqual(mutationStatusCell(s), { kind: "germline", text: "G", tip: s });
});

test("S3 somatic is checked before germline", () => {
  assert.deepEqual(mutationStatusCell("somatic germline"), { kind: "somatic", text: "S", tip: "somatic germline" });
});

test("S4 any other value is shown as written, without a tip", () => {
  for (const s of ["LOH", "Unknown"]) assert.deepEqual(mutationStatusCell(s), { kind: "other", text: s, tip: null });
});

test("S5 an empty or missing value is none", () => {
  for (const s of ["", null]) assert.equal(mutationStatusCell(s).kind, "none", String(s));
});

test("R1 the mutations card tags the germline row's protein change and badges each row's MS", () => {
  const shown = ["sample", "proteinChange", "status"];
  const row = (sample: string, change: string, status: string) => ({
    cohort: "Q", study: "s1", patient: sample, sample,
    values: MUTATION_COLUMNS.map((c) => c.id === "sample" ? sample : c.id === "proteinChange" ? change : c.id === "status" ? status : null),
  });
  const doc = { study: "s1", cohorts: { Q: { study: "s1" } }, views: [{ kind: "mutations", gene: "BRAF", cohorts: ["Q"], columns: shown }] } as unknown as AnalysisDoc;
  const result = {
    cohorts: { Q: { count: 2, samples: 2 } },
    views: [{ kind: "mutations", cohorts: ["Q"], mutations: {
      gene: "BRAF", columns: MUTATION_COLUMNS, shown, defaults: MUTATION_DEFAULT_COLUMNS, query: { columns: shown },
      rows: [row("S-GERM", "GERMX1", "Germline"), row("S-SOMA", "SOMAX2", "Somatic")],
      offset: 0, pageSize: 25, lists: [{ cohort: "Q", study: "s1", total: 2, all: 2 }], total: 2, all: 2,
    } }],
  } as unknown as AnalysisResult;
  const html = renderViewCards(doc, result);
  const rows = html.split(/<tr\b/).filter((s) => s.includes("S-GERM") || s.includes("S-SOMA"));
  const germ = rows.find((s) => s.includes("S-GERM"));
  const soma = rows.find((s) => s.includes("S-SOMA"));
  assert.ok(germ && soma, html.slice(0, 2000));
  assert.match(germ, /GERMX1[\s\S]*>Germline</);
  assert.doesNotMatch(soma, />Germline</);
  assert.match(germ, /data-tip="Germline"[^>]*>G</);
  assert.match(soma, /data-tip="Somatic"[^>]*>S</);
});

test("R2 the status column's header tip is Mutation Status", () => {
  assert.equal(MUTATION_COLUMNS.find((c) => c.id === "status")?.tip, "Mutation Status");
});
