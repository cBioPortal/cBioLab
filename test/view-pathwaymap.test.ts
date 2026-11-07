// The pathwaymap view (lib/views/pathwaymap/): PathwayMapper's vendored library read as PathwayMapper
// reads it, its four ranking scores, the runner driven with hand-made participants (panel-aware %,
// summed across studies, N/P never 0%), the figure linted at the widths a card takes, and the page's
// browser-applied settings.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PATHWAYS, PANCAN_PATHWAYS, LIBRARY_GENES, parsePathway, pathwayNamed, GENE_SYMBOL } from "../lib/views/pathwaymap/library.ts";
import { rankPathways, scorePathway, arrangeFor, rankProblem, rankSettingsOf, rankingPct, round2 } from "../lib/views/pathwaymap/rank.ts";
import { runPathwayMap } from "../lib/views/pathwaymap/run.ts";
import { pathwayMapSvg, nodeBoxes } from "../lib/views/pathwaymap/figure.ts";
import { pathwaymapKind } from "../lib/views/pathwaymap/kind.ts";
import { frequencyColor } from "../lib/oncoprint-style.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation } from "../lib/types.ts";
import type { PathwayMapResult } from "../lib/views/pathwaymap/types.ts";
import { PRIMARY } from "../lib/ch.ts";

/** a pathway in PathwayMapper's text format: gene nodes in one row, A → B → … */
const lines = (name: string, genes: string[], extra: string[] = []) => [name, "", "about " + name, "", "--NODE_NAME\tNODE_ID\tNODE_TYPE\tPARENT_ID\tPOSX\tPOSY--",
  ...genes.map((g, i) => g + "\tn" + i + "\tGENE\t-1\t" + (100 + i * 170) + "\t100\t"), ...extra, "", "--EDGE_ID\tSOURCE\tTARGET\tEDGE_TYPE",
  ...genes.slice(1).map((_, i) => "e" + i + "\tn" + i + "\tn" + (i + 1) + "\tACTIVATES"), ""];

describe("the vendored library", () => {
  test("55 pathways, the ten PanCanAtlas ones among them, every edge between nodes it has", () => {
    assert.equal(PATHWAYS.length, 55);
    assert.deepEqual(PATHWAYS.filter((p) => p.pancan).map((p) => p.name).sort(), [...PANCAN_PATHWAYS].sort());
    for (const p of PATHWAYS) {
      const ids = new Set(p.nodes.map((n) => n.id));
      for (const e of p.edges) assert.ok(ids.has(e.source) && ids.has(e.target), p.name + " " + e.id);
      for (const n of p.nodes) if (n.parent) assert.ok(ids.has(n.parent), p.name + " " + n.id);
      assert.ok(p.genes.length > 0, p.name);
    }
    assert.equal(LIBRARY_GENES.length, new Set(LIBRARY_GENES).size);
    assert.ok(LIBRARY_GENES.every((g) => GENE_SYMBOL.test(g)));
    assert.ok(!LIBRARY_GENES.includes("NF-kB") && !LIBRARY_GENES.includes("WNT ligands"), "a label is not a gene");
    assert.ok(!LIBRARY_GENES.includes("AKT") && !LIBRARY_GENES.includes("FAM123B"), "nor a name no gene table has");
    assert.equal(LIBRARY_GENES.length, 212);
  });
  test("RTK-RAS: its genes, compounds and sizes as PathwayMapper stores them", () => {
    const p = pathwayNamed("RTK-RAS")!;
    assert.ok(["KRAS", "NRAS", "HRAS", "EGFR", "ERBB2", "BRAF", "NF1", "PTPN11"].every((g) => p.genes.includes(g)));
    const nras = p.nodes.find((n) => n.name === "NRAS")!;
    assert.equal(p.nodes.find((n) => n.id === nras.parent)!.name, "RAS");
    assert.deepEqual([nras.w, nras.h], [150, 52]);
    const proc = p.nodes.find((n) => n.type === "PROCESS")!;
    assert.equal(proc.w, proc.name.length * 6 + 24);
  });
  test("parsing: sizes when given, an unknown parent dropped, an unknown type refused", () => {
    const p = parsePathway(lines("X", ["A", "B"], ["Fam\tf\tFAMILY\tnope\t10\t10\t80\t40"]));
    assert.deepEqual(p.genes, ["A", "B"]);
    const fam = p.nodes.find((n) => n.id === "f")!;
    assert.deepEqual([fam.parent, fam.w, fam.h], [null, 80, 40]);
    assert.equal(p.edges.length, 1);
    assert.throws(() => parsePathway(lines("Y", ["A"], ["Q\tq\tBLOB\t-1\t1\t1"])), /unknown node type BLOB/);
    assert.throws(() => parsePathway(["Z", "", ""]), /no node table/);
  });
  test("compound boxes enclose their children, padded", () => {
    const p = pathwayNamed("RTK-RAS")!, boxes = nodeBoxes(p);
    for (const n of p.nodes.filter((x) => x.parent)) {
      const c = boxes.get(n.id)!, b = boxes.get(n.parent!)!;
      assert.ok(b.x0 < c.x0 && b.y0 < c.y0 && b.x1 > c.x1 && b.y1 > c.y1, n.name);
    }
  });
});

