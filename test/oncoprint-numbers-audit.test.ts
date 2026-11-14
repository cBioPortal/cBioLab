// Audit of PR #192 (OncoPrint gutter %, gap-label %, header % and the samples line) against the
// parity case table (rows 1-49), cited to cbioportal-frontend cd8c6df:
//   OU  = src/shared/components/oncoprint/OncoprintUtils.ts (percentAltered 857-876, formatPercent 112-118)
//   TIV = packages/oncoprintjs/src/js/oncoprinttrackinfoview.ts (on-screen reformat 80-97, SVG 244-246)
//   FU  = src/shared/lib/FormatUtils.tsx getPercentage 64-73
//   QSU = src/pages/resultsView/querySummary/QuerySummaryUtils.tsx getAlterationSummary 30-75
// The on-screen legacy gutter is double-rounded under 3 %: percentAltered's toFixed(1) (dropping a
// trailing ".0"), then the view's parseFloat + Math.round, "<1" for 0 < x < 1.
//
// Where a rule is computed in more than one place it is run in each: the style function
// (formatGutterPct from counts), the engine + browser canvas (assembleContract -> draw), and the
// server SVG (contractToSvg). The "any %" is the number compared with the portal's single number;
// cBioLab's driver % beside it is a deliberate, documented divergence (row 28).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { assembleContract, type EventRow } from "../lib/oncoprint-assemble.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { draw, segmentByTrack, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { formatGutterPct, trackTooltipLines } from "../lib/oncoprint-style.ts";
import { samplesLine } from "../app/portal/results-layout.ts";
import type { Contract, Track } from "../lib/types.ts";
import type { GeneTrackSpec } from "../lib/gene-tracks.ts";

