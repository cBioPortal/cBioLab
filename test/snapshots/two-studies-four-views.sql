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

-- view 0 compare: geneCounts · msk_chord_2024
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
altered AS (
  SELECT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.variant_type AS vtype,
         max(ann.is_driver) AS is_driver
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY gene, pid, vtype
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid,
         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',
                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
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

-- view 0 compare: geneCounts · msk_chord_2024
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
altered AS (
  SELECT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.variant_type AS vtype,
         max(ann.is_driver) AS is_driver
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY gene, pid, vtype
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid,
         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',
                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
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

-- view 0 compare: geneCounts · msk_met_2021
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
altered AS (
  SELECT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid, g.variant_type AS vtype,
         max(ann.is_driver) AS is_driver
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
  GROUP BY gene, pid, vtype
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') AS pid,
         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',
                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_met_2021'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
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

-- view 0 compare: geneCounts · msk_met_2021
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
altered AS (
  SELECT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid, g.variant_type AS vtype,
         max(ann.is_driver) AS is_driver
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
  GROUP BY gene, pid, vtype
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') AS pid,
         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',
                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('KRAS','PIK3CA','APC','EGFR','CDKN2A')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_met_2021'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
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

-- view 1 survival: survivalCounts:OS · msk_chord_2024
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

-- view 1 survival: survivalCounts:OS · msk_chord_2024
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

-- view 1 survival: survivalCounts:OS · msk_met_2021
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

-- view 1 survival: survivalCounts:OS · msk_met_2021
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

-- view 2 clinical: clinicalMoments · msk_chord_2024
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx
FROM (
  SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name IN ('CURRENT_AGE_DEID','TMB_NONSYNONYMOUS','FRACTION_GENOME_ALTERED')
    AND attribute_value != ''
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
)
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per

-- view 2 clinical: clinicalMoments · msk_chord_2024
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
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))
SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx
FROM (
  SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name IN ('CURRENT_AGE_DEID','TMB_NONSYNONYMOUS','FRACTION_GENOME_ALTERED')
    AND attribute_value != ''
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
)
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per

-- view 2 clinical: clinicalMoments · msk_met_2021
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))
SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx
FROM (
  SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_met_2021'
    AND attribute_name IN ('TMB_NONSYNONYMOUS','FRACTION_GENOME_ALTERED')
    AND attribute_value != ''
    AND replaceOne(patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
)
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per

-- view 2 clinical: clinicalMoments · msk_met_2021
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
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))
SELECT a, per, count() AS n, sum(x) AS sx, sum(x * x) AS sxx, min(x) AS mn, max(x) AS mx
FROM (
  SELECT attribute_name AS a, type AS per, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS x
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_met_2021'
    AND attribute_name IN ('TMB_NONSYNONYMOUS','FRACTION_GENOME_ALTERED')
    AND attribute_value != ''
    AND replaceOne(patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
)
WHERE x IS NOT NULL AND isFinite(x)
GROUP BY a, per

-- view 3 cooccurrence: pairCounts · msk_chord_2024
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
altered AS (
  SELECT DISTINCT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol IN ('TP53','KRAS','PIK3CA','APC') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('TP53','KRAS','PIK3CA','APC')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
pp AS (
  SELECT pid,
         groupUniqArrayIf(gene, k = 1) AS alt,
         groupUniqArrayIf(gene, k = 0) AS cov
  FROM (SELECT gene, pid, 1 AS k FROM altered UNION ALL SELECT gene, pid, 0 AS k FROM covered)
  GROUP BY pid
)
SELECT ga, gb,
       countIf(has(cov, ga) AND has(cov, gb)) AS profiled,
       countIf(has(cov, ga) AND has(cov, gb) AND has(alt, ga) AND has(alt, gb)) AS both,
       countIf(has(cov, ga) AND has(cov, gb) AND has(alt, ga) AND NOT has(alt, gb)) AS only_a,
       countIf(has(cov, ga) AND has(cov, gb) AND NOT has(alt, ga) AND has(alt, gb)) AS only_b
FROM pp
ARRAY JOIN ['TP53','TP53','TP53','KRAS','KRAS','PIK3CA'] AS ga, ['KRAS','PIK3CA','APC','PIK3CA','APC','APC'] AS gb
GROUP BY ga, gb

-- view 3 cooccurrence: pairCounts · msk_met_2021
WITH cohort AS (((SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))),
altered AS (
  SELECT DISTINCT g.hugo_gene_symbol AS gene, replaceOne(g.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_met_2021'
    AND g.hugo_gene_symbol IN ('TP53','KRAS','PIK3CA','APC') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND replaceOne(g.patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('TP53','KRAS','PIK3CA','APC')
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_met_2021' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_met_2021_', '') IN (SELECT pid FROM cohort)
),
pp AS (
  SELECT pid,
         groupUniqArrayIf(gene, k = 1) AS alt,
         groupUniqArrayIf(gene, k = 0) AS cov
  FROM (SELECT gene, pid, 1 AS k FROM altered UNION ALL SELECT gene, pid, 0 AS k FROM covered)
  GROUP BY pid
)
SELECT ga, gb,
       countIf(has(cov, ga) AND has(cov, gb)) AS profiled,
       countIf(has(cov, ga) AND has(cov, gb) AND has(alt, ga) AND has(alt, gb)) AS both,
       countIf(has(cov, ga) AND has(cov, gb) AND has(alt, ga) AND NOT has(alt, gb)) AS only_a,
       countIf(has(cov, ga) AND has(cov, gb) AND NOT has(alt, ga) AND has(alt, gb)) AS only_b
FROM pp
ARRAY JOIN ['TP53','TP53','TP53','KRAS','KRAS','PIK3CA'] AS ga, ['KRAS','PIK3CA','APC','PIK3CA','APC','APC'] AS gb
GROUP BY ga, gb
