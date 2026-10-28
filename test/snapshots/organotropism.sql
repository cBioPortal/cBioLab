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

-- view 0 organotropism: organotropism:counts · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
evr AS (
  SELECT DISTINCT p.stable_id AS pid, lowerUTF8(trimBoth(d.value)) AS site, trimBoth(d.value) AS raw
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND lowerUTF8(trimBoth(d.key)) = lowerUTF8(trimBoth('TUMOR_SITE')) AND trimBoth(d.value) != ''
    AND p.stable_id IN (SELECT pid FROM cohort)
),
ev AS (SELECT DISTINCT pid, site FROM evr),
sl AS (SELECT site, min(raw) AS label FROM evr GROUP BY site),
ps AS (
  SELECT e.pid AS pid, s.site AS site, toUInt8((e.pid, s.site) IN (SELECT pid, site FROM ev)) AS has
  FROM (SELECT DISTINCT pid FROM ev) e CROSS JOIN (SELECT site FROM sl) s
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
prof AS (
  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN ('EGFR', 'KRAS', 'TP53', 'STK11', 'KEAP1', 'SMARCA4')
  UNION DISTINCT
  SELECT pid, arrayJoin(['EGFR', 'KRAS', 'TP53', 'STK11', 'KEAP1', 'SMARCA4']) AS gene FROM pp WHERE panel = 'WES'
),
alt AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND g.hugo_gene_symbol IN ('EGFR', 'KRAS', 'TP53', 'STK11', 'KEAP1', 'SMARCA4')
    AND ann.is_driver
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
st AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, if(uniqExact(lowerUTF8(trimBoth(attribute_value))) > 1, 'Multiple', any(trimBoth(attribute_value))) AS s
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND attribute_name = 'CANCER_TYPE' AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
)
SELECT ps.site AS site, prof.gene AS gene, st.s AS stratum, count() AS n, sum(ps.has) AS with_site,
       countIf(alt.pid != '') AS altered, countIf(ps.has = 1 AND alt.pid != '') AS both
FROM ps INNER JOIN prof ON prof.pid = ps.pid
  LEFT JOIN alt ON alt.pid = ps.pid AND alt.gene = prof.gene
  LEFT JOIN st ON st.pid = ps.pid
GROUP BY site, gene, stratum

-- view 0 organotropism: organotropism:incidence:altered · msk_chord_2024
WITH cohort AS (SELECT pid, sid FROM ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))) WHERE pid IN (
  WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
prof AS (
  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN ('EGFR')
  UNION DISTINCT
  SELECT pid, arrayJoin(['EGFR']) AS gene FROM pp WHERE panel = 'WES'
),
alt AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND g.hugo_gene_symbol IN ('EGFR')
    AND ann.is_driver
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
)
  SELECT pid FROM prof)
  AND pid IN (
  WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
prof AS (
  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN ('EGFR')
  UNION DISTINCT
  SELECT pid, arrayJoin(['EGFR']) AS gene FROM pp WHERE panel = 'WES'
),
alt AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND g.hugo_gene_symbol IN ('EGFR')
    AND ann.is_driver
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
)
  SELECT pid FROM alt)),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
anch AS (SELECT DISTINCT pid, toInt64(0) AS day FROM cohort),
ev AS (SELECT p.stable_id AS pid, ce.start_date AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('TUMOR_SITE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('CNS/Brain')))
    AND p.stable_id IN (SELECT pid FROM cohort)),
evs AS (
  SELECT ev.pid AS pid, countIf(ev.day <= anch.day) AS n_prior, countIf(ev.day > anch.day) AS n_after,
         minIf(ev.day, ev.day > anch.day) AS first_after
  FROM ev INNER JOIN anch ON anch.pid = ev.pid GROUP BY ev.pid
),
per AS (
  SELECT anch.pid AS pid, anch.day AS a, os.months AS months, os.status LIKE '1%' AS dead,
         evs.pid != '' AS has_ev, evs.n_prior AS n_prior, evs.n_after AS n_after, evs.first_after AS first_after
  FROM anch
  LEFT JOIN os ON os.pid = anch.pid
  LEFT JOIN evs ON evs.pid = anch.pid
),
cls AS (
  SELECT greatest(0, -a) / 30.4375 AS entry, months - a / 30.4375 AS tend,
         (first_after - a) / 30.4375 AS tev,
         multiIf(months IS NULL OR months - a / 30.4375 <= 0, 'nofollowup',
                 has_ev AND n_prior > 0, 'prior',
                 has_ev AND n_after > 0 AND first_after < 0, 'unobserved',
                 'record') AS kind,
         has_ev AND n_after > 0 AND (first_after - a) / 30.4375 <= months - a / 30.4375 AS hit,
         has_ev AND n_after > 0 AND (first_after - a) / 30.4375 > months - a / 30.4375 AS late,
         dead
  FROM per
)
SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(if(hit, tev, tend), 4), 0) AS t,
       if(kind != 'record', -1, if(hit, 1, if(dead, 2, 0))) AS cause, late, count() AS n
FROM cls GROUP BY kind, entry, t, cause, late ORDER BY t

