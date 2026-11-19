// A gene row of the oncoprint draws only what its OQL line wants, as cBioPortal's Results view
// does (oqlfilter.ts isDatumWantedByOQLLine and its commands), and carries the line as its
// sublabel. Written from the case table of PR 1 of the OQL series (rows O1-O38); each test cites
// its row and the legacy source (cbioportal-frontend at cd8c6df) it was read from.
//   OF  = src/shared/lib/oql/oqlfilter.ts
//   AC  = src/shared/lib/oql/AccessorsForOqlFilter.ts
//   OU  = src/shared/components/oncoprint/OncoprintUtils.ts
//   OLV = packages/oncoprintjs/src/js/oncoprintlabelview.ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseOql, type OqlSpec } from "../lib/oql-parse.ts";
import { defaultOqlSublabel, eventWanted, oqlSublabel } from "../lib/oql-match.ts";
import { normalizeGeneTracks, geneSymbols, parseGeneList, formatGeneList, toGeneList } from "../lib/gene-tracks.ts";
import { assembleContract, normalizeDisplay, BITS, NOT_PROFILED, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import { defaultOqlProfiles, normalizeSpec } from "../lib/oncoprint.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { STYLE, trackSublabelText, fitSublabel } from "../lib/oncoprint-style.ts";
import { resolveDrivers, isDriverEvent, type DriverSettings } from "../lib/driver-settings.ts";
import { draw, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";
import { resultsLayout } from "../app/portal/results-layout.ts";
import type { Contract, ResolvedDisplay } from "../lib/types.ts";

const oqlMatch = async () => ({ eventWanted, oqlSublabel });

/** the specs of `KRAS: <line>` as the parser gives them */
const specs = (line: string): OqlSpec[] => parseOql("KRAS: " + line)[0].specs;

type Ev = EventRow & { ps?: number | null; pe?: number | null };
const mut = (mt: string | undefined, mv?: string, extra: Partial<Ev> = {}): Ev => ({ pid: "P1", gene: "KRAS", vt: "mutation", mt, mv, ...extra });
const cna = (v: number | string): Ev => ({ pid: "P1", gene: "KRAS", vt: "cna", cna: v });
// an SV row's mutation_type/variant as the events SQL carries them: the verdict must read vt, not mt
const sv = (): Ev => ({ pid: "P1", gene: "KRAS", vt: "structural_variant", mt: "Fusion", mv: "KRAS-ALK" });
const at = (ps: number | null | undefined, pe: number | null | undefined, mv = "X1Y"): Ev => mut("Missense_Mutation", mv, { ps, pe });

/** eventWanted for `KRAS: <line>` */
async function wants(line: string, ev: Ev, driver = false): Promise<boolean> {
  return (await oqlMatch()).eventWanted(specs(line), ev, driver);
}

// ---------------------------------------------------------------------------------------------
// eventWanted: which events a row draws
// ---------------------------------------------------------------------------------------------

test("O1: no OQL (null, undefined, [] or a bare gene's ANY) wants every event (OF 545-548)", async () => {
  const { eventWanted } = await oqlMatch();
  const all = [mut("Missense_Mutation", "G12D"), mut("Nonsense_Mutation", "Q61*"), cna(2), cna(-2), sv()];
  for (const s of [null, undefined, [] as OqlSpec[], parseOql("KRAS")[0].specs])
    for (const ev of all) for (const driver of [true, false])
      assert.equal(eventWanted(s, ev, driver), true, JSON.stringify(s) + " " + JSON.stringify(ev) + " driver=" + driver);
});

test("O2: AMP wants amplifications only (OF 806-868; a MUT/SV datum is not addressed, 0)", async () => {
  assert.equal(await wants("AMP", cna(2)), true);
  assert.equal(await wants("AMP", cna("2")), true, "cna as text, as the events SQL may return it");
  assert.equal(await wants("AMP", cna(-2)), false);
  assert.equal(await wants("AMP", mut("Missense_Mutation", "G12D")), false);
  assert.equal(await wants("AMP", sv()), false);
});

test("O3: HOMDEL wants deep deletions only (OF 806-868)", async () => {
  assert.equal(await wants("HOMDEL", cna(-2)), true);
  assert.equal(await wants("HOMDEL", cna("-2")), true);
  assert.equal(await wants("HOMDEL", cna(2)), false);
  assert.equal(await wants("HOMDEL", mut("Missense_Mutation", "G12D")), false);
  assert.equal(await wants("HOMDEL", sv()), false);
});

test("O4: MUT wants every mutation of any class, no CNA, no SV (OF 870-886)", async () => {
  for (const mt of ["Missense_Mutation", "Nonsense_Mutation", "Frame_Shift_Del", "In_Frame_Ins", "Splice_Site", "5'Flank", "Silent", "Targeted_Region", undefined])
    assert.equal(await wants("MUT", mut(mt, "X1Y")), true, String(mt));
  assert.equal(await wants("MUT", mut("5'Flank", "Promoter")), true, "promoter");
  assert.equal(await wants("MUT", cna(2)), false);
  assert.equal(await wants("MUT", cna(-2)), false);
  assert.equal(await wants("MUT", sv()), false);
});

test("O4 (legacy): a mutation whose type is 'Fusion' has no class, so no MUT command addresses it (AC getMutationSubType 26-38; OF 878-881)", async () => {
  // AC mut_type returns null for mutationType "fusion"; OF isDatumWantedByOQLMUTCommand then returns 0,
  // and a line whose every command returns 0 leaves the datum unwanted (OF 552-577, starts at -1).
  assert.equal(await wants("MUT", mut("Fusion", "KRAS-ALK fusion")), false);
  assert.equal(await wants("TRUNC", mut("Fusion", "KRAS-ALK fusion")), false);
  assert.equal(await wants("MUT", mut("fusion", "KRAS-ALK fusion")), false, "compared case-insensitively");
});

test("O5: MUT=G12D and the shorthand G12D want that protein change, compared case-insensitively (OF 925-936)", async () => {
  for (const line of ["MUT=G12D", "G12D", "MUT=g12d", "g12d"]) {
    assert.equal(await wants(line, mut("Missense_Mutation", "G12D")), true, line);
    assert.equal(await wants(line, mut("Missense_Mutation", "g12d")), true, line + " against g12d");
    assert.equal(await wants(line, mut("Missense_Mutation", "G13D")), false, line + " against G13D");
    assert.equal(await wants(line, mut("Missense_Mutation", "G12DX")), false, line + ": the whole change, not a prefix");
    assert.equal(await wants(line, mut("Missense_Mutation", undefined)), false, line + ": no protein change is rejected (OF 927-930)");
    assert.equal(await wants(line, cna(2)), false, line + " against an amplification");
  }
});

test("O6: a mutation class wants that portal class of mutation_type, and a 'Promoter' protein change is promoter whatever its type (OF 891-904; AC getMutationSubType / getSimplifiedMutationType)", async () => {
  const cases: [string, [string | undefined, string][], [string | undefined, string][]][] = [
    ["MISSENSE", [["Missense_Mutation", "G12D"], ["missense", "G12D"], ["Missense_Variant", "G12D"]],
      [["Nonsense_Mutation", "Q61*"], ["Missense_Mutation", "Promoter"], ["Missense_Mutation", "promoter"], ["In_Frame_Del", "X"]]],
    ["NONSENSE", [["Nonsense_Mutation", "Q61*"], ["stopgain_SNV", "Q61*"]], [["Missense_Mutation", "G12D"], ["Frame_Shift_Del", "X"]]],
    ["NONSTART", [["Translation_Start_Site", "M1?"], ["Start_Codon_SNP", "M1?"]], [["Missense_Mutation", "G12D"]]],
    ["NONSTOP", [["Nonstop_Mutation", "*190Lext*"]], [["Nonsense_Mutation", "Q61*"]]],
    ["FRAMESHIFT", [["Frame_Shift_Del", "X"], ["Frame_Shift_Ins", "X"], ["De_novo_Start_OutOfFrame", "X"]], [["In_Frame_Del", "X"], ["Nonsense_Mutation", "X"]]],
    ["INFRAME", [["In_Frame_Del", "X"], ["In_Frame_Ins", "X"], ["indel", "X"]], [["Frame_Shift_Del", "X"], ["Missense_Mutation", "X"]]],
    ["SPLICE", [["Splice_Site", "X"], ["Splice_Region", "X"], ["splice_site_snp", "X"]], [["Missense_Mutation", "X"], ["Intron", "X"]]],
    ["PROMOTER", [["5'Flank", "Promoter"], ["Missense_Mutation", "promoter"], [undefined, "Promoter"]], [["5'Flank", "X"], ["Missense_Mutation", "G12D"]]],
  ];
  for (const [cls, yes, no] of cases) {
    for (const line of [cls, "MUT=" + cls]) {
      for (const [mt, mv] of yes) assert.equal(await wants(line, mut(mt, mv)), true, line + " wants " + mt + " " + mv);
      for (const [mt, mv] of no) assert.equal(await wants(line, mut(mt, mv)), false, line + " does not want " + mt + " " + mv);
      assert.equal(await wants(line, cna(2)), false, line + " against a CNA");
      assert.equal(await wants(line, sv()), false, line + " against an SV");
    }
  }
});

test("O7: TRUNC is every class but missense and inframe — promoter, splice and other count (OF 896-901)", async () => {
  for (const [mt, mv] of [["Nonsense_Mutation", "Q61*"], ["Frame_Shift_Del", "X"], ["Splice_Site", "X"], ["Translation_Start_Site", "X"],
    ["Nonstop_Mutation", "X"], ["5'Flank", "X"], ["Silent", "X"], ["5'Flank", "Promoter"], [undefined, "X"]] as [string | undefined, string][])
    assert.equal(await wants("TRUNC", mut(mt, mv)), true, "TRUNC wants " + mt + " " + mv);
  for (const [mt, mv] of [["Missense_Mutation", "G12D"], ["In_Frame_Del", "X"], ["In_Frame_Ins", "X"]])
    assert.equal(await wants("TRUNC", mut(mt, mv)), false, "TRUNC does not want " + mt);
  assert.equal(await wants("TRUNC", cna(-2)), false);
  assert.equal(await wants("TRUNC", sv()), false);
});

test("O8: FUSION wants structural variants only (OF 676-690)", async () => {
  assert.equal(await wants("FUSION", sv()), true);
  assert.equal(await wants("FUSION", cna(2)), false);
  assert.equal(await wants("FUSION", mut("Missense_Mutation", "G12D")), false);
});

test("O9: AMP MUT=G12D wants an event either command wants (OF 552-577)", async () => {
  assert.equal(await wants("AMP MUT=G12D", cna(2)), true);
  assert.equal(await wants("AMP MUT=G12D", mut("Missense_Mutation", "G12D")), true);
  assert.equal(await wants("AMP MUT=G12D", mut("Missense_Mutation", "G13D")), false);
  assert.equal(await wants("AMP MUT=G12D", cna(-2)), false);
  assert.equal(await wants("AMP MUT=G12D", sv()), false);
  // one command rejecting (-1) does not overrule another wanting (1)
  assert.equal(await wants("MUT=G13D MUT=G12D", mut("Missense_Mutation", "G12D")), true);
  assert.equal(await wants("HOMDEL AMP", cna(2)), true);
});

test("O10: CNA (ours) wants amplifications and deep deletions, no mutation, no SV", async () => {
  assert.equal(await wants("CNA", cna(2)), true);
  assert.equal(await wants("CNA", cna(-2)), true);
  assert.equal(await wants("CNA", mut("Missense_Mutation", "G12D")), false);
  assert.equal(await wants("CNA", sv()), false);
});

test("O11: DRIVER alone wants every alteration that is a driver, and no VUS (OF 629-664, 992-1003)", async () => {
  for (const ev of [mut("Missense_Mutation", "G12D"), mut("Nonsense_Mutation", "Q61*"), cna(2), cna(-2), sv()]) {
    assert.equal(await wants("DRIVER", ev, true), true, "driver " + ev.vt);
    assert.equal(await wants("DRIVER", ev, false), false, "VUS " + ev.vt);
  }
});

test("O12: a command with _DRIVER / DRIVER_ wants that command's events that are drivers (OF 937-946, 857-866, matchByModifiers)", async () => {
  const both = async (line: string, ev: Ev, expectDriver: boolean, expectVus: boolean) => {
    assert.equal(await wants(line, ev, true), expectDriver, line + " driver " + JSON.stringify(ev));
    assert.equal(await wants(line, ev, false), expectVus, line + " VUS " + JSON.stringify(ev));
  };
  for (const line of ["MUT_DRIVER", "DRIVER_MUT"]) {
    await both(line, mut("Missense_Mutation", "G12D"), true, false);
    await both(line, cna(2), false, false);
    await both(line, sv(), false, false);
  }
  for (const line of ["AMP_DRIVER", "DRIVER_AMP"]) {
    await both(line, cna(2), true, false);
    await both(line, cna(-2), false, false);
    await both(line, mut("Missense_Mutation", "G12D"), false, false);
  }
  await both("HOMDEL_DRIVER", cna(-2), true, false);
  await both("HOMDEL_DRIVER", cna(2), false, false);
  await both("CNA_DRIVER", cna(-2), true, false);
  await both("FUSION_DRIVER", sv(), true, false);
  await both("FUSION_DRIVER", mut("Missense_Mutation", "G12D"), false, false);
  for (const line of ["MISSENSE_DRIVER", "DRIVER_MISSENSE", "MUT=MISSENSE_DRIVER"]) {
    await both(line, mut("Missense_Mutation", "G12D"), true, false);
    await both(line, mut("Nonsense_Mutation", "Q61*"), false, false);
  }
  for (const line of ["MUT=G12D_DRIVER", "G12D_DRIVER", "DRIVER_G12D"]) {
    await both(line, mut("Missense_Mutation", "G12D"), true, false);
    await both(line, mut("Missense_Mutation", "G13D"), false, false);
  }
  await both("TRUNC_DRIVER", mut("Nonsense_Mutation", "Q61*"), true, false);
  // a driver command and a plain one on the same line: OR between commands, AND within one
  await both("AMP_DRIVER MUT", cna(2), true, false);
  await both("AMP_DRIVER MUT", mut("Missense_Mutation", "G13D"), true, true);
});

test("O14: a range wants mutations whose own [start, end] overlaps it (OF 951-978, AC mut_position)", async () => {
  for (const line of ["MUT_(10-15)", "(10-15)"]) {
    assert.equal(await wants(line, at(12, 12)), true, line + " 12-12");
    assert.equal(await wants(line, at(15, 20)), true, line + " overlaps at the end");
    assert.equal(await wants(line, at(5, 10)), true, line + " overlaps at the start");
    assert.equal(await wants(line, at(5, 30)), true, line + " spans it");
    assert.equal(await wants(line, at(16, 20)), false, line + " after it");
    assert.equal(await wants(line, at(1, 9)), false, line + " before it");
    assert.equal(await wants(line, cna(2)), false, line + " against a CNA");
  }
  // a range with a class or a driver modifier: AND within the command
  assert.equal(await wants("TRUNC_(10-15)", mut("Nonsense_Mutation", "X", { ps: 12, pe: 12 })), true);
  assert.equal(await wants("TRUNC_(10-15)", mut("Missense_Mutation", "X", { ps: 12, pe: 12 })), false);
  assert.equal(await wants("(10-15)_DRIVER", at(12, 12), true), true);
  assert.equal(await wants("(10-15)_DRIVER", at(12, 12), false), false);
});

test("O15: a range with * wants mutations lying inside it (OF 969-973)", async () => {
  assert.equal(await wants("MUT_(10-15*)", at(10, 15)), true);
  assert.equal(await wants("MUT_(10-15*)", at(12, 13)), true);
  assert.equal(await wants("MUT_(10-15*)", at(9, 12)), false, "overlaps but starts before");
  assert.equal(await wants("MUT_(10-15*)", at(14, 16)), false, "overlaps but ends after");
});

test("O16: an open range leaves its start or end unbounded (OF 963-966)", async () => {
  assert.equal(await wants("(1400-)", at(1400, 1400)), true);
  assert.equal(await wants("(1400-)", at(1390, 1401)), true, "overlaps");
  assert.equal(await wants("(1400-)", at(10, 1399)), false);
  assert.equal(await wants("(-500)", at(1, 1)), true);
  assert.equal(await wants("(-500)", at(500, 900)), true, "overlaps");
  assert.equal(await wants("(-500)", at(501, 900)), false);
  assert.equal(await wants("(12-*)", at(12, 3000)), true, "contained, open end");
  assert.equal(await wants("(12-*)", at(11, 14)), false);
});

test("O17: a mutation with no position, -1, or start after end never matches a range (AC mut_position 186-203, OF 958-961)", async () => {
  for (const [ps, pe] of [[null, null], [undefined, undefined], [12, null], [null, 12], [-1, 12], [12, -1], [-1, -1], [15, 12]] as [number | null | undefined, number | null | undefined][]) {
    for (const line of ["(1-100)", "(1-100*)", "(-100)", "(1-)", "MUT_(10-15)"])
      assert.equal(await wants(line, at(ps, pe)), false, line + " against [" + ps + ", " + pe + "]");
    assert.equal(await wants("MUT", at(ps, pe)), true, "MUT itself does not need a position");
  }
});

test("O18: positions are the mutation's own, not its protein change's", async () => {
  // the same protein change stored once as 11-12 and once as 12-12 (AC mut_position reads the datum)
  assert.equal(await wants("(12-12*)", at(11, 12, "G12_G13delinsXX")), false);
  assert.equal(await wants("(12-12*)", at(12, 12, "G12_G13delinsXX")), true);
});

test("O20: OQL wants a germline mutation as any other (OF: no GERMLINE modifier given)", async () => {
  assert.equal(await wants("MUT", mut("Missense_Mutation", "G12D", { germ: true })), true);
  assert.equal(await wants("MUT=G12D", mut("Missense_Mutation", "G12D", { germ: 1 })), true);
});

// ---------------------------------------------------------------------------------------------
// oqlSublabel: the line written back, less the gene
// ---------------------------------------------------------------------------------------------

test("O24: the sublabel is the portal's written-back line less the gene (OU 191-201; OF parsedOQLAlterationToSourceOQL 308-404, unparseOQLQueryLine 406-414)", async () => {
  const { oqlSublabel } = await oqlMatch();
  const cases: [string, string][] = [
    ["AMP MUT=G12D", ": AMP MUT=G12D"],
    ["AMP", ": AMP"],
    ["HOMDEL", ": HOMDEL"],
    ["MUT", ": MUT"],
    ["MISSENSE", ": MUT=MISSENSE"],
    ["MUT=MISSENSE", ": MUT=MISSENSE"],
    ["TRUNC", ": MUT=TRUNC"],
    ["MUT=G12D", ": MUT=G12D"],
    ["G12D", ": MUT=G12D"],
    ["MUT=G12D_DRIVER", ": MUT=G12D_DRIVER"],
    ["DRIVER_G12D", ": MUT=G12D_DRIVER"],
    ["DRIVER", ": DRIVER"],
    ["AMP_DRIVER", ": AMP_DRIVER"],
    ["DRIVER_AMP", ": AMP_DRIVER"],
    ["MUT_DRIVER", ": MUT_DRIVER"],
    ["DRIVER_MUT", ": MUT_DRIVER"],
    ["MISSENSE_DRIVER", ": MUT=MISSENSE_DRIVER"],
    ["DRIVER_MISSENSE", ": MUT=MISSENSE_DRIVER"],
    ["FUSION", ": FUSION"],
    ["FUSION_DRIVER", ": FUSION_DRIVER"],
    ["MUT_(10-15*)", ": MUT_(10-15*)"],
    ["(10-15*)", ": MUT_(10-15*)"],
    ["MUT_(10-15)", ": MUT_(10-15)"],
    ["(1400-)", ": MUT_(1400-)"],
    ["(-500)", ": MUT_(-500)"],
    ["(12-*)", ": MUT_(12-*)"],
    ["TRUNC_(1400-)", ": MUT=TRUNC_(1400-)"],
    ["MUT=G12D MUT=G13D", ": MUT=G12D MUT=G13D"],
    ["MISSENSE AMP HOMDEL", ": MUT=MISSENSE AMP HOMDEL"],
  ];
  for (const [line, expected] of cases) assert.equal(oqlSublabel(specs(line)), expected, "KRAS: " + line);
  // a lower-case line is written back in the portal's capitals
  assert.equal(oqlSublabel(parseOql("kras: amp")[0].specs), ": AMP");
});

test("O24 (ours): CNA, our AMP-or-HOMDEL, is written back as typed", async () => {
  // the portal has no bare CNA keyword (oql-parser.pegjs 112-118); its CNA_DRIVER writes back "CNA_DRIVER" (OF 314-322)
  const { oqlSublabel } = await oqlMatch();
  assert.equal(oqlSublabel(specs("CNA")), ": CNA");
  assert.equal(oqlSublabel(specs("CNA_DRIVER")), ": CNA_DRIVER");
});

test("O25: no OQL, no sublabel (OU 191-201)", async () => {
  const { oqlSublabel } = await oqlMatch();
  assert.equal(oqlSublabel(null), "");
  assert.equal(oqlSublabel(undefined), "");
  assert.equal(oqlSublabel([]), "");
  assert.equal(oqlSublabel(parseOql("KRAS")[0].specs), "", "a bare gene's ANY is no OQL");
});

// ---------------------------------------------------------------------------------------------
// gene-tracks: a gene-list entry may carry its OQL
// ---------------------------------------------------------------------------------------------

test("O23/O33: an entry with OQL is a row labelled by its gene, carrying the parsed line; a bare one carries none", () => {
  const { tracks, symbols } = normalizeGeneTracks(["KRAS: AMP MUT=G12D", "TP53"]);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].label, "KRAS");
  assert.deepEqual(tracks[0].members, ["KRAS"]);
  assert.deepEqual((tracks[0] as { oql?: OqlSpec[] }).oql, parseOql("KRAS: AMP MUT=G12D")[0].specs);
  assert.equal(tracks[1].label, "TP53");
  assert.deepEqual(tracks[1].members, ["TP53"]);
  assert.equal((tracks[1] as { oql?: OqlSpec[] }).oql, undefined);
  assert.deepEqual(symbols, ["KRAS", "TP53"]);
  // case, and a bare "TP53:" (lib/query-options.ts isBare) is a bare row
  const lower = normalizeGeneTracks(["kras: amp", "TP53:"]).tracks;
  assert.equal(lower[0].label, "KRAS");
  assert.deepEqual((lower[0] as { oql?: OqlSpec[] }).oql, specs("AMP"));
  assert.equal(lower[1].label, "TP53");
  assert.equal((lower[1] as { oql?: OqlSpec[] }).oql, undefined);
});

