/**
 * Live differential for the pooled multi-study paths, over studies profiled differently: each
 * number Explore and the OncoPrint report, against a count written here independently — grouped
 * per study and summed in this script, the draft applied as a hand-written condition rather than
 * through the compiler. Exact, no tolerance.
 *
 *   1. Explore histograms: every bar of every binned facet, outlier bars included, and its NA
 *      count, with and without a draft, each bar recounted here from every study's recorded values
 *      by the range it shows. Bars once summed across studies by position shifted every bar after
 *      a missing one into its neighbour (14 of 14 facets over 32 studies); the layout itself is
 *      compared with cbioportal.org in check:portal.
 *   2. The OncoPrint's gene rows, sample and patient columns: altered / profiled where profiled is
 *      a column some mutation, CNA or SV panel of covers the gene (whole-exome covers every gene)
 *      and altered is a profiled column with a call in it — so a call off its column's panels is in
 *      neither, as on cBioPortal's results view (EWSR1 over the studies below once read 93/483 for
 *      21/411).
 *
 * The studies mix one panel (IMPACT341), several panels in one study (IMPACT341/410/468, eight CNA
 * panels), mostly-whole-exome-with-some-panel and whole-exome. The gene tables over such a
 * selection are compared with cbioportal.org itself in check:portal.
 *
 * Run: npm run check:pooled
 */
import { buildExploreFederated } from "../lib/explore.ts";
import { buildContract } from "../lib/oncoprint.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { chQuery, DB } from "../lib/ch.ts";
import { sq } from "../lib/compiler.ts";
import type { ClinicalFacet, CohortDef } from "../lib/types.ts";
import type { OncoprintSpec } from "../lib/views/oncoprint/types.ts";

