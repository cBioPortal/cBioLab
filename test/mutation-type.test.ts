// The mutation table's cell rules (lib/mutation-type.ts): the portal's Mutation Type label, colour and
// tooltip (cbioportal-frontend e9d70fb getCanonicalMutationType.ts 69-166, MutationTypeColumnFormatter.tsx
// 22-184, mutationType.module.scss), Variant Type's colour and tooltip (VariantTypeColumnFormatter.tsx
// 20-149, variantType.module.scss), Copy # (DiscreteCNAColumnFormatter.tsx 159-271), Validation Status
// (ValidationStatusColumnFormatter.tsx 13-91, validationStatus.module.scss) and the Exon cell
// (ExonColumnFormatter.tsx 46-92, Results View's showTotalNumberOfExons = false). Case ids are PR G's
// spec table's (T*, VT*, CN*, VS*, EX*). The SQL that mirrors these is run against the fixture study
// by scripts/check-mutation-columns.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mutationTypeLabel, mutationTypeColor, mutationTypeTip, variantTypeColor, variantTypeTip,
  copyNumberLabel, copyNumberColor, copyNumberTip, validationStatusCell, exonCell
} from "../lib/mutation-type.ts";

/** a CSS colour as one spelling: named colours as hex, lower case */
const NAMED: Record<string, string> = { red: "#ff0000", blue: "#0000ff", black: "#000000" };
const hex = (c: string | null | undefined) => { const s = String(c ?? "").trim().toLowerCase(); return NAMED[s] || s; };

const GREEN = "#008000", BLACK = "#000000", SPLICE = "#e5802b", BROWN = "#8b4513", PURPLE = "#8b00c9", PINK = "#cf58bc";