describe("ranking, as PathwayMapper scores it", () => {
  // PathwayMapper's own help example: genes A, B, C altered 0.5, 0.2 and 0.3; a pathway of B, C, D and E
  const lib = [parsePathway(lines("P", ["B", "C", "D", "E"])), parsePathway(lines("Q", ["A", "F"])), parsePathway(lines("R", ["Z"]))];
  const pct: Record<string, number> = { A: 0.5, B: 0.2, C: 0.3 };
  const of = (g: string) => pct[g] ?? null;
  test("the four scores", () => {
    const p = lib[0], q = ["A", "B", "C"];
    assert.equal(scorePathway(p, q, of, { rank: "count", byFrequency: false }).score, 2);
    assert.equal(scorePathway(p, q, of, { rank: "percent", byFrequency: false }).score, 50);
    assert.equal(scorePathway(p, q, of, { rank: "count", byFrequency: true }).score, 0.5);
    // the code's formula, |m|·f/n — PathwayMapper's help text says f/n (0.125)
    assert.equal(scorePathway(p, q, of, { rank: "percent", byFrequency: true }).score, 0.25);
    assert.deepEqual(scorePathway(p, q, of, { rank: "count", byFrequency: false }).matched, ["B", "C"]);
  });
  test("a gene profiled nowhere adds nothing; each % is rounded to 2 decimals first", () => {
    const p = lib[0];
    assert.equal(scorePathway(p, ["B", "D"], (g) => g === "B" ? 1.005 : null, { rank: "count", byFrequency: true }).frequencySum, round2(1.005));
    assert.equal(rankingPct([{ pct: null }, { pct: 3 }, { pct: 7 }]), 7);
    assert.equal(rankingPct([{ pct: null }]), null);
  });
  test("best first; ties by summed %, then by name; the PanCanAtlas filter", () => {
    const r = rankPathways(["A", "B"], of, { rank: "count", byFrequency: false, pancanOnly: false }, lib);
    assert.deepEqual(r.map((x) => x.name), ["Q", "P", "R"]);   // 1 each for P and Q; Q's A (0.5) outweighs P's B (0.2)
    assert.deepEqual(rankPathways(["X"], of, { rank: "count", byFrequency: false, pancanOnly: false }, lib).map((x) => x.name), ["P", "Q", "R"]);
    assert.deepEqual(rankPathways(["TP53"], () => 1, { rank: "count", byFrequency: false, pancanOnly: true }).map((x) => x.name).length, 10);
  });
  test("settings: defaults, and a refusal for what cannot be honoured", () => {
    assert.deepEqual(rankSettingsOf({}), { rank: "count", byFrequency: false, pancanOnly: true });
    assert.deepEqual(rankSettingsOf({ rank: "percent", byFrequency: true, pancanOnly: false }), { rank: "percent", byFrequency: true, pancanOnly: false });
    assert.equal(rankProblem({}), null);
    assert.match(rankProblem({ rank: "best" })!, /rank is "count" or "percent"; got "best"/);
    assert.match(rankProblem({ byFrequency: "yes" })!, /byFrequency is true or false/);
    assert.match(rankProblem({ pancanOnly: 1 })!, /pancanOnly is true or false/);
    assert.match(rankProblem({ pathway: "Apoptosis" })!, /no pathway named “Apoptosis” — PathwayMapper's library has 55: ACC-2016/);
    assert.match(rankProblem({ pathway: "GBM-2013-TP53-pathway" })!, /not one of the ten TCGA PanCanAtlas pathways.*pancanOnly: false/);
    assert.equal(rankProblem({ pathway: "GBM-2013-TP53-pathway", pancanOnly: false }), null);
  });
  test("arranging: the spec's pathway, or the ranking's first; its label nodes named", () => {
    const base = { query: ["KRAS", "NRAS"], genes: [{ gene: "KRAS", cells: [{ pct: 10 }] }, { gene: "NRAS", cells: [{ pct: 3 }] }] };
    const a = arrangeFor(base, {});
    assert.equal(a.pathway, "RTK-RAS");
    assert.equal(a.defaulted, true);
    const b = arrangeFor(base, { pathway: "WNT" });
    assert.deepEqual([b.pathway, b.defaulted], ["WNT", false]);
    assert.ok(b.labels.includes("WNT ligands") && b.labels.includes("SFRP3") && !b.labels.includes("AMER1"));
    assert.throws(() => arrangeFor(base, { pathway: "nope" }), /no pathway named/);
  });
});

// ---- the runner, with hand-made participants ----
type GC = { profiled: number; altered: number };
function participant(id: string, data: Record<string, Record<string, GC>>) {
  return {
    instance: { id, mode: "patient-level", label: id, conn: PRIMARY },
    async geneCounts(def: { name: string }, genes: string[]) {
      const d = data[def.name] ?? {};
      return genes.map((g) => ({ gene: g, profiled: d[g]?.profiled ?? 0, altered: d[g]?.altered ?? 0, driver: 0,
        byType: { mutation: { profiled: 0, altered: 0 }, cna: { profiled: 0, altered: 0 }, structuralVariant: { profiled: 0, altered: 0 } } }));
    },
  };
}
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0], name: n }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = (view: Record<string, unknown>, c: ViewRun) => runPathwayMap({ kind: "pathwaymap", ...view } as never, c);
const pmOf = (r: unknown) => (r as { pathwaymap: PathwayMapResult }).pathwaymap;

