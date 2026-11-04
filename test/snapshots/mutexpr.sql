-- cohort All samples
-- brca_tcga_pan_can_atlas_2018
SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'

-- view 0 mutexpr: mutexpr:groups:All samples · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
samp AS (
  SELECT sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
),
raw AS (
  SELECT ga.sample_unique_id AS suid, avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS r, avg(log2(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) + 1)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna' AND ga.hugo_gene_symbol = 'TP53'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) >= 0
    AND ga.sample_unique_id IN (SELECT suid FROM samp)
  GROUP BY suid
),
neg AS (
  SELECT uniqExact(ga.sample_unique_id) AS c FROM snapshot_db.genetic_alteration_derived ga
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna' AND ga.hugo_gene_symbol = 'TP53'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) < 0 AND ga.sample_unique_id IN (SELECT suid FROM samp) AND ga.sample_unique_id NOT IN (SELECT suid FROM raw)
),
mut AS (
  SELECT g.sample_unique_id AS suid, groupUniqArray(if(g.mutation_variant = '', '(no protein change)', g.mutation_variant)) AS labels
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND g.hugo_gene_symbol = 'TP53' AND g.variant_type = 'mutation'
    AND g.mutation_status != 'UNCALLED' AND NOT g.off_panel AND g.sample_unique_id IN (SELECT suid FROM raw)
  GROUP BY suid
),
prof AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
lab AS (
  SELECT raw.v AS v, multiIf(length(mut.labels) = 1, mut.labels[1], length(mut.labels) > 1, '#multiple',
           replaceOne(raw.suid, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT profiled_id FROM prof), '#notMutated', '#notProfiled') AS grp,
         '' AS stratum, '' AS stratum_label
  FROM raw LEFT JOIN mut ON mut.suid = raw.suid
)
SELECT stratum, min(stratum_label) AS stratum_label, grp, least(59, greatest(0, toInt32(floor((v - 7.7888096705817595) * 13.186735014026691)))) AS bin,
       count() AS n, sum(v) AS sx, sum(v * v) AS sxx
FROM lab GROUP BY stratum, grp, bin ORDER BY stratum, grp, bin

-- view 0 mutexpr: mutexpr:range:All samples · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
samp AS (
  SELECT sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
),
raw AS (
  SELECT ga.sample_unique_id AS suid, avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS r, avg(log2(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) + 1)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna' AND ga.hugo_gene_symbol = 'TP53'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) >= 0
    AND ga.sample_unique_id IN (SELECT suid FROM samp)
  GROUP BY suid
),
neg AS (
  SELECT uniqExact(ga.sample_unique_id) AS c FROM snapshot_db.genetic_alteration_derived ga
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna' AND ga.hugo_gene_symbol = 'TP53'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) < 0 AND ga.sample_unique_id IN (SELECT suid FROM samp) AND ga.sample_unique_id NOT IN (SELECT suid FROM raw)
)
SELECT (SELECT count() FROM samp) AS cohort_samples, count() AS with_value,
       (SELECT c FROM neg) AS negative,
       quantileExact(0.005)(v) AS lo, quantileExact(0.995)(v) AS hi
FROM raw
