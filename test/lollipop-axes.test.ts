// The lollipop's axes as the portal labels them (MUT-LP-6): the tick interval, the x and y ticks and
// their labels, the y title, and the figure drawing them. Row ids are the spec table's (A1–A18).
// Legacy: react-mutation-mapper LollipopPlotNoTooltip.tsx (calculateTickInterval, calculateTicks,
// xTicks, axisTicks, yMaxLabel) and resultsView/mutation/Mutations.tsx (the y title formatter).
// New exports are read off the module at run time, so this file loads before they exist.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import; nothing leaves the machine
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE"]) delete process.env[k];

register("./support/tsx-loader.mjs", import.meta.url);
const lib = await import("../lib/lollipop.ts") as Record<string, unknown>;
const { buildLollipopGene } = await import("../lib/lollipop.ts");
const svgLib = await import("../lib/lollipop-svg.ts");
type HotspotGene = import("../lib/views/hotspots/types.ts").HotspotGene;
type Tick = { pos: number; label?: string };

const Y = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const X = [50, 100, 200, 250, 500, 1000, 2500, 5000, 10000, 25000];

function fn<F>(name: string): F {
  assert.equal(typeof lib[name], "function", "lib/lollipop.ts exports " + name);
  return lib[name] as F;
}
const interval = (c: number[], range: number, max: number) =>
  fn<(c: number[], r: number, m: number) => number>("lollipopTickInterval")(c, range, max);
const xTicks = (len: number) => fn<(len: number) => Tick[]>("lollipopXTicks")(len);
const yTicksOf = (max: number, capped: boolean) => fn<(m: number, c: boolean) => Tick[]>("lollipopYTicks")(max, capped);
const positions = (ts: Tick[]) => ts.map((t) => t.pos);
/** the labelled ticks, as [pos, label]; an empty label counts as none */
const labelled = (ts: Tick[]) => ts.filter((t) => t.label != null && t.label !== "").map((t) => [t.pos, t.label] as [number, string]);
const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const panelsAt = (width: number, genes: HotspotGene[], yMax?: Record<string, number>) =>
  (svgLib.lollipopPanelsSvg as (...a: unknown[]) => string)(genes, { width }, "", undefined, ...(yMax === undefined ? [] : [yMax]));
const panels = (genes: HotspotGene[], yMax?: Record<string, number>) => panelsAt(720, genes, yMax);
const report = (gene: string, stems: [number, number][]) => ({
  changes: stems.map(([pos, n]) => ({ gene, pos, change: "X" + pos + "Y", n, rows: n, driver: true, impact: "missense" })),
  types: stems.map(([pos, n]) => ({ gene, pos, mtype: "Missense_Mutation", driver: true, rows: n })),
  totals: [{ gene, patients: stems.reduce((s, [, n]) => s + n, 0), pairs: stems.reduce((s, [, n]) => s + n, 0), somaticSamples: 1 }],
  cohortSamples: 500, minCount: 1, annotated: true,
});
const gene = (stems: [number, number][], name = "G", proteinLength = 189) =>
  buildLollipopGene(name, [report(name, stems)] as never, { proteinLength, transcriptId: "T", domains: [] }) as HotspotGene;
const A13_STEMS: [number, number][] = [[12, 136], [61, 3]];

