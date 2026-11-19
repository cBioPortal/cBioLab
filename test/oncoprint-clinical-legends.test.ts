// The OncoPrint's clinical-track legends, as the portal's View menu (cbioportal-frontend cd8c6df
// ResultsViewOncoprint.tsx 304-313, OncoprintControls.tsx 1100-1145, OncoprintUtils.ts 1385-1388):
//
// | ID  | rule                                                                                                     |
// |-----|----------------------------------------------------------------------------------------------------------|
// | CL1 | "Show legends for clinical tracks" (on by default): off drops the clinical keys, never the gene legend     |
// | CL2 | "Only show clinical track legends for altered patients / samples": a track's key lists only the values of |
// |     | the columns altered in some gene row (altered_uids = alteredKeys)                                        |
// | CL3 | the second applies only with the first on (onlyShowClinicalLegendForAlteredCases = both)                 |
// | CL1 | (ours) a heatmap row is not a clinical track: its key stays                                             |
// | CL4 | the engine's display takes "all" (default), "altered", "none"; anything else is refused                  |
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleContract, normalizeDisplay } from "../lib/oncoprint-assemble.ts";
import { localInput, parseTsv } from "../lib/oncoprint-local.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { alteredColumns, clinicalLegend } from "../lib/oncoprint-style.ts";

const FIX = "test/fixtures/oncoprint/";
const contract = (clinicalLegends?: "all" | "altered" | "none") => assembleContract(localInput({
  events: parseTsv(readFileSync(FIX + "events.tsv", "utf8")), clinical: parseTsv(readFileSync(FIX + "clinical.tsv", "utf8")),
  coverage: parseTsv(readFileSync(FIX + "coverage.tsv", "utf8")), groupBy: "CANCER_TYPE", sort: "STAGE",
  ...(clinicalLegends ? { display: { clinicalLegends } } : {}) }));
// the STAGE key under the figure: the text after its last label (the first is the track's own row label); null without one
const stageKey = (svg: string) => { const n = svg.split(">STAGE<").length - 1; return n < 2 ? null : svg.slice(svg.lastIndexOf(">STAGE<")); };

test("CL2: the altered columns are those some gene row alters (P01-P07 of the fixture; P08 holds only a gain, not drawn)", () => {
  const c = contract();
  assert.deepEqual(alteredColumns(c.tracks).map((i) => c.columns[i]).sort(), ["P01", "P02", "P03", "P04", "P05", "P06", "P07"]);
});

test("CL2: a track's key over the altered columns leaves out what only the unaltered hold (P12's missing STAGE)", () => {
  const c = contract(), stage = c.tracks.find((t) => t.label === "STAGE")!;
  const all = clinicalLegend(stage), altered = clinicalLegend(stage, undefined, undefined, alteredColumns(c.tracks));
  assert.ok(all.kind === "categories" && all.entries.some((e) => e.noData), "every column: No data (P12)");
  assert.ok(altered.kind === "categories" && !altered.entries.some((e) => e.noData), "altered columns: no No data");
  assert.deepEqual(altered.kind === "categories" && altered.entries.map((e) => e.label), ["I", "II", "III", "IV"]);
});

test("CL1, CL2: the server SVG draws every key, the altered columns' keys, or none — the gene legend always", () => {
  const all = contractToSvg(contract(), 800), alt = contractToSvg(contract("altered"), 800), none = contractToSvg(contract("none"), 800);
  assert.match(stageKey(all)!, /No data/);
  assert.doesNotMatch(stageKey(alt)!, /No data/);
  assert.equal(stageKey(none), null);
  for (const svg of [all, alt, none]) assert.match(svg, /Missense Mutation/, "the gene legend");
});

test("CL1: off drops the clinical keys only: a heatmap row keeps its key", () => {
  const c = contract("none"), age = c.tracks.find((t) => t.label === "AGE")!;
  c.tracks.push({ ...age, kind: "heatmap", label: "HM_ROW", profileType: "mrna", note: "z-scores" } as never);
  const svg = contractToSvg(c, 800);
  assert.equal(svg.split(">HM_ROW<").length - 1, 2, "its row label and its key");
  assert.equal(stageKey(svg), null);
});

test("CL4: the engine takes all, altered and none", () => {
  assert.equal(normalizeDisplay({}).clinicalLegends, "all");
  assert.equal(normalizeDisplay({ clinicalLegends: "altered" }).clinicalLegends, "altered");
  assert.equal(normalizeDisplay({ clinicalLegends: "none" }).clinicalLegends, "none");
  assert.throws(() => normalizeDisplay({ clinicalLegends: "some" } as never), /clinicalLegends/);
});
