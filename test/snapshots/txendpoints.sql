-- cohort NSCLC, KRAS mutant
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
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- cohort NSCLC, KRAS wild-type
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
INTERSECT DISTINCT
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT DISTINCT replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') AS sid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'KRAS'))))

-- view 0 txendpoints: txendpoints:rwpfs:NSCLC, KRAS mutant · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
arec AS (
  SELECT p.stable_id AS pid, ce.clinical_event_id AS eid, ce.start_date AS s, ce.stop_date AS e
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Immuno')))
),
anch AS (SELECT pid, min(s) AS a FROM arec GROUP BY pid),
lastday AS (
  SELECT p.stable_id AS pid, max(greatest(ce.start_date, coalesce(ce.stop_date, ce.start_date))) AS d
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
prog AS (
  SELECT p.stable_id AS pid, ce.start_date AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('PROGRESSION')) AND lowerUTF8(trimBoth(value)) IN (lowerUTF8(trimBoth('Y')), lowerUTF8(trimBoth('Yes'))))
),
x AS (SELECT prog.pid AS pid, min(prog.day) AS d, 0 AS nostop FROM prog INNER JOIN anch ON anch.pid = prog.pid WHERE prog.day > anch.a GROUP BY prog.pid),
per AS (
  SELECT anch.a AS a, os.months * 30.4375 AS fu, os.months IS NOT NULL AS has_os, os.dead AS dead,
         x.pid != '' AS has_x, toFloat64(x.d) AS xd, x.nostop AS nostop, lastday.d AS ld
  FROM anch
  LEFT JOIN os ON os.pid = anch.pid
  LEFT JOIN x ON x.pid = anch.pid
  LEFT JOIN lastday ON lastday.pid = anch.pid
),
cls AS (
  SELECT multiIf(NOT has_os OR fu - a <= 0, 'nofollowup',
                 'record') AS kind,
         greatest(0, -a) / 30.4375 AS entry,
         has_x AND xd <= fu AS hit,
         if(hit, xd - a, fu - a) / 30.4375 AS tt,
         if(hit, 1, if(dead, 1, 0)) AS ev,
         ld > fu + 31 AS late
  FROM per
)
SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(tt, 4), 0) AS t,
       if(kind = 'record', ev, 0) AS ev, late, count() AS n
FROM cls GROUP BY kind, entry, t, ev, late ORDER BY t

-- view 0 txendpoints: txendpoints:rwpfs:NSCLC, KRAS wild-type · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))
INTERSECT DISTINCT
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT DISTINCT replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') AS sid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'KRAS'))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
arec AS (
  SELECT p.stable_id AS pid, ce.clinical_event_id AS eid, ce.start_date AS s, ce.stop_date AS e
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Immuno')))
),
anch AS (SELECT pid, min(s) AS a FROM arec GROUP BY pid),
lastday AS (
  SELECT p.stable_id AS pid, max(greatest(ce.start_date, coalesce(ce.stop_date, ce.start_date))) AS d
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
prog AS (
  SELECT p.stable_id AS pid, ce.start_date AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('PROGRESSION')) AND lowerUTF8(trimBoth(value)) IN (lowerUTF8(trimBoth('Y')), lowerUTF8(trimBoth('Yes'))))
),
x AS (SELECT prog.pid AS pid, min(prog.day) AS d, 0 AS nostop FROM prog INNER JOIN anch ON anch.pid = prog.pid WHERE prog.day > anch.a GROUP BY prog.pid),
per AS (
  SELECT anch.a AS a, os.months * 30.4375 AS fu, os.months IS NOT NULL AS has_os, os.dead AS dead,
         x.pid != '' AS has_x, toFloat64(x.d) AS xd, x.nostop AS nostop, lastday.d AS ld
  FROM anch
  LEFT JOIN os ON os.pid = anch.pid
  LEFT JOIN x ON x.pid = anch.pid
  LEFT JOIN lastday ON lastday.pid = anch.pid
),
cls AS (
  SELECT multiIf(NOT has_os OR fu - a <= 0, 'nofollowup',
                 'record') AS kind,
         greatest(0, -a) / 30.4375 AS entry,
         has_x AND xd <= fu AS hit,
         if(hit, xd - a, fu - a) / 30.4375 AS tt,
         if(hit, 1, if(dead, 1, 0)) AS ev,
         ld > fu + 31 AS late
  FROM per
)
SELECT kind, if(kind = 'record', round(entry, 4), 0) AS entry, if(kind = 'record', round(tt, 4), 0) AS t,
       if(kind = 'record', ev, 0) AS ev, late, count() AS n
FROM cls GROUP BY kind, entry, t, ev, late ORDER BY t
