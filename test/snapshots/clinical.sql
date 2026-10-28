-- cohort liver mets
-- crc_apc_impact_2020
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'crc_apc_impact_2020_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'crc_apc_impact_2020'
    AND g.hugo_gene_symbol = 'APC'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND (('sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Yes')))) OR ('patient', replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Yes'))))))

-- cohort no liver mets
-- crc_apc_impact_2020
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'crc_apc_impact_2020_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'crc_apc_impact_2020'
    AND g.hugo_gene_symbol = 'APC'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND (('sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('No')))) OR ('patient', replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('No'))))))

-- view 0 clinical: clinicalHistogram · crc_apc_impact_2020
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'crc_apc_impact_2020_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'crc_apc_impact_2020'
    AND g.hugo_gene_symbol = 'APC'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND (('sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('No')))) OR ('patient', replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('No'))))))),
     raw AS (
       SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
       FROM snapshot_db.clinical_data_derived
       WHERE cancer_study_identifier = 'crc_apc_impact_2020'
         AND attribute_name IN ('MSI_SCORE','AGE_AT_MET')
         AND attribute_value != ''
         AND ((type = 'sample' AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT sid FROM cohort)) OR (type = 'patient' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)))
     )
SELECT a, per, x, count() AS n
FROM raw
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per, x
ORDER BY n DESC
LIMIT 20001 BY a, per

-- view 0 clinical: clinicalHistogram · crc_apc_impact_2020
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'crc_apc_impact_2020_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'crc_apc_impact_2020'
    AND g.hugo_gene_symbol = 'APC'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND (('sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Yes')))) OR ('patient', replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Yes'))))))),
     raw AS (
       SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
       FROM snapshot_db.clinical_data_derived
       WHERE cancer_study_identifier = 'crc_apc_impact_2020'
         AND attribute_name IN ('MSI_SCORE','AGE_AT_MET')
         AND attribute_value != ''
         AND ((type = 'sample' AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT sid FROM cohort)) OR (type = 'patient' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)))
     )
SELECT a, per, x, count() AS n
FROM raw
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per, x
ORDER BY n DESC
LIMIT 20001 BY a, per

-- view 0 clinical: clinicalMoments · crc_apc_impact_2020
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'crc_apc_impact_2020_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'crc_apc_impact_2020'
    AND g.hugo_gene_symbol = 'APC'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND (('sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('No')))) OR ('patient', replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('No')))))))
SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx
FROM (
  SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name IN ('MSI_SCORE','AGE_AT_MET')
    AND attribute_value != ''
    AND ((type = 'sample' AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT sid FROM cohort)) OR (type = 'patient' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)))
)
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per

-- view 0 clinical: clinicalMoments · crc_apc_impact_2020
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'crc_apc_impact_2020_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'crc_apc_impact_2020'
    AND g.hugo_gene_symbol = 'APC'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND (('sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Yes')))) OR ('patient', replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'crc_apc_impact_2020_', ''), replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name = 'METASTASIS_LIVER' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Yes')))))))
SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx
FROM (
  SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'
    AND attribute_name IN ('MSI_SCORE','AGE_AT_MET')
    AND attribute_value != ''
    AND ((type = 'sample' AND replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT sid FROM cohort)) OR (type = 'patient' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)))
)
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per
