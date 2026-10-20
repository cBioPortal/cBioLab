// The figure renderers are the one place a user-supplied string reaches markup
// that the app injects with dangerouslySetInnerHTML. They are also the surface
// a chat client renders. Both make escaping non-negotiable.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg, viewTitle, esc } from "../lib/view-svg.ts";
import { PLOT_POINT_R } from "../lib/figures/plot.ts";
import { buildLollipopGene } from "../lib/lollipop.ts";
import type { ViewResult } from "../lib/types.ts";
import { LAYER_BASE, LAYER_COLORS } from "../lib/plot-layers.ts";

const survival = (cohort: string): ViewResult => ({
  kind: "survival", cohorts: [cohort],
  curves: [{ cohort, points: [{ t: 0, s: 1 }, { t: 5, s: 0.5 }], median: 5, n: 10, events: 5 }],
  caveat: "a caveat that must travel with the figure"
});

describe("figure renderers escape everything a user can name", () => {
  test("a cohort name cannot inject markup", () => {
    const svg = viewToSvg(survival('<script>alert(1)</script>'))!;
    assert.ok(svg.includes("&lt;script&gt;"), "the tag must be escaped");
    assert.equal(svg.includes("<script>"), false, "raw script tag reached the SVG");
  });
  test("quotes and ampersands survive as entities", () => {
    assert.equal(esc('a & "b" <c>'), "a &amp; &quot;b&quot; &lt;c&gt;");
  });
});

describe("a figure always carries its caveat", () => {
  test("the caveat text is rendered into the SVG, not left to the caller", () => {
    const svg = viewToSvg(survival("A"))!;
    assert.ok(svg.includes("caveat that must travel"),
      "an image separated from its method is worse than the number it replaced");
  });
});

describe("renderers refuse rather than draw an empty frame", () => {
  test("an errored view yields no figure", () => {
    assert.equal(viewToSvg({ kind: "survival", error: "nothing to plot" }), null);
  });
  test("a view with an empty payload yields no figure", () => {
    assert.equal(viewToSvg({ kind: "survival", curves: [] }), null);
    assert.equal(viewToSvg({ kind: "cooccurrence", pairs: [] }), null);
    assert.equal(viewToSvg({ kind: "hotspots", hotspots: [] }), null);
  });
  test("an unknown kind yields no figure", () => {
    assert.equal(viewToSvg({ kind: "not-a-view" }), null);
  });
});

describe("cox: pooled vs stratified-by-cohort forest plots", () => {
  const coef = (label: string, hr: number) => ({ label, reference: "Not mutated", level: "Mutated", axisIndex: 0, beta: Math.log(hr), se: 0.1, hr, ciLow: hr * 0.7, ciHigh: hr * 1.3, p: 0.02 });
  test("a pooled fit draws one panel, one HR=1 reference line", () => {
    const v: ViewResult = { kind: "cox", cohorts: ["all"], cox: { coefficients: [coef("TP53", 1.2)], n: 100, events: 40 }, caveat: "pooled" };
    const svg = viewToSvg(v)!;
    assert.equal((svg.match(/HR = 1/g) || []).length, 1);
    assert.ok(svg.includes("TP53"));
  });
  test("stratifyByCohort draws one panel per cohort that fit, each headed by its own name and n", () => {
    const v: ViewResult = { kind: "cox", cohorts: ["NSCLC", "CRC"],
      cox: { coefficients: [], n: 150, events: 55, byCohort: [
        { cohort: "NSCLC", coefficients: [coef("TP53", 1.5)], n: 100, events: 40 },
        { cohort: "CRC", coefficients: [coef("TP53", 0.6)], n: 50, events: 15 },
      ] },
      caveat: "stratified" };
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("NSCLC — n = 100, 40 events"));
    assert.ok(svg.includes("CRC — n = 50, 15 events"));
    // one shared HR=1 axis label, not one per panel — the scale is shared across panels
    assert.equal((svg.match(/HR = 1/g) || []).length, 1);
  });
  test("a cohort that failed to fit is simply not drawn, not a blank panel", () => {
    const v: ViewResult = { kind: "cox", cohorts: ["NSCLC", "Empty"],
      cox: { coefficients: [], n: 100, events: 40, byCohort: [
        { cohort: "NSCLC", coefficients: [coef("TP53", 1.5)], n: 100, events: 40 },
        { cohort: "Empty", coefficients: [], n: 0, events: 0, error: "nothing to fit: cohort “Empty” is empty." },
      ] },
      caveat: "stratified, one failed" };
    const svg = viewToSvg(v)!;
    assert.ok(svg.includes("NSCLC"));
    assert.equal(svg.includes("Empty —"), false);
  });
  test("a view with every cohort's fit empty yields no figure, same as any other empty payload", () => {
    assert.equal(viewToSvg({ kind: "cox", cox: { coefficients: [], n: 0, events: 0, byCohort: [] } }), null);
  });
});