/** a drawn text's characters (lib/chart/esc.ts escapes them) */
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const allTexts = (svg: string) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => unesc(m[1]));
/** the y axis's drawn labels (the right-aligned texts beside its grid lines), top to bottom, non-empty only */
function yLabels(svg: string) {
  const out: { y: number; label: string }[] = [];
  for (const m of svg.matchAll(/<text ([^>]*)text-anchor="end"[^>]*>([^<]*)<\/text>/g)) {
    if (m[2].trim() === "" || /transform=/.test(m[1])) continue;
    out.push({ y: Number(m[1].match(/\by="([^"]*)"/)![1]), label: unesc(m[2]) });
  }
  return out.sort((a, b) => a.y - b.y);
}
/** the y axis's title: the text turned up the left edge */
function yTitle(svg: string) {
  const m = svg.match(/<text [^>]*transform="rotate\(-90[^>]*>([^<]*)<\/text>/);
  assert.ok(m, "a y title drawn");
  return unesc(m[1]);
}
/** the x axis's line: the y of its short downward tick marks */
function xAxisY(svg: string) {
  const m = svg.match(/<line x1="([^"]*)" y1="([^"]*)" x2="\1" y2="([^"]*)"[^>]*\/>/g) || [];
  for (const l of m) {
    const [, , y1, y2] = l.match(/<line x1="([^"]*)" y1="([^"]*)" x2="\1" y2="([^"]*)"/)!;
    if (Number(y2) - Number(y1) > 0 && Number(y2) - Number(y1) <= 8) return Number(y1);
  }
  assert.fail("an x axis tick mark");
}
/** the x axis's drawn labels, left to right, non-empty only: texts just below its line, with their
 * x and text-anchor */
function xLabelsPlaced(svg: string) {
  const axY = xAxisY(svg);
  const out: { x: number; anchor: string; label: string }[] = [];
  for (const m of svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)) {
    const y = Number(m[1].match(/\by="([^"]*)"/)?.[1]);
    if (!(y > axY && y <= axY + 20) || m[2].trim() === "" || /transform=/.test(m[1])) continue;
    out.push({ x: Number(m[1].match(/\bx="([^"]*)"/)![1]), anchor: m[1].match(/text-anchor="([^"]*)"/)?.[1] ?? "start", label: unesc(m[2]) });
  }
  return out.sort((a, b) => a.x - b.x);
}
const xLabels = (svg: string) => xLabelsPlaced(svg).map((t) => t.label);
/** the y axis line's x: the leftmost vertical line at least 100px long (stems stand right of it) */
function yAxisX(svg: string) {
  let best = Infinity;
  for (const m of svg.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="\1" y2="([^"]*)"[^>]*\/>/g))
    if (Math.abs(Number(m[3]) - Number(m[2])) >= 100) best = Math.min(best, Number(m[1]));
  assert.ok(Number.isFinite(best), "a y axis line");
  return best;
}
/** the y axis's tick lines: horizontal lines with one end at the axis line — a short mark ending at
 * it (x2 at the axis) or a grid line starting from it (x1 at the axis) */
function yTickLines(svg: string) {
  const ax = yAxisX(svg), at = (v: number) => Math.abs(v - ax) < 0.06;
  const out: { y: number; x1: number; x2: number }[] = [];
  for (const m of svg.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="\2"[^>]*\/>/g)) {
    const x1 = Number(m[1]), x2 = Number(m[3]);
    if (at(x1) || at(x2)) out.push({ y: Number(m[2]), x1, x2 });
  }
  return out;
}
/** the y ticks' y values, top first */
const tickYs = (svg: string) => [...new Set(yTickLines(svg).map((l) => l.y))].sort((a, b) => a - b);
const headY = (svg: string, pos: number) => {
  const m = svg.match(new RegExp(`data-codon="${pos}"[^>]*>[\\s\\S]*?<circle class="lollipop-head"[^>]* cy="([^"]*)"`));
  assert.ok(m, "a head at codon " + pos);
  return Number(m[1]);
};

// ---- the interval: the first candidate c with range / c < maxTickCount − 1, else a power of 10 ----
test("A1 lollipopTickInterval(Y candidates, 136, 10) = 20", () => {
  assert.equal(interval(Y, 136, 10), 20);
});

test("A2 lollipopTickInterval over Y for 5, 9, 1 = 1, 2, 1", () => {
  assert.equal(interval(Y, 5, 10), 1);
  assert.equal(interval(Y, 9, 10), 2, "9 / 1 = 9 is not < 9");
  assert.equal(interval(Y, 1, 10), 1);
});

test("A3 lollipopTickInterval over X for 393, 1210, 30000 = 50, 100, 2500", () => {
  assert.equal(interval(X, 393, 16), 50);
  assert.equal(interval(X, 1210, 16), 100);
  assert.equal(interval(X, 30000, 16), 2500);
});

