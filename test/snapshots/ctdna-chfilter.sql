-- cohort all patients
-- msk_access_2021
SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'

-- view 0 ctdna: ctdna:ch-removed:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
nm AS (
  SELECT concat(studyId, '_', sampleId) AS suid, `GENE.hugoGeneSymbol` AS gene, proteinChange AS mv,
         max(normalAltCount >= 2 AND normalAltCount / (normalAltCount + normalRefCount) >= 0.3 * tumorAltCount / greatest(1, tumorAltCount + tumorRefCount)) AS hit, max(normalAltCount IS NOT NULL) AS loaded
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_access_2021_') AND studyId = 'msk_access_2021' AND concat(studyId, '_', sampleId) IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
chx AS (
  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene, g.mutation_variant AS mv,
         max(g.hugo_gene_symbol IN ('DNMT3A','TET2','ASXL1','PPM1D','JAK2','SF3B1','SRSF2','U2AF1','CBL','GNB1','GNAS','IDH2')) AS by_gene, max(ifNull(nm.hit, 0) = 1) AS by_normal,
         max(ifNull(nm.loaded, 0) = 1) AS has_normal
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN nm ON nm.suid = g.sample_unique_id AND nm.gene = g.hugo_gene_symbol AND nm.mv = g.mutation_variant
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND g.variant_type = 'mutation'
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
)
SELECT chx.gene AS gene, countIf(by_gene OR by_normal) AS calls, uniqExactIf(s.pid, by_gene OR by_normal) AS patients,
       countIf(by_gene) AS gene_calls, countIf(by_normal) AS normal_calls
FROM chx INNER JOIN sides s ON s.suid = chx.suid
GROUP BY gene HAVING calls > 0 ORDER BY calls DESC, gene LIMIT 40

-- view 0 ctdna: ctdna:funnel:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
nm AS (
  SELECT concat(studyId, '_', sampleId) AS suid, `GENE.hugoGeneSymbol` AS gene, proteinChange AS mv,
         max(normalAltCount >= 2 AND normalAltCount / (normalAltCount + normalRefCount) >= 0.3 * tumorAltCount / greatest(1, tumorAltCount + tumorRefCount)) AS hit, max(normalAltCount IS NOT NULL) AS loaded
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_access_2021_') AND studyId = 'msk_access_2021' AND concat(studyId, '_', sampleId) IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
chx AS (
  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene, g.mutation_variant AS mv,
         max(g.hugo_gene_symbol IN ('DNMT3A','TET2','ASXL1','PPM1D','JAK2','SF3B1','SRSF2','U2AF1','CBL','GNB1','GNAS','IDH2')) AS by_gene, max(ifNull(nm.hit, 0) = 1) AS by_normal,
         max(ifNull(nm.loaded, 0) = 1) AS has_normal
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN nm ON nm.suid = g.sample_unique_id AND nm.gene = g.hugo_gene_symbol AND nm.mv = g.mutation_variant
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND g.variant_type = 'mutation'
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
det AS (
  SELECT DISTINCT s.pid AS pid FROM snapshot_db.genomic_event_derived g
  INNER JOIN sides s ON s.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND s.side = 'b' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b') AND NOT (s.side = 'b' AND g.variant_type = 'mutation' AND (g.sample_unique_id, g.hugo_gene_symbol, g.mutation_variant) IN (SELECT suid, gene, mv FROM chx WHERE by_gene OR by_normal))
)
SELECT (SELECT uniqExactIf(pid, side = 'b') FROM classed) AS plasma_all, (SELECT uniqExactIf(pid, side = 'a') FROM classed) AS tissue_all,
       (SELECT uniqExactIf(pid, side = 'b') FROM sides) AS plasma, (SELECT uniqExactIf(pid, side = 'a') FROM sides) AS tissue,
       (SELECT count() FROM paired) AS both, (SELECT count() FROM det) AS detected,
       (SELECT countIf(side = 'b') FROM ps) AS plasma_samples, (SELECT countIf(side = 'a') FROM ps) AS tissue_samples,
       toUInt64(0) AS dated_samples,
       (SELECT count() FROM chx) AS ch_calls, (SELECT countIf(has_normal) FROM chx) AS ch_with_normal,
       (SELECT countIf(by_gene) FROM chx) AS ch_by_gene, (SELECT countIf(by_normal) FROM chx) AS ch_by_normal, (SELECT countIf(by_gene OR by_normal) FROM chx) AS ch_removed,
       (SELECT uniqExact(s.pid) FROM chx INNER JOIN sides s ON s.suid = chx.suid WHERE by_gene OR by_normal) AS ch_patients
FROM system.one

-- view 0 ctdna: ctdna:genes:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
nm AS (
  SELECT concat(studyId, '_', sampleId) AS suid, `GENE.hugoGeneSymbol` AS gene, proteinChange AS mv,
         max(normalAltCount >= 2 AND normalAltCount / (normalAltCount + normalRefCount) >= 0.3 * tumorAltCount / greatest(1, tumorAltCount + tumorRefCount)) AS hit, max(normalAltCount IS NOT NULL) AS loaded
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_access_2021_') AND studyId = 'msk_access_2021' AND concat(studyId, '_', sampleId) IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
chx AS (
  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene, g.mutation_variant AS mv,
         max(g.hugo_gene_symbol IN ('DNMT3A','TET2','ASXL1','PPM1D','JAK2','SF3B1','SRSF2','U2AF1','CBL','GNB1','GNAS','IDH2')) AS by_gene, max(ifNull(nm.hit, 0) = 1) AS by_normal,
         max(ifNull(nm.loaded, 0) = 1) AS has_normal
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN nm ON nm.suid = g.sample_unique_id AND nm.gene = g.hugo_gene_symbol AND nm.mv = g.mutation_variant
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND g.variant_type = 'mutation'
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
alt AS (
  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, 1 AS hit
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN ps ON ps.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps) AND NOT (ps.side = 'b' AND g.variant_type = 'mutation' AND (g.sample_unique_id, g.hugo_gene_symbol, g.mutation_variant) IN (SELECT suid, gene, mv FROM chx WHERE by_gene OR by_normal))
  GROUP BY gene, pid, side
  HAVING hit > 0
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT DISTINCT gene FROM alt)
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_access_2021'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene HAVING both + a_only + b_only > 0

-- view 0 ctdna: ctdna:survival:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
nm AS (
  SELECT concat(studyId, '_', sampleId) AS suid, `GENE.hugoGeneSymbol` AS gene, proteinChange AS mv,
         max(normalAltCount >= 2 AND normalAltCount / (normalAltCount + normalRefCount) >= 0.3 * tumorAltCount / greatest(1, tumorAltCount + tumorRefCount)) AS hit, max(normalAltCount IS NOT NULL) AS loaded
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_access_2021_') AND studyId = 'msk_access_2021' AND concat(studyId, '_', sampleId) IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
chx AS (
  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene, g.mutation_variant AS mv,
         max(g.hugo_gene_symbol IN ('DNMT3A','TET2','ASXL1','PPM1D','JAK2','SF3B1','SRSF2','U2AF1','CBL','GNB1','GNAS','IDH2')) AS by_gene, max(ifNull(nm.hit, 0) = 1) AS by_normal,
         max(ifNull(nm.loaded, 0) = 1) AS has_normal
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN nm ON nm.suid = g.sample_unique_id AND nm.gene = g.hugo_gene_symbol AND nm.mv = g.mutation_variant
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND g.variant_type = 'mutation'
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
  GROUP BY suid, gene, mv
),
det AS (
  SELECT DISTINCT s.pid AS pid FROM snapshot_db.genomic_event_derived g
  INNER JOIN sides s ON s.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND s.side = 'b' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b') AND NOT (s.side = 'b' AND g.variant_type = 'mutation' AND (g.sample_unique_id, g.hugo_gene_symbol, g.mutation_variant) IN (SELECT suid, gene, mv FROM chx WHERE by_gene OR by_normal))
),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL), NULL) AS months,
         if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), NULL) = 1, 1, 0) AS dead, replaceOne(patient_unique_id, 'msk_access_2021_', '') IN (SELECT pid FROM det) AS detected
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_access_2021_', '') IN (SELECT pid FROM sides WHERE side = 'b')
  GROUP BY pid
)
SELECT detected, round(months, 2) AS t, dead, count() AS n
FROM os WHERE months IS NOT NULL AND months >= 0 GROUP BY detected, t, dead ORDER BY t

