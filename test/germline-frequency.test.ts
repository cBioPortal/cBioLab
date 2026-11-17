// The Mutations tab's germline mutation frequency (spec-germline G1, G2, G9a): a site's
// lollipopTotalsSql germline_samples arrives in LollipopReport.totals[].germlineSamples,
// buildLollipopGene sums it over sites like somaticSamples, and GeneSummary
// (app/_lollipop/HotspotsBody.tsx) shows "Germline Mutation Frequency" only when it is above zero.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { buildLollipopGene } from "../lib/lollipop.ts";
import { lollipopTotalsSql } from "../lib/federation.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

register("./support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { HotspotsBody } = await import("../app/_lollipop/HotspotsBody.tsx");

/** a field the change adds, read without the type knowing it yet */
const field = (o: unknown, k: string): unknown => (o as Record<string, unknown> | undefined)?.[k];

const report = (somaticSamples: number, germlineSamples: number | undefined, cohortSamples: number) => ({
  changes: [{ gene: "PTEN", pos: 92, change: "D92N", n: 3, rows: 3, driver: true, impact: "missense" }],
  types: [{ gene: "PTEN", pos: 92, mtype: "Missense_Mutation", driver: true, rows: 3 }],
  totals: [{ gene: "PTEN", patients: 3, pairs: 3, somaticSamples, ...(germlineSamples === undefined ? {} : { germlineSamples }) }],
  cohortSamples, minCount: 1, annotated: true,
});
const PROTEIN = { proteinLength: 403, transcriptId: "ENST00000371953", domains: [], ids: { refseq: "NM_000314", ensembl: "ENST00000371953.3" } };

test("G1 lollipopTotalsSql selects a germline_samples column", () => {
  const sql: string = lollipopTotalsSql("SELECT 1", ["PTEN"], "s");
  assert.match(sql, /\bAS germline_samples\b/);
  assert.match(sql, /\bAS somatic_samples\b/, "the somatic column stays");
});

test("G1 buildLollipopGene sums germlineSamples over sites, like somaticSamples", () => {
  const g = buildLollipopGene("PTEN", [report(1, 2, 30), report(2, 3, 29)] as never, PROTEIN);
  assert.equal(field(g, "germlineSamples"), 5);
  assert.equal(g.somaticSamples, 3, "somaticSamples unchanged");
  assert.equal(g.cohortSamples, 59);
});

test("G2 a gene with no germline row: germlineSamples 0, also from a site that sends none (older code)", () => {
  assert.equal(field(buildLollipopGene("PTEN", [report(3, 0, 59)] as never, PROTEIN), "germlineSamples"), 0);
  assert.equal(field(buildLollipopGene("PTEN", [report(3, undefined, 59)] as never, PROTEIN), "germlineSamples"), 0);
  assert.equal(field(buildLollipopGene("PTEN", [report(1, 2, 30), report(2, undefined, 29)] as never, PROTEIN), "germlineSamples"), 2);
});

const card = (g: HotspotGene) => renderToStaticMarkup(createElement(HotspotsBody, {
  v: { kind: "hotspots", note: "the method caption", hotspots: [g] } as never, onHide: () => {}, onCodons: () => {} }));
const withGermline = (n: number): HotspotGene => ({ ...buildLollipopGene("PTEN", [report(3, n, 59)] as never, PROTEIN), germlineSamples: n } as HotspotGene);

test("G9a GeneSummary shows the germline frequency when germlineSamples > 0", async (t) => {
  const html = card(withGermline(4));
  await t.test("the line and its value over cohortSamples, formatted as the somatic one", () => {
    assert.match(html, /Somatic Mutation Frequency<\/span> <b>5\.1%<\/b>/, "the somatic line, for its format");
    assert.match(html, /Germline Mutation Frequency<\/span> <b>6\.8%<\/b>/);
  });
  await t.test("its tip names the gene", () => {
    assert.match(html, /data-tip="[^"]*germline mutation in PTEN"/);
    assert.match(html, /data-tip="4 of 59 samples carry a germline mutation in PTEN"/);
  });
});

test("G9a GeneSummary shows no germline line when germlineSamples is 0", () => {
  const html = card(withGermline(0));
  assert.match(html, /Somatic Mutation Frequency/);
  assert.doesNotMatch(html, /Germline Mutation Frequency/);
  assert.doesNotMatch(html, /germline mutation in/);
});
