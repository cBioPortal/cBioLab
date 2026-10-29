-- cohort all patients
-- msk_impact_50k_2026
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'

-- view 0 actionability: actionability:concordance:all patients · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
seq AS (
  SELECT DISTINCT sp.sample_unique_id AS sid, replaceOne(sd.patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
lv AS (
  SELECT g.sample_unique_id AS sid, min(multiIf(ann.highest_sensitive_level = 'LEVEL_1', 1, ann.highest_sensitive_level = 'LEVEL_2', 2, ann.highest_sensitive_level = 'LEVEL_3A', 3, ann.highest_sensitive_level = 'LEVEL_3B', 4, ann.highest_sensitive_level = 'LEVEL_4', 5, 9)) AS s,
         min(multiIf(ann.highest_resistance_level = 'LEVEL_R1', 1, ann.highest_resistance_level = 'LEVEL_R2', 2, 9)) AS r
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, highest_sensitive_level, highest_resistance_level
      FROM oncokb_annotation.variant_annotation
      WHERE oncokb_version = 'v7.5' AND (highest_sensitive_level != '' OR highest_resistance_level != '')) ann
    ON ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ann.alteration_type = multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', '')
   AND ann.alteration = multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')
  WHERE g.cancer_study_identifier = 'msk_impact_50k_2026'
    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')
    AND g.sample_unique_id IN (SELECT sid FROM seq)
  GROUP BY sid
),
st AS (
  SELECT sample_unique_id AS sid, multiIf(lower(trimBoth(attribute_value)) IN ('primary'), 'a', lower(trimBoth(attribute_value)) IN ('metastasis'), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'SAMPLE_TYPE'
    AND sample_unique_id IN (SELECT sid FROM seq)
),
ps AS (
  SELECT seq.pid AS pid, minIf(if(lv.s = 0, 9, lv.s), st.side = 'a') AS sa, minIf(if(lv.s = 0, 9, lv.s), st.side = 'b') AS sb,
         countIf(st.side = 'a') AS na, countIf(st.side = 'b') AS nb
  FROM seq INNER JOIN st ON st.sid = seq.sid LEFT JOIN lv ON lv.sid = seq.sid
  GROUP BY pid
  HAVING na > 0 AND nb > 0
)
SELECT sa AS a, sb AS b, count() AS n FROM ps GROUP BY a, b

-- view 0 actionability: actionability:levels:all patients · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
seq AS (
  SELECT DISTINCT sp.sample_unique_id AS sid, replaceOne(sd.patient_unique_id, 'msk_impact_50k_2026_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
lv AS (
  SELECT g.sample_unique_id AS sid, min(multiIf(ann.highest_sensitive_level = 'LEVEL_1', 1, ann.highest_sensitive_level = 'LEVEL_2', 2, ann.highest_sensitive_level = 'LEVEL_3A', 3, ann.highest_sensitive_level = 'LEVEL_3B', 4, ann.highest_sensitive_level = 'LEVEL_4', 5, 9)) AS s,
         min(multiIf(ann.highest_resistance_level = 'LEVEL_R1', 1, ann.highest_resistance_level = 'LEVEL_R2', 2, 9)) AS r
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, highest_sensitive_level, highest_resistance_level
      FROM oncokb_annotation.variant_annotation
      WHERE oncokb_version = 'v7.5' AND (highest_sensitive_level != '' OR highest_resistance_level != '')) ann
    ON ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ann.alteration_type = multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', '')
   AND ann.alteration = multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')
  WHERE g.cancer_study_identifier = 'msk_impact_50k_2026'
    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')
    AND g.sample_unique_id IN (SELECT sid FROM seq)
  GROUP BY sid
),
pl AS (
  SELECT seq.pid AS pid, min(if(lv.s = 0, 9, lv.s)) AS s, min(if(lv.r = 0, 9, lv.r)) AS r
  FROM seq LEFT JOIN lv ON lv.sid = seq.sid
  GROUP BY pid
),
grp AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, if(uniqExact(attribute_value) > 1, 'Multiple', any(attribute_value)) AS g
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name = 'CANCER_TYPE' AND trimBoth(attribute_value) != ''
    AND if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
)
SELECT grp.g AS grp, pl.s AS level, pl.r AS resistance, count() AS n
FROM pl LEFT JOIN grp ON grp.pid = pl.pid
GROUP BY grp, level, resistance

-- view 0 actionability: actionability:store · msk_impact_50k_2026
SELECT toString(alteration_type) AS type, count() AS n FROM oncokb_annotation.variant_annotation
WHERE oncokb_version = 'v7.5' AND (highest_sensitive_level != '' OR highest_resistance_level != '')
GROUP BY type
