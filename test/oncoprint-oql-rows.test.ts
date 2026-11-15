// Two lines of one gene are two rows, as cBioPortal's Results view draws them: one genetic track
// per OQL line, each labelled by its gene with its line as sublabel. Written from the case table of
// PR 2 of the OQL series (rows R1-R20); each test cites its row and the legacy source
// (cbioportal-frontend at cd8c6df) it was read from.
//   OU = src/shared/components/oncoprint/OncoprintUtils.ts (makeGeneticTrackWith 1093-1190,
//        getAlterationInfo 878-924, formatGeneticTrackLabel 203-210, sublabel 191-201)
//   OF = src/shared/lib/oql/oqlfilter.ts (isDatumWantedByOQLLine 520-578)
//   TD = src/shared/components/oncoprint/tabularDownload.ts 91-140
//
// Each row carries a `key`, unique in the list: its entry written back ("KRAS: AMP", "KRAS" for a
// bare row, a merged row's label), " #2", " #3" on a later row identical to an earlier one. The
// contract's gene track carries `key` only where it differs from `label`.
import test from "node:test";
import assert from "node:assert/strict";
import { parseOql, type OqlSpec } from "../lib/oql-parse.ts";
import { normalizeGeneTracks, geneSymbols, parseGeneList, formatGeneList, toGeneList, MAX_GENE_TRACKS, MAX_GENE_SYMBOLS } from "../lib/gene-tracks.ts";
import { assembleContract, BITS, NOT_PROFILED, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import { contractToTsv, type TabularSource } from "../lib/oncoprint-tabular.ts";
import { trackTooltipLines } from "../lib/oncoprint-style.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { removeTrack, moveTrack, canRemoveTrack } from "../app/_oncoprint/track-edits.ts";
import { oncoprintRows, oncoprintAside, resultsLayout } from "../app/portal/results-layout.ts";
import type { Contract, Track } from "../lib/types.ts";

const specs = (entry: string): OqlSpec[] => parseOql(entry)[0].specs;
type Keyed = { key?: string };
const keyOf = (t: { label: string } & Keyed): string => t.key ?? t.label;

// ---------------------------------------------------------------------------------------------
// fixture: as test/oncoprint-oql.test.ts — P1-P5 profiled for KRAS and TP53, P6 for TP53 only
// ---------------------------------------------------------------------------------------------

type DEv = EventRow & { ps?: number | null; pe?: number | null; driver?: boolean };
const e = (pid: string, gene: string, vt: string, o: Partial<DEv> = {}): DEv => ({ pid, gene, vt, ...o });
const PIDS = ["P1", "P2", "P3", "P4", "P5", "P6"];
const fixture = (genes: AssembleInput["genes"], over: Partial<AssembleInput> = {}): AssembleInput => ({
  genes,
  groups: [{ name: "all", pids: PIDS }],
  studies: ["s"],
  events: [
    e("P1", "KRAS", "mutation", { mt: "Missense_Mutation", mv: "G12D", ps: 12, pe: 12, driver: true }),
    e("P2", "KRAS", "cna", { cna: 2 }),                                                   // VUS amplification
    e("P3", "KRAS", "cna", { cna: -2, driver: true }),
    e("P4", "KRAS", "mutation", { mt: "Missense_Mutation", mv: "G13D", ps: 13, pe: 13 }),   // VUS mutation ...
    e("P4", "KRAS", "cna", { cna: 2, driver: true }),                                     // ... beside a driver amplification
    e("P5", "KRAS", "structural_variant", { mt: "Fusion", mv: "KRAS-ALK", driver: true }),
    e("P6", "KRAS", "cna", { cna: 2, driver: true }),                                     // off-panel
    e("P1", "TP53", "mutation", { mt: "Nonsense_Mutation", mv: "R213*", driver: true }),
  ],
  coverage: [...["P1", "P2", "P3", "P4", "P5"].map((pid) => ({ pid, genes: ["KRAS", "TP53"] })), { pid: "P6", genes: ["TP53"] }],
  isDriver: (r: EventRow) => !!(r as DEv).driver,
  annotationSource: "fixture",
  clinical: [], heatmap: [], derived: [], sort: [{ track: "genomic", dir: "asc" }], lineGap: 90,
  ...over
});
const geneRows = (c: Contract) => c.tracks.filter((t) => t.kind === "gene") as (Track & Keyed)[];
/** a gene row by its key (a row whose key equals its label carries none), its cells by column id */
function row(c: Contract, key: string) {
  const t = geneRows(c).find((x) => keyOf(x) === key);
  assert.ok(t, "no gene row keyed " + key + " (rows: " + geneRows(c).map((x) => keyOf(x)).join(", ") + ")");
  const cell = (pid: string) => t.cells[c.columns.indexOf(pid)];
  return { t, cell, by: Object.fromEntries(PIDS.map((p) => [p, cell(p)])) };
}
const MIS_D = BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER;
const AMP_D = BITS.AMP | BITS.DRIVER | BITS.CNA_DRIVER;
const DEL_D = BITS.HOMDEL | BITS.DRIVER | BITS.CNA_DRIVER;
const SV_D = BITS.SV | BITS.DRIVER | BITS.SV_DRIVER;

// ---------------------------------------------------------------------------------------------
// gene-tracks: two rows of one gene, each with its key
// ---------------------------------------------------------------------------------------------

test("R1: two lines of one gene are two rows labelled by the gene, in order, keyed by their written-back line (OU 1093-1190, 203-210)", () => {
  const { tracks, symbols } = normalizeGeneTracks(["KRAS: AMP", "KRAS: MUT"]);
  assert.deepEqual(tracks.map((t) => t.label), ["KRAS", "KRAS"]);
  assert.deepEqual(tracks.map((t) => (t as Keyed).key), ["KRAS: AMP", "KRAS: MUT"]);
  assert.deepEqual(tracks.map((t) => t.members), [["KRAS"], ["KRAS"]]);
  assert.deepEqual(tracks.map((t) => t.oql), [specs("KRAS: AMP"), specs("KRAS: MUT")]);
  assert.deepEqual(symbols, ["KRAS"], "R7/R8: one gene");
});

test("R1: a row's key is its line as the portal writes it back, not as typed", () => {
  const { tracks } = normalizeGeneTracks(["kras: amp", "KRAS:  DRIVER_MUT", "KRAS: MISSENSE", "TP53:"]);
  assert.deepEqual(tracks.map((t) => (t as Keyed).key), ["KRAS: AMP", "KRAS: MUT_DRIVER", "KRAS: MUT=MISSENSE", "TP53"]);
});

test("R4: a bare row and a line of the same gene are two rows, keyed 'KRAS' and 'KRAS: AMP' (OU)", () => {
  const { tracks } = normalizeGeneTracks(["KRAS", "KRAS: AMP"]);
  assert.deepEqual(tracks.map((t) => [t.label, (t as Keyed).key, t.oql]), [["KRAS", "KRAS", undefined], ["KRAS", "KRAS: AMP", specs("KRAS: AMP")]]);
});

test("R5: the same line twice is two identical rows, the second keyed ' #2', a third ' #3' (OU: one track per line)", () => {
  const two = normalizeGeneTracks(["KRAS: AMP", "KRAS: AMP"]).tracks;
  assert.deepEqual(two.map((t) => (t as Keyed).key), ["KRAS: AMP", "KRAS: AMP #2"]);
  assert.deepEqual(two[0].oql, two[1].oql);
  assert.deepEqual(two.map((t) => t.label), ["KRAS", "KRAS"]);
  // identical once written back, however typed; a bare gene twice too
  const three = normalizeGeneTracks(["KRAS: AMP", "TP53", "kras: amp", "KRAS:AMP"]).tracks;
  assert.deepEqual(three.map((t) => (t as Keyed).key), ["KRAS: AMP", "TP53", "KRAS: AMP #2", "KRAS: AMP #3"]);
  assert.deepEqual(normalizeGeneTracks(["KRAS", "KRAS"]).tracks.map((t) => (t as Keyed).key), ["KRAS", "KRAS #2"]);
});

test("R6: a gene in a merged row and in rows of its own: all drawn, each keyed (a merged row by its label)", () => {
  const { tracks, symbols } = normalizeGeneTracks([{ label: "RAS", genes: ["KRAS", "NRAS"] }, "KRAS", "KRAS: AMP", { genes: ["KRAS", "HRAS"] }]);
  assert.deepEqual(tracks.map((t) => (t as Keyed).key), ["RAS", "KRAS", "KRAS: AMP", "KRAS / HRAS"]);
  assert.deepEqual(tracks.map((t) => t.label), ["RAS", "KRAS", "KRAS", "KRAS / HRAS"]);
  assert.deepEqual(symbols, ["KRAS", "NRAS", "HRAS"]);
});

test("R7: rows count against the 12-row cap; KRAS twice is one gene against the 32-gene cap (ours)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i % 2 ? "KRAS: AMP" : "KRAS: MUT");
  assert.equal(normalizeGeneTracks(rows(MAX_GENE_TRACKS)).tracks.length, MAX_GENE_TRACKS);
  assert.throws(() => normalizeGeneTracks(rows(MAX_GENE_TRACKS + 1)), new RegExp(MAX_GENE_TRACKS + 1 + " tracks"));
  const others = (n: number) => ({ genes: Array.from({ length: n }, (_, i) => "G" + (i + 1)) });
  const atCap = normalizeGeneTracks([others(MAX_GENE_SYMBOLS - 1), "KRAS: AMP", "KRAS: MUT"]);
  assert.equal(atCap.symbols.length, MAX_GENE_SYMBOLS, "KRAS's two rows count once");
  assert.throws(() => normalizeGeneTracks([others(MAX_GENE_SYMBOLS), "KRAS: AMP", "KRAS: MUT"]), /distinct genes/);
});