register("./support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { PortalSummary } = await import("../app/portal/portal-chrome.tsx");

// ---- fixtures -----------------------------------------------------------------------------------

interface Case {
  /** all columns (cases) */
  n: number;
  /** the first `profiled` columns are profiled for the gene(s) */
  profiled: number;
  /** the first `altered` columns carry a mutation */
  altered: number;
  genes?: GeneTrackSpec[];
  coverage?: { pid: string; genes: string[] }[];
  events?: EventRow[];
  driver?: number;
  unit?: "patient" | "sample";
}

const ids = (n: number, p = "P") => Array.from({ length: n }, (_, i) => p + String(i).padStart(5, "0"));
const mut = (pid: string, gene = "G"): EventRow => ({ pid, gene, vt: "mutation", mt: "Missense_Mutation" });

function contract(c: Case): Contract {
  const pids = ids(c.n);
  return assembleContract({
    genes: c.genes ?? ["G"], groups: [{ name: "all", pids }], studies: ["s"], unit: c.unit,
    events: c.events ?? pids.slice(0, c.altered).map((p) => mut(p)),
    coverage: c.coverage ?? pids.slice(0, c.profiled).map((pid) => ({ pid, genes: ["G"] })),
    isDriver: (r) => pids.indexOf(r.pid) < (c.driver ?? 0), annotationSource: "t",
    clinical: [], heatmap: [], derived: [], sort: [], lineGap: 0 });
}
const geneTrack = (k: Contract): Track => k.tracks.find((t) => t.kind === "gene")!;

function unpack(k: Contract) {
  const buf = packContract(k);
  return unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

function recorder() {
  const texts: string[] = [];
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "fillText") return (s: string) => texts.push(String(s));
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set() { return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const isPct = (s: string) => /^(N\/P|.*%\*?)$/.test(s) && !s.includes("(");
/** the "any %" of a cBioLab gutter string (the one the portal also prints); N/P stays whole */
const anyPart = (s: string) => s.split(" / ").at(-1)!;

/** the gutter label the browser canvas draws for the gene row */
function canvasGutter(k: Contract): string {
  const data = unpack(k), n = data.n;
  const { ctx, texts } = recorder();
  draw(ctx, data, Uint32Array.from({ length: n }, (_, i) => i), [{ name: "all", start: 0, count: n, patients: n }],
    { zoom: 1, scrollX: 0, whitespace: true }, 1200);
  const got = texts.filter(isPct);
  assert.ok(got.length <= 1, "at most one gutter % drawn, got " + JSON.stringify(texts));
  return got[0] ?? "(nothing drawn)";
}

/** the gutter label in the server SVG */
function svgGutter(k: Contract): string {
  const svg = contractToSvg(k, 800);
  const got = [...svg.matchAll(/<text[^>]*>(?:<title>[\s\S]*?<\/title>)?([^\n]*?)<\/text>/g)].map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).filter(isPct);
  assert.ok(got.length <= 1, "at most one gutter % in the SVG, got " + JSON.stringify(got));
  return got[0] ?? "(nothing drawn)";
}

/** the style function, fed the counts the portal uses: altered-and-profiled, profiled, all columns */
const styleGutter = (c: Case) => formatGutterPct({ driverAltered: c.driver ?? 0, altered: c.altered, profiled: c.profiled }, c.n);

/** a row in the three places: the style function, engine + canvas, server SVG */
function gutterRow(name: string, c: Case, expected: string, where: ("style" | "canvas")[] = ["style", "canvas"]) {
  if (where.includes("style")) test(name + " [style formatGutterPct]", () => assert.equal(anyPart(styleGutter(c)), expected));
  if (where.includes("canvas")) test(name + " [engine + canvas]", () => assert.equal(anyPart(canvasGutter(contract(c))), expected));
}

// ---- Gutter, on screen: OU percentAltered then TIV 80-97 -----------------------------------------

gutterRow("1: 0 profiled (0 of 0) prints N/P, no asterisk (OU 858-860, 1163, 1167; TIV 86-88)", { n: 50, profiled: 0, altered: 0 }, "N/P");
gutterRow("2: 0 altered of 50, all profiled (OU 869-873; TIV 92)", { n: 50, profiled: 50, altered: 0 }, "0%");
gutterRow("3: 50 of 50 (OU 874-875)", { n: 50, profiled: 50, altered: 50 }, "100%");
gutterRow("4: 1 of 1000, 0.1 % (OU 866; TIV 91)", { n: 1000, profiled: 1000, altered: 1 }, "<1%");
gutterRow("5 (ours, docs/PORTAL-PARITY.md): 1 of 2500, 0.04 %: the portal's raw \"0%\" re-parses to 0; ours never prints 0% above 0 (OU 866-870; TIV 90-92)", { n: 2500, profiled: 2500, altered: 1 }, "<1%");
gutterRow("6 (ours, docs/PORTAL-PARITY.md): 1 of 3000, 0.033 %: same as 5 (OU 866-870; TIV 90-92)", { n: 3000, profiled: 3000, altered: 1 }, "<1%");
gutterRow("7: 1 of 2000, 0.05 %: toFixed(1) gives 0.1 (OU 866)", { n: 2000, profiled: 2000, altered: 1 }, "<1%");
gutterRow("8: 3 of 2000, 0.15 % (OU 866)", { n: 2000, profiled: 2000, altered: 3 }, "<1%");
gutterRow("9: 24 of 2500, 0.96 %: raw \"1%\" (double rounding) (OU 866-870; TIV 92)", { n: 2500, profiled: 2500, altered: 24 }, "1%");
gutterRow("10: 73 of 5000, 1.46 %: raw \"1.5%\" then Math.round (double rounding) (OU 866; TIV 92)", { n: 5000, profiled: 5000, altered: 73 }, "2%");
gutterRow("11: 22 of 1000, 2.2 % (OU 866; OncoprintUtils.spec.ts 570)", { n: 1000, profiled: 1000, altered: 22 }, "2%");
gutterRow("12: 1 of 40, 2.5 %: Math.round of \"2.5\" (OU 866; TIV 92)", { n: 40, profiled: 40, altered: 1 }, "3%");
gutterRow("13: 29 of 1000, 2.9 % (OU 866)", { n: 1000, profiled: 1000, altered: 29 }, "3%");
gutterRow("14: 149 of 5000, 2.98 %: raw \"3%\" (OU 866-870)", { n: 5000, profiled: 5000, altered: 149 }, "3%");
gutterRow("15: 3 of 100, exactly 3 % (OU 865, 874; spec 564)", { n: 100, profiled: 100, altered: 3 }, "3%");
gutterRow("16: 1 of 8, 12.5 % (OU 874)", { n: 8, profiled: 8, altered: 1 }, "13%");
gutterRow("17: 7 of 8, 87.5 % (OU 874)", { n: 8, profiled: 8, altered: 7 }, "88%");
gutterRow("18: 5 of 11, 45.45 %: toFixed() of the unrounded value (OU 874)", { n: 11, profiled: 11, altered: 5 }, "45%");
gutterRow("19: 50 of 99 (OncoprintUtils.spec.ts 567)", { n: 99, profiled: 99, altered: 50 }, "51%");
gutterRow("20: 1 of 3 (OncoprintUtils.spec.ts 138)", { n: 3, profiled: 3, altered: 1 }, "33%");
gutterRow("21: 23 of 40, 100*(23/40) is 57.4999… in IEEE, toFixed() gives 57 (OU 874)", { n: 40, profiled: 40, altered: 23 }, "57%");
gutterRow("22: partial profiling, 5 altered of 10 profiled, 20 cases (OU 1167-1174; TIV 81)", { n: 20, profiled: 10, altered: 5 }, "50%*");
gutterRow("23: partial profiling under 3 %, 1 of 400 profiled, 500 cases (OU 1167-1174; TIV 91)", { n: 500, profiled: 400, altered: 1 }, "<1%*");

test("24: an altered case not profiled for the gene is not in the numerator (OU 902-905, 913-916) [engine + canvas]", () => {
  // 10 cases, 5 profiled; 2 profiled cases altered and 1 unprofiled one: 2 / 5 = 40 %, partial
  const pids = ids(10);
  const k = contract({ n: 10, profiled: 5, altered: 0, events: [mut(pids[0]), mut(pids[1]), mut(pids[7])] });
  assert.equal(geneTrack(k).altered, 2, "altered-and-profiled");
  assert.equal(geneTrack(k).profiled, 5);
  assert.equal(anyPart(canvasGutter(k)), "40%*");
});

test("25: patient mode, 3 patients profiled, 1 altered, denominator profiled patients (OU 907-918, 1169) [engine + canvas]", () => {
  // the engine's columns are already patients (the any-sample collapse happens upstream of assembleContract)
  const k = contract({ n: 3, profiled: 3, altered: 1, unit: "patient" });
  assert.equal(anyPart(canvasGutter(k)), "33%");
  const partial = contract({ n: 4, profiled: 3, altered: 1, unit: "patient" });
  assert.equal(anyPart(canvasGutter(partial)), "33%*", "3 of 4 patients profiled");
});

test("26: merged track [A B], profiled is the union of A's and B's profiled cases (OU 895-910) [engine + canvas]", () => {
  // 10 cases: 0-3 profiled for A only, 4-7 for B only, 8-9 for neither. Altered: 0 (A), 5 (B), 8 (A, unprofiled).
  const pids = ids(10);
  const coverage = [...pids.slice(0, 4).map((pid) => ({ pid, genes: ["A"] })), ...pids.slice(4, 8).map((pid) => ({ pid, genes: ["B"] }))];
  const k = contract({ n: 10, profiled: 0, altered: 0, genes: [{ label: "AB", genes: ["A", "B"] }], coverage,
    events: [mut(pids[0], "A"), mut(pids[5], "B"), mut(pids[8], "A")] });
  assert.equal(geneTrack(k).profiled, 8, "union of profiled");
  assert.equal(geneTrack(k).altered, 2);
  assert.equal(anyPart(canvasGutter(k)), "25%*");
});

test("27: the tooltip keeps 1 decimal under 3 %, 22 of 1000 (OU 1164-1166, 891) [engine + trackTooltipLines]", () => {
  // the wording is cBioLab's own; the number and the counts are the portal's
  const k = contract({ n: 1000, profiled: 1000, altered: 22 });
  const lines = trackTooltipLines(geneTrack(k), 1000);
  assert.ok(lines.some((l) => l.includes("2.2%")), JSON.stringify(lines));
  assert.ok(lines.some((l) => /\b22\b\D+1,?000\b/.test(l)), JSON.stringify(lines));
});

test("28: driver % beside any % in the gutter (OU 1162-1189: legacy has one number) — deliberate documented divergence: cBioLab keeps both, portal format each", () => {
  // 5 drivers and 22 altered of 1000: "<1%" driver, "2%" any
  const c = { n: 1000, profiled: 1000, altered: 22, driver: 5 };
  assert.equal(styleGutter(c), "<1% / 2%", "style");
  assert.equal(canvasGutter(contract(c)), "<1% / 2%", "canvas");
  assert.equal(svgGutter(contract(c)), "<1% / 2%", "server SVG");
});

// ---- Downloaded SVG: TIV 244-246 prints the raw percentAltered string --------------------------

const svgRow = (name: string, c: Case, expected: string) =>
  void test(name + " [engine + server SVG]", () => assert.equal(anyPart(svgGutter(contract(c))), expected));
svgRow("29 (ours, docs/PORTAL-PARITY.md): the portal's SVG download prints the raw 1-decimal value; ours prints the label as drawn on screen, 22 of 1000 (TIV 244-246)", { n: 1000, profiled: 1000, altered: 22 }, "2%");
svgRow("30 (ours, docs/PORTAL-PARITY.md): SVG, 1 of 2500, as on screen (TIV 244-246)", { n: 2500, profiled: 2500, altered: 1 }, "<1%");
svgRow("31: SVG, 5 of 11 partial (TIV 244-246)", { n: 12, profiled: 11, altered: 5 }, "45%*");
svgRow("32: SVG, 0 of 0 (TIV 244-246)", { n: 10, profiled: 0, altered: 0 }, "N/P");

// ---- Gap labels: formatPercent(info.percent), OU 112-118, 1274-1280 -----------------------------

/** groups x, y, z by a clinical track, each with its own altered / profiled; the gap label drawn after each group */
function gapLabels(groups: { name: string; n: number; profiled: number; altered: number }[]): Record<string, string | undefined> {
  const pidsOf = groups.map((g) => ids(g.n, g.name.toUpperCase()));
  const all = pidsOf.flat();
  const values = new Map<string, string>();
  groups.forEach((g, i) => pidsOf[i].forEach((p) => values.set(p, g.name)));
  const k = assembleContract({ genes: ["G"], groups: [{ name: "all", pids: all }], studies: ["s"],
    events: groups.flatMap((g, i) => pidsOf[i].slice(0, g.altered).map((p) => mut(p))),
    coverage: groups.flatMap((g, i) => pidsOf[i].slice(0, g.profiled).map((pid) => ({ pid, genes: ["G"] }))),
    isDriver: () => false, annotationSource: "t", clinical: [{ attr: "GRP", values }], heatmap: [], derived: [],
    sort: [{ track: "GRP", dir: "asc" }], lineGap: 0 });
  const data = unpack(k), n = data.n, order = Uint32Array.from({ length: n }, (_, i) => i);
  const vg: VisibleGroup[] = segmentByTrack(data, order, [{ name: "all", start: 0, count: n, patients: n }], "GRP", true);
  const { ctx, texts } = recorder();
  const zoom = 600 / n;
  draw(ctx, data, order, vg, { zoom, scrollX: 0, whitespace: true }, 1400, undefined, { gap: 40, pctLabels: true });
  const out: Record<string, string | undefined> = {};
  for (const g of groups) {
    const i = texts.findIndex((t) => t === g.name || t.startsWith(g.name + " ("));
    out[g.name] = i >= 0 && isPct(texts[i + 1] ?? "") ? texts[i + 1] : undefined;
  }
  return out;
}
const gapFixture = () => gapLabels([
  { name: "a", n: 1000, profiled: 1000, altered: 22 },
  { name: "b", n: 5000, profiled: 5000, altered: 73 },
  { name: "c", n: 2500, profiled: 2500, altered: 1 },
  { name: "d", n: 20, profiled: 0, altered: 0 }]);
// the N/P group sits between others and is wide enough to carry a header and a gap label
const gapNP = () => gapLabels([
  { name: "a", n: 1000, profiled: 1000, altered: 22 },
  { name: "b", n: 2000, profiled: 0, altered: 0 },
  { name: "c", n: 1000, profiled: 1000, altered: 22 }]);

test("33: gap label, group 22 of 1000 (OU 115) [engine + segmentByTrack + canvas]", () => assert.equal(gapFixture().a, "2%"));
test("34: gap label, group 73 of 5000, double rounding (OU 115) [engine + segmentByTrack + canvas]", () => assert.equal(gapFixture().b, "2%"));
test("35 (ours, as row 5): gap label, group 1 of 2500 (OU 115) [engine + segmentByTrack + canvas]", () => assert.equal(gapFixture().c, "<1%"));
test("36 (ours, docs/PORTAL-PARITY.md): gap label, group with 0 profiled: the portal prints \"NaN%\" (parseFloat(\"N/P\")); ours prints none (OU 113-115) [engine + segmentByTrack + canvas]",
  () => assert.equal(gapNP().b, undefined));
test("37: gap tooltip \"2.2% (altered / profiled = 22 / 1000)\" (OU 1278)", { skip: "no exported gap-tooltip formatter; the canvas gap label carries no tooltip text the tests can reach" }, () => {});

// ---- Results header: getAlterationSummary (QSU 30-75), getPercentage (FU 64-73) -----------------

/** the header stat as the Results page passes it: integer % (PR #192), its text as rendered */
function headerStat(value: number, of: number): string {
  const html = renderToStaticMarkup(createElement(PortalSummary, { eyebrow: "E", title: "T", study: "s", left: [],
    stat: { value, of, label: "queried patients altered", decimals: 0, also: null } }));
  const text = html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const m = text.match(/([\d,]+) \(([^)]*)\)/);
  assert.ok(m, "a count and a % in " + text);
  return m![0];
}
/** the samples line's leading "n (x%)" */
const samplesStat = (alteredSamples: number, queriedSamples: number) => {
  const line = samplesLine({ queried: queriedSamples - 1, alteredSamples, queriedSamples });
  assert.ok(line, "a samples line when samples outnumber patients");
  return line!.match(/^([\d,]+) \(([^)]*)\)/)![0];
};

