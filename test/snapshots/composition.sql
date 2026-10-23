-- cohort HRD-Dup
-- msk_spectrum_tme_2022
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Dup'))))

-- cohort HRD-Del
-- msk_spectrum_tme_2022
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Del'))))

-- cohort FBI
-- msk_spectrum_tme_2022
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('FBI'))))

-- view 0 composition: composition:cases:FBI · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('FBI'))))),
parts AS (
SELECT id, toUInt16(0) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(1) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(2) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(3) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(4) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(5) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(6) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(7) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(8) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(9) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT ps, h FROM cases ORDER BY ps[4] DESC, cityHash64(id)
LIMIT 2001

-- view 0 composition: composition:cases:HRD-Del · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Del'))))),
parts AS (
SELECT id, toUInt16(0) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(1) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(2) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(3) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(4) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(5) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(6) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(7) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(8) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(9) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT ps, h FROM cases ORDER BY ps[4] DESC, cityHash64(id)
LIMIT 2001

-- view 0 composition: composition:cases:HRD-Dup · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Dup'))))),
parts AS (
SELECT id, toUInt16(0) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(1) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(2) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(3) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(4) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(5) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(6) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(7) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(8) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(9) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT ps, h FROM cases ORDER BY ps[4] DESC, cityHash64(id)
LIMIT 2001

-- view 0 composition: composition:moments:FBI · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('FBI'))))),
parts AS (
SELECT id, toUInt16(0) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(1) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(2) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(3) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(4) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(5) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(6) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(7) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(8) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(9) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,
       (SELECT countIf(k < 10) FROM raw) AS incomplete,
       (SELECT countIf(k = 10 AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid
FROM cases

-- view 0 composition: composition:moments:HRD-Del · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Del'))))),
parts AS (
SELECT id, toUInt16(0) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(1) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(2) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(3) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(4) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(5) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(6) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(7) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(8) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(9) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,
       (SELECT countIf(k < 10) FROM raw) AS incomplete,
       (SELECT countIf(k = 10 AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid
FROM cases

-- view 0 composition: composition:moments:HRD-Dup · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Dup'))))),
parts AS (
SELECT id, toUInt16(0) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_c69fe134)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(1) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e449dcfd)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_naive' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(2) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_f23281fa)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD4_T_reg' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(3) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d53efc38)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_CXCL13' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(4) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_36ce14b9)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_ISG' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(5) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e42f954c)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_CD8_T_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(6) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_e52f52c7)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_Cycling_T_NK' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(7) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_d3243663)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_ILC' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(8) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_33a1d461)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_CD56' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
UNION ALL
SELECT id, toUInt16(9) AS c, toFloat64(assumeNotNull(av)) AS v FROM (SELECT id, v AS av FROM (
SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived
 UNION ALL
 SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM _custom_clinical_a671983f)
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND attribute_name = 'custom:spectrum-sc-tnk/TNK_NK_cytotoxic' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') IN (SELECT pid FROM cohort)
) GROUP BY id
)) WHERE isFinite(ifNull(av, nan))
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,
       (SELECT countIf(k < 10) FROM raw) AS incomplete,
       (SELECT countIf(k = 10 AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid
FROM cases

-- view 1 composition: composition:cases:FBI · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('FBI'))))),
parts AS (
SELECT id, c, assumeNotNull(avg(val)) AS v FROM (
  SELECT sample_unique_id AS id, toUInt16(indexOf(['B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell'], entity_stable_id) - 1) AS c,
         if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS val
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
    AND entity_stable_id IN ('B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell')
    AND patient_unique_id IN (SELECT concat('msk_spectrum_tme_2022_', pid) FROM cohort)
) WHERE isFinite(ifNull(val, nan)) GROUP BY id, c
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT ps, h FROM cases ORDER BY ps[10] DESC, cityHash64(id)
LIMIT 2001

-- view 1 composition: composition:cases:HRD-Del · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Del'))))),
parts AS (
SELECT id, c, assumeNotNull(avg(val)) AS v FROM (
  SELECT sample_unique_id AS id, toUInt16(indexOf(['B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell'], entity_stable_id) - 1) AS c,
         if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS val
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
    AND entity_stable_id IN ('B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell')
    AND patient_unique_id IN (SELECT concat('msk_spectrum_tme_2022_', pid) FROM cohort)
) WHERE isFinite(ifNull(val, nan)) GROUP BY id, c
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT ps, h FROM cases ORDER BY ps[10] DESC, cityHash64(id)
LIMIT 2001

-- view 1 composition: composition:cases:HRD-Dup · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Dup'))))),
parts AS (
SELECT id, c, assumeNotNull(avg(val)) AS v FROM (
  SELECT sample_unique_id AS id, toUInt16(indexOf(['B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell'], entity_stable_id) - 1) AS c,
         if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS val
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
    AND entity_stable_id IN ('B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell')
    AND patient_unique_id IN (SELECT concat('msk_spectrum_tme_2022_', pid) FROM cohort)
) WHERE isFinite(ifNull(val, nan)) GROUP BY id, c
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT ps, h FROM cases ORDER BY ps[10] DESC, cityHash64(id)
LIMIT 2001

-- view 1 composition: composition:entities · msk_spectrum_tme_2022
WITH entities AS (
  SELECT DISTINCT entity_stable_id AS entity FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
)
SELECT entity FROM entities ORDER BY entity

-- view 1 composition: composition:moments:FBI · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('FBI'))))),
parts AS (
SELECT id, c, assumeNotNull(avg(val)) AS v FROM (
  SELECT sample_unique_id AS id, toUInt16(indexOf(['B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell'], entity_stable_id) - 1) AS c,
         if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS val
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
    AND entity_stable_id IN ('B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell')
    AND patient_unique_id IN (SELECT concat('msk_spectrum_tme_2022_', pid) FROM cohort)
) WHERE isFinite(ifNull(val, nan)) GROUP BY id, c
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,
       (SELECT countIf(k < 10) FROM raw) AS incomplete,
       (SELECT countIf(k = 10 AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid
FROM cases

-- view 1 composition: composition:moments:HRD-Del · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Del'))))),
parts AS (
SELECT id, c, assumeNotNull(avg(val)) AS v FROM (
  SELECT sample_unique_id AS id, toUInt16(indexOf(['B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell'], entity_stable_id) - 1) AS c,
         if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS val
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
    AND entity_stable_id IN ('B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell')
    AND patient_unique_id IN (SELECT concat('msk_spectrum_tme_2022_', pid) FROM cohort)
) WHERE isFinite(ifNull(val, nan)) GROUP BY id, c
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,
       (SELECT countIf(k < 10) FROM raw) AS incomplete,
       (SELECT countIf(k = 10 AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid
FROM cases

-- view 1 composition: composition:moments:HRD-Dup · msk_spectrum_tme_2022
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_spectrum_tme_2022_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_spectrum_tme_2022' AND type = 'patient'
    AND attribute_name = 'CONSENSUS_SIGNATURE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('HRD-Dup'))))),
parts AS (
SELECT id, c, assumeNotNull(avg(val)) AS v FROM (
  SELECT sample_unique_id AS id, toUInt16(indexOf(['B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell'], entity_stable_id) - 1) AS c,
         if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS val
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts'
    AND entity_stable_id IN ('B_cell','Dendritic_cell','Endothelial_cell','Fibroblast','Mast_cell','Monocyte','Other','Ovarian_cancer_cell','Plasma_cell','T_cell')
    AND patient_unique_id IN (SELECT concat('msk_spectrum_tme_2022_', pid) FROM cohort)
) WHERE isFinite(ifNull(val, nan)) GROUP BY id, c
),
raw AS (
  SELECT id, count() AS k, sum(v) AS tot, min(v) AS lo, arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((c, v)))) AS vs
  FROM parts GROUP BY id
),
cases AS (
  SELECT id, arrayMap(x -> x / tot, vs) AS ps, arrayMap(x -> x / tot, vs) AS sh,
         arraySum(arrayMap(x -> if(x > 0, -x * log(x), 0), sh)) AS h
  FROM raw WHERE k = 10 AND lo >= 0 AND tot > 0
)
SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,
       (SELECT countIf(k < 10) FROM raw) AS incomplete,
       (SELECT countIf(k = 10 AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid
FROM cases

-- view 1 composition: composition:names · msk_spectrum_tme_2022
WITH named AS (
  SELECT ge.stable_id AS entity, p.value AS name FROM snapshot_db.generic_entity_properties p
  JOIN snapshot_db.genetic_entity ge ON ge.id = p.genetic_entity_id
  WHERE p.name = 'NAME' AND ge.stable_id IN (SELECT DISTINCT entity_stable_id FROM snapshot_db.generic_assay_data_derived
    WHERE profile_type = 'cell_type_relative_counts' AND profile_stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts')
)
SELECT entity, name FROM named

-- view 1 composition: composition:profile · msk_spectrum_tme_2022
SELECT datatype, generic_assay_type, ifNull(patient_level, 0) AS patient_level, name FROM snapshot_db.genetic_profile
WHERE stable_id = 'msk_spectrum_tme_2022_cell_type_relative_counts' AND genetic_alteration_type = 'GENERIC_ASSAY'