test("R17: the gene-list text 'KRAS: AMP; KRAS: MUT' is two entries, and formatGeneList round-trips it (ours)", () => {
  // the text form already parses (PR 1); what is new is that the list it gives is drawn
  assert.deepEqual(parseGeneList("KRAS: AMP; KRAS: MUT"), ["KRAS: AMP", "KRAS: MUT"]);
  assert.deepEqual(parseGeneList("KRAS; KRAS: AMP\nKRAS: AMP"), ["KRAS", "KRAS: AMP", "KRAS: AMP"]);
  for (const list of [["KRAS: AMP", "KRAS: MUT"], ["KRAS", "KRAS: AMP", "TP53"], ["KRAS: AMP", "KRAS: AMP"]])
    assert.deepEqual(parseGeneList(formatGeneList(list)), list, JSON.stringify(list) + " -> " + formatGeneList(list));
  assert.equal(normalizeGeneTracks(parseGeneList("KRAS: AMP; KRAS: MUT")).tracks.length, 2);
});

test("R18: toGeneList's output re-normalizes to the same tracks, keys included (ours)", () => {
  const { tracks } = normalizeGeneTracks(["KRAS: AMP", "KRAS: MUT", "kras", "KRAS: AMP", { label: "RAS", genes: ["NRAS", "HRAS"] }, "TP53"]);
  assert.deepEqual(tracks.map((t) => (t as Keyed).key), ["KRAS: AMP", "KRAS: MUT", "KRAS", "KRAS: AMP #2", "RAS", "TP53"]);
  assert.deepEqual(normalizeGeneTracks(toGeneList(tracks)).tracks, tracks);
});

