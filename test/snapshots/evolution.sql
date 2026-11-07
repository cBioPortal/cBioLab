-- cohort Glioma
-- glioma_msk_2018
SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'

-- view 0 evolution: evolution:counts · glioma_msk_2018
WITH c0 AS (SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, ''))) AS n, uniqExactIf(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, '')), ifNull(tumorAltCount, 0) > 0 AND tumorRefCount IS NOT NULL AND tumorAltCount + tumorRefCount > 0) AS v
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'glioma_msk_2018_') AND studyId = 'glioma_msk_2018' AND patientId IN (SELECT pid FROM c0) AND ifNull(mutationType, '') != 'Fusion' AND molecularProfileId NOT LIKE '%uncalled%'
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(mu.v, 0)) AS withVaf
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid) WHERE samples >= 2 AND withVaf > 0
)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 evolution: evolution:mutations:counts · glioma_msk_2018
WITH s AS (SELECT replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND patient_unique_id = 'glioma_msk_2018_IM-GBM-28'),
pn AS (SELECT replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid, any(gene_panel_id) AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND alteration_type = 'MUTATION_EXTENDED' AND sample_unique_id IN (SELECT concat('glioma_msk_2018_', sid) FROM s) GROUP BY sid),
m AS (SELECT sampleId AS sid, concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, '')) AS k, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr,
         startPosition AS start, endPosition AS end, referenceAllele AS ref, tumorSeqAllele AS var, proteinPosStart AS codon,
         tumorAltCount AS ac, tumorRefCount AS rc, toUInt8(molecularProfileId NOT LIKE '%uncalled%') AS called
  FROM snapshot_db.mutation_derived WHERE startsWith(molecularProfileId, 'glioma_msk_2018_') AND studyId = 'glioma_msk_2018' AND patientId = 'IM-GBM-28' AND ifNull(mutationType, '') != 'Fusion'),
g AS (SELECT k, any(gene) AS gene, any(proteinChange) AS proteinChange, any(mutationType) AS mutationType, any(variantType) AS variantType,
         any(chr) AS chr, any(start) AS start, any(end) AS end, any(ref) AS ref, any(var) AS var, min(codon) AS pos FROM m WHERE called = 1 GROUP BY k),
mm AS (SELECT k, sid, toUInt8(1) AS hit, max(called) AS cl, tupleElement(argMax(tuple(ac, rc), called), 1) AS mac, tupleElement(argMax(tuple(ac, rc), called), 2) AS mrc
  FROM m GROUP BY k, sid),
pc AS (SELECT pn.sid AS sid, pg.gene AS gene FROM pn JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pn.panel WHERE pg.gene IN (SELECT gene FROM g)),
gs AS (SELECT g.k AS k, g.gene AS gene, s.sid AS sid, if(indexOf(['Patient-28-T1', 'Patient-28-T3', 'Patient-28-T2', 'Patient-28-CSF'], s.sid) = 0, 1000000, indexOf(['Patient-28-T1', 'Patient-28-T3', 'Patient-28-T2', 'Patient-28-CSF'], s.sid)) AS o FROM g CROSS JOIN s),
cell AS (SELECT gs.k AS k, gs.sid AS sid, gs.o AS o, ifNull(mm.hit, 0) AS hit, ifNull(mm.cl, 0) AS cl, mm.mac AS ac, mm.mrc AS rc, ifNull(pc.sid, '') != '' AS cov
  FROM gs LEFT JOIN mm ON mm.k = gs.k AND mm.sid = gs.sid LEFT JOIN pc ON pc.sid = gs.sid AND pc.gene = gs.gene),
st AS (SELECT k, sid, o, ac, rc, ac IS NOT NULL AND rc IS NOT NULL AND ac + rc > 0 AS rd,
         multiIf(hit = 1 AND cl = 1, if(rd, 'called', 'noVaf'), hit = 1 AND rd AND ac > 0, 'uncalled', hit = 1 OR cov, 'absent', 'np') AS status,
         if(hit = 1 AND rd, ac / (ac + rc), NULL) AS f FROM cell),
