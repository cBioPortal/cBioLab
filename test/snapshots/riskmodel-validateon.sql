-- cohort NSCLC (MSK-IMPACT 2017)
-- msk_impact_2017
(SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))

-- cohort NSCLC (MSK-CHORD)
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

-- view 0 riskmodel: riskmodel:panels · msk_impact_2017
SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes
FROM snapshot_db.gene_panel_to_gene_derived pg
WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_2017' AND alteration_type = 'MUTATION_EXTENDED')
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
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name='OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name='OS_MONTHS')), NULL) AS months,
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
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
)
SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes
FROM os
  LEFT JOIN panels ON panels.pid = os.pid
  LEFT JOIN mut ON mut.pid = os.pid
WHERE os.months IS NOT NULL AND os.months > 0
ORDER BY os.pid

-- view 0 riskmodel: riskmodel:rows · msk_impact_2017
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name='OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name='OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status,
         cityHash64(concat('cohort-lab-split-v1:msk_impact_2017:', replaceOne(patient_unique_id, 'msk_impact_2017_', ''))) % 2 AS half
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_2017' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_impact_2017_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
panels AS (
  SELECT replaceOne(sd.patient_unique_id, 'msk_impact_2017_', '') AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_2017' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_impact_2017_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'msk_impact_2017_', '') AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_impact_2017' AND g.variant_type = 'mutation' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.sample_unique_id, 'msk_impact_2017_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
)
SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes
FROM os
  LEFT JOIN panels ON panels.pid = os.pid
  LEFT JOIN mut ON mut.pid = os.pid
WHERE os.months IS NOT NULL AND os.months > 0
ORDER BY os.pid
