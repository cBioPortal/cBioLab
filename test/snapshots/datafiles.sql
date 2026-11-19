-- cohort Queried
-- brca_tcga_pan_can_atlas_2018
(SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT DISTINCT s.stable_id AS sid
  FROM snapshot_db.sample_list sl
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id
  JOIN snapshot_db.sample_list_list sll ON sll.list_id = sl.list_id
  JOIN snapshot_db.sample s ON s.internal_id = sll.sample_id
  WHERE sl.stable_id = 'brca_tcga_pan_can_atlas_2018_cnaseq' AND cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'))

-- view 0 datafiles: datafiles:cases:counts · brca_tcga_pan_can_atlas_2018
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT DISTINCT s.stable_id AS sid
  FROM snapshot_db.sample_list sl
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id
  JOIN snapshot_db.sample_list_list sll ON sll.list_id = sl.list_id
  JOIN snapshot_db.sample s ON s.internal_id = sll.sample_id
  WHERE sl.stable_id = 'brca_tcga_pan_can_atlas_2018_cnaseq' AND cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'))),
d0_e0 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, concat(call_, note))))), ', ') AS ev,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 1))) AS k_mut,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 2))) AS k_cna,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 3))) AS k_sv,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'EXP')))) AS k_exp,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'PROT')))) AS k_prot
  FROM (SELECT sid, o, ev AS call_, note FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev, concat(if((g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0), ' [germline]', ''), if(g.variant_type IN ('mutation', 'cna') AND ((g.variant_type != 'structural_variant' AND (g.hugo_gene_symbol, multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', ''), multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')) IN (
    SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation.oncokb
    WHERE oncokb_version = 'v7.5' AND is_driver))
  OR (g.variant_type = 'structural_variant' AND (g.sample_unique_id, g.hugo_gene_symbol, ifNull(g.sv_event_info, '')) IN (
SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (
  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,
         toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS driver
  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, ifNull(sv.event_info, '') AS event_info,
               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,
               if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
        FROM snapshot_db.structural_variant sv
        JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
        JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
        JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
        LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
        LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) v
  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
             FROM annotation.oncokb_sv WHERE oncokb_version = 'v7.5' AND tumor_type = ''
             GROUP BY site1_entrez, site2_entrez, sv_type) pr
    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN'))
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a1 ON a1.gene = v.gene1
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a2 ON a2.gene = v.gene2
) ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''))), ' (driver)', '')) AS note
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('TP53')
    AND ((g.hugo_gene_symbol = 'TP53' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))))
  WHERE sid IN (SELECT sid FROM c0)
  GROUP BY sid),
d0_e1 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, concat(call_, note))))), ', ') AS ev,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 1))) AS k_mut,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 2))) AS k_cna,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 3))) AS k_sv,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'EXP')))) AS k_exp,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'PROT')))) AS k_prot
  FROM (SELECT sid, o, ev AS call_, note FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev, concat(if((g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0), ' [germline]', ''), if(g.variant_type IN ('mutation', 'cna') AND ((g.variant_type != 'structural_variant' AND (g.hugo_gene_symbol, multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', ''), multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')) IN (
    SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation.oncokb
    WHERE oncokb_version = 'v7.5' AND is_driver))
  OR (g.variant_type = 'structural_variant' AND (g.sample_unique_id, g.hugo_gene_symbol, ifNull(g.sv_event_info, '')) IN (
SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (
  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,
         toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS driver
  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, ifNull(sv.event_info, '') AS event_info,
               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,
               if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
        FROM snapshot_db.structural_variant sv
        JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
        JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
        JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
        LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
        LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) v
  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
             FROM annotation.oncokb_sv WHERE oncokb_version = 'v7.5' AND tumor_type = ''
             GROUP BY site1_entrez, site2_entrez, sv_type) pr
    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN'))
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a1 ON a1.gene = v.gene1
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a2 ON a2.gene = v.gene2
) ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''))), ' (driver)', '')) AS note
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('PIK3CA')
    AND ((g.hugo_gene_symbol = 'PIK3CA' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))))
  WHERE sid IN (SELECT sid FROM c0)
  GROUP BY sid),
