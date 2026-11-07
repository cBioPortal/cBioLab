-- cohort Melanoma
-- pancan_pcawg_2020
(SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND (('sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))

-- view 0 signatures: signatures:counts · pancan_pcawg_2020
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND (('sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020' AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sg0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n,
         arrayStringConcat(arraySort(groupUniqArray(replaceRegexpOne(profile_type, '^.*_', ''))), ', ') AS types
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type IN ('mutational_signatures_contribution_DBS', 'mutational_signatures_contribution_ID', 'mutational_signatures_contribution_SBS') AND profile_stable_id IN ('pancan_pcawg_2020_mutational_signatures_contribution_DBS', 'pancan_pcawg_2020_mutational_signatures_contribution_ID', 'pancan_pcawg_2020_mutational_signatures_contribution_SBS')
    AND if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) IS NOT NULL AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(sg.n, 0)) AS profiled, ifNull(sg.types, '') AS types
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN sg0 AS sg ON sg.pid = c.pid) WHERE profiled > 0
)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 signatures: signatures:rank · pancan_pcawg_2020
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND (('sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020' AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sg0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n,
         arrayStringConcat(arraySort(groupUniqArray(replaceRegexpOne(profile_type, '^.*_', ''))), ', ') AS types
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type IN ('mutational_signatures_contribution_DBS', 'mutational_signatures_contribution_ID', 'mutational_signatures_contribution_SBS') AND profile_stable_id IN ('pancan_pcawg_2020_mutational_signatures_contribution_DBS', 'pancan_pcawg_2020_mutational_signatures_contribution_ID', 'pancan_pcawg_2020_mutational_signatures_contribution_SBS')
    AND if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) IS NOT NULL AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(sg.n, 0)) AS profiled, ifNull(sg.types, '') AS types
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN sg0 AS sg ON sg.pid = c.pid) WHERE profiled > 0
)
SELECT idx FROM (SELECT study, patient, row_number() OVER (ORDER BY profiled DESC, patient, patient, ord) - 1 AS idx FROM rows
WHERE 1)
WHERE study = 'pancan_pcawg_2020' AND patient = 'DO220875' LIMIT 1

-- view 0 signatures: signatures:rows · pancan_pcawg_2020
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND (('sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020' AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sg0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n,
         arrayStringConcat(arraySort(groupUniqArray(replaceRegexpOne(profile_type, '^.*_', ''))), ', ') AS types
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type IN ('mutational_signatures_contribution_DBS', 'mutational_signatures_contribution_ID', 'mutational_signatures_contribution_SBS') AND profile_stable_id IN ('pancan_pcawg_2020_mutational_signatures_contribution_DBS', 'pancan_pcawg_2020_mutational_signatures_contribution_ID', 'pancan_pcawg_2020_mutational_signatures_contribution_SBS')
    AND if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) IS NOT NULL AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(sg.n, 0)) AS profiled, ifNull(sg.types, '') AS types
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN sg0 AS sg ON sg.pid = c.pid) WHERE profiled > 0
)
SELECT cohort, study, patient, sample, samples, profiled, types, count() OVER () AS total FROM rows
WHERE 1
ORDER BY profiled DESC, patient, patient, ord
LIMIT 25 OFFSET 0

-- view 0 signatures: signatures:rows · pancan_pcawg_2020
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND (('sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma')))) OR ('patient', replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'pancan_pcawg_2020_', ''), replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'pancan_pcawg_2020'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Melanoma'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'pancan_pcawg_2020' AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sg0 AS (
  SELECT replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') AS pid, uniqExact(sample_unique_id) AS n,
         arrayStringConcat(arraySort(groupUniqArray(replaceRegexpOne(profile_type, '^.*_', ''))), ', ') AS types
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type IN ('mutational_signatures_contribution_DBS', 'mutational_signatures_contribution_ID', 'mutational_signatures_contribution_SBS') AND profile_stable_id IN ('pancan_pcawg_2020_mutational_signatures_contribution_DBS', 'pancan_pcawg_2020_mutational_signatures_contribution_ID', 'pancan_pcawg_2020_mutational_signatures_contribution_SBS')
    AND if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) IS NOT NULL AND replaceOne(patient_unique_id, 'pancan_pcawg_2020_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(sg.n, 0)) AS profiled, ifNull(sg.types, '') AS types
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN sg0 AS sg ON sg.pid = c.pid) WHERE profiled > 0
)
SELECT cohort, study, patient, sample, samples, profiled, types, count() OVER () AS total FROM rows
WHERE 1
ORDER BY profiled DESC, patient, patient, ord
LIMIT 3 OFFSET 31

