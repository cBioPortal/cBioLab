// The panel-aware denominator, guarded at the source.
//
// A gene's frequency is altered / profiled-for-THAT-gene, and "profiled" is a
// property of (sample, gene) resolved through the panel tables — NOT a property
// of the study. Within one study, samples sit on different panels: nsclc_ctdx_msk_2022
// has 8 panels for CNA, and msk_ch_2020 is 73% whole-exome. A sample whose panel
// omits a gene is NOT PROFILED for it, never wild-type.
//
// The dangerous edit is substituting a group-level count — "samples in the study",
// "samples in the selection" — for the panel join. It does not error. It produces
// percentages that look entirely reasonable and are wrong, and it would survive
// any test that only checks the shape of the output.
//
// This matters most for work that pools queries across studies: pooling is SAFE
// (altered and profiled are both additive over samples, which is why
// mergeExplore can already sum them) but only while the join survives.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const explore = readFileSync(new URL("../lib/explore.ts", import.meta.url), "utf8");
/** the gene-table builder, where the denominator is computed */
function geneTableSrc(): string {
  const i = explore.indexOf("const geneTable = async (");
  assert.ok(i > 0, "could not find the gene table builder in lib/explore.ts");
  const j = explore.indexOf("const [mut, cna, sv]", i);
  return explore.slice(i, j > 0 ? j : i + 6000);
}

describe("gene frequencies keep a panel-aware denominator", () => {
  const src = geneTableSrc();

  test("profiled comes from the panel tables, not from a sample count", () => {
    assert.match(src, /sample_to_gene_panel_derived/,
      "the denominator must resolve which samples were profiled from their panels");
    assert.match(src, /gene_panel_to_gene_derived/,
      "...and which genes each panel covers");
  });

  test("whole-exome samples are added as a scalar, not joined", () => {
    // WES enumerates ~45k genes; joining it multiplied one TCGA study to 47.8M
    // rows. The portal splits it out for the same reason, so parity AND
    // performance both depend on this staying a separate term.
    assert.match(src, /'WES'|"WES"/, "WES has to be handled explicitly");
    assert.match(src, /gene_panel_id\s*!=\s*'WES'/,
      "WES must be excluded from the panel join");
  });

  test("panel counts are distinct SAMPLES, not rows", () => {
    // sample_to_gene_panel_derived holds one row per (sample, panel,
    // genetic_profile). A study that publishes two profiles of one alteration
    // type — every TCGA study publishes a discrete AND a linear CNA profile —
    // therefore lists each sample twice. Counting rows doubled the denominator
    // and halved every CNA frequency in 101 of 353 studies: brca_tcga reported
    // MYC amplification at 229/2160 = 10.6% against a true 229/1080 = 21.2%.
    assert.match(src, /uniqExact\(sample_unique_id\) AS n/,
      "the panel and WES counts must count distinct samples");
    assert.equal(/count\(\) AS n/.test(src), false,
      "counting rows double-counts a sample that appears under two genetic profiles");
  });

  test("one builder serves both the single-study and the pooled path", () => {
    // The pooled path exists for performance, but a second copy of the
    // denominator is how the two would drift apart. There is one builder, and
    // a single study is simply the list of length one.
    assert.match(explore, /export async function geneTables\(\{\s*studies/,
      "the gene tables must be built by one exported, study-list-taking builder");
    assert.match(explore, /geneTables\(\{ studies: \[study\]/,
      "the single-study path must go through that same builder");
    assert.match(explore, /geneTables\(\{ studies: ss/,
      "the federated path must go through that same builder");
  });

  test("uncalled mutations are excluded, as the portal does", () => {
    assert.match(src, /mutation_status\s*!=\s*'UNCALLED'/,
      "uncalled mutations exist only to show read support and are not alterations");
  });

  test("the unit of counting is SAMPLES", () => {
    // Patients and samples differ (25,040 samples over 24,950 patients in
    // msk_chord_2024), and the portal's study-view gene tables count samples.
    assert.match(src, /uniqExact\(sample_unique_id\)/);
  });

  test("the denominator is never a bare study-or-cohort total", () => {
    // The specific wrong edit: reusing the cohort/sample total as `profiled`.
    const bad = /profiled\s*[:=]\s*(cohort|totals|studyN|sampleCount|total)\b/i;
    assert.equal(bad.test(src), false,
      "profiled must be computed per gene from the panels, never taken from a group total");
  });

  test("frequency divides the two, and only after both are summed", () => {
    // Across studies the merge sums altered and profiled and THEN divides.
    // Averaging per-study percentages would weight a 30-sample study equally
    // with a 30,000-sample one.
    const merge = explore.slice(explore.indexOf("const mergeGeneTable"), explore.indexOf("const mergeGeneTable") + 900);
    assert.match(merge, /cur\.altered \+= r\.altered/);
    assert.match(merge, /cur\.profiled \+= r\.profiled/);
    assert.match(merge, /cur\.alteredOnPanel = \(cur\.alteredOnPanel \?\? 0\) \+ \(r\.alteredOnPanel \?\? r\.altered\)/,
      "the frequency's numerator must be summed across participants like the other two");
    assert.match(merge, /freqPct:.*\(r\.alteredOnPanel \?\? r\.altered\)\s*\/\s*r\.profiled/s,
      "the percentage must be derived from the summed totals, not averaged");
  });

  test("an off-panel call counts in altered but not in the frequency", () => {
    // A call in a gene its sample's panel does not cover: that sample is not in `profiled`, so
    // counting it in the numerator sets a numerator against a denominator it is not part of —
    // SV EWSR1 read 72/407 = 17.7% where cBioPortal's study view shows 0/407. The portal counts
    // such a sample in "#" (numberOfAlteredCases) and leaves it out of Freq
    // (numberOfAlteredCasesOnPanel); check:portal compares all three numbers.
    assert.match(src, /uniqExactIf\(sample_unique_id, NOT off_panel\) AS on_panel/,
      "the on-panel count must come from the event's off_panel flag");
    assert.match(src, /freqPct: profiled \? Math\.round\(1000 \* onPanel \/ profiled\)/,
      "the frequency's numerator is the on-panel count");
  });
});