d0_e2 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, concat(call_, note))))), ', ') AS ev,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 1))) AS k_mut,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 2))) AS k_cna,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 3))) AS k_sv,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'EXP')))) AS k_exp,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'PROT')))) AS k_prot
  FROM (SELECT sid, o, ev AS call_, note FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev, concat(if((g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0), ' [germline]', ''), if(g.variant_type IN ('mutation', 'cna') AND ((g.variant_type != 'structural_variant' AND (g.hugo_gene_symbol, multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', ''), multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')) IN (
    SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation.oncokb
    WHERE oncokb_version = 'v7.5' AND is_driver))
  OR (g.variant_type = 'structural_variant' AND (g.sample_unique_id, g.hugo_gene_symbol, ifNull(g.sv_event_info, '')) IN (
SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (
  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,
         toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS driver
  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, ifNull(sv.event_info, '') AS event_info,
               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,
               if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
        FROM snapshot_db.structural_variant sv
        JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
        JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
        JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
        LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
        LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) v
  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
             FROM annotation.oncokb_sv WHERE oncokb_version = 'v7.5' AND tumor_type = ''
             GROUP BY site1_entrez, site2_entrez, sv_type) pr
    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN'))
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a1 ON a1.gene = v.gene1
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a2 ON a2.gene = v.gene2
) ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''))), ' (driver)', '')) AS note
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('GATA3')
    AND ((g.hugo_gene_symbol = 'GATA3' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))))
  WHERE sid IN (SELECT sid FROM c0)
  GROUP BY sid),
d0_prof_TP53_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d0_prof_TP53_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d0_prof_TP53_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d0_prof_PIK3CA_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d0_prof_PIK3CA_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d0_prof_PIK3CA_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d0_prof_GATA3_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
d0_prof_GATA3_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
d0_prof_GATA3_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
base AS (
  SELECT 'Queried' AS cohort, 'brca_tcga_pan_can_atlas_2018' AS study, 0 AS ord, s.pid AS patient, s.sid AS sid,
         e0.ev AS ev0, (s.sid IN (SELECT profiled_id FROM d0_prof_TP53_MUTATION) OR s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA) OR s.sid IN (SELECT profiled_id FROM d0_prof_TP53_SV)) AS pa0, (s.sid IN (SELECT profiled_id FROM d0_prof_TP53_MUTATION) AND s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA) AND s.sid IN (SELECT profiled_id FROM d0_prof_TP53_SV)) AS pf0,
         e1.ev AS ev1, (s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_MUTATION) OR s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA) OR s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_SV)) AS pa1, (s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_MUTATION) AND s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA) AND s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_SV)) AS pf1,
         e2.ev AS ev2, (s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_MUTATION) OR s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA) OR s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_SV)) AS pa2, (s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_MUTATION) AND s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA) AND s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_SV)) AS pf2,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', '), 'no alteration') AS h0,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', '), 'no alteration') AS h1,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_MUTATION), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_mut)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_mut)), ', '), 'no alteration') AS h2,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_SV), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_sv)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_sv)), ', '), 'no alteration') AS h3,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', '), 'no alteration') AS h4,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', '), 'no alteration') AS h5,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_MUTATION), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_mut)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_mut)), ', '), 'no alteration') AS h6,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_SV), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_sv)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_sv)), ', '), 'no alteration') AS h7,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', '), 'no alteration') AS h8,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', '), 'no alteration') AS h9,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_MUTATION), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_mut)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_mut)), ', '), 'no alteration') AS h10,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_SV), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_sv)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_sv)), ', '), 'no alteration') AS h11
  FROM (SELECT DISTINCT pid, sid FROM c0) s
  LEFT JOIN d0_e0 e0 ON e0.sid = s.sid
  LEFT JOIN d0_e1 e1 ON e1.sid = s.sid
  LEFT JOIN d0_e2 e2 ON e2.sid = s.sid
),
rows AS (SELECT *, multiIf(ev0 != '' OR ev1 != '' OR ev2 != '', 'altered', pf0 AND pf1 AND pf2, 'unaltered', 'not profiled') AS status,
    multiIf(ev0 != '', ev0, pa0, 'no alteration', 'not profiled') AS c0, multiIf(ev0 != '', '1', pa0, '0', 'NP') AS m0,
    multiIf(ev1 != '', ev1, pa1, 'no alteration', 'not profiled') AS c1, multiIf(ev1 != '', '1', pa1, '0', 'NP') AS m1,
    multiIf(ev2 != '', ev2, pa2, 'no alteration', 'not profiled') AS c2, multiIf(ev2 != '', '1', pa2, '0', 'NP') AS m2,
    multiIf(status = 'altered', 2, status = 'unaltered', 1, 0) AS rank FROM base )
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 datafiles: datafiles:cases:rows · brca_tcga_pan_can_atlas_2018
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT DISTINCT s.stable_id AS sid
  FROM snapshot_db.sample_list sl
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id
  JOIN snapshot_db.sample_list_list sll ON sll.list_id = sl.list_id
  JOIN snapshot_db.sample s ON s.internal_id = sll.sample_id
  WHERE sl.stable_id = 'brca_tcga_pan_can_atlas_2018_cnaseq' AND cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'))),
