// The Comparison page's tabs (app/portal/comparison-layout.ts): its expression tabs (mRNA, Protein,
// DNA methylation) pick their profile as cBioPortal's group comparison does, and a tab the page
// cannot show says why rather than going missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonLayout } from "../app/portal/comparison-layout.ts";
import { proteinProfile, methylationProfile, probeMethylation, type StudyKnown } from "../app/portal/study-known.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";

let order = 0;
const prof = (profile: string, type: string, datatype: string, assayType?: string): ProfileInfo =>
  ({ profile, type, datatype, name: profile, order: order++, ...(assayType ? { assayType } : {}) });
// brca_tcga's profiles, listed here in the database's order, which is not the portal's
const BRCA_TCGA = [
  prof("rppa", "PROTEIN_LEVEL", "LOG2-VALUE"), prof("rppa_Zscores", "PROTEIN_LEVEL", "Z-SCORE"),
  prof("protein_quantification", "PROTEIN_LEVEL", "CONTINUOUS"), prof("protein_quantification_zscores", "PROTEIN_LEVEL", "Z-SCORE"),
  prof("methylation_hm450", "METHYLATION", "CONTINUOUS"), prof("rna_seq_v2_mrna", "MRNA_EXPRESSION", "CONTINUOUS"),
  prof("rna_seq_v2_mrna_median_Zscores", "MRNA_EXPRESSION", "Z-SCORE"), prof("mutations", "MUTATION_EXTENDED", "MAF"),
];
// a PanCancer Atlas study: methylation only per probe, as a generic assay
const PANCAN = [
  prof("rppa", "PROTEIN_LEVEL", "LOG2-VALUE"), prof("rppa_Zscores", "PROTEIN_LEVEL", "Z-SCORE"),
  prof("methylation_hm450", "GENERIC_ASSAY", "LIMIT-VALUE", "METHYLATION"), prof("rna_seq_v2_mrna", "MRNA_EXPRESSION", "CONTINUOUS"),
];
const known = (profileCatalog: ProfileInfo[]): StudyKnown => ({
  name: "s", names: { s: "s" }, held: { every: ["MUTATION"], some: [] }, noDrivers: [], portal: {},
  profiles: profileCatalog.map((p) => p.profile), gaProfiles: [], clinical: ["SEX"], profileCatalog,
  attrs: [{ attribute: "SEX", kind: "cat", patients: 10 }], patients: 10, samples: 10,
});
const cohorts = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => ["G" + i, { all: [{ kind: "clinical", attribute: "SEX", values: ["v" + i] }] }]));
const layout = (n: number, catalog: ProfileInfo[] | null) =>
  comparisonLayout({ study: "s", cohorts: cohorts(n) } as any, "s", catalog && known(catalog), false);
const tabOf = (l: ReturnType<typeof layout>, title: string) => {
  const t = l.tabs.find((x) => x.title === title);
  return t?.views && (l.doc.views![t.views[0]] as any);
};

test("protein and methylation profiles are picked as the portal picks them: not z-scores, first by id", () => {
  assert.equal(proteinProfile(BRCA_TCGA), "protein_quantification", "the portal lists profiles by id, so mass spectrometry before RPPA");
  assert.equal(proteinProfile(PANCAN), "rppa");
  assert.equal(proteinProfile([prof("rppa_Zscores", "PROTEIN_LEVEL", "Z-SCORE")]), null, "z-scores alone are not compared");
  assert.equal(proteinProfile([prof("x_merged_median_zscores", "PROTEIN_LEVEL", "Z-SCORE")]), "x_merged_median_zscores");
  assert.equal(methylationProfile(BRCA_TCGA), "methylation_hm450");
  assert.equal(methylationProfile([prof("methylation_hm450", "METHYLATION", "CONTINUOUS"), prof("methylation_hm27", "METHYLATION", "CONTINUOUS")]), "methylation_hm27");
  assert.equal(methylationProfile(PANCAN), null, "per-probe generic-assay methylation is not gene-level");
  assert.equal(probeMethylation(PANCAN), true);
  assert.equal(probeMethylation(BRCA_TCGA), false);
});

test("two groups: mRNA, Protein and DNA methylation tabs, each a diffexpr view; protein and methylation without enrichment", () => {
  const l = layout(2, BRCA_TCGA);
  assert.deepEqual(l.tabs.map((t) => t.title).filter((t) => /mRNA|Protein|methylation/.test(t)), ["mRNA", "Protein", "DNA methylation"]);
  assert.deepEqual(tabOf(l, "mRNA"), { kind: "diffexpr", profileType: "rna_seq_v2_mrna" });
  assert.deepEqual(tabOf(l, "Protein"), { kind: "diffexpr", profileType: "protein_quantification", geneSets: [] });
  assert.deepEqual(tabOf(l, "DNA methylation"), { kind: "diffexpr", profileType: "methylation_hm450", geneSets: [] });
  assert.ok(!l.left.some((x) => /mRNA|Protein|methylation/.test(x)), l.left.join("; "));
});

test("more than two groups: no expression tab, and the page says why", () => {
  const l = layout(3, BRCA_TCGA);
  assert.ok(!l.tabs.some((t) => /mRNA|Protein|methylation/.test(t.title)));
  for (const t of ["mRNA", "Protein", "DNA methylation"])
    assert.ok(l.left.some((x) => x.startsWith(t + " (compares exactly two groups, and 3 are compared; cBioPortal tests more than two with ANOVA")), t + ": " + l.left.join("; "));
});

test("a study without a profile says so, and per-probe methylation is named as the reason", () => {
  const l = layout(2, PANCAN);
  assert.equal(tabOf(l, "Protein").profileType, "rppa");
  assert.equal(tabOf(l, "DNA methylation"), undefined);
  assert.ok(l.left.includes("DNA methylation (this study's methylation is per probe, a generic assay, which this page does not compare)"), l.left.join("; "));
  const none = layout(2, [prof("mutations", "MUTATION_EXTENDED", "MAF")]);
  assert.ok(none.left.includes("Protein (no protein profile)") && none.left.includes("DNA methylation (no methylation profile)") && none.left.includes("mRNA (no mRNA profile)"));
});

test("before the profiles are known, no expression tab and nothing said about them", () => {
  const l = layout(2, null);
  assert.equal(l.partial, true);
  assert.ok(!l.tabs.some((t) => /mRNA|Protein|methylation/.test(t.title)));
  assert.deepEqual(l.left, []);
});
