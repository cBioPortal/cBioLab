-- cohort all patients
-- msk_impact_50k_2026
SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'

-- view 0 cancertypes: cancertypes:all patients · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
samp AS (
  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
grp AS (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS g, any(attribute_value) AS label FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'CANCER_TYPE'
    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid
),
alt AS (
  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene,
         multiIf(g.variant_type = 'mutation', 'mutation', g.variant_type = 'cna' AND g.cna_alteration >= 2, 'amp',
                 g.variant_type = 'cna', 'homdel', 'sv') AS t
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_impact_50k_2026' AND g.hugo_gene_symbol IN ('KRAS','NRAS','HRAS') AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
    AND g.sample_unique_id IN (SELECT suid FROM samp)
  GROUP BY suid, gene, t
),
cov AS (
  SELECT DISTINCT sp.sample_unique_id AS suid, pg.gene AS gene FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN ('KRAS','NRAS','HRAS')
  WHERE sp.cancer_study_identifier = 'msk_impact_50k_2026' AND sp.sample_unique_id IN (SELECT suid FROM samp)
    AND sp.alteration_type IN ('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT')
),
sg AS (
  SELECT cov.suid AS suid, cov.gene AS gene, groupUniqArrayIf(alt.t, alt.t != '') AS types
  FROM cov LEFT JOIN alt ON alt.suid = cov.suid AND alt.gene = cov.gene GROUP BY suid, gene
),
sg2 AS (SELECT suid, gene, types FROM sg UNION ALL SELECT suid, '*' AS gene, arrayDistinct(arrayFlatten(groupArray(types))) AS types FROM sg GROUP BY suid),
u AS (
  SELECT samp.puid AS k, ifNull(grp.g, '') AS g, any(ifNull(grp.label, '')) AS label, sg2.gene AS gene,
         arrayDistinct(arrayFlatten(groupArray(sg2.types))) AS types
  FROM sg2 JOIN samp ON samp.suid = sg2.suid LEFT JOIN grp ON grp.suid = sg2.suid
  GROUP BY k, g, gene
),
uall AS (SELECT k, '\x01all' AS g, '' AS label, gene, arrayDistinct(arrayFlatten(groupArray(types))) AS types FROM u GROUP BY k, gene),
uu AS (SELECT k, g, label, gene, types FROM u UNION ALL SELECT k, g, label, gene, types FROM uall)
SELECT g AS grp, gene, any(label) AS label, count() AS profiled,
       countIf(length(types) > 0) AS altered,
       countIf(types = ['mutation']) AS mutation, countIf(types = ['amp']) AS amp,
       countIf(types = ['homdel']) AS homdel, countIf(types = ['sv']) AS sv,
       countIf(length(types) > 1) AS multiple
FROM uu GROUP BY grp, gene

-- view 0 cancertypes: cancertypes:samples:all patients · msk_impact_50k_2026
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'msk_impact_50k_2026_', '') AS pid, replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026'),
samp AS (
  SELECT sample_unique_id AS suid, patient_unique_id AS puid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND replaceOne(sample_unique_id, 'msk_impact_50k_2026_', '') IN (SELECT sid FROM cohort)
),
prof AS (
  SELECT sample_unique_id AS suid, groupUniqArray(alteration_type) AS types FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid
)
SELECT ifNull(grp.g, '') AS grp, uniqExact(samp.puid) AS samples,
       uniqExactIf(samp.puid, has(prof.types, 'MUTATION_EXTENDED')) AS mut,
       uniqExactIf(samp.puid, has(prof.types, 'COPY_NUMBER_ALTERATION')) AS cna,
       uniqExactIf(samp.puid, has(prof.types, 'STRUCTURAL_VARIANT')) AS sv
FROM samp LEFT JOIN prof ON prof.suid = samp.suid
LEFT JOIN (
  SELECT sample_unique_id AS suid, any(lowerUTF8(trimBoth(attribute_value))) AS g FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name = 'CANCER_TYPE'
    AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid
) grp ON grp.suid = samp.suid
GROUP BY grp
UNION ALL SELECT '\x01all' AS grp, uniqExact(samp.puid), uniqExactIf(samp.puid, has(prof.types, 'MUTATION_EXTENDED')),
       uniqExactIf(samp.puid, has(prof.types, 'COPY_NUMBER_ALTERATION')), uniqExactIf(samp.puid, has(prof.types, 'STRUCTURAL_VARIANT'))
FROM samp LEFT JOIN prof ON prof.suid = samp.suid
