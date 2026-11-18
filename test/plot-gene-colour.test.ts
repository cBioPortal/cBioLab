// Colouring a plot's points by one gene: the fill by the sample's top mutation (`by: "topMutationType"`)
// and the ring by its copy number or structural variant (`by: "copyNumberSv"`), as cBioPortal's Plots
// tab draws them (PLT-CL-8, PLT-STM-14…17). Case table U1–U4, from cbioportal-frontend cd8c6df
// src/shared/components/plots/PlotsTabUtils.tsx: colours 2045-2131 (noMutationAppearance #c4e5f5,
// notProfiledMutationsAppearance #ffffff, cnaToAppearance, svAppearance, notProfiledCnaAndSvAppearance
// BLACK), mutation fills the oncoprint's driver / VUS colours (oncoprintMutationTypeToAppearanceDrivers
// 1885-2003), legend order mutationLegendOrder 2061-2075. Colours that are the oncoprint's are read
// from lib/oncoprint-style.ts STYLE, never written here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPlot, categoryOrder } from "../lib/views/plot/run.ts";
import { validateAxis, type PlotData } from "../lib/plot.ts";
import { STYLE } from "../lib/oncoprint-style.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import { viewToSvg } from "../lib/view-svg.ts";
import type { DrawnResultOf, ViewResultOf } from "../lib/types.ts";

type Plot = ViewResultOf<"plot">;
const TOP = { source: "alteration", gene: "KRAS", by: "topMutationType" };
const RING = { source: "alteration", gene: "KRAS", by: "copyNumberSv" };

const mut = (bit: string) => STYLE.glyph.mutation.priority.find((m) => m.bit === bit)!;
const cna = (bit: string) => STYLE.glyph.cna.options.find((o) => o.bit === bit)!.color;

const evaluated = (count: number): EvaluatedCohort =>
  ({ studies: ["s1"], perStudy: { s1: { sql: "", count, samples: count, mode: "patient-level" } }, count, samples: count, text: "" });