-- view 0 organotropism: organotropism:incidence:wildtype · msk_chord_2024
WITH cohort AS (SELECT pid, sid FROM ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))) WHERE pid IN (
  WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
prof AS (
  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN ('EGFR')
  UNION DISTINCT
  SELECT pid, arrayJoin(['EGFR']) AS gene FROM pp WHERE panel = 'WES'
),
alt AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND g.hugo_gene_symbol IN ('EGFR')
    AND ann.is_driver
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
)
  SELECT pid FROM prof)
  AND pid NOT IN (
  WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
prof AS (
  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN ('EGFR')
  UNION DISTINCT
  SELECT pid, arrayJoin(['EGFR']) AS gene FROM pp WHERE panel = 'WES'
),
alt AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND g.hugo_gene_symbol IN ('EGFR')
    AND ann.is_driver
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
)
  SELECT pid FROM alt)),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
anch AS (SELECT DISTINCT pid, toInt64(0) AS day FROM cohort),
ev AS (SELECT p.stable_id AS pid, ce.start_date AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('TUMOR_SITE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('CNS/Brain')))
    AND p.stable_id IN (SELECT pid FROM cohort)),
evs AS (
  SELECT ev.pid AS pid, countIf(ev.day <= anch.day) AS n_prior, countIf(ev.day > anch.day) AS n_after,
         minIf(ev.day, ev.day > anch.day) AS first_after
  FROM ev INNER JOIN anch ON anch.pid = ev.pid GROUP BY ev.pid
),
per AS (
  SELECT anch.pid AS pid, anch.day AS a, os.months AS months, os.status LIKE '1%' AS dead,
         evs.pid != '' AS has_ev, evs.n_prior AS n_prior, evs.n_after AS n_after, evs.first_after AS first_after
  FROM anch
  LEFT JOIN os ON os.pid = anch.pid
  LEFT JOIN evs ON evs.pid = anch.pid
),
cls AS (
  SELECT greatest(0, -a) / 30.4375 AS entry, months - a / 30.4375 AS tend,
         (first_after - a) / 30.4375 AS tev,
         multiIf(months IS NULL OR months - a / 30.4375 <= 0, 'nofollowup',
                 has_ev AND n_prior > 0, 'prior',
                 has_ev AND n_after > 0 AND first_after < 0, 'unobserved',
                 'record') AS kind,
         has_ev AND n_after > 0 AND (first_after - a) / 30.4375 <= months - a / 30.4375 AS hit,
         has_ev AND n_after > 0 AND (first_after - a) / 30.4375 > months - a / 30.4375 AS late,
         dead
  FROM per
)
SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(if(hit, tev, tend), 4), 0) AS t,
       if(kind != 'record', -1, if(hit, 1, if(dead, 2, 0))) AS cause, late, count() AS n
FROM cls GROUP BY kind, entry, t, cause, late ORDER BY t

-- view 0 organotropism: organotropism:sites · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
evr AS (
  SELECT DISTINCT p.stable_id AS pid, lowerUTF8(trimBoth(d.value)) AS site, trimBoth(d.value) AS raw
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND lowerUTF8(trimBoth(d.key)) = lowerUTF8(trimBoth('TUMOR_SITE')) AND trimBoth(d.value) != ''
    AND p.stable_id IN (SELECT pid FROM cohort)
),
ev AS (SELECT DISTINCT pid, site FROM evr),
sl AS (SELECT site, min(raw) AS label FROM evr GROUP BY site),
ps AS (
  SELECT e.pid AS pid, s.site AS site, toUInt8((e.pid, s.site) IN (SELECT pid, site FROM ev)) AS has
  FROM (SELECT DISTINCT pid FROM ev) e CROSS JOIN (SELECT site FROM sl) s
)
SELECT ps.site AS site, any(sl.label) AS label, count() AS evaluable, sum(ps.has) AS with_site
FROM ps INNER JOIN sl ON sl.site = ps.site GROUP BY site

-- view 0 organotropism: organotropism:sources · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))))))
SELECT
  (SELECT uniqExact(replaceOne(patient_unique_id, 'msk_chord_2024_', '')) FROM snapshot_db.clinical_data_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND startsWith(attribute_name, 'DMETS_DX_') AND (type = 'sample' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort))) AS flag_patients,
  (SELECT uniqExact(attribute_name) FROM snapshot_db.clinical_data_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND startsWith(attribute_name, 'DMETS_DX_') AND (type = 'sample' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort))) AS flags,
  (SELECT uniqExact(p.stable_id) FROM snapshot_db.clinical_event ce
     JOIN snapshot_db.clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id
     JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
     JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
   WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis')) AND lowerUTF8(trimBoth(d.key)) = lowerUTF8(trimBoth('TUMOR_SITE')) AND trimBoth(d.value) != '' AND p.stable_id IN (SELECT pid FROM cohort)) AS timeline_patients,
  (SELECT uniqExact(replaceOne(patient_unique_id, 'msk_chord_2024_', '')) FROM snapshot_db.clinical_data_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND attribute_name = 'METASTATIC_SITE' AND trimBoth(attribute_value) != '' AND (type = 'sample' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort))) AS sample_patients
FROM system.one
