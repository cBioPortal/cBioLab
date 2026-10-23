-- cohort all patients
-- nsclc_ctdx_msk_2022
SELECT DISTINCT replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022'

-- view 0 ctdna: ctdna:funnel:all patients · nsclc_ctdx_msk_2022
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') IN (SELECT pid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND sd.patient_stable_id IN (SELECT pid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
det AS (
  SELECT DISTINCT s.pid AS pid FROM snapshot_db.genomic_event_derived g
  INNER JOIN sides s ON s.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND s.side = 'b' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
)
SELECT (SELECT uniqExactIf(pid, side = 'b') FROM classed) AS plasma_all, (SELECT uniqExactIf(pid, side = 'a') FROM classed) AS tissue_all,
       (SELECT uniqExactIf(pid, side = 'b') FROM sides) AS plasma, (SELECT uniqExactIf(pid, side = 'a') FROM sides) AS tissue,
       (SELECT count() FROM paired) AS both, (SELECT count() FROM det) AS detected,
       (SELECT countIf(side = 'b') FROM ps) AS plasma_samples, (SELECT countIf(side = 'a') FROM ps) AS tissue_samples,
       toUInt64(0) AS dated_samples
FROM system.one

-- view 0 ctdna: ctdna:genes:all patients · nsclc_ctdx_msk_2022
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') IN (SELECT pid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND sd.patient_stable_id IN (SELECT pid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
alt AS (
  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, 1 AS hit
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN ps ON ps.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND g.hugo_gene_symbol IN ('EGFR','KRAS','TP53','STK11','KEAP1','PIK3CA','BRAF','MET','ERBB2','ALK') AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('EGFR','KRAS','TP53','STK11','KEAP1','PIK3CA','BRAF','MET','ERBB2','ALK')
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'nsclc_ctdx_msk_2022'
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

-- view 0 ctdna: ctdna:survival:all patients · nsclc_ctdx_msk_2022
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') IN (SELECT pid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND sd.patient_stable_id IN (SELECT pid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
det AS (
  SELECT DISTINCT s.pid AS pid FROM snapshot_db.genomic_event_derived g
  INNER JOIN sides s ON s.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND s.side = 'b' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
),
os AS (
  SELECT replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') AS pid, if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead, replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') IN (SELECT pid FROM det) AS detected
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'nsclc_ctdx_msk_2022' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'nsclc_ctdx_msk_2022_', '') IN (SELECT pid FROM sides WHERE side = 'b')
  GROUP BY pid
)
SELECT detected, round(months, 2) AS t, dead, count() AS n
FROM os WHERE months IS NOT NULL AND months >= 0 GROUP BY detected, t, dead ORDER BY t
