-- cohort all patients
-- tmb_mskcc_2018
SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid, replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'

-- view 0 cutpoint: cutpoint:rows · tmb_mskcc_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid, replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'),
os AS (
  SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
val AS (
  SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(argMinIf(attribute_value, sample_unique_id, attribute_name = 'TMB_NONSYNONYMOUS')), nan)), toFloat64OrNull(argMinIf(attribute_value, sample_unique_id, attribute_name = 'TMB_NONSYNONYMOUS')), NULL) AS v,
         argMinIf(trimBoth(attribute_value), sample_unique_id, attribute_name = 'CANCER_TYPE') AS s
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND attribute_name IN ('TMB_NONSYNONYMOUS', 'CANCER_TYPE') AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
)
SELECT os.months AS m, if(os.status LIKE '1%', 1, 0) AS ev, val.v AS v, val.s AS s
FROM os LEFT JOIN val ON val.pid = os.pid
WHERE os.months IS NOT NULL AND os.months >= 0