test("O23: geneSymbols reads the gene of an entry with OQL where the caller draws OQL, and refuses it elsewhere", () => {
  assert.deepEqual(geneSymbols(["KRAS: AMP"], { oql: true }), ["KRAS"]);
  assert.deepEqual(geneSymbols(["KRAS: AMP MUT=G12D", "kras", { genes: ["NRAS", "KRAS"] }], { oql: true }), ["KRAS", "NRAS"]);
  assert.throws(() => geneSymbols(["KRAS: AMP"]), /only the oncoprint draws/);
  assert.deepEqual(geneSymbols(["KRAS:", "TP53"]), ["KRAS", "TP53"], "a bare 'KRAS:' is no OQL");
});

test("O23: re-normalizing a list's canonical form keeps each row's OQL (lib/oncoprint.ts normalizeSpec hands toGeneList's output to the assembler)", () => {
  const { tracks } = normalizeGeneTracks(["KRAS: AMP MUT=G12D", "TP53", { label: "RAS", genes: ["NRAS", "HRAS"] }]);
  assert.deepEqual(tracks.map((t) => t.label), ["KRAS", "TP53", "RAS"]);
  const again = normalizeGeneTracks(toGeneList(tracks)).tracks;
  assert.deepEqual(again, tracks);
});

test("O29: a row's EXP or PROT is drawn (PR 4; test/oncoprint-oql-exp.test.ts)", () => {
  assert.equal(normalizeGeneTracks(["KRAS: AMP EXP>2", "TP53"]).tracks[0].key, "KRAS: AMP EXP>2");
});

