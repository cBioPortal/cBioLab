-- cohort Colorectal
-- msk_impact_50k_2026
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))

-- cohort Breast
-- msk_impact_50k_2026
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))

-- view 0 clonality: clonality:ascn-studies · msk_impact_50k_2026
SELECT DISTINCT cs.cancer_study_identifier AS study FROM snapshot_db.allele_specific_copy_number a
JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = a.genetic_profile_id
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id ORDER BY study

-- view 0 clonality: clonality:genes:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))),
samp AS (
  SELECT internal_id AS sid, sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
    AND sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.clinical_data_derived
      WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_QC'
        AND lowerUTF8(trimBoth(attribute_value)) = 'pass')
),
prof AS (
  SELECT gp.genetic_profile_id AS id FROM snapshot_db.genetic_profile gp
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026' AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'
),
calls AS (
  SELECT g.hugo_gene_symbol AS gene, a.sample_id AS sid, a.clonal AS call_state, a.ccf_expected_copies AS ccf, a.minor_copy_number AS minor
  FROM snapshot_db.allele_specific_copy_number a
  JOIN snapshot_db.mutation_event me ON me.mutation_event_id = a.mutation_event_id
  JOIN snapshot_db.gene g ON g.entrez_gene_id = me.entrez_gene_id
  INNER JOIN oncokb_annotation.variant_annotation ann ON ann.oncokb_version = 'v7.5' AND ann.is_driver
    AND ann.hugo_gene_symbol = g.hugo_gene_symbol AND ann.alteration_type = 'MUTATION' AND ann.alteration = me.protein_change
  WHERE a.genetic_profile_id IN (SELECT id FROM prof) AND a.sample_id IN (SELECT sid FROM samp)
    AND g.hugo_gene_symbol IN ('TP53','KRAS','APC','PIK3CA','SMAD4','CDH1','GATA3')
)
SELECT gene, count() AS calls, uniqExact(sid) AS samples,
       countIf(call_state = 'CLONAL') AS clonal, countIf(call_state = 'SUBCLONAL') AS subclonal,
       countIf(call_state = 'INDETERMINATE') AS indeterminate,
       countIf(minor = 0) AS loh, countIf(minor IS NOT NULL) AS loh_known,
       countIf(ccf >= 0 AND ccf < 0.1) AS ccf0,
       countIf(ccf >= 0.1 AND ccf < 0.2) AS ccf1,
       countIf(ccf >= 0.2 AND ccf < 0.3) AS ccf2,
       countIf(ccf >= 0.3 AND ccf < 0.4) AS ccf3,
       countIf(ccf >= 0.4 AND ccf < 0.5) AS ccf4,
       countIf(ccf >= 0.5 AND ccf < 0.6) AS ccf5,
       countIf(ccf >= 0.6 AND ccf < 0.7) AS ccf6,
       countIf(ccf >= 0.7 AND ccf < 0.8) AS ccf7,
       countIf(ccf >= 0.8 AND ccf < 0.9) AS ccf8,
       countIf(ccf >= 0.9) AS ccf9
FROM calls GROUP BY gene

-- view 0 clonality: clonality:genes:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))),
samp AS (
  SELECT internal_id AS sid, sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
    AND sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.clinical_data_derived
      WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_QC'
        AND lowerUTF8(trimBoth(attribute_value)) = 'pass')
),
prof AS (
  SELECT gp.genetic_profile_id AS id FROM snapshot_db.genetic_profile gp
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026' AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'
),
calls AS (
  SELECT g.hugo_gene_symbol AS gene, a.sample_id AS sid, a.clonal AS call_state, a.ccf_expected_copies AS ccf, a.minor_copy_number AS minor
  FROM snapshot_db.allele_specific_copy_number a
  JOIN snapshot_db.mutation_event me ON me.mutation_event_id = a.mutation_event_id
  JOIN snapshot_db.gene g ON g.entrez_gene_id = me.entrez_gene_id
  INNER JOIN oncokb_annotation.variant_annotation ann ON ann.oncokb_version = 'v7.5' AND ann.is_driver
    AND ann.hugo_gene_symbol = g.hugo_gene_symbol AND ann.alteration_type = 'MUTATION' AND ann.alteration = me.protein_change
  WHERE a.genetic_profile_id IN (SELECT id FROM prof) AND a.sample_id IN (SELECT sid FROM samp)
    AND g.hugo_gene_symbol IN ('TP53','KRAS','APC','PIK3CA','SMAD4','CDH1','GATA3')
)
SELECT gene, count() AS calls, uniqExact(sid) AS samples,
       countIf(call_state = 'CLONAL') AS clonal, countIf(call_state = 'SUBCLONAL') AS subclonal,
       countIf(call_state = 'INDETERMINATE') AS indeterminate,
       countIf(minor = 0) AS loh, countIf(minor IS NOT NULL) AS loh_known,
       countIf(ccf >= 0 AND ccf < 0.1) AS ccf0,
       countIf(ccf >= 0.1 AND ccf < 0.2) AS ccf1,
       countIf(ccf >= 0.2 AND ccf < 0.3) AS ccf2,
       countIf(ccf >= 0.3 AND ccf < 0.4) AS ccf3,
       countIf(ccf >= 0.4 AND ccf < 0.5) AS ccf4,
       countIf(ccf >= 0.5 AND ccf < 0.6) AS ccf5,
       countIf(ccf >= 0.6 AND ccf < 0.7) AS ccf6,
       countIf(ccf >= 0.7 AND ccf < 0.8) AS ccf7,
       countIf(ccf >= 0.8 AND ccf < 0.9) AS ccf8,
       countIf(ccf >= 0.9) AS ccf9
