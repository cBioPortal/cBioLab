// The style is data shared by every renderer. These checks pin the rule that turns a cell
// into layers, and fail when the generated Python copy has drifted from the source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STYLE, cellLayers, formatPct, formatGutterPct, geneLegend, glyphPresence, numericColor, resolveStyle, styleForDisplay, trackCategoryColor, trackLabelText, trackTooltipLines } from "../lib/oncoprint-style.ts";
import { assembleContract, mutClassBit, type AssembleInput } from "../lib/oncoprint-assemble.ts";
import { STYLE_JSON } from "../scripts/gen-style.ts";
import { bucketCodes, bucketEdges } from "../lib/oncoprint-lod.ts";

const B = STYLE.bits;

test("python/cohortlab/style.json is the generated copy of lib/oncoprint-style.ts", () => {
  assert.equal(readFileSync("python/cohortlab/style.json", "utf8"), STYLE_JSON, "run: npm run style:gen");
});

test("cell layers: base, CNA, mRNA outline, protein bars, SV band, one mutation by priority — the portal's", () => {
  assert.deepEqual(cellLayers(0, STYLE).map((l) => l.color), [STYLE.palette.unaltered]);
  assert.equal(STYLE.palette.unaltered, "#bebebe", "the portal's grey");
  assert.equal(cellLayers(-1, STYLE).length, 2, "not profiled = white + a thin grey line");
  const both = cellLayers(B.MISSENSE | B.TRUNCATING | B.MUT_DRIVER | B.DRIVER, STYLE);
  assert.equal(both.length, 2);
  assert.equal(both[1].color, "#000000", "truncating outranks missense when both are present");
  const stack = cellLayers(B.AMP | B.MRNA_HIGH | B.PROT_LOW | B.SV | B.SV_DRIVER | B.SPLICE | B.MUT_DRIVER | B.DRIVER, STYLE);
  assert.deepEqual(stack.map((l) => l.color), [STYLE.palette.unaltered, "#ff0000", "#ff9999", "#00e1ff", "#8b00c9", "#e5802b"]);
  assert.equal(stack[2].stroke, 2, "mRNA is an outline so what is under it still shows");
  assert.deepEqual(stack[4].band, [0.2, 0.8]);
  assert.deepEqual(stack[3].band, [0.8, 1], "protein low is a bar at the bottom");
  assert.deepEqual(stack[5].band, [1 / 3, 2 / 3]);
});

test("driver and VUS are each glyph's own: a different colour per pair, CNA one colour, no fading", () => {
  const vus = cellLayers(B.AMP | B.SPLICE, STYLE);
  assert.deepEqual(vus.map((l) => l.color), [STYLE.palette.unaltered, "#ff0000", "#f0b87b"], "a copy number change has one colour whatever its annotation");
  assert.ok(vus.every((l) => !("alpha" in l)), "nothing is drawn faded");
  // the cell-wide DRIVER bit (a driver amplification) does not make the mutation a driver
  assert.equal(cellLayers(B.AMP | B.SPLICE | B.DRIVER, STYLE)[2].color, "#f0b87b");
  assert.equal(cellLayers(B.AMP | B.SPLICE | B.DRIVER | B.MUT_DRIVER, STYLE)[2].color, "#e5802b");
  // an SV and a mutation in one cell are annotated independently
  const mixed = cellLayers(B.SV | B.SV_DRIVER | B.MISSENSE | B.DRIVER, STYLE);
  assert.deepEqual(mixed.slice(1).map((l) => l.color), ["#8b00c9", "#53d400"]);
  assert.throws(() => resolveStyle({ glyph: { vusStyle: "fade" } }), /not a style key/, "the fade is gone, loudly");
});