test("O30: OQL inside a merged row is refused", () => {
  assert.throws(() => normalizeGeneTracks([{ genes: ["KRAS: AMP", "NRAS"] }]));
  assert.throws(() => normalizeGeneTracks([{ label: "RAS", genes: ["NRAS", "KRAS: MUT"] }]));
  assert.throws(() => parseGeneList("[KRAS: AMP NRAS]"), "the text form too, as today");
});

test("O31: two rows of one gene are drawn as two rows (PR 2; test/oncoprint-oql-rows.test.ts)", () => {
  assert.deepEqual(normalizeGeneTracks(["KRAS: AMP", "KRAS: MUT"]).tracks.map((t) => t.key), ["KRAS: AMP", "KRAS: MUT"]);
  assert.deepEqual(normalizeGeneTracks(["KRAS: AMP", "KRAS"]).tracks.map((t) => t.label), ["KRAS", "KRAS"]);
});

test("O32: unsupported OQL in a row is the parser's own error", () => {
  assert.throws(() => normalizeGeneTracks(["KRAS: GAIN"]), /GAIN is not supported/);
  assert.throws(() => normalizeGeneTracks(["KRAS: HETLOSS"]), /HETLOSS is not supported/);
  assert.throws(() => normalizeGeneTracks(["KRAS: GERMLINE"]), /GERMLINE is not supported/);
  assert.throws(() => normalizeGeneTracks(["KRAS: FOO("]), /unrecognized token/);
});

