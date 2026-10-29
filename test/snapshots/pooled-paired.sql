-- cohort before and after treatment
-- egc_msk_2017
SELECT replaceOne(patient_unique_id, 'egc_msk_2017_', '') AS pid, replaceOne(sample_unique_id, 'egc_msk_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'egc_msk_2017'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- breast_alpelisib_2020
SELECT replaceOne(patient_unique_id, 'breast_alpelisib_2020_', '') AS pid, replaceOne(sample_unique_id, 'breast_alpelisib_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'breast_alpelisib_2020'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- egc_trap_ccr_msk_2023
SELECT replaceOne(patient_unique_id, 'egc_trap_ccr_msk_2023_', '') AS pid, replaceOne(sample_unique_id, 'egc_trap_ccr_msk_2023_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'egc_trap_ccr_msk_2023'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- blca_cornell_2016
SELECT replaceOne(patient_unique_id, 'blca_cornell_2016_', '') AS pid, replaceOne(sample_unique_id, 'blca_cornell_2016_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'blca_cornell_2016'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- brca_dldccc_2022
SELECT replaceOne(patient_unique_id, 'brca_dldccc_2022_', '') AS pid, replaceOne(sample_unique_id, 'brca_dldccc_2022_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_dldccc_2022'

-- view 0 paired: paired:genes:before and after treatment · blca_cornell_2016
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'blca_cornell_2016_', '') AS pid, replaceOne(sample_unique_id, 'blca_cornell_2016_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'blca_cornell_2016'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'blca_cornell_2016_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('pre-chemotherapy'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('post-chemotherapy'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'blca_cornell_2016' AND type = 'sample' AND attribute_name = 'SPECIMEN_COLLECTION_PRE_OR_POST_CHEMO'
    AND replaceOne(sample_unique_id, 'blca_cornell_2016_', '') IN (SELECT sid FROM cohort)
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
  WHERE g.cancer_study_identifier = 'blca_cornell_2016' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'blca_cornell_2016'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene HAVING both + a_only + b_only > 0

-- view 0 paired: paired:genes:before and after treatment · brca_dldccc_2022
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_dldccc_2022_', '') AS pid, replaceOne(sample_unique_id, 'brca_dldccc_2022_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_dldccc_2022'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'brca_dldccc_2022_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pre-Treatment'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Post-Treatment'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_dldccc_2022' AND type = 'sample' AND attribute_name = 'TREATMENT_STATUS'
    AND replaceOne(sample_unique_id, 'brca_dldccc_2022_', '') IN (SELECT sid FROM cohort)
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
  WHERE g.cancer_study_identifier = 'brca_dldccc_2022' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_dldccc_2022'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene HAVING both + a_only + b_only > 0

-- view 0 paired: paired:genes:before and after treatment · breast_alpelisib_2020
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'breast_alpelisib_2020_', '') AS pid, replaceOne(sample_unique_id, 'breast_alpelisib_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'breast_alpelisib_2020'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'breast_alpelisib_2020_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('pre-treatment'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('post-treatment'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'breast_alpelisib_2020' AND type = 'sample' AND attribute_name = 'SAMPLE_COLLECTION_TIMEPOINT'
    AND replaceOne(sample_unique_id, 'breast_alpelisib_2020_', '') IN (SELECT sid FROM cohort)
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
  WHERE g.cancer_study_identifier = 'breast_alpelisib_2020' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'breast_alpelisib_2020'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene HAVING both + a_only + b_only > 0

-- view 0 paired: paired:genes:before and after treatment · egc_msk_2017
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'egc_msk_2017_', '') AS pid, replaceOne(sample_unique_id, 'egc_msk_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'egc_msk_2017'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'egc_msk_2017_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('PRE-TX'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('POST-TX'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'egc_msk_2017' AND type = 'sample' AND attribute_name = 'IMPACT_PRE_POST'
    AND replaceOne(sample_unique_id, 'egc_msk_2017_', '') IN (SELECT sid FROM cohort)
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
  WHERE g.cancer_study_identifier = 'egc_msk_2017' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'egc_msk_2017'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene HAVING both + a_only + b_only > 0

-- view 0 paired: paired:genes:before and after treatment · egc_trap_ccr_msk_2023
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'egc_trap_ccr_msk_2023_', '') AS pid, replaceOne(sample_unique_id, 'egc_trap_ccr_msk_2023_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'egc_trap_ccr_msk_2023'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'egc_trap_ccr_msk_2023_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pre'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Post'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'egc_trap_ccr_msk_2023' AND type = 'sample' AND attribute_name = 'PRE_OR_POST_TREATMENT'
    AND replaceOne(sample_unique_id, 'egc_trap_ccr_msk_2023_', '') IN (SELECT sid FROM cohort)
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
  WHERE g.cancer_study_identifier = 'egc_trap_ccr_msk_2023' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'egc_trap_ccr_msk_2023'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene HAVING both + a_only + b_only > 0

-- view 0 paired: paired:patients:before and after treatment · blca_cornell_2016
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'blca_cornell_2016_', '') AS pid, replaceOne(sample_unique_id, 'blca_cornell_2016_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'blca_cornell_2016'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'blca_cornell_2016_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('pre-chemotherapy'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('post-chemotherapy'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'blca_cornell_2016' AND type = 'sample' AND attribute_name = 'SPECIMEN_COLLECTION_PRE_OR_POST_CHEMO'
    AND replaceOne(sample_unique_id, 'blca_cornell_2016_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))
SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps

-- view 0 paired: paired:patients:before and after treatment · brca_dldccc_2022
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_dldccc_2022_', '') AS pid, replaceOne(sample_unique_id, 'brca_dldccc_2022_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_dldccc_2022'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'brca_dldccc_2022_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pre-Treatment'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Post-Treatment'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_dldccc_2022' AND type = 'sample' AND attribute_name = 'TREATMENT_STATUS'
    AND replaceOne(sample_unique_id, 'brca_dldccc_2022_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))
SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps

-- view 0 paired: paired:patients:before and after treatment · breast_alpelisib_2020
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'breast_alpelisib_2020_', '') AS pid, replaceOne(sample_unique_id, 'breast_alpelisib_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'breast_alpelisib_2020'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'breast_alpelisib_2020_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('pre-treatment'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('post-treatment'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'breast_alpelisib_2020' AND type = 'sample' AND attribute_name = 'SAMPLE_COLLECTION_TIMEPOINT'
    AND replaceOne(sample_unique_id, 'breast_alpelisib_2020_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))
SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps

-- view 0 paired: paired:patients:before and after treatment · egc_msk_2017
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'egc_msk_2017_', '') AS pid, replaceOne(sample_unique_id, 'egc_msk_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'egc_msk_2017'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'egc_msk_2017_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('PRE-TX'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('POST-TX'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'egc_msk_2017' AND type = 'sample' AND attribute_name = 'IMPACT_PRE_POST'
    AND replaceOne(sample_unique_id, 'egc_msk_2017_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))
SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps

-- view 0 paired: paired:patients:before and after treatment · egc_trap_ccr_msk_2023
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'egc_trap_ccr_msk_2023_', '') AS pid, replaceOne(sample_unique_id, 'egc_trap_ccr_msk_2023_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'egc_trap_ccr_msk_2023'),
sides AS (
  SELECT sample_unique_id AS suid, replaceOne(patient_unique_id, 'egc_trap_ccr_msk_2023_', '') AS pid,
         multiIf(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pre'))), 'a', lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Post'))), 'b', '') AS side
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'egc_trap_ccr_msk_2023' AND type = 'sample' AND attribute_name = 'PRE_OR_POST_TREATMENT'
    AND replaceOne(sample_unique_id, 'egc_trap_ccr_msk_2023_', '') IN (SELECT sid FROM cohort)
),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE side != '' AND pid IN (SELECT pid FROM paired))
SELECT uniqExact(pid) AS patients, countIf(side = 'a') AS a_samples, countIf(side = 'b') AS b_samples FROM ps
