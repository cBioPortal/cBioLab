// The hotspots (lollipop) view's card, drawn as the app draws it (app/_lollipop/HotspotsBody.tsx):
// what PR J's spec (four Mutations-tab bugs and the empty-gene state) says the card shows for a
// queried gene with no mutations and no fusions, the Ensembl link by reference genome, and the
// Color Codes legend. Row ids are the spec table's (E, L, K). The view's computation is run against
// the fixture study by scripts/check-mutation-tab-states.ts; the figure's own rules are in
// test/lollipop.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { buildLollipopGene } from "../lib/lollipop.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

register("./support/tsx-loader.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { HotspotsBody } = await import("../app/_lollipop/HotspotsBody.tsx");
const { ColorLegend } = await import("../app/_lollipop/ColorLegend.tsx");

const report = (silent: boolean) => ({
  changes: [{ gene: "KRAS", pos: 12, change: "G12D", n: 3, rows: 3, driver: true, impact: "missense" },
    ...(silent ? [{ gene: "KRAS", pos: 40, change: "V40V", n: 1, rows: 1, driver: false, impact: "other" }] : [])],
  types: [{ gene: "KRAS", pos: 12, mtype: "Missense_Mutation", driver: true, rows: 3 },
    ...(silent ? [{ gene: "KRAS", pos: 40, mtype: "Silent", driver: false, rows: 1 }] : [])],
  totals: [{ gene: "KRAS", patients: silent ? 4 : 3, pairs: silent ? 4 : 3, somaticSamples: 3 }], cohortSamples: 40, minCount: 1, annotated: true,
});
const KRAS_PROTEIN = { proteinLength: 189, transcriptId: "ENST00000311936", domains: [], ids: { refseq: "NM_004985", ensembl: "ENST00000311936.3" } };
const BRCA1_PROTEIN = { proteinLength: 1863, transcriptId: "ENST00000357654", domains: [{ accession: "PF00533", name: "BRCT", start: 1650, end: 1736 }],
  ids: { refseq: "NM_007294", ensembl: "ENST00000357654.3", ccds: "CCDS11453", uniprotAccession: "P38398", uniprotName: "BRCA1_HUMAN" } };
const genes = (silent = false): HotspotGene[] => [buildLollipopGene("KRAS", [report(silent)], KRAS_PROTEIN), buildLollipopGene("BRCA1", [report(silent)], BRCA1_PROTEIN)];

const card = (v: Record<string, unknown>) => renderToStaticMarkup(createElement(HotspotsBody, {
  v: { kind: "hotspots", note: "the method caption", ...v } as never, onHide: () => {}, onCodons: () => {} }));
/** each gene's part of the card: its plot, its summary and its grid */
const perGene = (html: string) => Object.fromEntries(html.split('class="lp-gene"').slice(1).map((s) => [s.includes("NM_007294") ? "BRCA1" : "KRAS", s]));
/** a match on the card's HTML, reported by the pattern alone (the HTML runs to pages) */
const has = (html: string, re: RegExp, why = "") => assert.ok(re.test(html), "expected " + re + (why ? " (" + why + ")" : ""));
const hasNot = (html: string, re: RegExp, why = "") => assert.ok(!re.test(html), "did not expect " + re + (why ? " (" + why + ")" : ""));
const badges = (html: string) => [...html.matchAll(/<button[^>]*class="lp-badge[^"]*"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

test("PR J E: the card for an empty gene beside a gene with mutations", async (t) => {
  const parts = perGene(card({ hotspots: genes() }));
  await t.test("EX1 both genes get their part of the card, in query order", () => assert.deepEqual(Object.keys(parts), ["KRAS", "BRCA1"]));
  await t.test("E13: the empty gene's transcript summary is shown as for any gene", () => {
    has(parts.BRCA1, /NM_007294/); has(parts.BRCA1, /ENST00000357654\.3/); has(parts.BRCA1, /CCDS11453/); has(parts.BRCA1, /BRCA1_HUMAN/);
  });
  await t.test("E7 (U1 decided): the empty gene's Somatic Mutation Frequency is hidden; the other gene's is shown", () => {
    hasNot(parts.BRCA1, /Somatic Mutation Frequency/);
    has(parts.KRAS, /Somatic Mutation Frequency/);
  });
  await t.test("EX4 E8: the empty gene's grid is all zeros, without an Other row when no gene has Other", () => {
    const b = badges(parts.BRCA1);
    assert.equal(b.length, 12, "Driver and VUS totals, then Missense, Truncating, Inframe, Splice and Fusion by Driver and VUS: " + JSON.stringify(b));
    assert.ok(b.every((n) => n === "0"), JSON.stringify(b));
    hasNot(parts.BRCA1, />Other</);
  });
  await t.test("EX4: the Other row is drawn (0 / 0) for the empty gene when another gene of the view has Other", () => {
    const p = perGene(card({ hotspots: genes(true) }));
    has(p.KRAS, />Other</);
    has(p.BRCA1, />Other</);
    const b = badges(p.BRCA1);
    assert.equal(b.length, 14, JSON.stringify(b));
    assert.ok(b.every((n) => n === "0"), JSON.stringify(b));
  });
});

test("PR J EX1 EX5: an empty gene alone is drawn as a gene, not the bare note; the note fallback stays for a result with no genes", () => {
  const alone = card({ hotspots: [buildLollipopGene("BRCA1", [report(false)], BRCA1_PROTEIN)] });
  has(alone, /class="lp-gene"/);
  has(alone, /NM_007294/);
  has(card({ hotspots: [] }), /^<p class="note">the method caption<\/p>$/, "EX5 kept for a result from older code");
});

test("PR J L3 LX1: the card's Ensembl link follows the result's genome flag", () => {
  const g37 = perGene(card({ hotspots: genes() })).KRAS;
  has(g37, /href="https:\/\/grch37\.ensembl\.org\/homo_sapiens\/Transcript\/Summary\?t=ENST00000311936"/, "L6 no flag: GRCh37");
  const g38 = perGene(card({ hotspots: genes(), grch38: true })).KRAS;
  has(g38, /href="https:\/\/www\.ensembl\.org\/homo_sapiens\/Transcript\/Summary\?t=ENST00000311936"/, "L5 grch38: the GRCh38 Ensembl");
  hasNot(g38, /grch37\.ensembl\.org/);
  has(g38, />ENST00000311936\.3</, "L9 the link text keeps the version");
  const g38b = perGene(card({ hotspots: genes(), grch38: true })).BRCA1;
  has(g38b, /href="https:\/\/www\.ensembl\.org\/homo_sapiens\/Transcript\/Summary\?t=ENST00000357654"/, "an empty gene's link too");
});

test("PR J KX1: the Color Codes panel lists no Splice site under Truncating, and Splice as its own entry", () => {
  const html = renderToStaticMarkup(createElement(ColorLegend, {}));
  has(html, /Color Codes/);
  hasNot(html, /Splice site/i);
  has(html, /Frameshift insertion/);
  has(html, /Splice Mutations/);
});
