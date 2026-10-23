-- cohort NSCLC
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))

-- view 0 predictive: predictive:panels · msk_chord_2024
SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes
FROM snapshot_db.gene_panel_to_gene_derived pg
WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'MUTATION_EXTENDED')
GROUP BY panel

-- view 0 predictive: predictive:rows · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))),
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
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day, 1 AS hit
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data
        WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Immuno')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, os.half AS half, panels.panels AS panels, mut.genes AS genes, anch.hit AS anchored, round(anch.day / 30.4375, 4) AS anchor_months
FROM os
  LEFT JOIN panels ON panels.pid = os.pid
  LEFT JOIN mut ON mut.pid = os.pid
  LEFT JOIN anch ON anch.pid = os.pid
WHERE os.months IS NOT NULL AND os.months > 0
ORDER BY os.pid
