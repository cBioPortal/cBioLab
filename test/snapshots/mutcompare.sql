-- cohort Basal-like
-- brca_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))))

-- cohort Luminal A
-- brca_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))))

-- view 0 mutcompare: lollipop:changes · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))))),
sva AS (SELECT hugo_gene_symbol AS gene, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, toUInt8(max(is_driver)) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
  GROUP BY gene),
svp AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, any(t.oncogenicity) AS oncogenicity, any(t.highest_sensitive_level) AS level,
    toUInt8(max(t.oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
  FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
    AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))))
  GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type),
     v AS (SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
                  sv.class AS class, sv.event_info AS eventInfo, sv.sv_status AS status,
                  if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
           FROM snapshot_db.structural_variant sv
           JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
           JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
           JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
           JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
           LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
           LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
           WHERE cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION')
        OR (`GENE.hugoGeneSymbol`, proteinChange, ifNull(mutationType, '')) IN (SELECT DISTINCT mu.hugo_gene_symbol AS hugo_gene_symbol, mu.alteration AS alteration, mu.mutation_type AS mutation_type FROM (
    SELECT m.`GENE.hugoGeneSymbol` AS hugo_gene_symbol, m.proteinChange AS alteration, ifNull(m.mutationType, '') AS mutation_type,
      st.src AS src, assumeNotNull(m.chr) AS chr, m.startPosition AS start, m.endPosition AS end,
      assumeNotNull(m.referenceAllele) AS ref, assumeNotNull(m.tumorSeqAllele) AS var
    FROM snapshot_db.mutation_derived m
    INNER JOIN (SELECT cs.cancer_study_identifier AS study, multiIf(rg.name = 'hg19', 'genome_nexus', rg.name = 'hg38', 'genome_nexus_grch38', '') AS src FROM snapshot_db.cancer_study cs
      JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
      WHERE cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) st ON st.study = m.studyId
    WHERE m.studyId IN ('brca_tcga_pan_can_atlas_2018') AND m.`GENE.hugoGeneSymbol` IN ('TP53')
      AND st.src != '' AND ifNull(m.chr, '') != '' AND ifNull(m.startPosition, 0) != 0 AND ifNull(m.endPosition, 0) != 0
      AND ifNull(m.referenceAllele, '') != '' AND ifNull(m.tumorSeqAllele, '') != '' AND ifNull(m.proteinChange, '') != ''
  ) mu
  INNER JOIN (SELECT source, chr, start_position, end_position, reference_allele, variant_allele, any(data) AS d FROM annotation.variant
    WHERE (source, version) IN (('genome_nexus', '2.2.3-vep116-clinvar20260208+f2'), ('genome_nexus_grch38', '1.4.1-vepNA-clinvar20250106+f2'))
      AND JSONLength(data, 'hotspots') > 0
    GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele) v
  ON v.source = mu.src AND v.chr = mu.chr AND v.start_position = mu.start AND v.end_position = mu.end
    AND v.reference_allele = mu.ref AND v.variant_allele = mu.var
  WHERE if(positionCaseInsensitive(ifNull(mu.mutation_type, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(v.d, 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(v.d, 'hotspots')))), 1, 0) AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(if(vn.found = 1, vn.driver, greatest(a1.driver, a2.driver))) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v
           LEFT JOIN sva AS a1 ON a1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS a2 ON a2.gene = v.gene2 AND v.gene2 != ''
           LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver, topK(1)(multiIf(lowerUTF8(mtype) IN ('missense_mutation', 'missense', 'missense_variant'), 'missense', lowerUTF8(mtype) IN ('frame_shift_ins', 'frame_shift_del', 'frameshift', 'frameshift_deletion', 'frameshift_insertion', 'de_novo_start_outofframe', 'frameshift_variant', 'nonsense_mutation', 'nonsense', 'stopgain_snv', 'stop_gained', 'translation_start_site', 'initiator_codon_variant', 'start_codon_snp', 'start_codon_del', 'nonstop_mutation', 'stop_lost', 'truncating', 'feature_truncation'), 'truncating', lowerUTF8(mtype) IN ('inframe_del', 'inframe_deletion', 'in_frame_del', 'in_frame_deletion', 'inframe_ins', 'inframe_insertion', 'in_frame_ins', 'in_frame_insertion', 'indel', 'nonframeshift_deletion', 'nonframeshift', 'nonframeshift insertion', 'nonframeshift_insertion', 'inframe'), 'inframe', lowerUTF8(mtype) IN ('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region_variant', 'splice_region'), 'splice', lowerUTF8(mtype) IN ('fusion'), 'fusion', 'other'))[1] AS impact
FROM m WHERE sv = 0 GROUP BY gene, pos, change HAVING n >= 1

-- view 0 mutcompare: lollipop:changes · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))))),
sva AS (SELECT hugo_gene_symbol AS gene, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, toUInt8(max(is_driver)) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
  GROUP BY gene),