test("O36: the gene-list text — a line's OQL runs to the next ';' or newline, plain symbols split on spaces and commas", () => {
  assert.deepEqual(parseGeneList("KRAS: AMP MUT=G12D; TP53"), ["KRAS: AMP MUT=G12D", "TP53"]);
  assert.deepEqual(parseGeneList("KRAS: AMP MUT=G12D ; TP53"), ["KRAS: AMP MUT=G12D", "TP53"], "trimmed");
  assert.deepEqual(parseGeneList("KRAS: AMP\nTP53 NRAS"), ["KRAS: AMP", "TP53", "NRAS"]);
  assert.deepEqual(parseGeneList("TP53, NRAS KRAS: MUT_DRIVER;BRAF"), ["TP53", "NRAS", "KRAS: MUT_DRIVER", "BRAF"]);
  assert.deepEqual(parseGeneList('KRAS: AMP; ["RAS" NRAS HRAS] TP53'), ["KRAS: AMP", { label: "RAS", genes: ["NRAS", "HRAS"] }, "TP53"]);
  assert.deepEqual(parseGeneList("TP53 KRAS"), ["TP53", "KRAS"], "unchanged without OQL");
});

test("O36: formatGeneList round-trips a list with OQL", () => {
  for (const list of [["KRAS: AMP MUT=G12D", "TP53"], ["TP53", "KRAS: MUT_(10-15*)", "NRAS"], ["KRAS: AMP", { label: "RAS", genes: ["NRAS", "HRAS"] }, "BRAF: MUT=V600E"]])
    assert.deepEqual(parseGeneList(formatGeneList(list)), list, JSON.stringify(list) + " -> " + formatGeneList(list));
});