d0_e0 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, concat(call_, note))))), ', ') AS ev,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 1))) AS k_mut,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 2))) AS k_cna,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 3))) AS k_sv,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'EXP')))) AS k_exp,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'PROT')))) AS k_prot
  FROM (SELECT sid, o, ev AS call_, note FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev, concat(if((g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0), ' [germline]', ''), if(g.variant_type IN ('mutation', 'cna') AND ((g.variant_type != 'structural_variant' AND (g.hugo_gene_symbol, multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', ''), multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')) IN (
    SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation.oncokb
    WHERE oncokb_version = 'v7.5' AND is_driver))
  OR (g.variant_type = 'structural_variant' AND (g.sample_unique_id, g.hugo_gene_symbol, ifNull(g.sv_event_info, '')) IN (
SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (
  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,
         toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS driver
  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, ifNull(sv.event_info, '') AS event_info,
               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,
               if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
        FROM snapshot_db.structural_variant sv
        JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
        JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
        JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
        LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
        LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) v
  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
             FROM annotation.oncokb_sv WHERE oncokb_version = 'v7.5' AND tumor_type = ''
             GROUP BY site1_entrez, site2_entrez, sv_type) pr
    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN'))
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a1 ON a1.gene = v.gene1
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a2 ON a2.gene = v.gene2
) ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''))), ' (driver)', '')) AS note
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('TP53')
    AND ((g.hugo_gene_symbol = 'TP53' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))))
  WHERE sid IN (SELECT sid FROM c0)
  GROUP BY sid),
d0_e1 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, concat(call_, note))))), ', ') AS ev,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 1))) AS k_mut,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 2))) AS k_cna,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 3))) AS k_sv,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'EXP')))) AS k_exp,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'PROT')))) AS k_prot
  FROM (SELECT sid, o, ev AS call_, note FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev, concat(if((g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0), ' [germline]', ''), if(g.variant_type IN ('mutation', 'cna') AND ((g.variant_type != 'structural_variant' AND (g.hugo_gene_symbol, multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', ''), multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')) IN (
    SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation.oncokb
    WHERE oncokb_version = 'v7.5' AND is_driver))
  OR (g.variant_type = 'structural_variant' AND (g.sample_unique_id, g.hugo_gene_symbol, ifNull(g.sv_event_info, '')) IN (
SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (
  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,
         toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS driver
  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, ifNull(sv.event_info, '') AS event_info,
               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,
               if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
        FROM snapshot_db.structural_variant sv
        JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
        JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
        JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
        LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
        LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) v
  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
             FROM annotation.oncokb_sv WHERE oncokb_version = 'v7.5' AND tumor_type = ''
             GROUP BY site1_entrez, site2_entrez, sv_type) pr
    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN'))
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a1 ON a1.gene = v.gene1
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a2 ON a2.gene = v.gene2
) ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''))), ' (driver)', '')) AS note
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('PIK3CA')
    AND ((g.hugo_gene_symbol = 'PIK3CA' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))))
  WHERE sid IN (SELECT sid FROM c0)
  GROUP BY sid),
