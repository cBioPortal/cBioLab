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
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION'), 1, 0) AS driver
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver, topK(1)(multiIf(lowerUTF8(mtype) IN ('missense_mutation', 'missense', 'missense_variant'), 'missense', lowerUTF8(mtype) IN ('frame_shift_ins', 'frame_shift_del', 'frameshift', 'frameshift_deletion', 'frameshift_insertion', 'de_novo_start_outofframe', 'frameshift_variant', 'nonsense_mutation', 'nonsense', 'stopgain_snv', 'stop_gained', 'translation_start_site', 'initiator_codon_variant', 'start_codon_snp', 'start_codon_del', 'nonstop_mutation', 'stop_lost', 'truncating', 'feature_truncation'), 'truncating', lowerUTF8(mtype) IN ('inframe_del', 'inframe_deletion', 'in_frame_del', 'in_frame_deletion', 'inframe_ins', 'inframe_insertion', 'in_frame_ins', 'in_frame_insertion', 'indel', 'nonframeshift_deletion', 'nonframeshift', 'nonframeshift insertion', 'nonframeshift_insertion', 'inframe'), 'inframe', lowerUTF8(mtype) IN ('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region_variant', 'splice_region'), 'splice', lowerUTF8(mtype) IN ('fusion'), 'fusion', 'other'))[1] AS impact
FROM m GROUP BY gene, pos, change HAVING n >= 1

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
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION'), 1, 0) AS driver
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, pos, change, uniqExact(pid) AS n, count() AS rows, max(driver) AS driver, topK(1)(multiIf(lowerUTF8(mtype) IN ('missense_mutation', 'missense', 'missense_variant'), 'missense', lowerUTF8(mtype) IN ('frame_shift_ins', 'frame_shift_del', 'frameshift', 'frameshift_deletion', 'frameshift_insertion', 'de_novo_start_outofframe', 'frameshift_variant', 'nonsense_mutation', 'nonsense', 'stopgain_snv', 'stop_gained', 'translation_start_site', 'initiator_codon_variant', 'start_codon_snp', 'start_codon_del', 'nonstop_mutation', 'stop_lost', 'truncating', 'feature_truncation'), 'truncating', lowerUTF8(mtype) IN ('inframe_del', 'inframe_deletion', 'in_frame_del', 'in_frame_deletion', 'inframe_ins', 'inframe_insertion', 'in_frame_ins', 'in_frame_insertion', 'indel', 'nonframeshift_deletion', 'nonframeshift', 'nonframeshift insertion', 'nonframeshift_insertion', 'inframe'), 'inframe', lowerUTF8(mtype) IN ('splice_site', 'splice', 'splice site', 'splicing', 'splice_site_snp', 'splice_site_del', 'splice_site_indel', 'splice_region_variant', 'splice_region'), 'splice', lowerUTF8(mtype) IN ('fusion'), 'fusion', 'other'))[1] AS impact
FROM m GROUP BY gene, pos, change HAVING n >= 1

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
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, 1 AS driver
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, uniqExact(pid) AS patients, uniqExact((pid, change)) AS pairs,
       uniqExactIf(sid, status != 'GERMLINE') AS somatic_samples
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
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, 1 AS driver
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
     kept AS (SELECT gene, pos, change FROM m GROUP BY gene, pos, change HAVING uniqExact(pid) >= 1)
SELECT gene, uniqExact(pid) AS patients, uniqExact((pid, change)) AS pairs,
       uniqExactIf(sid, status != 'GERMLINE') AS somatic_samples
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
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION'), 1, 0) AS driver
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
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
     m AS (SELECT `GENE.hugoGeneSymbol` AS gene, proteinPosStart AS pos, proteinChange AS change, mutationType AS mtype,
                  patientId AS pid, sampleId AS sid, mutationStatus AS status, if((`GENE.hugoGeneSymbol`, proteinChange) IN (SELECT hugo_gene_symbol, alteration FROM annotation.oncokb
        WHERE oncokb_version = 'v7.5' AND is_driver AND alteration_type = 'MUTATION'), 1, 0) AS driver
           FROM snapshot_db.mutation_derived
           WHERE startsWith(molecularProfileId, 'brca_tcga_pan_can_atlas_2018_') AND studyId = 'brca_tcga_pan_can_atlas_2018' AND `GENE.hugoGeneSymbol` IN ('TP53')
             AND molecularProfileId NOT LIKE '%uncalled%' AND proteinChange != ''
             AND sampleId IN (SELECT sid FROM cohort)),
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