// ---------------------------------------------------------------------------------------------
// assembleContract: the row draws its line's events
// ---------------------------------------------------------------------------------------------

type DEv = Ev & { driver?: boolean };
const e = (pid: string, gene: string, vt: string, o: Partial<DEv> = {}): DEv => ({ pid, gene, vt, ...o });
// P1-P5 are profiled for KRAS and TP53; P6 for TP53 only, so its KRAS amplification is off-panel
const fixture = (genes: AssembleInput["genes"], over: Partial<AssembleInput> = {}): AssembleInput => ({
  genes,
  groups: [{ name: "all", pids: ["P1", "P2", "P3", "P4", "P5", "P6"] }],
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
/** a row's cells by column id, and its counts */
function row(c: Contract, label: string) {
  const t = c.tracks.find((x) => x.kind === "gene" && x.label === label);
  assert.ok(t, "no gene row labelled " + label + " (rows: " + c.tracks.map((x) => x.label).join(", ") + ")");
  const cell = (pid: string) => t.cells[c.columns.indexOf(pid)];
  return { t, cell, by: Object.fromEntries(["P1", "P2", "P3", "P4", "P5", "P6"].map((p) => [p, cell(p)])) };
}
const MIS_D = BITS.MISSENSE | BITS.DRIVER | BITS.MUT_DRIVER;
const AMP_D = BITS.AMP | BITS.DRIVER | BITS.CNA_DRIVER;
const DEL_D = BITS.HOMDEL | BITS.DRIVER | BITS.CNA_DRIVER;
const SV_D = BITS.SV | BITS.DRIVER | BITS.SV_DRIVER;

test("O1: a row with no OQL draws every alteration, as before, and has no sublabel", () => {
  const c = assembleContract(fixture(["KRAS", "TP53"]));
  const { t, by } = row(c, "KRAS");
  assert.deepEqual(by, { P1: MIS_D, P2: BITS.AMP, P3: DEL_D, P4: AMP_D | BITS.MISSENSE, P5: SV_D, P6: NOT_PROFILED });
  assert.equal(t.altered, 5); assert.equal(t.profiled, 5);
  assert.equal((t as { sublabel?: string }).sublabel, undefined);
});

test("O2/O22/O23/O24: KRAS: AMP draws amplifications only; its % keeps the gene's denominator; label KRAS, sublabel ': AMP' (OU 878-924, 191-210)", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "TP53"]));
  const { t, by } = row(c, "KRAS");
  assert.deepEqual(by, { P1: 0, P2: BITS.AMP, P3: 0, P4: AMP_D, P5: 0, P6: NOT_PROFILED },
    "P1's mutation, P3's deep deletion and P5's SV are not drawn; P4's VUS G13D is not drawn beside its amplification; P6 stays not profiled");
  assert.equal(t.altered, 2);
  assert.equal(t.profiled, 5, "profiled for the gene, whatever the line wants: P1, P3, P5 are profiled-unaltered");
  assert.equal(t.freqPct, 40);
  assert.equal((t as { sublabel?: string }).sublabel, ": AMP");
  const tp53 = row(c, "TP53");
  assert.equal(tp53.by.P1, BITS.TRUNCATING | BITS.DRIVER | BITS.MUT_DRIVER, "another row is untouched");
  assert.equal((tp53.t as { sublabel?: string }).sublabel, undefined, "a row with no OQL has no sublabel");
});

