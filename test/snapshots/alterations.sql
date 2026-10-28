-- cohort Prostate
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))

-- view 0 alterations: alterations:cna:counts · msk_chord_2024
WITH c AS (
  SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS gene, cna_alteration AS alt, cna_cytoband AS cytoband
  FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0024249' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
),
g AS (SELECT gene, alt, any(cytoband) AS cytoband, arrayStringConcat(arraySort(x -> if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid))) AS so FROM c GROUP BY gene, alt),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = 'v7.5' AND alteration_type = 'CNA' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
fa AS (SELECT hugo_gene_symbol AS gene, cna_alteration AS alt, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alt),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' GROUP BY gene),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, if(g.alt > 0, 'AMP', 'HOMDEL') AS cna, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         g.cytoband AS cytoband, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = if(g.alt > 0, 'AMPLIFICATION', 'DELETION')
  LEFT JOIN fa ON fa.gene = g.gene AND fa.alt = g.alt LEFT JOIN fp ON fp.gene = g.gene
))
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 alterations: alterations:cna:rows · msk_chord_2024
WITH c AS (
  SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS gene, cna_alteration AS alt, cna_cytoband AS cytoband
  FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0024249' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
),
g AS (SELECT gene, alt, any(cytoband) AS cytoband, arrayStringConcat(arraySort(x -> if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid))) AS so FROM c GROUP BY gene, alt),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = 'v7.5' AND alteration_type = 'CNA' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
fa AS (SELECT hugo_gene_symbol AS gene, cna_alteration AS alt, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alt),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' GROUP BY gene),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, if(g.alt > 0, 'AMP', 'HOMDEL') AS cna, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         g.cytoband AS cytoband, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = if(g.alt > 0, 'AMPLIFICATION', 'DELETION')
  LEFT JOIN fa ON fa.gene = g.gene AND fa.alt = g.alt LEFT JOIN fp ON fp.gene = g.gene
))
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY gdrv DESC, gene, so, gene, cna
LIMIT 25 OFFSET 0