test("the assembler: a driver mutation of any class outranks every VUS one, SV and mutation annotated apart", () => {
  const input = (events: AssembleInput["events"], drivers: string[]): AssembleInput => ({
    genes: ["G"], groups: [{ name: "all", pids: ["p"] }], studies: ["s"], events, coverage: [{ pid: "p", genes: ["G"] }],
    isDriver: (r) => drivers.includes(r.vt + ":" + (r.mt ?? r.cna ?? "")), annotationSource: "test",
    clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0
  });
  const cell = (inp: AssembleInput): number => assembleContract(inp).tracks.find((t) => t.kind === "gene")!.cells[0] as number;
  const ev = [{ pid: "p", gene: "G", vt: "mutation", mt: "Nonsense_Mutation" }, { pid: "p", gene: "G", vt: "mutation", mt: "Missense_Mutation" }];
  const c = cell(input(ev, ["mutation:Missense_Mutation"]));
  assert.equal(c & (B.TRUNCATING | B.MISSENSE), B.MISSENSE, "the VUS truncation is not drawn over the driver missense");
  assert.ok(c & B.MUT_DRIVER && c & B.DRIVER);
  assert.equal(cellLayers(c, STYLE)[1].color, "#008000");
  const v = cell(input(ev, []));
  assert.equal(v & (B.TRUNCATING | B.MISSENSE), B.TRUNCATING | B.MISSENSE, "with no driver mutation every class is kept");
  assert.equal(cellLayers(v, STYLE)[1].color, "#708090");
  const sv = cell(input([{ pid: "p", gene: "G", vt: "structural_variant" }, { pid: "p", gene: "G", vt: "cna", cna: 2 },
    { pid: "p", gene: "G", vt: "mutation", mt: "Missense_Mutation" }], ["cna:2"]));
  assert.ok(sv & B.DRIVER, "a driver amplification still counts toward the driver %");
  assert.equal(sv & (B.SV_DRIVER | B.MUT_DRIVER), 0, "but neither the SV nor the missense is drawn as a driver");
});

test("promoter mutations are their own class, between in-frame and missense", () => {
  const p = cellLayers(B.PROMOTER | B.MISSENSE | B.MUT_DRIVER, STYLE);
  assert.equal(p[1].color, "#00b7ce", "promoter outranks missense");
  assert.equal(mutClassBit("5'Flank"), B.PROMOTER);
  assert.equal(mutClassBit("Missense_Mutation"), B.MISSENSE);
  assert.equal(mutClassBit("Splice_Region"), B.SPLICE);
});

test("percent format follows the portal, legend order is mutations, SV, CNA, not profiled", () => {
  assert.equal(formatPct(null), "N/P"); assert.equal(formatPct(2.94), "2.9%"); assert.equal(formatPct(3.4), "3%"); assert.equal(formatPct(52.6), "53%");
  assert.deepEqual(geneLegend(STYLE).map((i) => i.label).slice(0, 3),
    ["Truncating Mutation (putative driver)", "Truncating Mutation (unknown significance)", "Splice Mutation (putative driver)"]);
  assert.equal(geneLegend(STYLE).at(-1)!.kind, "notProfiled");
  assert.equal(formatGutterPct(10, 20), "10% / 20%");
  assert.equal(formatGutterPct(10, 20, 50, 100), "10% / 20%*", "the asterisk says the denominator was not every column");
  assert.equal(formatGutterPct(10, 20, 100, 100), "10% / 20%");
  assert.equal(formatGutterPct(null, null), "N/P");
  // a legend lists only what the cells draw: the displayed mutation class, as driver or VUS
  const tracks = [{ kind: "gene", cells: [0, -1, B.MISSENSE | B.TRUNCATING, B.MISSENSE | B.MUT_DRIVER | B.DRIVER, B.AMP | B.DRIVER] }];
  assert.deepEqual(geneLegend(STYLE, glyphPresence(tracks)).map((i) => i.label),
    ["Truncating Mutation (unknown significance)", "Missense Mutation (putative driver)", "Amplification", "Not profiled"]);
  // annotation off: one entry per glyph in its driver colour (the portal's rule set without recurrence)
  const off = geneLegend(styleForDisplay(STYLE, { annotate: "none" }), glyphPresence([{ kind: "gene", cells: [B.MISSENSE] }]));
  assert.deepEqual(off.map((i) => [i.label, i.color]), [["Missense Mutation", "#008000"], ["Not profiled", "#bebebe"]]);
  assert.equal(cellLayers(B.MISSENSE, styleForDisplay(STYLE, { annotate: "none" }))[1].color, "#008000");
  // colour by type off: one pair for every class, listed once
  const one = geneLegend(styleForDisplay(STYLE, { colorByType: false }), glyphPresence([{ kind: "gene", cells: [B.MISSENSE, B.TRUNCATING | B.MUT_DRIVER] }]));
  assert.deepEqual(one.map((i) => i.label), ["Mutation (putative driver)", "Mutation (unknown significance)", "Not profiled"]);
  assert.equal(numericColor(0, null), "rgb(222,235,247)"); assert.equal(numericColor(255, 128), "rgb(178,24,43)"); assert.equal(numericColor(128, 128), "rgb(255,255,255)");
});