// two studies; KRAS is on s1's panel only, so its denominator is s1's 100 samples; BRAF is on no panel
const S1 = { A: { KRAS: { profiled: 100, altered: 30 }, NRAS: { profiled: 100, altered: 5 }, TP53: { profiled: 100, altered: 40 } } };
const S2 = { A: { NRAS: { profiled: 50, altered: 5 }, TP53: { profiled: 50, altered: 10 } } };
const two = () => ctx({ A: cohort({ s1: 100, s2: 50 }) }, { s1: participant("s1", S1), s2: participant("s2", S2) });

describe("pathwaymap: the runner", () => {
  test("panel-aware %: summed across studies, over the samples profiled for THAT gene; profiled nowhere is N/P", async () => {
    const r = await run({ genes: ["kras", "NRAS", "TP53"] }, two());
    assert.equal(r.error, undefined);
    const pm = pmOf(r), cell = (g: string) => pm.genes.find((x) => x.gene === g)!.cells[0];
    assert.deepEqual(cell("KRAS"), { cohort: "A", profiled: 100, altered: 30, pct: 30 });
    assert.deepEqual(cell("NRAS"), { cohort: "A", profiled: 150, altered: 10, pct: 6.67 });
    assert.deepEqual(cell("BRAF"), { cohort: "A", profiled: 0, altered: 0, pct: null });
    assert.deepEqual(pm.query, ["KRAS", "NRAS", "TP53"]);
    assert.equal(pm.queryFrom, "genes");
    assert.equal(pm.genes.length, LIBRARY_GENES.length);
    assert.equal(pm.pathway, "RTK-RAS");          // two query genes; TP53 holds one
    assert.equal(pm.ranked[0].score, 2);
    assert.equal(pm.ranked.length, 10);
    assert.match(r.caveat!, /N\/P, never 0%/);
    assert.match(r.caveat!, /summed across 2 studies/);
  });
  test("the method record's checks: every ranked score and each drawn gene's %", async () => {
    const r = await run({ genes: ["KRAS", "NRAS", "TP53"], byFrequency: true }, two());
    const check = r.method!.check!;
    assert.equal(check["pathwaymap:RTK-RAS:score"].v, 36.67);
    assert.equal(check["pathwaymap:KRAS:A:pct"].v, 30);
    assert.equal(check["pathwaymap:BRAF:A:pct"], undefined, "a gene profiled nowhere has no %");
    assert.match(r.method!.python!, /pathwaymap:\{name\}:score/);
  });
  test("without genes, the library genes altered in the cohort are the query", async () => {
    const pm = pmOf(await run({}, two()));
    assert.equal(pm.queryFrom, "altered");
    assert.deepEqual(pm.query, ["KRAS", "NRAS", "TP53"]);
  });
  test("refusals: cohorts, gene symbols, the query's size, an empty cohort, nothing profiled", async () => {
    const err = async (view: Record<string, unknown>, c = two()) => (await run(view, c)).error!;
    const five = ctx(Object.fromEntries(["A", "B", "C", "D", "E"].map((n) => [n, cohort({ s1: 5 })])), { s1: participant("s1", {}) });
    assert.match(await err({}, five), /at most 4 cohorts; this asks for 5/);
    assert.match(await err({ genes: "TP53" }), /genes is a list of gene symbols/);
    assert.match(await err({ genes: ["TP53", "TP53: MUT"] }), /not a gene symbol: "TP53: MUT"/);
    assert.match(await err({ genes: Array.from({ length: 101 }, (_, i) => "G" + i) }), /at most 100 query genes; this asks for 101/);
    assert.match(await err({}, ctx({ A: cohort({ s1: 0 }) }, { s1: participant("s1", S1) })), /cohort “A” is empty/);
    assert.match(await err({}, ctx({ A: cohort({ s1: 10 }) }, { s1: participant("s1", {}) })), /profiled for any gene/);
  });
  test("a pathway the library lacks is refused by name, with the counts kept for the page", async () => {
    const r = await run({ genes: ["KRAS"], pathway: "nope" }, two());
    assert.match(r.error!, /no pathway named “nope”/);
    assert.equal(pmOf(r).pathway, "RTK-RAS");
  });
});