describe("logistic: forest plot of odds ratios", () => {
  const coef = (label: string, or: number) => ({ label, reference: "Not mutated", level: "Mutated", axisIndex: 0, beta: Math.log(or), se: 0.1, or, ciLow: or * 0.7, ciHigh: or * 1.3, p: 0.02 });
  test("draws one panel, one OR=1 reference line — same shape as cox's forest plot, an odds ratio instead of a hazard ratio", () => {
    const v: ViewResult = { kind: "logistic", cohorts: ["all"], logistic: { coefficients: [coef("APC", 0.3)], n: 471, events: 27 }, caveat: "logistic" };
    const svg = viewToSvg(v)!;
    assert.equal((svg.match(/OR = 1/g) || []).length, 1);
    assert.equal((svg.match(/HR = 1/g) || []).length, 0);
    assert.ok(svg.includes("APC"));
    assert.ok(svg.includes("0.3"));
  });
  test("a view with no coefficients yields no figure, same as any other empty payload", () => {
    assert.equal(viewToSvg({ kind: "logistic", logistic: { coefficients: [], n: 0, events: 0 } }), null);
  });
});

describe("figures scale uniformly", () => {
  // preserveAspectRatio="none" shears circles and slants text; it forced the
  // lollipop out of SVG once already and must not come back.
  test("no renderer disables aspect-ratio preservation", () => {
    const svg = viewToSvg(survival("A"))! + (viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [kras()] }) || "");
    assert.equal(/preserveAspectRatio\s*=\s*"none"/.test(svg), false);
  });
  test("titles name the view and its cohorts", () => {
    assert.equal(viewTitle(survival("TP53 mut")), "OS survival — TP53 mut");
  });
});

describe("survival: tick interval and cutoff controls reach the SVG", () => {
  test("tickMonths changes which month labels are drawn", () => {
    const svg = viewToSvg({ ...survival("A"), tickMonths: 6 })!;
    assert.ok(svg.includes(">6</text>") && svg.includes(">Months</text>"), "a 6-month tick should be drawn, which the default 12mo spacing would skip");
  });
  test("cutoffMonths caps the x-axis", () => {
    const svg = viewToSvg({ ...survival("A"), cutoffMonths: 5 })!;
    assert.ok(svg.includes(">0</text>") && !svg.includes(">10</text>") && !svg.includes(">12</text>"), "the axis must not run past a 5-month cutoff");
  });
});

describe("survival: the number at risk under each tick", () => {
  const withRisk = (): ViewResult => ({ kind: "survival", cohorts: ["A", "B"], curves: [
    { cohort: "A", points: [{ t: 0, s: 1 }, { t: 6, s: 0.5 }, { t: 25, s: 0.3 }], median: 6, n: 1200, events: 600, atRisk: Array.from({ length: 30 }, (_, m) => 1200 - m * 40) },
    { cohort: "B", points: [{ t: 0, s: 1 }, { t: 10, s: 0.7 }], median: null, n: 80, events: 20, atRisk: Array.from({ length: 13 }, (_, m) => 80 - m * 5) },
  ] } as any);
  test("each cohort's row gives its count at every tick, zero past its follow-up", () => {
    const svg = viewToSvg(withRisk(), { width: 900 })!;
    assert.match(svg, />Number at risk</);
    assert.match(svg, /<title>A: 1,200 at risk at 0 months<\/title>1,200</);
    assert.match(svg, /<title>A: 720 at risk at 12 months<\/title>720</);
    assert.match(svg, /<title>B: 20 at risk at 12 months<\/title>20</);
    assert.match(svg, /<title>B: 0 at risk at 24 months<\/title>0</);
  });
  test("a result without counts draws no table", () => {
    assert.doesNotMatch(viewToSvg(survival("A"))!, />Number at risk</);
  });
});

describe("survival: cumulative incidence display mode", () => {
  test("the legend reads as incidence, not median survival", () => {
    const svg = viewToSvg({ ...survival("A"), display: "incidence" })!;
    assert.ok(svg.includes("50% incidence by"), "the legend should read as incidence, not median survival");
  });
});

