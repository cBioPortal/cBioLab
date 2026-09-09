import test from "node:test";
import assert from "node:assert/strict";
import { formatGeneList, geneSymbols, hasMergedTracks, normalizeGeneTracks, parseGeneList, MAX_GENE_SYMBOLS } from "../lib/gene-tracks.ts";

test("a plain list is one track per gene, in order", () => {
  const { tracks, symbols } = normalizeGeneTracks(["tp53", " KRAS ", "EGFR"]);
  assert.deepEqual(tracks.map((t) => t.label), ["TP53", "KRAS", "EGFR"]);
  assert.deepEqual(tracks.map((t) => t.members), [["TP53"], ["KRAS"], ["EGFR"]]);
  assert.deepEqual(symbols, ["TP53", "KRAS", "EGFR"]);
});

test("a group is one track, labelled by its members unless it says otherwise", () => {
  const { tracks } = normalizeGeneTracks([{ genes: ["TP53", "MDM2"] }, { label: "RTK", genes: ["EGFR", "MET"] }]);
  assert.deepEqual(tracks[0], { label: "TP53 / MDM2", members: ["TP53", "MDM2"] });
  assert.deepEqual(tracks[1], { label: "RTK", members: ["EGFR", "MET"] });
});

test("symbols are the deduplicated union in first-appearance order — the mask bit order", () => {
  // the same gene may be both merged and drawn alone, as it may in the portal
  const { tracks, symbols } = normalizeGeneTracks([{ genes: ["TP53", "MDM2"] }, "TP53", { genes: ["MDM2", "KRAS"] }]);
  assert.deepEqual(symbols, ["TP53", "MDM2", "KRAS"]);
  assert.equal(tracks.length, 3);
});

test("a member repeated within one group is kept once", () => {
  const { tracks } = normalizeGeneTracks([{ genes: ["TP53", "tp53", "MDM2"] }]);
  assert.deepEqual(tracks[0].members, ["TP53", "MDM2"]);
});

test("unusable symbols are dropped, structural nonsense throws", () => {
  assert.deepEqual(normalizeGeneTracks(["TP53", "not a gene!", ""]).symbols, ["TP53"]);
  assert.throws(() => normalizeGeneTracks([{ genes: ["!!"] }]), /no valid gene symbols/);
  assert.throws(() => normalizeGeneTracks([{ genes: [{ genes: ["TP53"] }] }]), /do not nest/);
  assert.throws(() => normalizeGeneTracks([42 as unknown as string, null]), /must be a gene symbol/);
  assert.throws(() => normalizeGeneTracks([{ label: "X", genes: ["TP53"] }, { label: "X", genes: ["KRAS"] }]), /both labelled/);
});

test("the caps are the mask width and the number of rows", () => {
  const many = Array.from({ length: MAX_GENE_SYMBOLS + 1 }, (_, i) => "GENE" + i);
  assert.throws(() => normalizeGeneTracks([{ genes: many }]), /one bit per gene/);
  assert.throws(() => normalizeGeneTracks(Array.from({ length: 13 }, (_, i) => "GENE" + i)), /the most this draws/);
});

test("geneSymbols flattens for the views that do not merge", () => {
  assert.deepEqual(geneSymbols([{ label: "P", genes: ["TP53", "MDM2"] }, "KRAS", "TP53"]), ["TP53", "MDM2", "KRAS"]);
  assert.equal(hasMergedTracks(["TP53"]), false);
  assert.equal(hasMergedTracks([{ genes: ["TP53"] }]), true);
});

test("the portal's bracket syntax parses, and round-trips", () => {
  const parsed = parseGeneList('TP53 KRAS ["TP53 pathway" TP53, MDM2\nMDM4] [EGFR MET]');
  assert.deepEqual(parsed, ["TP53", "KRAS", { label: "TP53 pathway", genes: ["TP53", "MDM2", "MDM4"] }, { genes: ["EGFR", "MET"] }]);
  assert.equal(formatGeneList(parsed), 'TP53 KRAS ["TP53 pathway" TP53 MDM2 MDM4] [EGFR MET]');
  // a group whose label is just its members prints without the redundant label
  assert.equal(formatGeneList([{ label: "EGFR / MET", genes: ["EGFR", "MET"] }]), "[EGFR MET]");
  assert.deepEqual(normalizeGeneTracks(parsed).symbols, ["TP53", "KRAS", "MDM2", "MDM4", "EGFR", "MET"]);
});

test("bad bracket text is refused with the reason", () => {
  assert.throws(() => parseGeneList("[TP53 MDM2"), /no closing/);
  assert.throws(() => parseGeneList("TP53]"), /no '\[' before it/);
  assert.throws(() => parseGeneList("[[TP53]]"), /do not nest/);
  assert.throws(() => parseGeneList("[]"), /empty merged track/);
  assert.throws(() => parseGeneList('["unclosed TP53]'), /closing quote/);
});

test("per-track OQL is refused rather than silently drawn as the whole gene", () => {
  assert.throws(() => parseGeneList("TP53: MUT"), /per-track OQL/);
  assert.throws(() => parseGeneList("[TP53:MUT MDM2:AMP]"), /per-track OQL/);
});