a AS (SELECT k, arraySort(x -> x.1, groupArray(tuple(o, sid, status, f, ac, rc))) AS cells FROM st GROUP BY k),
rows AS (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, 'IM-GBM-28' AS patient,
         arrayFirst(x -> x.3 IN ('called', 'noVaf'), a.cells).2 AS sid, arrayFirst(x -> x.3 IN ('called', 'noVaf'), a.cells).1 AS so,
         arrayStringConcat(arrayMap(x -> x.2, arrayFilter(x -> x.3 IN ('called', 'noVaf'), a.cells)), ', ') AS samples,
         g.gene AS gene, g.proteinChange AS proteinChange, g.mutationType AS mutationType,
         arrayStringConcat(arrayMap(x -> concat(toString(x.1), ': ', multiIf(x.3 = 'called', toDecimalString(x.4, 2), x.3 = 'noVaf', 'called, no reads',
           x.3 = 'uncalled', concat(toDecimalString(x.4, 2), ' uncalled'), x.3 = 'absent', 'not found', 'not profiled')), a.cells), ' · ') AS vafs,
         if(arrayExists(x -> x.3 = 'called', a.cells), arrayMax(arrayMap(x -> ifNull(x.4, 0), arrayFilter(x -> x.3 = 'called', a.cells))), NULL) AS maxVaf,
         length(arrayFilter(x -> x.3 IN ('called', 'noVaf'), a.cells)) AS called,
         g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end, g.ref AS ref, g.var AS var, g.pos AS pos, a.cells AS cells
  FROM a JOIN g ON g.k = a.k)
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 evolution: evolution:mutations:rows · glioma_msk_2018
WITH s AS (SELECT replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND patient_unique_id = 'glioma_msk_2018_IM-GBM-28'),
pn AS (SELECT replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid, any(gene_panel_id) AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND alteration_type = 'MUTATION_EXTENDED' AND sample_unique_id IN (SELECT concat('glioma_msk_2018_', sid) FROM s) GROUP BY sid),
m AS (SELECT sampleId AS sid, concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, '')) AS k, `GENE.hugoGeneSymbol` AS gene, proteinChange, mutationType, variantType, chr,
         startPosition AS start, endPosition AS end, referenceAllele AS ref, tumorSeqAllele AS var, proteinPosStart AS codon,
         tumorAltCount AS ac, tumorRefCount AS rc, toUInt8(molecularProfileId NOT LIKE '%uncalled%') AS called
  FROM snapshot_db.mutation_derived WHERE startsWith(molecularProfileId, 'glioma_msk_2018_') AND studyId = 'glioma_msk_2018' AND patientId = 'IM-GBM-28' AND ifNull(mutationType, '') != 'Fusion'),
g AS (SELECT k, any(gene) AS gene, any(proteinChange) AS proteinChange, any(mutationType) AS mutationType, any(variantType) AS variantType,
         any(chr) AS chr, any(start) AS start, any(end) AS end, any(ref) AS ref, any(var) AS var, min(codon) AS pos FROM m WHERE called = 1 GROUP BY k),
mm AS (SELECT k, sid, toUInt8(1) AS hit, max(called) AS cl, tupleElement(argMax(tuple(ac, rc), called), 1) AS mac, tupleElement(argMax(tuple(ac, rc), called), 2) AS mrc
  FROM m GROUP BY k, sid),
pc AS (SELECT pn.sid AS sid, pg.gene AS gene FROM pn JOIN snapshot_db.gene_panel_to_gene_derived pg ON pg.gene_panel_id = pn.panel WHERE pg.gene IN (SELECT gene FROM g)),
gs AS (SELECT g.k AS k, g.gene AS gene, s.sid AS sid, if(indexOf(['Patient-28-T1', 'Patient-28-T3', 'Patient-28-T2', 'Patient-28-CSF'], s.sid) = 0, 1000000, indexOf(['Patient-28-T1', 'Patient-28-T3', 'Patient-28-T2', 'Patient-28-CSF'], s.sid)) AS o FROM g CROSS JOIN s),
cell AS (SELECT gs.k AS k, gs.sid AS sid, gs.o AS o, ifNull(mm.hit, 0) AS hit, ifNull(mm.cl, 0) AS cl, mm.mac AS ac, mm.mrc AS rc, ifNull(pc.sid, '') != '' AS cov
  FROM gs LEFT JOIN mm ON mm.k = gs.k AND mm.sid = gs.sid LEFT JOIN pc ON pc.sid = gs.sid AND pc.gene = gs.gene),
st AS (SELECT k, sid, o, ac, rc, ac IS NOT NULL AND rc IS NOT NULL AND ac + rc > 0 AS rd,
         multiIf(hit = 1 AND cl = 1, if(rd, 'called', 'noVaf'), hit = 1 AND rd AND ac > 0, 'uncalled', hit = 1 OR cov, 'absent', 'np') AS status,
         if(hit = 1 AND rd, ac / (ac + rc), NULL) AS f FROM cell),