const STUDIES = [
  "utuc_mskcc_2015",               // IMPACT341
  "msk_impact_2017",               // IMPACT341 / 410 / 468 within one study
  "blca_tcga_pan_can_atlas_2018",  // whole-exome
  "brca_tcga_pan_can_atlas_2018",  // whole-exome
  "nsclc_ctdx_msk_2022",           // eight CNA panels
  "msk_ch_2020",                   // mostly whole-exome, some panel
  "crc_apc_impact_2020",           // targeted panel
  "histiocytosis_cobi_msk_2019",
];
/** genes on whole-exome only (FAT4, TIMM8B), on some IMPACT panels and not others (ZFHX3), everywhere (TP53), and fusion partners mostly off-panel (EWSR1) */
const GENES = ["TP53", "FAT4", "ZFHX3", "EWSR1", "TIMM8B"];
const IN = STUDIES.map(sq).join(",");
/** the draft, and the same patients written by hand */
const FEMALE: CohortDef = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] };
const FEMALE_SQL = `SELECT patient_unique_id FROM ${DB}.clinical_data_derived WHERE cancer_study_identifier IN (${IN})
  AND type = 'patient' AND attribute_name = 'SEX' AND lowerUTF8(trimBoth(attribute_value)) = 'female'`;

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  if (!pass) failures++;
  console.log((pass ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};
const n = (x: unknown) => Number(x);

const profilesByStudy = new Map();
for (const s of STUDIES) profilesByStudy.set(s, await studyProfiles(s));

// ---- 1. histograms -------------------------------------------------------
for (const [label, draft] of [["no draft", null], ["SEX = Female", FEMALE]] as const) {
  const ex = await buildExploreFederated({ studies: STUDIES, draft, profilesByStudy });
  const facets = ex.clinical.filter((c): c is Extract<ClinicalFacet, { kind: "num" }> => c.kind === "num" && !!c.bins?.length);
  let withOutliers = 0;
  for (const f of facets) {
    // every recorded value of every study, by study, and each bar's count restated from them: a plain
    // number in the bar whose range holds it ((start, end], one value, at or below the "<=" bar's
    // end, above the ">" bar's start), a number recorded as a bound (">90") in the outlier bar on
    // its side, a word in the bar of its spelling (case aside); a number with space around it is in
    // none, as on the portal
    const unit = f.per === "sample" ? "sample_unique_id" : "patient_unique_id";
    const r = await chQuery(`SELECT cancer_study_identifier AS s, attribute_value AS v, uniqExact(${unit}) AS n FROM ${DB}.clinical_data_derived
      WHERE cancer_study_identifier IN (${IN}) AND attribute_name = ${sq(f.attribute)} AND type = ${sq(f.per)}
        AND lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')
        AND patient_unique_id IN (SELECT patient_unique_id FROM ${DB}.sample_derived WHERE cancer_study_identifier IN (${IN}))
        ${draft ? "AND patient_unique_id IN (" + FEMALE_SQL + ")" : ""}
      GROUP BY s, v`);
    const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
    const barOf = (raw: string): number => {
      const t = raw.trim();
      if (PLAIN.test(raw)) {
        const x = Number(raw);
        return f.bins!.findIndex((b) => b.value == null && (b.special === "<=" ? x <= b.end! : b.special === ">" ? x > b.start!
          : b.start === b.end ? x === b.start : x > b.start! && x <= b.end!));
      }
      if (PLAIN.test(t)) return -1;
      const bound = /^(<=|>=|<|>)(.*)$/.exec(t);
      if (bound && PLAIN.test(bound[2])) return f.bins!.findIndex((b) => b.special === (bound[1][0] === "<" ? "<=" : ">"));
      return f.bins!.findIndex((b) => b.value != null && b.value.toUpperCase() === t.toUpperCase());
    };
    const truth = new Map<number, number>();
    let recorded = 0;
    for (const x of r.data) {
      recorded += n(x.n);
      const i = barOf(String(x.v));
      if (i >= 0 || !PLAIN.test(String(x.v).trim())) truth.set(i, (truth.get(i) || 0) + n(x.n));
    }
    if (f.bins!.some((b) => b.special)) withOutliers++;
    const keys = [...new Set([...truth.keys(), ...f.bins!.map((_, i) => i)])];
    const bad = keys.filter((i) => (truth.get(i) || 0) !== (f.bins![i]?.count || 0));
    ok(`histogram, ${label}: ${f.attribute} bars`, !bad.length,
      bad.length ? bad.slice(0, 4).map((i) => `${i < 0 ? "no bar" : i}: ${f.bins![i]?.count || 0} vs ${truth.get(i) || 0}`).join(", ") : `${f.bins!.length} bars`);
    // NA: the cohort in the facet's unit, less those with a recorded value
    const c = await chQuery(`SELECT uniqExact(${unit}) AS n FROM ${DB}.sample_derived WHERE cancer_study_identifier IN (${IN})
      ${draft ? "AND patient_unique_id IN (" + FEMALE_SQL + ")" : ""}`);
    const na = Math.max(0, n(c.data[0].n) - recorded);
    ok(`histogram, ${label}: ${f.attribute} not available`, f.naCount === na, `${f.naCount} vs ${na}`);
  }
  // the defect this guards needs studies whose outlier bars differ; say whether the data has them
  ok(`histogram, ${label}: the selection exercises outlier bars`, withOutliers > 0, `${withOutliers} of ${facets.length} facets have them`);
}

// ---- 2. OncoPrint gene rows -------------------------------------------------
const CALL = `(variant_type != 'cna' OR abs(cna_alteration) >= 2) AND (variant_type != 'mutation' OR mutation_status != 'UNCALLED')`;
for (const unit of ["sample", "patient"] as const) {
  const c = await buildContract({ studies: STUDIES, genes: GENES, unit } as OncoprintSpec);
  for (const g of GENES) {
    const t = c.tracks.find((x) => x.label === g);
    const covered = `SELECT DISTINCT sample_unique_id FROM ${DB}.sample_to_gene_panel_derived
      WHERE cancer_study_identifier IN (${IN}) AND alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
        AND (gene_panel_id = 'WES' OR gene_panel_id IN (SELECT gene_panel_id FROM ${DB}.gene_panel_to_gene_derived WHERE gene = ${sq(g)}))`;
    const sql = unit === "sample"
      ? `SELECT (SELECT count() FROM (${covered})) AS profiled,
           (SELECT uniqExact(sample_unique_id) FROM ${DB}.genomic_event_derived WHERE cancer_study_identifier IN (${IN}) AND hugo_gene_symbol = ${sq(g)}
              AND ${CALL} AND sample_unique_id IN (${covered})) AS altered`
      // a patient is profiled where any of their samples is, and altered where profiled with a call in any sample
      : `WITH pc AS (SELECT DISTINCT patient_unique_id FROM ${DB}.sample_derived WHERE sample_unique_id IN (${covered}))
         SELECT (SELECT count() FROM pc) AS profiled,
           (SELECT uniqExact(patient_unique_id) FROM ${DB}.genomic_event_derived WHERE cancer_study_identifier IN (${IN}) AND hugo_gene_symbol = ${sq(g)}
              AND ${CALL} AND patient_unique_id IN (SELECT patient_unique_id FROM pc)) AS altered`;
    const x = (await chQuery(sql)).data[0];
    const ours = t ? `${t.altered}/${t.profiled}` : "absent", truth = `${n(x.altered)}/${n(x.profiled)}`;
    ok(`oncoprint, ${unit} columns: ${g} altered / profiled`, ours === truth, `${ours} vs ${truth}`);
  }
}

console.log(failures ? `\n${failures} of ${checks} pooled checks FAILED` : `\nall ${checks} pooled checks agree`);
process.exit(failures ? 1 : 0);
