-- cohort Colorectal, MSS
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable')))))

-- cohort Pancreatic, MSS
-- msk_chord_2024
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable')))))

-- view 0 enrichment: cytobands · msk_chord_2024
SELECT g.hugo_gene_symbol AS gene, any(rgg.cytoband) AS cytoband FROM snapshot_db.gene g
JOIN snapshot_db.reference_genome_gene rgg ON rgg.entrez_gene_id = g.entrez_gene_id
WHERE rgg.reference_genome_id = (SELECT reference_genome_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'msk_chord_2024')
  AND g.hugo_gene_symbol IN ('APC','KRAS','CDKN2A','TCF7L2','PIK3CA','FBXW7','SOX9','BRAF','AMER1','SMAD2','MEN1','TP53','CTNNB1','NRAS','PIK3R1','PTPRT','PTPRS','EPHA3','CARD11','GRIN2A','ASXL1','MTOR','PLCG2','KDR','ERBB2','NF1','EPHA5','PIK3CG','ERBB3','PDGFRA','PTEN','AR','ALK','ZFHX3','PIK3C2G','AXIN2','EPHA7','B2M','SOX17','KDM6A','SLX4','CREBBP','FAT1','NCOR1','NOTCH3','SMO','TP53BP1','INHBA','ATM','NOTCH4','TET1','EPHB1','IKZF1','ATR','MITF','SPEN','ROS1','IRS1','DAXX','MAP3K1','FOXP1','U2AF1','PREX2','TBX3','POLE','PTCH1','HGF','ERBB4','RASA1','TGFBR2','NSD1','KMT2A','FLT4','IGF1R','DICER1','ARID1B','MUTYH','SMAD3','SMAD4','TET2','KMT2B','TEK','PPP2R1A','AXL','DNMT3B','STAT3','PIK3CD','ESR1','AKT1','GATA3','MRE11','ANKRD11','FLT3','PMS1','NSD3','CDK8','BRIP1','CTCF','TP63','MGA','LATS2','STK11','DROSHA','BRD4','KDM5A','DNMT1','PRKN','ASXL2','NTRK3','RAF1','CSF3R','PTPRD','EP300','SMARCA2','MAP2K1','LZTR1','PRDM1','POLD1','FLCN','CYLD','BMPR1A','PAK5','GLI1','ERCC4','KIT','SESN1','FGFR1','ALB','MDC1','PGR','DDR2','ALOX12B','ETV1','PTPN11','MYOD1','CASP8','NOTCH2','BRCA1','CYSLTR2','INPP4B','TERT','BARD1','ARID5B','RET','RNF43','CIC','MSH2','PAX5','JAK3','DOT1L','ELF3','CHEK2','IRF4','ERCC5','TSHR','TCF3','NEGR1','HLA-B','INSR','WT1','PHOX2B','JAK1','RECQL4','MSH3','PRKD1','MED12','FGF3','PPP6C','MALT1','TNFAIP3','INPP4A','RRAGC','RB1','STAG2','PIK3R2','UPF1','IRS2','MPL','EZH2','HNF1A','PIK3CB','LATS1','DIS3','MST1','MSI1','WWTR1','NTRK2','RAD50','JUN','SH2B3','RAD21','KDM5C','TAP2','SHQ1','CDKN1B','IDH1','MET','FLT1','CDK6','EGFR','PPM1D','NUF2','RPS6KA4','CDKN2B','LMO1','NKX3-1','RIT1','MST1R','NTRK1','FGFR3','MYC','NOTCH1','ZNRF3','GAB1','ARAF','AGO2','SESN3','MAP3K13','ERCC2','NKX2-1','H3-5','MDM4','PMS2','RECQL','NCOA3','BLM','SOS1','NBN','GNAQ','GAB2','MYD88','TAP1','ABRAXAS1','RAD54L','CDH1','PALB2','TNFRSF14','KLF5','FANCA','RAB35','XPO1','SMARCB1','SHOC2','AURKA','FYN','IL7R','E2F3','FOXF1','TOP1','MLLT1','JAK2','ERG','PRDM14','ARID2','EIF4E','HOXB13','EGFL7','SUFU','USP8','CBL','GREM1','EIF4A2','ARID1A','CXCR4','MSH6','CHEK1','DCUN1D1','FGF4','GATA2','SDHA','CDC73','FGFR2','BCL10','H3C12','COP1','ACVR1','CBFB','EPCAM','ABL1','IGF1','RPS6KB2','FGFR4','KMT5A','PPP4R2','RRAS','RAD51C','SMARCD1','NSD2','STK40','ERCC3','SDHB','CSDE1','IFNGR1','RPTOR','TGFBR1','TSC1','MAP2K4','CDK12','HLA-A','BRCA2')
GROUP BY gene

-- view 0 enrichment: enrichment:altered:Colorectal, MSS · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable'))))))
SELECT g.hugo_gene_symbol AS gene, uniqExact(g.sample_unique_id) AS altered
FROM snapshot_db.genomic_event_derived g
WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
  AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
GROUP BY gene

-- view 0 enrichment: enrichment:altered:Pancreatic, MSS · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable'))))))
SELECT g.hugo_gene_symbol AS gene, uniqExact(g.sample_unique_id) AS altered
FROM snapshot_db.genomic_event_derived g
WHERE g.cancer_study_identifier = 'msk_chord_2024' AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED'
  AND replaceOne(g.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
GROUP BY gene

-- view 0 enrichment: enrichment:panels:Colorectal, MSS · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable')))))),
pc AS (
  SELECT sp.gene_panel_id AS panel, uniqExact(sp.sample_unique_id) AS n
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND sp.gene_panel_id != 'WES' AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY panel
)
SELECT gptg.gene AS gene, sum(pc.n) AS profiled
FROM snapshot_db.gene_panel_to_gene_derived gptg INNER JOIN pc ON pc.panel = gptg.gene_panel_id
GROUP BY gene

-- view 0 enrichment: enrichment:panels:Pancreatic, MSS · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable')))))),
pc AS (
  SELECT sp.gene_panel_id AS panel, uniqExact(sp.sample_unique_id) AS n
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND sp.gene_panel_id != 'WES' AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
  GROUP BY panel
)
SELECT gptg.gene AS gene, sum(pc.n) AS profiled
FROM snapshot_db.gene_panel_to_gene_derived gptg INNER JOIN pc ON pc.panel = gptg.gene_panel_id
GROUP BY gene

-- view 0 enrichment: enrichment:wes:Colorectal, MSS · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Colorectal Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable'))))))
SELECT uniqExact(sp.sample_unique_id) AS n
FROM snapshot_db.sample_to_gene_panel_derived sp
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
  AND sp.gene_panel_id = 'WES' AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)

-- view 0 enrichment: enrichment:wes:Pancreatic, MSS · msk_chord_2024
WITH cohort AS ((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Pancreatic Cancer'))))
INTERSECT DISTINCT
((SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample'
    AND attribute_name = 'MSI_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Instable'))))))
SELECT uniqExact(sp.sample_unique_id) AS n
FROM snapshot_db.sample_to_gene_panel_derived sp
JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
  AND sp.gene_panel_id = 'WES' AND replaceOne(sd.patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM cohort)
