-- cohort all samples
-- brca_tcga_pan_can_atlas_2018
SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'

-- view 0 plot: plot:box · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id,
       argMax(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL), 1) AS v
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY id),
     gs AS (SELECT id, if(uniqExact(lv) > 1, 'Multiple', any(lv)) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, multiIf(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -2, 'Deep deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -1, 'Shallow deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 0, 'Diploid', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 1, 'Gain', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 2, 'Amplification', toString(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))) AS lv
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'gistic' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort))
GROUP BY id)
SELECT gs.v AS g, count() AS n, min(vs.v) AS lo, max(vs.v) AS hi,
       quantilesExact(0.25, 0.5, 0.75)(vs.v) AS q
FROM vs INNER JOIN gs ON gs.id = vs.id
GROUP BY g ORDER BY n DESC LIMIT 151

-- view 0 plot: plot:coverage · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     cases AS (SELECT DISTINCT sid AS id FROM cohort),
     xs AS (SELECT id, if(uniqExact(lv) > 1, 'Multiple', any(lv)) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, multiIf(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -2, 'Deep deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -1, 'Shallow deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 0, 'Diploid', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 1, 'Gain', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 2, 'Amplification', toString(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))) AS lv
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'gistic' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort))
GROUP BY id),
     ys AS (SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id,
       argMax(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL), 1) AS v
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY id)
SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny FROM cases

-- view 0 plot: plot:outliers · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id,
       argMax(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL), 1) AS v
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY id),
     gs AS (SELECT id, if(uniqExact(lv) > 1, 'Multiple', any(lv)) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, multiIf(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -2, 'Deep deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -1, 'Shallow deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 0, 'Diploid', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 1, 'Gain', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 2, 'Amplification', toString(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))) AS lv
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'gistic' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort))
GROUP BY id)
SELECT vs.id AS id, gs.v AS g, vs.v AS v, count() OVER () AS total
FROM vs INNER JOIN gs ON gs.id = vs.id
WHERE indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v) > 0 AND (vs.v < arrayElement([-1.7658, -1.2746, -1.1975, -0.5985500000000004], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)) OR vs.v > arrayElement([0.351, 1.0078, 1.3825, 3.7214], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)))
ORDER BY if(vs.v > arrayElement([0.351, 1.0078, 1.3825, 3.7214], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)), vs.v - arrayElement([0.351, 1.0078, 1.3825, 3.7214], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)), arrayElement([-1.7658, -1.2746, -1.1975, -0.5985500000000004], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)) - vs.v) / if(arrayElement([0.351, 1.0078, 1.3825, 3.7214], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)) > arrayElement([-1.7658, -1.2746, -1.1975, -0.5985500000000004], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)), arrayElement([0.351, 1.0078, 1.3825, 3.7214], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)) - arrayElement([-1.7658, -1.2746, -1.1975, -0.5985500000000004], indexOf(['Shallow deletion', 'Diploid', 'Gain', 'Amplification'], gs.v)), 1) DESC, id
LIMIT 10000

-- view 0 plot: plot:points · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id,
       argMax(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL), 1) AS v
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY id),
     gs AS (SELECT id, if(uniqExact(lv) > 1, 'Multiple', any(lv)) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, multiIf(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -2, 'Deep deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -1, 'Shallow deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 0, 'Diploid', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 1, 'Gain', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 2, 'Amplification', toString(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))) AS lv
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'gistic' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort))
GROUP BY id)
SELECT vs.id AS id, gs.v AS g, vs.v AS v
FROM vs INNER JOIN gs ON gs.id = vs.id
LIMIT 10001

-- view 0 plot: plot:violin · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id,
       argMax(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL), 1) AS v
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY id),
     gs AS (SELECT id, if(uniqExact(lv) > 1, 'Multiple', any(lv)) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, multiIf(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -2, 'Deep deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = -1, 'Shallow deletion', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 0, 'Diploid', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 1, 'Gain', if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) = 2, 'Amplification', toString(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))) AS lv
FROM snapshot_db.genetic_alteration_derived ga
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'gistic' AND ga.hugo_gene_symbol = 'ERBB2'
  AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND replaceOne(ga.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort))
GROUP BY id),
     j AS (SELECT gs.v AS g, vs.v AS x FROM vs INNER JOIN gs ON gs.id = vs.id),
     e AS (SELECT quantileExact(0.005)(x) x0, quantileExact(0.995)(x) x1 FROM j)
SELECT g, least(39, toUInt32(floor((x - x0) / if(x1 > x0, x1 - x0, 1) * 40))) AS b, count() AS n, any(x0) AS vx0, any(x1) AS vx1
FROM j, e GROUP BY g, b

-- view 1 plot: plot:box · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND attribute_name = 'FRACTION_GENOME_ALTERED' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  UNION ALL
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) cd
  JOIN snapshot_db.sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id
  WHERE cd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND cd.attribute_name = 'FRACTION_GENOME_ALTERED' AND cd.attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) IS NOT NULL
    AND cd.type = 'patient' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS alt_case, multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated', length(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation')) > 1, 'Multiple', arrayElement(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation'), 1)) AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case))
SELECT gs.v AS g, count() AS n, min(vs.v) AS lo, max(vs.v) AS hi,
       quantilesExact(0.25, 0.5, 0.75)(vs.v) AS q
FROM vs INNER JOIN gs ON gs.id = vs.id
GROUP BY g ORDER BY n DESC LIMIT 151

-- view 1 plot: plot:coverage · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     cases AS (SELECT DISTINCT sid AS id FROM cohort),
     xs AS (SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS alt_case, multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated', length(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation')) > 1, 'Multiple', arrayElement(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation'), 1)) AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case)),
     ys AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND attribute_name = 'FRACTION_GENOME_ALTERED' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  UNION ALL
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) cd
  JOIN snapshot_db.sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id
  WHERE cd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND cd.attribute_name = 'FRACTION_GENOME_ALTERED' AND cd.attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) IS NOT NULL
    AND cd.type = 'patient' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id)
SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny FROM cases

-- view 1 plot: plot:outliers · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND attribute_name = 'FRACTION_GENOME_ALTERED' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  UNION ALL
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) cd
  JOIN snapshot_db.sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id
  WHERE cd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND cd.attribute_name = 'FRACTION_GENOME_ALTERED' AND cd.attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) IS NOT NULL
    AND cd.type = 'patient' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS alt_case, multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated', length(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation')) > 1, 'Multiple', arrayElement(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation'), 1)) AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case))
SELECT vs.id AS id, gs.v AS g, vs.v AS v, count() OVER () AS total
FROM vs INNER JOIN gs ON gs.id = vs.id
WHERE indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v) > 0 AND (vs.v < arrayElement([0, 0, 0.0002, 0.0027, 0, 0.2493, 0.17855000000000004], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)) OR vs.v > arrayElement([0.7076499999999999, 0.9122, 0.947, 0.8331, 0.41095000000000004, 0.5605, 0.6513], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)))
ORDER BY if(vs.v > arrayElement([0.7076499999999999, 0.9122, 0.947, 0.8331, 0.41095000000000004, 0.5605, 0.6513], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)), vs.v - arrayElement([0.7076499999999999, 0.9122, 0.947, 0.8331, 0.41095000000000004, 0.5605, 0.6513], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)), arrayElement([0, 0, 0.0002, 0.0027, 0, 0.2493, 0.17855000000000004], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)) - vs.v) / if(arrayElement([0.7076499999999999, 0.9122, 0.947, 0.8331, 0.41095000000000004, 0.5605, 0.6513], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)) > arrayElement([0, 0, 0.0002, 0.0027, 0, 0.2493, 0.17855000000000004], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)), arrayElement([0.7076499999999999, 0.9122, 0.947, 0.8331, 0.41095000000000004, 0.5605, 0.6513], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)) - arrayElement([0, 0, 0.0002, 0.0027, 0, 0.2493, 0.17855000000000004], indexOf(['Not mutated', 'Missense', 'Truncating', 'Splice', 'Not profiled', 'Inframe', 'Multiple'], gs.v)), 1) DESC, id
LIMIT 10000

-- view 1 plot: plot:points · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND attribute_name = 'FRACTION_GENOME_ALTERED' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  UNION ALL
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) cd
  JOIN snapshot_db.sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id
  WHERE cd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND cd.attribute_name = 'FRACTION_GENOME_ALTERED' AND cd.attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) IS NOT NULL
    AND cd.type = 'patient' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS alt_case, multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated', length(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation')) > 1, 'Multiple', arrayElement(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation'), 1)) AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case))
SELECT vs.id AS id, gs.v AS g, vs.v AS v
FROM vs INNER JOIN gs ON gs.id = vs.id
LIMIT 10001

-- view 1 plot: plot:violin · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
     vs AS (SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), avgIf(v, pref = 0)) AS v FROM (
SELECT replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) AS v, 1 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND attribute_name = 'FRACTION_GENOME_ALTERED' AND attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL) IS NOT NULL
    AND type = 'sample' AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  UNION ALL
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS id, if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) AS v, 0 AS pref
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) cd
  JOIN snapshot_db.sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id
  WHERE cd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND cd.attribute_name = 'FRACTION_GENOME_ALTERED' AND cd.attribute_value != '' AND if(isFinite(ifNull(toFloat64OrNull(cd.attribute_value), nan)), toFloat64OrNull(cd.attribute_value), NULL) IS NOT NULL
    AND cd.type = 'patient' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
) GROUP BY id),
     gs AS (SELECT alt_case AS id, if(hits = 0 AND NOT (p0 = 1), 'Not profiled', v0) AS v FROM (
SELECT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS alt_case, multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated', length(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation')) > 1, 'Multiple', arrayElement(groupUniqArrayIf(multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense', lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating', lower(g.mutation_type) LIKE 'splice%', 'Splice', lower(g.mutation_type) LIKE 'in_frame%', 'Inframe', lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other'), g.variant_type = 'mutation'), 1)) AS v0, countIf(g.variant_type = 'mutation') AS hits,
  max(replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT profiled_id FROM (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))) AS p0
FROM snapshot_db.sample_derived sd
LEFT JOIN (
     SELECT sample_unique_id, mutation_type, variant_type, cna_alteration
     FROM snapshot_db.genomic_event_derived
     WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND hugo_gene_symbol IN ('TP53')
       AND mutation_status != 'UNCALLED'
) g ON g.sample_unique_id = sd.sample_unique_id
WHERE sd.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY alt_case)),
     j AS (SELECT gs.v AS g, vs.v AS x FROM vs INNER JOIN gs ON gs.id = vs.id),
     e AS (SELECT quantileExact(0.005)(x) x0, quantileExact(0.995)(x) x1 FROM j)
SELECT g, least(39, toUInt32(floor((x - x0) / if(x1 > x0, x1 - x0, 1) * 40))) AS b, count() AS n, any(x0) AS vx0, any(x1) AS vx1
FROM j, e GROUP BY g, b
