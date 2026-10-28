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

-- view 0 sequence: sequenceKeys · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation'))))
SELECT lowerUTF8(trimBoth(d.key)) AS k, arraySort((x) -> (-x.2, x.1), arrayMap((v) -> (v, countEqual(groupArray(trimBoth(d.key)), v)), groupUniqArray(trimBoth(d.key))))[1].1 AS label,
       uniqExact(p.stable_id) AS pts, uniqExact(lowerUTF8(trimBoth(d.value))) AS values
FROM snapshot_db.clinical_event ce
JOIN snapshot_db.clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id
JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
WHERE cs.cancer_study_identifier = 'msk_chord_2024'
  AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('treatment'))
  AND p.stable_id IN (SELECT pid FROM cohort)
GROUP BY k ORDER BY pts DESC, k LIMIT 25

-- view 0 sequence: treatmentSequence:SUBTYPE/gap90 · msk_chord_2024
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
txAll AS (
  SELECT ce.clinical_event_id AS eid, ce.patient_id AS patient_id, p.stable_id AS pid,
         ce.start_date AS s, coalesce(ce.stop_date, ce.start_date) AS e,
         coalesce(cl.cls, '') AS cls, coalesce(cl.cls_raw, '') AS cls_raw
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  LEFT JOIN (
    SELECT clinical_event_id, argMin(lowerUTF8(trimBoth(value)), (lowerUTF8(trimBoth(key)) != 'subtype', lowerUTF8(trimBoth(value)))) AS cls,
           argMin(trimBoth(value), (lowerUTF8(trimBoth(key)) != 'subtype', lowerUTF8(trimBoth(value)))) AS cls_raw
    FROM snapshot_db.clinical_event_data
    WHERE lowerUTF8(trimBoth(key)) IN (lowerUTF8(trimBoth('subtype')), lowerUTF8(trimBoth('treatment_type'))) AND lowerUTF8(trimBoth(value)) != ''
      AND clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_derived
        WHERE cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(event_type)) = lowerUTF8(trimBoth('treatment')))
    GROUP BY clinical_event_id
  ) cl ON cl.clinical_event_id = ce.clinical_event_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('treatment'))
    AND p.stable_id IN (SELECT pid FROM cohort)
),
txLabelled AS (
  SELECT t.eid AS eid, t.patient_id AS patient_id, t.pid AS pid, t.s AS s, t.e AS e, t.cls AS cls,
         t.cls AS lk, t.cls_raw AS lraw
  FROM txAll t
  WHERE t.cls IN (lowerUTF8(trimBoth('chemo')), lowerUTF8(trimBoth('chemotherapy')), lowerUTF8(trimBoth('immuno')), lowerUTF8(trimBoth('immunotherapy')), lowerUTF8(trimBoth('immunotherapy (including vaccines)')), lowerUTF8(trimBoth('vaccine')), lowerUTF8(trimBoth('targeted')), lowerUTF8(trimBoth('targeted therapy')), lowerUTF8(trimBoth('targeted molecular therapy')), lowerUTF8(trimBoth('targeted antibody therapy')), lowerUTF8(trimBoth('hormone')), lowerUTF8(trimBoth('hormone therapy')), lowerUTF8(trimBoth('hormonal therapy')), lowerUTF8(trimBoth('biologic')), lowerUTF8(trimBoth('investigational')), lowerUTF8(trimBoth('systemic therapy')), lowerUTF8(trimBoth('medical therapy')), lowerUTF8(trimBoth('pharmaceutical therapy, nos')))
),
spell AS (
  SELECT lk, arraySort((x) -> (-x.2, x.1), groupArray((lraw, c)))[1].1 AS lbl FROM (
    SELECT lk, lraw, count() AS c FROM txLabelled WHERE lk != '' GROUP BY lk, lraw
  ) GROUP BY lk
),
tx AS (
  SELECT x.eid AS eid, x.patient_id AS patient_id, x.pid AS pid, x.s AS s, x.e AS e, x.cls AS cls,
         if(x.lk = '', '', sp.lbl) AS lbl
  FROM txLabelled x LEFT JOIN spell sp ON sp.lk = x.lk
),
flagged AS (
  SELECT *, max(toNullable(e)) OVER (PARTITION BY patient_id
    ORDER BY s, e, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pms
  FROM tx
),
numbered AS (
  SELECT *, sum(if(pms IS NULL OR s > pms + 90, 1, 0)) OVER (
    PARTITION BY patient_id ORDER BY s, e, eid ROWS UNBOUNDED PRECEDING) AS line_no
  FROM flagged
),
lines AS (
  SELECT patient_id, any(pid) AS pid, line_no, min(s) AS ls, max(e) AS le,
         if(countIf(lbl != '') = 0, '(no class)',
            arrayStringConcat(arraySort(groupUniqArrayIf(lbl, lbl != '')), ' + ')) AS combo
  FROM numbered GROUP BY patient_id, line_no
),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) * 30.4375 AS os_day
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'OS_MONTHS'
  GROUP BY pid
),
seen AS (
  SELECT p.stable_id AS pid, max(coalesce(ce.stop_date, ce.start_date)) AS max_ev
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
obs AS (
  SELECT sn.pid AS pid,
         greatest(toFloat64(sn.max_ev), coalesce(os.os_day, toFloat64(sn.max_ev))) AS last_seen
  FROM seen sn LEFT JOIN os ON os.pid = sn.pid
),
seq AS (
  SELECT pid, line_no, combo, le AS line_end,
         leadInFrame(combo) OVER (PARTITION BY pid ORDER BY line_no
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS nxt
  FROM lines
),
fated AS (
  SELECT sq2.line_no AS line_no, sq2.combo AS combo, sq2.pid AS pid,
         coalesce(sq2.nxt, '') AS nxt,
         if(coalesce(sq2.nxt, '') != '', 0,
            if(coalesce(o.last_seen, toFloat64(sq2.line_end)) - sq2.line_end >= 90, 1, 2)) AS fate
  FROM seq sq2 LEFT JOIN obs o ON o.pid = sq2.pid
)
SELECT step, a, b, fate, n FROM (
  SELECT toUInt32(line_no) AS step, toString(combo) AS a, toString(nxt) AS b, toUInt8(fate) AS fate, toUInt64(uniqExact(pid)) AS n
  FROM fated WHERE line_no <= 3
  GROUP BY step, a, b, fate ORDER BY n DESC, step, a, b, fate LIMIT 2000
)
UNION ALL
SELECT toUInt32(0) AS step, toString(if(cls = '', '(no class)', any(cls_raw))) AS a,
       toString(if(cls IN (lowerUTF8(trimBoth('chemo')), lowerUTF8(trimBoth('chemotherapy')), lowerUTF8(trimBoth('immuno')), lowerUTF8(trimBoth('immunotherapy')), lowerUTF8(trimBoth('immunotherapy (including vaccines)')), lowerUTF8(trimBoth('vaccine')), lowerUTF8(trimBoth('targeted')), lowerUTF8(trimBoth('targeted therapy')), lowerUTF8(trimBoth('targeted molecular therapy')), lowerUTF8(trimBoth('targeted antibody therapy')), lowerUTF8(trimBoth('hormone')), lowerUTF8(trimBoth('hormone therapy')), lowerUTF8(trimBoth('hormonal therapy')), lowerUTF8(trimBoth('biologic')), lowerUTF8(trimBoth('investigational')), lowerUTF8(trimBoth('systemic therapy')), lowerUTF8(trimBoth('medical therapy')), lowerUTF8(trimBoth('pharmaceutical therapy, nos'))), '#excluded by the document', '#not a line class')) AS b,
       toUInt8(0) AS fate, toUInt64(count()) AS n
FROM txAll WHERE eid NOT IN (SELECT eid FROM txLabelled)
GROUP BY cls, b

-- view 0 sequence: treatmentSequence:SUBTYPE/gap90 · msk_chord_2024
WITH cohort AS ((SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid, replaceOne(sample_unique_id, 'msk_chord_2024_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'msk_chord_2024'
    AND replaceOne(sample_unique_id, 'msk_chord_2024_', '') IN ((SELECT DISTINCT replaceOne(g.sample_unique_id, 'msk_chord_2024_', '') AS pid
  FROM snapshot_db.genomic_event_derived g
  WHERE g.cancer_study_identifier = 'msk_chord_2024'
    AND g.hugo_gene_symbol = 'TP53'
    AND g.mutation_status != 'UNCALLED' AND g.variant_type = 'mutation')))),
txAll AS (
  SELECT ce.clinical_event_id AS eid, ce.patient_id AS patient_id, p.stable_id AS pid,
         ce.start_date AS s, coalesce(ce.stop_date, ce.start_date) AS e,
         coalesce(cl.cls, '') AS cls, coalesce(cl.cls_raw, '') AS cls_raw
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  LEFT JOIN (
    SELECT clinical_event_id, argMin(lowerUTF8(trimBoth(value)), (lowerUTF8(trimBoth(key)) != 'subtype', lowerUTF8(trimBoth(value)))) AS cls,
           argMin(trimBoth(value), (lowerUTF8(trimBoth(key)) != 'subtype', lowerUTF8(trimBoth(value)))) AS cls_raw
    FROM snapshot_db.clinical_event_data
    WHERE lowerUTF8(trimBoth(key)) IN (lowerUTF8(trimBoth('subtype')), lowerUTF8(trimBoth('treatment_type'))) AND lowerUTF8(trimBoth(value)) != ''
      AND clinical_event_id IN (SELECT clinical_event_id FROM snapshot_db.clinical_event_derived
        WHERE cancer_study_identifier = 'msk_chord_2024' AND lowerUTF8(trimBoth(event_type)) = lowerUTF8(trimBoth('treatment')))
    GROUP BY clinical_event_id
  ) cl ON cl.clinical_event_id = ce.clinical_event_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND lowerUTF8(trimBoth(ce.event_type)) = lowerUTF8(trimBoth('treatment'))
    AND p.stable_id IN (SELECT pid FROM cohort)
),
txLabelled AS (
  SELECT t.eid AS eid, t.patient_id AS patient_id, t.pid AS pid, t.s AS s, t.e AS e, t.cls AS cls,
         t.cls AS lk, t.cls_raw AS lraw
  FROM txAll t
  WHERE t.cls IN (lowerUTF8(trimBoth('chemo')), lowerUTF8(trimBoth('chemotherapy')), lowerUTF8(trimBoth('immuno')), lowerUTF8(trimBoth('immunotherapy')), lowerUTF8(trimBoth('immunotherapy (including vaccines)')), lowerUTF8(trimBoth('vaccine')), lowerUTF8(trimBoth('targeted')), lowerUTF8(trimBoth('targeted therapy')), lowerUTF8(trimBoth('targeted molecular therapy')), lowerUTF8(trimBoth('targeted antibody therapy')), lowerUTF8(trimBoth('hormone')), lowerUTF8(trimBoth('hormone therapy')), lowerUTF8(trimBoth('hormonal therapy')), lowerUTF8(trimBoth('biologic')), lowerUTF8(trimBoth('investigational')), lowerUTF8(trimBoth('systemic therapy')), lowerUTF8(trimBoth('medical therapy')), lowerUTF8(trimBoth('pharmaceutical therapy, nos')))
),
spell AS (
  SELECT lk, arraySort((x) -> (-x.2, x.1), groupArray((lraw, c)))[1].1 AS lbl FROM (
    SELECT lk, lraw, count() AS c FROM txLabelled WHERE lk != '' GROUP BY lk, lraw
  ) GROUP BY lk
),
tx AS (
  SELECT x.eid AS eid, x.patient_id AS patient_id, x.pid AS pid, x.s AS s, x.e AS e, x.cls AS cls,
         if(x.lk = '', '', sp.lbl) AS lbl
  FROM txLabelled x LEFT JOIN spell sp ON sp.lk = x.lk
),
flagged AS (
  SELECT *, max(toNullable(e)) OVER (PARTITION BY patient_id
    ORDER BY s, e, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pms
  FROM tx
),
numbered AS (
  SELECT *, sum(if(pms IS NULL OR s > pms + 90, 1, 0)) OVER (
    PARTITION BY patient_id ORDER BY s, e, eid ROWS UNBOUNDED PRECEDING) AS line_no
  FROM flagged
),
lines AS (
  SELECT patient_id, any(pid) AS pid, line_no, min(s) AS ls, max(e) AS le,
         if(countIf(lbl != '') = 0, '(no class)',
            arrayStringConcat(arraySort(groupUniqArrayIf(lbl, lbl != '')), ' + ')) AS combo
  FROM numbered GROUP BY patient_id, line_no
),
os AS (
  SELECT replaceOne(patient_unique_id, 'msk_chord_2024_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) * 30.4375 AS os_day
  FROM (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan'))
  WHERE cancer_study_identifier = 'msk_chord_2024' AND type = 'patient'
    AND attribute_name = 'OS_MONTHS'
  GROUP BY pid
),
seen AS (
  SELECT p.stable_id AS pid, max(coalesce(ce.stop_date, ce.start_date)) AS max_ev
  FROM snapshot_db.clinical_event ce
  JOIN snapshot_db.patient p ON p.internal_id = ce.patient_id
  JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'msk_chord_2024'
    AND p.stable_id IN (SELECT pid FROM cohort)
  GROUP BY pid
),
obs AS (
  SELECT sn.pid AS pid,
         greatest(toFloat64(sn.max_ev), coalesce(os.os_day, toFloat64(sn.max_ev))) AS last_seen
  FROM seen sn LEFT JOIN os ON os.pid = sn.pid
),
seq AS (
  SELECT pid, line_no, combo, le AS line_end,
         leadInFrame(combo) OVER (PARTITION BY pid ORDER BY line_no
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS nxt
  FROM lines
),
fated AS (
  SELECT sq2.line_no AS line_no, sq2.combo AS combo, sq2.pid AS pid,
         coalesce(sq2.nxt, '') AS nxt,
         if(coalesce(sq2.nxt, '') != '', 0,
            if(coalesce(o.last_seen, toFloat64(sq2.line_end)) - sq2.line_end >= 90, 1, 2)) AS fate
  FROM seq sq2 LEFT JOIN obs o ON o.pid = sq2.pid
)
SELECT step, a, b, fate, n FROM (
  SELECT toUInt32(line_no) AS step, toString(combo) AS a, toString(nxt) AS b, toUInt8(fate) AS fate, toUInt64(uniqExact(pid)) AS n
  FROM fated WHERE line_no <= 3
  GROUP BY step, a, b, fate ORDER BY n DESC, step, a, b, fate LIMIT 2000
)
UNION ALL
SELECT toUInt32(0) AS step, toString(if(cls = '', '(no class)', any(cls_raw))) AS a,
       toString(if(cls IN (lowerUTF8(trimBoth('chemo')), lowerUTF8(trimBoth('chemotherapy')), lowerUTF8(trimBoth('immuno')), lowerUTF8(trimBoth('immunotherapy')), lowerUTF8(trimBoth('immunotherapy (including vaccines)')), lowerUTF8(trimBoth('vaccine')), lowerUTF8(trimBoth('targeted')), lowerUTF8(trimBoth('targeted therapy')), lowerUTF8(trimBoth('targeted molecular therapy')), lowerUTF8(trimBoth('targeted antibody therapy')), lowerUTF8(trimBoth('hormone')), lowerUTF8(trimBoth('hormone therapy')), lowerUTF8(trimBoth('hormonal therapy')), lowerUTF8(trimBoth('biologic')), lowerUTF8(trimBoth('investigational')), lowerUTF8(trimBoth('systemic therapy')), lowerUTF8(trimBoth('medical therapy')), lowerUTF8(trimBoth('pharmaceutical therapy, nos'))), '#excluded by the document', '#not a line class')) AS b,
       toUInt8(0) AS fate, toUInt64(count()) AS n
FROM txAll WHERE eid NOT IN (SELECT eid FROM txLabelled)
GROUP BY cls, b
