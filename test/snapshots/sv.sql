-- cohort MSK-IMPACT
-- msk_impact_2017
SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'

-- view 0 sv: sv:counts · msk_impact_2017
WITH ann AS (SELECT gene, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level, CAST(NULL AS Nullable(String)) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver
  FROM (SELECT hugo_gene_symbol AS gene, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c
    FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
    GROUP BY gene)),
asv AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level, toNullable(c.5) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found
  FROM (SELECT site1_entrez, site2_entrez, sv_type, tumor_type,
      argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level), toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c
    FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
      AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET'))))
    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),
c0 AS (SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'),
s0 AS (
  SELECT sv.internal_id AS svid, pt.stable_id AS pid, smp.stable_id AS sid,
         ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         sv.site1_entrez_gene_id AS site1Entrez, sv.site1_ensembl_transcript_id AS site1Transcript, sv.site1_chromosome AS site1Chr,
         sv.site1_position AS site1Pos, sv.site1_description AS site1Desc,
         sv.site2_entrez_gene_id AS site2Entrez, sv.site2_ensembl_transcript_id AS site2Transcript, sv.site2_chromosome AS site2Chr,
         sv.site2_position AS site2Pos, sv.site2_description AS site2Desc, sv.site2_effect_on_frame AS frame,
         sv.sv_status AS status, sv.ncbi_build AS ncbiBuild, sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport,
         sv.normal_read_count AS normalReadCount, sv.tumor_read_count AS tumorReadCount,
         sv.normal_variant_count AS normalVariantCount, sv.tumor_variant_count AS tumorVariantCount,
         sv.normal_paired_end_read_count AS normalPairedEndReadCount, sv.tumor_paired_end_read_count AS tumorPairedEndReadCount,
         sv.normal_split_read_count AS normalSplitReadCount, sv.tumor_split_read_count AS tumorSplitReadCount,
         sv.annotation AS svDescription, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,
         sv.event_info AS eventInfo, sv.class AS class, sv.length AS length, sv.comments AS comments
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE cs.cancer_study_identifier = 'msk_impact_2017' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
    AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET')))
    AND smp.stable_id IN (SELECT sid FROM c0)
),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_impact_2017_', sid) FROM s0) GROUP BY sid),
tt0 AS (SELECT s.sid AS sid,
    if(ifNull(k.sid, '') = '', (SELECT t.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
      WHERE cs.cancer_study_identifier = 'msk_impact_2017'), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType
  FROM (SELECT DISTINCT sid FROM (SELECT sid FROM s0)) AS s
  LEFT JOIN (SELECT replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,
      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_impact_2017' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')
      AND sample_unique_id IN (SELECT concat('msk_impact_2017_', sid) FROM (SELECT sid FROM s0)) GROUP BY sid) AS k ON k.sid = s.sid),
sk0 AS (SELECT s.*, tt.tumorType AS ttype, if(ifNull(s.site1Entrez, 0) = 0, '', toString(s.site1Entrez)) AS k1, if(ifNull(s.site2Entrez, 0) = 0, '', toString(s.site2Entrez)) AS k2, if((s.gene1 != '') + (s.gene2 != '') >= 2, 'FUSION', if(ifNull(s.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), s.class, 'UNKNOWN')) AS ktype
  FROM s0 AS s LEFT JOIN tt0 AS tt ON tt.sid = s.sid),
rows AS (
  SELECT 'MSK-IMPACT' AS cohort, 'msk_impact_2017' AS study, 0 AS ord,
         s.pid AS patient, s.sid AS sid, ifNull(ct.v, '') AS cancerType,
         if(pr.found = 1, pr.oncogenicity, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.oncogenicity, a1.oncogenicity)) AS oncogenicity, if(pr.found = 1, pr.level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.level, a1.level)) AS level, toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS drv,
         if(pr.found = 1, pr.resistance_level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.resistance_level, a1.resistance_level)) AS resistanceLevel, if(pr.found = 1, pr.diagnostic_level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.diagnostic_level, a1.diagnostic_level)) AS diagnosticLevel, if(pr.found = 1, pr.prognostic_level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.prognostic_level, a1.prognostic_level)) AS prognosticLevel,
         s.* EXCEPT (pid, sid, ttype, k1, k2, ktype)
  FROM sk0 AS s
  LEFT JOIN ct0 AS ct ON ct.sid = s.sid
  LEFT JOIN ann AS a1 ON a1.gene = s.gene1 AND s.gene1 != '' LEFT JOIN ann AS a2 ON a2.gene = s.gene2 AND s.gene2 != ''
  LEFT JOIN asv AS pr ON pr.site1_entrez = s.k1 AND pr.site2_entrez = s.k2 AND pr.sv_type = s.ktype AND pr.tumor_type = s.ttype
)
SELECT cohort, study, countIf(1) AS n, count() AS all, count() - uniqExact((study, patient, ifNull(toString(site1Chr), ''), ifNull(toString(site1Pos), ''), ifNull(toString(site2Chr), ''), ifNull(toString(site2Pos), ''))) AS dup FROM rows GROUP BY cohort, study

