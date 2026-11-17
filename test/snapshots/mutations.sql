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
WITH ann AS (SELECT alteration, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level,
    CAST(NULL AS Nullable(String)) AS prognostic_level, toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver
  FROM (SELECT alteration, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c
    FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
    GROUP BY alteration)),
att AS (SELECT alteration, consequence, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level,
    toNullable(c.5) AS prognostic_level, toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found
  FROM (SELECT alteration, consequence, tumor_type, argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level),
      toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c
    FROM annotation.oncokb_tumor_type AS t WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
    GROUP BY alteration, consequence, tumor_type)),
sva AS (SELECT gene, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level, CAST(NULL AS Nullable(String)) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver
  FROM (SELECT hugo_gene_symbol AS gene, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c
    FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
    GROUP BY gene)),
svp AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level, toNullable(c.5) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found
  FROM (SELECT site1_entrez, site2_entrez, sv_type, tumor_type,
      argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level), toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c
    FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
      AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS'))))
    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),
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
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos,
         center, validationStatus AS vs, normalAltCount AS nAlt, normalRefCount AS nRef
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` = 'KRAS'
    AND molecularProfileId NOT LIKE '%uncalled%' AND sampleId IN (SELECT sid FROM c0)
),
v0 AS (
  SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         sv.class AS class, sv.event_info AS eventInfo, sv.site1_chromosome AS chr, sv.site1_position AS start, sv.sv_status AS status,
         if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
    AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS')))
    AND smp.stable_id IN (SELECT sid FROM c0)
),
vk0 AS (SELECT s.sid AS sid,
    if(ifNull(k.sid, '') = '', (SELECT t.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
      WHERE cs.cancer_study_identifier = 'msk_chord_2024'), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType
  FROM (SELECT DISTINCT sid FROM (SELECT sid FROM v0)) AS s
  LEFT JOIN (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,
      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')
      AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM v0)) GROUP BY sid) AS k ON k.sid = s.sid),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0)) GROUP BY sid),
mc0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'MUTATION_COUNT'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0)) GROUP BY sid),
cta0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0)) GROUP BY sid),
cn0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS g, any(if(isFinite(ifNull(toFloat64OrNull(alteration_value), nan)), toFloat64OrNull(alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND profile_type = (SELECT replaceOne(gp.stable_id, 'msk_chord_2024_', '') FROM snapshot_db.genetic_profile gp
      JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id WHERE cs.cancer_study_identifier = 'msk_chord_2024'
        AND gp.genetic_alteration_type = 'COPY_NUMBER_ALTERATION' AND gp.datatype = 'DISCRETE' ORDER BY gp.genetic_profile_id DESC LIMIT 1)
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0))
  GROUP BY sid, g),
k0 AS (SELECT s.sid AS sid,
    if(ifNull(k.sid, '') = '', (SELECT t.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
      WHERE cs.cancer_study_identifier = 'msk_chord_2024'), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType
  FROM (SELECT DISTINCT sid FROM (SELECT sid FROM m0)) AS s
  LEFT JOIN (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,
      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')
      AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0)) GROUP BY sid) AS k ON k.sid = s.sid),
mt0 AS (SELECT m.*, ifNull(m.mutationType, '') AS consequence, positionCaseInsensitive(ifNull(m.status, ''), 'germline') > 0 AS germ,
    k.tumorType AS tumorType FROM m0 AS m LEFT JOIN k0 AS k ON k.sid = m.sid),
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
         if(m.germ, '', if(tt.found = 1, tt.oncogenicity, ann.oncogenicity)) AS oncogenicity, if(m.germ, '', if(tt.found = 1, tt.level, ann.level)) AS level,
         if(m.germ, '', if(tt.found = 1, tt.resistance_level, ann.resistance_level)) AS resistanceLevel, if(m.germ, '', if(tt.found = 1, tt.diagnostic_level, ann.diagnostic_level)) AS diagnosticLevel, if(m.germ, '', if(tt.found = 1, tt.prognostic_level, ann.prognostic_level)) AS prognosticLevel,
         toUInt8((NOT m.germ AND if(tt.found = 1, tt.driver, ifNull(ann.driver, 0))) OR (ifNull(m.chr, '') != '' AND ifNull(m.start, 0) != 0 AND ifNull(m.end, 0) != 0 AND ifNull(m.ref, '') != '' AND ifNull(m.var, '') != '' AND if(positionCaseInsensitive(ifNull(m.mutationType, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots'))))) AS drv,
         toUInt8((ifNull(m.chr, '') != '' AND ifNull(m.start, 0) != 0 AND ifNull(m.end, 0) != 0 AND ifNull(m.ref, '') != '' AND ifNull(m.var, '') != '' AND if(positionCaseInsensitive(ifNull(m.mutationType, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots'))))) AS hot,
         m.mutationType AS mutationType, upper(m.variantType) AS variantType,
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
         if(ifNull(g.gd, '') != '', concat(concat('MutationAssessor: ', if(JSONType(ifNull(g.gd, ''), 'mutationAssessor') = 'Object', concat('impact: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'prediction'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), ', score: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'score'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'score')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'score'))), 'NA')), ';', concat('SIFT: ', if((JSONExtractFloat(tc, 'siftScore') != 0 OR JSONExtractString(tc, 'siftPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'siftPrediction'), 'undefined', JSONType(tc, 'siftPrediction') = 'Null', 'null', JSONType(tc, 'siftPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftPrediction')), JSONExtractString(tc, 'siftPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'siftScore'), 'undefined', JSONType(tc, 'siftScore') = 'Null', 'null', JSONType(tc, 'siftScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftScore')), JSONExtractString(tc, 'siftScore'))), 'NA')), ';', concat('Polyphen-2: ', if((JSONExtractFloat(tc, 'polyphenScore') != 0 OR JSONExtractString(tc, 'polyphenPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'polyphenPrediction'), 'undefined', JSONType(tc, 'polyphenPrediction') = 'Null', 'null', JSONType(tc, 'polyphenPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenPrediction')), JSONExtractString(tc, 'polyphenPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'polyphenScore'), 'undefined', JSONType(tc, 'polyphenScore') = 'Null', 'null', JSONType(tc, 'polyphenScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenScore')), JSONExtractString(tc, 'polyphenScore'))), 'NA')), ';', concat('AlphaMissense: ', if((JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != ''), concat('pathogenicity: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'pathogenicity'), 'undefined', JSONType(tc, 'alphaMissense', 'pathogenicity') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'pathogenicity') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'pathogenicity')), JSONExtractString(tc, 'alphaMissense', 'pathogenicity')), ', score: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'score'), 'undefined', JSONType(tc, 'alphaMissense', 'score') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'score')), JSONExtractString(tc, 'alphaMissense', 'score'))), 'NA'))), '') AS functionalImpact,
         'KRAS' AS gene, (SELECT name FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024') AS studyName, cta.v AS cancerTypeAll,
         if(cn.v = floor(cn.v), toInt8(cn.v), NULL) AS cnv, multiIf(cnv IS NULL, '', cnv = 2, 'Amp', cnv = 1, 'Gain', cnv = 0, 'Diploid', cnv = -1, 'ShallowDel', 'DeepDel') AS copyNumber,
         m.vs AS validationStatus, m.center AS center,
         round(if(m.nAlt > 0 AND m.nRef >= 0, m.nAlt / (m.nAlt + m.nRef), NULL), if(if(m.nAlt > 0 AND m.nRef >= 0, m.nAlt / (m.nAlt + m.nRef), NULL) < 0.01, 4, 2)) AS vafNormal,
         if(m.nAlt > 0, m.nAlt, NULL) AS normalAltCount, m.nAlt AS normalAltCountRaw,
         if(m.nRef > 0, m.nRef, NULL) AS normalRefCount, m.nRef AS normalRefCountRaw,
         JSONExtractString(tc, 'exon') AS exon
  FROM mt0 AS m
  LEFT JOIN ann ON ann.alteration = m.proteinChange
  LEFT JOIN att AS tt ON tt.alteration = m.proteinChange AND tt.consequence = m.consequence AND tt.tumor_type = m.tumorType
  LEFT JOIN g0 AS g ON g.chr = m.chr AND g.start = m.start AND g.end = m.end AND g.ref = m.ref AND g.var = m.var
  LEFT JOIN ct0 AS ct ON ct.sid = m.sid LEFT JOIN mc0 AS mc ON mc.sid = m.sid
  LEFT JOIN cta0 AS cta ON cta.sid = m.sid LEFT JOIN cn0 AS cn ON cn.sid = m.sid AND cn.g = 'KRAS'
  UNION ALL
  SELECT 'Colorectal' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         (SELECT rg.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
          WHERE cs.cancer_study_identifier = 'msk_chord_2024') AS build,
         v.pid AS patient, v.sid AS sid, ct.v AS cancerType, multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS proteinChange,
         if(vp.found = 1, vp.oncogenicity, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.oncogenicity, va1.oncogenicity)) AS oncogenicity, if(vp.found = 1, vp.level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.level, va1.level)) AS level,
         if(vp.found = 1, vp.resistance_level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.resistance_level, va1.resistance_level)) AS resistanceLevel, if(vp.found = 1, vp.diagnostic_level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.diagnostic_level, va1.diagnostic_level)) AS diagnosticLevel, if(vp.found = 1, vp.prognostic_level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.prognostic_level, va1.prognostic_level)) AS prognosticLevel,
         toUInt8(if(vn.found = 1, vn.driver, greatest(va1.driver, va2.driver))) AS drv,
         toUInt8(0) AS hot,
         'Fusion' AS mutationType, upper(v.class) AS variantType,
         NULL AS vaf, NULL AS altCount, NULL AS refCount,
         toInt64OrNull(mc.v) AS mutCount, v.chr AS chr, v.start AS start, NULL AS end, NULL AS ref, NULL AS var, v.status AS status, NULL AS pos,
         '' AS hgvsg,
         JSONExtractBool('', 'ok') AS gnOk,
         arrayFirst(t -> JSONExtractString(t, 'transcriptId') = JSONExtractString('', 'canonical', 'KRAS'), JSONExtractArrayRaw('', 'transcripts')) AS tc,
         JSONExtractString(tc, 'hgvsc') AS hgvsc,
         JSONExtractString('', 'clinvar', 'significance') AS clinvar, JSONExtractString('', 'clinvar', 'conflicting') AS clinvarConflicting,
         JSONExtractUInt('', 'clinvar', 'id') AS clinvarId,
         arrayLast(e -> position(JSONExtractString(e, 'mutationStatus'), 'germline') > 0, JSONExtractArrayRaw('', 'signal')) AS sig,
         if(lower(JSONExtractString(sig, 'mutationStatus')) = 'germline' AND arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) > 0, arraySum(arrayMap(c -> JSONExtractFloat(c, 'variantCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) / arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))), NULL) AS signalFreq,
         JSONExtractString('', 'rsid') AS rsid, JSONExtractRaw('', 'gnomad') AS gnomadRaw, JSONExtractRaw('', 'vcf') AS vcfRaw,
         JSONExtractString('', 'seqRegion') AS seqRegion,
         multiIf(JSONType('', 'gnomad', 'exome') = 'Object' AND JSONType('', 'gnomad', 'genome') = 'Object', if(JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an') > 0, (JSONExtractFloat('', 'gnomad', 'exome', 'alleleCount', 'ac') + JSONExtractFloat('', 'gnomad', 'genome', 'alleleCount', 'ac')) / (JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an')), 0), JSONType('', 'gnomad', 'exome') = 'Object', coalesce(JSONExtract('', 'gnomad', 'exome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an') > 0, JSONExtractFloat('', 'gnomad', 'exome', 'alleleCount', 'ac') / JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an'), 0)), JSONType('', 'gnomad', 'genome') = 'Object', coalesce(JSONExtract('', 'gnomad', 'genome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an') > 0, JSONExtractFloat('', 'gnomad', 'genome', 'alleleCount', 'ac') / JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an'), 0)), NULL) AS gnomadFreq,
         JSONExtractRaw('', 'mutationAssessor') AS maRaw,
         if('' != '', concat(concat('MutationAssessor: ', if(JSONType('', 'mutationAssessor') = 'Object', concat('impact: ', multiIf(NOT JSONHas('', 'mutationAssessor', 'prediction'), 'undefined', JSONType('', 'mutationAssessor', 'prediction') = 'Null', 'null', JSONType('', 'mutationAssessor', 'prediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat('', 'mutationAssessor', 'prediction')), JSONExtractString('', 'mutationAssessor', 'prediction')), ', score: ', multiIf(NOT JSONHas('', 'mutationAssessor', 'score'), 'undefined', JSONType('', 'mutationAssessor', 'score') = 'Null', 'null', JSONType('', 'mutationAssessor', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat('', 'mutationAssessor', 'score')), JSONExtractString('', 'mutationAssessor', 'score'))), 'NA')), ';', concat('SIFT: ', if((JSONExtractFloat(tc, 'siftScore') != 0 OR JSONExtractString(tc, 'siftPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'siftPrediction'), 'undefined', JSONType(tc, 'siftPrediction') = 'Null', 'null', JSONType(tc, 'siftPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftPrediction')), JSONExtractString(tc, 'siftPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'siftScore'), 'undefined', JSONType(tc, 'siftScore') = 'Null', 'null', JSONType(tc, 'siftScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftScore')), JSONExtractString(tc, 'siftScore'))), 'NA')), ';', concat('Polyphen-2: ', if((JSONExtractFloat(tc, 'polyphenScore') != 0 OR JSONExtractString(tc, 'polyphenPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'polyphenPrediction'), 'undefined', JSONType(tc, 'polyphenPrediction') = 'Null', 'null', JSONType(tc, 'polyphenPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenPrediction')), JSONExtractString(tc, 'polyphenPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'polyphenScore'), 'undefined', JSONType(tc, 'polyphenScore') = 'Null', 'null', JSONType(tc, 'polyphenScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenScore')), JSONExtractString(tc, 'polyphenScore'))), 'NA')), ';', concat('AlphaMissense: ', if((JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != ''), concat('pathogenicity: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'pathogenicity'), 'undefined', JSONType(tc, 'alphaMissense', 'pathogenicity') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'pathogenicity') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'pathogenicity')), JSONExtractString(tc, 'alphaMissense', 'pathogenicity')), ', score: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'score'), 'undefined', JSONType(tc, 'alphaMissense', 'score') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'score')), JSONExtractString(tc, 'alphaMissense', 'score'))), 'NA'))), '') AS functionalImpact,
         v.gene1 AS gene, (SELECT name FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024') AS studyName, cta.v AS cancerTypeAll,
         if(cn.v = floor(cn.v), toInt8(cn.v), NULL) AS cnv, multiIf(cnv IS NULL, '', cnv = 2, 'Amp', cnv = 1, 'Gain', cnv = 0, 'Diploid', cnv = -1, 'ShallowDel', 'DeepDel') AS copyNumber,
         NULL AS validationStatus, 'N/A' AS center,
         round(if(NULL > 0 AND NULL >= 0, NULL / (NULL + NULL), NULL), if(if(NULL > 0 AND NULL >= 0, NULL / (NULL + NULL), NULL) < 0.01, 4, 2)) AS vafNormal,
         if(NULL > 0, NULL, NULL) AS normalAltCount, NULL AS normalAltCountRaw,
         if(NULL > 0, NULL, NULL) AS normalRefCount, NULL AS normalRefCountRaw,
         JSONExtractString(tc, 'exon') AS exon
  FROM v0 AS v
  LEFT JOIN vk0 AS vk ON vk.sid = v.sid
  LEFT JOIN sva AS va1 ON va1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS va2 ON va2.gene = v.gene2 AND v.gene2 != ''
  LEFT JOIN svp AS vp ON vp.site1_entrez = v.k1 AND vp.site2_entrez = v.k2 AND vp.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vp.tumor_type = vk.tumorType
  LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''
  LEFT JOIN ct0 AS ct ON ct.sid = v.sid LEFT JOIN mc0 AS mc ON mc.sid = v.sid
  LEFT JOIN cta0 AS cta ON cta.sid = v.sid LEFT JOIN cn0 AS cn ON cn.sid = v.sid AND cn.g = v.gene1
)
SELECT cohort, study, countIf((match(ifNull(toString(proteinChange), ''), '^G1[23]')) AND (CAST(vaf AS Nullable(Float64)) IS NOT NULL AND CAST(vaf AS Nullable(Float64)) >= 0.2)) AS n, count() AS all, count() - uniqExact((study, patient, ifNull(proteinChange, ''))) AS dup FROM rows GROUP BY cohort, study

-- view 0 mutations: mutations:rows · msk_chord_2024
WITH ann AS (SELECT alteration, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level,
    CAST(NULL AS Nullable(String)) AS prognostic_level, toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver
  FROM (SELECT alteration, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c
    FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
    GROUP BY alteration)),
att AS (SELECT alteration, consequence, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level,
    toNullable(c.5) AS prognostic_level, toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found
  FROM (SELECT alteration, consequence, tumor_type, argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level),
      toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c
    FROM annotation.oncokb_tumor_type AS t WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol = 'KRAS'
    GROUP BY alteration, consequence, tumor_type)),
sva AS (SELECT gene, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level, CAST(NULL AS Nullable(String)) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver
  FROM (SELECT hugo_gene_symbol AS gene, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c
    FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
    GROUP BY gene)),
svp AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level, toNullable(c.5) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found
  FROM (SELECT site1_entrez, site2_entrez, sv_type, tumor_type,
      argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level), toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c
    FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
      AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS'))))
    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),
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
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos,
         center, validationStatus AS vs, normalAltCount AS nAlt, normalRefCount AS nRef
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` = 'KRAS'
    AND molecularProfileId NOT LIKE '%uncalled%' AND sampleId IN (SELECT sid FROM c0)
),
v0 AS (
  SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         sv.class AS class, sv.event_info AS eventInfo, sv.site1_chromosome AS chr, sv.site1_position AS start, sv.sv_status AS status,
         if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
    AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS')))
    AND smp.stable_id IN (SELECT sid FROM c0)
),
vk0 AS (SELECT s.sid AS sid,
    if(ifNull(k.sid, '') = '', (SELECT t.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
      WHERE cs.cancer_study_identifier = 'msk_chord_2024'), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType
  FROM (SELECT DISTINCT sid FROM (SELECT sid FROM v0)) AS s
  LEFT JOIN (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,
      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')
      AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM v0)) GROUP BY sid) AS k ON k.sid = s.sid),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0)) GROUP BY sid),