d0_e2 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, concat(call_, note))))), ', ') AS ev,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 1))) AS k_mut,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 2))) AS k_cna,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 3))) AS k_sv,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'EXP')))) AS k_exp,
    arrayMap(x -> x.2, arraySort(groupUniqArrayIf((o, concat(call_, note)), o = 4 AND startsWith(call_, 'PROT')))) AS k_prot
  FROM (SELECT sid, o, ev AS call_, note FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev, concat(if((g.variant_type = 'mutation' AND positionCaseInsensitive(g.mutation_status, 'germline') > 0), ' [germline]', ''), if(g.variant_type IN ('mutation', 'cna') AND ((g.variant_type != 'structural_variant' AND (g.hugo_gene_symbol, multiIf(g.variant_type = 'mutation', 'MUTATION', g.variant_type = 'cna', 'CNA', g.variant_type = 'structural_variant', 'SV', ''), multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'), 'Fusion')) IN (
    SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation.oncokb
    WHERE oncokb_version = 'v7.5' AND is_driver))
  OR (g.variant_type = 'structural_variant' AND (g.sample_unique_id, g.hugo_gene_symbol, ifNull(g.sv_event_info, '')) IN (
SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (
  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,
         toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS driver
  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, ifNull(sv.event_info, '') AS event_info,
               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,
               if(ifNull(sv.site1_entrez_gene_id, 0) = 0, '', toString(sv.site1_entrez_gene_id)) AS k1, if(ifNull(sv.site2_entrez_gene_id, 0) = 0, '', toString(sv.site2_entrez_gene_id)) AS k2
        FROM snapshot_db.structural_variant sv
        JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
        JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
        JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
        LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
        LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT' AND cs.cancer_study_identifier IN ('brca_tcga_pan_can_atlas_2018')) v
  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found
             FROM annotation.oncokb_sv WHERE oncokb_version = 'v7.5' AND tumor_type = ''
             GROUP BY site1_entrez, site2_entrez, sv_type) pr
    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = if((v.gene1 != '') + (v.gene2 != '') >= 2, 'FUSION', if(ifNull(v.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), v.class, 'UNKNOWN'))
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a1 ON a1.gene = v.gene1
  LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) a2 ON a2.gene = v.gene2
) ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''))), ' (driver)', '')) AS note
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('GATA3')
    AND ((g.hugo_gene_symbol = 'GATA3' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2))))))
  WHERE sid IN (SELECT sid FROM c0)
  GROUP BY sid),
