-- cohort Colorectal
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))

-- view 0 mutations: mutations:counts · msk_chord_2024
WITH ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
  GROUP BY alteration),
c0 AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))),
m0 AS (
  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` = 'KRAS'
    AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
mc0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'MUTATION_COUNT'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
rows AS (
  SELECT 'Colorectal' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,
         ann.oncogenicity AS oncogenicity, ann.level AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         m.mutationType AS mutationType, m.variantType AS variantType,
         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,
         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos
  FROM m0 AS m
  LEFT JOIN ann ON ann.alteration = m.proteinChange
  LEFT JOIN ct0 AS ct ON ct.sid = m.sid LEFT JOIN mc0 AS mc ON mc.sid = m.sid
)
SELECT cohort, study, countIf((match(ifNull(toString(proteinChange), ''), '^G1[23]')) AND (CAST(vaf AS Nullable(Float64)) IS NOT NULL AND CAST(vaf AS Nullable(Float64)) >= 0.2)) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 mutations: mutations:rows · msk_chord_2024
WITH ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM oncokb_annotation.variant_annotation WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
  GROUP BY alteration),
c0 AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))),
m0 AS (
  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos
  FROM snapshot_db.mutation_derived
  WHERE studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` = 'KRAS'
    AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
mc0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'MUTATION_COUNT'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
rows AS (
  SELECT 'Colorectal' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,
         ann.oncogenicity AS oncogenicity, ann.level AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         m.mutationType AS mutationType, m.variantType AS variantType,
         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,
         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos
  FROM m0 AS m
  LEFT JOIN ann ON ann.alteration = m.proteinChange
  LEFT JOIN ct0 AS ct ON ct.sid = m.sid LEFT JOIN mc0 AS mc ON mc.sid = m.sid
)
SELECT *, count() OVER () AS total FROM rows
WHERE (match(ifNull(toString(proteinChange), ''), '^G1[23]')) AND (CAST(vaf AS Nullable(Float64)) IS NOT NULL AND CAST(vaf AS Nullable(Float64)) >= 0.2)
ORDER BY CAST(vaf AS Nullable(Float64)) DESC NULLS LAST, sid, ord, proteinChange
LIMIT 25 OFFSET 0