/** [case id, raw values, label, colour] */
const LABELS: [string, string[], string, string][] = [
  ["T1", ["Missense_Mutation", "missense", "missense_variant"], "Missense", GREEN],
  ["T2", ["Nonsense_Mutation", "nonsense", "stopgain_SNV", "stop_gained"], "Nonsense", BLACK],
  ["T3", ["Frame_Shift_Del", "frameshift_deletion"], "FS del", BLACK],
  ["T4", ["Frame_Shift_Ins", "frameshift_insertion"], "FS ins", BLACK],
  ["T5", ["frameshift", "frameshift_variant", "De_novo_Start_OutOfFrame", "DE_NOVO_START_OUTOFFRAME", "FrameShift"], "FS", BLACK],
  ["T6", ["Splice_Site", "Splice_Region", "splice", "splice site", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel", "splice_region_variant"], "Splice", SPLICE],
  ["T7", ["Translation_Start_Site", "initiator_codon_variant", "START_CODON_SNP", "Start_Codon_SNP", "start_codon_del"], "Nonstart", BLACK],
  ["T8", ["Nonstop_Mutation", "stop_lost"], "Nonstop", BLACK],
  ["T9", ["In_Frame_Del", "inframe_del", "inframe_deletion", "in_frame_deletion", "indel"], "IF del", BROWN],
  ["T10", ["In_Frame_Ins", "inframe_ins", "inframe_insertion", "in_frame_insertion"], "IF ins", BROWN],
  ["T11", ["nonframeshift_deletion", "nonframeshift", "nonframeshift insertion", "nonframeshift_insertion", "inframe"], "IF", BROWN],
  ["T12", ["truncating", "feature_truncation"], "Truncating", BLACK],
  ["T13", ["fusion", "Fusion"], "Fusion", PURPLE],
  ["T14", ["Silent", "synonymous_variant"], "Silent", PINK],
];

for (const [id, raws, label, color] of LABELS) {
  test(`${id} ${raws.join(", ")} → ${label} in ${color}`, () => {
    for (const raw of raws) {
      assert.equal(mutationTypeLabel(raw), label, raw);
      assert.equal(hex(mutationTypeColor(raw)), color, raw + " colour");
    }
  });
}

test("T15 canonical 'other' has no label: the raw text as stored, in the other colour", () => {
  for (const raw of ["Targeted_Region", "any", "other", "ANY", "Other"]) {
    assert.equal(mutationTypeLabel(raw), raw);
    assert.equal(hex(mutationTypeColor(raw)), PINK, raw);
  }
});

test("T16 a type not in the map at all: the raw text, case kept, in the other colour", () => {
  for (const raw of ["5'Flank", "3'Flank", "3'UTR", "5'UTR", "Intron", "lincRNA", "SNV", "NA", "Unknown", "Frame_Shift", "In_Frame__Del",
    "DE_NOVO_START_OUT_FRAME", "De_novo_Start_InFrame", "Start_Codon_Ins", "FRAMESHIFT_CODING", "nonsynonymous_SNV", "COULD_NOT_DETERMINE",
    "Stop_Codon_Del", "deletion"]) {
    assert.equal(mutationTypeLabel(raw), raw);
    assert.equal(hex(mutationTypeColor(raw)), PINK, raw);
  }
});

test("T17 the lookup is case-insensitive; unmapped text keeps its case", () => {
  assert.equal(mutationTypeLabel("MISSENSE_MUTATION"), "Missense");
  assert.equal(mutationTypeLabel("nonsense_mutation"), "Nonsense");
  assert.equal(mutationTypeLabel("SPLICE_REGION"), "Splice");
  assert.equal(mutationTypeLabel("IN_FRAME_DEL"), "IF del");
  assert.equal(mutationTypeLabel("FUSION"), "Fusion");
  assert.equal(mutationTypeLabel("FRAMESHIFT_CODING"), "FRAMESHIFT_CODING");
  assert.equal(mutationTypeLabel("frameshift_coding"), "frameshift_coding");
});

test("T18 no type (null or empty): an empty label and no tooltip", () => {
  for (const raw of [null, ""]) {
    assert.equal(mutationTypeLabel(raw), "", String(raw));
    assert.ok(!mutationTypeTip(raw), String(raw) + " tooltip");
  }
});

test("T19 the cell's tooltip is the raw value only where it differs from the label (case-insensitively)", () => {
  assert.equal(mutationTypeTip("Missense_Mutation"), "Missense_Mutation");
  assert.equal(mutationTypeTip("In_Frame_Del"), "In_Frame_Del");
  assert.equal(mutationTypeTip("Splice_Region"), "Splice_Region");
  assert.equal(mutationTypeTip("frameshift_variant"), "frameshift_variant");
  assert.equal(mutationTypeTip("stop_gained"), "stop_gained");
  for (const raw of ["Silent", "nonsense", "fusion", "Fusion", "Targeted_Region", "MISSENSE", "splice", "3'UTR", "truncating"]) {
    assert.ok(!mutationTypeTip(raw), raw + " has no tooltip");
  }
});

// ---- Variant Type -------------------------------------------------------------------------

test("VT2 Variant Type colours: SNP/DNP/TNP/ONP green, INS brown, DEL purple, anything else black (case-insensitive)", () => {
  for (const v of ["SNP", "DNP", "TNP", "ONP", "snp", "Dnp"]) assert.equal(hex(variantTypeColor(v)), GREEN, v);
  for (const v of ["INS", "ins"]) assert.equal(hex(variantTypeColor(v)), BROWN, v);
  for (const v of ["DEL", "del"]) assert.equal(hex(variantTypeColor(v)), PURPLE, v);
  for (const v of ["CONSOLIDATED", "OTHER", "FUSION", "NA", "DELETION", ""]) assert.equal(hex(variantTypeColor(v)), BLACK, v);
});

test("VT3 Variant Type tooltips for the six known types, none otherwise", () => {
  const tips: Record<string, string> = {
    SNP: "Single Nucleotide Polymorphism", DNP: "Di-Nucleotide Polymorphism", TNP: "Tri-Nucleotide Polymorphism",
    ONP: "Oligo-Nucleotide Polymorphism", INS: "Insertion", DEL: "Deletion"
  };
  for (const [v, tip] of Object.entries(tips)) {
    assert.equal(variantTypeTip(v), tip, v);
    assert.equal(variantTypeTip(v.toLowerCase()), tip, v.toLowerCase());
  }
  for (const v of ["CONSOLIDATED", "OTHER", "FUSION", "NA", ""]) assert.ok(!variantTypeTip(v), v + " has no tooltip");
});

// ---- Copy # -------------------------------------------------------------------------------

/** [case id, value, label, colour, tooltip] */
const CNA: [string, number, string, string, string][] = [
  ["CN3", 2, "Amp", "#ff0000", "High-level amplification"],
  ["CN4", 1, "Gain", "#ff0000", "Low-level gain"],
  ["CN5", 0, "Diploid", "#000000", "Diploid / normal"],
  ["CN6", -1, "ShallowDel", "#0000ff", "Shallow deletion"],
  ["CN7", -2, "DeepDel", "#0000ff", "Deep deletion"],
];
for (const [id, n, label, color, tip] of CNA) {
  test(`${id} copy number ${n} → ${label}, ${color}, tooltip "${tip}"`, () => {
    assert.equal(copyNumberLabel(n), label);
    assert.equal(hex(copyNumberColor(n)), color);
    assert.equal(copyNumberTip(n), tip);
  });
}

test("CN8 any other number falls to the final else: drawn as DeepDel in blue, with no tooltip text", () => {
  for (const n of [3, -3, 7]) {
    assert.equal(copyNumberLabel(n), "DeepDel", String(n));
    assert.equal(hex(copyNumberColor(n)), "#0000ff", String(n));
    assert.ok(!copyNumberTip(n), n + " has no tooltip");
  }
});

test("CN9 CN10 no call (not profiled, gene absent, -1.5 not served): empty text, tooltip 'CNA data is not available for this gene.'", () => {
  assert.equal(copyNumberLabel(null), "");
  assert.equal(copyNumberTip(null), "CNA data is not available for this gene.");
});

// ---- Validation Status --------------------------------------------------------------------

/** the cell's style however it is given: a class name, a colour, a background */
const styleOf = (c: Record<string, unknown>) =>
  [c.className, c.class, c.color, c.colour, c.background, c.style && JSON.stringify(c.style)].filter(Boolean).map(String).join(" ").toLowerCase();

test("VS2 valid / validated (any case): V on #ccffcc, tooltip the raw value", () => {
  for (const raw of ["valid", "Valid", "VALID", "validated", "Validated"]) {
    const c = validationStatusCell(raw) as unknown as Record<string, unknown>;
    assert.equal(c.text, "V", raw);
    assert.equal(c.tip, raw, raw + " tooltip");
    assert.match(styleOf(c), /(^|\W)valid(\W|$)|#ccffcc/, raw + " style");
  }
});

test("VS3 wildtype: W, tooltip the raw value", () => {
  for (const raw of ["wildtype", "Wildtype"]) {
    const c = validationStatusCell(raw) as unknown as Record<string, unknown>;
    assert.equal(c.text, "W", raw);
    assert.equal(c.tip, raw, raw + " tooltip");
  }
});

test("VS4 unknown, not_tested, not tested, none, na, n/a (any case): U on #e0e0e0, tooltip the raw value", () => {
  for (const raw of ["unknown", "Unknown", "not_tested", "not tested", "none", "None", "na", "NA", "n/a", "N/A"]) {
    const c = validationStatusCell(raw) as unknown as Record<string, unknown>;
    assert.equal(c.text, "U", raw);
    assert.equal(c.tip, raw, raw + " tooltip");
    assert.match(styleOf(c), /unknown|#e0e0e0/, raw + " style");
  }
});

test("VS5 anything else: the raw text in grey, no tooltip", () => {
  for (const raw of [".", "Untested", "NaN", "---", "__UNKNOWN__,Valid,Valid", "not_done", "Inconclusive", "high", "invalid"]) {
    const c = validationStatusCell(raw) as unknown as Record<string, unknown>;
    assert.equal(c.text, raw, raw);
    assert.ok(!c.tip, raw + " has no tooltip");
    assert.match(styleOf(c), /other|#9d9d9d/, raw + " style");
  }
});

test("VS6 no status (null, empty: fusion rows): an empty cell, no tooltip", () => {
  for (const raw of [null, ""]) {
    const c = validationStatusCell(raw) as unknown as Record<string, unknown>;
    assert.equal(c.text, "", String(raw));
    assert.ok(!c.tip, String(raw) + " has no tooltip");
  }
});

// ---- Exon ---------------------------------------------------------------------------------

test("EX4 the Exon cell shows the number before '/' only", () => {
  assert.equal(exonCell("8/11"), "8");
  assert.equal(exonCell("12/27"), "12");
  assert.equal(exonCell("1/1"), "1");
  assert.equal(exonCell("8"), "8");
  assert.equal(exonCell(""), "");
});