// A site report for buildLollipopGene: one change per codon unless given
function report(changes: { pos: number | null; change: string; n: number; mtype?: string; driver?: boolean }[], extra: Partial<any> = {}) {
  return {
    changes: changes.map((c) => ({ gene: "G", pos: c.pos, change: c.change, n: c.n, rows: c.n, driver: c.driver ?? true })),
    types: changes.map((c) => ({ gene: "G", pos: c.pos, mtype: c.mtype || "Missense_Mutation", driver: c.driver ?? true, rows: c.n })),
    totals: [{ gene: "G", patients: changes.reduce((a, c) => a + c.n, 0), pairs: changes.reduce((a, c) => a + c.n, 0), somaticSamples: 5 }],
    cohortSamples: 50, minCount: 1, annotated: true, ...extra
  };
}
function kras() {
  const g = buildLollipopGene("G", [report([{ pos: 12, change: "G12D", n: 6 }, { pos: 12, change: "G12V", n: 3 }, { pos: 61, change: "Q61H", n: 1 }])],
    { proteinLength: 189, transcriptId: "ENST00000311936", domains: [{ accession: "PF00071", name: "Ras", start: 5, end: 164 }] });
  return { ...g, gene: "KRAS" };
}

describe("the lollipop draws every codon, the way the portal's mutation tab does", () => {
  test("one head per codon — 150 codons, 150 heads, with no cap", () => {
    const g = buildLollipopGene("G", [report(Array.from({ length: 150 }, (_, i) => ({ pos: i + 1, change: "X" + (i + 1) + "Y", n: 1 + (i % 4) })))],
      { proteinLength: 400, transcriptId: "T", domains: [] });
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [g] } as any)!;
    assert.equal((svg.match(/<circle [^>]*r="2\.8"/g) || []).length, 150);
  });
  test("the tallest codon is labelled, its changes factored the portal's way", () => {
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [kras()] } as any)!;
    assert.ok(svg.includes(">G12D/V<"), "G12D and G12V share the prefix G12");
  });
  test("the protein runs to its length, with its Pfam domain named on the backbone", () => {
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [kras()] } as any)!;
    assert.ok(svg.includes(">189aa<") && svg.includes(">Ras<"));
    assert.ok(svg.includes("># KRAS Mutations<"), "the portal's y-axis label");
  });
  test("the figure is the plot alone; the frequency and the Driver/VUS counts travel in its caption", () => {
    const g = { ...kras(), ids: { refseq: "NM_004985", ensembl: "ENST00000311936.3", ccds: "CCDS8702", uniprotAccession: "P01116", uniprotName: "RASK_HUMAN" } };
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [g] } as any)!;
    assert.ok(!svg.includes("Somatic Mutation Frequency") && !svg.includes("NM_004985"), "the gene summary is the app's control, not the figure's");
    assert.ok(!svg.includes(">Driver<") && !svg.includes(">VUS<"), "no badge grid in the figure");
    assert.ok(svg.includes("somatic mutation frequency 10.0%"), "5 of 50 samples, in words");
    assert.ok(svg.includes("missense 10 driver / 0 VUS"), "the tally, in words");
  });
  test("a hidden cell leaves its changes out of the figure, and the caption says so", () => {
    const g = buildLollipopGene("G", [report([{ pos: 12, change: "G12D", n: 6 }, { pos: 61, change: "Q61*", n: 2, mtype: "Nonsense_Mutation" }].map((c) => c),
      { changes: [{ gene: "G", pos: 12, change: "G12D", n: 6, rows: 6, driver: true, impact: "missense" }, { gene: "G", pos: 61, change: "Q61*", n: 2, rows: 2, driver: true, impact: "truncating" }] })],
      { proteinLength: 189, transcriptId: "T", domains: [] });
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [g], hide: ["missense.driver"] } as any)!;
    assert.equal((svg.match(/<circle [^>]*r="2\.8"/g) || []).length, 1, "only the truncating codon is drawn");
    const words = svg.replace(/<\/text>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    assert.ok(words.includes("Hidden: Missense · Driver") && words.includes("drawn: 2 of 8 mutations"));
  });
  test("a codon's tooltip lists its changes with their counts", () => {
    const svg = viewToSvg({ kind: "hotspots", cohorts: ["A"], hotspots: [kras()] } as any)!;
    assert.match(svg, /<title>codon 12: 9 mutations\nG12D 6\nG12V 3<\/title>/);
  });
});

