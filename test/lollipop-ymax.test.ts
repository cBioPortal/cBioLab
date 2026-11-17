// The lollipop's Y-Axis Max (MUT-LP-2, MUT-STM-17, the "≥" of MUT-LP-6): the default maximum, the
// view's `yMax` check, the figure's capped axis, the hotspots view carrying it, and the control
// (app/_lollipop/HotspotsBody.tsx). Row ids are the spec table's (Y1–Y9). New exports are read off the
// module at run time, so this file loads before they exist.
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
const { runHotspots } = await import("../lib/views/hotspots/run.ts");
const { Untimed } = await import("../lib/views/run.ts");
const { hotspotsSvg } = await import("../lib/views/hotspots/figure.ts");
const { dataPart } = await import("../app/_oncoprint/view-data.ts");
const { resultsLayout } = await import("../app/portal/results-layout.ts");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { HotspotsBody } = await import("../app/_lollipop/HotspotsBody.tsx");
type HotspotGene = import("../lib/views/hotspots/types.ts").HotspotGene;
type ViewRun = import("../lib/views/run.ts").ViewRun;

const defaultYMax = (g: unknown) => (lib.defaultYMax as (g: unknown) => number)(g);
const checkYMax = (y: unknown, genes: string[]) => (lib.checkYMax as (y: unknown, g: string[]) => string | null)(y, genes);
// the fifth argument is new; called loosely so the file compiles before it exists
const panels = (genes: HotspotGene[], yMax?: Record<string, number>) =>
  (svgLib.lollipopPanelsSvg as (...a: unknown[]) => string)(genes, { width: 720 }, "", undefined, ...(yMax === undefined ? [] : [yMax]));

const report = (gene: string, stems: [number, number][]) => ({
  changes: stems.map(([pos, n]) => ({ gene, pos, change: "X" + pos + "Y", n, rows: n, driver: true, impact: "missense" })),
  types: stems.map(([pos, n]) => ({ gene, pos, mtype: "Missense_Mutation", driver: true, rows: n })),
  totals: [{ gene, patients: stems.reduce((s, [, n]) => s + n, 0), pairs: stems.reduce((s, [, n]) => s + n, 0), somaticSamples: 1 }],
  cohortSamples: 500, minCount: 1, annotated: true,
});
const gene = (stems: [number, number][], name = "G") =>
  buildLollipopGene(name, [report(name, stems)] as never, { proteinLength: 189, transcriptId: "T", domains: [] }) as HotspotGene;

