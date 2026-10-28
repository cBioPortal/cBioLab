-- cohort Lung (TCGA)
-- luad_tcga_pan_can_atlas_2018
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- lusc_tcga_pan_can_atlas_2018
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'

-- cohort KRAS mut
-- luad_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- lusc_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- cohort TP53 mut
-- luad_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- lusc_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- view 0 plot: plot:bins · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)
,    e AS (SELECT 33 AS x0, 90 AS x1, 0 AS y0, 67.2 AS y1)
SELECT least(239, toUInt32(floor((x - x0) / if(x1 > x0, x1 - x0, 1) * 240))) AS bx,
       least(159, toUInt32(floor((y - y0) / if(y1 > y0, y1 - y0, 1) * 160))) AS by,
       count() AS n
FROM pair, e GROUP BY bx, by

-- view 0 plot: plot:bins · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)
,    e AS (SELECT 33 AS x0, 90 AS x1, 0 AS y0, 67.2 AS y1)
SELECT least(239, toUInt32(floor((x - x0) / if(x1 > x0, x1 - x0, 1) * 240))) AS bx,
       least(159, toUInt32(floor((y - y0) / if(y1 > y0, y1 - y0, 1) * 160))) AS by,
       count() AS n
FROM pair, e GROUP BY bx, by

-- view 0 plot: plot:coverage · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     cases AS (SELECT DISTINCT pid AS id FROM cohort),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny,
  (SELECT count() FROM (SELECT pid FROM cohort GROUP BY pid HAVING uniqExact(sid) > 1)) AS multi FROM cases

-- view 0 plot: plot:coverage · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     cases AS (SELECT DISTINCT pid AS id FROM cohort),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny,
  (SELECT count() FROM (SELECT pid FROM cohort GROUP BY pid HAVING uniqExact(sid) > 1)) AS multi FROM cases

-- view 0 plot: plot:extent · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)
SELECT count() AS n, min(x) AS x0, max(x) AS x1, min(y) AS y0, max(y) AS y1 FROM pair

-- view 0 plot: plot:extent · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)
SELECT count() AS n, min(x) AS x0, max(x) AS x1, min(y) AS y0, max(y) AS y1 FROM pair

-- view 0 plot: plot:highlight:count · luad_tcga_pan_can_atlas_2018
SELECT uniqExact(pid) AS n, uniqExact(sid) AS ns FROM (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))))

-- view 0 plot: plot:highlight:count · luad_tcga_pan_can_atlas_2018
SELECT uniqExact(pid) AS n, uniqExact(sid) AS ns FROM (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))))

-- view 0 plot: plot:highlight:count · lusc_tcga_pan_can_atlas_2018
SELECT uniqExact(pid) AS n, uniqExact(sid) AS ns FROM (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))))

-- view 0 plot: plot:highlight:count · lusc_tcga_pan_can_atlas_2018
SELECT uniqExact(pid) AS n, uniqExact(sid) AS ns FROM (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))))

-- view 0 plot: plot:highlight:points · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))))),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT xs.id AS id, xs.v AS x, ys.v AS y
FROM xs INNER JOIN ys ON ys.id = xs.id
LIMIT 10001

-- view 0 plot: plot:highlight:points · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))))),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT xs.id AS id, xs.v AS x, ys.v AS y
FROM xs INNER JOIN ys ON ys.id = xs.id
LIMIT 9843

-- view 0 plot: plot:highlight:points · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))))),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT xs.id AS id, xs.v AS x, ys.v AS y
FROM xs INNER JOIN ys ON ys.id = xs.id
LIMIT 10001

-- view 0 plot: plot:highlight:points · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))))),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT xs.id AS id, xs.v AS x, ys.v AS y
FROM xs INNER JOIN ys ON ys.id = xs.id
LIMIT 9843

-- view 0 plot: plot:moments · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)
SELECT count() AS n, sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx, sum(y * y) AS syy
FROM pair

-- view 0 plot: plot:moments · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'AGE' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)
SELECT count() AS n, sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx, sum(y * y) AS syy
FROM pair

-- view 1 plot: plot:box · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT gs.v AS g, count() AS n, min(vs.v) AS lo, max(vs.v) AS hi,
       quantilesExact(0.25, 0.5, 0.75)(vs.v) AS q
FROM vs INNER JOIN gs ON gs.id = vs.id
GROUP BY g ORDER BY n DESC LIMIT 151

-- view 1 plot: plot:box · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT gs.v AS g, count() AS n, min(vs.v) AS lo, max(vs.v) AS hi,
       quantilesExact(0.25, 0.5, 0.75)(vs.v) AS q
FROM vs INNER JOIN gs ON gs.id = vs.id
GROUP BY g ORDER BY n DESC LIMIT 151

-- view 1 plot: plot:coverage · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     cases AS (SELECT DISTINCT pid AS id FROM cohort),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny,
  (SELECT count() FROM (SELECT pid FROM cohort GROUP BY pid HAVING uniqExact(sid) > 1)) AS multi FROM cases

-- view 1 plot: plot:coverage · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     cases AS (SELECT DISTINCT pid AS id FROM cohort),
     xs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny,
  (SELECT count() FROM (SELECT pid FROM cohort GROUP BY pid HAVING uniqExact(sid) > 1)) AS multi FROM cases

-- view 1 plot: plot:highlight:count · luad_tcga_pan_can_atlas_2018
SELECT uniqExact(pid) AS n, uniqExact(sid) AS ns FROM (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))))

-- view 1 plot: plot:highlight:count · lusc_tcga_pan_can_atlas_2018
SELECT uniqExact(pid) AS n, uniqExact(sid) AS ns FROM (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))))

-- view 1 plot: plot:highlight:points · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))))),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT vs.id AS id, gs.v AS g, vs.v AS v
FROM vs INNER JOIN gs ON gs.id = vs.id
LIMIT 10001

-- view 1 plot: plot:highlight:points · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT pid, sid FROM (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018') WHERE sid IN (SELECT sid FROM ((SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol = 'KRAS'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))))),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT vs.id AS id, gs.v AS g, vs.v AS v
FROM vs INNER JOIN gs ON gs.id = vs.id
LIMIT 10001

-- view 1 plot: plot:points · luad_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'luad_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'luad_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT vs.id AS id, gs.v AS g, vs.v AS v
FROM vs INNER JOIN gs ON gs.id = vs.id
LIMIT 10001

-- view 1 plot: plot:points · lusc_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'TMB_NONSYNONYMOUS' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), if(uniqExactIf(v, pref = 0) > 1, 'Multiple', anyIf(v, pref = 0))) AS v FROM (
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'patient' AND replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  UNION ALL
SELECT replaceOne(patient_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') AS id, attribute_value AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'lusc_tcga_pan_can_atlas_2018' AND attribute_name = 'SEX' AND attribute_value != ''
    AND type = 'sample' AND replaceOne(sample_unique_id, 'lusc_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT vs.id AS id, gs.v AS g, vs.v AS v
FROM vs INNER JOIN gs ON gs.id = vs.id
LIMIT 10001