-- view 0 sv: sv:profiled:MSK-IMPACT · msk_impact_2017
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'),
cs AS (SELECT DISTINCT sid FROM cohort),
prof AS (
  SELECT DISTINCT replaceOne(sp.sample_unique_id, 'msk_impact_2017_', '') AS sid, sp.gene_panel_id AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'msk_impact_2017' AND sp.alteration_type = 'STRUCTURAL_VARIANT'
    AND replaceOne(sp.sample_unique_id, 'msk_impact_2017_', '') IN (SELECT sid FROM cs)
),
pg AS (SELECT DISTINCT p.sid AS sid, g AS gene FROM prof p ARRAY JOIN ['ALK', 'ROS1', 'RET'] AS g
  WHERE p.panel = 'WES' OR (p.panel, g) IN (SELECT gene_panel_id, gene FROM snapshot_db.gene_panel_to_gene_derived WHERE gene IN ('ALK', 'ROS1', 'RET'))),
alt AS (
  SELECT DISTINCT smp.stable_id AS sid, gn.hugo_gene_symbol AS gene
  FROM snapshot_db.structural_variant sv
  ARRAY JOIN [sv.site1_entrez_gene_id, sv.site2_entrez_gene_id] AS eid
  JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
  JOIN snapshot_db.cancer_study st ON st.cancer_study_id = gp.cancer_study_id
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  JOIN snapshot_db.gene gn ON gn.entrez_gene_id = eid
  WHERE st.cancer_study_identifier = 'msk_impact_2017' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
    AND gn.hugo_gene_symbol IN ('ALK', 'ROS1', 'RET') AND smp.stable_id IN (SELECT sid FROM cs)
),
marks AS (
  SELECT sid, gene, 'p' AS what FROM pg
  UNION ALL SELECT sid, gene, 'a' AS what FROM alt
  UNION ALL SELECT sid, gene, 'b' AS what FROM alt WHERE (sid, gene) IN (SELECT sid, gene FROM pg)
)
SELECT gene, any((SELECT count() FROM cs)) AS samples, uniqExactIf(sid, what = 'p') AS profiled,
       uniqExactIf(sid, what = 'a') AS altered, uniqExactIf(sid, what = 'b') AS altered_profiled
FROM marks GROUP BY gene ORDER BY gene

-- view 0 sv: sv:rows · msk_impact_2017
WITH ann AS (SELECT gene, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level, CAST(NULL AS Nullable(String)) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver
  FROM (SELECT hugo_gene_symbol AS gene, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c
    FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'SV' AND alteration = 'Fusion'
    GROUP BY gene)),
asv AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level, toNullable(c.5) AS prognostic_level,
    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found
  FROM (SELECT site1_entrez, site2_entrez, sv_type, tumor_type,
      argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level), toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c
    FROM annotation.oncokb_sv AS t WHERE oncokb_version = 'v7.5'
      AND (site1_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET'))) OR site2_entrez IN (SELECT toString(entrez_gene_id) FROM (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET'))))
    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),