test("level of detail: edges partition the columns, buckets OR genes and average numerics", () => {
  assert.deepEqual(bucketEdges(10, 4), [0, 2, 5, 7, 10]);
  assert.deepEqual(bucketEdges(3, 10), [0, 1, 2, 3]);
  const gene = { kind: "gene" as const };
  assert.deepEqual(bucketCodes(gene, [1, 0, -1, -1, 64 | 256, 0], 0, 6, 3), [1, -1, 64 | 256]);
  // a bucket's mutation classes come from its driver-mutation columns when it has any
  const D = B.MUT_DRIVER | B.DRIVER;
  assert.deepEqual(bucketCodes(gene, [B.TRUNCATING, B.MISSENSE | D, B.TRUNCATING | B.AMP, B.SV], 0, 4, 2), [B.MISSENSE | D, B.TRUNCATING | B.AMP | B.SV]);
  assert.deepEqual(bucketCodes({ kind: "clinical", numeric: true }, [10, 20, -1, -1], 0, 4, 2), [15, -1]);
  assert.deepEqual(bucketCodes({ kind: "clinical", categories: ["a", "b"] }, [0, 1, 1, 2, -1, -1], 0, 6, 3), [0, 1, -1], "ties go to the lower index");
});


test("an override merges onto the defaults and leaves the rest alone", () => {
  assert.equal(resolveStyle(undefined), STYLE, "nothing to merge returns the defaults themselves");
  assert.equal(resolveStyle({}), STYLE);
  const S = resolveStyle({ palette: { unaltered: "#f0f0f0" }, glyph: { sv: { vus: "#123456" } } });
  assert.equal(S.palette.unaltered, "#f0f0f0");
  assert.equal(S.glyph.sv.vus, "#123456");
  assert.equal(S.palette.paper, STYLE.palette.paper, "untouched keys keep their default");
  assert.equal(STYLE.palette.unaltered, "#bebebe", "the defaults are not mutated");
  assert.equal(cellLayers(B.MISSENSE, S)[0].color, "#f0f0f0");
});

test("overrides reach colours, ramps, geometry and legend labels", () => {
  const S = resolveStyle({
    palette: { categorical: ["#111111", "#222222"] },
    glyph: { mutation: { priority: [{ color: "#abcdef" }, {}, {}, {}, {}, {}] }, notProfiled: { label: "No panel" } },
    geometry: { rowH: 30 }
  });
  assert.equal(S.palette.categorical.length, 2);
  assert.equal(S.glyph.mutation.priority[0].color, "#abcdef");
  assert.equal(S.glyph.mutation.priority[0].bit, "TRUNCATING", "entries keep their meaning");
  assert.equal(S.glyph.mutation.priority[4].color, "#008000", "unlisted entries keep their default");
  assert.equal(S.geometry.rowH, 30);
  assert.equal(geneLegend(S).at(-1)!.label, "No panel");
});