describe("clinical course figures show the denominator, not just the curve", () => {
  const mk = (over: Record<string, unknown> = {}) => ({
    kind: "course", cohorts: ["A", "B"],
    courseAxis: { binMonths: 3, from: -12, to: 24 },
    caveat: "Aligned on first Treatment.",
    course: [
      { cohort: "A", eventType: "Treatment", variants: ["Treatment", "TREATMENT"], isInterval: true,
        points: [-12, 0, 12, 24].map((t) => ({ t, atRisk: 1000, n: 500, pct: 50 })) },
      { cohort: "B", eventType: "Treatment", variants: ["Treatment"], isInterval: true,
        points: [-12, 0, 12, 24].map((t) => ({ t, atRisk: 800, n: 200, pct: 25 })) }
    ], ...over
  });

  test("the at-risk row is printed — a curve over 40 must not look like one over 24,000", () => {
    const svg = viewToSvg(mk() as any)!;
    assert.match(svg, /patients still observable/);
    assert.ok(svg.includes("1,000") && svg.includes("800"), "risk counts belong in the figure");
  });

  test("an interval event reads as a state, a point event as an occurrence", () => {
    assert.match(viewToSvg(mk() as any)!, /% in this state/);
    const point = mk({ course: [{ cohort: "A", eventType: "Surgery", variants: ["Surgery"], isInterval: false,
      points: [{ t: 0, atRisk: 10, n: 3, pct: 30 }] }] });
    assert.match(viewToSvg(point as any)!, /% with an event/);
  });

  test("the line stops where too few remain observable, and says so", () => {
    const thin = mk({ course: [{ cohort: "A", eventType: "Treatment", variants: ["Treatment"], isInterval: true,
      points: [{ t: 0, atRisk: 900, n: 450, pct: 50 }, { t: 12, atRisk: 3, n: 3, pct: 100 }] }] });
    const svg = viewToSvg(thin as any)!;
    assert.match(svg, /fewer than 10 patients remain observable/,
      "truncation must be disclosed, not left to be inferred from a line that just ends");
  });

  test("cohort names are escaped — they reach <text> and are user input", () => {
    const evil = mk({ cohorts: ["<script>x</script>"],
      course: [{ cohort: "<script>x</script>", eventType: "Treatment", variants: ["Treatment"], isInterval: true,
        points: [{ t: 0, atRisk: 50, n: 25, pct: 50 }] }] });
    const svg = viewToSvg(evil as any)!;
    assert.equal(svg.includes("<script>"), false);
    assert.match(svg, /&lt;script&gt;/);
  });

  test("a course with no series renders nothing rather than an empty frame", () => {
    assert.equal(viewToSvg({ kind: "course", course: [] } as any), null);
    assert.equal(viewToSvg({ kind: "course", error: "no temporal information" } as any), null);
  });

  test("the title names the event types", () => {
    assert.equal(viewTitle(mk() as any), "Clinical course — Treatment — A vs B");
  });
});

