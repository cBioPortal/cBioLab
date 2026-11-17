-- cohort CRC
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

-- view 0 hotspots: genome:build · msk_chord_2024
SELECT rg.name AS build FROM snapshot_db.cancer_study cs
JOIN snapshot_db.reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id
WHERE cs.cancer_study_identifier = 'msk_chord_2024'

-- view 0 hotspots: lollipop:changes · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
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
      AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53'))))
    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),
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
           WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')))
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
      WHERE cs.cancer_study_identifier IN ('msk_chord_2024')) st ON st.study = m.studyId
    WHERE m.studyId IN ('msk_chord_2024') AND m.`GENE.hugoGeneSymbol` IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')
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
           WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` IN ('KRAS','BRAF','PIK3CA','TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('KRAS','BRAF','PIK3CA','TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(if(vn.found = 1, vn.driver, greatest(a1.driver, a2.driver))) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v
           LEFT JOIN sva AS a1 ON a1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS a2 ON a2.gene = v.gene2 AND v.gene2 != ''
           LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 3)
SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver, topK(1)(multiIf(lowerUTF8(mtype) IN ('missense_mutation', 'missense', 'missense_variant'), 'missense', lowerUTF8(mtype) IN ('frame_shift_ins', 'frame_shift_del', 'frameshift', 'frameshift_deletion', 'frameshift_insertion', 'de_novo_start_outofframe', 'frameshift_variant', 'nonsense_mutation', 'nonsense', 'stopgain_snv', 'stop_gained', 'translation_start_site', 'initiator_codon_variant', 'start_codon_snp', 'start_codon_del', 'nonstop_mutation', 'stop_lost', 'truncating', 'feature_truncation'), 'truncating', lowerUTF8(mtype) IN ('inframe_del', 'inframe_deletion', 'in_frame_del', 'in_frame_deletion', 'inframe_ins', 'inframe_insertion', 'in_frame_ins', 'in_frame_insertion', 'indel', 'nonframeshift_deletion', 'nonframeshift', 'nonframeshift insertion', 'nonframeshift_insertion', 'inframe'), 'inframe', lowerUTF8(mtype) IN ('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region_variant', 'splice_region'), 'splice', lowerUTF8(mtype) IN ('fusion'), 'fusion', 'other'))[1] AS impact
FROM m WHERE sv = 0 GROUP BY gene, pos, change HAVING n >= 3

-- view 0 hotspots: lollipop:germline-consented · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))))))
SELECT (SELECT count() FROM snapshot_db.sample_list WHERE stable_id = 'msk_chord_2024_germline') AS lists,
       uniqExactIf(smp.stable_id, smp.stable_id IN (SELECT sid FROM cohort)) AS n
FROM snapshot_db.sample_list sl
JOIN snapshot_db.sample_list_list sll ON sll.list_id = sl.list_id
JOIN snapshot_db.sample smp ON smp.internal_id = sll.sample_id
WHERE sl.stable_id = 'msk_chord_2024_germline'

-- view 0 hotspots: lollipop:samples · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))))))
SELECT uniqExact(sid) AS n FROM cohort

-- view 0 hotspots: lollipop:totals · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
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
           WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')))
             AND smp.stable_id IN (SELECT sid FROM cohort)),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, 1 AS driver, toUInt8(0) AS sv, gene AS rgene
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` IN ('KRAS','BRAF','PIK3CA','TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('KRAS','BRAF','PIK3CA','TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(1) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, uniqExactIf(pid, sv = 0) AS patients, uniqExactIf((pid, change), sv = 0) AS pairs,
       uniqExactIf(sid, (sv = 0 OR rgene = gene) AND positionCaseInsensitive(ifNull(status, ''), 'germline') = 0) AS somatic_samples,
       uniqExactIf(sid, (sv = 0 OR rgene = gene) AND positionCaseInsensitive(ifNull(status, ''), 'germline') > 0 AND ((SELECT count() FROM snapshot_db.sample_list WHERE stable_id = 'msk_chord_2024_germline') = 0 OR sid IN (SELECT smp.stable_id FROM snapshot_db.sample_list sl JOIN snapshot_db.sample_list_list sll ON sll.list_id = sl.list_id JOIN snapshot_db.sample smp ON smp.internal_id = sll.sample_id WHERE sl.stable_id = 'msk_chord_2024_germline'))) AS germline_samples
FROM m GROUP BY gene

-- view 0 hotspots: lollipop:types · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
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
      AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53'))))
    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),
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
           WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
             AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')))
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
      WHERE cs.cancer_study_identifier IN ('msk_chord_2024')) st ON st.study = m.studyId
    WHERE m.studyId IN ('msk_chord_2024') AND m.`GENE.hugoGeneSymbol` IN ('KRAS', 'BRAF', 'PIK3CA', 'TP53')
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
           WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` IN ('KRAS','BRAF','PIK3CA','TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)
           UNION ALL
           SELECT arrayJoin(arrayFilter(x -> x IN ('KRAS','BRAF','PIK3CA','TP53'), arrayDistinct([v.gene1, v.gene2]))) AS gene, NULL AS pos,
                  multiIf(v.gene1 != '' AND v.gene2 != '' AND v.gene1 != v.gene2, concat(v.gene1, '-', v.gene2, ' Fusion'), v.gene1 != '' AND v.gene2 != '', concat(v.gene1, ' intragenic'), v.gene1 != '' OR v.gene2 != '', concat(if(v.gene1 != '', v.gene1, v.gene2), if((upper(ifNull(v.class, '')) = 'INTERGENIC' OR (upper(ifNull(v.class, '')) IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(v.eventInfo, '')) = concat(upper(if(v.gene1 != '', v.gene1, v.gene2)), '-INTERGENIC'))), ' intergenic', ' intragenic')), 'undefined intragenic') AS change, 'Fusion' AS mtype, v.pid AS pid, v.sid AS sid, v.status AS status,
                  toUInt8(if(vn.found = 1, vn.driver, greatest(a1.driver, a2.driver))) AS driver, toUInt8(1) AS sv, v.gene1 AS rgene
           FROM v
           LEFT JOIN sva AS a1 ON a1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS a2 ON a2.gene = v.gene2 AND v.gene2 != ''
           LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN')) AND vn.tumor_type = ''),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 3)
SELECT gene, pos, mtype, driver, count() AS rows
FROM m WHERE (gene, ifNull(pos, -1), change) IN (SELECT gene, ifNull(pos, -1), change FROM kept) GROUP BY gene, pos, mtype, driver