test("38: one gene, samples == patients = 592, 485 altered: \"485 (82%)\", and no second line (QSU 37-40, 67-72) [header + samplesLine]", () => {
  // the sentence "Queried gene is altered in … of queried patients/samples" is the page's label, not tested here
  assert.equal(headerStat(485, 592), "485 (82%)");
  assert.equal(samplesLine({ queried: 592, alteredSamples: 485, queriedSamples: 592 }), null);
});
test("39: \"Queried genes are\" for 2+ genes (QSU 37)", { skip: "the header sentence is the Results page's own label string, not a function of the gene count the tests can call" }, () => {});
test("40a (ours, docs/PORTAL-PARITY.md): samples 10945 != patients 10336: the portal writes \"6208 (60%)\"; ours the page's own count format (QSU 41-65) [header]", () => {
  assert.equal(headerStat(6208, 10336), "6,208 (60%)");
});
test("40b (ours, docs/PORTAL-PARITY.md): the portal's samples row is \"6494 (59%) of queried samples\"; ours names the denominator (QSU 41-65) [samplesLine]", () => {
  assert.equal(samplesLine({ queried: 10336, alteredSamples: 6494, queriedSamples: 10945 }), "6,494 (59%) of 10,945 queried samples altered");
});

const headerRow = (name: string, a: number, of: number, expected: string) => {
  test(name + " [header]", () => assert.equal(headerStat(a, of), expected));
  test(name + " [samplesLine]", () => assert.equal(samplesStat(a, of), expected));
};
headerRow("41: 0 altered of 100 (FU 66-67)", 0, 100, "0 (0%)");
headerRow("42: 1 of 1000 (FU 68-69)", 1, 1000, "1 (<1%)");
headerRow("43: 1 of 200, 0.5 % (FU 68-69)", 1, 200, "1 (<1%)");
headerRow("44: 1 of 100, exactly 1 % (FU 70-71)", 1, 100, "1 (1%)");
headerRow("45: 1 of 8, 12.5 % rounds up (FU 71)", 1, 8, "1 (13%)");
headerRow("46: 1 of 40, 2.5 % (FU 71)", 1, 40, "1 (3%)");
headerRow("47: 5 of 11 (FU 71)", 5, 11, "5 (45%)");
test("48: 0 of 0 prints \"0 (NaN%)\" (FU 65-71)", { skip: "cBioLab shows no header stat when nothing was queried (the page passes stat only for a non-zero queried count) and samplesLine returns null for 0 queried samples; the case is not reachable" }, () => {});
headerRow("49: 100 of 100 (FU 71)", 100, 100, "100 (100%)");