describe("sequence Sankey keeps everyone accounted for", () => {
  const mk = () => ({
    kind: "sequence", cohorts: ["A"], caveat: "Lines of therapy.",
    sequence: {
      labelKey: "SUBTYPE", lineGap: 90, steps: 2, foldedLabels: 3, truncated: false,
      panels: [{
        cohort: "A", started: 140, censored: 70,
        nodes: [
          { column: 1, label: "Chemo", n: 100, kind: "regimen" },
          { column: 1, label: "Hormone", n: 40, kind: "regimen" },
          { column: 2, label: "Chemo", n: 30, kind: "regimen" },
          { column: 2, label: "", n: 40, kind: "stopped" },
          { column: 2, label: "", n: 70, kind: "censored" }
        ],
        flows: [
          { column: 1, from: "Chemo", to: "", n: 50, kind: "censored" },
          { column: 1, from: "Chemo", to: "", n: 30, kind: "stopped" },
          { column: 1, from: "Chemo", to: "Chemo", n: 20, kind: "regimen" },
          { column: 1, from: "Hormone", to: "", n: 20, kind: "censored" },
          { column: 1, from: "Hormone", to: "", n: 10, kind: "stopped" },
          { column: 1, from: "Hormone", to: "Chemo", n: 10, kind: "regimen" }
        ]
      }]
    }
  });

  test("both terminals are drawn, and named differently", () => {
    // The whole point of the split: censoring must not read as a clinical stop.
    const svg = viewToSvg(mk() as any)!;
    assert.match(svg, /no further line/);
    assert.match(svg, /record ends here/);
    assert.ok(svg.includes("40") && svg.includes("70"), "each terminal carries its own count");
  });

  test("the legend explains the difference rather than leaving two greys", () => {
    const svg = viewToSvg(mk() as any)!;
    assert.match(svg, /watched, none started/);
    assert.match(svg, /nothing can be concluded/);
  });

  test("every flow with a known source and target is drawn", () => {
    const svg = viewToSvg(mk() as any)!;
    assert.equal((svg.match(/fill-opacity="0\.(32|45)"/g) || []).length, 6);
  });

  test("one scale across columns, so attrition is visible as thinning", () => {
    const svg = viewToSvg(mk() as any)!;
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="13" height="([\d.]+)"/g)]
      .map((m) => ({ x: +m[1], h: +m[3] }));
    const minX = Math.min(...rects.map((z) => z.x));
    const chemo1 = Math.max(...rects.filter((r) => r.x === minX).map((r) => r.h));
    const smallest = Math.min(...rects.filter((r) => r.x !== minX).map((r) => r.h));
    assert.ok(chemo1 > smallest * 2,
      "100 patients must draw taller than 30 — normalising per column would hide the drop-off");
  });

  test("two cohorts share one scale, so their sizes stay comparable", () => {
    const v = mk() as any;
    const small = JSON.parse(JSON.stringify(v.sequence.panels[0]));
    small.cohort = "B";
    small.nodes.forEach((n: any) => { n.n = Math.round(n.n / 4); });
    small.flows.forEach((f: any) => { f.n = Math.round(f.n / 4); });
    v.sequence.panels.push(small);
    const svg = viewToSvg(v)!;
    const heights = [...svg.matchAll(/<rect x="8" y="[\d.]+" width="13" height="([\d.]+)"/g)].map((m) => +m[1]);
    const tallest = Math.max(...heights), shortest = Math.min(...heights);
    assert.ok(tallest > shortest * 2,
      "a cohort a quarter the size must draw a quarter the height, not be renormalised to match");
    assert.match(svg, /B<\/tspan>|B</, "each panel is named");
  });

  test("labels are escaped — regimen names come from study data", () => {
    const v = mk() as any;
    v.sequence.panels[0].nodes[0].label = "<img src=x>";
    v.sequence.panels[0].flows.forEach((f: any) => { if (f.from === "Chemo") f.from = "<img src=x>"; });
    const svg = viewToSvg(v)!;
    assert.equal(svg.includes("<img"), false);
    assert.match(svg, /&lt;img/);
  });

  test("no flows renders nothing rather than an empty frame", () => {
    assert.equal(viewToSvg({ kind: "sequence", sequence: { panels: [] } } as any), null);
    assert.equal(viewToSvg({ kind: "sequence", error: "no therapy lines found" } as any), null);
  });

  test("the title names the labelling key", () => {
    assert.equal(viewTitle(mk() as any), "Treatment sequence by SUBTYPE — A");
  });
});

