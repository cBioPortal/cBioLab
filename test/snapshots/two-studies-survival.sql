-- cohort TP53 mut
-- msk_chord_2024
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient overlap across studies is not deduplicated.

-- msk_met_2021
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))

-- cohort TP53 wt
-- msk_chord_2024
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53')))

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient overlap across studies is not deduplicated.

-- msk_met_2021
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_met_2021_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_met_2021')
EXCEPT DISTINCT
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_met_2021' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53')))

-- view 0 survival: survivalCounts:OS · msk_chord_2024
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m

-- view 0 survival: survivalCounts:OS · msk_chord_2024
WITH cohort AS (((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53')))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m

-- view 0 survival: survivalCounts:OS · msk_met_2021
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_met_2021_', '') AS pid,
         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_met_2021' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m

-- view 0 survival: survivalCounts:OS · msk_met_2021
WITH cohort AS (((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_met_2021_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_met_2021')
EXCEPT DISTINCT
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_met_2021' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53')))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_met_2021_', '') AS pid,
         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_met_2021' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m