mc0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'MUTATION_COUNT'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0)) GROUP BY sid),
cta0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name = 'CANCER_TYPE'
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0)) GROUP BY sid),
cn0 AS (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS g, any(if(isFinite(ifNull(toFloat64OrNull(alteration_value), nan)), toFloat64OrNull(alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND profile_type = (SELECT replaceOne(gp.stable_id, 'msk_chord_2024_', '') FROM snapshot_db.genetic_profile gp
      JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id WHERE cs.cancer_study_identifier = 'msk_chord_2024'
        AND gp.genetic_alteration_type = 'COPY_NUMBER_ALTERATION' AND gp.datatype = 'DISCRETE' ORDER BY gp.genetic_profile_id DESC LIMIT 1)
    AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0 UNION ALL SELECT sid FROM v0))
  GROUP BY sid, g),
k0 AS (SELECT s.sid AS sid,
    if(ifNull(k.sid, '') = '', (SELECT t.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
      WHERE cs.cancer_study_identifier = 'msk_chord_2024'), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType
  FROM (SELECT DISTINCT sid FROM (SELECT sid FROM m0)) AS s
  LEFT JOIN (SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,
      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')
      AND sample_unique_id IN (SELECT concat('msk_chord_2024_', sid) FROM (SELECT sid FROM m0)) GROUP BY sid) AS k ON k.sid = s.sid),
mt0 AS (SELECT m.*, ifNull(m.mutationType, '') AS consequence, positionCaseInsensitive(ifNull(m.status, ''), 'germline') > 0 AS germ,
    k.tumorType AS tumorType FROM m0 AS m LEFT JOIN k0 AS k ON k.sid = m.sid),
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
         if(m.germ, '', if(tt.found = 1, tt.oncogenicity, ann.oncogenicity)) AS oncogenicity, if(m.germ, '', if(tt.found = 1, tt.level, ann.level)) AS level,
         if(m.germ, '', if(tt.found = 1, tt.resistance_level, ann.resistance_level)) AS resistanceLevel, if(m.germ, '', if(tt.found = 1, tt.diagnostic_level, ann.diagnostic_level)) AS diagnosticLevel, if(m.germ, '', if(tt.found = 1, tt.prognostic_level, ann.prognostic_level)) AS prognosticLevel,
         toUInt8((NOT m.germ AND if(tt.found = 1, tt.driver, ifNull(ann.driver, 0))) OR (ifNull(m.chr, '') != '' AND ifNull(m.start, 0) != 0 AND ifNull(m.end, 0) != 0 AND ifNull(m.ref, '') != '' AND ifNull(m.var, '') != '' AND if(positionCaseInsensitive(ifNull(m.mutationType, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots'))))) AS drv,
         toUInt8((ifNull(m.chr, '') != '' AND ifNull(m.start, 0) != 0 AND ifNull(m.end, 0) != 0 AND ifNull(m.ref, '') != '' AND ifNull(m.var, '') != '' AND if(positionCaseInsensitive(ifNull(m.mutationType, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(ifNull(g.gd, ''), 'hotspots'))))) AS hot,
         m.mutationType AS mutationType, upper(m.variantType) AS variantType,
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
         if(ifNull(g.gd, '') != '', concat(concat('MutationAssessor: ', if(JSONType(ifNull(g.gd, ''), 'mutationAssessor') = 'Object', concat('impact: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'prediction'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'prediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'prediction')), ', score: ', multiIf(NOT JSONHas(ifNull(g.gd, ''), 'mutationAssessor', 'score'), 'undefined', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') = 'Null', 'null', JSONType(ifNull(g.gd, ''), 'mutationAssessor', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(ifNull(g.gd, ''), 'mutationAssessor', 'score')), JSONExtractString(ifNull(g.gd, ''), 'mutationAssessor', 'score'))), 'NA')), ';', concat('SIFT: ', if((JSONExtractFloat(tc, 'siftScore') != 0 OR JSONExtractString(tc, 'siftPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'siftPrediction'), 'undefined', JSONType(tc, 'siftPrediction') = 'Null', 'null', JSONType(tc, 'siftPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftPrediction')), JSONExtractString(tc, 'siftPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'siftScore'), 'undefined', JSONType(tc, 'siftScore') = 'Null', 'null', JSONType(tc, 'siftScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftScore')), JSONExtractString(tc, 'siftScore'))), 'NA')), ';', concat('Polyphen-2: ', if((JSONExtractFloat(tc, 'polyphenScore') != 0 OR JSONExtractString(tc, 'polyphenPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'polyphenPrediction'), 'undefined', JSONType(tc, 'polyphenPrediction') = 'Null', 'null', JSONType(tc, 'polyphenPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenPrediction')), JSONExtractString(tc, 'polyphenPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'polyphenScore'), 'undefined', JSONType(tc, 'polyphenScore') = 'Null', 'null', JSONType(tc, 'polyphenScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenScore')), JSONExtractString(tc, 'polyphenScore'))), 'NA')), ';', concat('AlphaMissense: ', if((JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != ''), concat('pathogenicity: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'pathogenicity'), 'undefined', JSONType(tc, 'alphaMissense', 'pathogenicity') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'pathogenicity') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'pathogenicity')), JSONExtractString(tc, 'alphaMissense', 'pathogenicity')), ', score: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'score'), 'undefined', JSONType(tc, 'alphaMissense', 'score') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'score')), JSONExtractString(tc, 'alphaMissense', 'score'))), 'NA'))), '') AS functionalImpact,
         'KRAS' AS gene, (SELECT name FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024') AS studyName, cta.v AS cancerTypeAll,
         if(cn.v = floor(cn.v), toInt8(cn.v), NULL) AS cnv, multiIf(cnv IS NULL, '', cnv = 2, 'Amp', cnv = 1, 'Gain', cnv = 0, 'Diploid', cnv = -1, 'ShallowDel', 'DeepDel') AS copyNumber,
         m.vs AS validationStatus, m.center AS center,
         round(if(m.nAlt > 0 AND m.nRef >= 0, m.nAlt / (m.nAlt + m.nRef), NULL), if(if(m.nAlt > 0 AND m.nRef >= 0, m.nAlt / (m.nAlt + m.nRef), NULL) < 0.01, 4, 2)) AS vafNormal,
         if(m.nAlt > 0, m.nAlt, NULL) AS normalAltCount, m.nAlt AS normalAltCountRaw,
         if(m.nRef > 0, m.nRef, NULL) AS normalRefCount, m.nRef AS normalRefCountRaw,
         JSONExtractString(tc, 'exon') AS exon
  FROM mt0 AS m
  LEFT JOIN ann ON ann.alteration = m.proteinChange
  LEFT JOIN att AS tt ON tt.alteration = m.proteinChange AND tt.consequence = m.consequence AND tt.tumor_type = m.tumorType
  LEFT JOIN g0 AS g ON g.chr = m.chr AND g.start = m.start AND g.end = m.end AND g.ref = m.ref AND g.var = m.var
  LEFT JOIN ct0 AS ct ON ct.sid = m.sid LEFT JOIN mc0 AS mc ON mc.sid = m.sid
  LEFT JOIN cta0 AS cta ON cta.sid = m.sid LEFT JOIN cn0 AS cn ON cn.sid = m.sid AND cn.g = 'KRAS'
  UNION ALL
  SELECT 'Colorectal' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         (SELECT rg.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
          WHERE cs.cancer_study_identifier = 'msk_chord_2024') AS build,
         v.pid AS patient, v.sid AS sid, ct.v AS cancerType, multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS proteinChange,
         if(vp.found = 1, vp.oncogenicity, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.oncogenicity, va1.oncogenicity)) AS oncogenicity, if(vp.found = 1, vp.level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.level, va1.level)) AS level,
         if(vp.found = 1, vp.resistance_level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.resistance_level, va1.resistance_level)) AS resistanceLevel, if(vp.found = 1, vp.diagnostic_level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.diagnostic_level, va1.diagnostic_level)) AS diagnosticLevel, if(vp.found = 1, vp.prognostic_level, if(va2.oncogenicity != '' AND (va1.oncogenicity = '' OR va2.driver > va1.driver), va2.prognostic_level, va1.prognostic_level)) AS prognosticLevel,
         toUInt8(if(vn.found = 1, vn.driver, greatest(va1.driver, va2.driver))) AS drv,
         toUInt8(0) AS hot,
         'Fusion' AS mutationType, upper(v.class) AS variantType,
         NULL AS vaf, NULL AS altCount, NULL AS refCount,
         toInt64OrNull(mc.v) AS mutCount, v.chr AS chr, v.start AS start, NULL AS end, NULL AS ref, NULL AS var, v.status AS status, NULL AS pos,
         '' AS hgvsg,
         JSONExtractBool('', 'ok') AS gnOk,
         arrayFirst(t -> JSONExtractString(t, 'transcriptId') = JSONExtractString('', 'canonical', 'KRAS'), JSONExtractArrayRaw('', 'transcripts')) AS tc,
         JSONExtractString(tc, 'hgvsc') AS hgvsc,
         JSONExtractString('', 'clinvar', 'significance') AS clinvar, JSONExtractString('', 'clinvar', 'conflicting') AS clinvarConflicting,
         JSONExtractUInt('', 'clinvar', 'id') AS clinvarId,
         arrayLast(e -> position(JSONExtractString(e, 'mutationStatus'), 'germline') > 0, JSONExtractArrayRaw('', 'signal')) AS sig,
         if(lower(JSONExtractString(sig, 'mutationStatus')) = 'germline' AND arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) > 0, arraySum(arrayMap(c -> JSONExtractFloat(c, 'variantCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))) / arraySum(arrayMap(c -> JSONExtractFloat(c, 'tumorTypeCount'), JSONExtractArrayRaw(sig, 'countsByTumorType'))), NULL) AS signalFreq,
         JSONExtractString('', 'rsid') AS rsid, JSONExtractRaw('', 'gnomad') AS gnomadRaw, JSONExtractRaw('', 'vcf') AS vcfRaw,
         JSONExtractString('', 'seqRegion') AS seqRegion,
         multiIf(JSONType('', 'gnomad', 'exome') = 'Object' AND JSONType('', 'gnomad', 'genome') = 'Object', if(JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an') > 0, (JSONExtractFloat('', 'gnomad', 'exome', 'alleleCount', 'ac') + JSONExtractFloat('', 'gnomad', 'genome', 'alleleCount', 'ac')) / (JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an') + JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an')), 0), JSONType('', 'gnomad', 'exome') = 'Object', coalesce(JSONExtract('', 'gnomad', 'exome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an') > 0, JSONExtractFloat('', 'gnomad', 'exome', 'alleleCount', 'ac') / JSONExtractFloat('', 'gnomad', 'exome', 'alleleNumber', 'an'), 0)), JSONType('', 'gnomad', 'genome') = 'Object', coalesce(JSONExtract('', 'gnomad', 'genome', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an') > 0, JSONExtractFloat('', 'gnomad', 'genome', 'alleleCount', 'ac') / JSONExtractFloat('', 'gnomad', 'genome', 'alleleNumber', 'an'), 0)), NULL) AS gnomadFreq,
         JSONExtractRaw('', 'mutationAssessor') AS maRaw,
         if('' != '', concat(concat('MutationAssessor: ', if(JSONType('', 'mutationAssessor') = 'Object', concat('impact: ', multiIf(NOT JSONHas('', 'mutationAssessor', 'prediction'), 'undefined', JSONType('', 'mutationAssessor', 'prediction') = 'Null', 'null', JSONType('', 'mutationAssessor', 'prediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat('', 'mutationAssessor', 'prediction')), JSONExtractString('', 'mutationAssessor', 'prediction')), ', score: ', multiIf(NOT JSONHas('', 'mutationAssessor', 'score'), 'undefined', JSONType('', 'mutationAssessor', 'score') = 'Null', 'null', JSONType('', 'mutationAssessor', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat('', 'mutationAssessor', 'score')), JSONExtractString('', 'mutationAssessor', 'score'))), 'NA')), ';', concat('SIFT: ', if((JSONExtractFloat(tc, 'siftScore') != 0 OR JSONExtractString(tc, 'siftPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'siftPrediction'), 'undefined', JSONType(tc, 'siftPrediction') = 'Null', 'null', JSONType(tc, 'siftPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftPrediction')), JSONExtractString(tc, 'siftPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'siftScore'), 'undefined', JSONType(tc, 'siftScore') = 'Null', 'null', JSONType(tc, 'siftScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'siftScore')), JSONExtractString(tc, 'siftScore'))), 'NA')), ';', concat('Polyphen-2: ', if((JSONExtractFloat(tc, 'polyphenScore') != 0 OR JSONExtractString(tc, 'polyphenPrediction') != ''), concat('impact: ', multiIf(NOT JSONHas(tc, 'polyphenPrediction'), 'undefined', JSONType(tc, 'polyphenPrediction') = 'Null', 'null', JSONType(tc, 'polyphenPrediction') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenPrediction')), JSONExtractString(tc, 'polyphenPrediction')), ', score: ', multiIf(NOT JSONHas(tc, 'polyphenScore'), 'undefined', JSONType(tc, 'polyphenScore') = 'Null', 'null', JSONType(tc, 'polyphenScore') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'polyphenScore')), JSONExtractString(tc, 'polyphenScore'))), 'NA')), ';', concat('AlphaMissense: ', if((JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != ''), concat('pathogenicity: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'pathogenicity'), 'undefined', JSONType(tc, 'alphaMissense', 'pathogenicity') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'pathogenicity') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'pathogenicity')), JSONExtractString(tc, 'alphaMissense', 'pathogenicity')), ', score: ', multiIf(NOT JSONHas(tc, 'alphaMissense', 'score'), 'undefined', JSONType(tc, 'alphaMissense', 'score') = 'Null', 'null', JSONType(tc, 'alphaMissense', 'score') IN ('Int64', 'UInt64', 'Double'), toString(JSONExtractFloat(tc, 'alphaMissense', 'score')), JSONExtractString(tc, 'alphaMissense', 'score'))), 'NA'))), '') AS functionalImpact,
         v.gene1 AS gene, (SELECT name FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024') AS studyName, cta.v AS cancerTypeAll,
         if(cn.v = floor(cn.v), toInt8(cn.v), NULL) AS cnv, multiIf(cnv IS NULL, '', cnv = 2, 'Amp', cnv = 1, 'Gain', cnv = 0, 'Diploid', cnv = -1, 'ShallowDel', 'DeepDel') AS copyNumber,
         NULL AS validationStatus, 'N/A' AS center,
         round(if(NULL > 0 AND NULL >= 0, NULL / (NULL + NULL), NULL), if(if(NULL > 0 AND NULL >= 0, NULL / (NULL + NULL), NULL) < 0.01, 4, 2)) AS vafNormal,
         if(NULL > 0, NULL, NULL) AS normalAltCount, NULL AS normalAltCountRaw,
         if(NULL > 0, NULL, NULL) AS normalRefCount, NULL AS normalRefCountRaw,
         JSONExtractString(tc, 'exon') AS exon
  FROM v0 AS v
  LEFT JOIN vk0 AS vk ON vk.sid = v.sid
  LEFT JOIN sva AS va1 ON va1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS va2 ON va2.gene = v.gene2 AND v.gene2 != ''
  LEFT JOIN svp AS vp ON vp.site1_entrez = v.k1 AND vp.site2_entrez = v.k2 AND vp.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vp.tumor_type = vk.tumorType
  LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''
  LEFT JOIN ct0 AS ct ON ct.sid = v.sid LEFT JOIN mc0 AS mc ON mc.sid = v.sid
  LEFT JOIN cta0 AS cta ON cta.sid = v.sid LEFT JOIN cn0 AS cn ON cn.sid = v.sid AND cn.g = v.gene1
)
SELECT *, count() OVER () AS total FROM rows
WHERE (match(ifNull(toString(proteinChange), ''), '^G1[23]')) AND (CAST(vaf AS Nullable(Float64)) IS NOT NULL AND CAST(vaf AS Nullable(Float64)) >= 0.2)
ORDER BY CAST(vaf AS Nullable(Float64)) DESC NULLS LAST, sid, ord, proteinChange
LIMIT 25 OFFSET 0
