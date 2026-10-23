-- cohort Well-diff liposarcoma
-- sarcoma_msk_2022
(SELECT DISTINCT replaceOne(patient_unique_id, 'sarcoma_msk_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'sarcoma_msk_2022' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE_DETAILED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Well-Differentiated Liposarcoma'))))

-- view 0 compare: geneCounts · sarcoma_msk_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'sarcoma_msk_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'sarcoma_msk_2022' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE_DETAILED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Well-Differentiated Liposarcoma'))))),
altered AS (
  SELECT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'sarcoma_msk_2022_', '') AS pid, g.variant_type AS vtype,
         max(ann.is_driver) AS is_driver
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'sarcoma_msk_2022'
    AND g.hugo_gene_symbol IN ('MDM2','TP53') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'sarcoma_msk_2022_', '') IN (SELECT pid FROM cohort)
  GROUP BY gene, pid, vtype
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'sarcoma_msk_2022_', '') AS pid,
         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',
                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('MDM2','TP53')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'sarcoma_msk_2022'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sd.patient_unique_id, 'sarcoma_msk_2022_', '') IN (SELECT pid FROM cohort)
),
raw AS (
  SELECT gene, pid, vtype, max(is_alt) AS is_alt, max(is_drv) AS is_drv
  FROM (
    SELECT gene, pid, vtype, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered
    UNION ALL
    SELECT gene, pid, vtype, 0 AS is_alt, 0 AS is_drv FROM covered
  )
  GROUP BY gene, pid, vtype
),
perPatient AS (
  SELECT gene, pid, max(is_alt) AS is_alt, max(is_drv) AS is_drv
  FROM raw GROUP BY gene, pid
)
SELECT gene, vtype,
       uniqExact(pid) AS profiled, uniqExactIf(pid, is_alt = 1) AS altered, uniqExactIf(pid, is_drv = 1) AS driver
FROM raw GROUP BY gene, vtype
UNION ALL
SELECT gene, 'any' AS vtype,
       uniqExact(pid) AS profiled, uniqExactIf(pid, is_alt = 1) AS altered, uniqExactIf(pid, is_drv = 1) AS driver
FROM perPatient GROUP BY gene
