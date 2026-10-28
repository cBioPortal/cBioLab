-- cohort UCEC
-- ucec_tcga_pan_can_atlas_2018
SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018'

-- view 0 molsubtype: molsubtype:counts:UCEC · ucec_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018'),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED' AND replaceOne(sp.sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
),
cov AS (
  SELECT pp.pid AS pid, max(pp.panel = 'WES' OR gp.gene = 'POLE') AS pole, max(pp.panel = 'WES' OR gp.gene = 'TP53') AS tp53
  FROM pp LEFT JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel AND gp.gene IN ('POLE', 'TP53')
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid,
         max(g.hugo_gene_symbol = 'POLE' AND g.mutation_variant IN ('P286R', 'S297F', 'F367S', 'F367V', 'V411L', 'L424I', 'L424V', 'P436R', 'M444K', 'A456P', 'S459F', 'M295R', 'D368Y')) AS pole_hot,
         max(g.hugo_gene_symbol = 'TP53' AND ann.is_driver) AS p53
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND lowerUTF8(g.mutation_status) != 'germline' AND NOT g.off_panel AND g.hugo_gene_symbol IN ('POLE', 'TP53')
    AND replaceOne(g.sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
msi AS (
  SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, max(multiIf(if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) IS NULL OR if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) < 0, 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) >= 10, 2, if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) < 3, 1, 0)) AS m
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND attribute_name = 'MSI_SENSOR_SCORE' AND (type = 'sample' AND replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
),
cls AS (
  SELECT c.pid AS pid,
         multiIf(cov.pid = '', 'NC', mut.pole_hot = 1, 'POLEmut', cov.pole = 0, 'NC', msi.m = 2, 'MMRd', msi.m = 0, 'NC', cov.tp53 = 0, 'NC', mut.p53 = 1, 'p53abn', 'NSMP') AS cls,
         multiIf(cov.pid = '', 'not sequenced', mut.pole_hot = 1, '', cov.pole = 0, 'not profiled for POLE', msi.m = 2, '', msi.m = 0, 'no MSI call', cov.tp53 = 0, 'not profiled for TP53', '') AS why
  FROM (SELECT DISTINCT pid FROM cohort) c
  LEFT JOIN cov ON cov.pid = c.pid LEFT JOIN mut ON mut.pid = c.pid LEFT JOIN msi ON msi.pid = c.pid
),
grp AS (
  SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, if(uniqExact(lowerUTF8(trimBoth(attribute_value))) > 1, 'Multiple', any(trimBoth(attribute_value))) AS g
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND attribute_name = 'SUBTYPE' AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
)
SELECT cls.cls AS cls, cls.why AS why, grp.g AS grp, count() AS n FROM cls LEFT JOIN grp ON grp.pid = cls.pid GROUP BY cls, why, grp

-- view 0 molsubtype: molsubtype:msi-attributes · ucec_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018')
SELECT attribute_name AS attribute, uniqExact(replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '')) AS patients, uniqExact(attribute_value) AS nvalues, arraySort(groupUniqArray(8)(attribute_value)) AS examples
FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND positionCaseInsensitive(attribute_name, 'MSI') > 0 AND trimBoth(attribute_value) != ''
  AND (type = 'sample' AND replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort))
GROUP BY attribute ORDER BY patients DESC

-- view 0 molsubtype: molsubtype:survival:UCEC · ucec_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018'),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED' AND replaceOne(sp.sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
),
cov AS (
  SELECT pp.pid AS pid, max(pp.panel = 'WES' OR gp.gene = 'POLE') AS pole, max(pp.panel = 'WES' OR gp.gene = 'TP53') AS tp53
  FROM pp LEFT JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel AND gp.gene IN ('POLE', 'TP53')
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid,
         max(g.hugo_gene_symbol = 'POLE' AND g.mutation_variant IN ('P286R', 'S297F', 'F367S', 'F367V', 'V411L', 'L424I', 'L424V', 'P436R', 'M444K', 'A456P', 'S459F', 'M295R', 'D368Y')) AS pole_hot,
         max(g.hugo_gene_symbol = 'TP53' AND ann.is_driver) AS p53
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND lowerUTF8(g.mutation_status) != 'germline' AND NOT g.off_panel AND g.hugo_gene_symbol IN ('POLE', 'TP53')
    AND replaceOne(g.sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
msi AS (
  SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, max(multiIf(if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) IS NULL OR if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) < 0, 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) >= 10, 2, if(isFinite(ifNull(toFloat64OrNull(trimBoth(attribute_value)), nan)), toFloat64OrNull(trimBoth(attribute_value)), NULL) < 3, 1, 0)) AS m
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND attribute_name = 'MSI_SENSOR_SCORE' AND (type = 'sample' AND replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
),
cls AS (
  SELECT c.pid AS pid,
         multiIf(cov.pid = '', 'NC', mut.pole_hot = 1, 'POLEmut', cov.pole = 0, 'NC', msi.m = 2, 'MMRd', msi.m = 0, 'NC', cov.tp53 = 0, 'NC', mut.p53 = 1, 'p53abn', 'NSMP') AS cls,
         multiIf(cov.pid = '', 'not sequenced', mut.pole_hot = 1, '', cov.pole = 0, 'not profiled for POLE', msi.m = 2, '', msi.m = 0, 'no MSI call', cov.tp53 = 0, 'not profiled for TP53', '') AS why
  FROM (SELECT DISTINCT pid FROM cohort) c
  LEFT JOIN cov ON cov.pid = c.pid LEFT JOIN mut ON mut.pid = c.pid LEFT JOIN msi ON msi.pid = c.pid
),
grp AS (
  SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, if(uniqExact(lowerUTF8(trimBoth(attribute_value))) > 1, 'Multiple', any(trimBoth(attribute_value))) AS g
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND attribute_name = 'SUBTYPE' AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
),
os AS (
  SELECT replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') AS pid, if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL), NULL) AS months,
         if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), NULL) = 1, 1, 0) AS dead
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'ucec_tcga_pan_can_atlas_2018' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'ucec_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT cls.cls AS cls, round(os.months, 2) AS t, os.dead AS dead, count() AS n
FROM cls INNER JOIN os ON os.pid = cls.pid WHERE os.months IS NOT NULL AND os.months >= 0 AND cls.cls != 'NC' GROUP BY cls, t, dead ORDER BY t