c0 AS (SELECT replaceOne(patient_unique_id, 'msk_impact_2017_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_2017'),
s0 AS (
  SELECT sv.internal_id AS svid, pt.stable_id AS pid, smp.stable_id AS sid,
         ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         sv.site1_entrez_gene_id AS site1Entrez, sv.site1_ensembl_transcript_id AS site1Transcript, sv.site1_chromosome AS site1Chr,
         sv.site1_position AS site1Pos, sv.site1_description AS site1Desc,
         sv.site2_entrez_gene_id AS site2Entrez, sv.site2_ensembl_transcript_id AS site2Transcript, sv.site2_chromosome AS site2Chr,
         sv.site2_position AS site2Pos, sv.site2_description AS site2Desc, sv.site2_effect_on_frame AS frame,
         sv.sv_status AS status, sv.ncbi_build AS ncbiBuild, sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport,
         sv.normal_read_count AS normalReadCount, sv.tumor_read_count AS tumorReadCount,
         sv.normal_variant_count AS normalVariantCount, sv.tumor_variant_count AS tumorVariantCount,
         sv.normal_paired_end_read_count AS normalPairedEndReadCount, sv.tumor_paired_end_read_count AS tumorPairedEndReadCount,
         sv.normal_split_read_count AS normalSplitReadCount, sv.tumor_split_read_count AS tumorSplitReadCount,
         sv.annotation AS svDescription, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,
         sv.event_info AS eventInfo, sv.class AS class, sv.length AS length, sv.comments AS comments
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE cs.cancer_study_identifier = 'msk_impact_2017' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'
    AND (sv.site1_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET')) OR sv.site2_entrez_gene_id IN (SELECT entrez_gene_id FROM snapshot_db.gene WHERE hugo_gene_symbol IN ('ALK', 'ROS1', 'RET')))
    AND smp.stable_id IN (SELECT sid FROM c0)
),
ct0 AS (SELECT replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid, any(attribute_value) AS v FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_impact_2017' AND type = 'sample' AND attribute_name = 'CANCER_TYPE_DETAILED'
    AND sample_unique_id IN (SELECT concat('msk_impact_2017_', sid) FROM s0) GROUP BY sid),
tt0 AS (SELECT s.sid AS sid,
    if(ifNull(k.sid, '') = '', (SELECT t.name FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
      WHERE cs.cancer_study_identifier = 'msk_impact_2017'), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType
  FROM (SELECT DISTINCT sid FROM (SELECT sid FROM s0)) AS s
  LEFT JOIN (SELECT replaceOne(sample_unique_id, 'msk_impact_2017_', '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,
      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_impact_2017' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')
      AND sample_unique_id IN (SELECT concat('msk_impact_2017_', sid) FROM (SELECT sid FROM s0)) GROUP BY sid) AS k ON k.sid = s.sid),
sk0 AS (SELECT s.*, tt.tumorType AS ttype, if(ifNull(s.site1Entrez, 0) = 0, '', toString(s.site1Entrez)) AS k1, if(ifNull(s.site2Entrez, 0) = 0, '', toString(s.site2Entrez)) AS k2, if((s.gene1 != '') + (s.gene2 != '') >= 2, 'FUSION', if(ifNull(s.class, '') IN ('DELETION', 'TRANSLOCATION', 'DUPLICATION', 'INSERTION', 'INVERSION', 'FUSION'), s.class, 'UNKNOWN')) AS ktype
  FROM s0 AS s LEFT JOIN tt0 AS tt ON tt.sid = s.sid),
rows AS (
  SELECT 'MSK-IMPACT' AS cohort, 'msk_impact_2017' AS study, 0 AS ord,
         s.pid AS patient, s.sid AS sid, ifNull(ct.v, '') AS cancerType,
         if(pr.found = 1, pr.oncogenicity, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.oncogenicity, a1.oncogenicity)) AS oncogenicity, if(pr.found = 1, pr.level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.level, a1.level)) AS level, toUInt8(if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver))) AS drv,
         if(pr.found = 1, pr.resistance_level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.resistance_level, a1.resistance_level)) AS resistanceLevel, if(pr.found = 1, pr.diagnostic_level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.diagnostic_level, a1.diagnostic_level)) AS diagnosticLevel, if(pr.found = 1, pr.prognostic_level, if(a2.oncogenicity != '' AND (a1.oncogenicity = '' OR a2.driver > a1.driver), a2.prognostic_level, a1.prognostic_level)) AS prognosticLevel,
         s.* EXCEPT (pid, sid, ttype, k1, k2, ktype)
  FROM sk0 AS s
  LEFT JOIN ct0 AS ct ON ct.sid = s.sid
  LEFT JOIN ann AS a1 ON a1.gene = s.gene1 AND s.gene1 != '' LEFT JOIN ann AS a2 ON a2.gene = s.gene2 AND s.gene2 != ''
  LEFT JOIN asv AS pr ON pr.site1_entrez = s.k1 AND pr.site2_entrez = s.k2 AND pr.sv_type = s.ktype AND pr.tumor_type = s.ttype
)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY arrayConcat([toFloat64(if(ifNull(oncogenicity, '') IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'), 5, 0)),
  toFloat64(transform(replaceOne(ifNull(level, ''), 'LEVEL_', ''), ['1', '2', '3A', '3B', '4'], [6, 5, 3, 2, 1], 0)),
  toFloat64(transform(replaceOne(ifNull(resistanceLevel, ''), 'LEVEL_', ''), ['R1', 'R2', 'R3'], [3, 2, 1], 0)),
  toFloat64(transform(replaceOne(ifNull(diagnosticLevel, ''), 'LEVEL_', ''), ['Dx1', 'Dx2', 'Dx3'], [3, 2, 1], 0)),
  toFloat64(transform(replaceOne(ifNull(prognosticLevel, ''), 'LEVEL_', ''), ['Px1', 'Px2', 'Px3'], [3, 2, 1], 0))], [toFloat64(0)]) DESC, gene1, gene2, sid, ord, svid
LIMIT 25 OFFSET 0
