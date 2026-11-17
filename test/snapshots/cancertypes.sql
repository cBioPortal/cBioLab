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
grp AS (SELECT suid, lowerUTF8(trimBoth(v)) AS g, v AS label FROM (
  SELECT samp.suid AS suid, if(ifNull(c.ct, '') != '', c.ct, (SELECT ifNull(nullIf(any(t.name), ''), 'Unknown') FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
     WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026')) AS v FROM samp LEFT JOIN (
    SELECT sample_unique_id AS suid, anyIf(attribute_value, attribute_name = 'CANCER_TYPE') AS ct FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE')
      AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid
  ) c ON c.suid = samp.suid)),
alt AS (
  SELECT g.sample_unique_id AS suid, g.hugo_gene_symbol AS gene,
         multiIf(g.variant_type = 'mutation', 'mutation', g.variant_type = 'cna' AND g.cna_alteration >= 2, 'amp',
                 g.variant_type = 'cna', 'homdel', 'sv') AS t
  FROM snapshot_db.genomic_event_derived g
  WHERE startsWith(g.genetic_profile_stable_id, 'msk_impact_50k_2026_') AND g.cancer_study_identifier = 'msk_impact_50k_2026' AND g.hugo_gene_symbol IN ('KRAS','NRAS','HRAS') AND ((g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2) AND NOT g.off_panel)
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
uu AS (SELECT k, g, label, gene, types FROM u UNION ALL SELECT k, g, label, gene, types FROM uall),
uk AS (SELECT grp_, gene, label, types, arrayDistinct(arrayMap((t) -> multiIf(t IN ('amp', 'homdel'), 'cna', t IN ('mrnaHigh', 'mrnaLow'), 'mrna',
         t IN ('protHigh', 'protLow'), 'prot', t), types)) AS kinds FROM (SELECT g AS grp_, gene, label, types FROM uu))
SELECT grp_ AS grp, gene, any(label) AS label, count() AS profiled,
       countIf(length(types) > 0) AS altered,
       countIf(kinds = ['mutation']) AS mutation, countIf(kinds = ['cna'] AND has(types, 'amp')) AS amp,
       countIf(kinds = ['cna'] AND NOT has(types, 'amp')) AS homdel, countIf(kinds = ['sv']) AS sv,
       countIf(kinds = ['mrna'] AND has(types, 'mrnaHigh')) AS mrnaHigh, countIf(kinds = ['mrna'] AND NOT has(types, 'mrnaHigh')) AS mrnaLow,
       countIf(kinds = ['prot'] AND has(types, 'protHigh')) AS protHigh, countIf(kinds = ['prot'] AND NOT has(types, 'protHigh')) AS protLow,
       countIf(length(kinds) > 1) AS multiple
FROM uk GROUP BY grp, gene

-- view 0 cancertypes: cancertypes:default:all patients · msk_impact_50k_2026
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
SELECT ifNull(grp.g, '') AS grp, any(ifNull(grp.label, '')) AS label, uniqExact(samp.puid) AS samples,
       uniqExactIf(samp.puid, has(prof.types, 'MUTATION_EXTENDED')) AS mut,
       uniqExactIf(samp.puid, has(prof.types, 'COPY_NUMBER_ALTERATION')) AS cna,
       uniqExactIf(samp.puid, has(prof.types, 'STRUCTURAL_VARIANT')) AS sv
FROM samp LEFT JOIN prof ON prof.suid = samp.suid
LEFT JOIN (SELECT suid, lowerUTF8(trimBoth(v)) AS g, v AS label FROM (
  SELECT samp.suid AS suid, if(ifNull(c.ct, '') != '', c.ct, (SELECT ifNull(nullIf(any(t.name), ''), 'Unknown') FROM snapshot_db.cancer_study cs JOIN snapshot_db.type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id
     WHERE cs.cancer_study_identifier = 'msk_impact_50k_2026')) AS v FROM samp LEFT JOIN (
    SELECT sample_unique_id AS suid, anyIf(attribute_value, attribute_name = 'CANCER_TYPE') AS ct FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
    WHERE cancer_study_identifier = 'msk_impact_50k_2026' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE')
      AND sample_unique_id IN (SELECT suid FROM samp) GROUP BY suid
  ) c ON c.suid = samp.suid)) grp ON grp.suid = samp.suid
GROUP BY grp
UNION ALL SELECT '\x01all' AS grp, '' AS label, uniqExact(samp.puid), uniqExactIf(samp.puid, has(prof.types, 'MUTATION_EXTENDED')),
       uniqExactIf(samp.puid, has(prof.types, 'COPY_NUMBER_ALTERATION')), uniqExactIf(samp.puid, has(prof.types, 'STRUCTURAL_VARIANT'))
FROM samp LEFT JOIN prof ON prof.suid = samp.suid
