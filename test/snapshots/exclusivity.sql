-- cohort NSCLC
-- msk_impact_2017
(SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))

-- view 0 exclusivity: exclusivity:columns:NSCLC · msk_impact_2017
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
sp AS (
  SELECT sample_unique_id AS suid, arrayStringConcat(arraySort(groupUniqArray(gene_panel_id)), '+') AS sig
  FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_2017' AND alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sample_unique_id, 'msk_impact_2017_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
cov AS (
  SELECT DISTINCT s.sig AS sig, pg.gene AS gene
  FROM (SELECT DISTINCT sig, arrayJoin(splitByChar('+', sig)) AS panel FROM sp) s
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = s.panel
),
altc AS (
  SELECT DISTINCT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN sp ON sp.suid = g.sample_unique_id
  INNER JOIN cov ON cov.sig = sp.sig AND cov.gene = g.hugo_gene_symbol
  WHERE g.cancer_study_identifier = 'msk_impact_2017' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sp)
),
strat AS (
  SELECT suid, '' AS v FROM sp
)
SELECT ifNull(strat.v, '') AS stratum, altc.gene AS gene, count() AS n
FROM altc LEFT JOIN strat ON strat.suid = altc.suid GROUP BY stratum, gene

-- view 0 exclusivity: exclusivity:coverage:NSCLC · msk_impact_2017
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
sp AS (
  SELECT sample_unique_id AS suid, arrayStringConcat(arraySort(groupUniqArray(gene_panel_id)), '+') AS sig
  FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_2017' AND alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sample_unique_id, 'msk_impact_2017_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
cov AS (
  SELECT DISTINCT s.sig AS sig, pg.gene AS gene
  FROM (SELECT DISTINCT sig, arrayJoin(splitByChar('+', sig)) AS panel FROM sp) s
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = s.panel
),
altc AS (
  SELECT DISTINCT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN sp ON sp.suid = g.sample_unique_id
  INNER JOIN cov ON cov.sig = sp.sig AND cov.gene = g.hugo_gene_symbol
  WHERE g.cancer_study_identifier = 'msk_impact_2017' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sp)
),
strat AS (
  SELECT suid, '' AS v FROM sp
)
SELECT sig, gene FROM cov

-- view 0 exclusivity: exclusivity:groups:NSCLC · msk_impact_2017
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND (('sample', replaceOne(sample_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_impact_2017_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_impact_2017_', ''), replaceOne(patient_unique_id, 'msk_impact_2017_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
sp AS (
  SELECT sample_unique_id AS suid, arrayStringConcat(arraySort(groupUniqArray(gene_panel_id)), '+') AS sig
  FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_2017' AND alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sample_unique_id, 'msk_impact_2017_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
cov AS (
  SELECT DISTINCT s.sig AS sig, pg.gene AS gene
  FROM (SELECT DISTINCT sig, arrayJoin(splitByChar('+', sig)) AS panel FROM sp) s
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = s.panel
),
altc AS (
  SELECT DISTINCT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN sp ON sp.suid = g.sample_unique_id
  INNER JOIN cov ON cov.sig = sp.sig AND cov.gene = g.hugo_gene_symbol
  WHERE g.cancer_study_identifier = 'msk_impact_2017' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sp)
),
strat AS (
  SELECT suid, '' AS v FROM sp
),
per AS (SELECT suid, count() AS r, maxIf(1, altc.gene = 'KRAS') + maxIf(2, altc.gene = 'EGFR') + maxIf(4, altc.gene = 'BRAF') + maxIf(8, altc.gene = 'STK11') + maxIf(16, altc.gene = 'KEAP1') + maxIf(32, altc.gene = 'TP53') AS amask FROM altc GROUP BY suid)
SELECT sp.sig AS sig, ifNull(strat.v, '') AS stratum, per.r AS r, per.amask AS amask, count() AS n
FROM sp LEFT JOIN per ON per.suid = sp.suid LEFT JOIN strat ON strat.suid = sp.suid
GROUP BY sig, stratum, r, amask