/** a box plot of one group whose drawn cases carry the given colour and ring labels; the legend comes from them */
async function legendOf(points: { c?: string; r?: string }[], view: Record<string, unknown>): Promise<Map<string, string>> {
  const n = points.length;
  const box: PlotData = { shape: "box", n, x: { label: "CANCER_TYPE", kind: "cat" }, y: { label: "TMB", kind: "num" },
    groups: [{ g: "A", n, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "none" };
  const resolver = {
    instance: { id: "local", mode: "patient-level", conn: { db: "db" }, label: "local" },
    plot: async () => box,
    plotPoints: async () => points.map((p, i) => ({ id: "S" + i, g: "A", v: i % 10, ...p })),
    plotScatterPoints: async () => [],
  };
  const c = {
    doc: { cohorts: { All: { all: [] } } },
    cohorts: { All: evaluated(n) }, resolvers: { s1: resolver }, vNames: ["All"], vStudies: ["s1"],
    participationFor: (s: string[]) => ({ studies: s.map((x) => ({ study: x, mode: "patient-level", instance: "" })), requiresPatientLevel: false, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  } as unknown as ViewRun;
  const v = { kind: "plot", cohorts: ["All"], x: { source: "clinical", attribute: "CANCER_TYPE" }, y: { source: "clinical", attribute: "TMB" }, points: [], ...view };
  const r = await runPlot(v as never, c);
  const res = "result" in (r as object) ? (r as { result: Plot }).result : r as Plot;
  assert.equal(res.error, undefined, "the plot runs: " + res.error);
  const legend = res.plot!.legend || [];
  return new Map(legend.map((l) => [l.label + (l.ring ? " [ring]" : ""), l.color]));
}

describe("plot: colouring by a gene", () => {
  test("U1 the fill legend of a topMutationType colour: the portal's no-mutation and not-profiled fills, the oncoprint's driver and VUS colours", async () => {
    const labels = ["Not mutated", "Not mutated", "Not mutated", "Not mutated", "Not profiled for mutations", "Not profiled for mutations",
      "Missense (Driver)", "Missense (Driver)", "Missense (VUS)", "Truncating (Driver)", "Inframe (VUS)", "Splice (Driver)"];
    const legend = await legendOf(labels.map((c) => ({ c })), { colorBy: TOP });
    assert.equal(legend.get("Not mutated"), "#c4e5f5");
    assert.equal(legend.get("Not profiled for mutations"), "#ffffff");
    assert.equal(legend.get("Missense (Driver)"), mut("MISSENSE").color);
    assert.equal(legend.get("Missense (VUS)"), mut("MISSENSE").vus);
    assert.equal(legend.get("Truncating (Driver)"), mut("TRUNCATING").color);
    assert.equal(legend.get("Inframe (VUS)"), mut("INFRAME").vus);
    assert.equal(legend.get("Splice (Driver)"), mut("SPLICE").color);
  });

  test("U1 without drivers a class takes the oncoprint's driver colour, as the portal's default appearance does", async () => {
    const legend = await legendOf(["Missense", "Missense", "Truncating", "Not mutated"].map((c) => ({ c })), { colorBy: TOP });
    assert.equal(legend.get("Missense"), mut("MISSENSE").color);
    assert.equal(legend.get("Truncating"), mut("TRUNCATING").color);
    assert.equal(legend.get("Not mutated"), "#c4e5f5");
  });

  test("U2 the ring legend of a copyNumberSv ring: the oncoprint's amplification, deep deletion and SV colours, the portal's own for the rest", async () => {
    const labels = ["Amplification", "Gain", "Gain", "Diploid", "Diploid", "Diploid", "Shallow Deletion", "Deep Deletion", "Structural Variant", "Not profiled"];
    const legend = await legendOf(labels.map((r) => ({ c: "Not mutated", r })), { colorBy: TOP, ringBy: RING });
    assert.equal(legend.get("Amplification [ring]"), cna("AMP"));
    assert.equal(legend.get("Gain [ring]"), "#ff8c9f");
    assert.equal(legend.get("Shallow Deletion [ring]"), "#2aced4");
    assert.equal(legend.get("Deep Deletion [ring]"), cna("HOMDEL"));
    assert.equal(legend.get("Structural Variant [ring]"), STYLE.glyph.sv.color);
    assert.equal(legend.get("Not profiled [ring]")?.toLowerCase(), "#000000");
  });

  test("U3 validateAxis: topMutationType and copyNumberSv colour points: one gene as a colour or ring; refused as an axis, a covariate or for a gene set", () => {
    for (const by of ["topMutationType", "copyNumberSv"]) {
      assert.doesNotThrow(() => validateAxis({ source: "alteration", gene: "KRAS", by } as never, "colorBy", { colour: true }), by + " as a colour");
      assert.throws(() => validateAxis({ source: "alteration", gene: "KRAS", by } as never, "covariate 1"),
        /covariate 1 axis: by:".*" colours a plot's points by a gene; give it as a plot's colorBy or ringBy, not as an axis/, by + " as a covariate (review of #305: its not-profiled label would be a level)");
      assert.throws(() => validateAxis({ source: "alteration", genes: ["KRAS", "NRAS"], by } as never, "colorBy", { colour: true }),
        /colorBy axis: a gene SET only supports by:"mutated"/, by + " with a gene set");
    }
  });

  test("U4 categoryOrder of a topMutationType axis: the portal's mutationLegendOrder, then no mutation and not profiled", () => {
    const order = categoryOrder(TOP as never);
    assert.ok(order, "a topMutationType axis has an order of its own");
    assert.deepEqual(order(["Other", "Not profiled for mutations", "Missense", "Not mutated", "Inframe", "Truncating", "Splice", "Promoter"]),
      ["Promoter", "Splice", "Truncating", "Inframe", "Missense", "Other", "Not mutated", "Not profiled for mutations"]);
    // Promoter and Other are never keyed ".driver" (PlotsTabUtils.tsx:2985-2989), so they have no (Driver) entry
    assert.deepEqual(order(["Missense (VUS)", "Not mutated", "Other (VUS)", "Inframe (Driver)", "Promoter (VUS)", "Truncating (VUS)",
      "Not profiled for mutations", "Splice (VUS)", "Missense (Driver)", "Truncating (Driver)", "Inframe (VUS)", "Splice (Driver)"]),
    ["Promoter (VUS)", "Splice (Driver)", "Splice (VUS)", "Truncating (Driver)", "Truncating (VUS)", "Inframe (Driver)", "Inframe (VUS)",
      "Missense (Driver)", "Missense (VUS)", "Other (VUS)", "Not mutated", "Not profiled for mutations"]);
  });
});

describe("the box figure coloured by a gene (review of #305)", () => {
  // a box drawn as its points; a ring by a gene's copy number draws Diploid and Not profiled too
  const render = (points: { id: string; c?: string; r?: string }[], legend: { label: string; color: string; ring?: boolean }[], ringAbsent: boolean) =>
    viewToSvg({ kind: "plot", plot: { shape: "box", n: points.length, x: { label: "CNA", kind: "cat" }, y: { label: "mRNA", kind: "num" },
      groups: [{ g: "A", n: points.length, lo: 0, hi: 10, q1: 2, median: 4, q3: 6, loWhisker: 0, hiWhisker: 10 }], overlay: "points",
      points: points.map((p, i) => ({ g: "A", v: 2 + i, ...p })), legend, colorLabel: "KRAS", ringLabel: "KRAS", ...(ringAbsent ? { ringAbsent: true } : {}) } } as unknown as DrawnResultOf<"plot">)!;
  const circle = (svg: string, id: string) => svg.match(new RegExp('<circle data-id="' + id + '"[^>]*>'))![0];
  const attr = (tag: string, name: string) => tag.match(new RegExp("\\s" + name + '="([^"]*)"'))?.[1];
  const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  test("V1 a not-profiled point's white fill is outlined, so it shows on a white plot, and so is its key", () => {
    const svg = render([{ id: "a", c: "Not profiled for mutations" }, { id: "b", c: "Not mutated" }],
      [{ label: "Not profiled for mutations", color: "#ffffff" }, { label: "Not mutated", color: "#c4e5f5" }], false);
    assert.equal(attr(circle(svg, "a"), "fill"), "#ffffff");
    assert.equal(attr(circle(svg, "a"), "stroke"), STYLE.plotGene.outline);
    assert.match(svg, new RegExp('<circle cx="[^"]*" cy="[^"]*" r="[^"]*" fill="#ffffff" stroke="' + STYLE.plotGene.outline + '"/>'), "the key's dot is outlined too");
  });

  test("V2 a gene's copy-number ring strokes Diploid grey and Not profiled black, and keys them", () => {
    const svg = render([{ id: "a", c: "Not mutated", r: "Diploid" }, { id: "b", c: "Not mutated", r: "Not profiled" }, { id: "c", c: "Not mutated", r: "Gain" }],
      [{ label: "Not mutated", color: "#c4e5f5" }, { label: "Diploid", color: "#bebebe", ring: true }, { label: "Not profiled", color: "#000000", ring: true },
        { label: "Gain", color: "#ff8c9f", ring: true }], true);
    assert.equal(attr(circle(svg, "a"), "stroke"), "#bebebe");
    assert.equal(attr(circle(svg, "b"), "stroke"), "#000000");
    assert.ok(texts(svg).includes("Diploid") && texts(svg).includes("Not profiled"), "both are in the ring's key");
  });

  test("V3 another ring leaves absence unringed, as before", () => {
    const svg = render([{ id: "a", c: "Not mutated", r: "Diploid" }], [{ label: "Not mutated", color: "#c4e5f5" }, { label: "Diploid", color: "#bebebe", ring: true }], false);
    assert.notEqual(attr(circle(svg, "a"), "stroke"), "#bebebe");
  });
});
