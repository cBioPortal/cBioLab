-- cohort all patients
-- crc_apc_impact_2020
SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'

-- view 0 cox: coxNotProfiled:OS · crc_apc_impact_2020
SELECT countIf(c0 = 'Not profiled') AS n FROM (
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'),
os AS (
  SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
c0 AS (
SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1 AND p1 = 1 AND p2 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') AS alt_case, if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated') AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0,
  max(replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'KRAS'))))) AS p1,
  max(replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))))) AS p2
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND hugo_gene_symbol IN ('TP53','KRAS','PIK3CA')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'crc_apc_impact_2020' AND replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case)
)
SELECT os.months AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), NULL) = 1, 1, 0) AS ev, c0.v AS c0
FROM os
  INNER JOIN c0 ON c0.id = os.pid
WHERE os.months IS NOT NULL
)

-- view 0 cox: coxRows:OS · crc_apc_impact_2020
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'),
os AS (
  SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
c0 AS (
SELECT id, v FROM (
SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1 AND p1 = 1 AND p2 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.patient_unique_id, 'crc_apc_impact_2020_', '') AS alt_case, if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated') AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0,
  max(replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'KRAS'))))) AS p1,
  max(replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'crc_apc_impact_2020' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))))) AS p2
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND hugo_gene_symbol IN ('TP53','KRAS','PIK3CA')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'crc_apc_impact_2020' AND replaceOne(sd.sample_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case)
) WHERE v != 'Not profiled'
)
SELECT os.months AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), NULL) = 1, 1, 0) AS ev, c0.v AS c0
FROM os
  INNER JOIN c0 ON c0.id = os.pid
WHERE os.months IS NOT NULL

-- view 0 cox: survivalLeftOut:OS_MONTHS · crc_apc_impact_2020
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid, replaceOne(sample_unique_id, 'crc_apc_impact_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020'),
os AS (
  SELECT replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') AS pid,
         anyIf(attribute_value, attribute_name = 'OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'crc_apc_impact_2020' AND type = 'patient'
    AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'crc_apc_impact_2020_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT countIf(lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0 AND NOT lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na')) AS no_status,
       countIf(lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND NOT (lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0)) AS no_time
FROM os
