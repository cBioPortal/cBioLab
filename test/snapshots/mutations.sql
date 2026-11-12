-- cohort Colorectal
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))

-- view 0 mutations: mutations:counts · msk_chord_2024
WITH ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
  GROUP BY alteration),
c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
m0 AS (
  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` = 'KRAS'
    AND molecularProfileId NOT LIKE '%uncalled%' AND sampleId IN (SELECT sid FROM c0)
),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
mc0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'MUTATION_COUNT'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
g0 AS (SELECT chr, start_position AS start, end_position AS end, reference_allele AS ref, variant_allele AS var, any(data) AS gd
  FROM annotation.variant
  WHERE (source, version) IN (('genome_nexus', '2.2.3-vep116-clinvar20260208+f2'), ('genome_nexus_grch38', '1.4.1-vepNA-clinvar20250106+f2')) AND source = (SELECT multiIf(rg.name = 'hg19', 'genome_nexus', rg.name = 'hg38', 'genome_nexus_grch38', '') FROM snapshot_db.cancer_study cs JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id WHERE cs.cancer_study_identifier = 'msk_chord_2024')
    AND (chr, start_position, end_position, reference_allele, variant_allele) IN (SELECT chr, start, end, ref, var FROM m0)
  GROUP BY chr, start, end, ref, var),
rows AS (
  SELECT 'Colorectal' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         (SELECT rg.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
          WHERE cs.cancer_study_identifier = 'msk_chord_2024') AS build,
         m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,
         ann.oncogenicity AS oncogenicity, ann.level AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         m.mutationType AS mutationType, m.variantType AS variantType,
         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,
         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos,
         if((ifNull(m.chr, '') != '' AND ifNull(m.start, 0) > 0 AND ifNull(m.end, 0) > 0 AND ifNull(m.ref, '') NOT IN ('', 'NA') AND ifNull(m.var, '') NOT IN ('', 'NA') AND NOT (ifNull(m.ref, '') = '-' AND ifNull(m.var, '') = '-')), concat(ifNull(m.chr, ''), ':g.', multiIf(ifNull(m.ref, '') = '-', concat(toString(ifNull(m.start, 0)), '_', toString(ifNull(m.end, 0)), 'ins', ifNull(m.var, '')), ifNull(m.var, '') = '-', if(ifNull(m.start, 0) = ifNull(m.end, 0), concat(toString(ifNull(m.start, 0)), 'del'), concat(toString(ifNull(m.start, 0)), '_', toString(ifNull(m.end, 0)), 'del')), length(ifNull(m.ref, '')) = 1 AND length(ifNull(m.var, '')) = 1, concat(toString(ifNull(m.start, 0)), ifNull(m.ref, ''), '>', ifNull(m.var, '')), length(ifNull(m.ref, '')) = 1, concat(toString(ifNull(m.start, 0)), 'delins', ifNull(m.var, '')), concat(toString(ifNull(m.start, 0)), '_', toString(ifNull(m.end, 0)), 'delins', ifNull(m.var, '')))), '') AS hgvsg,
         JSONExtractBool(ifNull(g.gd, ''), 'ok') AS gnOk,
         arrayFirst(t -> JSONExtractString(t, 'transcriptId') = JSONExtractString(ifNull(g.gd, ''), 'canonical', 'KRAS'), JSONExtractArrayRaw(ifNull(g.gd, ''), 'transcripts')) AS tc,
         JSONExtractString(tc, 'hgvsc') AS hgvsc,
         JSONExtractString(ifNull(g.gd, ''), 'clinvar', 'significance') AS clinvar, JSONExtractString(ifNull(g.gd, ''), 'clinvar', 'conflicting') AS clinvarConflicting,
         JSONExtractUInt(ifNull(g.gd, ''), 'clinvar', 'id') AS clinvarId,
         arrayLast(e -> position(JSONExtractString(e, 'mutationStatus'), 'germline') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'signal')) AS sig,
         if(lower(JSONExtractString(sig, 'mutationStatus')) = 'germline' AND arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) > 0, arraySum(arrayMap(c -> JSONExtractFloat(c, 'variantCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) / arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))), NULL) AS signalFreq,
         JSONExtractString(ifNull(g.gd, ''), 'rsid') AS rsid, JSONExtractRaw(ifNull(g.gd, ''), 'gnomad') AS gnomadRaw, JSONExtractRaw(ifNull(g.gd, ''), 'vcf') AS vcfRaw,
         JSONExtractString(ifNull(g.gd, ''), 'seqRegion') AS seqRegion,
         multiIf(JSONType(ifNull(g.gd, ''), 'gnomad', 'exome') = 'Object' AND JSONType(ifNull(g.gd, ''), 'gnomad', 'genome') = 'Object', if(JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an') > 0, (JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleCount', 'ac') + JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleCount', 'ac')) / (JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an')), 0), JSONType(ifNull(g.gd, ''), 'gnomad', 'exome') = 'Object', coalesce(JSONExtract(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an') > 0, JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleCount', 'ac') / JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an'), 0)), JSONType(ifNull(g.gd, ''), 'gnomad', 'genome') = 'Object', coalesce(JSONExtract(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an') > 0, JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleCount', 'ac') / JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an'), 0)), NULL) AS gnomadFreq,
         JSONExtractRaw(ifNull(g.gd, ''), 'mutationAssessor') AS maRaw,
         if(ifNull(g.gd, '') != '', concat(concat('MutationAssessor: ', if(JSONType(ifNull(g.gd, ''), 'mutationAssessor') = 'Object', concat('impact: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'prediction'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), ', score: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'score'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'score')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'score'))), 'NA')), ';', concat('SIFT: ', if((JSONExtractFloat(tc, 'siftScore') != 0 OR JSONExtractString(tc, 'siftPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'siftPrediction'), 'undefined', JSONType(tc, 'siftPrediction') = 'Null', 'null', JSONType(tc, 'siftPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftPrediction')), JSONExtractString(tc, 'siftPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'siftScore'), 'undefined', JSONType(tc, 'siftScore') = 'Null', 'null', JSONType(tc, 'siftScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftScore')), JSONExtractString(tc, 'siftScore'))), 'NA')), ';', concat('Polyphen-2: ', if((JSONExtractFloat(tc, 'polyphenScore') != 0 OR JSONExtractString(tc, 'polyphenPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'polyphenPrediction'), 'undefined', JSONType(tc, 'polyphenPrediction') = 'Null', 'null', JSONType(tc, 'polyphenPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenPrediction')), JSONExtractString(tc, 'polyphenPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'polyphenScore'), 'undefined', JSONType(tc, 'polyphenScore') = 'Null', 'null', JSONType(tc, 'polyphenScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenScore')), JSONExtractString(tc, 'polyphenScore'))), 'NA')), ';', concat('AlphaMissense: ', if((JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != ''), concat('pathogenicity: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'pathogenicity'), 'undefined', JSONType(tc, 'alphaMissense', 'pathogenicity') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'pathogenicity') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'pathogenicity')), JSONExtractString(tc, 'alphaMissense', 'pathogenicity')), ', score: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'score'), 'undefined', JSONType(tc, 'alphaMissense', 'score') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'score')), JSONExtractString(tc, 'alphaMissense', 'score'))), 'NA'))), '') AS functionalImpact
  FROM m0 AS m
  LEFT JOIN ann ON ann.alteration = m.proteinChange
  LEFT JOIN g0 AS g ON g.chr = m.chr AND g.start = m.start AND g.end = m.end AND g.ref = m.ref AND g.var = m.var
  LEFT JOIN ct0 AS ct ON ct.sid = m.sid LEFT JOIN mc0 AS mc ON mc.sid = m.sid
)
SELECT cohort, study, countIf((match(ifNull(toString(proteinChange), ''), '^G1[23]')) AND (CAST(vaf AS Nullable(Float64)) IS NOT NULL AND CAST(vaf AS Nullable(Float64)) >= 0.2)) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 mutations: mutations:rows · msk_chord_2024
WITH ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
  GROUP BY alteration),
c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
m0 AS (
  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` = 'KRAS'
    AND molecularProfileId NOT LIKE '%uncalled%' AND sampleId IN (SELECT sid FROM c0)
),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
mc0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'MUTATION_COUNT'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM m0) GROUP BY sid),
g0 AS (SELECT chr, start_position AS start, end_position AS end, reference_allele AS ref, variant_allele AS var, any(data) AS gd
  FROM annotation.variant
  WHERE (source, version) IN (('genome_nexus', '2.2.3-vep116-clinvar20260208+f2'), ('genome_nexus_grch38', '1.4.1-vepNA-clinvar20250106+f2')) AND source = (SELECT multiIf(rg.name = 'hg19', 'genome_nexus', rg.name = 'hg38', 'genome_nexus_grch38', '') FROM snapshot_db.cancer_study cs JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id WHERE cs.cancer_study_identifier = 'msk_chord_2024')
    AND (chr, start_position, end_position, reference_allele, variant_allele) IN (SELECT chr, start, end, ref, var FROM m0)
  GROUP BY chr, start, end, ref, var),