svp AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, any(t.oncogenicity) AS oncogenicity, any(t.highest_sensitive_level) AS level,
    toUInt8(max(t.oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
  FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
    AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))))
  GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type),
     v AS (SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
                  sv.class AS class, sv.event_info AS eventInfo, sv.sv_status AS status,
                  if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
           FROM snapshot_db.structural_variant sv
           JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
           JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
           JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
           JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
           LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
           LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
           WHERE cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION')
        OR (`GENE.hugoGeneSymbol`, proteinChange, ifNull(mutationType, '')) IN (SELECT DISTINCT mu.hugo_gene_symbol AS hugo_gene_symbol, mu.alteration AS alteration, mu.mutation_type AS mutation_type FROM (
    SELECT m.`GENE.hugoGeneSymbol` AS hugo_gene_symbol, m.proteinChange AS alteration, ifNull(m.mutationType, '') AS mutation_type,
      st.src AS src, assumeNotNull(m.chr) AS chr, m.startPosition AS start, m.endPosition AS end,
      assumeNotNull(m.referenceAllele) AS ref, assumeNotNull(m.tumorSeqAllele) AS var
    FROM snapshot_db.mutation_derived m
    INNER JOIN (SELECT cs.cancer_study_identifier AS study, multiIf(rg.name = 'hg19', 'genome_nexus', rg.name = 'hg38', 'genome_nexus_grch38', '') AS src FROM snapshot_db.cancer_study cs
      JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
      WHERE cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) st ON st.study = m.studyId
    WHERE m.studyId IN ('brca_tcga_pan_can_atlas_2018') AND m.`GENE.hugoGeneSymbol` IN ('TP53')
      AND st.src != '' AND ifNull(m.chr, '') != '' AND ifNull(m.startPosition, 0) != 0 AND ifNull(m.endPosition, 0) != 0
      AND ifNull(m.referenceAllele, '') != '' AND ifNull(m.tumorSeqAllele, '') != '' AND ifNull(m.proteinChange, '') != ''
  ) mu
  INNER JOIN (SELECT source, chr, start_position, end_position, reference_allele, variant_allele, any(data) AS d FROM annotation.variant
    WHERE (source, version) IN (('genome_nexus', '2.2.3-vep116-clinvar20260208+f2'), ('genome_nexus_grch38', '1.4.1-vepNA-clinvar20250106+f2'))
      AND JSONLength(data, 'hotspots') > 0
    GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele) v
  ON v.source = mu.src AND v.chr = mu.chr AND v.start_position = mu.start AND v.end_position = mu.end
    AND v.reference_allele = mu.ref AND v.variant_allele = mu.var
  WHERE if(positionCaseInsensitive(ifNull(mu.mutation_type, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(v.d, 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(v.d, 'hotspots')))), 1, 0) AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(if(vn.found = 1, vn.driver, greatest(a1.driver, a2.driver))) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v
           LEFT JOIN sva AS a1 ON a1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS a2 ON a2.gene = v.gene2 AND v.gene2 != ''
           LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver, topK(1)(multiIf(lowerUTF8(mtype) IN ('missense_mutation', 'missense', 'missense_variant'), 'missense', lowerUTF8(mtype) IN ('frame_shift_ins', 'frame_shift_del', 'frameshift', 'frameshift_deletion', 'frameshift_insertion', 'de_novo_start_outofframe', 'frameshift_variant', 'nonsense_mutation', 'nonsense', 'stopgain_snv', 'stop_gained', 'translation_start_site', 'initiator_codon_variant', 'start_codon_snp', 'start_codon_del', 'nonstop_mutation', 'stop_lost', 'truncating', 'feature_truncation'), 'truncating', lowerUTF8(mtype) IN ('inframe_del', 'inframe_deletion', 'in_frame_del', 'in_frame_deletion', 'inframe_ins', 'inframe_insertion', 'in_frame_ins', 'in_frame_insertion', 'indel', 'nonframeshift_deletion', 'nonframeshift', 'nonframeshift insertion', 'nonframeshift_insertion', 'inframe'), 'inframe', lowerUTF8(mtype) IN ('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region_variant', 'splice_region'), 'splice', lowerUTF8(mtype) IN ('fusion'), 'fusion', 'other'))[1] AS impact
FROM m WHERE sv = 0 GROUP BY gene, pos, change HAVING n >= 1

-- view 0 mutcompare: lollipop:samples · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))))))
SELECT uniqExact(sid) AS n FROM cohort

