-- cohort TP53 mutant
-- msk_chord_2024
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))

-- cohort KRAS mutant
-- msk_chord_2024
((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))

-- cohort Immunotherapy
-- msk_chord_2024
(WITH
study_patients AS (
  SELECT p.internal_id FROM snapshot_db.patient p
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
),
sel_a AS (
SELECT ce.patient_id, ce.start_date, ce.stop_date
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.clinical_event_data a0 ON a0.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(a0.key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(a0.value)) = lowerUTF8(trimBoth('Immuno'))
  WHERE lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.patient_id IN (SELECT internal_id FROM study_patients)
)
SELECT DISTINCT p.stable_id AS pid
FROM sel_a
  JOIN snapshot_db.patient p ON p.internal_id = sel_a.patient_id
WHERE 1
ORDER BY pid LIMIT 1000000)

-- cohort NSCLC
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))

-- view 0 overlap: overlap · msk_chord_2024
WITH c0 AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
c1 AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
c2 AS ((WITH
study_patients AS (
  SELECT p.internal_id FROM snapshot_db.patient p
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
),
sel_a AS (
SELECT ce.patient_id, ce.start_date, ce.stop_date
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.clinical_event_data a0 ON a0.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(a0.key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(a0.value)) = lowerUTF8(trimBoth('Immuno'))
  WHERE lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.patient_id IN (SELECT internal_id FROM study_patients)
)
SELECT DISTINCT p.stable_id AS pid
FROM sel_a
  JOIN snapshot_db.patient p ON p.internal_id = sel_a.patient_id
WHERE 1
ORDER BY pid LIMIT 1000000)),
c3 AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))),
u AS (SELECT pid FROM c0 UNION DISTINCT SELECT pid FROM c1 UNION DISTINCT SELECT pid FROM c2 UNION DISTINCT SELECT pid FROM c3),
m AS (SELECT pid, (pid IN (SELECT pid FROM c0)) * 1 + (pid IN (SELECT pid FROM c1)) * 2 + (pid IN (SELECT pid FROM c2)) * 4 + (pid IN (SELECT pid FROM c3)) * 8 AS mask FROM u),
s AS (SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, count() AS ns FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM u) GROUP BY pid)
SELECT mask, count() AS n, sum(s.ns) AS samples FROM m LEFT JOIN s ON s.pid = m.pid GROUP BY mask ORDER BY n DESC