test("R20: a view other than the oncoprint refuses two lines of a gene, as any line (PR 1)", () => {
  assert.throws(() => geneSymbols(["KRAS: AMP", "KRAS: MUT"]), /only the oncoprint draws/);
  assert.deepEqual(geneSymbols(["KRAS: AMP", "KRAS: MUT"], { oql: true }), ["KRAS"]);
});

// ---------------------------------------------------------------------------------------------
// assembleContract: each row draws its own line
// ---------------------------------------------------------------------------------------------

test("R1: the contract has two KRAS rows, sublabels ': AMP' then ': MUT', keys where they differ from the label", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "KRAS: MUT", "TP53"]));
  const g = geneRows(c);
  assert.deepEqual(g.map((t) => [t.label, (t as { sublabel?: string }).sublabel, t.key]),
    [["KRAS", ": AMP", "KRAS: AMP"], ["KRAS", ": MUT", "KRAS: MUT"], ["TP53", undefined, undefined]]);
  assert.ok(!("key" in g[2]), "a row whose key is its label carries no key");
  const bare = geneRows(assembleContract(fixture(["KRAS", "TP53"])));
  assert.ok(bare.every((t) => !("key" in t)), "a list without OQL draws no key, as before");
});

test("R2: each row draws only its line's events; an amplification and a mutation in one patient each in its own row (OF 520-578)", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "KRAS: MUT", "TP53"]));
  assert.deepEqual(row(c, "KRAS: AMP").by, { P1: 0, P2: BITS.AMP, P3: 0, P4: AMP_D, P5: 0, P6: NOT_PROFILED });
  assert.deepEqual(row(c, "KRAS: MUT").by, { P1: MIS_D, P2: 0, P3: 0, P4: BITS.MISSENSE, P5: 0, P6: NOT_PROFILED },
    "P4's VUS G13D is the MUT row's; its driver amplification is the AMP row's");
  assert.equal(row(c, "TP53").by.P1, BITS.TRUNCATING | BITS.DRIVER | BITS.MUT_DRIVER);
});

