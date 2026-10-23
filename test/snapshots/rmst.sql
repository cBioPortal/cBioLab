-- cohort TMB < 10
-- tmb_mskcc_2018
(SELECT DISTINCT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type = 'sample'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) < 10)

-- cohort TMB ≥ 10
-- tmb_mskcc_2018
(SELECT DISTINCT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type = 'sample'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) >= 10)

-- view 0 rmst: survivalCounts:OS · tmb_mskcc_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type = 'sample'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) < 10)),
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
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m

-- view 0 rmst: survivalCounts:OS · tmb_mskcc_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'tmb_mskcc_2018_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'tmb_mskcc_2018' AND type = 'sample'
    AND attribute_name = 'TMB_NONSYNONYMOUS' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) >= 10)),
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
SELECT if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n
FROM os WHERE if(isFinite(ifNull(toFloat64OrNull(months), nan)), toFloat64OrNull(months), NULL) IS NOT NULL
GROUP BY m, ev ORDER BY m
