-- cohort Prostate, TP53 mutant
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- cohort Prostate, TP53 wild-type
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))

-- view 0 labs: labs:best:Prostate, TP53 mutant · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Hormone')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
lab AS (
  SELECT p.stable_id AS pid, ce.start_date AS day, if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) AS v
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(t.key)) = lowerUTF8(trimBoth('TEST')) AND lowerUTF8(trimBoth(t.value)) = lowerUTF8(trimBoth('PSA'))
  JOIN snapshot_db.clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(r.key)) = lowerUTF8(trimBoth('RESULT'))
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Lab_Test'))
    AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
per AS (
  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs
  FROM anch LEFT JOIN lab ON lab.pid = anch.pid
  GROUP BY anch.pid
),
pb AS (
  SELECT pid, xs, arrayFilter((x) -> x.1 >= -90 AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,
         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,
         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b
  FROM per
),
chg AS (
  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc
  FROM pb ARRAY JOIN xs AS x
  WHERE has_base AND b > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364
),
pbest AS (
  SELECT has_base, b, has_base AND b > 0 AND notEmpty(after) AS ok, arrayMin(after) AS best
  FROM (SELECT has_base, b, arrayMap((x) -> 100 * (x.2 - b) / b, arrayFilter((x) -> x.1 > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364, xs)) AS after FROM pb)
),
tot AS (
  SELECT count() AS anchored, countIf(has_base) AS baseline, countIf(has_base AND b > 0) AS positive_baseline,
         countIf(ok) AS after, countIf(ok AND best <= -50) AS responders,
         sumMapIf([toInt32(floor((least(300, greatest(-100, if(ok, best, 0))) - (-100) + 1) / 2))], [toUInt64(1)], ok) AS hist
  FROM pbest
)
SELECT r.1 AS what, r.2 AS pbin, r.3 AS n FROM tot
ARRAY JOIN arrayConcat(arrayMap((k, v) -> ('best', k, v), hist.1, hist.2),
  [('responders', toInt32(0), responders), ('anchored', toInt32(0), anchored), ('baseline', toInt32(0), baseline),
   ('positive_baseline', toInt32(0), positive_baseline), ('after', toInt32(0), after)]) AS r

-- view 0 labs: labs:best:Prostate, TP53 wild-type · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Hormone')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
lab AS (
  SELECT p.stable_id AS pid, ce.start_date AS day, if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) AS v
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(t.key)) = lowerUTF8(trimBoth('TEST')) AND lowerUTF8(trimBoth(t.value)) = lowerUTF8(trimBoth('PSA'))
  JOIN snapshot_db.clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(r.key)) = lowerUTF8(trimBoth('RESULT'))
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Lab_Test'))
    AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
per AS (
  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs
  FROM anch LEFT JOIN lab ON lab.pid = anch.pid
  GROUP BY anch.pid
),
pb AS (
  SELECT pid, xs, arrayFilter((x) -> x.1 >= -90 AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,
         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,
         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b
  FROM per
),
chg AS (
  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc
  FROM pb ARRAY JOIN xs AS x
  WHERE has_base AND b > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364
),
pbest AS (
  SELECT has_base, b, has_base AND b > 0 AND notEmpty(after) AS ok, arrayMin(after) AS best
  FROM (SELECT has_base, b, arrayMap((x) -> 100 * (x.2 - b) / b, arrayFilter((x) -> x.1 > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364, xs)) AS after FROM pb)
),
tot AS (
  SELECT count() AS anchored, countIf(has_base) AS baseline, countIf(has_base AND b > 0) AS positive_baseline,
         countIf(ok) AS after, countIf(ok AND best <= -50) AS responders,
         sumMapIf([toInt32(floor((least(300, greatest(-100, if(ok, best, 0))) - (-100) + 1) / 2))], [toUInt64(1)], ok) AS hist
  FROM pbest
)
SELECT r.1 AS what, r.2 AS pbin, r.3 AS n FROM tot
ARRAY JOIN arrayConcat(arrayMap((k, v) -> ('best', k, v), hist.1, hist.2),
  [('responders', toInt32(0), responders), ('anchored', toInt32(0), anchored), ('baseline', toInt32(0), baseline),
   ('positive_baseline', toInt32(0), positive_baseline), ('after', toInt32(0), after)]) AS r

-- view 0 labs: labs:course:Prostate, TP53 mutant · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Hormone')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
lab AS (
  SELECT p.stable_id AS pid, ce.start_date AS day, if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) AS v
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(t.key)) = lowerUTF8(trimBoth('TEST')) AND lowerUTF8(trimBoth(t.value)) = lowerUTF8(trimBoth('PSA'))
  JOIN snapshot_db.clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(r.key)) = lowerUTF8(trimBoth('RESULT'))
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Lab_Test'))
    AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