test("R3: each row's % is its own altered over the gene's profiled patients, one denominator for both (OU 878-924)", () => {
  const c = assembleContract(fixture(["KRAS: HOMDEL", "KRAS: MUT"]));
  const del = row(c, "KRAS: HOMDEL").t, mut = row(c, "KRAS: MUT").t;
  assert.deepEqual([del.altered, del.profiled, del.freqPct], [1, 5, 20]);
  assert.deepEqual([mut.altered, mut.profiled, mut.freqPct], [2, 5, 40]);
});

test("R4: KRAS then KRAS: AMP — every alteration, then amplifications (OU)", () => {
  const c = assembleContract(fixture(["KRAS", "KRAS: AMP"]));
  assert.deepEqual(geneRows(c).map((t) => keyOf(t)), ["KRAS", "KRAS: AMP"]);
  assert.ok(!("key" in geneRows(c)[0]));
  assert.deepEqual(row(c, "KRAS").by, { P1: MIS_D, P2: BITS.AMP, P3: DEL_D, P4: AMP_D | BITS.MISSENSE, P5: SV_D, P6: NOT_PROFILED });
  assert.deepEqual(row(c, "KRAS: AMP").by, { P1: 0, P2: BITS.AMP, P3: 0, P4: AMP_D, P5: 0, P6: NOT_PROFILED });
});

test("R5: the same line twice draws two identical rows, keyed 'KRAS: AMP' and 'KRAS: AMP #2'", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "KRAS: AMP"]));
  const [a, b] = geneRows(c);
  assert.deepEqual([a.key, b.key], ["KRAS: AMP", "KRAS: AMP #2"]);
  assert.deepEqual(Array.from(a.cells), Array.from(b.cells));
  assert.deepEqual([a.altered, a.profiled], [b.altered, b.profiled]);
});

