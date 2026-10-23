-- cohort all patients
-- brca_tcga_pan_can_atlas_2018
SELECT DISTINCT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'

-- view 0 correlates: correlates:moments · brca_tcga_pan_can_atlas_2018
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'),
q AS (
  SELECT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, ga.hugo_gene_symbol AS gene, avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna' AND ga.hugo_gene_symbol = 'ESR1'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND isFinite(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))
    AND replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid, gene
),
o AS (
  SELECT replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, ga.hugo_gene_symbol AS gene, avg(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL)) AS v
  FROM snapshot_db.genetic_alteration_derived ga
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id
  WHERE ga.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND ga.profile_type = 'rna_seq_v2_mrna'
    AND if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL) IS NOT NULL AND isFinite(if(isFinite(ifNull(toFloat64OrNull(ga.alteration_value), nan)), toFloat64OrNull(ga.alteration_value), NULL))
    AND replaceOne(sd.patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid, gene
),
paired AS (SELECT o.gene AS gene, q.v AS x, o.v AS y FROM o INNER JOIN q ON q.pid = o.pid),
ranked AS (
  SELECT gene, x, y,
         rank() OVER (PARTITION BY gene ORDER BY x) + (count() OVER (PARTITION BY gene, x) - 1) / 2 AS rx,
         rank() OVER (PARTITION BY gene ORDER BY y) + (count() OVER (PARTITION BY gene, y) - 1) / 2 AS ry
  FROM paired
)
SELECT gene, count() AS n, sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx, sum(y * y) AS syy,
       sum(rx) AS rsx, sum(ry) AS rsy, sum(rx * ry) AS rsxy, sum(rx * rx) AS rsxx, sum(ry * ry) AS rsyy
FROM ranked GROUP BY gene

-- view 0 correlates: cytobands · brca_tcga_pan_can_atlas_2018
SELECT g.hugo_gene_symbol AS gene, any(rgg.cytoband) AS cytoband FROM snapshot_db.gene g
JOIN snapshot_db.reference_genome_gene rgg ON rgg.entrez_gene_id = g.entrez_gene_id
WHERE rgg.reference_genome_id = (SELECT reference_genome_id FROM snapshot_db.cancer_study WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018')
  AND g.hugo_gene_symbol IN ('CCDC170','DCPH1','THSD4','FOXA1','TBC1D9','RABEP1','SLC39A6','GATA3','CA12','CT62','MYB','PARD6B','AGR3','RERG','RUNDC1','ARSG','XBP1','C5AR2','ACADSB','AFF3','NUDT12','CACNA2D2','ANKRA2','WWP1','RETREG1','ZNF552','TLE3','DNAL1','SLC22A5','GFRA1','DCTN4','GATA3-AS1','FAM234B','ERBB4','SLC16A6','APH1B','MINDY1','ZNF396','DACH1','RALGPS2','APBB2','CYP2B7P','IGF1R','SPEF2','MRTFB','TCEAL1','TSPAN13','BCL2','GIN1','CLSTN2','SCUBE2','BTRC','CELSR1','RGS22','TMEM144','LONRF2','MAPT','ANXA9','TMBIM6','CCDC125','CST9','FNIP1','KDM4B','TMPRSS6','TAPT1','SERPINA11','FRS2','ELP2','ABAT','TTC8','PCBD2','CMBL','NAT1','WDR19','SLC46A1','FSIP1','ZNF587','QNG1','PLA2G12A','SKP1','MLPH','DNAJC12','KCTD6','ETFBKMT','LRBA','REPS2','TPSG1','TMC4','NDFIP1','RMND1','SYTL4','MACIR','SAMD15','BBS1','SEPSECS','TMEM161B','EXOC6','FBXL5','PREX1','RAB30','HAPLN3','YBX1','SMCO4','PSAT1','ACOT9','PPP1R14C','PADI2','NCK2','UBE2E3','BCL11A','CCDC71L','MSANTD3','NXN','GLIPR2','MTHFD1L','USB1','MSL3','VGLL1','CSRP2','KCNN4','RARRES1','TTC7A','B3GNT5','FSCN1','CCDC82','NT5DC2','ENO1','CPNE2','MID1','YBX3','ITM2C','PRKX','CDC42EP1','ARHGEF4','ARL4C','PALS2','FZD9','SRD5A1','MRAS','FOXC1','EPHB6','STAC','KRT16','RGMA','FAM171A1','SLC43A3','RASAL1','RBM38','CLCN4','TUBB6','NCS1','A2ML1','RSU1','PLOD1','SLC15A1','RAP2B','MFGE8','MCF2L2','UPP1','CIB2','ST8SIA1','CXCL1','ACE2','WNT6','RNF145','IFRD1','PFKP','ART3','PTK7','EN1','CHST2','UNC13D','DSC2','KCNG1','CDCA7','ATP6V1C2','NFIL3','CDH3','FMNL2','GSTP1','CHST3','LMO4','ESYT3','INTS6L','JOSD1','INAVA','MICALL1','TTLL4','APBA2','TTYH3','BTG3','ANKS6','IL12RB2','RIN3','SCPEP1','SH2D2A','SRSF12','PDSS1','FABP7','GAL')
GROUP BY gene
