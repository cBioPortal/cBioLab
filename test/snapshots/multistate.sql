-- cohort Colorectal, stage 1-3
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3'))))))

-- cohort Colorectal, stage 4
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4'))))))

-- view 0 multistate: multistate:Colorectal, stage 1-3 · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL), NULL) AS months,
         if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), NULL) = 1, 1, 0) AS dead
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
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL), NULL) AS months,
         if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), NULL) = 1, 1, 0) AS dead
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

-- view 0 multistate: survivalLeftOut:OS_MONTHS · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 1-3'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         anyIf(attribute_value, attribute_name = 'OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT countIf(lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0 AND NOT lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na')) AS no_status,
       countIf(lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND NOT (lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0)) AS no_time
FROM os

-- view 0 multistate: survivalLeftOut:OS_MONTHS · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'STAGE_HIGHEST_RECORDED' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Stage 4'))))))),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         anyIf(attribute_value, attribute_name = 'OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT countIf(lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0 AND NOT lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na')) AS no_status,
       countIf(lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND NOT (lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0)) AS no_time
FROM os
