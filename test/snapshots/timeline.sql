-- cohort Breast
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))

-- view 0 timeline: table:attributes · msk_chord_2024
SELECT m.attr_id AS id, m.display_name AS name, m.datatype AS datatype, m.patient_attribute AS patient, toInt32OrZero(m.priority) AS priority
FROM snapshot_db.clinical_attribute_meta m
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = m.cancer_study_id
WHERE cs.cancer_study_identifier = 'msk_chord_2024'
ORDER BY priority DESC, name

-- view 0 timeline: timeline:counts · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
pt0 AS (
  SELECT p.internal_id AS iid, p.stable_id AS pid FROM snapshot_db.patient p
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
),
ev0 AS (
  SELECT ce.patient_id AS iid, count() AS events, min(ce.start_date) AS first,
         max(greatest(ce.start_date, ifNull(ce.stop_date, ce.start_date))) AS last,
         arrayStringConcat(arraySort(groupUniqArray(trimBoth(ce.event_type))), ', ') AS types
  FROM snapshot_db.clinical_event ce WHERE ce.patient_id IN (SELECT iid FROM pt0)
  GROUP BY iid
),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, pt.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.samples, 0)) AS samples, toUInt64(ifNull(ev.events, 0)) AS events,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.first)), NULL) AS first,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.last)), NULL) AS last,
         ifNull(ev.types, '') AS types
  FROM pt0 AS pt LEFT JOIN ev0 AS ev ON ev.iid = pt.iid LEFT JOIN sm0 AS sm ON sm.pid = pt.pid
)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 timeline: timeline:events · msk_chord_2024
WITH pt AS (
  SELECT p.internal_id FROM snapshot_db.patient p JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id = 'P-0000012'
), ev AS (
  SELECT clinical_event_id, event_type, start_date, stop_date FROM snapshot_db.clinical_event WHERE patient_id IN (SELECT internal_id FROM pt)
)
SELECT ev.clinical_event_id AS id, ev.event_type AS type, ev.start_date AS start, ev.stop_date AS stop,
       groupArrayIf((d.key, d.value), d.key != '') AS attrs
FROM ev LEFT JOIN (
  SELECT clinical_event_id, key, value FROM snapshot_db.clinical_event_data WHERE clinical_event_id IN (SELECT clinical_event_id FROM ev)
) d ON d.clinical_event_id = ev.clinical_event_id
GROUP BY id, type, start, stop
ORDER BY start, id

-- view 0 timeline: timeline:rank · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
pt0 AS (
  SELECT p.internal_id AS iid, p.stable_id AS pid FROM snapshot_db.patient p
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
),
ev0 AS (
  SELECT ce.patient_id AS iid, count() AS events, min(ce.start_date) AS first,
         max(greatest(ce.start_date, ifNull(ce.stop_date, ce.start_date))) AS last,
         arrayStringConcat(arraySort(groupUniqArray(trimBoth(ce.event_type))), ', ') AS types
  FROM snapshot_db.clinical_event ce WHERE ce.patient_id IN (SELECT iid FROM pt0)
  GROUP BY iid
),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, pt.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.samples, 0)) AS samples, toUInt64(ifNull(ev.events, 0)) AS events,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.first)), NULL) AS first,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.last)), NULL) AS last,
         ifNull(ev.types, '') AS types
  FROM pt0 AS pt LEFT JOIN ev0 AS ev ON ev.iid = pt.iid LEFT JOIN sm0 AS sm ON sm.pid = pt.pid
)
SELECT idx FROM (SELECT study, patient, row_number() OVER (ORDER BY toFloat64(events) DESC NULLS LAST, patient, ord) - 1 AS idx FROM rows
WHERE 1)
WHERE study = 'msk_chord_2024' AND patient = 'P-0000012' LIMIT 1

-- view 0 timeline: timeline:rows · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
pt0 AS (
  SELECT p.internal_id AS iid, p.stable_id AS pid FROM snapshot_db.patient p
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
),
ev0 AS (
  SELECT ce.patient_id AS iid, count() AS events, min(ce.start_date) AS first,
         max(greatest(ce.start_date, ifNull(ce.stop_date, ce.start_date))) AS last,
         arrayStringConcat(arraySort(groupUniqArray(trimBoth(ce.event_type))), ', ') AS types
  FROM snapshot_db.clinical_event ce WHERE ce.patient_id IN (SELECT iid FROM pt0)
  GROUP BY iid
),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, pt.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.samples, 0)) AS samples, toUInt64(ifNull(ev.events, 0)) AS events,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.first)), NULL) AS first,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.last)), NULL) AS last,
         ifNull(ev.types, '') AS types
  FROM pt0 AS pt LEFT JOIN ev0 AS ev ON ev.iid = pt.iid LEFT JOIN sm0 AS sm ON sm.pid = pt.pid
)
SELECT cohort, study, patient, sample, source, samples, events, first, last, types, count() OVER () AS total FROM rows
WHERE 1
ORDER BY toFloat64(events) DESC NULLS LAST, patient, ord
LIMIT 25 OFFSET 0