-- view 0 mutcompare: lollipop:samples · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))))))
SELECT uniqExact(sid) AS n FROM cohort

-- view 0 mutcompare: lollipop:totals · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))))),
     v AS (SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
                  sv.class AS class, sv.event_info AS eventInfo, sv.sv_status AS status,
                  if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
           FROM snapshot_db.structural_variant sv
           JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
           JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
           JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
           JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
           LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
           LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
           WHERE cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, 1 AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(1) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, uniqExactIf(pid, sv = 0) AS patients, uniqExactIf((pid, change), sv = 0) AS pairs,
       uniqExactIf(sid, (sv = 0 OR rgene = gene) AND positionCaseInsensitive(ifNull(status, ''), 'germline') = 0) AS somatic_samples
FROM m GROUP BY gene

-- view 0 mutcompare: lollipop:totals · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))))),
     v AS (SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
                  sv.class AS class, sv.event_info AS eventInfo, sv.sv_status AS status,
                  if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
           FROM snapshot_db.structural_variant sv
           JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
           JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
           JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
           JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
           LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
           LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
           WHERE cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, 1 AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(1) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, uniqExactIf(pid, sv = 0) AS patients, uniqExactIf((pid, change), sv = 0) AS pairs,
       uniqExactIf(sid, (sv = 0 OR rgene = gene) AND positionCaseInsensitive(ifNull(status, ''), 'germline') = 0) AS somatic_samples
FROM m GROUP BY gene

-- view 0 mutcompare: lollipop:types · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))))),
sva AS (SELECT hugo_gene_symbol AS gene, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, toUInt8(max(is_driver)) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
  GROUP BY gene),
