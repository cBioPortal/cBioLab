-- cohort all patients
-- brca_tcga_pan_can_atlas_2018
SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'

-- view 0 pathwaymap: geneCounts · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
altered AS (
  SELECT g.hugo_gene_symbol AS gene, replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, g.variant_type AS vtype,
         max(ann.is_driver) AS is_driver
  FROM snapshot_db.genomic_event_derived g
  LEFT JOIN (SELECT hugo_gene_symbol, alteration_type, alteration, is_driver FROM annotation.oncokb
      WHERE oncokb_version = 'v7.5' AND is_driver) ann
    ON ann.hugo_gene_symbol = g.hugo_gene_symbol
   AND ann.alteration_type = multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', '')
   AND ann.alteration = multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('ACVR1B','ACVR2A','ACVR2B','AJUBA','AKT1','AKT2','AKT3','ALK','AMER1','APC','ARAF','ARID1A','ARID1B','ARID2','ARRDC1','ASCL4','ATM','AURKA','AXIN1','AXIN2','BAD','BCL2','BIRC2','BRAF','BRCA1','BRCA2','CASP8','CBL','CCND1','CCND2','CCNE1','CDK4','CDK6','CDKN1A','CDKN2A','CDKN2B','CDKN2C','CHEK2','CNTN6','CRB1','CRB2','CREBBP','CSNK1D','CSNK1E','CTNNB1','CUL1','CUL3','DCHS1','DCHS2','DKK1','DKK2','DKK3','DKK4','DNER','E2F1','E2F3','EGFR','EP300','ERBB2','ERBB3','ERBB4','ERRFI1','FADD','FAT1','FAT2','FAT3','FAT4','FBXW7','FGFR1','FGFR2','FGFR3','FGFR4','FLT3','FOXP1','FZD10','GRB10','GSK3B','HRAS','IDH1','IGF1R','IGF2','IKBKB','INPP4B','IRS2','JAG1','JAG2','JAK2','KAT2B','KDM1A','KDM1B','KDM4A','KDM4B','KDM5A','KDM5B','KDM6A','KDM6B','KEAP1','KIT','KRAS','LATS1','LATS2','LRP5','LRP6','LTBR','MAML1','MAML2','MAML3','MAP2K1','MAP2K2','MAP2K4','MAP3K1','MAPK1','MAX','MDM2','MDM4','MEN1','MET','MGA','MLX','MLXIP','MLXIPL','MNT','MOB1A','MOB1B','MTOR','MXD1','MXD3','MXD4','MXI1','MYC','MYCL','MYCN','NCOR1','NCOR2','NF1','NF2','NFE2L2','NOTCH1','NOTCH2','NOTCH3','NOTCH4','NRARP','NRAS','NTRK1','NTRK2','PAK1','PDGFRA','PIK3CA','PIK3R1','PIK3R2','PIK3R3','PPP2R1A','PPP6C','PSEN2','PTCH1','PTEN','PTPN11','PTPN14','RAC1','RAF1','RASA1','RB1','RET','RHEB','RICTOR','RIT1','RNF43','ROS1','RPS6KA3','RPTOR','SAV1','SETD2','SFRP1','SFRP2','SFRP4','SFRP5','SMAD2','SMAD3','SMAD4','SMARCA4','SOS1','SOX17','SOX2','SOX9','SPEN','SQSTM1','STK11','STK3','STK4','TAOK1','TAOK2','TAOK3','TCF7','TCF7L1','TCF7L2','TEAD2','TGFBR1','TGFBR2','TLE1','TLE2','TLE3','TLE4','TP53','TP63','TRAF3','TSC1','TSC2','VHL','WIF1','WWC1','YAP1','ZNRF3','CDH1','GATA3') AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
  GROUP BY gene, sid, vtype
),
covered AS (
  SELECT DISTINCT pg.gene AS gene, replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid,
         multiIf(sp.alteration_type = 'MUTATION_EXTENDED', 'mutation',
                 sp.alteration_type = 'COPY_NUMBER_ALTERATION', 'cna', 'structural_variant') AS vtype
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('ACVR1B','ACVR2A','ACVR2B','AJUBA','AKT1','AKT2','AKT3','ALK','AMER1','APC','ARAF','ARID1A','ARID1B','ARID2','ARRDC1','ASCL4','ATM','AURKA','AXIN1','AXIN2','BAD','BCL2','BIRC2','BRAF','BRCA1','BRCA2','CASP8','CBL','CCND1','CCND2','CCNE1','CDK4','CDK6','CDKN1A','CDKN2A','CDKN2B','CDKN2C','CHEK2','CNTN6','CRB1','CRB2','CREBBP','CSNK1D','CSNK1E','CTNNB1','CUL1','CUL3','DCHS1','DCHS2','DKK1','DKK2','DKK3','DKK4','DNER','E2F1','E2F3','EGFR','EP300','ERBB2','ERBB3','ERBB4','ERRFI1','FADD','FAT1','FAT2','FAT3','FAT4','FBXW7','FGFR1','FGFR2','FGFR3','FGFR4','FLT3','FOXP1','FZD10','GRB10','GSK3B','HRAS','IDH1','IGF1R','IGF2','IKBKB','INPP4B','IRS2','JAG1','JAG2','JAK2','KAT2B','KDM1A','KDM1B','KDM4A','KDM4B','KDM5A','KDM5B','KDM6A','KDM6B','KEAP1','KIT','KRAS','LATS1','LATS2','LRP5','LRP6','LTBR','MAML1','MAML2','MAML3','MAP2K1','MAP2K2','MAP2K4','MAP3K1','MAPK1','MAX','MDM2','MDM4','MEN1','MET','MGA','MLX','MLXIP','MLXIPL','MNT','MOB1A','MOB1B','MTOR','MXD1','MXD3','MXD4','MXI1','MYC','MYCL','MYCN','NCOR1','NCOR2','NF1','NF2','NFE2L2','NOTCH1','NOTCH2','NOTCH3','NOTCH4','NRARP','NRAS','NTRK1','NTRK2','PAK1','PDGFRA','PIK3CA','PIK3R1','PIK3R2','PIK3R3','PPP2R1A','PPP6C','PSEN2','PTCH1','PTEN','PTPN11','PTPN14','RAC1','RAF1','RASA1','RB1','RET','RHEB','RICTOR','RIT1','RNF43','ROS1','RPS6KA3','RPTOR','SAV1','SETD2','SFRP1','SFRP2','SFRP4','SFRP5','SMAD2','SMAD3','SMAD4','SMARCA4','SOS1','SOX17','SOX2','SOX9','SPEN','SQSTM1','STK11','STK3','STK4','TAOK1','TAOK2','TAOK3','TCF7','TCF7L1','TCF7L2','TEAD2','TGFBR1','TGFBR2','TLE1','TLE2','TLE3','TLE4','TP53','TP63','TRAF3','TSC1','TSC2','VHL','WIF1','WWC1','YAP1','ZNRF3','CDH1','GATA3')
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
    AND replaceOne(sp.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT sid FROM cohort)
),
raw AS (
  SELECT gene, sid, vtype, max(is_alt) AS is_alt, max(is_drv) AS is_drv
  FROM (
    SELECT gene, sid, vtype, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered
    UNION ALL
    SELECT gene, sid, vtype, 0 AS is_alt, 0 AS is_drv FROM covered
  )
  GROUP BY gene, sid, vtype
),
perSample AS (
  SELECT gene, sid, max(is_alt) AS is_alt, max(is_drv) AS is_drv
  FROM raw GROUP BY gene, sid
)
SELECT gene, vtype,
       uniqExact(sid) AS profiled, uniqExactIf(sid, is_alt = 1) AS altered, uniqExactIf(sid, is_drv = 1) AS driver
FROM raw GROUP BY gene, vtype
UNION ALL
SELECT gene, 'any' AS vtype,
       uniqExact(sid) AS profiled, uniqExactIf(sid, is_alt = 1) AS altered, uniqExactIf(sid, is_drv = 1) AS driver
FROM perSample GROUP BY gene
