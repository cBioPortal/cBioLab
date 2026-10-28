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
    AND p.stable_id IN (SELECT pid FROM anch) AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
base AS (
  SELECT lab.pid AS pid, max(lab.day) AS bday,
         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b
  FROM lab INNER JOIN anch ON anch.pid = lab.pid
  WHERE lab.day >= anch.day - 90 AND lab.day <= anch.day GROUP BY lab.pid
),
chg AS (
  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc
  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid
  WHERE base.b > 0 AND lab.day != base.bday
    AND lab.day - anch.day >= -84 AND lab.day - anch.day <= 364
)
SELECT 'best' AS what, toInt32(floor((least(300, greatest(-100, best)) - (-100) + 1) / 2)) AS pbin, count() AS n FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid) GROUP BY pbin
UNION ALL SELECT 'responders' AS what, 0 AS pbin, countIf(best <= -50) AS n FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)
UNION ALL SELECT 'anchored' AS what, 0 AS pbin, count() AS n FROM anch
UNION ALL SELECT 'baseline' AS what, 0 AS pbin, count() AS n FROM base
UNION ALL SELECT 'positive_baseline' AS what, 0 AS pbin, countIf(b > 0) AS n FROM base
UNION ALL SELECT 'after' AS what, 0 AS pbin, uniqExactIf(pid, rel > 0) AS n FROM chg

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
    AND p.stable_id IN (SELECT pid FROM anch) AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
base AS (
  SELECT lab.pid AS pid, max(lab.day) AS bday,
         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b
  FROM lab INNER JOIN anch ON anch.pid = lab.pid
  WHERE lab.day >= anch.day - 90 AND lab.day <= anch.day GROUP BY lab.pid
),
chg AS (
  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc
  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid
  WHERE base.b > 0 AND lab.day != base.bday
    AND lab.day - anch.day >= -84 AND lab.day - anch.day <= 364
)
SELECT 'best' AS what, toInt32(floor((least(300, greatest(-100, best)) - (-100) + 1) / 2)) AS pbin, count() AS n FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid) GROUP BY pbin
UNION ALL SELECT 'responders' AS what, 0 AS pbin, countIf(best <= -50) AS n FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)
UNION ALL SELECT 'anchored' AS what, 0 AS pbin, count() AS n FROM anch
UNION ALL SELECT 'baseline' AS what, 0 AS pbin, count() AS n FROM base
UNION ALL SELECT 'positive_baseline' AS what, 0 AS pbin, countIf(b > 0) AS n FROM base
UNION ALL SELECT 'after' AS what, 0 AS pbin, uniqExactIf(pid, rel > 0) AS n FROM chg

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
    AND p.stable_id IN (SELECT pid FROM anch) AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
base AS (
  SELECT lab.pid AS pid, max(lab.day) AS bday,
         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b
  FROM lab INNER JOIN anch ON anch.pid = lab.pid
  WHERE lab.day >= anch.day - 90 AND lab.day <= anch.day GROUP BY lab.pid
),
chg AS (
  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc
  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid
  WHERE base.b > 0 AND lab.day != base.bday
    AND lab.day - anch.day >= -84 AND lab.day - anch.day <= 364
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
    AND p.stable_id IN (SELECT pid FROM anch) AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
base AS (
  SELECT lab.pid AS pid, max(lab.day) AS bday,
         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b
  FROM lab INNER JOIN anch ON anch.pid = lab.pid
  WHERE lab.day >= anch.day - 90 AND lab.day <= anch.day GROUP BY lab.pid
),
chg AS (
  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc
  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid
  WHERE base.b > 0 AND lab.day != base.bday
    AND lab.day - anch.day >= -84 AND lab.day - anch.day <= 364
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
    AND p.stable_id IN (SELECT pid FROM anch) AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
base AS (
  SELECT lab.pid AS pid, max(lab.day) AS bday,
         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b
  FROM lab INNER JOIN anch ON anch.pid = lab.pid
  WHERE lab.day >= anch.day - 90 AND lab.day <= anch.day GROUP BY lab.pid
),
chg AS (
  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc
  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid
  WHERE base.b > 0 AND lab.day != base.bday
    AND lab.day - anch.day >= -84 AND lab.day - anch.day <= 364
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
    AND p.stable_id IN (SELECT pid FROM anch) AND if(isFinite(ifNull(toFloat64OrNull(r.value), nan)), toFloat64OrNull(r.value), NULL) IS NOT NULL
),
base AS (
  SELECT lab.pid AS pid, max(lab.day) AS bday,
         arrayAvg(arrayMap((x) -> assumeNotNull(x.1), arrayFilter((x) -> x.2 = bday, groupArray((lab.v, lab.day))))) AS b
  FROM lab INNER JOIN anch ON anch.pid = lab.pid
  WHERE lab.day >= anch.day - 90 AND lab.day <= anch.day GROUP BY lab.pid
),
chg AS (
  SELECT lab.pid AS pid, lab.day - anch.day AS rel, 100 * (lab.v - base.b) / base.b AS pc
  FROM lab INNER JOIN anch ON anch.pid = lab.pid INNER JOIN base ON base.pid = lab.pid
  WHERE base.b > 0 AND lab.day != base.bday
    AND lab.day - anch.day >= -84 AND lab.day - anch.day <= 364
)
SELECT round(best, 1) AS best FROM (SELECT pid, min(pc) AS best FROM chg WHERE rel > 0 GROUP BY pid)
ORDER BY best LIMIT 5000