svp AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, any(t.oncogenicity) AS oncogenicity, any(t.highest_sensitive_level) AS level,
    toUInt8(max(t.oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
  FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
    AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))))
  GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type),
     v AS (SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
                  sv.class AS class, sv.event_info AS eventInfo, sv.sv_status AS status,
                  if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
           FROM snapshot_db.structural_variant sv
           JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
           JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
           JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
           JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
           LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
           LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
           WHERE cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION')
        OR (`GENE.hugoGeneSymbol`, proteinChange, ifNull(mutationType, '')) IN (SELECT DISTINCT mu.hugo_gene_symbol AS hugo_gene_symbol, mu.alteration AS alteration, mu.mutation_type AS mutation_type FROM (
    SELECT m.`GENE.hugoGeneSymbol` AS hugo_gene_symbol, m.proteinChange AS alteration, ifNull(m.mutationType, '') AS mutation_type,
      st.src AS src, assumeNotNull(m.chr) AS chr, m.startPosition AS start, m.endPosition AS end,
      assumeNotNull(m.referenceAllele) AS ref, assumeNotNull(m.tumorSeqAllele) AS var
    FROM snapshot_db.mutation_derived m
    INNER JOIN (SELECT cs.cancer_study_identifier AS study, multiIf(rg.name = 'hg19', 'genome_nexus', rg.name = 'hg38', 'genome_nexus_grch38', '') AS src FROM snapshot_db.cancer_study cs
      JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
      WHERE cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) st ON st.study = m.studyId
    WHERE m.studyId IN ('brca_tcga_pan_can_atlas_2018') AND m.`GENE.hugoGeneSymbol` IN ('TP53')
      AND st.src != '' AND ifNull(m.chr, '') != '' AND ifNull(m.startPosition, 0) != 0 AND ifNull(m.endPosition, 0) != 0
      AND ifNull(m.referenceAllele, '') != '' AND ifNull(m.tumorSeqAllele, '') != '' AND ifNull(m.proteinChange, '') != ''
  ) mu
  INNER JOIN (SELECT source, chr, start_position, end_position, reference_allele, variant_allele, any(data) AS d FROM annotation.variant
    WHERE (source, version) IN (('genome_nexus', '2.2.3-vep116-clinvar20260208+f2'), ('genome_nexus_grch38', '1.4.1-vepNA-clinvar20250106+f2'))
      AND JSONLength(data, 'hotspots') > 0
    GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele) v
  ON v.source = mu.src AND v.chr = mu.chr AND v.start_position = mu.start AND v.end_position = mu.end
    AND v.reference_allele = mu.ref AND v.variant_allele = mu.var
  WHERE if(positionCaseInsensitive(ifNull(mu.mutation_type, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(v.d, 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(v.d, 'hotspots')))), 1, 0) AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(if(vn.found = 1, vn.driver, greatest(a1.driver, a2.driver))) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v
           LEFT JOIN sva AS a1 ON a1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS a2 ON a2.gene = v.gene2 AND v.gene2 != ''
           LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, pos, mtype, driver, count() AS rows
FROM m WHERE (gene, ifNull(pos, -1), change) IN (SELECT gene, ifNull(pos, -1), change FROM kept) GROUP BY gene, pos, mtype, driver

-- view 0 mutcompare: lollipop:types · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))))),
sva AS (SELECT hugo_gene_symbol AS gene, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, toUInt8(max(is_driver)) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
  GROUP BY gene),
svp AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, any(t.oncogenicity) AS oncogenicity, any(t.highest_sensitive_level) AS level,
    toUInt8(max(t.oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
  FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
    AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53'))))
  GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type),
     v AS (SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
                  sv.class AS class, sv.event_info AS eventInfo, sv.sv_status AS status,
                  if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
           FROM snapshot_db.structural_variant sv
           JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
           JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
           JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
           JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
           LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
           LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
           WHERE cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION')
        OR (`GENE.hugoGeneSymbol`, proteinChange, ifNull(mutationType, '')) IN (SELECT DISTINCT mu.hugo_gene_symbol AS hugo_gene_symbol, mu.alteration AS alteration, mu.mutation_type AS mutation_type FROM (
    SELECT m.`GENE.hugoGeneSymbol` AS hugo_gene_symbol, m.proteinChange AS alteration, ifNull(m.mutationType, '') AS mutation_type,
      st.src AS src, assumeNotNull(m.chr) AS chr, m.startPosition AS start, m.endPosition AS end,
      assumeNotNull(m.referenceAllele) AS ref, assumeNotNull(m.tumorSeqAllele) AS var
    FROM snapshot_db.mutation_derived m
    INNER JOIN (SELECT cs.cancer_study_identifier AS study, multiIf(rg.name = 'hg19', 'genome_nexus', rg.name = 'hg38', 'genome_nexus_grch38', '') AS src FROM snapshot_db.cancer_study cs
      JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
      WHERE cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) st ON st.study = m.studyId
    WHERE m.studyId IN ('brca_tcga_pan_can_atlas_2018') AND m.`GENE.hugoGeneSymbol` IN ('TP53')
      AND st.src != '' AND ifNull(m.chr, '') != '' AND ifNull(m.startPosition, 0) != 0 AND ifNull(m.endPosition, 0) != 0
      AND ifNull(m.referenceAllele, '') != '' AND ifNull(m.tumorSeqAllele, '') != '' AND ifNull(m.proteinChange, '') != ''
  ) mu
  INNER JOIN (SELECT source, chr, start_position, end_position, reference_allele, variant_allele, any(data) AS d FROM annotation.variant
    WHERE (source, version) IN (('genome_nexus', '2.2.3-vep116-clinvar20260208+f2'), ('genome_nexus_grch38', '1.4.1-vepNA-clinvar20250106+f2'))
      AND JSONLength(data, 'hotspots') > 0
    GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele) v
  ON v.source = mu.src AND v.chr = mu.chr AND v.start_position = mu.start AND v.end_position = mu.end
    AND v.reference_allele = mu.ref AND v.variant_allele = mu.var
  WHERE if(positionCaseInsensitive(ifNull(mu.mutation_type, ''), 'splice') > 0, arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'splice') > 0, JSONExtractArrayRaw(v.d, 'hotspots')), arrayExists(h -> positionCaseInsensitive(JSONExtractString(h, 'type'), 'single') > 0 OR positionCaseInsensitive(JSONExtractString(h, 'type'), 'indel') > 0, JSONExtractArrayRaw(v.d, 'hotspots')))), 1, 0) AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(if(vn.found = 1, vn.driver, greatest(a1.driver, a2.driver))) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v
           LEFT JOIN sva AS a1 ON a1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS a2 ON a2.gene = v.gene2 AND v.gene2 != ''
           LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, pos, mtype, driver, count() AS rows