a AS (SELECT k, arraySort(x -> x.1, groupArray(tuple(o, sid, status, f, ac, rc))) AS cells FROM st GROUP BY k),
rows AS (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, 'IM-GBM-28' AS patient,
         arrayFirst(x -> x.3 IN ('called', 'noVaf'), a.cells).2 AS sid, arrayFirst(x -> x.3 IN ('called', 'noVaf'), a.cells).1 AS so,
         arrayStringConcat(arrayMap(x -> x.2, arrayFilter(x -> x.3 IN ('called', 'noVaf'), a.cells)), ', ') AS samples,
         g.gene AS gene, g.proteinChange AS proteinChange, g.mutationType AS mutationType,
         arrayStringConcat(arrayMap(x -> concat(toString(x.1), ': ', multiIf(x.3 = 'called', toDecimalString(x.4, 2), x.3 = 'noVaf', 'called, no reads',
           x.3 = 'uncalled', concat(toDecimalString(x.4, 2), ' uncalled'), x.3 = 'absent', 'not found', 'not profiled')), a.cells), ' · ') AS vafs,
         if(arrayExists(x -> x.3 = 'called', a.cells), arrayMax(arrayMap(x -> ifNull(x.4, 0), arrayFilter(x -> x.3 = 'called', a.cells))), NULL) AS maxVaf,
         length(arrayFilter(x -> x.3 IN ('called', 'noVaf'), a.cells)) AS called,
         g.variantType AS variantType, g.chr AS chr, g.start AS start, g.end AS end, g.ref AS ref, g.var AS var, g.pos AS pos, a.cells AS cells
  FROM a JOIN g ON g.k = a.k)
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY so, maxVaf DESC NULLS LAST, gene, pos ASC NULLS LAST, gene, chr, start, end, ref, var, proteinChange
LIMIT 1000 OFFSET 0

-- view 0 evolution: evolution:rank · glioma_msk_2018
WITH c0 AS (SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, ''))) AS n, uniqExactIf(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, '')), ifNull(tumorAltCount, 0) > 0 AND tumorRefCount IS NOT NULL AND tumorAltCount + tumorRefCount > 0) AS v
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'glioma_msk_2018_') AND studyId = 'glioma_msk_2018' AND patientId IN (SELECT pid FROM c0) AND ifNull(mutationType, '') != 'Fusion' AND molecularProfileId NOT LIKE '%uncalled%'
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(mu.v, 0)) AS withVaf
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid) WHERE samples >= 2 AND withVaf > 0
)
SELECT idx FROM (SELECT study, patient, row_number() OVER (ORDER BY samples DESC, patient, patient, ord) - 1 AS idx FROM rows
WHERE 1)
WHERE study = 'glioma_msk_2018' AND patient = 'IM-GBM-28' LIMIT 1

-- view 0 evolution: evolution:rows · glioma_msk_2018
WITH c0 AS (SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, ''))) AS n, uniqExactIf(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, '')), ifNull(tumorAltCount, 0) > 0 AND tumorRefCount IS NOT NULL AND tumorAltCount + tumorRefCount > 0) AS v
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'glioma_msk_2018_') AND studyId = 'glioma_msk_2018' AND patientId IN (SELECT pid FROM c0) AND ifNull(mutationType, '') != 'Fusion' AND molecularProfileId NOT LIKE '%uncalled%'
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(mu.v, 0)) AS withVaf
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid) WHERE samples >= 2 AND withVaf > 0
)
SELECT cohort, study, patient, sample, samples, mutations, withVaf, count() OVER () AS total FROM rows
WHERE 1
ORDER BY samples DESC, patient, patient, ord
LIMIT 25 OFFSET 0

