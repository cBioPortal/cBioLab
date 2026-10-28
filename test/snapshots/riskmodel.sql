-- cohort NSCLC
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))

-- view 0 riskmodel: riskmodel:panels · msk_chord_2024
SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes
FROM snapshot_db.gene_panel_to_gene_derived pg
WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'MUTATION_EXTENDED')
GROUP BY panel

-- view 0 riskmodel: riskmodel:panels · msk_chord_2024
SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes
FROM snapshot_db.gene_panel_to_gene_derived pg
WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'MUTATION_EXTENDED')
GROUP BY panel

-- view 0 riskmodel: riskmodel:rows · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status,
         cityHash64(concat('cohort-lab-split-v1:msk_chord_2024:', replaceOne(patient_unique_id, 'msk_chord_2024_', ''))) % 2 AS half
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
panels AS (
  SELECT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
)
SELECT os.months AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), NULL) = 1, 1, 0) AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes
FROM os
  LEFT JOIN panels ON panels.pid = os.pid
  LEFT JOIN mut ON mut.pid = os.pid
WHERE os.months IS NOT NULL AND os.months > 0
ORDER BY os.pid

-- view 0 riskmodel: riskmodel:table1 · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name='OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name='OS_MONTHS'))), NULL), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status,
         cityHash64(concat('cohort-lab-split-v1:msk_chord_2024:', replaceOne(patient_unique_id, 'msk_chord_2024_', ''))) % 2 AS half
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
panels AS (
  SELECT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
descr AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         argMinIf(lowerUTF8(trimBoth(attribute_value)), sample_unique_id, attribute_name = 'STAGE_HIGHEST_RECORDED') AS d0, argMinIf(attribute_value, sample_unique_id, attribute_name = 'STAGE_HIGHEST_RECORDED') AS r0, uniqExactIf(lowerUTF8(trimBoth(attribute_value)), attribute_name = 'STAGE_HIGHEST_RECORDED') AS u0,
         argMinIf(lowerUTF8(trimBoth(attribute_value)), sample_unique_id, attribute_name = 'GENDER') AS d1, argMinIf(attribute_value, sample_unique_id, attribute_name = 'GENDER') AS r1, uniqExactIf(lowerUTF8(trimBoth(attribute_value)), attribute_name = 'GENDER') AS u1,
         argMinIf(lowerUTF8(trimBoth(attribute_value)), sample_unique_id, attribute_name = 'SMOKING_PREDICTIONS_3_CLASSES') AS d2, argMinIf(attribute_value, sample_unique_id, attribute_name = 'SMOKING_PREDICTIONS_3_CLASSES') AS r2, uniqExactIf(lowerUTF8(trimBoth(attribute_value)), attribute_name = 'SMOKING_PREDICTIONS_3_CLASSES') AS u2,
         argMinIf(lowerUTF8(trimBoth(attribute_value)), sample_unique_id, attribute_name = 'CURRENT_AGE_DEID') AS d3, argMinIf(attribute_value, sample_unique_id, attribute_name = 'CURRENT_AGE_DEID') AS r3, uniqExactIf(lowerUTF8(trimBoth(attribute_value)), attribute_name = 'CURRENT_AGE_DEID') AS u3
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND attribute_name IN ('STAGE_HIGHEST_RECORDED','GENDER','SMOKING_PREDICTIONS_3_CLASSES','CURRENT_AGE_DEID') AND trimBoth(attribute_value) != ''
    AND ((type = 'sample' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)) OR (type = 'patient' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)))
  GROUP BY pid
)
SELECT os.months AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(os.status, ''))[1])), NULL) = 1, 1, 0) AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes, descr.d0 AS d0, descr.r0 AS r0, descr.u0 AS u0, descr.d1 AS d1, descr.r1 AS r1, descr.u1 AS u1, descr.d2 AS d2, descr.r2 AS r2, descr.u2 AS u2, descr.d3 AS d3, descr.r3 AS r3, descr.u3 AS u3
FROM os
  LEFT JOIN panels ON panels.pid = os.pid
  LEFT JOIN mut ON mut.pid = os.pid
  LEFT JOIN descr ON descr.pid = os.pid
WHERE os.months IS NOT NULL AND os.months > 0
ORDER BY os.pid

-- view 0 riskmodel: riskmodel:table1-attributes · msk_chord_2024
SELECT m.attr_id AS id, m.display_name AS name, m.datatype AS datatype, m.patient_attribute AS patient, toInt32OrZero(m.priority) AS priority
FROM snapshot_db.clinical_attribute_meta m
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = m.cancer_study_id
WHERE cs.cancer_study_identifier = 'msk_chord_2024'
ORDER BY priority DESC, name
