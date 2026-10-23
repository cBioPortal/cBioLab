-- cohort all patients
-- crc_apc_impact_2020
SELECT DISTINCT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'

-- view 0 logistic: logisticNotProfiled · crc_apc_impact_2020
SELECT countIf(c0 = 'Not profiled') AS n FROM (
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'),
y0 AS (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS id, attribute_value AS v, 1 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND attribute_name = 'MSI_TYPE' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS id, attribute_value AS v, 0 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND attribute_name = 'MSI_TYPE' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
),
c0 AS (
SELECT alt_case AS id, if(hits = 0 AND NOT (alt_case IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'APC'))))), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') AS alt_case, if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated') AS v0, countIf(g.variant_type = 'mutation') AS hits
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND hugo_gene_symbol IN ('APC')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'crc_apc_impact_2020' AND replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
GROUP BY alt_case)
)
SELECT y0.v AS y, c0.v AS c0
FROM y0
  INNER JOIN c0 ON c0.id = y0.id
)

-- view 0 logistic: logisticRows · crc_apc_impact_2020
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'),
y0 AS (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS id, attribute_value AS v, 1 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND attribute_name = 'MSI_TYPE' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS id, attribute_value AS v, 0 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND attribute_name = 'MSI_TYPE' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
),
c0 AS (
SELECT id, v FROM (
SELECT alt_case AS id, if(hits = 0 AND NOT (alt_case IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'APC'))))), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') AS alt_case, if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated') AS v0, countIf(g.variant_type = 'mutation') AS hits
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND hugo_gene_symbol IN ('APC')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'crc_apc_impact_2020' AND replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
GROUP BY alt_case)
) WHERE v != 'Not profiled'
)
SELECT y0.v AS y, c0.v AS c0
FROM y0
  INNER JOIN c0 ON c0.id = y0.id