-- view 0 timeline: timeline:rows · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
pt0 AS (
  SELECT p.internal_id AS iid, p.stable_id AS pid FROM snapshot_db.patient p
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
),
ev0 AS (
  SELECT ce.patient_id AS iid, count() AS events, min(ce.start_date) AS first,
         max(greatest(ce.start_date, ifNull(ce.stop_date, ce.start_date))) AS last,
         arrayStringConcat(arraySort(groupUniqArray(trimBoth(ce.event_type))), ', ') AS types
  FROM snapshot_db.clinical_event ce WHERE ce.patient_id IN (SELECT iid FROM pt0)
  GROUP BY iid
),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, pt.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.samples, 0)) AS samples, toUInt64(ifNull(ev.events, 0)) AS events,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.first)), NULL) AS first,
         if(ifNull(ev.events, 0) > 0, toNullable(toInt64(ev.last)), NULL) AS last,
         ifNull(ev.types, '') AS types
  FROM pt0 AS pt LEFT JOIN ev0 AS ev ON ev.iid = pt.iid LEFT JOIN sm0 AS sm ON sm.pid = pt.pid
)
SELECT cohort, study, patient, sample, source, samples, events, first, last, types, count() OVER () AS total FROM rows
WHERE 1
ORDER BY toFloat64(events) DESC NULLS LAST, patient, ord
LIMIT 3 OFFSET 1250

-- view 0 timeline: timeline:sample-attributes · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT DISTINCT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN ('P-0000012')))),
u0 AS (
  SELECT patient_unique_id AS puid, sample_unique_id AS suid, 1 AS samples FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM c0)
),
pv0 AS (
  SELECT patient_unique_id AS k,
         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient' AND 0
    AND attribute_value != '' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY k
),
sv0 AS (
  SELECT sample_unique_id AS k,
         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'sample' AND attribute_name IN ('CANCER_TYPE','CLINICAL_GROUP','CLINICAL_SUMMARY','DIAGNOSIS_DESCRIPTION','ICD_O_HISTOLOGY_DESCRIPTION','PATHOLOGICAL_GROUP','CANCER_TYPE_DETAILED','SAMPLE_TYPE','MSI_TYPE','GENE_PANEL','SOMATIC_STATUS','SAMPLE_CLASS','MUTATION_COUNT','FRACTION_GENOME_ALTERED','TMB_NONSYNONYMOUS','GLEASON_SAMPLE_LEVEL','MSI_COMMENT','MSI_SCORE','METASTATIC_SITE','ONCOTREE_CODE','PRIMARY_SITE','PDL1_POSITIVE','SAMPLE_COVERAGE','TUMOR_PURITY')
    AND attribute_value != '' AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT sid FROM c0)
  GROUP BY k
),
rows AS (
  SELECT 'patient' AS cohort, 'msk_chord_2024' AS study, 0 AS ord,
         replaceOne(u.puid, 'msk_chord_2024_', '') AS patient, replaceOne(u.suid, 'msk_chord_2024_', '') AS sample, u.samples AS samples, mapUpdate(pv.m, sv.m) AS m
  FROM u0 AS u LEFT JOIN pv0 AS pv ON pv.k = u.puid LEFT JOIN sv0 AS sv ON sv.k = u.suid
)
SELECT cohort, study, patient, sample, samples, m, count() OVER () AS total FROM rows
WHERE 1
ORDER BY patient, sample, patient, sample, ord
LIMIT 1000 OFFSET 0

-- view 0 timeline: timeline:samples · msk_chord_2024
SELECT replaceOne(s.sample_unique_id, 'msk_chord_2024_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'msk_chord_2024' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'msk_chord_2024' AND s.patient_unique_id = 'msk_chord_2024_P-0000012'
GROUP BY id ORDER BY id

-- view 1 alterations: alterations:cna:counts · msk_chord_2024
WITH c AS (
  SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS gene, cna_alteration AS alt, cna_cytoband AS cytoband
  FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
),
g AS (SELECT gene, alt, any(cytoband) AS cytoband, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so FROM c GROUP BY gene, alt),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'CNA' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
fa AS (SELECT hugo_gene_symbol AS gene, cna_alteration AS alt, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alt),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' GROUP BY gene),
vs AS (SELECT sample_unique_id AS su FROM snapshot_db.sample_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'),
pan AS (SELECT DISTINCT sample_unique_id AS su, gene_panel_id AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'COPY_NUMBER_ALTERATION' AND sample_unique_id IN (SELECT su FROM vs)),
cov AS (SELECT DISTINCT pg.gene AS gene, pan.su AS su FROM pan JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pan.panel WHERE pg.gene IN (SELECT gene FROM g)),
miss AS (SELECT gene, length(np) AS n, np FROM (SELECT gg.gene AS gene,
  arraySort(groupArrayIf(replaceOne(vs.su, 'msk_chord_2024_', ''), vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np
  FROM (SELECT DISTINCT gene FROM g) AS gg CROSS JOIN vs GROUP BY gg.gene)),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, if(g.alt > 0, 'AMP', 'HOMDEL') AS cna, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         toUInt8(ifNull(miss.n, 0) = 0) AS inAll, miss.np AS notProfiled, '' AS genePanel, '' AS genePanelShown,
         g.cytoband AS cytoband, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         toUInt64(ifNull(fa.n, 0)) AS cohortN, toUInt64(ifNull(fp.n, 0)) AS cohortOf
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = if(g.alt > 0, 'AMPLIFICATION', 'DELETION')
  LEFT JOIN fa ON fa.gene = g.gene AND fa.alt = g.alt LEFT JOIN fp ON fp.gene = g.gene LEFT JOIN miss ON miss.gene = g.gene
))
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:cna:rows · msk_chord_2024
WITH c AS (
  SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS gene, cna_alteration AS alt, cna_cytoband AS cytoband
  FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
),
g AS (SELECT gene, alt, any(cytoband) AS cytoband, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so FROM c GROUP BY gene, alt),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'CNA' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
fa AS (SELECT hugo_gene_symbol AS gene, cna_alteration AS alt, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alt),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' GROUP BY gene),
vs AS (SELECT sample_unique_id AS su FROM snapshot_db.sample_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'),
pan AS (SELECT DISTINCT sample_unique_id AS su, gene_panel_id AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'COPY_NUMBER_ALTERATION' AND sample_unique_id IN (SELECT su FROM vs)),
cov AS (SELECT DISTINCT pg.gene AS gene, pan.su AS su FROM pan JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pan.panel WHERE pg.gene IN (SELECT gene FROM g)),
miss AS (SELECT gene, length(np) AS n, np FROM (SELECT gg.gene AS gene,
  arraySort(groupArrayIf(replaceOne(vs.su, 'msk_chord_2024_', ''), vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np
  FROM (SELECT DISTINCT gene FROM g) AS gg CROSS JOIN vs GROUP BY gg.gene)),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, if(g.alt > 0, 'AMP', 'HOMDEL') AS cna, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         toUInt8(ifNull(miss.n, 0) = 0) AS inAll, miss.np AS notProfiled, '' AS genePanel, '' AS genePanelShown,
         g.cytoband AS cytoband, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         toUInt64(ifNull(fa.n, 0)) AS cohortN, toUInt64(ifNull(fp.n, 0)) AS cohortOf
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = if(g.alt > 0, 'AMPLIFICATION', 'DELETION')
  LEFT JOIN fa ON fa.gene = g.gene AND fa.alt = g.alt LEFT JOIN fp ON fp.gene = g.gene LEFT JOIN miss ON miss.gene = g.gene
))
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY gdrv DESC, gene, so, gene, cna
LIMIT 25 OFFSET 0

-- view 1 alterations: alterations:counts · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(arrayStringConcat(arraySort([ifNull(toString(g1.hugo_gene_symbol), ''), ifNull(toString(g2.hugo_gene_symbol), ''), ifNull(toString(sv.site1_position), ''), ifNull(toString(sv.site2_position), ''), ifNull(toString(sv.site1_chromosome), ''), ifNull(toString(sv.site2_chromosome), ''), ifNull(toString(sv.class), '')]), '_')) AS n
  FROM snapshot_db.structural_variant sv
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:mixed-cna · msk_chord_2024
WITH c AS (
  SELECT replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid, hugo_gene_symbol AS gene, cna_alteration AS alt, cna_cytoband AS cytoband
  FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
),
g AS (SELECT gene, alt, any(cytoband) AS cytoband, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so FROM c GROUP BY gene, alt),
fa AS (SELECT hugo_gene_symbol AS gene, cna_alteration AS alt, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alt),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'COPY_NUMBER_ALTERATION' GROUP BY gene),
vs AS (SELECT sample_unique_id AS su FROM snapshot_db.sample_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'),
pan AS (SELECT DISTINCT sample_unique_id AS su, gene_panel_id AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'COPY_NUMBER_ALTERATION' AND sample_unique_id IN (SELECT su FROM vs)),
cov AS (SELECT DISTINCT pg.gene AS gene, pan.su AS su FROM pan JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pan.panel WHERE pg.gene IN (SELECT gene FROM g)),
miss AS (SELECT gene, length(np) AS n, np FROM (SELECT gg.gene AS gene,
  arraySort(groupArrayIf(replaceOne(vs.su, 'msk_chord_2024_', ''), vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np
  FROM (SELECT DISTINCT gene FROM g) AS gg CROSS JOIN vs GROUP BY gg.gene)),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, if(g.alt > 0, 'AMP', 'HOMDEL') AS cna, '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,
         toUInt8(ifNull(miss.n, 0) = 0) AS inAll, miss.np AS notProfiled, '' AS genePanel, '' AS genePanelShown,
         g.cytoband AS cytoband, if(ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         toUInt64(ifNull(fa.n, 0)) AS cohortN, toUInt64(ifNull(fp.n, 0)) AS cohortOf
  FROM g
  LEFT JOIN fa ON fa.gene = g.gene AND fa.alt = g.alt LEFT JOIN fp ON fp.gene = g.gene LEFT JOIN miss ON miss.gene = g.gene
))
SELECT cohort, study, countIf((CAST(inAll AS Nullable(Float64)) IS NOT NULL AND CAST(inAll AS Nullable(Float64)) <= 0)) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:mixed-mutations · msk_chord_2024
WITH m AS (
  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon, ifNull(keyword, '') AS kw,
         if(tumorAltCount >= 0 AND tumorRefCount >= 0 AND tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND patientId = 'P-0000012' AND molecularProfileId NOT LIKE '%uncalled%'
),
g AS (
  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, max(kw) AS kw, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so,
         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount,
         groupArrayIf(tuple(sid, ac, rc), f IS NOT NULL) AS rs,
         arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1)), arrayFilter((x, i) -> indexOf(arrayMap(y -> y.1, rs), x.1) = i, rs, arrayEnumerate(rs))) AS reads
  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var
),
cn AS (SELECT hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(if(cna_alteration > 0, 'AMP', 'HOMDEL'))), ', ') AS copy
  FROM snapshot_db.genomic_event_derived WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'
    AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fa AS (SELECT hugo_gene_symbol AS gene, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'mutation' AND genetic_profile_stable_id NOT LIKE '%uncalled%'
    AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
kc AS (SELECT keyword AS kw, uniqExact(sampleId) AS n FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND keyword IN (SELECT kw FROM g WHERE kw != '') GROUP BY kw),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED' GROUP BY gene),
vs AS (SELECT sample_unique_id AS su FROM snapshot_db.sample_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'),
pan AS (SELECT DISTINCT sample_unique_id AS su, gene_panel_id AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'MUTATION_EXTENDED' AND sample_unique_id IN (SELECT su FROM vs)),
cov AS (SELECT DISTINCT pg.gene AS gene, pan.su AS su FROM pan JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pan.panel WHERE pg.gene IN (SELECT gene FROM g)),
miss AS (SELECT gene, length(np) AS n, np FROM (SELECT gg.gene AS gene,
  arraySort(groupArrayIf(replaceOne(vs.su, 'msk_chord_2024_', ''), vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np
  FROM (SELECT DISTINCT gene FROM g) AS gg CROSS JOIN vs GROUP BY gg.gene)),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, g.proteinChange AS proteinChange, '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,
         toUInt8(ifNull(miss.n, 0) = 0) AS inAll, miss.np AS notProfiled, '' AS genePanel, '' AS genePanelShown,
         g.mutationType AS mutationType, ifNull(cn.copy, '') AS copy, CAST(NULL AS Nullable(Float64)) AS mrna, CAST(NULL AS Nullable(Float64)) AS mrnaZ, if(g.kw != '' AND ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         toUInt64(ifNull(fa.n, 0)) AS cohortN, toUInt64(ifNull(kc.n, 0)) AS cohortKwN, toUInt64(ifNull(fp.n, 0)) AS cohortOf, g.kw AS keyword,
         round(g.vaf, 4) AS vaf, g.altCount AS altCount, g.refCount AS refCount, g.reads AS reads,
         CAST(arrayMap(s -> arrayFirst(x -> x.1 = s, arrayMap(x -> tuple(x.1, if(x.2 > 0, x.2 / (x.2 + x.3), NULL)), g.reads)).2, ['P-0000012-T02-IM3', 'P-0000012-T03-IM3']) AS Array(Nullable(Float64))) AS vafs, g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end,
         g.ref AS ref, g.var AS var, g.status AS status, g.pos AS pos
  FROM g
  LEFT JOIN cn ON cn.gene = g.gene LEFT JOIN fa ON fa.gene = g.gene LEFT JOIN fp ON fp.gene = g.gene LEFT JOIN kc ON kc.kw = g.kw LEFT JOIN miss ON miss.gene = g.gene
))
SELECT cohort, study, countIf((CAST(inAll AS Nullable(Float64)) IS NOT NULL AND CAST(inAll AS Nullable(Float64)) <= 0)) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:mutations:counts · msk_chord_2024
WITH m AS (
  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon, ifNull(keyword, '') AS kw,
         if(tumorAltCount >= 0 AND tumorRefCount >= 0 AND tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND patientId = 'P-0000012' AND molecularProfileId NOT LIKE '%uncalled%'
),
g AS (
  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, max(kw) AS kw, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so,
         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount,
         groupArrayIf(tuple(sid, ac, rc), f IS NOT NULL) AS rs,
         arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1)), arrayFilter((x, i) -> indexOf(arrayMap(y -> y.1, rs), x.1) = i, rs, arrayEnumerate(rs))) AS reads
  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var
),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
cn AS (SELECT hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(if(cna_alteration > 0, 'AMP', 'HOMDEL'))), ', ') AS copy
  FROM snapshot_db.genomic_event_derived WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'
    AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fa AS (SELECT hugo_gene_symbol AS gene, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'mutation' AND genetic_profile_stable_id NOT LIKE '%uncalled%'
    AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
kc AS (SELECT keyword AS kw, uniqExact(sampleId) AS n FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND keyword IN (SELECT kw FROM g WHERE kw != '') GROUP BY kw),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED' GROUP BY gene),
vs AS (SELECT sample_unique_id AS su FROM snapshot_db.sample_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'),
pan AS (SELECT DISTINCT sample_unique_id AS su, gene_panel_id AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'MUTATION_EXTENDED' AND sample_unique_id IN (SELECT su FROM vs)),
cov AS (SELECT DISTINCT pg.gene AS gene, pan.su AS su FROM pan JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pan.panel WHERE pg.gene IN (SELECT gene FROM g)),
miss AS (SELECT gene, length(np) AS n, np FROM (SELECT gg.gene AS gene,
  arraySort(groupArrayIf(replaceOne(vs.su, 'msk_chord_2024_', ''), vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np
  FROM (SELECT DISTINCT gene FROM g) AS gg CROSS JOIN vs GROUP BY gg.gene)),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, g.proteinChange AS proteinChange, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         toUInt8(ifNull(miss.n, 0) = 0) AS inAll, miss.np AS notProfiled, '' AS genePanel, '' AS genePanelShown,
         g.mutationType AS mutationType, ifNull(cn.copy, '') AS copy, CAST(NULL AS Nullable(Float64)) AS mrna, CAST(NULL AS Nullable(Float64)) AS mrnaZ, if(g.kw != '' AND ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         toUInt64(ifNull(fa.n, 0)) AS cohortN, toUInt64(ifNull(kc.n, 0)) AS cohortKwN, toUInt64(ifNull(fp.n, 0)) AS cohortOf, g.kw AS keyword,
         round(g.vaf, 4) AS vaf, g.altCount AS altCount, g.refCount AS refCount, g.reads AS reads,
         CAST(arrayMap(s -> arrayFirst(x -> x.1 = s, arrayMap(x -> tuple(x.1, if(x.2 > 0, x.2 / (x.2 + x.3), NULL)), g.reads)).2, ['P-0000012-T02-IM3', 'P-0000012-T03-IM3']) AS Array(Nullable(Float64))) AS vafs, g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end,
         g.ref AS ref, g.var AS var, g.status AS status, g.pos AS pos
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = g.proteinChange
  LEFT JOIN cn ON cn.gene = g.gene LEFT JOIN fa ON fa.gene = g.gene LEFT JOIN fp ON fp.gene = g.gene LEFT JOIN kc ON kc.kw = g.kw LEFT JOIN miss ON miss.gene = g.gene
))
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:mutations:rows · msk_chord_2024
WITH m AS (
  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon, ifNull(keyword, '') AS kw,
         if(tumorAltCount >= 0 AND tumorRefCount >= 0 AND tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND patientId = 'P-0000012' AND molecularProfileId NOT LIKE '%uncalled%'
),
g AS (
  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, max(kw) AS kw, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so,
         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount,
         groupArrayIf(tuple(sid, ac, rc), f IS NOT NULL) AS rs,
         arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1)), arrayFilter((x, i) -> indexOf(arrayMap(y -> y.1, rs), x.1) = i, rs, arrayEnumerate(rs))) AS reads
  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var
),
ann AS (SELECT hugo_gene_symbol AS gene, alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver
  FROM annotation.oncokb WHERE oncokb_version = 'v7.5' AND alteration_type = 'MUTATION' AND hugo_gene_symbol IN (SELECT gene FROM g)
  GROUP BY gene, alteration),
cn AS (SELECT hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(if(cna_alteration > 0, 'AMP', 'HOMDEL'))), ', ') AS copy
  FROM snapshot_db.genomic_event_derived WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'
    AND variant_type = 'cna' AND abs(cna_alteration) >= 2 AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
fa AS (SELECT hugo_gene_symbol AS gene, uniqExact(sample_unique_id) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'mutation' AND genetic_profile_stable_id NOT LIKE '%uncalled%'
    AND hugo_gene_symbol IN (SELECT gene FROM g) GROUP BY gene),
kc AS (SELECT keyword AS kw, uniqExact(sampleId) AS n FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND keyword IN (SELECT kw FROM g WHERE kw != '') GROUP BY kw),
fp AS (SELECT pg.gene AS gene, uniqExact(sp.sample_unique_id) AS n FROM snapshot_db.sample_to_gene_panel_derived sp
  JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (SELECT gene FROM g)
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED' GROUP BY gene),
vs AS (SELECT sample_unique_id AS su FROM snapshot_db.sample_derived WHERE cancer_study_identifier = 'msk_chord_2024' AND patient_unique_id = 'msk_chord_2024_P-0000012'),
pan AS (SELECT DISTINCT sample_unique_id AS su, gene_panel_id AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND alteration_type = 'MUTATION_EXTENDED' AND sample_unique_id IN (SELECT su FROM vs)),
cov AS (SELECT DISTINCT pg.gene AS gene, pan.su AS su FROM pan JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pan.panel WHERE pg.gene IN (SELECT gene FROM g)),
miss AS (SELECT gene, length(np) AS n, np FROM (SELECT gg.gene AS gene,
  arraySort(groupArrayIf(replaceOne(vs.su, 'msk_chord_2024_', ''), vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np
  FROM (SELECT DISTINCT gene FROM g) AS gg CROSS JOIN vs GROUP BY gg.gene)),
rows AS (SELECT *, max(drv) OVER (PARTITION BY gene) AS gdrv FROM (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.samples AS samples, g.so AS so, g.gene AS gene, g.proteinChange AS proteinChange, ifNull(ann.oncogenicity, '') AS oncogenicity, ifNull(ann.level, '') AS level, toUInt8(ifNull(ann.driver, 0)) AS drv,
         toUInt8(ifNull(miss.n, 0) = 0) AS inAll, miss.np AS notProfiled, '' AS genePanel, '' AS genePanelShown,
         g.mutationType AS mutationType, ifNull(cn.copy, '') AS copy, CAST(NULL AS Nullable(Float64)) AS mrna, CAST(NULL AS Nullable(Float64)) AS mrnaZ, if(g.kw != '' AND ifNull(fp.n, 0) > 0, 100 * ifNull(fa.n, 0) / fp.n, NULL) AS freq,
         toUInt64(ifNull(fa.n, 0)) AS cohortN, toUInt64(ifNull(kc.n, 0)) AS cohortKwN, toUInt64(ifNull(fp.n, 0)) AS cohortOf, g.kw AS keyword,
         round(g.vaf, 4) AS vaf, g.altCount AS altCount, g.refCount AS refCount, g.reads AS reads,
         CAST(arrayMap(s -> arrayFirst(x -> x.1 = s, arrayMap(x -> tuple(x.1, if(x.2 > 0, x.2 / (x.2 + x.3), NULL)), g.reads)).2, ['P-0000012-T02-IM3', 'P-0000012-T03-IM3']) AS Array(Nullable(Float64))) AS vafs, g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end,
         g.ref AS ref, g.var AS var, g.status AS status, g.pos AS pos
  FROM g
  LEFT JOIN ann ON ann.gene = g.gene AND ann.alteration = g.proteinChange
  LEFT JOIN cn ON cn.gene = g.gene LEFT JOIN fa ON fa.gene = g.gene LEFT JOIN fp ON fp.gene = g.gene LEFT JOIN kc ON kc.kw = g.kw LEFT JOIN miss ON miss.gene = g.gene
))
SELECT * EXCEPT (vafs), count() OVER () AS total FROM rows
WHERE 1
ORDER BY gdrv DESC, gene, so, pos ASC NULLS LAST, gene, chr, start, end, ref, var, proteinChange, mutationType
LIMIT 25 OFFSET 0

-- view 1 alterations: alterations:profiled · msk_chord_2024
WITH rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, smp.stable_id AS sid,
         if((SELECT count() FROM (SELECT gp.genetic_profile_id FROM snapshot_db.genetic_profile gp JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'MUTATION_EXTENDED' AND gp.stable_id NOT LIKE '%uncalled%')) = 0, -1, toInt8(smp.internal_id IN (SELECT sample_id FROM snapshot_db.sample_profile WHERE genetic_profile_id IN (SELECT gp.genetic_profile_id FROM snapshot_db.genetic_profile gp JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'MUTATION_EXTENDED' AND gp.stable_id NOT LIKE '%uncalled%')))) AS mutations,
         if((SELECT count() FROM (SELECT gp.genetic_profile_id FROM snapshot_db.genetic_profile gp JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'COPY_NUMBER_ALTERATION' AND gp.datatype = 'DISCRETE')) = 0, -1, toInt8(smp.internal_id IN (SELECT sample_id FROM snapshot_db.sample_profile WHERE genetic_profile_id IN (SELECT gp.genetic_profile_id FROM snapshot_db.genetic_profile gp JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'COPY_NUMBER_ALTERATION' AND gp.datatype = 'DISCRETE')))) AS cna,
         if((SELECT count() FROM (SELECT gp.genetic_profile_id FROM snapshot_db.genetic_profile gp JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT')) = 0, -1, toInt8(smp.internal_id IN (SELECT sample_id FROM snapshot_db.sample_profile WHERE genetic_profile_id IN (SELECT gp.genetic_profile_id FROM snapshot_db.genetic_profile gp JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT')))) AS sv
  FROM snapshot_db.sample smp JOIN snapshot_db.patient pt ON pt.internal_id = smp.patient_id JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = pt.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND pt.stable_id = 'P-0000012'
)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY sid, sid
LIMIT 1000 OFFSET 0

-- view 1 alterations: alterations:rank · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(arrayStringConcat(arraySort([ifNull(toString(g1.hugo_gene_symbol), ''), ifNull(toString(g2.hugo_gene_symbol), ''), ifNull(toString(sv.site1_position), ''), ifNull(toString(sv.site2_position), ''), ifNull(toString(sv.site1_chromosome), ''), ifNull(toString(sv.site2_chromosome), ''), ifNull(toString(sv.class), '')]), '_')) AS n
  FROM snapshot_db.structural_variant sv
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT idx FROM (SELECT study, patient, row_number() OVER (ORDER BY mutations + cna + sv = 0, patient, patient, ord) - 1 AS idx FROM rows
WHERE 1)
WHERE study = 'msk_chord_2024' AND patient = 'P-0000012' LIMIT 1

-- view 1 alterations: alterations:rows · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(arrayStringConcat(arraySort([ifNull(toString(g1.hugo_gene_symbol), ''), ifNull(toString(g2.hugo_gene_symbol), ''), ifNull(toString(sv.site1_position), ''), ifNull(toString(sv.site2_position), ''), ifNull(toString(sv.site1_chromosome), ''), ifNull(toString(sv.site2_chromosome), ''), ifNull(toString(sv.class), '')]), '_')) AS n
  FROM snapshot_db.structural_variant sv
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT cohort, study, patient, sample, source, samples, mutations, cna, sv, count() OVER () AS total FROM rows
WHERE 1
ORDER BY mutations + cna + sv = 0, patient, patient, ord
LIMIT 2 OFFSET 0

-- view 1 alterations: alterations:rows · msk_chord_2024
WITH c0 AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND (('sample', replaceOne(sample_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer')))) OR ('patient', replaceOne(patient_unique_id, 'msk_chord_2024_', '')) IN (SELECT DISTINCT type AS lvl, if(type = 'sample', replaceOne(sample_unique_id, 'msk_chord_2024_', ''), replaceOne(patient_unique_id, 'msk_chord_2024_', '')) AS id
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND attribute_name = 'CANCER_TYPE' AND lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Breast Cancer'))))))),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(tuple(`GENE.hugoGeneSymbol`, proteinChange, mutationType, variantType, chr, startPosition, endPosition, referenceAllele, tumorSeqAllele)) AS n
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND molecularProfileId NOT LIKE '%uncalled%' AND patientId IN (SELECT pid FROM c0)
  GROUP BY pid
),
cn0 AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, uniqExact(hugo_gene_symbol, cna_alteration) AS n FROM snapshot_db.genomic_event_derived
  WHERE startsWith(genetic_profile_stable_id, 'msk_chord_2024_') AND cancer_study_identifier = 'msk_chord_2024' AND variant_type = 'cna' AND abs(cna_alteration) >= 2
    AND replaceOne(patient_unique_id, 'msk_chord_2024_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
sv0 AS (
  SELECT p.stable_id AS pid, uniqExact(arrayStringConcat(arraySort([ifNull(toString(g1.hugo_gene_symbol), ''), ifNull(toString(g2.hugo_gene_symbol), ''), ifNull(toString(sv.site1_position), ''), ifNull(toString(sv.site2_position), ''), ifNull(toString(sv.site1_chromosome), ''), ifNull(toString(sv.site2_chromosome), ''), ifNull(toString(sv.class), '')]), '_')) AS n
  FROM snapshot_db.structural_variant sv
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  JOIN snapshot_db.sample s ON s.internal_id = sv.sample_id
  JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id IN (SELECT pid FROM c0)
  GROUP BY pid
),
rows AS (
  SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, c.pid AS patient, '' AS sample, 'this portal (primary)' AS source,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(cn.n, 0)) AS cna, toUInt64(ifNull(sv.n, 0)) AS sv
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid
  LEFT JOIN cn0 AS cn ON cn.pid = c.pid LEFT JOIN sv0 AS sv ON sv.pid = c.pid
)
SELECT cohort, study, patient, sample, source, samples, mutations, cna, sv, count() OVER () AS total FROM rows
WHERE 1
ORDER BY mutations + cna + sv = 0, patient, patient, ord
LIMIT 25 OFFSET 0

-- view 1 alterations: alterations:samples:counts · msk_chord_2024
WITH s AS (SELECT replaceOne(s.sample_unique_id, 'msk_chord_2024_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'msk_chord_2024' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'msk_chord_2024' AND s.patient_unique_id = 'msk_chord_2024_P-0000012'
GROUP BY id ORDER BY id),
rows AS (SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:samples:rows · msk_chord_2024
WITH s AS (SELECT replaceOne(s.sample_unique_id, 'msk_chord_2024_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'msk_chord_2024' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'msk_chord_2024' AND s.patient_unique_id = 'msk_chord_2024_P-0000012'
GROUP BY id ORDER BY id),
rows AS (SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, s.id AS sid, ifNull(s.type, '') AS type FROM s)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY sid, sid
LIMIT 1000 OFFSET 0

-- view 1 alterations: alterations:sv:counts · msk_chord_2024
WITH s AS (
  SELECT smp.stable_id AS sid, if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], smp.stable_id) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], smp.stable_id)) AS o,
         arrayStringConcat(arraySort([ifNull(toString(g1.hugo_gene_symbol), ''), ifNull(toString(g2.hugo_gene_symbol), ''), ifNull(toString(sv.site1_position), ''), ifNull(toString(sv.site2_position), ''), ifNull(toString(sv.site1_chromosome), ''), ifNull(toString(sv.site2_chromosome), ''), ifNull(toString(sv.class), '')]), '_') AS k,
         tuple(o, sv.internal_id) AS r, tuple(gene1, gene2, class, eventInfo, pos1, pos2, breakpointType, connectionType, frame, site1, site2, length, dnaSupport, rnaSupport, status, svAnnotation, comments) AS rec0,
         ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,
         ifNull(sv.class, '') AS class, ifNull(sv.event_info, '') AS eventInfo, sv.breakpoint_type AS breakpointType, sv.connection_type AS connectionType,
         sv.site2_effect_on_frame AS frame, sv.site1_description AS site1, sv.site2_description AS site2,
         if(sv.site1_position IS NULL, '', concat(ifNull(sv.site1_chromosome, ''), ':', toString(sv.site1_position))) AS pos1,
         if(sv.site2_position IS NULL, '', concat(ifNull(sv.site2_chromosome, ''), ':', toString(sv.site2_position))) AS pos2,
         sv.length AS length, sv.tumor_variant_count AS tumorVariantCount, sv.tumor_read_count AS tumorReadCount,
         sv.dna_support AS dnaSupport, sv.rna_support AS rnaSupport, sv.sv_status AS status, sv.annotation AS svAnnotation, sv.comments AS comments
  FROM snapshot_db.structural_variant sv
  JOIN snapshot_db.sample smp ON smp.internal_id = sv.sample_id
  LEFT JOIN snapshot_db.gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id
  LEFT JOIN snapshot_db.gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id
  WHERE sv.sample_id IN (SELECT s.internal_id FROM snapshot_db.sample s JOIN snapshot_db.patient p ON p.internal_id = s.patient_id
    JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
    WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id = 'P-0000012')
),
g AS (
  SELECT k, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so,
         argMin(rec0, r) AS rec, tupleElement(rec, 1) AS gene1, tupleElement(rec, 2) AS gene2, tupleElement(rec, 3) AS class, tupleElement(rec, 4) AS eventInfo, tupleElement(rec, 5) AS pos1, tupleElement(rec, 6) AS pos2, tupleElement(rec, 7) AS breakpointType, tupleElement(rec, 8) AS connectionType, tupleElement(rec, 9) AS frame, tupleElement(rec, 10) AS site1, tupleElement(rec, 11) AS site2, tupleElement(rec, 12) AS length, tupleElement(rec, 13) AS dnaSupport, tupleElement(rec, 14) AS rnaSupport, tupleElement(rec, 15) AS status, tupleElement(rec, 16) AS svAnnotation, tupleElement(rec, 17) AS comments,
         max(tumorVariantCount) AS tumorVariantCount, max(tumorReadCount) AS tumorReadCount
  FROM s GROUP BY k
),
rows AS (SELECT 'Breast' AS cohort, 'msk_chord_2024' AS study, 0 AS ord, 'P-0000012' AS patient, splitByString(', ', g.samples)[1] AS sid, g.* EXCEPT (rec) FROM g)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 1 alterations: alterations:vafs · msk_chord_2024
WITH m AS (
  SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,
         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS ac, tumorRefCount AS rc, mutationStatus AS ms, proteinPosStart AS codon, ifNull(keyword, '') AS kw,
         if(tumorAltCount >= 0 AND tumorRefCount >= 0 AND tumorAltCount + tumorRefCount > 0, tumorAltCount / (tumorAltCount + tumorRefCount), NULL) AS f
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'msk_chord_2024_') AND studyId = 'msk_chord_2024' AND patientId = 'P-0000012' AND molecularProfileId NOT LIKE '%uncalled%'
),
g AS (
  SELECT gene, proteinChange, mutationType, variantType, chr, start, end, ref, var, any(ms) AS status, min(codon) AS pos, max(kw) AS kw, arrayStringConcat(arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x)), groupUniqArray(sid)), ', ') AS samples, min(if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], sid))) AS so,
         max(f) AS vaf, argMax(ac, ifNull(f, -1)) AS altCount, argMax(rc, ifNull(f, -1)) AS refCount,
         groupArrayIf(tuple(sid, ac, rc), f IS NOT NULL) AS rs,
         arraySort(x -> if(indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1) = 0, 1000000, indexOf(['P-0000012-T02-IM3', 'P-0000012-T03-IM3'], x.1)), arrayFilter((x, i) -> indexOf(arrayMap(y -> y.1, rs), x.1) = i, rs, arrayEnumerate(rs))) AS reads
  FROM m GROUP BY gene, proteinChange, mutationType, variantType, chr, start, end, ref, var
),
rows AS (SELECT x.1 AS sid, arraySort(groupArray(x.2 / (x.2 + x.3))) AS vafs FROM g ARRAY JOIN reads AS x GROUP BY sid)
SELECT sid, vafs, count() OVER () AS total FROM rows
WHERE 1
ORDER BY sid, sid
LIMIT 1000 OFFSET 0

-- view 1 alterations: timeline:events · msk_chord_2024
WITH pt AS (
  SELECT p.internal_id FROM snapshot_db.patient p JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024' AND p.stable_id = 'P-0000012'
), ev AS (
  SELECT clinical_event_id, event_type, start_date, stop_date FROM snapshot_db.clinical_event WHERE patient_id IN (SELECT internal_id FROM pt)
)
SELECT ev.clinical_event_id AS id, ev.event_type AS type, ev.start_date AS start, ev.stop_date AS stop,
       groupArrayIf((d.key, d.value), d.key != '') AS attrs
FROM ev LEFT JOIN (
  SELECT clinical_event_id, key, value FROM snapshot_db.clinical_event_data WHERE clinical_event_id IN (SELECT clinical_event_id FROM ev)
) d ON d.clinical_event_id = ev.clinical_event_id
GROUP BY id, type, start, stop
ORDER BY start, id

-- view 1 alterations: timeline:samples · msk_chord_2024
SELECT replaceOne(s.sample_unique_id, 'msk_chord_2024_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'msk_chord_2024' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'msk_chord_2024' AND s.patient_unique_id = 'msk_chord_2024_P-0000012'
GROUP BY id ORDER BY id
