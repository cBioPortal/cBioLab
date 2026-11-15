// A row's EXP / PROT commands are drawn in its cells and counted, as cBioPortal's Results view
// does. Written from the case table of PR 4 of the OQL series (rows X1-X20); each test cites its
// row and the legacy source (cbioportal-frontend at cd8c6df) it was read from.
//   OF   = src/shared/lib/oql/oqlfilter.ts (isDatumWantedByOQLEXPOrPROTCommand 1005-1048,
//          isDatumWantedByOQLLine 520-578, isDatumWantedByAnyTypeWithModifiersCommand 627-669)
//   DU   = src/shared/components/oncoprint/DataUtils.ts (selectDisplayValue 124-160, fillGeneticTrackDatum 162-241)
//   TD   = src/shared/components/oncoprint/tabularDownload.ts 70-77
//   RVPS = src/pages/resultsView/ResultsViewPageStore.ts (buildDefaultOQLProfile 333-363, filteredSequencedSampleKeysByGene 2311-2341)
//   OU   = src/shared/components/oncoprint/OncoprintUtils.ts (isAltered 1010, getAlterationInfo 878-924)
//
// An expression datum is an EventRow {pid, gene, vt: "exp" | "prot", z}, one per SAMPLE: a patient
// column may have several, each with the patient's pid. The SQL that reads them
// (expressionEventsSql) is checked against scratch tables in scripts/check-oncoprint-values.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { parseOql, type OqlSpec } from "../lib/oql-parse.ts";
// a namespace import, so a function the change adds fails its own tests rather than the file
import * as oqlMatch from "../lib/oql-match.ts";
import { normalizeGeneTracks } from "../lib/gene-tracks.ts";
import { assembleContract, BITS, NOT_PROFILED, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import { contractToTsv, geneticText } from "../lib/oncoprint-tabular.ts";
import { oncoprintRows, resultsLayout } from "../app/portal/results-layout.ts";
import type { Contract, Track } from "../lib/types.ts";

/** the specs of `KRAS: <line>` as the parser gives them */
const specs = (line: string): OqlSpec[] => parseOql("KRAS: " + line)[0].specs;
type Level = "high" | "low" | null;
const oqlLevel = (s: readonly OqlSpec[], ev: oqlMatch.OqlEvent): Level => {
  const f = (oqlMatch as unknown as { oqlLevel?: (s: readonly OqlSpec[], ev: oqlMatch.OqlEvent) => Level }).oqlLevel;
  assert.equal(typeof f, "function", "lib/oql-match.ts exports oqlLevel");
  return f!(s, ev);
};
const exp = (z: number | null): oqlMatch.OqlEvent => ({ vt: "exp", z } as oqlMatch.OqlEvent);
const prot = (z: number | null): oqlMatch.OqlEvent => ({ vt: "prot", z } as oqlMatch.OqlEvent);
const wants = (line: string, ev: oqlMatch.OqlEvent, driver = false) => oqlMatch.eventWanted(specs(line), ev, driver);

// ---------------------------------------------------------------------------------------------
// eventWanted / oqlLevel: which expression data a line wants, and as what
// ---------------------------------------------------------------------------------------------

test("X1: EXP>2 wants an mRNA value above 2, not 2 itself (OF 1025-1040)", () => {
  assert.equal(wants("EXP>2", exp(2.5)), true);
  assert.equal(wants("EXP>2", exp(2)), false);
  assert.equal(wants("EXP>2", exp(-3)), false);
  assert.equal(oqlLevel(specs("EXP>2"), exp(2.5)), "high");
  assert.equal(oqlLevel(specs("EXP>2"), exp(2)), null);
});

test("X2: EXP>=2 wants 2 itself, as high (OF 1031-1035)", () => {
  assert.equal(wants("EXP>=2", exp(2)), true);
  assert.equal(wants("EXP>=2", exp(1.99)), false);
  assert.equal(oqlLevel(specs("EXP>=2"), exp(2)), "high");
});

test("X3: EXP<-2 wants below -2, EXP<=-2 at -2 too, as low (OF 1025-1030)", () => {
  assert.equal(wants("EXP<-2", exp(-2.5)), true);
  assert.equal(wants("EXP<-2", exp(-2)), false);
  assert.equal(wants("EXP<=-2", exp(-2)), true);
  assert.equal(wants("EXP<=-2", exp(-1.99)), false);
  assert.equal(oqlLevel(specs("EXP<-2"), exp(-2.5)), "low");
  assert.equal(oqlLevel(specs("EXP<=-2"), exp(-2)), "low");
});

test("X3 (OF 1025-1043): the level is the operator's direction, not the value's sign — EXP<5 at 3 is low, EXP>-5 at -3 high", () => {
  assert.equal(oqlLevel(specs("EXP<5"), exp(3)), "low");
  assert.equal(oqlLevel(specs("EXP>-5"), exp(-3)), "high");
});

test("X4: EXP>=2 EXP<=-2 wants high above, low below, nothing between (OF, RVPS 349-352)", () => {
  const line = "EXP>=2 EXP<=-2";
  assert.equal(wants(line, exp(2.5)), true);
  assert.equal(wants(line, exp(-3)), true);
  assert.equal(wants(line, exp(0)), false);
  assert.equal(wants(line, exp(1.99)), false);
  assert.equal(oqlLevel(specs(line), exp(2.5)), "high");
  assert.equal(oqlLevel(specs(line), exp(-3)), "low");
  assert.equal(oqlLevel(specs(line), exp(0)), null);
});

test("X4 (legacy, OF 568-577 + 1042-1044): with two commands wanting one value the LAST one's subtype stands — EXP>1 EXP<3 at 2 is low", () => {
  // isDatumWantedByOQLLine maps EVERY command over the datum and each that matches writes
  // datum.alterationSubType, so the last match wins. (The PR's API text says "the first command
  // that wants it", which would give high: the legacy source disagrees.)
  assert.equal(oqlLevel(specs("EXP>1 EXP<3"), exp(2)), "low");
  assert.equal(oqlLevel(specs("EXP<3 EXP>1"), exp(2)), "high");
});

test("X5: PROT>=1.5 wants a protein value at 1.5, never an mRNA one; EXP never a protein one (OF 1013-1015, AC exp/prot 223-243)", () => {
  assert.equal(wants("PROT>=1.5", prot(1.5)), true);
  assert.equal(wants("PROT>=1.5", prot(1.4)), false);
  assert.equal(wants("PROT>=1.5", exp(3)), false, "PROT addresses protein data only");
  assert.equal(wants("EXP>=2", prot(3)), false, "EXP addresses mRNA data only");
  assert.equal(oqlLevel(specs("PROT>=1.5"), prot(2)), "high");
  assert.equal(oqlLevel(specs("PROT<=-1.5"), prot(-2)), "low");
  assert.equal(oqlLevel(specs("PROT>=1.5"), exp(2)), null);
  assert.equal(oqlLevel(specs("EXP>=2"), prot(2)), null);
});

test("X6: MUT EXP>=2 wants a mutation and a high mRNA, each by its own command (OF 552-577)", () => {
  assert.equal(wants("MUT EXP>=2", exp(2.5)), true);
  assert.equal(wants("MUT EXP>=2", { vt: "mutation", mt: "Missense_Mutation", mv: "G12D" }), true);
  assert.equal(wants("MUT EXP>=2", exp(1)), false);
  assert.equal(wants("EXP>=2", { vt: "mutation", mt: "Missense_Mutation", mv: "G12D" }), false, "EXP does not want a mutation");
  assert.equal(wants("EXP>=2", { vt: "cna", cna: 2 }), false, "nor an amplification");
  assert.equal(oqlLevel(specs("MUT EXP>=2"), exp(2.5)), "high");
  assert.equal(oqlLevel(specs("MUT EXP>=2"), { vt: "mutation", mt: "Missense_Mutation" }), null, "a mutation has no level");
});

test("X7: a datum with no value is not addressed (OF 1016-1019)", () => {
  assert.equal(wants("EXP>=2 EXP<=-2", exp(null)), false);
  assert.equal(oqlLevel(specs("EXP>=2 EXP<=-2"), exp(null)), null);
});

test("X13: a bare gene (ANY) and DRIVER never want an exp / prot event; other commands do not either (ours; OF 627-669: DRIVER rejects a datum with no CNA)", () => {
  const bare = parseOql("KRAS")[0].specs;
  assert.equal(oqlMatch.eventWanted(bare, exp(5), false), false, "a bare gene's line");
  assert.equal(oqlMatch.eventWanted(bare, prot(5), false), false);
  assert.equal(oqlMatch.eventWanted(bare, { vt: "mutation", mt: "Missense_Mutation" }, false), true, "a bare gene still wants every alteration");
  assert.equal(wants("DRIVER", exp(5), true), false, "DRIVER, even with the datum called a driver");
  assert.equal(wants("DRIVER", prot(-5), true), false);
  for (const line of ["MUT", "AMP", "HOMDEL", "FUSION", "MUT_DRIVER", "CNA"]) {
    assert.equal(wants(line, exp(5)), false, line);
    assert.equal(wants(line, prot(5)), false, line);
  }
  assert.equal(oqlLevel(bare, exp(5)), null);
});

test("X14: the sublabel writes EXP / PROT back as typed (OF parsedOQLAlterationToSourceOQL 356-359)", () => {
  assert.equal(oqlMatch.oqlSublabel(specs("EXP>2")), ": EXP>2");
  assert.equal(oqlMatch.oqlSublabel(specs("EXP>=2 EXP<=-2")), ": EXP>=2 EXP<=-2");
  assert.equal(oqlMatch.oqlSublabel(specs("MUT EXP>=2")), ": MUT EXP>=2");
  assert.equal(oqlMatch.oqlSublabel(specs("PROT>=1.5")), ": PROT>=1.5");
});

// ---------------------------------------------------------------------------------------------
// gene-tracks: a row may carry EXP / PROT
// ---------------------------------------------------------------------------------------------

test("X1/X5: normalizeGeneTracks keeps a row's EXP / PROT, with or beside other commands", () => {
  const { tracks } = normalizeGeneTracks(["KRAS: EXP>2", "KRAS: PROT<-1", "KRAS: AMP EXP>2", "TP53"]);
  assert.deepEqual(tracks.map((t) => t.oql), [specs("EXP>2"), specs("PROT<-1"), specs("AMP EXP>2"), undefined]);
});

// ---------------------------------------------------------------------------------------------
// assembleContract: a row's EXP / PROT drawn per cell and counted
// ---------------------------------------------------------------------------------------------

type DEv = EventRow & { driver?: boolean };
const e = (pid: string, gene: string, vt: string, o: Partial<DEv> = {}): DEv => ({ pid, gene, vt, ...o });
const z = (pid: string, ...vals: number[]): DEv[] => vals.map((v) => e(pid, "KRAS", "exp", { z: v } as Partial<DEv>));
const pz = (pid: string, ...vals: number[]): DEv[] => vals.map((v) => e(pid, "KRAS", "prot", { z: v } as Partial<DEv>));
const PIDS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"];
/**
 * KRAS's mRNA values per sample:
 *   P1 2.5 (and a driver missense)   P2 2 (and a VUS amplification)   P3 2.5, -3 (a tie)
 *   P4 2.5, 3, -3 (two high)         P5 -3, -2.5, 3 (two low)          P6 1, 2.5 (KRAS off its panel)
 *   P7 0.5 (no panel at all)         P8 none (KRAS on its panel)      P9 -2
 * protein: P1 1.6, P2 1.5, P3 1.4, P7 0.1. Panels: P1-P5, P8, P9 cover KRAS and TP53; P6 TP53 only;
 * P7 none. Every expression datum is marked driver: expression is never a driver (X11).
 */
const fixture = (genes: AssembleInput["genes"], over: Partial<AssembleInput> = {}): AssembleInput => ({
  genes,
  groups: [{ name: "all", pids: PIDS }],
  studies: ["s"],
  events: [
    e("P1", "KRAS", "mutation", { mt: "Missense_Mutation", mv: "G12D", driver: true }),
    e("P2", "KRAS", "cna", { cna: 2 }),
    e("P1", "TP53", "mutation", { mt: "Nonsense_Mutation", mv: "R213*", driver: true }),
    ...[...z("P1", 2.5), ...z("P2", 2), ...z("P3", 2.5, -3), ...z("P4", 2.5, 3, -3), ...z("P5", -3, -2.5, 3),
      ...z("P6", 1, 2.5), ...z("P7", 0.5), ...z("P9", -2),
      ...pz("P1", 1.6), ...pz("P2", 1.5), ...pz("P3", 1.4), ...pz("P7", 0.1)].map((x) => ({ ...x, driver: true })),
  ],
  coverage: [...["P1", "P2", "P3", "P4", "P5", "P8", "P9"].map((pid) => ({ pid, genes: ["KRAS", "TP53"] })), { pid: "P6", genes: ["TP53"] }],
  isDriver: (r: EventRow) => !!(r as DEv).driver,
  annotationSource: "fixture",
  clinical: [], heatmap: [], derived: [], sort: [{ track: "genomic", dir: "asc" }], lineGap: 90,
  ...over
});
type Keyed = { key?: string };
const keyOf = (t: { label: string } & Keyed): string => t.key ?? t.label;
const geneRows = (c: Contract) => c.tracks.filter((t) => t.kind === "gene") as (Track & Keyed)[];
function row(c: Contract, key: string) {
  const t = geneRows(c).find((x) => keyOf(x) === key);
  assert.ok(t, "no gene row keyed " + key + " (rows: " + geneRows(c).map((x) => keyOf(x)).join(", ") + ")");
  const cell = (pid: string) => t.cells[c.columns.indexOf(pid)];
  return { t, cell, by: Object.fromEntries(PIDS.map((p) => [p, cell(p)])) };
}
const EXPRESSION = BITS.MRNA_HIGH | BITS.MRNA_LOW | BITS.PROT_HIGH | BITS.PROT_LOW;
/** a cell's expression bits, by name */
const level = (c: number): string => c === NOT_PROFILED ? "np" : [
  c & BITS.MRNA_HIGH ? "MRNA_HIGH" : "", c & BITS.MRNA_LOW ? "MRNA_LOW" : "",
  c & BITS.PROT_HIGH ? "PROT_HIGH" : "", c & BITS.PROT_LOW ? "PROT_LOW" : ""].filter(Boolean).join("|") || "-";
const levels = (by: Record<string, number>) => Object.fromEntries(Object.entries(by).map(([p, c]) => [p, level(c)]));
const MIS_D = BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER;

test("X4/X8/X9/X12: KRAS: EXP>=2 EXP<=-2 — each cell high or low by its wanted samples' count, high on a tie (DU 124-160; ours on a tie)", () => {
  const c = assembleContract(fixture(["KRAS: EXP>=2 EXP<=-2", "TP53"]));
  const { by } = row(c, "KRAS: EXP>=2 EXP<=-2");
  assert.deepEqual(levels(by), {
    P1: "MRNA_HIGH",      // X4: 2.5
    P2: "MRNA_HIGH",      // X2: 2 at >=2
    P3: "MRNA_HIGH",      // X8: one high, one low — a tie, high (ours; the portal the first sample's)
    P4: "MRNA_HIGH",      // X9: two high, one low
    P5: "MRNA_LOW",       // two low, one high: the count decides, not the order
    P6: "MRNA_HIGH",      // X10/X12: 1 is not wanted, 2.5 is; profiled by its value though off-panel
    P7: "-",              // X12: a value (0.5), unwanted: profiled, unaltered
    P8: "-",              // X7: no value: not altered by EXP, nothing drawn; profiled by its panel
    P9: "MRNA_LOW",       // X3: -2 at <=-2
  });
  assert.equal(by.P1 & BITS.MISSENSE, 0, "the line does not want the mutation");
  assert.equal(by.P2 & BITS.AMP, 0, "nor the amplification");
  assert.equal(by.P8, 0);
  assert.equal(by.P7, 0);
});

test("X1: KRAS: EXP>2 — 2 is not high; a cell's unwanted samples do not count (OF 1025-1040, DU)", () => {
  const c = assembleContract(fixture(["KRAS: EXP>2"]));
  assert.deepEqual(levels(row(c, "KRAS: EXP>2").by), {
    P1: "MRNA_HIGH", P2: "-", P3: "MRNA_HIGH", P4: "MRNA_HIGH",
    P5: "MRNA_HIGH",      // its one wanted sample (3) is high; the two low ones are not wanted by this line
    P6: "MRNA_HIGH", P7: "-", P8: "-", P9: "-"
  });
});

test("X3: KRAS: EXP<-2 and KRAS: EXP<=-2 — low below / at -2 (OF)", () => {
  const c = assembleContract(fixture(["KRAS: EXP<-2", "KRAS: EXP<=-2"]));
  const lt = levels(row(c, "KRAS: EXP<-2").by), le = levels(row(c, "KRAS: EXP<=-2").by);
  assert.deepEqual(lt, { P1: "-", P2: "-", P3: "MRNA_LOW", P4: "MRNA_LOW", P5: "MRNA_LOW", P6: "-", P7: "-", P8: "-", P9: "-" });
  assert.deepEqual(le, { ...lt, P9: "MRNA_LOW" });
});

test("X10: KRAS: EXP>=2 — a patient with samples 1 and 2.5 is high (any sample's datum counts, DU)", () => {
  const c = assembleContract(fixture(["KRAS: EXP>=2"]));
  assert.equal(level(row(c, "KRAS: EXP>=2").by.P6), "MRNA_HIGH");
});

test("X5: KRAS: PROT>=1.5 draws PROT_HIGH from the protein values; no mRNA value is read for it (OF 1013-1015)", () => {
  const c = assembleContract(fixture(["KRAS: PROT>=1.5"]));
  const { by, t } = row(c, "KRAS: PROT>=1.5");
  assert.deepEqual(levels(by), { P1: "PROT_HIGH", P2: "PROT_HIGH", P3: "-", P4: "-", P5: "-", P6: levels(by).P6, P7: "-", P8: "-", P9: "-" });
  assert.ok(!(by.P6 > 0 && by.P6 & EXPRESSION), "P6's high mRNA is not drawn in a protein row");
  assert.equal(t.altered, 2);
  assert.equal(by.P7, 0, "X12: P7 has a protein value, so it is profiled for the PROT row");
});

test("X6/X11: KRAS: MUT EXP>=2 — a mutation and a high mRNA both drawn in one cell; altered when either; driver % from the mutation only (OF 552-577, OU)", () => {
  const c = assembleContract(fixture(["KRAS: MUT EXP>=2"]));
  const { by, t } = row(c, "KRAS: MUT EXP>=2");
  assert.equal(by.P1, MIS_D | BITS.MRNA_HIGH, "the driver missense and the high mRNA");
  assert.deepEqual(levels(by), {
    P1: "MRNA_HIGH", P2: "MRNA_HIGH", P3: "MRNA_HIGH", P4: "MRNA_HIGH",
    P5: "MRNA_HIGH",      // only its 3 is wanted (no EXP<= command): high
    P6: "MRNA_HIGH", P7: "-", P8: "-", P9: "-"
  });
  assert.equal(by.P2 & BITS.AMP, 0, "the amplification is not this line's");
  assert.equal(t.altered, 6, "P1-P6");
  assert.equal(t.profiled, 9, "P1-P5, P8, P9 by their panels; P6, P7 by their mRNA values");
  assert.equal(t.driverAltered, 1, "X11: P1's driver missense only — expression is never a driver, whatever isDriver says of it");
});

test("X11/X12: KRAS: EXP>=2 EXP<=-2 — EXP-altered columns are altered; columns with a value are profiled; the driver % is untouched (OU, RVPS 2311-2341)", () => {
  const c = assembleContract(fixture(["KRAS: EXP>=2 EXP<=-2"]));
  const { t, by } = row(c, "KRAS: EXP>=2 EXP<=-2");
  assert.equal(t.altered, 7, "P1-P6, P9");
  assert.equal(t.profiled, 9, "P6 (off-panel) and P7 (no panel) are profiled by their mRNA values");
  assert.equal(t.freqPct, 77.8);
  assert.equal(t.driverAltered, 0);
  assert.equal(t.driverPct, 0);
  assert.notEqual(by.P6, NOT_PROFILED);
  assert.notEqual(by.P7, NOT_PROFILED);
});

test("X12 (ours): a bare KRAS row is not made profiled by mRNA values when no row asks for them", () => {
  const c = assembleContract(fixture(["KRAS"]));
  const { by, t } = row(c, "KRAS");
  assert.equal(by.P6, NOT_PROFILED);
  assert.equal(by.P7, NOT_PROFILED);
  assert.equal(t.profiled, 7);
});

test("X13: a row without EXP / PROT beside rows of the same gene with them draws no mRNA / protein bits (OF: its line does not ask)", () => {
  const c = assembleContract(fixture(["KRAS: EXP>=2 EXP<=-2", "KRAS", "KRAS: AMP", "KRAS: PROT>=1.5"]));
  for (const key of ["KRAS", "KRAS: AMP"]) {
    const { by } = row(c, key);
    for (const p of PIDS) assert.equal(by[p] > 0 ? by[p] & EXPRESSION : 0, 0, key + " " + p);
  }
  const bare = row(c, "KRAS");
  assert.equal(bare.by.P1, MIS_D, "the bare row still draws its alterations");
  assert.equal(bare.t.altered, 2, "P1, P2");
  assert.equal(row(c, "KRAS: AMP").t.altered, 1);
  // each expression row still its own
  assert.equal(level(row(c, "KRAS: EXP>=2 EXP<=-2").by.P5), "MRNA_LOW");
  assert.equal(level(row(c, "KRAS: PROT>=1.5").by.P1), "PROT_HIGH");
});

test("X12 (legacy, RVPS 2311-2341): profiled is per GENE, so a KRAS: AMP row beside KRAS: EXP>=2 counts the mRNA-profiled columns too — X12 says 'for that row'", () => {
  // filteredSequencedSampleKeysByGene: a sample is sequenced for a gene when it is profiled in ANY
  // selected molecular profile, and getAlterationInfo divides every row of that gene by it. With
  // the mRNA profile selected (an EXP row asks for it), P6 and P7 are profiled for every KRAS row.
  const c = assembleContract(fixture(["KRAS: EXP>=2", "KRAS: AMP"]));
  const amp = row(c, "KRAS: AMP");
  assert.equal(amp.t.profiled, 9, "the same denominator as the EXP row");
  assert.equal(amp.by.P6, 0);
  assert.equal(amp.by.P7, 0);
  assert.equal(level(amp.by.P6), "-", "profiled, still no mRNA bit");
});

test("X8 (sample columns): each sample its own column, its own level", () => {
  const samples = ["P3-S1", "P3-S2"];
  const c = assembleContract(fixture(["KRAS: EXP>=2 EXP<=-2"], {
    unit: "sample", groups: [{ name: "all", pids: samples }],
    events: [e("P3-S1", "KRAS", "exp", { z: 2.5 } as Partial<DEv>), e("P3-S2", "KRAS", "exp", { z: -3 } as Partial<DEv>)],
    coverage: samples.map((pid) => ({ pid, genes: ["KRAS"] })),
  }));
  const t = geneRows(c)[0];
  assert.deepEqual(samples.map((s) => level(t.cells[c.columns.indexOf(s)])), ["MRNA_HIGH", "MRNA_LOW"]);
});

test("X19: a view's overlays stay uncounted, on an EXP row too (ours; test/oncoprint-assemble.test.ts 'a merged row draws its members' overlays too')", () => {
  // an mRNA overlay at threshold 1: P7's 1.5 and P8's 3 set MRNA_HIGH, which the row's line did not want
  const overlays: AssembleInput["overlays"] = [{ kind: "mrna", profileType: "rna", threshold: 1, values: new Map([["P7|KRAS", 1.5], ["P8|KRAS", 3]]) }];
  const c = assembleContract(fixture(["KRAS: EXP>=2 EXP<=-2", "KRAS"], { overlays }));
  const e2 = row(c, "KRAS: EXP>=2 EXP<=-2"), bare = row(c, "KRAS");
  assert.ok(e2.by.P8 & BITS.MRNA_HIGH, "the overlay is drawn");
  assert.equal(e2.t.altered, 7, "but P7 and P8 are not counted: still P1-P6, P9");
  assert.ok(bare.by.P8 & BITS.MRNA_HIGH);
  assert.equal(bare.t.altered, 2, "the bare row's overlay bits are uncounted, as before");
});

test("X14: the contract's EXP / PROT rows carry their lines as sublabels", () => {
  const c = assembleContract(fixture(["KRAS: EXP>2", "KRAS: EXP>=2 EXP<=-2", "KRAS: MUT EXP>=2", "KRAS: PROT>=1.5"]));
  assert.deepEqual(geneRows(c).map((t) => (t as Track & { sublabel?: string }).sublabel), [": EXP>2", ": EXP>=2 EXP<=-2", ": MUT EXP>=2", ": PROT>=1.5"]);
});

// ---------------------------------------------------------------------------------------------
// the Tabular download
// ---------------------------------------------------------------------------------------------

test("X17: geneticText's MRNA and PROTEIN texts (TD 70-77): no driver suffix, nothing for a cell without the bit", () => {
  for (const annotated of [false, true]) {
    assert.equal(geneticText(BITS.MRNA_HIGH, "MRNA", annotated), "mRNA High");
    assert.equal(geneticText(BITS.MRNA_LOW, "MRNA", annotated), "mRNA Low");
    assert.equal(geneticText(BITS.PROT_HIGH, "PROTEIN", annotated), "Protein High");
    assert.equal(geneticText(BITS.PROT_LOW, "PROTEIN", annotated), "Protein Low");
    assert.equal(geneticText(MIS_D | BITS.MRNA_HIGH, "MRNA", annotated), "mRNA High");
  }
  assert.equal(geneticText(BITS.PROT_HIGH, "MRNA", true), "", "a protein bit is not an mRNA text");
  assert.equal(geneticText(BITS.MRNA_LOW, "PROTEIN", true), "");
  assert.equal(geneticText(MIS_D, "MRNA", true), "");
  assert.equal(geneticText(0, "MRNA", true), "");
  assert.equal(geneticText(NOT_PROFILED, "PROTEIN", true), "");
});

test("X17: the Tabular download of 'KRAS: EXP>=2 EXP<=-2; KRAS: PROT>=1.5' fills KRAS's MRNA and PROTEIN rows (TD 70-77, 91-140)", () => {
  const c = assembleContract(fixture(["KRAS: EXP>=2 EXP<=-2", "KRAS: PROT>=1.5"]));
  const [head, ...lines] = contractToTsv(c).trimEnd().split("\n").map((l) => l.split("\t"));
  const ids = head.slice(2);
  const of = (type: string) => {
    const l = lines.find(([n, t]) => n === "KRAS" && t === type);
    assert.ok(l, "no KRAS " + type + " row");
    return Object.fromEntries(ids.map((id, i) => [id, l[2 + i]]));
  };
  const mrna = of("MRNA"), protein = of("PROTEIN");
  assert.equal(mrna.P1, "mRNA High");
  assert.equal(mrna.P5, "mRNA Low");
  assert.equal(mrna.P8, "");
  assert.equal(protein.P1, "Protein High");
  assert.equal(protein.P3, "");
});

// ---------------------------------------------------------------------------------------------
// the Results page: the oncoprint draws the whole line, reading the query's profiles
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[], pins: { exp?: string; prot?: string; ifHeld?: boolean } = {}) =>
  ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))], ...pins });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