d0_prof_TP53_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d0_prof_TP53_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d0_prof_TP53_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d0_prof_PIK3CA_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d0_prof_PIK3CA_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d0_prof_PIK3CA_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d0_prof_GATA3_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
d0_prof_GATA3_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
d0_prof_GATA3_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
base AS (
  SELECT 'Queried' AS cohort, 'brca_tcga_pan_can_atlas_2018' AS study, 0 AS ord, s.pid AS patient, s.sid AS sid,
         e0.ev AS ev0, (s.sid IN (SELECT profiled_id FROM d0_prof_TP53_MUTATION) OR s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA) OR s.sid IN (SELECT profiled_id FROM d0_prof_TP53_SV)) AS pa0, (s.sid IN (SELECT profiled_id FROM d0_prof_TP53_MUTATION) AND s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA) AND s.sid IN (SELECT profiled_id FROM d0_prof_TP53_SV)) AS pf0,
         e1.ev AS ev1, (s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_MUTATION) OR s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA) OR s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_SV)) AS pa1, (s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_MUTATION) AND s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA) AND s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_SV)) AS pf1,
         e2.ev AS ev2, (s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_MUTATION) OR s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA) OR s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_SV)) AS pa2, (s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_MUTATION) AND s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA) AND s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_SV)) AS pf2,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', '), 'no alteration') AS h0,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_cna)), ', '), 'no alteration') AS h1,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_MUTATION), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_mut)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_mut)), ', '), 'no alteration') AS h2,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_TP53_SV), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_sv)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e0.k_sv)), ', '), 'no alteration') AS h3,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', '), 'no alteration') AS h4,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_cna)), ', '), 'no alteration') AS h5,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_MUTATION), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_mut)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_mut)), ', '), 'no alteration') AS h6,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_PIK3CA_SV), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_sv)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e1.k_sv)), ', '), 'no alteration') AS h7,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', '), 'no alteration') AS h8,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_CNA), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_cna)), ', '), 'no alteration') AS h9,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_MUTATION), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_mut)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_mut)), ', '), 'no alteration') AS h10,
         multiIf(NOT s.sid IN (SELECT profiled_id FROM d0_prof_GATA3_SV), 'not profiled', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_sv)), ', ') != '', arrayStringConcat(arrayDistinct(arrayConcat(e2.k_sv)), ', '), 'no alteration') AS h11
  FROM (SELECT DISTINCT pid, sid FROM c0) s
  LEFT JOIN d0_e0 e0 ON e0.sid = s.sid
  LEFT JOIN d0_e1 e1 ON e1.sid = s.sid
  LEFT JOIN d0_e2 e2 ON e2.sid = s.sid
),
rows AS (SELECT *, multiIf(ev0 != '' OR ev1 != '' OR ev2 != '', 'altered', pf0 AND pf1 AND pf2, 'unaltered', 'not profiled') AS status,
    multiIf(ev0 != '', ev0, pa0, 'no alteration', 'not profiled') AS c0, multiIf(ev0 != '', '1', pa0, '0', 'NP') AS m0,
    multiIf(ev1 != '', ev1, pa1, 'no alteration', 'not profiled') AS c1, multiIf(ev1 != '', '1', pa1, '0', 'NP') AS m1,
    multiIf(ev2 != '', ev2, pa2, 'no alteration', 'not profiled') AS c2, multiIf(ev2 != '', '1', pa2, '0', 'NP') AS m2,
    multiIf(status = 'altered', 2, status = 'unaltered', 1, 0) AS rank FROM base )
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY rank DESC, sid, ord
LIMIT 20 OFFSET 0

