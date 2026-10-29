-- cohort all patients
-- msk_impact_50k_2026
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'

-- view 0 paired: paired:genes:all patients · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Primary'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Metastasis'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'SAMPLE_TYPE'
    AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired)),
alt AS (
  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, max(ann.is_driver) AS hit
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, is_driver FROM oncokb_annotation.variant_annotation
      WHERE oncokb_version = 'v7.5' AND is_driver) ann
    ON ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ann.alteration_type = multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', '')
   AND ann.alteration = multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')
  INNER JOIN ps ON ps.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_impact_50k_2026' AND g.hugo_gene_symbol IN ('TP53','KRAS','PIK3CA','ESR1','AR','CDKN2A','MYC','TERT') AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('TP53','KRAS','PIK3CA','ESR1','AR','CDKN2A','MYC','TERT')
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene

-- view 0 paired: paired:patients:all patients · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Primary'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Metastasis'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'SAMPLE_TYPE'
    AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))
SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps
