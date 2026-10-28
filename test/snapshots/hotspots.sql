-- cohort CRC
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))

-- view 0 hotspots: lollipop:changes · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM oncokb_annotation.variant_annotation
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION'), 1, 0) AS driver
           FROM snapshot_db.mutation_derived
           WHERE studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` IN ('KRAS','BRAF','PIK3CA','TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 3)
SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver, topK(1)(multiIf(lowerUTF8(mtype) IN ('missense_mutation', 'missense', 'missense_variant'), 'missense', lowerUTF8(mtype) IN ('frame_shift_ins', 'frame_shift_del', 'frameshift', 'frameshift_deletion', 'frameshift_insertion', 'de_novo_start_outofframe', 'frameshift_variant', 'nonsense_mutation', 'nonsense', 'stopgain_snv', 'stop_gained', 'translation_start_site', 'initiator_codon_variant', 'start_codon_snp', 'start_codon_del', 'nonstop_mutation', 'stop_lost', 'truncating', 'feature_truncation'), 'truncating', lowerUTF8(mtype) IN ('inframe_del', 'inframe_deletion', 'in_frame_del', 'in_frame_deletion', 'inframe_ins', 'inframe_insertion', 'in_frame_ins', 'in_frame_insertion', 'indel', 'nonframeshift_deletion', 'nonframeshift', 'nonframeshift insertion', 'nonframeshift_insertion', 'inframe'), 'inframe', lowerUTF8(mtype) IN ('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region_variant', 'splice_region'), 'splice', lowerUTF8(mtype) IN ('fusion'), 'fusion', 'other'))[1] AS impact
FROM m GROUP BY gene, pos, change HAVING n >= 3

-- view 0 hotspots: lollipop:samples · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))))))
SELECT uniqExact(sid) AS n FROM cohort

-- view 0 hotspots: lollipop:totals · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, 1 AS driver
           FROM snapshot_db.mutation_derived
           WHERE studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` IN ('KRAS','BRAF','PIK3CA','TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, uniqExact(pid) AS patients, uniqExact((pid, change)) AS pairs,
       uniqExactIf(sid, status != 'GERMLINE') AS somatic_samples
FROM m GROUP BY gene

-- view 0 hotspots: lollipop:types · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))))),
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM oncokb_annotation.variant_annotation
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION'), 1, 0) AS driver
           FROM snapshot_db.mutation_derived
           WHERE studyId = 'msk_chord_2024' AND `GENE.hugoGeneSymbol` IN ('KRAS','BRAF','PIK3CA','TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 3)
SELECT gene, pos, mtype, driver, count() AS rows
FROM m WHERE (gene, ifNull(pos, -1), change) IN (SELECT gene, ifNull(pos, -1), change FROM kept) GROUP BY gene, pos, mtype, driver