test("O3/O4/O8/O9/O11/O15: each line draws what eventWanted wants", () => {
  const cases: [string, Record<string, number>, number][] = [
    ["KRAS: HOMDEL", { P1: 0, P2: 0, P3: DEL_D, P4: 0, P5: 0 }, 1],
    ["KRAS: MUT", { P1: MIS_D, P2: 0, P3: 0, P4: BITS.MISSENSE, P5: 0 }, 2],
    ["KRAS: FUSION", { P1: 0, P2: 0, P3: 0, P4: 0, P5: SV_D }, 1],
    ["KRAS: AMP MUT=G12D", { P1: MIS_D, P2: BITS.AMP, P3: 0, P4: AMP_D, P5: 0 }, 3],
    ["KRAS: DRIVER", { P1: MIS_D, P2: 0, P3: DEL_D, P4: AMP_D, P5: SV_D }, 4],
    ["KRAS: MUT_(12-12*)", { P1: MIS_D, P2: 0, P3: 0, P4: 0, P5: 0 }, 1],
    ["KRAS: g13d", { P1: 0, P2: 0, P3: 0, P4: BITS.MISSENSE, P5: 0 }, 1],
  ];
  for (const [line, cells, altered] of cases) {
    const { t, by } = row(assembleContract(fixture([line, "TP53"])), "KRAS");
    assert.deepEqual({ ...by, P6: undefined }, { ...cells, P6: undefined }, line);
    assert.equal(by.P6, NOT_PROFILED, line);
    assert.equal(t.altered, altered, line + " altered");
    assert.equal(t.profiled, 5, line + " profiled");
  }
});

test("O1 (OF isDatumWantedByOQLLine per line): a gene in a merged row and in an OQL row — each row applies its own line", () => {
  const c = assembleContract(fixture([{ label: "RAS", genes: ["KRAS", "NRAS"] }, "KRAS: AMP"]));
  const merged = row(c, "RAS"), kras = row(c, "KRAS");
  assert.equal(merged.by.P1, MIS_D, "the merged row draws every KRAS alteration");
  assert.equal(merged.by.P5, SV_D);
  assert.equal(kras.by.P1, 0, "the OQL row draws only amplifications");
  assert.equal(kras.by.P2, BITS.AMP);
  assert.equal((merged.t as { sublabel?: string }).sublabel, undefined, "O25: a merged row has no sublabel (OU 194-195)");
});

test("O13: DRIVER follows the page's driver settings (AC is_driver 256-266 = putativeDriver)", () => {
  // P1's G12D is a hotspot only; P4's G13D is OncoKB-annotated only
  const flags: Record<string, { oncokb: boolean; hot: boolean }> = { G12D: { oncokb: false, hot: true }, G13D: { oncokb: true, hot: false } };
  const withSettings = (d: DriverSettings) => {
    const s = resolveDrivers(d);
    return (r: EventRow) => r.vt === "mutation" && !!r.mv && isDriverEvent(r, s, () => flags[r.mv!].oncokb, () => flags[r.mv!].hot);
  };
  const muts = fixture(["KRAS: MUT_DRIVER"]).events.filter((x) => x.vt === "mutation" && x.gene === "KRAS");
  const hotOnly = row(assembleContract(fixture(["KRAS: MUT_DRIVER"], { events: muts, isDriver: withSettings({ oncokb: false, hotspots: true }) })), "KRAS");
  assert.equal(hotOnly.by.P1, MIS_D, "with OncoKB off and hotspots on, the hotspot is a driver");
  assert.equal(hotOnly.by.P4, 0, "and the OncoKB-only one is not");
  const oncokbOnly = row(assembleContract(fixture(["KRAS: MUT_DRIVER"], { events: muts, isDriver: withSettings({ oncokb: true, hotspots: false }) })), "KRAS");
  assert.equal(oncokbOnly.by.P1, 0);
  assert.equal(oncokbOnly.by.P4, MIS_D);
  const none = row(assembleContract(fixture(["KRAS: DRIVER"], { events: muts, isDriver: withSettings({ oncokb: false, hotspots: false, custom: false, tiers: [] }) })), "KRAS");
  assert.equal(none.t.altered, 0, "with every source off nothing is a driver, so DRIVER wants nothing");
  assert.equal(none.t.profiled, 5);
});

test("O20: a germline mutation is drawn under MUT, and the hide-germline setting still drops it", () => {
  const germ = fixture(["KRAS: MUT"], { events: [e("P2", "KRAS", "mutation", { mt: "Missense_Mutation", mv: "G12C", germ: true })] });
  assert.equal(row(assembleContract(germ), "KRAS").by.P2, BITS.MISSENSE | BITS.GERMLINE);
  const hidden = assembleContract({ ...germ, display: normalizeDisplay({}, { hideGermline: true }) });
  assert.equal(row(hidden, "KRAS").by.P2, 0);
  assert.equal(row(hidden, "KRAS").t.altered, 0);
});

test("O21: hide VUS with KRAS: MUT drops the VUS mutation, as before", () => {
  const c = assembleContract(fixture(["KRAS: MUT", "TP53"], { display: normalizeDisplay({}, { hideVus: true }) }));
  const { t, by } = row(c, "KRAS");
  assert.equal(by.P1, MIS_D);
  assert.equal(by.P4, 0, "the VUS G13D is hidden, and the amplification is not this line's");
  assert.equal(t.altered, 1);
  assert.equal(t.profiled, 5);
});

test("O22: an off-panel call stays out of an OQL row as it does a bare one", () => {
  const c = assembleContract(fixture(["KRAS: AMP"]));
  assert.equal(row(c, "KRAS").by.P6, NOT_PROFILED, "P6's driver amplification is off-panel");
});

test("O27: display.showOql is on by default, and off is kept", () => {
  assert.equal(normalizeDisplay(undefined).showOql, true);
  assert.equal(normalizeDisplay({}).showOql, true);
  assert.equal(normalizeDisplay({ showOql: false } as never).showOql, false);
  assert.equal(normalizeDisplay({ showOql: true } as never).showOql, true);
  assert.throws(() => normalizeDisplay({ showOql: "no" } as never), /showOql/);
});

test("O33: a spec's gene list with OQL keeps each row's line through normalizeSpec", () => {
  const n = normalizeSpec({ genes: ["KRAS: AMP MUT=G12D", "TP53"] } as never);
  assert.deepEqual(n.genes, ["KRAS", "TP53"]);
  const tracks = normalizeGeneTracks(n.geneList).tracks;
  assert.deepEqual((tracks[0] as { oql?: OqlSpec[] }).oql, specs("AMP MUT=G12D"));
  assert.equal(n.display.showOql, true);
});