-- view 0 ctdna: ctdna:unfiltered:funnel:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
det AS (
  SELECT DISTINCT s.pid AS pid FROM snapshot_db.genomic_event_derived g
  INNER JOIN sides s ON s.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND s.side = 'b' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
)
SELECT (SELECT uniqExactIf(pid, side = 'b') FROM classed) AS plasma_all, (SELECT uniqExactIf(pid, side = 'a') FROM classed) AS tissue_all,
       (SELECT uniqExactIf(pid, side = 'b') FROM sides) AS plasma, (SELECT uniqExactIf(pid, side = 'a') FROM sides) AS tissue,
       (SELECT count() FROM paired) AS both, (SELECT count() FROM det) AS detected,
       (SELECT countIf(side = 'b') FROM ps) AS plasma_samples, (SELECT countIf(side = 'a') FROM ps) AS tissue_samples,
       toUInt64(0) AS dated_samples
FROM system.one

-- view 0 ctdna: ctdna:unfiltered:genes:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
alt AS (
  SELECT g.hugo_gene_symbol AS gene, ps.pid AS pid, ps.side AS side, 1 AS hit
  FROM snapshot_db.genomic_event_derived g
  INNER JOIN ps ON ps.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND g.hugo_gene_symbol IN ('TP53','EGFR','KRAS','CDKN2A','TERT','ARID1A','KEAP1','PIK3CA','SMAD4','AR','RB1','ATM','STK11','SMARCA4','APC') AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM ps)
  GROUP BY gene, pid, side
),
cov AS (
  SELECT DISTINCT pg.gene AS gene, ps.pid AS pid, ps.side AS side
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('TP53','EGFR','KRAS','CDKN2A','TERT','ARID1A','KEAP1','PIK3CA','SMAD4','AR','RB1','ATM','STK11','SMARCA4','APC')
  INNER JOIN ps ON ps.suid = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_access_2021'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
per AS (
  SELECT gene, pid, max(side = 'a') AS pa, max(side = 'b') AS pb,
         max(side = 'a' AND hit > 0) AS aa, max(side = 'b' AND hit > 0) AS ab
  FROM (SELECT gene, pid, side, hit FROM alt UNION ALL SELECT gene, pid, side, 0 AS hit FROM cov)
  GROUP BY gene, pid
)
SELECT gene, count() AS pairs, countIf(aa AND ab) AS both, countIf(aa AND NOT ab) AS a_only, countIf(ab AND NOT aa) AS b_only
FROM per WHERE pa AND pb GROUP BY gene

-- view 0 ctdna: ctdna:unfiltered:survival:all patients · msk_access_2021
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, replaceOne(sample_unique_id, 'msk_access_2021_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_access_2021'),
cls AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS v
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'sample' AND attribute_name = 'SAMPLE_CLASS'
    AND replaceOne(sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
  GROUP BY suid
),
classed AS (
  SELECT sd.sample_unique_id AS suid, sd.patient_stable_id AS pid, sd.sample_stable_id AS sample,
         multiIf(sd.sample_unique_id IN (SELECT sample_unique_id FROM snapshot_db.sample_to_gene_panel_derived WHERE cancer_study_identifier = 'msk_access_2021' AND gene_panel_id IN ('ACCESS129')), 'b', cls.v IN (lowerUTF8(trimBoth('cfDNA')),lowerUTF8(trimBoth('ctDNA'))), 'b', cls.v IN (lowerUTF8(trimBoth('Tumor'))), 'a', '') AS side
  FROM snapshot_db.sample_derived sd LEFT JOIN cls ON cls.suid = sd.sample_unique_id
  WHERE sd.cancer_study_identifier = 'msk_access_2021' AND replaceOne(sd.sample_unique_id, 'msk_access_2021_', '') IN (SELECT sid FROM cohort)
),
sides AS (SELECT suid, pid, side FROM classed WHERE side != ''),
paired AS (SELECT pid FROM sides GROUP BY pid HAVING countIf(side = 'a') > 0 AND countIf(side = 'b') > 0),
ps AS (SELECT suid, pid, side FROM sides WHERE pid IN (SELECT pid FROM paired)),
det AS (
  SELECT DISTINCT s.pid AS pid FROM snapshot_db.genomic_event_derived g
  INNER JOIN sides s ON s.suid = g.sample_unique_id
  WHERE g.cancer_study_identifier = 'msk_access_2021' AND s.side = 'b' AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM sides WHERE side = 'b')
),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_access_2021_', '') AS pid, if(lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND lowerUTF8(trimBoth(ifNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS'), ''))) NOT IN ('[not applicable]', '[not available]', '[pending]', '[discrepancy]', '[completed]', '[null]', '', 'na') AND if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL) >= 0, if(isFinite(ifNull(toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), nan)), toFloat64OrNull(trimBoth(anyIf(attribute_value, attribute_name = 'OS_MONTHS'))), NULL), NULL) AS months,
         if(if(isFinite(ifNull(toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), nan)), toFloat64OrNull(trimBoth(splitByChar(':', ifNull(anyIf(attribute_value, attribute_name = 'OS_STATUS'), ''))[1])), NULL) = 1, 1, 0) AS dead, replaceOne(patient_unique_id, 'msk_access_2021_', '') IN (SELECT pid FROM det) AS detected
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_access_2021' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'msk_access_2021_', '') IN (SELECT pid FROM sides WHERE side = 'b')
  GROUP BY pid
)
SELECT detected, round(months, 2) AS t, dead, count() AS n
FROM os WHERE months IS NOT NULL AND months >= 0 GROUP BY detected, t, dead ORDER BY t