describe("pathwaymap: the figure", () => {
  const result = async (view: Record<string, unknown> = { genes: ["KRAS", "NRAS", "TP53"] }, c = two()) => await run(view, c) as never;
  test("drawn at every width a card takes with no text too small, outside or overprinted", async () => {
    for (const pathway of ["RTK-RAS", "WNT", "HIPPO", "NOTCH"]) {
      const v = await result({ genes: ["KRAS", "NRAS", "TP53"], pathway });
      for (const width of [560, 936, 1352]) {
        const svg = pathwayMapSvg(v, { width, theme: "light" });
        assert.deepEqual(lintSvg(svg).map((i) => i.detail), [], pathway + " at " + width);
      }
    }
  });
  test("a node's % on PathwayMapper's scale, N/P for a gene profiled nowhere, the query genes and the ranking in the caption", async () => {
    const svg = pathwayMapSvg(await result(), { width: 936, theme: "light" });
    assert.match(svg, /RTK-RAS — altered % per gene/);
    assert.ok(svg.includes(`fill="${frequencyColor(30)}"`), "KRAS's box");
    assert.match(svg, />30\.0%</);
    assert.match(svg, />N\/P</);
    assert.match(svg, /KRAS \(query gene\) — A: 30\.0% \(30 of 100 profiled samples\)/);
    const words = svg.replace(/<title>[^<]*<\/title>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(words, /best-ranked TCGA PanCanAtlas pathway by the number of query genes it holds \(score 2; KRAS, NRAS\)/);
    assert.match(words, /Not profiled in any sample, so N\/P rather than 0%: [A-Z0-9, ]*BRAF/);
  });
  test("several cohorts: one box each, in the order the legend gives", async () => {
    const c = ctx({ A: cohort({ s1: 100 }), B: cohort({ s1: 100 }) }, { s1: participant("s1", { A: S1.A, B: { KRAS: { profiled: 100, altered: 2 } } }) });
    const svg = pathwayMapSvg(await result({ genes: ["KRAS"] }, c), { width: 936, theme: "light" });
    assert.match(svg, /1\. A/);
    assert.match(svg, /2\. B/);
    assert.match(svg, /KRAS \(query gene\) — A: 30\.0% \(30 of 100 profiled samples\); B: 2\.0% \(2 of 100 profiled samples\)/);
  });
  test("narrower than the diagram allows, it keeps its size and scrolls", async () => {
    const svg = pathwayMapSvg(await result({ genes: ["KRAS"], pathway: "NOTCH" }), { width: 560, theme: "light" });
    assert.match(svg, /min-width:/);
  });
  test("the scale: white at 0%, four fifths of the way to red at 100% (log 1 + %)", () => {
    assert.equal(frequencyColor(0), "#ffffff");
    assert.equal(frequencyColor(100), "#ff3333");
    assert.equal(frequencyColor(250), "#ff3333");
    const g = (c: string) => parseInt(c.slice(3, 5), 16);
    assert.ok(g(frequencyColor(1)) > g(frequencyColor(10)) && g(frequencyColor(10)) > g(frequencyColor(50)));
  });
  test("the descriptor: figure, title and results text", async () => {
    const v = await result() as never as { pathwaymap: PathwayMapResult };
    assert.ok(pathwaymapKind.figure!(v as never, { width: 720 })!.startsWith("<svg"));
    assert.equal(pathwaymapKind.title!(v as never), "RTK-RAS: pathway diagram");
    const out: string[] = [];
    pathwaymapKind.text!(v as never, { out, pFmt: String, caveatOf: () => "", noteOf: () => "", plotUnit: () => "", methodOf: () => "" });
    assert.match(out[0], /PathwayMapper pathway RTK-RAS \(best-ranked; ranked by count, TCGA PanCanAtlas pathways; query KRAS NRAS TP53\)/);
    assert.match(out[0], /RTK-RAS 2 \(KRAS,NRAS\)/);
    assert.match(out[0], /KRAS A 30%/);
  });
});
