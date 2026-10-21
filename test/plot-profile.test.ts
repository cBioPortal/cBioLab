// A profile axis: what the study's own description of a profile makes of it, how it is refused when
// the study lacks it or two studies disagree about it, and the SQL each reading runs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { profileUse, profileGroup, plottableProfiles, type ProfileInfo } from "../lib/profile-catalog.ts";
import { resolveProfileAxis } from "../lib/plot-profile.ts";
import { axisSelect, axisKind, axisLabel, validateAxis } from "../lib/plot.ts";

const P = (profile: string, type: string, datatype: string, name: string, extra: Partial<ProfileInfo> = {}): ProfileInfo =>
  ({ profile, type, datatype, name, order: 0, ...extra });
const BRCA: ProfileInfo[] = [
  P("mutations", "MUTATION_EXTENDED", "MAF", "Mutations"),
  P("structural_variants", "STRUCTURAL_VARIANT", "SV", "Structural variants"),
  P("gistic", "COPY_NUMBER_ALTERATION", "DISCRETE", "Putative copy-number alterations from GISTIC"),
  P("log2CNA", "COPY_NUMBER_ALTERATION", "LOG2-VALUE", "Log2 copy-number values"),
  P("rna_seq_v2_mrna", "MRNA_EXPRESSION", "CONTINUOUS", "mRNA Expression, RSEM"),
  P("rna_seq_v2_mrna_median_Zscores", "MRNA_EXPRESSION", "Z-SCORE", "mRNA expression z-scores relative to diploid samples"),
  P("methylation_hm450", "GENERIC_ASSAY", "LIMIT-VALUE", "Methylation (HM450)", { assayType: "METHYLATION" }),
  P("armlevel_cna", "GENERIC_ASSAY", "CATEGORICAL", "Putative arm-level copy-number from GISTIC", { assayType: "ARMLEVEL_CNA" }),
];
const one = [{ study: "brca", catalog: BRCA }];
const ctx = { study: "x", db: "db", unit: "sample" as const, cohortSql: "SELECT pid FROM p" };

describe("what a profile is, from the study's own description", () => {
  test("type and datatype decide; the name never does", () => {
    assert.deepEqual(BRCA.map((p) => profileUse(p)), ["mutation", "sv", "discrete", "number", "number", "number", "assayNumber", "assayCategory"]);
    assert.equal(profileUse(P("rna_seq_v2_mrna", "MRNA_EXPRESSION", "DISCRETE", "x")), null, "a discrete mRNA profile is nothing an axis reads");
    assert.equal(profileUse(P("cna", "COPY_NUMBER_ALTERATION", "DISCRETE", "named like anything")), "discrete");
  });
  test("grouped under cBioPortal's own type names, generic assays under their own kind, in the portal's order", () => {
    assert.deepEqual(BRCA.map(profileGroup), ["Mutation", "Structural variant", "Copy number", "Copy number", "mRNA", "mRNA", "DNA methylation", "Arm-level copy number"]);
    assert.equal(profileGroup({ type: "GENERIC_ASSAY", assayType: "SOMETHING_NEW" }), "Something new", "an unknown kind is shown as written");
    const shuffled = [...BRCA].reverse();
    assert.deepEqual(plottableProfiles(shuffled).map((p) => p.type).slice(0, 4), ["MUTATION_EXTENDED", "STRUCTURAL_VARIANT", "COPY_NUMBER_ALTERATION", "COPY_NUMBER_ALTERATION"]);
  });
});