test("overrides are rejected loudly: typos, wrong types, meaning changes, illegible results", () => {
  assert.throws(() => resolveStyle({ palete: {} }), /style.palete is not a style key.*palette/s);
  assert.throws(() => resolveStyle({ palette: { unalterd: "#000000" } }), /style.palette.unalterd is not a style key/);
  assert.throws(() => resolveStyle({ palette: { unaltered: "red" } }), /not a #rrggbb colour/);
  assert.throws(() => resolveStyle({ geometry: { rowH: "tall" } }), /must be a number/);
  assert.throws(() => resolveStyle({ bits: { AMP: 1 } }), /read-only/);
  assert.throws(() => resolveStyle({ glyph: { mutation: { priority: [{ bit: "MISSENSE" }, {}, {}, {}, {}, {}] } } }),
    /priority\[0\].bit is read-only/);
  assert.throws(() => resolveStyle({ glyph: { mutation: { priority: [{}] } } }), /keep all 6 entries/);
  assert.throws(() => resolveStyle({ glyph: { notProfiled: { fill: "#bebebe", stripe: { color: "#bebebe" } } } }),
    /indistinguishable from unaltered/);
});

test("per-track colours override the categorical cycle for that track only", () => {
  const track = { label: "CANCER_TYPE", categories: ["Lung", "Colon"] };
  const colors = { CANCER_TYPE: { Colon: "#123456" } };
  assert.equal(trackCategoryColor(track, 0, STYLE, colors), STYLE.palette.categorical[0]);
  assert.equal(trackCategoryColor(track, 1, STYLE, colors), "#123456");
  assert.equal(trackCategoryColor({ label: "OTHER", categories: ["Colon"] }, 0, STYLE, colors), STYLE.palette.categorical[0]);
  assert.equal(trackCategoryColor(track, 1, STYLE), STYLE.palette.categorical[1], "no override map: the cycle");
});

test("a merged gene row wears brackets in the gutter, a single gene does not", () => {
  assert.equal(trackLabelText({ label: "TP53" }), "TP53");
  assert.equal(trackLabelText({ label: "TP53", members: ["TP53"] }), "TP53");
  assert.equal(trackLabelText({ label: "TP53 pathway", members: ["TP53", "MDM2"] }), "[TP53 pathway]");
  // the closing bracket survives truncation; the label inside is what gets cut
  const long = trackLabelText({ label: "a very long pathway name indeed", members: ["A", "B"] });
  assert.ok(long.startsWith("[") && long.endsWith("]"), long);
  assert.equal(long.length, STYLE.geometry.labelMaxChars);
});

test("a track label explains itself in words, the same words for every renderer", () => {
  assert.deepEqual(trackTooltipLines({ label: "TP53 pathway", members: ["TP53", "MDM2", "MDM4"],
    altered: 2111, profiled: 3109, driverAltered: 2086, freqPct: 67.9, driverPct: 67.1 }, 3109), [
    "TP53 pathway",
    "one row over 3 genes: TP53 · MDM2 · MDM4",
    "2,111 of 3,109 profiled patients altered (67.9%)",
    "2,086 putative driver (67.1%)"
  ]);
  // a partly profiled gene says how many columns it could not answer for
  assert.ok(trackTooltipLines({ label: "KRAS", altered: 3, profiled: 10, freqPct: 30 }, 12)
    .some((l) => l === "not profiled in 2 of 12 columns"));
  assert.deepEqual(trackTooltipLines({ label: "STAGE", categories: ["III", "IV"] }, 12), ["STAGE", "2 values: III, IV"]);
  assert.deepEqual(trackTooltipLines({ label: "AGE", numeric: true, min: 44, max: 80 }, 12), ["AGE", "44 → 80"]);
  assert.deepEqual(trackTooltipLines({ label: "EMPTY", categories: [] }, 12), ["EMPTY", "no values in these columns"]);
});