test("R6: a gene in a merged row and in its own OQL row — both drawn, each applying its own rule (OU)", () => {
  const c = assembleContract(fixture([{ label: "RAS", genes: ["KRAS", "NRAS"] }, "KRAS: AMP", "KRAS: MUT"]));
  assert.deepEqual(geneRows(c).map((t) => keyOf(t)), ["RAS", "KRAS: AMP", "KRAS: MUT"]);
  assert.equal(row(c, "RAS").by.P3, DEL_D, "the merged row draws every KRAS alteration");
  assert.equal(row(c, "KRAS: AMP").by.P3, 0);
  assert.equal(row(c, "KRAS: MUT").by.P1, MIS_D);
});

test("R8: panel coverage is one bit per gene: both KRAS rows are not profiled where KRAS is not covered (ours)", () => {
  for (const cov of [undefined, [...["P1", "P2", "P3", "P4", "P5"].map((pid) => ({ pid, mask: 0b11 })), { pid: "P6", mask: 0b10 }]]) {
    const c = assembleContract(fixture(["KRAS: AMP", "KRAS: MUT", "TP53"], cov ? { coverage: cov as AssembleInput["coverage"] } : {}));
    assert.equal(row(c, "KRAS: AMP").by.P6, NOT_PROFILED, "mask: " + !!cov);
    assert.equal(row(c, "KRAS: MUT").by.P6, NOT_PROFILED, "mask: " + !!cov);
    assert.equal(row(c, "KRAS: AMP").t.profiled, 5);
    assert.equal(row(c, "TP53").t.profiled, 6, "TP53's bit is the second, though it is the third row");
  }
});

test("R9: the staircase keys on every gene row in order, both KRAS rows included (SortUtils: genetic tracks in order)", () => {
  // HOMDEL first: P3 alone is altered; among the rest the AMP row decides — P2 and P4 before P1 and P5,
  // which an id tiebreak (P1 < P2) would not give; P6, not profiled for KRAS, last
  const c = assembleContract(fixture(["KRAS: HOMDEL", "KRAS: AMP"]));
  assert.equal(c.columns[0], "P3");
  assert.deepEqual(new Set(c.columns.slice(1, 3)), new Set(["P2", "P4"]), "columns: " + c.columns.join(" "));
  assert.deepEqual(new Set(c.columns.slice(3, 5)), new Set(["P1", "P5"]), "columns: " + c.columns.join(" "));
});

// ---------------------------------------------------------------------------------------------
// what the rows feed: the tooltip, the binary transport, the Tabular download
// ---------------------------------------------------------------------------------------------

test("R14: each row's tooltip opens with its label and line (DeltaUtils 1165: description = the track's oql)", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "KRAS: MUT"]));
  assert.equal(trackTooltipLines(row(c, "KRAS: AMP").t, c.columns.length)[0], "KRAS: AMP");
  assert.equal(trackTooltipLines(row(c, "KRAS: MUT").t, c.columns.length)[0], "KRAS: MUT");
});

test("R11 (the figure's menu reads the unpacked contract): a row's key survives the binary transport", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "KRAS: AMP", "TP53"]));
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const genes = data.tracks.filter((t: { kind: string }) => t.kind === "gene") as unknown as ({ label: string } & Keyed)[];
  assert.deepEqual(genes.map((t) => t.key), ["KRAS: AMP", "KRAS: AMP #2", undefined]);
});

const tsvRows = (tsv: string) => {
  const [head, ...lines] = tsv.trimEnd().split("\n").map((l) => l.split("\t"));
  const ids = head.slice(2);
  return lines.map(([name, type, ...v]) => ({ name, type, cell: Object.fromEntries(ids.map((id, i) => [id, v[i]])) }));
};