describe("a profile axis resolved against the studies it is drawn over", () => {
  test("each reading resolves to the form that runs it", () => {
    assert.deepEqual(resolveProfileAxis({ source: "profile", profile: "mutations", gene: "tp53" }, "x", one), { source: "alteration", gene: "TP53", by: "mutationType" });
    assert.deepEqual(resolveProfileAxis({ source: "profile", profile: "mutations", gene: "TP53", by: "mutated" }, "x", one), { source: "alteration", gene: "TP53", by: "mutated" });
    assert.deepEqual(resolveProfileAxis({ source: "profile", profile: "structural_variants", gene: "ERBB2" }, "x", one), { source: "alteration", gene: "ERBB2", by: "sv" });
    assert.deepEqual(resolveProfileAxis({ source: "profile", profile: "gistic", gene: "ERBB2" }, "x", one),
      { source: "molecular", profileType: "gistic", gene: "ERBB2", discrete: true, label: "ERBB2: Putative copy-number alterations from GISTIC" });
    assert.deepEqual(resolveProfileAxis({ source: "profile", profile: "rna_seq_v2_mrna", gene: "ESR1", log: true }, "y", one),
      { source: "molecular", profileType: "rna_seq_v2_mrna", gene: "ESR1", log: true, label: "ESR1: mRNA Expression, RSEM" });
    const clin = { source: "clinical" as const, attribute: "AGE" };
    assert.equal(resolveProfileAxis(clin, "x", one), clin, "any other axis passes through untouched");
  });
  test("refused by name: a profile the study lacks (saying what it has), one two studies describe differently, and settings it cannot take", () => {
    assert.throws(() => resolveProfileAxis({ source: "profile", profile: "rppa", gene: "ESR1" }, "x", one), /^Error: x axis: brca has no profile 'rppa'; it has mutations, structural_variants, log2CNA, gistic, rna_seq_v2_mrna_median_Zscores/);
    const other = [{ study: "brca", catalog: BRCA }, { study: "panel", catalog: [P("gistic", "COPY_NUMBER_ALTERATION", "LOG2-VALUE", "other")] }];
    assert.throws(() => resolveProfileAxis({ source: "profile", profile: "gistic", gene: "ERBB2" }, "x", other), /described differently by brca \(COPY_NUMBER_ALTERATION, DISCRETE\) and panel/);
    assert.throws(() => resolveProfileAxis({ source: "profile", profile: "gistic", gene: "ERBB2", by: "mutated" }, "x", one), /only a mutation profile groups by/);
    assert.throws(() => resolveProfileAxis({ source: "profile", profile: "gistic", gene: "ERBB2", log: true }, "x", one), /a log scale applies to numbers/);
    assert.throws(() => resolveProfileAxis({ source: "profile", profile: "methylation_hm450", gene: "ERBB2" }, "x", one), /is a generic assay \(Methylation \(HM450\)\), which a plot axis does not read yet/);
  });
  test("a profile axis is shaped before it is read, and only once resolved does it have a kind", () => {
    assert.throws(() => validateAxis({ source: "profile", profile: "", gene: "TP53" }, "x"), /is not a profile/);
    assert.throws(() => validateAxis({ source: "profile", profile: "mutations", gene: "" }, "x"), /reads one gene/);
    assert.throws(() => axisKind({ source: "profile", profile: "mutations", gene: "TP53" }), /only once resolved/);
    assert.equal(axisKind({ source: "molecular", profileType: "gistic", gene: "ERBB2", discrete: true }), "cat");
    assert.equal(axisLabel({ source: "molecular", profileType: "gistic", gene: "ERBB2", discrete: true, label: "ERBB2: GISTIC" }), "ERBB2: GISTIC");
  });
});

describe("the SQL each reading runs", () => {
  test("a discrete profile's own levels, the portal's names, and Multiple for a patient whose samples disagree", () => {
    const sql = axisSelect({ source: "molecular", profileType: "gistic", gene: "ERBB2", discrete: true }, ctx, "cat");
    assert.match(sql, /= -2, 'Deep deletion',[\s\S]*?= -1, 'Shallow deletion',[\s\S]*?= 0, 'Diploid',[\s\S]*?= 1, 'Gain',[\s\S]*?= 2, 'Amplification', toString\(/);
    assert.match(sql, /ga\.profile_type = 'gistic'/);
    assert.match(sql, /if\(uniqExact\(lv\) > 1, 'Multiple', any\(lv\)\)/);
  });
  test("a gene's mutations, copy number or SVs: no such event is the wild-type answer only when the case is profiled for it", () => {
    for (const [by, type, label] of [["mutated", "MUTATION_EXTENDED", "Not mutated"], ["cna", "COPY_NUMBER_ALTERATION", "Neutral"], ["sv", "STRUCTURAL_VARIANT", "No structural variant"]] as const) {
      const sql = axisSelect({ source: "alteration", gene: "ERBB2", by }, ctx, "cat");
      assert.match(sql, new RegExp("if\\(hits = 0 AND NOT \\(alt_case IN \\(SELECT profiled_id"), by);
      assert.match(sql, new RegExp("alteration_type = '" + type + "'"), by);
      assert.match(sql, new RegExp("'" + label + "'"), by);
      assert.match(sql, /'Not profiled', v0\) AS v/, by);
    }
    assert.match(axisSelect({ source: "alteration", gene: "ERBB2", by: "sv" }, ctx, "cat"), /g\.variant_type = 'structural_variant'/);
  });
});