const oncoprintView = (entries: string[], pins: { exp?: string; prot?: string; ifHeld?: boolean } = {}) =>
  resultsLayout(rq(entries, pins), rdata).doc.views!.find((v) => (v as { kind: string }).kind === "oncoprint") as unknown as
    { genes: unknown[]; exp?: string; prot?: string; ifHeld?: boolean };
const LINE = "KRAS: MUT FUSION AMP HOMDEL EXP>=2 EXP<=-2";
const Z = "rna_seq_v2_mrna_median_all_sample_Zscores";

test("X18: oncoprintRows keeps a line's EXP / PROT terms (RVPS 333-363)", () => {
  assert.deepEqual(oncoprintRows([LINE]), [LINE]);
  assert.deepEqual(oncoprintRows(["KRAS: EXP>2", "TP53: PROT<=-1.5"]), ["KRAS: EXP>2", "TP53: PROT<=-1.5"]);
  assert.deepEqual(oncoprintRows(["KRAS: AMP EXP>2", "KRAS: MUT"]), ["KRAS: AMP EXP>2", "KRAS: MUT"]);
  assert.deepEqual(oncoprintRows(["KRAS", "TP53"]), ["KRAS", "TP53"], "a bare gene stays bare");
});

test("X18: the oncoprint view draws the whole line and reads exp / prot / ifHeld from the query", () => {
  const v = oncoprintView([LINE, "TP53"], { exp: Z });
  assert.deepEqual(v.genes, [LINE, "TP53"]);
  assert.equal(v.exp, Z);
  assert.equal(v.prot, undefined);
  const both = oncoprintView(["KRAS: EXP>=2 PROT>=1.5"], { exp: Z, prot: "rppa_Zscores", ifHeld: true });
  assert.deepEqual([both.exp, both.prot, both.ifHeld], [Z, "rppa_Zscores", true]);
  const none = oncoprintView(["KRAS: AMP"]);
  assert.ok(!("exp" in none) && !("prot" in none) && !("ifHeld" in none), "nothing named, nothing carried: " + JSON.stringify(none));
});


