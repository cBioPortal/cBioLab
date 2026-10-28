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

-- view 0 cooccurrence: pairCounts · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
altered AS (
  SELECT DISTINCT g.hugo_gene_symbol AS gene, replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS sid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol IN ('EGFR','KRAS','TP53','STK11','KEAP1','ALK') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') AS sid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('EGFR','KRAS','TP53','STK11','KEAP1','ALK')
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
pp AS (
  SELECT sid,
         groupUniqArrayIf(gene, k = 1) AS alt,
         groupUniqArrayIf(gene, k = 0) AS cov
  FROM (SELECT gene, sid, 1 AS k FROM altered UNION ALL SELECT gene, sid, 0 AS k FROM covered)
  GROUP BY sid
)
SELECT ga, gb,
       countIf(has(cov, ga) AND has(cov, gb)) AS profiled,
       countIf(has(cov, ga) AND has(cov, gb) AND has(alt, ga) AND has(alt, gb)) AS both,
       countIf(has(cov, ga) AND has(cov, gb) AND has(alt, ga) AND NOT has(alt, gb)) AS only_a,
       countIf(has(cov, ga) AND has(cov, gb) AND NOT has(alt, ga) AND has(alt, gb)) AS only_b
FROM pp
ARRAY JOIN ['EGFR','EGFR','EGFR','EGFR','EGFR','KRAS','KRAS','KRAS','KRAS','TP53','TP53','TP53','STK11','STK11','KEAP1'] AS ga, ['KRAS','TP53','STK11','KEAP1','ALK','TP53','STK11','KEAP1','ALK','STK11','KEAP1','ALK','KEAP1','ALK','ALK'] AS gb
GROUP BY ga, gb
