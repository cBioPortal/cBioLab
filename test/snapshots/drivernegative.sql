-- cohort NSCLC
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))

-- view 0 drivernegative: cytobands · msk_chord_2024
SELECT g.hugo_gene_symbol AS gene, any(rgg.cytoband) AS cytoband FROM snapshot_db.gene g
JOIN snapshot_db.reference_genome_gene rgg ON rgg.entrez_gene_id = g.entrez_gene_id
WHERE rgg.reference_genome_id = (SELECT reference_genome_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024')
  AND g.hugo_gene_symbol IN ('NF1','KMT2D','RBM10','TP53','NFE2L2','CDKN2A','RASA1','PTEN','KEAP1','ARID1A','ANKRD11','MAP2K1','U2AF1','NRAS','CASP8','RB1','FBXW7','NOTCH1','ERBB4','PREX2','KMT2C','IRS2','PIK3CB','KMT2A','NOTCH3','KMT2B','COP1','PDGFRA','EPHB1','EP300','MAX','DICER1','EIF1AX','PIK3C3','SMARCA4','SUZ12','FGFR3','ZFHX3','PRKN','CREBBP','CUL3','KIT','FOXL2','RAF1','BRCA2','ATM','PBRM1','KDM6A','PTPRT','LATS2','LZTR1','SPEN','FAT1','YES1','TET1','FANCA','BRCA1','IRS1','RRAS','POLD1','PIK3CG','CSF3R','NEGR1','BRIP1','HRAS','ARID2','KDR','ARID1B','EZH2','INPPL1','NKX2-1','ARHGAP35','AURKA','PIK3C2G','STAT3','GNAQ','WHR1','WT1','ALOX12B','NFKBIA','RIT1','NSD2','GAB1','HGF','NSD3','AXL','PAK5','H3C10','RRAS2','SRSF2','TBX3','INPP4A','CBL','DAXX','PIK3R3','PGR','H1-2','JAK2','PHOX2B','DOT1L','PAK1','CD79A','PHF6','ERBB3','IL7R','MEN1','NOTCH2','IKBKE','AKT1','EPHA7','H3C3','TSC1','CYP19A1','SOX2','DDR2','SOX9','NOTCH4','H3C4','IFNGR1','SOX17','KDM5A','CTNNB1','IRF4','MAP3K1','TENT5C','RAB35','TCF7L2','VTCN1','POLE','FLT4','TSC2','JAK3','CDK12','GATA2','RPS6KA4','RICTOR','MEF2B','FOXP1','XPO1','APLNR','BARD1','FGFR1','DROSHA','PLCG2','B2M','FGFR2','CHEK1','BABAM1','MPL','FGF19','REL','RECQL4','KLF4','BAP1','MSH2','CDK6','MYC','SMARCD1','JAK1','TET2','SLFN11','UPF1','LMO1','MAPKAP1','PMS2','LATS1','ATR','HOXB13','DNAJB1','NUP93','PTPRD','GRIN2A','PIK3R1','BRD4','RAD52','HNF1A','TRAF2','CALR','IGF1','MSI1','TP63','PTP4A1','MSH3','EPAS1','H3C7','TNFAIP3','SERPINB4','MDM2','SUFU','EED','MDC1','AXIN1','MYD88','RPTOR','CIC','STAT5B','VHL','ESR1','SETDB1','IGF2','CYLD','EIF4A2','CTCF','ASXL1','BIRC3','FH','GATA1','ARAF','ACVR1','FUBP1','IGF1R','PDPK1','CXCR4','SETD2','GATA3','GPS2','APC','MLH1','RECQL','RAD51','IDH2','NF2','IKZF1','ETV6','SYK','VEGFA','SESN3','BMPR1A','REST','SMARCB1','AR','TP53BP1','TEK','LYN','MYCN','BCL6','GSK3B','RAD54L','H3-5','ERCC5','CD79B','MSI2','ERCC4','PMS1','SOCS1','STK11','SMAD4','MTOR','ZNRF3','PRDM14','BLM','EPHA5','PDCD1LG2','TRIP13','CTR9','EPHA3','TNFRSF14','MSH6','FGF3','RAD21','SMARCA2','CDH1','AKT2','BBC3','MDM4','H3-4','GREM1','PTCH1','INHBA','FYN','CDKN2C','STK40','MST1','TAP2','NSD1','TSHR','RPS6KB2','EIF4E','ID3','IDH1','MITF','ICOSLG','PTPRS','CBFB','PRKAR1A','CDK8','CSDE1','RAD50','SESN1','PRKD1','RAD51B','FLT3','FGFR4','RAC1','NBN','H3-3B','PMAIP1','SESN2','SRC','MED12')
GROUP BY gene

-- view 0 drivernegative: drivernegative:altered · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))),
mp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
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
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
grp AS (
  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = 11, 'negative', 'unprofiled') AS g FROM cov
)
SELECT g.hugo_gene_symbol AS gene, grp.g AS grp, uniqExact(replaceOne(g.patient_unique_id, 'msk_chord_2024_', '')) AS altered
FROM snapshot_db.genomic_event_derived g
  INNER JOIN grp ON grp.pid = replaceOne(g.patient_unique_id, 'msk_chord_2024_', '')
WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
  AND g.hugo_gene_symbol NOT IN ('EGFR', 'KRAS', 'ALK', 'ROS1', 'BRAF', 'MET', 'RET', 'ERBB2', 'NTRK1', 'NTRK2', 'NTRK3') AND grp.g IN ('positive', 'negative')
GROUP BY gene, grp

-- view 0 drivernegative: drivernegative:groups · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))),
mp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
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
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
grp AS (
  SELECT pid, multiIf(pid IN (SELECT pid FROM drv), 'positive', wes = 1 OR ng = 11, 'negative', 'unprofiled') AS g FROM cov
)
SELECT g AS grp, count() AS n FROM grp GROUP BY grp

-- view 0 drivernegative: drivernegative:profiled · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Non-Small Cell Lung Cancer'))))),
mp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
),
pp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
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
    AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
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
