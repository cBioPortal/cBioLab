-- cohort NSCLC
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))

-- view 0 drivernegative: cytobands · msk_chord_2024
SELECT g.hugo_gene_symbol AS gene, any(rgg.cytoband) AS cytoband FROM snapshot_db.gene g
JOIN snapshot_db.reference_genome_gene rgg ON rgg.entrez_gene_id = g.entrez_gene_id
WHERE rgg.reference_genome_id = (SELECT reference_genome_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024')
  AND g.hugo_gene_symbol IN ('KMT2D','NF1','RBM10','TP53','NFE2L2','CDKN2A','RASA1','PTEN','KEAP1','MAP2K1','ARID1A','ANKRD11','FBXW7','CASP8','U2AF1','RB1','NRAS','NOTCH1','KMT2C','ERBB4','IRS2','PIK3CB','PREX2','KMT2A','KMT2B','EP300','EPHB1','NOTCH3','DICER1','COP1','PDGFRA','BRCA2','MAX','FGFR3','PIK3C3','CREBBP','SMARCA4','EIF1AX','ZFHX3','SPEN','SUZ12','PBRM1','PTPRT','CUL3','LATS2','FOXL2','ATM','PRKN','YES1','FAT1','KDM6A','RAF1','KIT','TET1','CSF3R','BRCA1','EZH2','POLD1','FANCA','BRIP1','IRS1','LZTR1','RRAS','INPPL1','KDR','PIK3CG','H3C10','HRAS','DAXX','PIK3C2G','NEGR1','ARID2','GAB1','ARHGAP35','STAT3','AURKA','NSD2','TBX3','NKX2-1','ALOX12B','GNAQ','AXL','WHR1','WT1','ARID1B','NFKBIA','HGF','AKT1','RIT1','CD79A','JAK2','SRSF2','NOTCH2','PHOX2B','NSD3','KDM5A','INPP4A','RRAS2','IL7R','PGR','PIK3R3','MEN1','IKBKE','TENT5C','EPHA7','PAK5','DOT1L','CBL','PAK1','SOX2','ERBB3','H1-2','SOX9','PHF6','VTCN1','TCF7L2','H3C3','MAP3K1','DDR2','TSC1','CYP19A1','NOTCH4','CTNNB1','MEF2B','TSC2','H3C4','SOX17','JAK3','FLT4','POLE','ATR','IRF4','GATA2','RECQL4','RPS6KA4','CDK12','FGFR1','BARD1','RICTOR','RAB35','CHEK1','B2M','DROSHA','IFNGR1','FOXP1','XPO1','APLNR','TRAF2','IGF2','GATA3','JAK1','PLCG2','MSH3','MSH2','MDC1','FGFR2','STAT5B','TET2','ESR1','BABAM1','MPL','NUP93','APC','SLFN11','BAP1','PTPRD','MYC','MSI1','HNF1A','PIK3R1','PMS2','UPF1','BRD4','SMARCD1','CTCF','LATS1','IDH2','LMO1','MAPKAP1','DNAJB1','FH','HOXB13','KLF4','ACVR1','GRIN2A','FGF19','RAD52','CYLD','BIRC3','GATA1','TP63','CALR','SUFU','CDK6','IGF1','EPAS1','TP53BP1','FUBP1','ETV6','FYN','ASXL1','PTP4A1','ARAF','TNFAIP3','IGF1R','SERPINB4','AXIN1','EED','SYK','SETD2','MLH1','RECQL','MYD88','VHL','RPTOR','REL','IKZF1','EIF4A2','CDH1','NSD1','EPHA3','NF2','CIC','PDPK1','PTPRS','CXCR4','MDM2','AR','GPS2','LYN','H3C7','BCL6','MTOR','MYCN','TAP2','PRDM14','BBC3','RAD51','MSH6','BMPR1A','SETDB1','SESN3','VEGFA','REST','BLM','PRKAR1A','SMARCB1','TEK','GSK3B','H3-5','ERCC5','CDK8','MDM4','RAD54L','ERCC4','PMS1','SOCS1','RPS6KB2','EPHA5','SOS1','RAD21','RAC1','PDCD1LG2','SMAD4','STK11','TRIP13','TNFRSF14','FGF3','CTR9','SMARCA2','BCL10','AKT2','NBN','GNB1','CD79B','STK40','GREM1','PNRC1','PTCH1','INHBA','CDKN2C','SDHA','ATRX','MST1','RAD50','AXIN2','TSHR','CARD11','EIF4E','PRKD1','ID3','CBFB','FGFR4','MSI2','JUN','MITF','ZNRF3','INHA','FOXA1','H3-4')
GROUP BY gene

-- view 0 drivernegative: drivernegative:altered · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
mp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
cov AS (
  SELECT mp.pid AS pid, max(mp.panel = 'WES') AS wes, uniqExactIf(gp.gene, gp.gene IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3')) AS ng
  FROM mp LEFT JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = mp.panel
  GROUP BY pid
),
drv AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.hugo_gene_symbol IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3') AND ann.is_driver
    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
grp AS (
  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = 11, 'negative', 'unprofiled') AS g FROM cov
)
SELECT g.hugo_gene_symbol AS gene, grp.g AS grp, uniqExact(replaceOne(g.patient_unique_id, 'msk_chord_2024_', '')) AS altered
FROM snapshot_db.genomic_event_derived g
  INNER JOIN grp ON grp.pid = replaceOne(g.patient_unique_id, 'msk_chord_2024_', '')
WHERE g.cancer_study_identifier = 'msk_chord_2024' AND NOT g.off_panel AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
  AND g.hugo_gene_symbol NOT IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3') AND grp.g IN ('positive', 'negative')
  AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
GROUP BY gene, grp

-- view 0 drivernegative: drivernegative:groups · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
mp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
cov AS (
  SELECT mp.pid AS pid, max(mp.panel = 'WES') AS wes, uniqExactIf(gp.gene, gp.gene IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3')) AS ng
  FROM mp LEFT JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = mp.panel
  GROUP BY pid
),
drv AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.hugo_gene_symbol IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3') AND ann.is_driver
    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
grp AS (
  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = 11, 'negative', 'unprofiled') AS g FROM cov
)
SELECT g AS grp, count() AS n FROM grp GROUP BY grp

-- view 0 drivernegative: drivernegative:profiled · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))))),
mp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
cov AS (
  SELECT mp.pid AS pid, max(mp.panel = 'WES') AS wes, uniqExactIf(gp.gene, gp.gene IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3')) AS ng
  FROM mp LEFT JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = mp.panel
  GROUP BY pid
),
drv AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN oncokb_annotation.variant_annotation ann
    ON ann.oncokb_version = 'v7.5' AND ann.is_driver
   AND ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)
     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))
     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))
  WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.hugo_gene_symbol IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3') AND ann.is_driver
    AND ((g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED') OR (g.variant_type = 'cna' AND abs(g.cna_alteration) >= 2) OR g.variant_type = 'structural_variant')
    AND replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM cohort)
),
grp AS (
  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = 11, 'negative', 'unprofiled') AS g FROM cov
),
pw AS (SELECT pid, max(panel = 'WES') AS wes FROM pp GROUP BY pid)
SELECT if(pw.wes = 1, '', gp.gene) AS gene, grp.g AS grp, uniqExact(pp.pid) AS profiled
FROM pp INNER JOIN pw ON pw.pid = pp.pid INNER JOIN grp ON grp.pid = pp.pid
  LEFT JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel
WHERE grp.g IN ('positive', 'negative')
GROUP BY gene, grp