/** the y axis's ticks: each grid line's y and the label drawn on it */
function yTicks(svg: string) {
  const out: { y: number; label: string }[] = [];
  for (const m of svg.matchAll(/<line x1="[^"]*" y1="([^"]*)" x2="[^"]*" y2="\1"[^>]*\/><text [^>]*text-anchor="end">([^<]*)<\/text>/g)) out.push({ y: Number(m[1]), label: m[2] });
  return out;
}
const topTick = (ts: { y: number; label: string }[]) => [...ts].sort((a, b) => a.y - b.y)[0];
const headY = (svg: string, pos: number) => {
  const m = svg.match(new RegExp(`data-codon="${pos}"[^>]*>[\\s\\S]*?<circle class="lollipop-head"[^>]* cy="([^"]*)"`));
  assert.ok(m, "a head at codon " + pos);
  return Number(m[1]);
};

test("Y1 defaultYMax = max(5, the tallest stem)", () => {
  assert.equal(typeof lib.defaultYMax, "function", "lib/lollipop.ts exports defaultYMax");
  assert.equal(defaultYMax(gene([[12, 3], [61, 2]])), 5);
  assert.equal(defaultYMax(gene([[12, 12], [61, 40]])), 40);
  assert.equal(defaultYMax(gene([])), 5);
});

test("Y2 checkYMax accepts nothing set and a number for a gene of the view", () => {
  assert.equal(typeof lib.checkYMax, "function", "lib/lollipop.ts exports checkYMax");
  assert.equal(checkYMax(undefined, ["KRAS"]), null);
  assert.equal(checkYMax({ KRAS: 100 }, ["KRAS"]), null);
});

test("Y3 checkYMax refuses a malformed yMax, naming the problem", () => {
  assert.equal(typeof lib.checkYMax, "function", "lib/lollipop.ts exports checkYMax");
  assert.match(checkYMax([1], ["KRAS"]) ?? "", /yMax.*object/);
  assert.match(checkYMax("x", ["KRAS"]) ?? "", /yMax.*object/);
  assert.match(checkYMax({ EGFR: 5 }, ["KRAS"]) ?? "", /EGFR.*not a gene of this view/);
  assert.match(checkYMax({ KRAS: "a" }, ["KRAS"]) ?? "", /yMax\.KRAS/);
  assert.match(checkYMax({ KRAS: Infinity }, ["KRAS"]) ?? "", /yMax\.KRAS/);
  for (const v of [2.5, 0, -3]) assert.match(checkYMax({ KRAS: v }, ["KRAS"]) ?? "", /yMax\.KRAS.*a whole number of at least 1/, String(v));
  assert.equal(checkYMax({ KRAS: 1 }, ["KRAS"]), null);
});

test("Y4 a maximum below the tallest stem: the top tick reads ≥10, the stem is capped there", () => {
  const svg = panels([gene([[12, 40], [61, 3]])], { G: 10 });
  const ticks = yTicks(svg), top = topTick(ticks);
  assert.equal(top.label, "≥10");
  assert.equal(headY(svg, 12), top.y, "the 40 stem's head sits on the top tick");
  assert.ok(!ticks.some((t) => t.label === "40" || t.label === "≥40"), "the axis does not run to 40");
});

test("Y5 a maximum above the tallest stem: the top tick reads 100, the stem below it", () => {
  const svg = panels([gene([[12, 40], [61, 3]])], { G: 100 });
  const ticks = yTicks(svg), top = topTick(ticks);
  assert.equal(top.label, "100");
  assert.ok(!svg.includes("≥"));
  assert.ok(headY(svg, 12) > top.y, "the 40 stem's head is below the top");
});

test("Y6 a maximum below 1 is drawn as 1", () => {
  const g = gene([[12, 40]]);
  const one = panels([g], { G: 1 });
  assert.equal(topTick(yTicks(one)).label, "≥1");
  assert.equal(panels([g], { G: 0 }), one);
  assert.equal(panels([g], { G: -3 }), one);
});

test("Y7 no maximum set draws today's figure", () => {
  const g = gene([[12, 40], [61, 3]]);
  const today = svgLib.lollipopPanelsSvg([g], { width: 720 }, "", undefined);
  assert.equal(panels([g], undefined), today);
  assert.equal((svgLib.lollipopPanelsSvg as (...a: unknown[]) => string)([g], { width: 720 }, "", undefined, undefined), today);
});

test("Y8 the hotspots view checks yMax, returns it, and its figure draws the cap", async () => {
  const resolver = {
    instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
    cohortSql: () => "SELECT 1",
    lollipopCounts: async () => report("KRAS", [[12, 40], [13, 4]]),
  };
  const ctx = {
    doc: { study: "s1", cohorts: { Q: { study: "s1" } }, views: [] },
    cohorts: { Q: { studies: ["s1"], perStudy: { s1: { sql: "", count: 500, samples: 500, mode: "" } }, count: 500, samples: 500, text: "" } },
    resolvers: { s1: resolver }, vNames: ["Q"], vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean) => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7", studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
  } as unknown as ViewRun;
  const run = async (yMax: unknown) => {
    const r = await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"], yMax } as never, ctx);
    return (r instanceof Untimed ? r.result : r) as unknown as Record<string, unknown>;
  };
  const ok = await run({ KRAS: 10 });
  assert.equal(ok.error, undefined, String(ok.error));
  assert.deepEqual(ok.yMax, { KRAS: 10 });
  const svg = hotspotsSvg(ok as never, { width: 720 });
  assert.equal(topTick(yTicks(svg)).label, "≥10");
  const bad = await run({ EGFR: 10 });
  assert.equal(typeof lib.checkYMax, "function");
  assert.equal(bad.error, checkYMax({ EGFR: 10 }, ["KRAS"]));
});

// ---- Y9: the control's rule (lib/lollipop.ts nextYMax) and its range's maximum ------------------
test("Y9 nextYMax: rounded, at least 1, undefined at the default, null for NaN", () => {
  assert.equal(typeof lib.nextYMax, "function", "lib/lollipop.ts exports nextYMax");
  const next = lib.nextYMax as (input: number, def: number) => number | undefined | null;
  assert.equal(next(40, 40), undefined);
  assert.equal(next(0, 40), 1);
  assert.equal(next(-3, 40), 1);
  assert.equal(next(300, 40), 300);
  assert.equal(next(12.6, 40), 13);
  assert.equal(next(Number.NaN, 40), null);
});

test("Y9 the control's range runs from 1 to the default maximum", () => {
  const html = renderToStaticMarkup(createElement(HotspotsBody, {
    v: { kind: "hotspots", hotspots: [gene([[12, 40], [61, 3]])] } as never, onHide: () => {}, onCodons: () => {}, onYMax: () => {} } as never));
  const range = html.match(/<input[^>]*type="range"[^>]*>/)?.[0];
  assert.ok(range, "a range input");
  assert.match(range, /min="1"/);
  assert.match(range, /max="40"/);
});

test("Y10 pruneYMax keeps the view's genes, undefined when none is left", () => {
  assert.equal(typeof lib.pruneYMax, "function", "lib/lollipop.ts exports pruneYMax");
  const prune = lib.pruneYMax as (y: Record<string, number> | undefined, genes: string[]) => Record<string, number> | undefined;
  assert.deepEqual(prune({ KRAS: 10, TP53: 20 }, ["KRAS"]), { KRAS: 10 });
  assert.equal(prune({ TP53: 20 }, ["KRAS"]), undefined);
  assert.equal(prune(undefined, ["KRAS"]), undefined);
});

test("Y11 dataPart of a hotspots view strips yMax", () => {
  const base = { kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"] };
  assert.deepEqual(dataPart({ ...base, yMax: { KRAS: 10 } }), dataPart(base));
});

test("Y12 the Mutations tab's gene chooser leaves the lollipop with no yMax", () => {
  const rq = { studies: ["a"], filters: [], entries: ["KRAS", "TP53"], genes: ["KRAS", "TP53"] };
  const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
    held: { every: ["MUTATION", "CNA"], some: ["SV"] } };
  const l = resultsLayout(rq as never, rdata as never);
  const tab = l.tabs.find((t) => t.title === "Mutations")!;
  const views = tab.views!.map((i) => l.doc.views![i]).map((v) => (v.kind === "hotspots" ? { ...v, yMax: { KRAS: 10 } } : v));
  const next = tab.chooser!.apply(views as never, "TP53") as unknown as Record<string, unknown>[];
  const lp = next.find((v) => v.kind === "hotspots");
  assert.ok(lp, "a lollipop view");
  assert.deepEqual(lp.genes, ["TP53"]);
  assert.equal(lp.yMax, undefined);
});

test("Y13 a set maximum has whole, distinct ticks topped by the cap", () => {
  for (const cap of [1, 2, 3]) {
    const labels = [...yTicks(panels([gene([[12, 40]])], { G: cap }))].sort((a, b) => b.y - a.y).map((t) => t.label);
    const nums = labels.map((s) => Number(s.replace("≥", "")));
    assert.ok(nums.every(Number.isInteger), cap + ": " + labels.join(","));
    assert.equal(new Set(nums).size, nums.length, cap + ": " + labels.join(","));
    assert.equal(labels.at(-1), "≥" + cap);
    if (cap === 1) assert.deepEqual(labels, ["0", "≥1"]);
  }
});
