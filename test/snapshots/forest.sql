-- cohort all patients
-- msk_impact_50k_2026
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'

-- view 0 forest: coxNotProfiled:OS · msk_impact_50k_2026
SELECT countIf(c0 = 'Not profiled') AS n FROM (
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
c0 AS (
SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.patient_unique_id, 'msk_impact_50k_2026_', '') AS alt_case, if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated') AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'msk_impact_50k_2026_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sd.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case)
),
c1 AS (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS id, attribute_value AS v, 1 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name = 'CANCER_TYPE' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS id, attribute_value AS v, 0 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name = 'CANCER_TYPE' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
) GROUP BY id
)
SELECT os.months AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), NULL) = 1, 1, 0) AS ev, c0.v AS c0, c1.v AS c1
FROM os
  INNER JOIN c0 ON c0.id = os.pid
  INNER JOIN c1 ON c1.id = os.pid
WHERE os.months IS NOT NULL
)

-- view 0 forest: coxRows:OS · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
c0 AS (
SELECT id, v FROM (
SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.patient_unique_id, 'msk_impact_50k_2026_', '') AS alt_case, if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated') AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'msk_impact_50k_2026_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sd.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case)
) WHERE v != 'Not profiled'
),
c1 AS (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS id, attribute_value AS v, 1 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name = 'CANCER_TYPE' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS id, attribute_value AS v, 0 AS pref
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name = 'CANCER_TYPE' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
) GROUP BY id
)
SELECT os.months AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), NULL) = 1, 1, 0) AS ev, c0.v AS c0, c1.v AS c1
FROM os
  INNER JOIN c0 ON c0.id = os.pid
  INNER JOIN c1 ON c1.id = os.pid
WHERE os.months IS NOT NULL

-- view 0 forest: survivalLeftOut:OS_MONTHS · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         anyIf(attribute_value, attribute_name = 'OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'patient'
    AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT countIf(lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0 AND NOT lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na')) AS no_status,
       countIf(lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND NOT (lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0)) AS no_time
FROM os
