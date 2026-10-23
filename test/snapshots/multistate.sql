-- cohort Colorectal, stage 1-3
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3'))))

-- cohort Colorectal, stage 4
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4'))))

-- view 0 multistate: multistate:Colorectal, stage 1-3 · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3'))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
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
pp AS (SELECT pid, countIf(day <= 0) AS n_pre, countIf(day > 0) AS n_after, minIf(day, day > 0) AS first_after FROM prog GROUP BY pid),
assessed AS (
  SELECT DISTINCT p.stable_id AS pid
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('PROGRESSION')) AND 1)
),
seq0 AS (
  SELECT DISTINCT p.stable_id AS pid
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Sequencing')) AND ce.start_date = 0
),
per AS (
  SELECT os.months AS months, os.months IS NOT NULL AS has_os, os.dead AS dead,
         pp.pid != '' AND pp.n_pre > 0 AS prevalent, pp.pid != '' AND pp.n_after > 0 AS has_after, toFloat64(pp.first_after) AS fa,
         a.pid != '' AS assessed, s.pid != '' AS seq0, lastday.d AS ld
  FROM (SELECT DISTINCT pid FROM cohort) c
  LEFT JOIN os ON os.pid = c.pid
  LEFT JOIN pp ON pp.pid = c.pid
  LEFT JOIN assessed a ON a.pid = c.pid
  LEFT JOIN seq0 s ON s.pid = c.pid
  LEFT JOIN lastday ON lastday.pid = c.pid
),
cls AS (
  SELECT multiIf(NOT has_os OR months <= 0, 'nofollowup', 'record') AS kind,
         NOT prevalent AND has_after AND fa < months * 30.4375 AS hit,
         NOT prevalent AND has_after AND fa >= months * 30.4375 AS afterend,
         if(hit, fa / 30.4375, 0) AS tp, months AS te,
         prevalent, dead, assessed, seq0, ld > months * 30.4375 + 31 AS late
  FROM per
)
SELECT kind, if(kind = 'record', toUInt8(prevalent), 0) AS prevalent, if(kind = 'record', round(tp, 4), 0) AS tp,
       if(kind = 'record', round(te, 4), 0) AS te, if(kind = 'record', toUInt8(dead), 0) AS dead,
       toUInt8(afterend) AS afterend, toUInt8(assessed) AS assessed, toUInt8(seq0) AS seq0, toUInt8(late) AS late, count() AS n
FROM cls GROUP BY kind, prevalent, tp, te, dead, afterend, assessed, seq0, late ORDER BY te

-- view 0 multistate: multistate:Colorectal, stage 4 · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4'))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
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
pp AS (SELECT pid, countIf(day <= 0) AS n_pre, countIf(day > 0) AS n_after, minIf(day, day > 0) AS first_after FROM prog GROUP BY pid),
assessed AS (
  SELECT DISTINCT p.stable_id AS pid
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Diagnosis'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('PROGRESSION')) AND 1)
),
seq0 AS (
  SELECT DISTINCT p.stable_id AS pid
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Sequencing')) AND ce.start_date = 0
),
per AS (
  SELECT os.months AS months, os.months IS NOT NULL AS has_os, os.dead AS dead,
         pp.pid != '' AND pp.n_pre > 0 AS prevalent, pp.pid != '' AND pp.n_after > 0 AS has_after, toFloat64(pp.first_after) AS fa,
         a.pid != '' AS assessed, s.pid != '' AS seq0, lastday.d AS ld
  FROM (SELECT DISTINCT pid FROM cohort) c
  LEFT JOIN os ON os.pid = c.pid
  LEFT JOIN pp ON pp.pid = c.pid
  LEFT JOIN assessed a ON a.pid = c.pid
  LEFT JOIN seq0 s ON s.pid = c.pid
  LEFT JOIN lastday ON lastday.pid = c.pid
),
cls AS (
  SELECT multiIf(NOT has_os OR months <= 0, 'nofollowup', 'record') AS kind,
         NOT prevalent AND has_after AND fa < months * 30.4375 AS hit,
         NOT prevalent AND has_after AND fa >= months * 30.4375 AS afterend,
         if(hit, fa / 30.4375, 0) AS tp, months AS te,
         prevalent, dead, assessed, seq0, ld > months * 30.4375 + 31 AS late
  FROM per
)
SELECT kind, if(kind = 'record', toUInt8(prevalent), 0) AS prevalent, if(kind = 'record', round(tp, 4), 0) AS tp,
       if(kind = 'record', round(te, 4), 0) AS te, if(kind = 'record', toUInt8(dead), 0) AS dead,
       toUInt8(afterend) AS afterend, toUInt8(assessed) AS assessed, toUInt8(seq0) AS seq0, toUInt8(late) AS late, count() AS n
FROM cls GROUP BY kind, prevalent, tp, te, dead, afterend, assessed, seq0, late ORDER BY te
