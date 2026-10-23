-- cohort BRCA
-- brca_tcga_pan_can_atlas_2018
(SELECT DISTINCT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED')

-- view 0 coexpression: pairMoments · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT DISTINCT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED')),
vals AS (
  SELECT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, ga.hugo_gene_symbol AS gene,
         avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna_median_Zscores'
    AND ga.hugo_gene_symbol IN ('ERBB2','GRB7','ESR1','PGR','MKI67')
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL
    AND replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid, gene
),
pp AS (SELECT pid, groupArray(gene) AS gs, groupArray(v) AS vs FROM vals GROUP BY pid)
SELECT ga, gb, countIf(ok) AS n,
       sumIf(x, ok) AS sx, sumIf(y, ok) AS sy,
       sumIf(x * y, ok) AS sxy, sumIf(x * x, ok) AS sxx, sumIf(y * y, ok) AS syy
FROM (
  SELECT ga, gb, indexOf(gs, ga) AS ia, indexOf(gs, gb) AS ib,
         (ia > 0 AND ib > 0) AS ok,
         if(ok, vs[ia], 0) AS x, if(ok, vs[ib], 0) AS y
  FROM pp
  ARRAY JOIN ['ERBB2','ERBB2','ERBB2','ERBB2','GRB7','GRB7','GRB7','ESR1','ESR1','PGR'] AS ga, ['GRB7','ESR1','PGR','MKI67','ESR1','PGR','MKI67','PGR','MKI67','MKI67'] AS gb
)
GROUP BY ga, gb