FROM m WHERE (gene, ifNull(pos, -1), change) IN (SELECT gene, ifNull(pos, -1), change FROM kept) GROUP BY gene, pos, mtype, driver

-- view 0 mutcompare: mutcompare:mutated:Basal-like · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))))))
SELECT g.hugo_gene_symbol AS gene, uniqExact(g.sample_unique_id) AS altered
FROM snapshot_db.genomic_event_derived g
WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
  AND replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY gene

-- view 0 mutcompare: mutcompare:mutated:Luminal A · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))))))
SELECT g.hugo_gene_symbol AS gene, uniqExact(g.sample_unique_id) AS altered
FROM snapshot_db.genomic_event_derived g
WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
  AND replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
GROUP BY gene

-- view 0 mutcompare: mutcompare:panels:Basal-like · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal'))))))),
pc AS (
  SELECT sp.gene_panel_id AS panel, uniqExact(sp.sample_unique_id) AS n
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND sp.gene_panel_id != 'WES' AND replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  GROUP BY panel
)
SELECT gptg.gene AS gene, sum(pc.n) AS profiled
FROM snapshot_db.gene_panel_to_gene_derived gptg INNER JOIN pc ON pc.panel = gptg.gene_panel_id
GROUP BY gene

-- view 0 mutcompare: mutcompare:panels:Luminal A · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA'))))))),
pc AS (
  SELECT sp.gene_panel_id AS panel, uniqExact(sp.sample_unique_id) AS n
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND sp.gene_panel_id != 'WES' AND replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  GROUP BY panel
)
SELECT gptg.gene AS gene, sum(pc.n) AS profiled
FROM snapshot_db.gene_panel_to_gene_derived gptg INNER JOIN pc ON pc.panel = gptg.gene_panel_id
GROUP BY gene

-- view 0 mutcompare: mutcompare:profiled:Basal-like · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))))))
SELECT uniqExact(c.pid) AS n
FROM cohort c
WHERE c.sid IN (
  SELECT replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))
)

-- view 0 mutcompare: mutcompare:profiled:Luminal A · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))))))
SELECT uniqExact(c.pid) AS n
FROM cohort c
WHERE c.sid IN (
  SELECT replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))
)

-- view 0 mutcompare: mutcompare:wes:Basal-like · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_Basal')))))))
SELECT uniqExact(sp.sample_unique_id) AS n
FROM snapshot_db.sample_to_gene_panel_derived sp
WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
  AND sp.gene_panel_id = 'WES' AND replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)

-- view 0 mutcompare: mutcompare:wes:Luminal A · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND (('sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))) OR ('patient', replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', ''), replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND attribute_name = 'SUBTYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('BRCA_LumA')))))))
SELECT uniqExact(sp.sample_unique_id) AS n
FROM snapshot_db.sample_to_gene_panel_derived sp
WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
  AND sp.gene_panel_id = 'WES' AND replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