test("A4 lollipopTickInterval with no candidate fitting is the first power of 10 that does: 100000", () => {
  assert.equal(interval(X, 1000000, 16), 100000);
});

// ---- x ticks: 0, "<len>aa", every multiple of the interval below it, every other one labelled ----
test("A5 lollipopXTicks(393): ticks every 50, labels 0, 100, 200, 300, 393aa", () => {
  const ts = xTicks(393);
  assert.deepEqual(positions(ts), [...range(0, 350, 50), 393]);
  assert.deepEqual(labelled(ts), [[0, "0"], [100, "100"], [200, "200"], [300, "300"], [393, "393aa"]]);
});

test("A6 lollipopXTicks(189): ticks 0, 50, 100, 150, 189; labels 0, 100, 189aa", () => {
  const ts = xTicks(189);
  assert.deepEqual(positions(ts), [0, 50, 100, 150, 189]);
  assert.deepEqual(labelled(ts), [[0, "0"], [100, "100"], [189, "189aa"]]);
});

test("A7 lollipopXTicks(414): 400 is a tick, unlabelled as too close to the end", () => {
  const ts = xTicks(414);
  assert.deepEqual(positions(ts), [...range(0, 400, 50), 414]);
  assert.deepEqual(labelled(ts).map(([, l]) => l), ["0", "100", "200", "300", "414aa"]);
});

test("A8 lollipopXTicks(1210): interval 100, every 200 labelled, 1200 not, 1210aa with no separator", () => {
  const ts = xTicks(1210);
  assert.deepEqual(positions(ts), [...range(0, 1200, 100), 1210]);
  assert.deepEqual(labelled(ts), [[0, "0"], [200, "200"], [400, "400"], [600, "600"], [800, "800"], [1000, "1000"], [1210, "1210aa"]]);
  assert.ok(!ts.some((t) => t.label?.includes(",")), "no thousands separator");
});

test("A9 lollipopXTicks(100): ticks 0, 50, 100; labels 0 and 100aa", () => {
  const ts = xTicks(100);
  assert.deepEqual(positions(ts), [0, 50, 100]);
  assert.deepEqual(labelled(ts), [[0, "0"], [100, "100aa"]]);
});

// ---- y ticks: 0 and the maximum labelled, every multiple of the interval below it unlabelled ----
test("A10 lollipopYTicks(136, false): ticks every 20 and 136; labels 0 and 136 only", () => {
  const ts = yTicksOf(136, false);
  assert.deepEqual(positions(ts), [...range(0, 120, 20), 136]);
  assert.deepEqual(labelled(ts), [[0, "0"], [136, "136"]]);
});

