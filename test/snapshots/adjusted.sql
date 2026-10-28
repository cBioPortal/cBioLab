-- cohort Early-onset CRC
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '<='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '<'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) - 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) < 50) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '<='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '<'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) - 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) < 50)))

-- cohort Average-onset CRC
-- msk_impact_50k_2026
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '>='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '>'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) + 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) >= 50) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '>='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '>'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) + 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) >= 50)))

-- view 0 adjusted: adjusted:panels · msk_impact_50k_2026
SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes
FROM snapshot_db.gene_panel_to_gene_derived pg
WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND alteration_type = 'MUTATION_EXTENDED')
GROUP BY panel

-- view 0 adjusted: adjusted:panels · msk_impact_50k_2026
SELECT toString(pg.gene_panel_id) AS panel, groupUniqArray(pg.gene) AS genes
FROM snapshot_db.gene_panel_to_gene_derived pg
WHERE pg.gene_panel_id IN (SELECT DISTINCT gene_panel_id FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND alteration_type = 'MUTATION_EXTENDED')
GROUP BY panel

-- view 0 adjusted: adjusted:rows:Average-onset CRC · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '>='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '>'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) + 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) >= 50) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '>='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '>'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) + 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) >= 50)))),
panels AS (
  SELECT replaceOne(sd.patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_impact_50k_2026' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND replaceOne(g.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
attrs AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         argMinIf(attribute_value, sample_unique_id, attribute_name = 'MSI_TYPE') AS a0,
         argMinIf(attribute_value, sample_unique_id, attribute_name = 'TMB_SCORE') AS a1
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name IN ('MSI_TYPE','TMB_SCORE') AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
)
SELECT panels.panels AS panels, mut.genes AS genes, attrs.a0 AS c0, attrs.a1 AS c1
FROM panels
  LEFT JOIN mut ON mut.pid = panels.pid
  LEFT JOIN attrs ON attrs.pid = panels.pid


-- view 0 adjusted: adjusted:rows:Early-onset CRC · msk_impact_50k_2026
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '<='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '<'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) - 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) < 50) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_50k_2026_', ''), replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'
    AND attribute_name = 'AGE_AT_DX' AND multiIf(startsWith(attribute_value, '<='), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 3)), nan)), toFloat64OrNull(substring(attribute_value, 3)), NULL), startsWith(attribute_value, '<'), if(isFinite(ifNull(toFloat64OrNull(substring(attribute_value, 2)), nan)), toFloat64OrNull(substring(attribute_value, 2)), NULL) - 1e-10, if(isFinite(ifNull(toFloat64OrNull(attribute_value), nan)), toFloat64OrNull(attribute_value), NULL)) < 50)))),
panels AS (
  SELECT replaceOne(sd.patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, groupUniqArray(toString(sp.gene_panel_id)) AS panels
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
mut AS (
  SELECT replaceOne(g.patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, groupUniqArray(g.hugo_gene_symbol) AS genes
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_impact_50k_2026' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
    AND replaceOne(g.sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
  GROUP BY pid
),
attrs AS (
  SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid,
         argMinIf(attribute_value, sample_unique_id, attribute_name = 'MSI_TYPE') AS a0,
         argMinIf(attribute_value, sample_unique_id, attribute_name = 'TMB_SCORE') AS a1
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND attribute_name IN ('MSI_TYPE','TMB_SCORE') AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
)
SELECT panels.panels AS panels, mut.genes AS genes, attrs.a0 AS c0, attrs.a1 AS c1
FROM panels
  LEFT JOIN mut ON mut.pid = panels.pid
  LEFT JOIN attrs ON attrs.pid = panels.pid