FROM calls GROUP BY gene

-- view 0 clonality: clonality:purity-ploidy:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))),
samp AS (
  SELECT internal_id AS sid, sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
    AND sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.clinical_data_derived
      WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_QC'
        AND lowerUTF8(trimBoth(attribute_value)) = 'pass')
)
SELECT attribute_name AS attr,
       toInt32(floor(least(if(attribute_name = 'FACETS_PURITY', 0.9999, 7.9999), greatest(0, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL))) /
         if(attribute_name = 'FACETS_PURITY', 0.05, 0.25))) AS bin,
       count() AS n
FROM snapshot_db.clinical_data_derived
WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name IN ('FACETS_PURITY', 'FACETS_PLOIDY')
  AND sample_unique_id IN (SELECT suid FROM samp) AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
GROUP BY attr, bin ORDER BY attr, bin

-- view 0 clonality: clonality:purity-ploidy:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))),
samp AS (
  SELECT internal_id AS sid, sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
    AND sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.clinical_data_derived
      WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_QC'
        AND lowerUTF8(trimBoth(attribute_value)) = 'pass')
)
SELECT attribute_name AS attr,
       toInt32(floor(least(if(attribute_name = 'FACETS_PURITY', 0.9999, 7.9999), greatest(0, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL))) /
         if(attribute_name = 'FACETS_PURITY', 0.05, 0.25))) AS bin,
       count() AS n
FROM snapshot_db.clinical_data_derived
WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name IN ('FACETS_PURITY', 'FACETS_PLOIDY')
  AND sample_unique_id IN (SELECT suid FROM samp) AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
GROUP BY attr, bin ORDER BY attr, bin

-- view 0 clonality: clonality:summary:Breast · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))),
samp AS (
  SELECT internal_id AS sid, sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
),
prof AS (
  SELECT gp.genetic_profile_id AS id FROM snapshot_db.genetic_profile gp
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026' AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'
),
wgd AS (SELECT sample_unique_id AS suid, lowerUTF8(trimBoth(attribute_value)) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_WGD'),
qcv AS (SELECT sample_unique_id AS suid, lowerUTF8(trimBoth(attribute_value)) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_QC')
SELECT count() AS samples,
       countIf(sid IN (SELECT DISTINCT sample_id FROM snapshot_db.allele_specific_copy_number WHERE genetic_profile_id IN (SELECT id FROM prof))) AS ascn_samples,
       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS qc_pass,
       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'fail')) AS qc_fail,
       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'true') AND suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS wgd_true,
       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'false') AND suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS wgd_false
FROM samp

-- view 0 clonality: clonality:summary:Colorectal · msk_impact_50k_2026
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))),
samp AS (
  SELECT internal_id AS sid, sample_unique_id AS suid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
),
prof AS (
  SELECT gp.genetic_profile_id AS id FROM snapshot_db.genetic_profile gp
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026' AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'
),
wgd AS (SELECT sample_unique_id AS suid, lowerUTF8(trimBoth(attribute_value)) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_WGD'),
qcv AS (SELECT sample_unique_id AS suid, lowerUTF8(trimBoth(attribute_value)) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'FACETS_QC')
SELECT count() AS samples,
       countIf(sid IN (SELECT DISTINCT sample_id FROM snapshot_db.allele_specific_copy_number WHERE genetic_profile_id IN (SELECT id FROM prof))) AS ascn_samples,
       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS qc_pass,
       countIf(suid IN (SELECT suid FROM qcv WHERE v = 'fail')) AS qc_fail,
       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'true') AND suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS wgd_true,
       countIf(suid IN (SELECT suid FROM wgd WHERE v = 'false') AND suid IN (SELECT suid FROM qcv WHERE v = 'pass')) AS wgd_false
FROM samp