rows AS (
  SELECT 'Colorectal' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         (SELECT rg.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
          WHERE cs.cancer_study_identifier = 'msk_chord_2024') AS build,
         m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,
         ann.oncogenicity AS oncogenicity, ann.level AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         m.mutationType AS mutationType, m.variantType AS variantType,
         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,
         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos,
         if((ifNull(m.chr, '') != '' AND ifNull(m.start, 0) > 0 AND ifNull(m.end, 0) > 0 AND ifNull(m.ref, '') NOT IN ('', 'NA') AND ifNull(m.var, '') NOT IN ('', 'NA') AND NOT (ifNull(m.ref, '') = '-' AND ifNull(m.var, '') = '-')), concat(ifNull(m.chr, ''), ':g.', multiIf(ifNull(m.ref, '') = '-', concat(toString(ifNull(m.start, 0)), '_', toString(ifNull(m.end, 0)), 'ins', ifNull(m.var, '')), ifNull(m.var, '') = '-', if(ifNull(m.start, 0) = ifNull(m.end, 0), concat(toString(ifNull(m.start, 0)), 'del'), concat(toString(ifNull(m.start, 0)), '_', toString(ifNull(m.end, 0)), 'del')), length(ifNull(m.ref, '')) = 1 AND length(ifNull(m.var, '')) = 1, concat(toString(ifNull(m.start, 0)), ifNull(m.ref, ''), '>', ifNull(m.var, '')), length(ifNull(m.ref, '')) = 1, concat(toString(ifNull(m.start, 0)), 'delins', ifNull(m.var, '')), concat(toString(ifNull(m.start, 0)), '_', toString(ifNull(m.end, 0)), 'delins', ifNull(m.var, '')))), '') AS hgvsg,
         JSONExtractBool(ifNull(g.gd, ''), 'ok') AS gnOk,
         arrayFirst(t -> JSONExtractString(t, 'transcriptId') = JSONExtractString(ifNull(g.gd, ''), 'canonical', 'KRAS'), JSONExtractArrayRaw(ifNull(g.gd, ''), 'transcripts')) AS tc,
         JSONExtractString(tc, 'hgvsc') AS hgvsc,
         JSONExtractString(ifNull(g.gd, ''), 'clinvar', 'significance') AS clinvar, JSONExtractString(ifNull(g.gd, ''), 'clinvar', 'conflicting') AS clinvarConflicting,
         JSONExtractUInt(ifNull(g.gd, ''), 'clinvar', 'id') AS clinvarId,
         arrayLast(e -> position(JSONExtractString(e, 'mutationStatus'), 'germline') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'signal')) AS sig,
         if(lower(JSONExtractString(sig, 'mutationStatus')) = 'germline' AND arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) > 0, arraySum(arrayMap(c -> JSONExtractFloat(c, 'variantCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) / arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))), NULL) AS signalFreq,
         JSONExtractString(ifNull(g.gd, ''), 'rsid') AS rsid, JSONExtractRaw(ifNull(g.gd, ''), 'gnomad') AS gnomadRaw, JSONExtractRaw(ifNull(g.gd, ''), 'vcf') AS vcfRaw,
         JSONExtractString(ifNull(g.gd, ''), 'seqRegion') AS seqRegion,
         multiIf(JSONType(ifNull(g.gd, ''), 'gnomad', 'exome') = 'Object' AND JSONType(ifNull(g.gd, ''), 'gnomad', 'genome') = 'Object', if(JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an') > 0, (JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleCount', 'ac') + JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleCount', 'ac')) / (JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an')), 0), JSONType(ifNull(g.gd, ''), 'gnomad', 'exome') = 'Object', coalesce(JSONExtract(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an') > 0, JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleCount', 'ac') / JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'exome', 'alleleNumber', 'an'), 0)), JSONType(ifNull(g.gd, ''), 'gnomad', 'genome') = 'Object', coalesce(JSONExtract(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an') > 0, JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleCount', 'ac') / JSONExtractFloat(ifNull(g.gd, ''), 'gnomad', 'genome', 'alleleNumber', 'an'), 0)), NULL) AS gnomadFreq,
         JSONExtractRaw(ifNull(g.gd, ''), 'mutationAssessor') AS maRaw,
         if(ifNull(g.gd, '') != '', concat(concat('MutationAssessor: ', if(JSONType(ifNull(g.gd, ''), 'mutationAssessor') = 'Object', concat('impact: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'prediction'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), ', score: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'score'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'score')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'score'))), 'NA')), ';', concat('SIFT: ', if((JSONExtractFloat(tc, 'siftScore') != 0 OR JSONExtractString(tc, 'siftPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'siftPrediction'), 'undefined', JSONType(tc, 'siftPrediction') = 'Null', 'null', JSONType(tc, 'siftPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftPrediction')), JSONExtractString(tc, 'siftPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'siftScore'), 'undefined', JSONType(tc, 'siftScore') = 'Null', 'null', JSONType(tc, 'siftScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftScore')), JSONExtractString(tc, 'siftScore'))), 'NA')), ';', concat('Polyphen-2: ', if((JSONExtractFloat(tc, 'polyphenScore') != 0 OR JSONExtractString(tc, 'polyphenPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'polyphenPrediction'), 'undefined', JSONType(tc, 'polyphenPrediction') = 'Null', 'null', JSONType(tc, 'polyphenPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenPrediction')), JSONExtractString(tc, 'polyphenPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'polyphenScore'), 'undefined', JSONType(tc, 'polyphenScore') = 'Null', 'null', JSONType(tc, 'polyphenScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenScore')), JSONExtractString(tc, 'polyphenScore'))), 'NA')), ';', concat('AlphaMissense: ', if((JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != ''), concat('pathogenicity: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'pathogenicity'), 'undefined', JSONType(tc, 'alphaMissense', 'pathogenicity') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'pathogenicity') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'pathogenicity')), JSONExtractString(tc, 'alphaMissense', 'pathogenicity')), ', score: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'score'), 'undefined', JSONType(tc, 'alphaMissense', 'score') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'score')), JSONExtractString(tc, 'alphaMissense', 'score'))), 'NA'))), '') AS functionalImpact
  FROM m0 AS m
  LEFT JOIN ann ON ann.alteration = m.proteinChange
  LEFT JOIN g0 AS g ON g.chr = m.chr AND g.start = m.start AND g.end = m.end AND g.ref = m.ref AND g.var = m.var
  LEFT JOIN ct0 AS ct ON ct.sid = m.sid LEFT JOIN mc0 AS mc ON mc.sid = m.sid
)
SELECT *, count() OVER () AS total FROM rows
WHERE (match(ifNull(toString(proteinChange), ''), '^G1[23]')) AND (CAST(vaf AS Nullable(Float64)) IS NOT NULL AND CAST(vaf AS Nullable(Float64)) >= 0.2)
ORDER BY CAST(vaf AS Nullable(Float64)) DESC NULLS LAST, sid, ord, proteinChange
LIMIT 25 OFFSET 0