test("R10: Tabular — two tracks of one gene are one row per group, values joined ', ' where they differ, once where equal (TD 91-140)", () => {
  // a contract built by hand: this already holds before the change (contractToTsv groups gene tracks by label)
  const src: TabularSource = {
    columns: ["A", "B", "C", "D"],
    tracks: [
      { kind: "gene", label: "KRAS", key: "KRAS: MUT", cells: [BITS.MISSENSE, BITS.MISSENSE | BITS.AMP, 0, NOT_PROFILED] } as never,
      { kind: "gene", label: "KRAS", key: "KRAS: TRUNC", cells: [BITS.TRUNCATING, BITS.MISSENSE, BITS.AMP, NOT_PROFILED] } as never,
    ],
    display: { annotate: "none" },
  };
  const rows = tsvRows(contractToTsv(src)).filter((r) => r.name === "KRAS");
  assert.deepEqual(rows.map((r) => r.type), ["CNA", "MUTATIONS", "MRNA", "PROTEIN", "STRUCTURAL_VARIANT"], "one KRAS row per group");
  const of = (type: string) => rows.find((r) => r.type === type)!.cell;
  assert.deepEqual(of("MUTATIONS"), { A: "Missense Mutation, Truncating mutation", B: "Missense Mutation", C: "", D: "" });
  assert.deepEqual(of("CNA"), { A: "", B: "Amplification", C: "Amplification", D: "" });
});

test("R10: Tabular of an assembled 'KRAS: AMP; KRAS: MUT' — one KRAS row per group, from both rows (TD 91-140)", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "KRAS: MUT", "TP53"]));
  const rows = tsvRows(contractToTsv(c)).filter((r) => r.name === "KRAS");
  assert.equal(rows.length, 5, "one KRAS row per genetic group: " + rows.map((r) => r.type).join(", "));
  const of = (type: string) => rows.find((r) => r.type === type)!.cell;
  assert.match(of("CNA").P4, /^Amplification/, "the AMP row's");
  assert.match(of("MUTATIONS").P4, /^Missense Mutation/, "the MUT row's");
  assert.match(of("MUTATIONS").P1, /^Missense Mutation/);
  assert.equal(of("CNA").P3, "", "a deep deletion is neither line's");
  assert.equal(of("STRUCTURAL_VARIANT").P5, "", "an SV is neither line's");
});

// ---------------------------------------------------------------------------------------------
// track edits: by the row's key
// ---------------------------------------------------------------------------------------------

test("R11: Remove track removes that row only, by its key (ours)", () => {
  const v = { genes: ["KRAS: AMP", "KRAS: MUT", "TP53"] };
  assert.deepEqual(removeTrack(v, "KRAS: MUT").genes, ["KRAS: AMP", "TP53"]);
  assert.deepEqual(removeTrack(v, "KRAS: AMP").genes, ["KRAS: MUT", "TP53"]);
  assert.deepEqual(removeTrack({ genes: ["KRAS", "KRAS: AMP"] }, "KRAS").genes, ["KRAS: AMP"], "a bare row's key is its label");
  // the same line twice: the key says which
  const twice = { genes: ["KRAS: AMP", "TP53", "KRAS: AMP"] };
  assert.deepEqual(removeTrack(twice, "KRAS: AMP").genes, ["TP53", "KRAS: AMP"], "the first only");
  assert.deepEqual(removeTrack(twice, "KRAS: AMP #2").genes, ["KRAS: AMP", "TP53"], "the second only");
  // an entry typed otherwise is found by its written-back key
  assert.deepEqual(removeTrack({ genes: ["kras: driver_mut", "KRAS: AMP"] }, "KRAS: MUT_DRIVER").genes, ["KRAS: AMP"]);
});

test("R11: every gene row the contract draws is removed by its key (t.key ?? t.label) — that row only", () => {
  const genes = ["KRAS: AMP", "KRAS", "kras: amp", { label: "RAS", genes: ["NRAS", "HRAS"] }, "TP53"];
  const c = assembleContract(fixture(genes));
  geneRows(c).forEach((t, i) => {
    const next = removeTrack({ genes }, keyOf(t)).genes;
    assert.deepEqual(next, genes.filter((_, j) => j !== i), "removing " + keyOf(t));
  });
});