test("A11 lollipopYTicks(100, true): ticks every 20 to 100; labels 0 and >= 100", () => {
  const ts = yTicksOf(100, true);
  assert.deepEqual(positions(ts), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(labelled(ts), [[0, "0"], [100, ">= 100"]]);
});

test("A12 lollipopYTicks(5, false) and (1, false): every whole number, labels 0 and the max", () => {
  const five = yTicksOf(5, false);
  assert.deepEqual(positions(five), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(labelled(five), [[0, "0"], [5, "5"]]);
  const one = yTicksOf(1, false);
  assert.deepEqual(positions(one), [0, 1]);
  assert.deepEqual(labelled(one), [[0, "0"], [1, "1"]]);
});

// ---- the figure ----
test("A13 the figure: y title # patients, y labels 0 and 136 with the 136 head on the top tick, x labels 0, 100, 189aa", () => {
  const svg = panels([gene(A13_STEMS)]);
  assert.equal(yTitle(svg), "# patients");
  assert.ok(!allTexts(svg).some((t) => /Mutations/.test(t)), "no \"# G Mutations\" title");
  const ys = yLabels(svg);
  assert.deepEqual(ys.map((t) => t.label), ["136", "0"]);
  const ticks = tickYs(svg);
  assert.equal(headY(svg, 12), ticks[0], "the 136 stem's head sits on the top tick");
  assert.ok(Math.abs(ys[0].y - ticks[0]) < 6, "the 136 label is beside the top tick");
  assert.deepEqual(xLabels(svg), ["0", "100", "189aa"]);
  assert.equal(lib.LOLLIPOP_Y_TITLE, "# patients", "lib/lollipop.ts exports LOLLIPOP_Y_TITLE");
});

test("A14 a set maximum of 10 below the 136 stem: y labels 0 and >= 10, no ≥", () => {
  const svg = panels([gene(A13_STEMS)], { G: 10 });
  assert.deepEqual(yLabels(svg).map((t) => t.label), [">= 10", "0"]);
  assert.ok(!svg.includes("≥"), "no ≥ anywhere");
});

test("A15 a set maximum of 200 above every stem: y labels 0 and 200, no >=", () => {
  const svg = panels([gene(A13_STEMS)], { G: 200 });
  assert.deepEqual(yLabels(svg).map((t) => t.label), ["200", "0"]);
  assert.ok(!allTexts(svg).some((t) => t.includes(">=") || t.includes("≥")), "no >=");
});

// ---- review follow-up: the ends always labelled, tick marks not grid lines, no separator ----
test("A16 at width 400 the x labels keep 0 first and <len>aa last, in order, none overlapping (1499, 740, 393)", () => {
  for (const len of [1499, 740, 393]) {
    const placed = xLabelsPlaced(panelsAt(400, [gene(A13_STEMS, "G", len)]));
    const labels = placed.map((t) => t.label);
    assert.equal(labels[0], "0", len + ": 0 drawn first (" + labels.join(", ") + ")");
    assert.equal(labels[labels.length - 1], len + "aa", len + ": " + len + "aa drawn last (" + labels.join(", ") + ")");
    const boxes = placed.map((t) => {
      const w = t.label.length * 6;
      const left = t.anchor === "middle" ? t.x - w / 2 : t.anchor === "end" ? t.x - w : t.x;
      return { label: t.label, x: t.x, left, right: left + w };
    });
    for (let i = 1; i < boxes.length; i++) {
      assert.ok(boxes[i].x > boxes[i - 1].x, len + ": " + boxes[i].label + " right of " + boxes[i - 1].label);
      assert.ok(boxes[i].left > boxes[i - 1].right, len + ": " + boxes[i].label + " does not overlap " + boxes[i - 1].label);
    }
  }
});

test("A17 the y axis draws a short mark per tick ending at the axis line, no grid lines across", () => {
  const svg = panels([gene(A13_STEMS)]);
  const ax = yAxisX(svg), lines = yTickLines(svg);
  for (const l of lines) {
    assert.ok(Math.abs(l.x2 - l.x1) <= 8, "a mark at y " + l.y + " is " + Math.abs(l.x2 - l.x1) + "px long, not a grid line");
    assert.ok(Math.abs(Math.max(l.x1, l.x2) - ax) < 0.06, "the mark at y " + l.y + " ends at the axis line");
  }
  assert.equal(lines.length, 8, "one mark per tick of lollipopYTicks(136): 0, 20, …, 120, 136");
  assert.equal(tickYs(svg).length, 8, "8 distinct tick heights");
  assert.equal(headY(svg, 12), tickYs(svg)[0], "the 136 stem's head sits at the top mark");
});

test("A18 a length not from Genome Nexus: the subtitle reads axis runs to codon 1068, no separator", () => {
  const g = { ...gene(A13_STEMS, "G", 1068), lengthSource: "observed", proteinLength: 1068 } as HotspotGene;
  const svg = panels([g]);
  const sub = allTexts(svg).find((t) => t.includes("axis runs to codon"));
  assert.ok(sub, "a subtitle naming the axis's end");
  assert.ok(sub.includes("axis runs to codon 1068"), "reads 1068: " + sub);
  assert.ok(!sub.includes("1,068"), "no thousands separator: " + sub);
});