// A renderer never drops data on its own: past what fits at the requested width the figure
// grows (and the app's container scrolls), and past the colour key the rest is one disclosed
// "other". Each is pinned here by counting what the SVG actually draws, so a fixed cap on
// groups, categories or caption lines fails a test rather than hiding cases.
describe("plot point layers: subsets drawn over the plotted cohort", () => {
  const scatter = (layers: any[]): ViewResult => ({ kind: "plot", note: "n", plot: {
    shape: "scatter", n: 100, x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
    extent: { x0: 0, x1: 100, y0: 0, y1: 50 }, grid: [10, 10], bins: [{ bx: 1, by: 1, n: 100 }],
    stats: { pearson: 0.1, spearman: null, slope: 0.1, intercept: 1, pPearson: 0.5, pSpearman: null }, layers } as any });
  const hl = (o: any) => ({ kind: "cohort", name: "R", label: o.name || "R", color: LAYER_COLORS[0], patients: 2, inPlot: 2, n: 2, shown: "points", ...o });

  test("the plotted cohort turns grey and each layer's points draw in its colour, with a key", () => {
    const svg = viewToSvg(scatter([hl({ points: [{ id: "a", x: 10, y: 5 }, { id: "b", x: 90, y: 45 }] })]))!;
    assert.match(svg, new RegExp('<rect [^>]*fill="' + LAYER_BASE + '"'), "the base density is grey");
    assert.equal((svg.match(new RegExp('<circle [^>]*fill="' + LAYER_COLORS[0] + '" fill-opacity', "g")) || []).length, 2);
    assert.match(svg, />R \(2\)</, "the key names the layer and how many cases it holds");
    assert.match(svg, />point layers</);
    assert.doesNotMatch(svg, /stroke="#D55E00" stroke-width="1.5" stroke-dasharray/, "the fitted line leaves the first layer colour to the layer");
  });

  test("without layers the figure is as it was", () => {
    const svg = viewToSvg(scatter([]))!;
    assert.doesNotMatch(svg, new RegExp(LAYER_BASE));
    assert.doesNotMatch(svg, />point layers</);
  });

  test("a cohort layer too large for points is cells on the same grid, in its colour", () => {
    const svg = viewToSvg(scatter([hl({ shown: "density", n: 9000, bins: [{ bx: 3, by: 4, n: 9000 }] })]))!;
    assert.match(svg, new RegExp('<rect [^>]*fill="' + LAYER_COLORS[0] + '"'));
    assert.doesNotMatch(svg, new RegExp('<circle [^>]*fill="' + LAYER_COLORS[0] + '" fill-opacity'));
  });

  test("a layer drawn as nothing gets no key entry, and leaves the plotted cohort its colour", () => {
    const svg = viewToSvg(scatter([hl({ shown: "none", n: 0 })]))!;
    assert.doesNotMatch(svg, />point layers</);
    assert.doesNotMatch(svg, new RegExp(LAYER_BASE));
  });

  test("a cohort's name is escaped wherever the figure prints it", () => {
    const svg = viewToSvg(scatter([hl({ name: "<b>&evil", points: [{ id: "a", x: 1, y: 1 }] })]))!;
    assert.doesNotMatch(svg, /<b>&evil/);
    assert.match(svg, /&lt;b&gt;&amp;evil/);
  });

  test("on a box, a cohort layer's box sits in its group, and a value past the axis is pinned and counted", () => {
    const v: ViewResult = { kind: "plot", plot: {
      shape: "box", n: 10, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
      groups: [{ g: "A", n: 10, lo: 0, hi: 100, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "none",
      layers: [
        hl({ points: [{ id: "a", g: "A", v: 5 }, { id: "b", g: "A", v: 80 }] }),
        hl({ name: "S", color: LAYER_COLORS[1], shown: "boxes", n: 4, groups: [{ g: "A", n: 4, lo: 1, hi: 9, q1: 3, median: 5, q3: 7, loWhisker: 1, hiWhisker: 9 }] }),
      ] } as any };
    const svg = viewToSvg(v)!;
    assert.match(svg, new RegExp('<rect [^>]*fill="' + LAYER_COLORS[1] + '" fill-opacity="0.85"'), "S is a box of its own");
    assert.equal((svg.match(new RegExp('<circle [^>]*fill="' + LAYER_COLORS[0] + '" fill-opacity', "g")) || []).length, 1, "the value inside the whiskers is a dot");
    assert.match(svg, new RegExp('<path d="M[^"]*Z" fill="' + LAYER_COLORS[0] + '"'), "the value past them is a triangle at the edge");
    assert.match(svg, /1 value of a point layer lies more than a whisker span past the/);
  });

  test("each layer is a group tagged with its place in the list, its shared cases a hidden group of their own", () => {
    const svg = viewToSvg(scatter([
      hl({ points: [{ id: "a", x: 10, y: 5 }] }),
      hl({ name: "S", color: LAYER_COLORS[1], points: [{ id: "b", x: 20, y: 8 }], shared: [{ id: "a", x: 10, y: 5 }] }),
    ]))!;
    assert.match(svg, /<g data-layer="base">/);
    assert.match(svg, /<g data-layer="0"><circle/);
    assert.match(svg, /<g data-layer="1"><circle[^>]*fill="#0072B2"/);
    assert.match(svg, /<g data-layer="1" data-shared="" display="none"><circle cx="[^"]*" cy="[^"]*" r="2.5" fill="#0072B2"/,
      "the case layer 0 drew is drawn for layer 1 too, hidden until that layer is shown alone");
  });

  test("with the cases coloured by a category, a layer is a ring round the case, not a second fill", () => {
    const v: ViewResult = { kind: "plot", plot: {
      shape: "box", n: 3, x: { label: "G", kind: "cat" }, y: { label: "V", kind: "num" },
      groups: [{ g: "A", n: 3, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "points",
      points: [{ id: "a", g: "A", v: 5, c: "X" }], legend: [{ label: "X", color: "#123456" }], colorLabel: "kind",
      layers: [hl({ points: [{ id: "a", g: "A", v: 5 }] })] } as any };
    const svg = viewToSvg(v)!;
    assert.match(svg, new RegExp('<circle [^>]*fill="none" stroke="' + LAYER_COLORS[0] + '"'));
    assert.doesNotMatch(svg, new RegExp('<circle [^>]*fill="' + LAYER_COLORS[0] + '" fill-opacity'));
  });
});

describe("plot points: every case, or the outliers over the density", () => {
  const base = { x: { label: "AGE", kind: "num" }, y: { label: "TMB", kind: "num" },
    extent: { x0: 0, x1: 10, y0: 0, y1: 10 }, grid: [10, 10],
    stats: { pearson: 0.1, spearman: 0.1, slope: 0, intercept: 0, pPearson: 0.5, pSpearman: 0.5 } };
  const cells = (svg: string) => (svg.match(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="[^"]*" fill-opacity/g) || []).length;
  const dots = (svg: string) => (svg.match(/<circle /g) || []).length;

  test("every case a point: no cell is shaded, and the caption says a dot is a case", () => {
    const svg = viewToSvg({ kind: "plot", plot: { ...base, shape: "scatter", n: 3, bins: [{ bx: 1, by: 1, n: 2 }, { bx: 5, by: 5, n: 1 }],
      xyPoints: [{ id: "a", x: 1, y: 1 }, { id: "b", x: 1.2, y: 1.1 }, { id: "c", x: 5, y: 5 }], pointSet: { rule: "all", drawn: 3 } } as any })!;
    assert.equal(cells(svg), 0);
    assert.equal(dots(svg), 3);
    assert.match(svg, /Each dot is one case\./);
    assert.doesNotMatch(svg, /Darker is more/);
  });

  test("outliers: the sparse cells are left to their points, the dense ones stay shaded", () => {
    const svg = viewToSvg({ kind: "plot", plot: { ...base, shape: "scatter", n: 105,
      bins: [{ bx: 1, by: 1, n: 100 }, { bx: 2, by: 2, n: 3 }, { bx: 9, by: 9, n: 2 }], pointSet: { rule: "none", drawn: 0 },
      layers: [{ kind: "outliers", label: "outliers", color: LAYER_COLORS[0], n: 5, drawn: 5, shown: "points", cellMax: 3,
        points: [{ id: "a", x: 2.1, y: 2.1 }, { id: "b", x: 2.2, y: 2.3 }, { id: "c", x: 2.4, y: 2.2 }, { id: "d", x: 9.5, y: 9.5 }, { id: "e", x: 9.6, y: 9.1 }] }] } as any })!;
    assert.equal(cells(svg), 1, "only the cell of 100 is shaded");
    assert.equal((svg.match(new RegExp('<circle [^>]*fill="' + LAYER_COLORS[0] + '" fill-opacity', "g")) || []).length, 5);
    assert.match(svg, /Darker is more cases; the shade is logarithmic\./);
  });

  test("a point is the same size on every plot, whatever the count or shape", () => {
    // a plotted case carries a fill-opacity; a legend swatch does not, and is not a case
    const radii = (svg: string) => new Set([...svg.matchAll(/<circle [^>]*\br="([^"]+)"[^>]*fill-opacity/g)].map((m) => m[1]));
    const few = viewToSvg({ kind: "plot", plot: { ...base, shape: "scatter", n: 2, bins: [{ bx: 1, by: 1, n: 2 }],
      xyPoints: [{ id: "a", x: 1, y: 1 }, { id: "b", x: 2, y: 2 }], pointSet: { rule: "all", drawn: 2 } } as any })!;
    const many = viewToSvg({ kind: "plot", plot: { ...base, shape: "scatter", n: 4000, bins: [{ bx: 1, by: 1, n: 4000 }],
      xyPoints: Array.from({ length: 4000 }, (_, i) => ({ id: "p" + i, x: (i % 100) / 10, y: Math.floor(i / 100) / 4 })),
      pointSet: { rule: "all", drawn: 4000 } } as any })!;
    const boxed = viewToSvg({ kind: "plot", plot: { shape: "box", n: 3, x: { label: "G", kind: "cat" }, y: { label: "V", kind: "num" },
      groups: [{ g: "A", n: 3, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "points",
      points: [{ id: "a", g: "A", v: 1 }, { id: "b", g: "A", v: 5, r: "Amplification" }, { id: "c", g: "A", v: 9 }],
      legend: [{ label: "Amplification", color: "#f00", ring: true }], pointSet: { rule: "all", drawn: 3 } } as any })!;
    for (const svg of [few, many, boxed]) assert.deepEqual([...radii(svg)], [String(PLOT_POINT_R)]);
  });

  test("a box's axis reaches its outliers, at most a whisker span past the whiskers; beyond that a counted triangle", () => {
    const svg = viewToSvg({ kind: "plot", plot: { shape: "box", n: 1000, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
      groups: [{ g: "A", n: 1000, lo: 0, hi: 570, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }],
      overlay: "violin", violin: [{ g: "A", b: 0, n: 500 }, { g: "A", b: 15, n: 3 }], violinBins: 40, violinExtent: [0, 40], pointSet: { rule: "none", drawn: 0 },
      layers: [{ kind: "outliers", label: "outliers", color: LAYER_COLORS[0], n: 2, drawn: 2, shown: "points",
        points: [{ id: "a", g: "A", v: 15 }, { id: "b", g: "A", v: 570 }] }] } as any })!;
    assert.match(svg, />20<\/text>/, "the axis tops out at whisker + one whisker span (10 + 10)");
    assert.equal((svg.match(/<circle [^>]*fill-opacity/g) || []).length, 1, "the 15 is a dot on the axis");
    assert.equal((svg.match(/<path d="M[^"]*Z"/g) || []).length, 1, "the 570 is a triangle at the edge");
    assert.match(svg, /1 value of a point layer lies more than a whisker span past the whiskers and is drawn as a triangle/);
    // the violin stops at the whiskers: its bin at 15..16 lies past them but inside the axis, where the points are
    assert.equal((svg.match(/fill-opacity="0\.28"/g) || []).length, 1, "one violin bin drawn, the one inside the whiskers");
  });
});

describe("plot figures draw every group and category they are given", () => {
  const box = (nGroups: number, extra: Partial<any> = {}): ViewResult => ({
    kind: "plot", plot: {
      shape: "box", n: nGroups * 10,
      x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "FRACTION_GENOME_ALTERED", kind: "num" },
      groups: Array.from({ length: nGroups }, (_, i) => ({ g: "group" + i, n: 10, lo: 0, hi: 1, q1: 0.2, median: 0.5, q3: 0.8, loWhisker: 0, hiWhisker: 1 })),
      overlay: "none", ...extra
    } as any
  });

  test("a box plot with 108 groups draws all 108, widening past the requested width", () => {
    const svg = viewToSvg(box(108), { width: 960 })!;
    for (const i of [0, 23, 24, 107]) assert.ok(svg.includes(">group" + i + " (10)<"), "group" + i + " is drawn, with its count");
    const w = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
    assert.ok(w > 960, "figure grew to " + w);
    assert.match(svg, /min-width:\d+px/, "a grown figure keeps its width so the container scrolls rather than shrinking it");
  });

  test("a box plot that fits keeps the requested width and still scales to its container", () => {
    const svg = viewToSvg(box(10), { width: 960 })!;
    assert.match(svg, /viewBox="0 0 960 /);
    assert.doesNotMatch(svg, /min-width/);
  });

  test("a contingency table draws every category on both axes, not the first 12", () => {
    const cats = (p: string, n: number) => Array.from({ length: n }, (_, i) => p + i);
    const cells = cats("x", 20).flatMap((cx, i) => cats("y", 18).map((cy, j) => ({ cx, cy, n: 1 + ((i * 7 + j) % 5) })));
    const svg = viewToSvg({ kind: "plot", plot: { shape: "table", n: cells.reduce((a, c) => a + c.n, 0),
      x: { label: "A", kind: "cat" }, y: { label: "B", kind: "cat" }, cells } as any }, { width: 960 })!;
    for (let i = 0; i < 20; i++) assert.ok(svg.includes(">x" + i + "<"), "column x" + i);
    for (let j = 0; j < 18; j++) assert.ok(svg.includes(">y" + j + "<"), "row y" + j);
  });

  test("colour categories past the key pool into one disclosed 'other', in the key and the violins", () => {
    const legend = Array.from({ length: 12 }, (_, i) => ({ label: "c" + i, color: "#00000" + (i % 10) }));
    const violin = Array.from({ length: 15 }, (_, i) => ({ g: "group0", b: 3, n: 5, c: "c" + i })).concat([{ g: "group0", b: 3, n: 4, c: "" }]);
    const svg = viewToSvg(box(2, { overlay: "violin", violin, violinBins: 10, violinExtent: [0, 1], legend, colorLabel: "SEX" }), { width: 960 })!;
    assert.match(svg, /other \(3 more categories, no value\)/);
    assert.ok(svg.includes('fill="#9aa5ad"'), "the pooled share is drawn in the violin, not left as a gap");
  });

  test("a long caption is never cut", () => {
    const note = Array.from({ length: 40 }, (_, i) => "caveat" + i + " applies here and must be read").join(" ");
    const svg = viewToSvg({ ...box(3), note } as any, { width: 960 })!;
    assert.ok(svg.includes("caveat39"), "the last line of the caption is present");
  });
});
