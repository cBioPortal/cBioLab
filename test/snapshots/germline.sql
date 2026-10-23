-- cohort mCRPC
-- prad_su2c_2019
SELECT DISTINCT replaceOne(patient_unique_id, 'prad_su2c_2019_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'prad_su2c_2019'

-- view 0 germline: germline:ascn · prad_su2c_2019
SELECT DISTINCT cs.cancer_study_identifier AS study FROM snapshot_db.allele_specific_copy_number a
JOIN snapshot_db.genetic_profile gp ON gp.genetic_profile_id = a.genetic_profile_id
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id ORDER BY study

-- view 0 germline: germline:carriers:mCRPC · prad_su2c_2019
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'prad_su2c_2019_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'prad_su2c_2019')
SELECT g.hugo_gene_symbol AS gene, uniqExact(replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '')) AS carriers
FROM snapshot_db.genomic_event_derived g
WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.variant_type = 'mutation' AND lowerUTF8(trimBoth(g.mutation_status)) = 'germline'
  AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
GROUP BY gene ORDER BY carriers DESC, gene LIMIT 500

-- view 0 germline: germline:counts:mCRPC · prad_su2c_2019
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'prad_su2c_2019_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'prad_su2c_2019'),
mprofp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'prad_su2c_2019' AND sp.alteration_type = 'MUTATION_EXTENDED' AND replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
mprof AS (
  SELECT DISTINCT x.pid AS pid, gp.gene AS gene FROM mprofp x JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = x.panel WHERE gp.gene IN ('BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2')
  UNION DISTINCT
  SELECT pid, arrayJoin(['BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2']) AS gene FROM mprofp WHERE panel = 'WES'
),
cprofp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'prad_su2c_2019' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' AND replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
cprof AS (
  SELECT DISTINCT x.pid AS pid, gp.gene AS gene FROM cprofp x JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = x.panel WHERE gp.gene IN ('BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2')
  UNION DISTINCT
  SELECT pid, arrayJoin(['BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2']) AS gene FROM cprofp WHERE panel = 'WES'
),
germ AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') AS pid, g.hugo_gene_symbol AS gene FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.hugo_gene_symbol IN ('BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2') AND g.variant_type = 'mutation' AND lowerUTF8(trimBoth(g.mutation_status)) = 'germline'
    AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
som AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') AS pid, g.hugo_gene_symbol AS gene FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.hugo_gene_symbol IN ('BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2') AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED' AND NOT (lowerUTF8(trimBoth(g.mutation_status)) = 'germline') AND NOT g.off_panel
    AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
del AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') AS pid, g.hugo_gene_symbol AS gene FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.hugo_gene_symbol IN ('BRCA2', 'ATM', 'BRCA1', 'APC', 'CHEK2') AND g.variant_type = 'cna' AND g.cna_alteration <= -2 AND NOT g.off_panel
    AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
base AS (SELECT pid, gene FROM mprof UNION DISTINCT SELECT pid, gene FROM germ),
fl AS (
  SELECT gene, toUInt8((pid, gene) IN (SELECT pid, gene FROM mprof)) AS mp, toUInt8((pid, gene) IN (SELECT pid, gene FROM germ)) AS carrier,
         toUInt8((pid, gene) IN (SELECT pid, gene FROM som)) AS som, toUInt8((pid, gene) IN (SELECT pid, gene FROM cprof)) AS cp,
         toUInt8((pid, gene) IN (SELECT pid, gene FROM del)) AS del
  FROM base
)
SELECT gene, mp, carrier, som, cp, del, count() AS n FROM fl GROUP BY gene, mp, carrier, som, cp, del

-- view 0 germline: germline:survival:mCRPC · prad_su2c_2019
WITH cohort AS (SELECT DISTINCT replaceOne(patient_unique_id, 'prad_su2c_2019_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'prad_su2c_2019'),
mprofp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'prad_su2c_2019' AND sp.alteration_type = 'MUTATION_EXTENDED' AND replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
mprof AS (
  SELECT DISTINCT x.pid AS pid, gp.gene AS gene FROM mprofp x JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = x.panel WHERE gp.gene IN ('BRCA2')
  UNION DISTINCT
  SELECT pid, arrayJoin(['BRCA2']) AS gene FROM mprofp WHERE panel = 'WES'
),
cprofp AS (
  SELECT DISTINCT replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') AS pid, toString(sp.gene_panel_id) AS panel
  FROM snapshot_db.sample_to_gene_panel_derived sp JOIN snapshot_db.sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id
  WHERE sp.cancer_study_identifier = 'prad_su2c_2019' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' AND replaceOne(sd.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
cprof AS (
  SELECT DISTINCT x.pid AS pid, gp.gene AS gene FROM cprofp x JOIN snapshot_db.gene_panel_to_gene_derived gp ON gp.gene_panel_id = x.panel WHERE gp.gene IN ('BRCA2')
  UNION DISTINCT
  SELECT pid, arrayJoin(['BRCA2']) AS gene FROM cprofp WHERE panel = 'WES'
),
germ AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') AS pid, g.hugo_gene_symbol AS gene FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.hugo_gene_symbol IN ('BRCA2') AND g.variant_type = 'mutation' AND lowerUTF8(trimBoth(g.mutation_status)) = 'germline'
    AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
som AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') AS pid, g.hugo_gene_symbol AS gene FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.hugo_gene_symbol IN ('BRCA2') AND g.variant_type = 'mutation' AND g.mutation_status != 'UNCALLED' AND NOT (lowerUTF8(trimBoth(g.mutation_status)) = 'germline') AND NOT g.off_panel
    AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
del AS (
  SELECT DISTINCT replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') AS pid, g.hugo_gene_symbol AS gene FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'prad_su2c_2019' AND g.hugo_gene_symbol IN ('BRCA2') AND g.variant_type = 'cna' AND g.cna_alteration <= -2 AND NOT g.off_panel
    AND replaceOne(g.patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
),
base AS (SELECT pid, gene FROM mprof UNION DISTINCT SELECT pid, gene FROM germ),
os AS (
  SELECT replaceOne(patient_unique_id, 'prad_su2c_2019_', '') AS pid, if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') LIKE '1%' AS dead
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'prad_su2c_2019' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'prad_su2c_2019_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
),
sv AS (
  SELECT toUInt8(mprof.pid IN (SELECT pid FROM germ)) AS carrier, os.months AS months, os.dead AS dead
  FROM mprof INNER JOIN os ON os.pid = mprof.pid WHERE os.months IS NOT NULL AND os.months >= 0
)
SELECT carrier, round(months, 2) AS t, dead, count() AS n FROM sv GROUP BY carrier, t, dead ORDER BY t
