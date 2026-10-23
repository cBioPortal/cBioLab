-- cohort Basal-like
-- brca_tcga_pan_can_atlas_2018
(SELECT DISTINCT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND type = 'patient'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))

-- cohort Luminal A
-- brca_tcga_pan_can_atlas_2018
(SELECT DISTINCT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND type = 'patient'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))

-- view 0 diffexpr: diffexpr:genesets · brca_tcga_pan_can_atlas_2018
SELECT gs.external_id AS set_name, groupUniqArray(g.hugo_gene_symbol) AS genes
FROM snapshot_db.geneset gs
JOIN snapshot_db.geneset_gene gg ON gg.geneset_id = gs.id
JOIN snapshot_db.gene g ON g.entrez_gene_id = gg.entrez_gene_id
WHERE startsWith(gs.external_id, 'HALLMARK_') GROUP BY set_name ORDER BY set_name

-- view 0 diffexpr: diffexpr:moments:Basal-like · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND type = 'patient'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))),
vals AS (
  SELECT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, ga.hugo_gene_symbol AS gene, avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND isFinite(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))
    AND replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid, gene
)
SELECT gene, count() AS n, sum(v) AS sx, sum(v * v) AS sxx FROM vals GROUP BY gene

-- view 0 diffexpr: diffexpr:moments:Luminal A · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND type = 'patient'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))),
vals AS (
  SELECT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, ga.hugo_gene_symbol AS gene, avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND isFinite(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))
    AND replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid, gene
)
SELECT gene, count() AS n, sum(v) AS sx, sum(v * v) AS sxx FROM vals GROUP BY gene