-- view 0 datafiles: datafiles:counts · brca_tcga_pan_can_atlas_2018
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS pid, replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND replaceOne(sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') IN (SELECT DISTINCT s.stable_id AS sid
  FROM snapshot_db.sample_list sl
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id
  JOIN snapshot_db.sample_list_list sll ON sll.list_id = sl.list_id
  JOIN snapshot_db.sample s ON s.internal_id = sll.sample_id
  WHERE sl.stable_id = 'brca_tcga_pan_can_atlas_2018_cnaseq' AND cs.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'))),
d_e0 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, ev)))), ', ') AS ev
  FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('TP53')
    AND ((g.hugo_gene_symbol = 'TP53' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
  WHERE sid IN (SELECT sid FROM cohort)
  GROUP BY sid),
d_e1 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, ev)))), ', ') AS ev
  FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('PIK3CA')
    AND ((g.hugo_gene_symbol = 'PIK3CA' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
  WHERE sid IN (SELECT sid FROM cohort)
  GROUP BY sid),
d_e2 AS (
  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, ev)))), ', ') AS ev
  FROM ((SELECT replaceOne(g.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS sid, multiIf(g.variant_type = 'mutation', 1, g.variant_type = 'cna', 2, 3) AS o, multiIf(g.variant_type = 'mutation', g.mutation_variant, g.variant_type = 'cna', if(g.cna_alteration >= 2, 'AMP', 'HOMDEL'), g.sv_event_info) AS ev
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'brca_tcga_pan_can_atlas_2018_') AND g.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018'
    AND g.hugo_gene_symbol IN ('GATA3')
    AND ((g.hugo_gene_symbol = 'GATA3' AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
  WHERE sid IN (SELECT sid FROM cohort)
  GROUP BY sid),
d_prof_TP53_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d_prof_TP53_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d_prof_TP53_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))),
d_prof_PIK3CA_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d_prof_PIK3CA_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d_prof_PIK3CA_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'PIK3CA'))),
d_prof_GATA3_MUTATION AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
d_prof_GATA3_CNA AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
d_prof_GATA3_SV AS (SELECT DISTINCT replaceOne(sd.sample_unique_id, 'brca_tcga_pan_can_atlas_2018_', '') AS profiled_id
  FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'brca_tcga_pan_can_atlas_2018' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'GATA3'))),
flags AS (SELECT s.sid IN (SELECT sid FROM d_e0) AS a0, (s.sid IN (SELECT profiled_id FROM d_prof_TP53_MUTATION) OR s.sid IN (SELECT profiled_id FROM d_prof_TP53_CNA) OR s.sid IN (SELECT profiled_id FROM d_prof_TP53_SV)) AS p0, (s.sid IN (SELECT profiled_id FROM d_prof_TP53_MUTATION) AND s.sid IN (SELECT profiled_id FROM d_prof_TP53_CNA) AND s.sid IN (SELECT profiled_id FROM d_prof_TP53_SV)) AS f0,
  s.sid IN (SELECT sid FROM d_e1) AS a1, (s.sid IN (SELECT profiled_id FROM d_prof_PIK3CA_MUTATION) OR s.sid IN (SELECT profiled_id FROM d_prof_PIK3CA_CNA) OR s.sid IN (SELECT profiled_id FROM d_prof_PIK3CA_SV)) AS p1, (s.sid IN (SELECT profiled_id FROM d_prof_PIK3CA_MUTATION) AND s.sid IN (SELECT profiled_id FROM d_prof_PIK3CA_CNA) AND s.sid IN (SELECT profiled_id FROM d_prof_PIK3CA_SV)) AS f1,
  s.sid IN (SELECT sid FROM d_e2) AS a2, (s.sid IN (SELECT profiled_id FROM d_prof_GATA3_MUTATION) OR s.sid IN (SELECT profiled_id FROM d_prof_GATA3_CNA) OR s.sid IN (SELECT profiled_id FROM d_prof_GATA3_SV)) AS p2, (s.sid IN (SELECT profiled_id FROM d_prof_GATA3_MUTATION) AND s.sid IN (SELECT profiled_id FROM d_prof_GATA3_CNA) AND s.sid IN (SELECT profiled_id FROM d_prof_GATA3_SV)) AS f2
  FROM (SELECT DISTINCT sid FROM cohort) s)
SELECT count() AS n, countIf((a0 OR a1 OR a2)) AS altered, countIf(NOT (a0 OR a1 OR a2) AND (f0 AND f1 AND f2)) AS unaltered,
  countIf(a0 AND p0) AS alt_0, countIf(p0) AS prof_0, countIf(a0 AND NOT p0) AS off_0,
  countIf(a1 AND p1) AS alt_1, countIf(p1) AS prof_1, countIf(a1 AND NOT p1) AS off_1,
  countIf(a2 AND p2) AS alt_2, countIf(p2) AS prof_2, countIf(a2 AND NOT p2) AS off_2
FROM flags
