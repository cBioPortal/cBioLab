/**
 * Live differential for the pooled multi-study paths, over studies profiled differently: each
 * number Explore and the OncoPrint report, against a count written here independently — grouped
 * per study and summed in this script, the draft applied as a hand-written condition rather than
 * through the compiler. Exact, no tolerance.
 *
 *   1. Explore histograms: every bar of every binned facet, outlier bars included, and its NA
 *      count, with and without a draft. Bars are summed across studies by bin, never by position:
 *      a study carries the "<=" / ">" bars only when it has values there, and summing by position
 *      once shifted every bar after a missing one into its neighbour (14 of 14 facets over 32
 *      studies).
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
import type { ClinicalFacet, CohortDef, OncoprintSpec } from "../lib/types.ts";

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
const FEMALE: CohortDef = { all: [{ kind: "clinical", attribute: "SEX", per: "patient", op: "=", value: "Female" }] };
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
    const bars = f.bins!.filter((b) => !b.special);
    const e0 = bars[0].start!, interval = Math.round((bars[0].end! - bars[0].start!) * 1e6) / 1e6;
    const last = Math.round((e0 + interval * bars.length) * 1e6) / 1e6;
    const unit = f.per === "sample" ? "sample_unique_id" : "patient_unique_id";
    const r = await chQuery(`SELECT cancer_study_identifier AS s,
        if(v <= ${e0}, 'lo', if(v > ${last}, 'hi', toString(toInt32(ceil((v - ${e0}) / ${interval})) - 1))) AS b, uniqExact(id) AS n
      FROM (SELECT cancer_study_identifier, toFloat64OrNull(attribute_value) AS v, ${unit} AS id FROM ${DB}.clinical_data_derived
            WHERE cancer_study_identifier IN (${IN}) AND attribute_name = ${sq(f.attribute)} AND type = ${sq(f.per)} AND attribute_value != ''
            ${draft ? "AND patient_unique_id IN (" + FEMALE_SQL + ")" : ""})
      WHERE v IS NOT NULL GROUP BY s, b`);
    const truth = new Map<string, number>();
    for (const x of r.data) truth.set(String(x.b), (truth.get(String(x.b)) || 0) + n(x.n));
    const ours = new Map(f.bins!.map((b) => [b.special === "<=" ? "lo" : b.special === ">" ? "hi" : String(bars.indexOf(b)), b.count]));
    if (truth.has("lo") || truth.has("hi")) withOutliers++;
    const keys = [...new Set([...truth.keys(), ...ours.keys()])];
    const bad = keys.filter((k) => (truth.get(k) || 0) !== (ours.get(k) || 0));
    ok(`histogram, ${label}: ${f.attribute} bars`, !bad.length,
      bad.length ? bad.slice(0, 4).map((k) => `${k}: ${ours.get(k) || 0} vs ${truth.get(k) || 0}`).join(", ") : `${bars.length} bars`);
    // NA: the cohort in the facet's unit, less the values binned
    const c = await chQuery(`SELECT uniqExact(${unit}) AS n FROM ${DB}.sample_derived WHERE cancer_study_identifier IN (${IN})
      ${draft ? "AND patient_unique_id IN (" + FEMALE_SQL + ")" : ""}`);
    const na = Math.max(0, n(c.data[0].n) - [...truth.values()].reduce((a, b) => a + b, 0));
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
