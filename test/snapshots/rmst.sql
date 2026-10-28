-- cohort TMB < 10
-- tmb_mskcc_2018
(SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid, replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND (('sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) < 10) OR ('patient', replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) < 10)))

-- cohort TMB ≥ 10
-- tmb_mskcc_2018
(SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid, replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND (('sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) >= 10) OR ('patient', replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) >= 10)))

-- view 0 rmst: survivalCounts:OS · tmb_mskcc_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid, replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND (('sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) < 10) OR ('patient', replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) < 10)))),
os AS (
  SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid,
         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL), NULL) AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(status, ''))[1])), NULL) = 1, 1, 0) AS ev, count() AS n
FROM os WHERE m IS NOT NULL
GROUP BY m, ev ORDER BY m

-- view 0 rmst: survivalCounts:OS · tmb_mskcc_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid, replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND (('sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) >= 10) OR ('patient', replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'tmb_mskcc_2018_', ''), replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) >= 10)))),
os AS (
  SELECT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid,
         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,
         anyIf(attribute_value, attribute_name='OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type='patient'
    AND attribute_name IN ('OS_MONTHS','OS_STATUS')
    AND replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT if(lowerUTF8(trimBoth(ifNull(status, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(months, ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(months)), nan)), toFloat64OrNull(trimBoth(months)), NULL), NULL) AS m, if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(status, ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(status, ''))[1])), NULL) = 1, 1, 0) AS ev, count() AS n
FROM os WHERE m IS NOT NULL
GROUP BY m, ev ORDER BY m
