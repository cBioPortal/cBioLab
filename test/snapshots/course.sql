-- cohort TP53 mut
-- msk_chord_2024
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))

-- cohort TP53 wt
-- msk_chord_2024
((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT DISTINCT replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') AS sid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))

-- view 0 course: eventCourse:@Treatment/3mo · msk_chord_2024
WITH cohort AS (((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024')
EXCEPT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND (g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)))))
INTERSECT DISTINCT
(SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN (SELECT DISTINCT replaceOne(sp.sample_unique_id, 'msk_chord_2024_', '') AS sid
  FROM snapshot_db.sample_to_gene_panel_derived sp
  WHERE sp.cancer_study_identifier = 'msk_chord_2024' AND sp.alteration_type = 'MUTATION_EXTENDED'
    AND (sp.gene_panel_id = 'WES' OR sp.gene_panel_id IN (
      SELECT gene_panel_id FROM snapshot_db.gene_panel_to_gene_derived WHERE gene = 'TP53'))))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
  GROUP BY pid
),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) * 30.4375 AS os_day
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'OS_MONTHS'
  GROUP BY pid
),
span AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS entry,
         max(coalesce(ce.stop_date, ce.start_date)) AS last_ev
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
obs AS (
  SELECT sp.pid AS pid, toFloat64(sp.entry) AS entry,
         greatest(toFloat64(sp.last_ev), coalesce(os.os_day, toFloat64(sp.last_ev))) AS last_day
  FROM span sp LEFT JOIN os ON os.pid = sp.pid
),
denom AS (
  SELECT arrayJoin(range(
    toInt32(greatest(floor((o.entry - a.day) / 91.3125), -4)),
    toInt32(least(floor((o.last_day - a.day) / 91.3125), 20)) + 1)) AS bin, o.pid AS pid, '' AS et
  FROM obs o JOIN anch a ON a.pid = o.pid
),
numer AS (
  SELECT arrayJoin(range(
    toInt32(greatest(floor((ce.start_date - a.day) / 91.3125), -4)),
    toInt32(least(floor((coalesce(ce.stop_date, ce.start_date) - a.day) / 91.3125), 20)) + 1)) AS bin,
         p.stable_id AS pid, lowerUTF8(trimBoth(ce.event_type)) AS et
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN anch a ON a.pid = p.stable_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) IN (lowerUTF8(trimBoth('treatment')), lowerUTF8(trimBoth('surgery')))
)
SELECT bin, et, n FROM (
  SELECT toInt32(bin) AS bin, et, uniqExact(pid) AS n
  FROM (SELECT bin, pid, et FROM denom UNION ALL SELECT bin, pid, et FROM numer)
  GROUP BY bin, et
  UNION ALL SELECT toInt32(0) AS bin, '#anchored' AS et, uniqExact(pid) AS n FROM anch
  UNION ALL SELECT toInt32(0) AS bin, '#observed' AS et, uniqExact(pid) AS n FROM denom
) ORDER BY bin, et

-- view 0 course: eventCourse:@Treatment/3mo · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))),
anch AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS day
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('Treatment'))
  GROUP BY pid
),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) * 30.4375 AS os_day
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'OS_MONTHS'
  GROUP BY pid
),
span AS (
  SELECT p.stable_id AS pid, min(ce.start_date) AS entry,
         max(coalesce(ce.stop_date, ce.start_date)) AS last_ev
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
obs AS (
  SELECT sp.pid AS pid, toFloat64(sp.entry) AS entry,
         greatest(toFloat64(sp.last_ev), coalesce(os.os_day, toFloat64(sp.last_ev))) AS last_day
  FROM span sp LEFT JOIN os ON os.pid = sp.pid
),
denom AS (
  SELECT arrayJoin(range(
    toInt32(greatest(floor((o.entry - a.day) / 91.3125), -4)),
    toInt32(least(floor((o.last_day - a.day) / 91.3125), 20)) + 1)) AS bin, o.pid AS pid, '' AS et
  FROM obs o JOIN anch a ON a.pid = o.pid
),
numer AS (
  SELECT arrayJoin(range(
    toInt32(greatest(floor((ce.start_date - a.day) / 91.3125), -4)),
    toInt32(least(floor((coalesce(ce.stop_date, ce.start_date) - a.day) / 91.3125), 20)) + 1)) AS bin,
         p.stable_id AS pid, lowerUTF8(trimBoth(ce.event_type)) AS et
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  JOIN anch a ON a.pid = p.stable_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
    AND lowerUTF8(trimBoth(ce.event_type)) IN (lowerUTF8(trimBoth('treatment')), lowerUTF8(trimBoth('surgery')))
)
SELECT bin, et, n FROM (
  SELECT toInt32(bin) AS bin, et, uniqExact(pid) AS n
  FROM (SELECT bin, pid, et FROM denom UNION ALL SELECT bin, pid, et FROM numer)
  GROUP BY bin, et
  UNION ALL SELECT toInt32(0) AS bin, '#anchored' AS et, uniqExact(pid) AS n FROM anch
  UNION ALL SELECT toInt32(0) AS bin, '#observed' AS et, uniqExact(pid) AS n FROM denom
) ORDER BY bin, et

-- view 0 course: timelineSpan · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))
SELECT ce.event_type AS et,
       uniqExact(p.stable_id) AS pts,
       count() AS events,
       uniqExact(ce.start_date) AS days,
       min(ce.start_date) AS first_day,
       max(ce.start_date) AS last_day,
       countIf(ce.stop_date IS NOT NULL AND ce.stop_date != ce.start_date) AS interval_events
FROM snapshot_db.clinical_event ce
JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
WHERE cs.cancer_study_identifier = 'msk_chord_2024'
  AND p.stable_id IN (SELECT pid FROM cohort)
GROUP BY et ORDER BY pts DESC