-- view 0 evolution: evolution:rows · glioma_msk_2018
WITH c0 AS (SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, replaceOne(sample_unique_id, 'glioma_msk_2018_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018'),
sm0 AS (
  SELECT replaceOne(patient_unique_id, 'glioma_msk_2018_', '') AS pid, uniqExact(sample_unique_id) AS n FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND replaceOne(patient_unique_id, 'glioma_msk_2018_', '') IN (SELECT pid FROM c0)
  GROUP BY pid
),
mu0 AS (
  SELECT patientId AS pid, uniqExact(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, ''))) AS n, uniqExactIf(concat(ifNull(`GENE.hugoGeneSymbol`, ''), '|', ifNull(proteinChange, ''), '|', ifNull(chr, ''), '|', toString(ifNull(startPosition, 0)), '|', toString(ifNull(endPosition, 0)), '|', ifNull(referenceAllele, ''), '|', ifNull(tumorSeqAllele, '')), ifNull(tumorAltCount, 0) > 0 AND tumorRefCount IS NOT NULL AND tumorAltCount + tumorRefCount > 0) AS v
  FROM snapshot_db.mutation_derived
  WHERE startsWith(molecularProfileId, 'glioma_msk_2018_') AND studyId = 'glioma_msk_2018' AND patientId IN (SELECT pid FROM c0) AND ifNull(mutationType, '') != 'Fusion' AND molecularProfileId NOT LIKE '%uncalled%'
  GROUP BY pid
),
rows AS (
  SELECT * FROM (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, c.pid AS patient, '' AS sample,
         toUInt64(ifNull(sm.n, 0)) AS samples, toUInt64(ifNull(mu.n, 0)) AS mutations, toUInt64(ifNull(mu.v, 0)) AS withVaf
  FROM (SELECT DISTINCT pid FROM c0) AS c
  LEFT JOIN sm0 AS sm ON sm.pid = c.pid LEFT JOIN mu0 AS mu ON mu.pid = c.pid) WHERE samples >= 2 AND withVaf > 0
)
SELECT cohort, study, patient, sample, samples, mutations, withVaf, count() OVER () AS total FROM rows
WHERE 1
ORDER BY samples DESC, patient, patient, ord
LIMIT 3 OFFSET 0

-- view 0 evolution: evolution:samples:counts · glioma_msk_2018
WITH pn AS (SELECT sample_unique_id, any(gene_panel_id) AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND alteration_type = 'MUTATION_EXTENDED' GROUP BY sample_unique_id),
rows AS (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, 'IM-GBM-28' AS patient,
         replaceOne(s.sample_unique_id, 'glioma_msk_2018_', '') AS sid, ifNull(pn.panel, '') AS panel
  FROM snapshot_db.sample_derived s LEFT JOIN pn ON pn.sample_unique_id = s.sample_unique_id
  WHERE s.cancer_study_identifier = 'glioma_msk_2018' AND s.patient_unique_id = 'glioma_msk_2018_IM-GBM-28')
SELECT cohort, study, countIf(1) AS n, count() AS all FROM rows GROUP BY cohort, study

-- view 0 evolution: evolution:samples:rows · glioma_msk_2018
WITH pn AS (SELECT sample_unique_id, any(gene_panel_id) AS panel FROM snapshot_db.sample_to_gene_panel_derived
  WHERE cancer_study_identifier = 'glioma_msk_2018' AND alteration_type = 'MUTATION_EXTENDED' GROUP BY sample_unique_id),
rows AS (SELECT 'Glioma' AS cohort, 'glioma_msk_2018' AS study, 0 AS ord, 'IM-GBM-28' AS patient,
         replaceOne(s.sample_unique_id, 'glioma_msk_2018_', '') AS sid, ifNull(pn.panel, '') AS panel
  FROM snapshot_db.sample_derived s LEFT JOIN pn ON pn.sample_unique_id = s.sample_unique_id
  WHERE s.cancer_study_identifier = 'glioma_msk_2018' AND s.patient_unique_id = 'glioma_msk_2018_IM-GBM-28')
SELECT *, count() OVER () AS total FROM rows
WHERE 1
ORDER BY sid, sid
LIMIT 1000 OFFSET 0

-- view 0 evolution: timeline:events · glioma_msk_2018
WITH pt AS (
  SELECT p.internal_id FROM snapshot_db.patient p JOIN snapshot_db.cancer_study cs ON cs.cancer_study_id = p.cancer_study_id
  WHERE cs.cancer_study_identifier = 'glioma_msk_2018' AND p.stable_id = 'IM-GBM-28'
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

-- view 0 evolution: timeline:samples · glioma_msk_2018
SELECT replaceOne(s.sample_unique_id, 'glioma_msk_2018_', '') AS id, any(c.attribute_value) AS type
FROM snapshot_db.sample_derived s
LEFT JOIN (SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type
   FROM snapshot_db.clinical_data_derived WHERE lowerUTF8(trimBoth(attribute_value)) NOT IN ('', 'na', 'n/a', 'nan')) c ON c.sample_unique_id = s.sample_unique_id AND c.type = 'sample'
  AND c.cancer_study_identifier = 'glioma_msk_2018' AND c.attribute_name = 'SAMPLE_TYPE'
WHERE s.cancer_study_identifier = 'glioma_msk_2018' AND s.patient_unique_id = 'glioma_msk_2018_IM-GBM-28'
GROUP BY id ORDER BY id
