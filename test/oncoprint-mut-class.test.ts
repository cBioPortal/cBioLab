// The oncoprint's glyph class of a mutation (lib/oncoprint-assemble.ts mutClassBit), as the portal's
// (cbioportal-frontend cd8c6df src/shared/components/oncoprint/DataUtils.ts 102-122 getOncoprintMutationType,
// src/shared/lib/oql/AccessorsForOqlFilter.ts getSimplifiedMutationType):
//
// | ID  | rule                                                                                                   |
// |-----|--------------------------------------------------------------------------------------------------------|
// | MC1 | a protein change of "Promoter" (any case) is promoter, whatever the type                                |
// | MC2 | a listed missense, in-frame or splice type keeps its class                                               |
// | MC3 | every other listed type is truncating: nonsense, frameshift, nonstart (Translation_Start_Site), nonstop, |
// |     | and Fusion (getSimplifiedMutationType "fusion" falls to the default, "trunc")                          |
// | MC4 | an unlisted type is other: Silent, Intron, 5'Flank with a change other than Promoter, and near-misses     |
// |     | of a listed spelling ("frame_shift", "in_frame__del")                                                   |
// | MC5 | the type compared lower-case; no type is other                                                          |
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutClassBit } from "../lib/oncoprint-assemble.ts";
import { STYLE } from "../lib/oncoprint-style.ts";

const B = STYLE.bits;
const cases: [string, string | undefined, string | undefined, number][] = [
  ["MC1", "5'Flank", "Promoter", B.PROMOTER], ["MC1", "Missense_Mutation", "promoter", B.PROMOTER],
  ["MC2", "Missense_Mutation", "G12D", B.MISSENSE], ["MC2", "missense_variant", "G12D", B.MISSENSE],
  ["MC2", "In_Frame_Del", "E746_A750del", B.INFRAME], ["MC2", "indel", "x", B.INFRAME], ["MC2", "nonframeshift_deletion", "x", B.INFRAME],
  ["MC2", "Splice_Site", "X200_splice", B.SPLICE], ["MC2", "Splice_Region", "x", B.SPLICE], ["MC2", "splicing", "x", B.SPLICE],
  ["MC3", "Nonsense_Mutation", "Q37*", B.TRUNCATING], ["MC3", "stopgain_SNV", "x", B.TRUNCATING],
  ["MC3", "Frame_Shift_Del", "x", B.TRUNCATING], ["MC3", "Frame_Shift_Ins", "x", B.TRUNCATING], ["MC3", "frameshift", "x", B.TRUNCATING],
  ["MC3", "De_novo_Start_OutOfFrame", "x", B.TRUNCATING],
  ["MC3", "Translation_Start_Site", "M1?", B.TRUNCATING], ["MC3", "Start_Codon_SNP", "M1I", B.TRUNCATING],
  ["MC3", "Nonstop_Mutation", "*1210Wext*?", B.TRUNCATING], ["MC3", "Fusion", "EGFR-SEPT14", B.TRUNCATING],
  ["MC4", "Silent", "x", B.OTHER_MUT], ["MC4", "Intron", "x", B.OTHER_MUT], ["MC4", "5'Flank", "c.-124C>T", B.OTHER_MUT],
  ["MC4", "Targeted_Region", "x", B.OTHER_MUT], ["MC4", "frame_shift", "x", B.OTHER_MUT], ["MC4", "in_frame__del", "x", B.OTHER_MUT],
  ["MC5", "TRANSLATION_START_SITE", "x", B.TRUNCATING], ["MC5", undefined, undefined, B.OTHER_MUT], ["MC5", "", "G12D", B.OTHER_MUT],
];
for (const [id, mt, mv, want] of cases)
  test(id + ": " + JSON.stringify(mt) + " / " + JSON.stringify(mv), () => assert.equal(mutClassBit(mt, mv), want));
