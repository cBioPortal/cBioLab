-- cohort all patients
-- lung_msk_pdx
SELECT replaceOne(patient_unique_id, 'lung_msk_pdx_', '') AS pid, replaceOne(sample_unique_id, 'lung_msk_pdx_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lung_msk_pdx'

-- view 0 acquired: acquired:funnel:all patients · lung_msk_pdx
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lung_msk_pdx_', '') AS pid, replaceOne(sample_unique_id, 'lung_msk_pdx_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lung_msk_pdx'),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'lung_msk_pdx' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Systemic therapy')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
tl AS (
  SELECT p.stable_id AS pid, d.value AS sample, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(d.key)) = lowerUTF8(trimBoth('SAMPLE_ID'))
  WHERE cs.cancer_study_identifier = 'lung_msk_pdx' AND lowerUTF8(trimBoth(ce.event_type)) IN (lowerUTF8(trimBoth('Sample acquisition')), lowerUTF8(trimBoth('Sequencing')), lowerUTF8(trimBoth('Specimen')))
    AND p.stable_id IN (SELECT pid FROM anch)
  GROUP BY pid, sample
),
dated AS (
  SELECT tl.pid AS pid, sd.sample_unique_id AS suid, tl.day - anch.day AS rel
  FROM tl INNER JOIN anch ON anch.pid = tl.pid
  INNER JOIN snapshot_db.sample_derived sd ON sd.cancer_study_identifier = 'lung_msk_pdx' AND sd.sample_stable_id = tl.sample AND sd.patient_stable_id = tl.pid
  WHERE sd.sample_stable_id IN (SELECT sid FROM cohort)
),
pick AS (
  SELECT pid, countIf(rel <= 0) AS n_pre, countIf(rel >= 30) AS n_post,
         argMaxIf(suid, (rel, suid), rel <= 0) AS pre, argMinIf(suid, (rel, suid), rel >= 30) AS post,
         maxIf(rel, rel <= 0) AS pre_rel, minIf(rel, rel >= 30) AS post_rel
  FROM dated GROUP BY pid
),
ps AS (
  SELECT pre AS suid, pid, 'a' AS side FROM pick WHERE n_pre > 0 AND n_post > 0
  UNION ALL SELECT post AS suid, pid, 'b' AS side FROM pick WHERE n_pre > 0 AND n_post > 0
)
SELECT (SELECT count() FROM anch) AS anchored, (SELECT uniqExact(pid) FROM tl) AS with_events, count() AS dated,
       countIf(n_pre > 0) AS with_pre, countIf(n_post > 0) AS with_post, countIf(n_pre > 0 AND n_post > 0) AS paired,
       quantileExactIf(0.5)(-pre_rel, n_pre > 0 AND n_post > 0) AS pre_median, quantileExactIf(0.5)(post_rel, n_pre > 0 AND n_post > 0) AS post_median,
       quantileExactIf(0.25)(post_rel - pre_rel, n_pre > 0 AND n_post > 0) AS gap_q1, quantileExactIf(0.5)(post_rel - pre_rel, n_pre > 0 AND n_post > 0) AS gap_median,
       quantileExactIf(0.75)(post_rel - pre_rel, n_pre > 0 AND n_post > 0) AS gap_q3
FROM pick

-- view 0 acquired: acquired:genes:all patients · lung_msk_pdx
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lung_msk_pdx_', '') AS pid, replaceOne(sample_unique_id, 'lung_msk_pdx_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lung_msk_pdx'),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'lung_msk_pdx' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Systemic therapy')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
tl AS (
  SELECT p.stable_id AS pid, d.value AS sample, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(d.key)) = lowerUTF8(trimBoth('SAMPLE_ID'))
  WHERE cs.cancer_study_identifier = 'lung_msk_pdx' AND lowerUTF8(trimBoth(ce.event_type)) IN (lowerUTF8(trimBoth('Sample acquisition')), lowerUTF8(trimBoth('Sequencing')), lowerUTF8(trimBoth('Specimen')))
    AND p.stable_id IN (SELECT pid FROM anch)
  GROUP BY pid, sample
),
dated AS (
  SELECT tl.pid AS pid, sd.sample_unique_id AS suid, tl.day - anch.day AS rel
  FROM tl INNER JOIN anch ON anch.pid = tl.pid
  INNER JOIN snapshot_db.sample_derived sd ON sd.cancer_study_identifier = 'lung_msk_pdx' AND sd.sample_stable_id = tl.sample AND sd.patient_stable_id = tl.pid
  WHERE sd.sample_stable_id IN (SELECT sid FROM cohort)
),
pick AS (
  SELECT pid, countIf(rel <= 0) AS n_pre, countIf(rel >= 30) AS n_post,
         argMaxIf(suid, (rel, suid), rel <= 0) AS pre, argMinIf(suid, (rel, suid), rel >= 30) AS post,
         maxIf(rel, rel <= 0) AS pre_rel, minIf(rel, rel >= 30) AS post_rel
  FROM dated GROUP BY pid
),
ps AS (
  SELECT pre AS suid, pid, 'a' AS side FROM pick WHERE n_pre > 0 AND n_post > 0
  UNION ALL SELECT post AS suid, pid, 'b' AS side FROM pick WHERE n_pre > 0 AND n_post > 0
),
alt AS (
  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, max(ann.is_driver) AS hit
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, is_driver FROM oncokb_annotation.variant_annotation
      WHERE oncokb_version = 'v7.5' AND is_driver) ann
    ON ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ann.alteration_type = multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', '')
   AND ann.alteration = multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')
  INNER JOIN ps ON ps.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'lung_msk_pdx' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'lung_msk_pdx'
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