-- view 0 signatures: signatures:samples:counts · pancan_pcawg_2020
WITH s AS (SELECT replaceOne(s.sample_unique_id, 'pancan_pcawg_2020_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'pancan_pcawg_2020' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'pancan_pcawg_2020' AND s.patient_unique_id = 'pancan_pcawg_2020_DO220875'
GROUP BY id ORDER BY id),
rows AS (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, 'DO220875' AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 signatures: signatures:samples:rows · pancan_pcawg_2020
WITH s AS (SELECT replaceOne(s.sample_unique_id, 'pancan_pcawg_2020_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'pancan_pcawg_2020' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'pancan_pcawg_2020' AND s.patient_unique_id = 'pancan_pcawg_2020_DO220875'
GROUP BY id ORDER BY id),
rows AS (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, 'DO220875' AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY sid, sid
LIMIT 1000 OFFSET 0

-- view 0 signatures: signatures:values:counts · pancan_pcawg_2020
WITH v AS (SELECT profile_type AS pt, entity_stable_id AS entity, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid, if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS x
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type IN ('mutational_signatures_contribution_DBS', 'mutational_signatures_counts_DBS', 'mutational_signatures_contribution_ID', 'mutational_signatures_counts_ID', 'mutational_signatures_contribution_SBS', 'mutational_signatures_counts_SBS') AND profile_stable_id IN ('pancan_pcawg_2020_mutational_signatures_contribution_DBS', 'pancan_pcawg_2020_mutational_signatures_counts_DBS', 'pancan_pcawg_2020_mutational_signatures_contribution_ID', 'pancan_pcawg_2020_mutational_signatures_counts_ID', 'pancan_pcawg_2020_mutational_signatures_contribution_SBS', 'pancan_pcawg_2020_mutational_signatures_counts_SBS')
    AND patient_unique_id = 'pancan_pcawg_2020_DO220875'),
props AS (SELECT ge.stable_id AS entity, anyIf(pr.value, pr.name = 'NAME') AS name, anyIf(pr.value, pr.name = 'DESCRIPTION') AS description,
         anyIf(pr.value, pr.name = 'URL') AS url
  FROM snapshot_db.generic_entity_properties pr JOIN snapshot_db.genetic_entity ge ON ge.id = pr.genetic_entity_id
  WHERE ge.stable_id IN (SELECT entity FROM v) AND pr.name IN ('NAME', 'DESCRIPTION', 'URL') GROUP BY entity),
a AS (SELECT pt, entity, arraySort(x -> x.1, groupArray(tuple(sid, x))) AS vals FROM v GROUP BY pt, entity),
rows AS (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, 'DO220875' AS patient,
         a.pt AS profile, a.entity AS entity, ifNull(props.name, '') AS name, ifNull(props.description, '') AS description, ifNull(props.url, '') AS url, a.vals AS vals
  FROM a LEFT JOIN props ON props.entity = a.entity)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 signatures: signatures:values:rows · pancan_pcawg_2020
WITH v AS (SELECT profile_type AS pt, entity_stable_id AS entity, replaceOne(sample_unique_id, 'pancan_pcawg_2020_', '') AS sid, if(isFinite(ifNull(toFloat64OrNull(value), nan)), toFloat64OrNull(value), NULL) AS x
  FROM snapshot_db.generic_assay_data_derived
  WHERE profile_type IN ('mutational_signatures_contribution_DBS', 'mutational_signatures_counts_DBS', 'mutational_signatures_contribution_ID', 'mutational_signatures_counts_ID', 'mutational_signatures_contribution_SBS', 'mutational_signatures_counts_SBS') AND profile_stable_id IN ('pancan_pcawg_2020_mutational_signatures_contribution_DBS', 'pancan_pcawg_2020_mutational_signatures_counts_DBS', 'pancan_pcawg_2020_mutational_signatures_contribution_ID', 'pancan_pcawg_2020_mutational_signatures_counts_ID', 'pancan_pcawg_2020_mutational_signatures_contribution_SBS', 'pancan_pcawg_2020_mutational_signatures_counts_SBS')
    AND patient_unique_id = 'pancan_pcawg_2020_DO220875'),
props AS (SELECT ge.stable_id AS entity, anyIf(pr.value, pr.name = 'NAME') AS name, anyIf(pr.value, pr.name = 'DESCRIPTION') AS description,
         anyIf(pr.value, pr.name = 'URL') AS url
  FROM snapshot_db.generic_entity_properties pr JOIN snapshot_db.genetic_entity ge ON ge.id = pr.genetic_entity_id
  WHERE ge.stable_id IN (SELECT entity FROM v) AND pr.name IN ('NAME', 'DESCRIPTION', 'URL') GROUP BY entity),
a AS (SELECT pt, entity, arraySort(x -> x.1, groupArray(tuple(sid, x))) AS vals FROM v GROUP BY pt, entity),
rows AS (SELECT 'Melanoma' AS cohort, 'pancan_pcawg_2020' AS study, 0 AS ord, 'DO220875' AS patient,
         a.pt AS profile, a.entity AS entity, ifNull(props.name, '') AS name, ifNull(props.description, '') AS description, ifNull(props.url, '') AS url, a.vals AS vals
  FROM a LEFT JOIN props ON props.entity = a.entity)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY profile, entity, profile, entity
LIMIT 1000 OFFSET 0