// ---------------------------------------------------------------------------------------------
// ONC-VI-6: Show OQL filters always offered, on by default only with OQL; a row without OQL
// shows the query's default line (ResultsViewOncoprint 528; ResultsViewPageStore 333-363, 2510-2527;
// oqlfilter unparseOQLQueryLine; OncoprintUtils formatGeneticTrackSublabel)
// ---------------------------------------------------------------------------------------------

test("VI-6: the default line follows buildDefaultOQLProfile, type by type in profile order", () => {
  const p = (...types: string[]) => types.map((type) => ({ type }));
  // coadread: gistic, mutations, structural_variants in the study's profile order
  assert.equal(defaultOqlSublabel(p("COPY_NUMBER_ALTERATION", "MUTATION_EXTENDED", "STRUCTURAL_VARIANT")), ": AMP HOMDEL MUT FUSION");
  assert.equal(defaultOqlSublabel(p("MUTATION_EXTENDED", "MRNA_EXPRESSION", "PROTEIN_LEVEL")), ": MUT EXP>=2 EXP<=-2 PROT>=2 PROT<=-2");
  assert.equal(defaultOqlSublabel(p("MRNA_EXPRESSION"), 1.5), ": EXP>=1.5 EXP<=-1.5", "the z-score threshold as written");
  assert.equal(defaultOqlSublabel(p("MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "MUTATION_EXTENDED")), ": MUT AMP HOMDEL", "each command once (default_oql_uniq)");
  assert.equal(defaultOqlSublabel(p("GENERIC_ASSAY")), "", "no command for other types");
  assert.equal(defaultOqlSublabel([]), "");
});

test("VI-6: the default line's profiles: each study's by id, mRNA / protein only as the query reads them", async () => {
  // as the warehouse lists them, not in id order
  const coadread = new Map([["structural_variants", "STRUCTURAL_VARIANT SV"], ["mutations", "MUTATION_EXTENDED MAF"],
    ["armlevel_cna", "GENERIC_ASSAY LIMIT-VALUE"], ["log2CNA", "COPY_NUMBER_ALTERATION LOG2-VALUE"],
    ["rppa_Zscores", "PROTEIN_LEVEL Z-SCORE"], ["gistic", "COPY_NUMBER_ALTERATION DISCRETE"],
    ["rna_seq_v2_mrna_median_Zscores", "MRNA_EXPRESSION Z-SCORE"]]);
  const none = { has: () => false };
  const types = async (spec: { exp?: string; prot?: string }) =>
    (await defaultOqlProfiles(["s"], none, [], spec, async () => coadread)).map((x) => x.id);
  assert.deepEqual(await types({}), ["gistic", "mutations", "structural_variants"]);
  assert.equal(defaultOqlSublabel(await defaultOqlProfiles(["s"], none, [], {}, async () => coadread)), ": AMP HOMDEL MUT FUSION");
  assert.deepEqual(await types({ exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" }),
    ["gistic", "mutations", "rna_seq_v2_mrna_median_Zscores", "rppa_Zscores", "structural_variants"]);
  // a peer's study: the types its columns were profiled for, mRNA only when the query reads it
  const peer = { has: (s: string) => s === "p" };
  const masks = [{ mask: 0b01001 }, { mask: 0b00010 }];   // mutations + mRNA, copy number
  const both = await defaultOqlProfiles(["s", "p"], peer, masks, {}, async () => new Map([["mutations", "MUTATION_EXTENDED MAF"]]));
  assert.deepEqual(both.map((x) => x.type), ["MUTATION_EXTENDED", "MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION"]);
  assert.equal(defaultOqlSublabel(both), ": MUT AMP HOMDEL");
});

test("VI-6: a single-gene row without OQL carries the default line; a row's own line and a merged row do not", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "TP53", { label: "both", genes: ["KRAS", "TP53"] }], { defaultOql: ": AMP HOMDEL MUT FUSION" }));
  const by = (l: string) => c.tracks.find((t) => t.kind === "gene" && t.label === l)!;
  assert.equal(by("KRAS").sublabel, ": AMP"); assert.equal(by("KRAS").defaultSublabel, undefined);
  assert.equal(by("TP53").sublabel, undefined); assert.equal(by("TP53").defaultSublabel, ": AMP HOMDEL MUT FUSION");
  assert.equal(by("both").defaultSublabel, undefined, "no sublabel for merged tracks");
  assert.equal(trackSublabelText(by("TP53"), { showOql: true }), ": AMP HOMDEL MU...", "cut at 18 characters as any sublabel");
  assert.equal(trackSublabelText(by("TP53"), { showOql: false }), "");
});

test("VI-6: Show OQL filters is on by default only for a query with OQL; a set value is kept", () => {
  assert.equal(normalizeSpec({ genes: ["KRAS", "TP53"] } as never).display.showOql, false);
  assert.equal(normalizeSpec({ genes: ["KRAS: MUT", "TP53"] } as never).display.showOql, true);
  assert.equal(normalizeSpec({ genes: ["KRAS", "TP53"], display: { showOql: true } } as never).display.showOql, true);
  assert.equal(normalizeSpec({ genes: ["KRAS: MUT"], display: { showOql: false } } as never).display.showOql, false);
});

// ---------------------------------------------------------------------------------------------
// renderers: the sublabel, after the label, grey, cut at 18 characters
// ---------------------------------------------------------------------------------------------

test("O26: the style's sublabel colour is the portal's rgb(166,166,166) (OLV 347)", () => {
  assert.equal((STYLE.palette as Record<string, unknown>).sublabel, "#a6a6a6");
});

const subText = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*fill="#a6a6a6"[^>]*>([^<]*)<\/text>/gi)].map((m) => m[1]);