test("R12: Move track moves that row only (ours)", () => {
  const v = { genes: ["KRAS: AMP", "KRAS: MUT", "TP53"] };
  assert.deepEqual(moveTrack(v, "KRAS: MUT", -1).genes, ["KRAS: MUT", "KRAS: AMP", "TP53"]);
  assert.deepEqual(moveTrack(v, "KRAS: MUT", 1).genes, ["KRAS: AMP", "TP53", "KRAS: MUT"]);
  const twice = { genes: ["KRAS: AMP", "TP53", "KRAS: AMP"] };
  assert.deepEqual(moveTrack(twice, "KRAS: AMP #2", -1).genes, ["KRAS: AMP", "KRAS: AMP", "TP53"]);
  assert.deepEqual(moveTrack(twice, "KRAS: AMP", 1).genes, ["TP53", "KRAS: AMP", "KRAS: AMP"]);
  assert.deepEqual(moveTrack({ genes: ["TP53", "kras: amp"] }, "KRAS: AMP", -1).genes, ["kras: amp", "TP53"], "by its written-back key");
});

test("R13: canRemoveTrack is false only for the last remaining gene row (ours)", () => {
  assert.equal(canRemoveTrack({ genes: ["KRAS: AMP", "KRAS: AMP"] }, "KRAS: AMP"), true);
  assert.equal(canRemoveTrack({ genes: ["KRAS: AMP", "KRAS: AMP"] }, "KRAS: AMP #2"), true);
  assert.equal(canRemoveTrack({ genes: ["KRAS: AMP", "KRAS: MUT"] }, "KRAS: MUT"), true);
  assert.equal(canRemoveTrack({ genes: ["KRAS: AMP"] }, "KRAS: AMP"), false);
  assert.equal(canRemoveTrack({ genes: ["KRAS: AMP", "KRAS: MUT"] }, "KRAS"), false, "no row is keyed 'KRAS'");
});

// ---------------------------------------------------------------------------------------------
// the Results page: each line its own row
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[]) => ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))] });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
const oncoprintGenes = (entries: string[]) =>
  (resultsLayout(rq(entries), rdata).doc.views!.find((v) => (v as { kind: string }).kind === "oncoprint") as unknown as { genes: unknown[] }).genes;

test("R15: 'KRAS: AMP; KRAS: MUT; TP53' — each line its own row, in query order (OU 1093-1190)", () => {
  assert.deepEqual(oncoprintRows(["KRAS: AMP", "KRAS: MUT", "TP53"]), ["KRAS: AMP", "KRAS: MUT", "TP53"]);
  assert.deepEqual(oncoprintGenes(["KRAS: AMP", "KRAS: MUT", "TP53"]), ["KRAS: AMP", "KRAS: MUT", "TP53"]);
  assert.deepEqual(oncoprintRows(["KRAS: MUT", "TP53", "KRAS: AMP"]), ["KRAS: MUT", "TP53", "KRAS: AMP"], "not gathered by gene");
  assert.deepEqual(oncoprintRows(["KRAS: AMP EXP>2", "KRAS: MUT"]), ["KRAS: AMP", "KRAS: MUT"], "EXP / PROT still left out (PR 4)");
});

test("R15: the page note no longer says two lines are drawn as one row; it still names EXP / PROT", () => {
  assert.equal(oncoprintAside(["KRAS: AMP", "KRAS: MUT", "TP53"]), null);
  const exp = oncoprintAside(["KRAS: AMP EXP>2", "KRAS: MUT"]);
  assert.ok(exp && /EXP \/ PROT/.test(exp) && !/one row/.test(exp), String(exp));
});

test("R16: 'KRAS; KRAS: AMP' — the bare row, then the line (OU)", () => {
  assert.deepEqual(oncoprintRows(["KRAS", "KRAS: AMP"]), ["KRAS", "KRAS: AMP"]);
  assert.deepEqual(oncoprintGenes(["KRAS", "KRAS: AMP"]), ["KRAS", "KRAS: AMP"]);
  assert.deepEqual(oncoprintRows(["KRAS: AMP", "KRAS: AMP"]), ["KRAS: AMP", "KRAS: AMP"], "R5: the same line twice is two rows");
});