per AS (
  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs
  FROM anch LEFT JOIN lab ON lab.pid = anch.pid
  GROUP BY anch.pid
),
pb AS (
  SELECT pid, xs, arrayFilter((x) -> x.1 >= -90 AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,
         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,
         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b
  FROM per
),
chg AS (
  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc
  FROM pb ARRAY JOIN xs AS x
  WHERE has_base AND b > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364
)
SELECT tbin, pbin, count() AS n FROM (
  SELECT pid, toInt32(floor(rel / 28)) AS tbin, toInt32(floor((least(300, greatest(-100, avg(pc))) - (-100) + 1) / 2)) AS pbin
  FROM chg GROUP BY pid, tbin
) GROUP BY tbin, pbin ORDER BY tbin, pbin

-- view 0 labs: labs:course:Prostate, TP53 wild-type · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Hormone')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
lab AS (
  SELECT p.stable_id AS pid, ce.start_date AS day, if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) AS v
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(t.key)) = lowerUTF8(trimBoth('TEST')) AND lowerUTF8(trimBoth(t.value)) = lowerUTF8(trimBoth('PSA'))
  JOIN snapshot_db.clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(r.key)) = lowerUTF8(trimBoth('RESULT'))
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Lab_Test'))
    AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
per AS (
  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs
  FROM anch LEFT JOIN lab ON lab.pid = anch.pid
  GROUP BY anch.pid
),
pb AS (
  SELECT pid, xs, arrayFilter((x) -> x.1 >= -90 AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,
         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,
         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b
  FROM per
),
chg AS (
  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc
  FROM pb ARRAY JOIN xs AS x
  WHERE has_base AND b > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364
)
SELECT tbin, pbin, count() AS n FROM (
  SELECT pid, toInt32(floor(rel / 28)) AS tbin, toInt32(floor((least(300, greatest(-100, avg(pc))) - (-100) + 1) / 2)) AS pbin
  FROM chg GROUP BY pid, tbin
) GROUP BY tbin, pbin ORDER BY tbin, pbin

-- view 0 labs: labs:waterfall:Prostate, TP53 mutant · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Hormone')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
lab AS (
  SELECT p.stable_id AS pid, ce.start_date AS day, if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) AS v
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(t.key)) = lowerUTF8(trimBoth('TEST')) AND lowerUTF8(trimBoth(t.value)) = lowerUTF8(trimBoth('PSA'))
  JOIN snapshot_db.clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(r.key)) = lowerUTF8(trimBoth('RESULT'))
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Lab_Test'))
    AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
per AS (
  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs
  FROM anch LEFT JOIN lab ON lab.pid = anch.pid
  GROUP BY anch.pid
),
pb AS (
  SELECT pid, xs, arrayFilter((x) -> x.1 >= -90 AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,
         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,
         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b
  FROM per
),
chg AS (
  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc
  FROM pb ARRAY JOIN xs AS x
  WHERE has_base AND b > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364
)
SELECT round(best, 1) AS best FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)
ORDER BY best LIMIT 5000

-- view 0 labs: labs:waterfall:Prostate, TP53 wild-type · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))
INTERSECT DISTINCT
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
    AND ce.clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_data WHERE lowerUTF8(trimBoth(key)) = lowerUTF8(trimBoth('SUBTYPE')) AND lowerUTF8(trimBoth(value)) = lowerUTF8(trimBoth('Hormone')))
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
lab AS (
  SELECT p.stable_id AS pid, ce.start_date AS day, if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) AS v
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN snapshot_db.clinical_event_data t ON t.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(t.key)) = lowerUTF8(trimBoth('TEST')) AND lowerUTF8(trimBoth(t.value)) = lowerUTF8(trimBoth('PSA'))
  JOIN snapshot_db.clinical_event_data r ON r.clinical_event_id = ce.clinical_event_id AND lowerUTF8(trimBoth(r.key)) = lowerUTF8(trimBoth('RESULT'))
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Lab_Test'))
    AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
per AS (
  SELECT anch.pid AS pid, groupArrayIf((lab.day - anch.day, assumeNotNull(lab.v)), lab.pid != '') AS xs
  FROM anch LEFT JOIN lab ON lab.pid = anch.pid
  GROUP BY anch.pid
),
pb AS (
  SELECT pid, xs, arrayFilter((x) -> x.1 >= -90 AND x.1 <= 0, xs) AS pre, notEmpty(pre) AS has_base,
         arrayMax(arrayMap((x) -> x.1, pre)) AS brel,
         arrayAvg(arrayMap((x) -> x.2, arrayFilter((x) -> x.1 = brel, pre))) AS b
  FROM per
),
chg AS (
  SELECT pid, x.1 AS rel, 100 * (x.2 - b) / b AS pc
  FROM pb ARRAY JOIN xs AS x
  WHERE has_base AND b > 0 AND x.1 != brel AND x.1 >= -84 AND x.1 <= 364
)
SELECT round(best, 1) AS best FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)
ORDER BY best LIMIT 5000