-- view 0 alterations: alterations:counts · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(tuple(sv.site1_entrez_gene_id, sv.site2_entrez_gene_id, sv.class, sv.event_info, sv.site1_chromosome, sv.site1_position, sv.site2_chromosome, sv.site2_position)) AS n
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 alterations: alterations:mutations:counts · msk_chord_2024
WITH m AS (
  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon,
         if(tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND patientId = 'P-0024249' AND molecularProfileId NOT LIKE '%uncalled%'
),
g AS (
  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, arrayStringConcat(arraySort(x -> if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid))) AS so,
         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount
  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var
),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
cn AS (SELECT hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(if(cna_alteration > 0, 'AMP', 'HOMDEL'))), ', ') AS copy
  FROM snapshot_db.genomic_event_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0024249'
    AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fa AS (SELECT hugo_gene_symbol AS gene, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'mutation' AND genetic_profile_stable_id NOT LIKE '%uncalled%'
    AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED' GROUP BY gene),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, g.proteinChange AS proteinChange, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         g.mutationType AS mutationType, ifNull(cn.copy, '') AS copy, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         g.vaf AS vaf, g.altCount AS altCount, g.refCount AS refCount, g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end,
         g.ref AS ref, g.var AS var, g.status AS status, g.pos AS pos
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = g.proteinChange
  LEFT JOIN cn ON cn.gene = g.gene LEFT JOIN fa ON fa.gene = g.gene LEFT JOIN fp ON fp.gene = g.gene
))
SELECT cohort, study, countIf((positionCaseInsensitiveUTF8(if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level '))))), 'Oncogenic') > 0)) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 alterations: alterations:mutations:rows · msk_chord_2024
WITH m AS (
  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon,
         if(tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND patientId = 'P-0024249' AND molecularProfileId NOT LIKE '%uncalled%'
),
g AS (
  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, arrayStringConcat(arraySort(x -> if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid))) AS so,
         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount
  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var
),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
cn AS (SELECT hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(if(cna_alteration > 0, 'AMP', 'HOMDEL'))), ', ') AS copy
  FROM snapshot_db.genomic_event_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0024249'
    AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fa AS (SELECT hugo_gene_symbol AS gene, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'mutation' AND genetic_profile_stable_id NOT LIKE '%uncalled%'
    AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED' GROUP BY gene),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, g.proteinChange AS proteinChange, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         g.mutationType AS mutationType, ifNull(cn.copy, '') AS copy, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         g.vaf AS vaf, g.altCount AS altCount, g.refCount AS refCount, g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end,
         g.ref AS ref, g.var AS var, g.status AS status, g.pos AS pos
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = g.proteinChange
  LEFT JOIN cn ON cn.gene = g.gene LEFT JOIN fa ON fa.gene = g.gene LEFT JOIN fp ON fp.gene = g.gene
))
SELECT *, count() OVER () AS total FROM rows
WHERE (positionCaseInsensitiveUTF8(if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level '))))), 'Oncogenic') > 0)
ORDER BY gdrv DESC, gene, so, pos ASC NULLS LAST, gene, chr, start, end, ref, var, proteinChange, mutationType
LIMIT 25 OFFSET 0

-- view 0 alterations: alterations:rank · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(tuple(sv.site1_entrez_gene_id, sv.site2_entrez_gene_id, sv.class, sv.event_info, sv.site1_chromosome, sv.site1_position, sv.site2_chromosome, sv.site2_position)) AS n
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT idx FROM (SELECT study, patient, row_number() OVER (ORDER BY CAST(sv AS Nullable(Float64)) DESC NULLS LAST, patient, ord) - 1 AS idx FROM rows
WHERE 1)
WHERE study = 'msk_chord_2024' AND patient = 'P-0024249' LIMIT 1

-- view 0 alterations: alterations:rows · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(tuple(sv.site1_entrez_gene_id, sv.site2_entrez_gene_id, sv.class, sv.event_info, sv.site1_chromosome, sv.site1_position, sv.site2_chromosome, sv.site2_position)) AS n
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT cohort, study, patient, sample, source, samples, mutations, cna, sv, count() OVER () AS total FROM rows
WHERE 1
ORDER BY CAST(sv AS Nullable(Float64)) DESC NULLS LAST, patient, ord
LIMIT 25 OFFSET 0

-- view 0 alterations: alterations:rows · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Prostate Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(tuple(sv.site1_entrez_gene_id, sv.site2_entrez_gene_id, sv.class, sv.event_info, sv.site1_chromosome, sv.site1_position, sv.site2_chromosome, sv.site2_position)) AS n
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT cohort, study, patient, sample, source, samples, mutations, cna, sv, count() OVER () AS total FROM rows
WHERE 1
ORDER BY CAST(sv AS Nullable(Float64)) DESC NULLS LAST, patient, ord
LIMIT 3 OFFSET 20

-- view 0 alterations: alterations:samples:counts · msk_chord_2024
WITH s AS (SELECT replaceOne(s.sample_unique_id, 'msk_chord_2024_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN snapshot_db.clinical_data_derived c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'msk_chord_2024' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'msk_chord_2024' AND s.patient_unique_id = 'msk_chord_2024_P-0024249'
GROUP BY id ORDER BY id),
rows AS (SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 alterations: alterations:samples:rows · msk_chord_2024
WITH s AS (SELECT replaceOne(s.sample_unique_id, 'msk_chord_2024_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN snapshot_db.clinical_data_derived c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'msk_chord_2024' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'msk_chord_2024' AND s.patient_unique_id = 'msk_chord_2024_P-0024249'
GROUP BY id ORDER BY id),
rows AS (SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY sid, sid
LIMIT 1000 OFFSET 0

-- view 0 alterations: alterations:sv:counts · msk_chord_2024
WITH s AS (
  SELECT smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         ifNull(sv.class, '') AS class, ifNull(sv.event_info, '') AS eventInfo, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,
         sv.site2_effect_on_frame AS frame, sv.site1_description AS site1, sv.site2_description AS site2,
         if(sv.site1_position IS NULL, '', concat(ifNull(sv.site1_chromosome, ''), ':', toString(sv.site1_position))) AS pos1,
         if(sv.site2_position IS NULL, '', concat(ifNull(sv.site2_chromosome, ''), ':', toString(sv.site2_position))) AS pos2,
         sv.length AS length, sv.tumor_variant_count AS tumorVariantCount, sv.tumor_read_count AS tumorReadCount,
         sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport, sv.sv_status AS status, sv.annotation AS svAnnotation, sv.comments AS comments
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE sv.sample_id IN (SELECT s.internal_id FROM snapshot_db.sample s JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
    JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id = 'P-0024249')
),
g AS (
  SELECT gene1, gene2, class, eventInfo, pos1, pos2, arrayStringConcat(arraySort(x -> if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid))) AS so,
         any(breakpointType) AS breakpointType, any(connectionType) AS connectionType, any(frame) AS frame, any(site1) AS site1, any(site2) AS site2,
         any(length) AS length, max(tumorVariantCount) AS tumorVariantCount, max(tumorReadCount) AS tumorReadCount,
         any(dnaSupport) AS dnaSupport, any(rnaSupport) AS rnaSupport, any(status) AS status, any(svAnnotation) AS svAnnotation, any(comments) AS comments
  FROM s GROUP BY gene1, gene2, class, eventInfo, pos1, pos2
),
rows AS (SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, splitByString(', ', g.samples)[1] AS sid, g.* FROM g)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 alterations: alterations:sv:rows · msk_chord_2024
WITH s AS (
  SELECT smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         ifNull(sv.class, '') AS class, ifNull(sv.event_info, '') AS eventInfo, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,
         sv.site2_effect_on_frame AS frame, sv.site1_description AS site1, sv.site2_description AS site2,
         if(sv.site1_position IS NULL, '', concat(ifNull(sv.site1_chromosome, ''), ':', toString(sv.site1_position))) AS pos1,
         if(sv.site2_position IS NULL, '', concat(ifNull(sv.site2_chromosome, ''), ':', toString(sv.site2_position))) AS pos2,
         sv.length AS length, sv.tumor_variant_count AS tumorVariantCount, sv.tumor_read_count AS tumorReadCount,
         sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport, sv.sv_status AS status, sv.annotation AS svAnnotation, sv.comments AS comments
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE sv.sample_id IN (SELECT s.internal_id FROM snapshot_db.sample s JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
    JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id = 'P-0024249')
),
g AS (
  SELECT gene1, gene2, class, eventInfo, pos1, pos2, arrayStringConcat(arraySort(x -> if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid) = 0, 1000000, indexOf(['P-0024249-T01-IM6', 'P-0024249-T02-IM7'], sid))) AS so,
         any(breakpointType) AS breakpointType, any(connectionType) AS connectionType, any(frame) AS frame, any(site1) AS site1, any(site2) AS site2,
         any(length) AS length, max(tumorVariantCount) AS tumorVariantCount, max(tumorReadCount) AS tumorReadCount,
         any(dnaSupport) AS dnaSupport, any(rnaSupport) AS rnaSupport, any(status) AS status, any(svAnnotation) AS svAnnotation, any(comments) AS comments
  FROM s GROUP BY gene1, gene2, class, eventInfo, pos1, pos2
),
rows AS (SELECT 'Prostate' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0024249' AS patient, splitByString(', ', g.samples)[1] AS sid, g.* FROM g)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY gene1, so, gene2, gene1, gene2, pos1, pos2, class, eventInfo
LIMIT 25 OFFSET 0
