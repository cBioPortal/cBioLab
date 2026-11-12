// The two-group lollipop's rules, each checked against cBioPortal's group-comparison Mutations tab
// (GroupComparisonUtils getProteinChangeToMutationRowData, LollipopTooltipCountInfo, LollipopPlotNoTooltip).
import test from "node:test";
import assert from "node:assert/strict";
import { compareChanges, checkCodonList, type ChangeCount } from "../lib/views/mutcompare/run.ts";
import { tipPercent, heightOf, sharedMax, mutcompareSvg, mutcompareCaption, ordinalName } from "../lib/views/mutcompare/figure.ts";
import { buildLollipopGene } from "../lib/lollipop.ts";
import { fisherExact } from "../lib/stats.ts";
import type { MutcompareResult } from "../lib/views/mutcompare/types.ts";

const counts = (o: Record<string, [number, number | null]>) =>
  new Map<string, ChangeCount>(Object.entries(o).map(([c, [n, pos]]) => [c, { n, rows: n, pos, driver: false, impact: "missense" }]));

test("a row per protein change: shares of the profiled patients, Fisher per change, BH across them, most significant first", () => {
  const rows = compareChanges(["A", "B"], [counts({ R175H: [9, 175], R342: [6, 342] }), counts({ R175H: [4, 175], G245S: [3, 245] })], [171, 499]);
  assert.deepEqual(rows.map((r) => r.change), ["R342", "R175H", "G245S"]);
  const r175 = rows.find((r) => r.change === "R175H")!;
  assert.deepEqual(r175.n, [9, 4]);
  assert.equal(r175.pct[0].toFixed(2), "5.26");
  assert.equal(r175.p, fisherExact(9, 162, 4, 495));
  assert.equal(r175.log2Ratio, Math.log2((9 / 171) / (4 / 499)));
  assert.equal(r175.enrichedIn, "A");
  // a change in one group only: no finite log ratio, enriched where it is found
  const g245 = rows.find((r) => r.change === "G245S")!;
  assert.equal(g245.log2Ratio, null);
  assert.equal(g245.enrichedIn, "B");
  // q is monotone in p and never below it
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].q >= rows[i - 1].q);
  for (const r of rows) assert.ok(r.q >= r.p);
});

test("a tie in share goes to the second group, as the portal's (log ratio <= 0)", () => {
  const [r] = compareChanges(["A", "B"], [counts({ X: [1, 1] }), counts({ X: [1, 1] })], [10, 10]);
  assert.equal(r.log2Ratio, 0);
  assert.equal(r.enrichedIn, "B");
});

test("positions are a list of codons", () => {
  assert.equal(checkCodonList(undefined), null);
  assert.equal(checkCodonList([175, 248]), null);
  assert.match(checkCodonList({ TP53: [1] }) || "", /list of protein positions/);
  assert.match(checkCodonList([1.5]) || "", /list of protein positions/);
  assert.match(checkCodonList(Array.from({ length: 501 }, (_, i) => i)) || "", /at most 500/);
});

test("the tooltip's percent: one decimal from 1%, else two digits past the leading zeros (LollipopTooltipCountInfo)", () => {
  assert.equal(tipPercent(5.263), "5.3");
  assert.equal(tipPercent(0.2), "0.20");
  assert.equal(tipPercent(0.0456), "0.046");
  assert.equal(tipPercent(0), "0");
});

function result(axis: "percent" | "count"): MutcompareResult {
  const report = (n: number) => ({ changes: [{ gene: "TP53", pos: 175, change: "R175H", n, rows: n, driver: true, impact: "missense" }],
    types: [{ gene: "TP53", pos: 175, mtype: "Missense_Mutation", driver: true, rows: n }],
    totals: [{ gene: "TP53", patients: n, pairs: n, somaticSamples: n }], cohortSamples: 100, minCount: 1, annotated: true });
  const protein = { proteinLength: 393, transcriptId: "ENST00000269305", domains: [{ accession: "PF00870", name: "P53", start: 95, end: 288 }] };
  const groups = [["Basal", 9, 171], ["LumA", 4, 499]].map(([name, n, profiled]) =>
    ({ name: name as string, profiled: profiled as number, mutated: n as number, lollipop: buildLollipopGene("TP53", [report(n as number)], protein) }));
  return { gene: "TP53", ranking: [{ gene: "TP53", pct: 89.5 }], groups: groups as MutcompareResult["groups"],
    rows: compareChanges(["Basal", "LumA"], [counts({ R175H: [9, 175] }), counts({ R175H: [4, 175] })], [171, 499]), geneP: 1e-12, axis, annotated: true };
}

test("heights: a share of the profiled patients on the % axis, patients on the # axis with a max of at least 5", () => {
  const p = result("percent"), c = result("count");
  assert.equal(heightOf(9, p.groups[0], "percent"), 900 / 171);
  assert.equal(heightOf(9, p.groups[0], "count"), 9);
  assert.equal(sharedMax(p, p.groups.map((g) => g.lollipop)), 900 / 171);
  assert.equal(sharedMax(c, c.groups.map((g) => g.lollipop)), 9);
  const small = result("count"); small.groups[0].lollipop.positions[0].n = 2; small.groups[1].lollipop.positions[0].n = 1;
  assert.equal(sharedMax(small, small.groups.map((g) => g.lollipop)), 5);
});

test("the figure draws both halves, each stem tagged with its group and codon, and the caption says what the app shows", () => {
  const m = result("percent");
  const svg = mutcompareSvg({ kind: "mutcompare", mutcompare: m, positions: [175] } as never, { width: 700 });
  assert.equal((svg.match(/data-group="0"/g) || []).length, 1);
  assert.equal((svg.match(/data-group="1"/g) || []).length, 1);
  assert.match(svg, /data-selected="1"/);
  assert.match(svg, /% mutated of 171 profiled pts/);
  assert.match(svg, /5\.3% \(9 mutated of 171 profiled patients\)/);
  assert.match(svg, /\(A\) Basal/);
  const cap = mutcompareCaption({ mutcompare: m, hide: ["missense.vus"], positions: [175, 248] } as never);
  assert.match(cap, /Fisher exact two-sided p for all mutations < 1e-10/);
  assert.match(cap, /Hidden: Missense · VUS/);
  assert.match(cap, /Selected codons 175, 248/);
  assert.equal(ordinalName(1, "LumA"), "(B) LumA");
  const counted = mutcompareSvg({ kind: "mutcompare", mutcompare: result("count"), hide: ["missense.driver"] } as never, { width: 700 });
  assert.match(counted, /# patients/);
  assert.doesNotMatch(counted, /data-codon/, "hiding the only class leaves no stem");
});