test("O26: the server SVG draws a row's sublabel as its own grey <text>, after its label (OLV 343-356)", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "TP53"]));
  const svg = contractToSvg(c, 800);
  assert.deepEqual(subText(svg), [": AMP"], "one sublabel, the OQL row's");
  const label = svg.search(/<text\b[^>]*>(<title>[^<]*<\/title>)?KRAS<\/text>/);
  assert.ok(label >= 0, "the row's label is still its own <text> reading KRAS");
  assert.ok(svg.indexOf(": AMP</text>") > label, "the sublabel follows the label");
  const el = /<text\b[^>]*fill="#a6a6a6"[^>]*>: AMP<\/text>/i.exec(svg)?.[0] ?? "";
  const x = Number(/\bx="([\d.]+)"/.exec(el)?.[1]);
  assert.ok(x > 4, "drawn to the right of where the label starts, x=" + x);
  assert.deepEqual(subText(contractToSvg(assembleContract(fixture(["KRAS", "TP53"])), 800)), [], "no OQL, no sublabel");
});

test("O26: a sublabel past 18 characters is cut like a portal label: 15 and '...' (OLV 259-268, getMaximumLabelLength 508-510)", () => {
  assert.equal(trackSublabelText({ sublabel: ": AMP MUT=G12D MUT=G13D" }), ": AMP MUT=G12D ...");
  assert.equal(trackSublabelText({ sublabel: ": MUT=TRUNC_(1-99)" }), ": MUT=TRUNC_(1-99)", "18 characters is not cut");
});

test("O26 (ours): the gutter is fixed, so the SVG cuts a sublabel further to the room before the row's %, and the tooltip carries the whole line", () => {
  // the portal widens its label column to fit the sublabel; ours keeps the gutter and ends the cut in "..."
  const c = assembleContract(fixture(["KRAS: AMP MUT=G12D MUT=G13D"]));
  const [sub] = subText(contractToSvg(c, 800));
  assert.ok(sub && sub.endsWith("...") && ": AMP MUT=G12D MUT=G13D".startsWith(sub.slice(0, -3).trimEnd()), JSON.stringify(sub));
  const roomy = fitSublabel(": AMP MUT=G12D ...", 1000, (s) => s.length * 6);
  assert.equal(roomy, ": AMP MUT=G12D ...", "a sublabel that fits is not cut again");
  assert.equal(fitSublabel(": AMP MUT=G12D", 10, (s) => s.length * 6), "", "no room even for '...': nothing");
  assert.match(contractToSvg(c, 800), /<title>KRAS: AMP MUT=G12D MUT=G13D\n/);
});

test("O27: display.showOql false draws no sublabel in the SVG (RVO 528; OLV 343)", () => {
  const c = assembleContract(fixture(["KRAS: AMP", "TP53"]));
  const off = contractToSvg({ ...c, display: { ...c.display, showOql: false } as ResolvedDisplay }, 800);
  assert.deepEqual(subText(off), []);
  assert.ok(!off.includes(": AMP</text>"), "no drawn sublabel");
  // the row's tooltip keeps its line either way, as the portal's track description (DeltaUtils 1165: description = the track's oql)
  assert.match(off, /<title>KRAS: AMP\n/);
  const viaInput = contractToSvg(assembleContract(fixture(["KRAS: AMP"], { display: normalizeDisplay({ showOql: false } as never) })), 800);
  assert.deepEqual(subText(viaInput), [], "set through the view's display");
});

function textRecorder() {
  const texts: { text: string; x: number; fill: string; font: string }[] = [];
  const state: Record<string | symbol, unknown> = { fillStyle: "", font: "" };
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "fillStyle" || k === "font" || k === "textAlign") return state[k];
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "measureText") return (s: string) => ({ width: s.length * 6 });
      if (k === "fillText") return (text: string, x: number) => texts.push({ text, x, fill: String(state.fillStyle).toLowerCase(), font: String(state.font) });
      return () => {};
    },
    set(_t, k, v) { state[k] = v; return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}
function drawn(c: Contract) {
  const buf = packContract(c);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: data.n, patients: data.n }];
  const { ctx, texts } = textRecorder();
  draw(ctx, data, Uint32Array.from({ length: data.n }, (_, i) => i), groups, { zoom: 10, scrollX: 0, whitespace: true }, 900);
  return texts;
}

test("O26: the canvas figure draws the sublabel after the label, grey and not bold (OLV 343-356)", () => {
  const texts = drawn(assembleContract(fixture(["KRAS: AMP", "TP53"])));
  const sub = texts.filter((t) => t.text === ": AMP");
  assert.equal(sub.length, 1, "drew ': AMP' once; drew: " + JSON.stringify(texts.map((t) => t.text)));
  assert.equal(sub[0].fill, "#a6a6a6");
  assert.ok(!/bold/.test(sub[0].font));
  const label = texts.find((t) => t.text === "KRAS")!;
  assert.ok(sub[0].x > label.x, "after the label");
});

test("O27: the canvas draws no sublabel when display.showOql is false", () => {
  const texts = drawn(assembleContract(fixture(["KRAS: AMP"], { display: normalizeDisplay({ showOql: false } as never) })));
  assert.ok(!texts.some((t) => t.text.startsWith(": ")), JSON.stringify(texts.map((t) => t.text)));
});

// ---------------------------------------------------------------------------------------------
// the Results page: the Oncoprint tab draws the query's lines
// ---------------------------------------------------------------------------------------------

const rq = (entries: string[]) => ({ studies: ["a"], filters: [], entries, genes: [...new Set(entries.map((x) => x.split(":")[0].trim().toUpperCase()))] });
const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
  held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
const viewOf = (entries: string[], kind: string) =>
  resultsLayout(rq(entries), rdata).doc.views!.find((v) => (v as { kind: string }).kind === kind) as unknown as { genes: unknown[] };

test("O33: the Oncoprint tab's rows are the query's entries where they carry OQL, the bare gene otherwise", () => {
  assert.deepEqual(viewOf(["KRAS: AMP MUT=G12D", "TP53"], "oncoprint").genes, ["KRAS: AMP MUT=G12D", "TP53"]);
  assert.deepEqual(viewOf(["KRAS: MUT FUSION", "TP53:"], "oncoprint").genes, ["KRAS: MUT FUSION", "TP53"], "a profile-resolved line is drawn as such; 'TP53:' is bare");
  assert.deepEqual(viewOf(["KRAS", "TP53"], "oncoprint").genes, ["KRAS", "TP53"], "no OQL: unchanged");
});

test("O33/O35: the tabs that still draw every alteration keep the bare genes", () => {
  assert.deepEqual(viewOf(["KRAS: AMP MUT=G12D", "TP53"], "cancertypes").genes, ["KRAS", "TP53"]);
});
