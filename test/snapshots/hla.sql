-- cohort melanoma on checkpoint blockade
-- skcm_dfci_2015
SELECT replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') AS pid, replaceOne(sample_unique_id, 'skcm_dfci_2015_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'skcm_dfci_2015'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- skcm_mskcc_2014
SELECT replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') AS pid, replaceOne(sample_unique_id, 'skcm_mskcc_2014_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'skcm_mskcc_2014'

-- combined at the analysis layer: each study is evaluated separately against its own
-- instance and the counts are ADDED; patient and sample overlap across studies is not deduplicated.

-- mel_ucla_2016
SELECT replaceOne(patient_unique_id, 'mel_ucla_2016_', '') AS pid, replaceOne(sample_unique_id, 'mel_ucla_2016_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'mel_ucla_2016'

-- view 0 hla: hla:rows:melanoma on checkpoint blockade · mel_ucla_2016
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'mel_ucla_2016_', '') AS pid, replaceOne(sample_unique_id, 'mel_ucla_2016_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'mel_ucla_2016'),
gt AS (
  SELECT pid, [if(anyIf(v, k IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES')) != '', anyIf(v, k IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_A', 'HLA-A')))[1]),
    if(anyIf(v, k IN ('HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES')) != '', anyIf(v, k IN ('HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_A', 'HLA-A')))[2]),
    if(anyIf(v, k IN ('HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES')) != '', anyIf(v, k IN ('HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_B', 'HLA-B')))[1]),
    if(anyIf(v, k IN ('HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES')) != '', anyIf(v, k IN ('HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_B', 'HLA-B')))[2]),
    if(anyIf(v, k IN ('HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES')) != '', anyIf(v, k IN ('HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_C', 'HLA-C')))[1]),
    if(anyIf(v, k IN ('HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES')) != '', anyIf(v, k IN ('HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_C', 'HLA-C')))[2])] AS raw
  FROM (SELECT replaceOne(patient_unique_id, 'mel_ucla_2016_', '') AS pid, attribute_name AS k, trimBoth(attribute_value) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'mel_ucla_2016' AND attribute_name IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES', 'HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES', 'HLA_A', 'HLA-A', 'HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES', 'HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES', 'HLA_B', 'HLA-B', 'HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES', 'HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES', 'HLA_C', 'HLA-C') AND trimBoth(attribute_value) != ''
      AND (type = 'sample' AND replaceOne(sample_unique_id, 'mel_ucla_2016_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'mel_ucla_2016_', '') IN (SELECT pid FROM cohort)))
  GROUP BY pid
),
keys AS (
  SELECT pid, arrayMap(x -> if(x = '', '', arrayStringConcat(arraySlice(if(match(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), '[_:]'), splitByRegexp('[_:]', replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', '')), [substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 1, 2), substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 3)]), 1, 2), ':')), raw) AS k,
         arrayMin(arrayMap(x -> if(x = '', 99, length(if(match(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), '[_:]'), splitByRegexp('[_:]', replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', '')), [substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 1, 2), substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 3)]))), raw)) AS nf0
  FROM gt
),
hom AS (SELECT pid, if(k[1] = '' OR k[2] = '', NULL, toUInt8(k[1] = k[2])) AS hA, if(k[3] = '' OR k[4] = '', NULL, toUInt8(k[3] = k[4])) AS hB, if(k[5] = '' OR k[6] = '', NULL, toUInt8(k[5] = k[6])) AS hC, toNullable(nf0) AS nf FROM keys),
loh AS (
  SELECT replaceOne(patient_unique_id, 'mel_ucla_2016_', '') AS pid, toNullable(max(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Loss')), lowerUTF8(trimBoth('Yes')), lowerUTF8(trimBoth('LOH')), lowerUTF8(trimBoth('True'))))) AS loss
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'mel_ucla_2016' AND attribute_name IN ('HLA_A1_LOH', 'HLA_A2_LOH', 'HLA_B1_LOH', 'HLA_B2_LOH', 'HLA_C1_LOH', 'HLA_C2_LOH', 'HLA_LOH') AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'mel_ucla_2016_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'mel_ucla_2016_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
),
os AS (
  SELECT replaceOne(patient_unique_id, 'mel_ucla_2016_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'mel_ucla_2016' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'mel_ucla_2016_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT hom.hA AS hA, hom.hB AS hB, hom.hC AS hC, hom.nf AS nf, loh.loss AS loss,
       if(os.months >= 0, os.months, NULL) AS m, if(os.status LIKE '1%', 1, 0) AS ev
FROM (SELECT DISTINCT pid FROM cohort) c LEFT JOIN hom ON hom.pid = c.pid LEFT JOIN loh ON loh.pid = c.pid LEFT JOIN os ON os.pid = c.pid

-- view 0 hla: hla:rows:melanoma on checkpoint blockade · skcm_dfci_2015
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') AS pid, replaceOne(sample_unique_id, 'skcm_dfci_2015_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'skcm_dfci_2015'),
gt AS (
  SELECT pid, [if(anyIf(v, k IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES')) != '', anyIf(v, k IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_A', 'HLA-A')))[1]),
    if(anyIf(v, k IN ('HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES')) != '', anyIf(v, k IN ('HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_A', 'HLA-A')))[2]),
    if(anyIf(v, k IN ('HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES')) != '', anyIf(v, k IN ('HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_B', 'HLA-B')))[1]),
    if(anyIf(v, k IN ('HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES')) != '', anyIf(v, k IN ('HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_B', 'HLA-B')))[2]),
    if(anyIf(v, k IN ('HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES')) != '', anyIf(v, k IN ('HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_C', 'HLA-C')))[1]),
    if(anyIf(v, k IN ('HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES')) != '', anyIf(v, k IN ('HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_C', 'HLA-C')))[2])] AS raw
  FROM (SELECT replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') AS pid, attribute_name AS k, trimBoth(attribute_value) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'skcm_dfci_2015' AND attribute_name IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES', 'HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES', 'HLA_A', 'HLA-A', 'HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES', 'HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES', 'HLA_B', 'HLA-B', 'HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES', 'HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES', 'HLA_C', 'HLA-C') AND trimBoth(attribute_value) != ''
      AND (type = 'sample' AND replaceOne(sample_unique_id, 'skcm_dfci_2015_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') IN (SELECT pid FROM cohort)))
  GROUP BY pid
),
keys AS (
  SELECT pid, arrayMap(x -> if(x = '', '', arrayStringConcat(arraySlice(if(match(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), '[_:]'), splitByRegexp('[_:]', replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', '')), [substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 1, 2), substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 3)]), 1, 2), ':')), raw) AS k,
         arrayMin(arrayMap(x -> if(x = '', 99, length(if(match(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), '[_:]'), splitByRegexp('[_:]', replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', '')), [substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 1, 2), substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 3)]))), raw)) AS nf0
  FROM gt
),
hom AS (SELECT pid, if(k[1] = '' OR k[2] = '', NULL, toUInt8(k[1] = k[2])) AS hA, if(k[3] = '' OR k[4] = '', NULL, toUInt8(k[3] = k[4])) AS hB, if(k[5] = '' OR k[6] = '', NULL, toUInt8(k[5] = k[6])) AS hC, toNullable(nf0) AS nf FROM keys),
loh AS (
  SELECT replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') AS pid, toNullable(max(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Loss')), lowerUTF8(trimBoth('Yes')), lowerUTF8(trimBoth('LOH')), lowerUTF8(trimBoth('True'))))) AS loss
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'skcm_dfci_2015' AND attribute_name IN ('HLA_A1_LOH', 'HLA_A2_LOH', 'HLA_B1_LOH', 'HLA_B2_LOH', 'HLA_C1_LOH', 'HLA_C2_LOH', 'HLA_LOH') AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'skcm_dfci_2015_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
),
os AS (
  SELECT replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'skcm_dfci_2015' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'skcm_dfci_2015_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT hom.hA AS hA, hom.hB AS hB, hom.hC AS hC, hom.nf AS nf, loh.loss AS loss,
       if(os.months >= 0, os.months, NULL) AS m, if(os.status LIKE '1%', 1, 0) AS ev
FROM (SELECT DISTINCT pid FROM cohort) c LEFT JOIN hom ON hom.pid = c.pid LEFT JOIN loh ON loh.pid = c.pid LEFT JOIN os ON os.pid = c.pid

-- view 0 hla: hla:rows:melanoma on checkpoint blockade · skcm_mskcc_2014
WITH cohort AS (SELECT replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') AS pid, replaceOne(sample_unique_id, 'skcm_mskcc_2014_', '') AS sid FROM snapshot_db.sample_derived
  WHERE cancer_study_identifier = 'skcm_mskcc_2014'),
gt AS (
  SELECT pid, [if(anyIf(v, k IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES')) != '', anyIf(v, k IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_A', 'HLA-A')))[1]),
    if(anyIf(v, k IN ('HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES')) != '', anyIf(v, k IN ('HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_A', 'HLA-A')))[2]),
    if(anyIf(v, k IN ('HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES')) != '', anyIf(v, k IN ('HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_B', 'HLA-B')))[1]),
    if(anyIf(v, k IN ('HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES')) != '', anyIf(v, k IN ('HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_B', 'HLA-B')))[2]),
    if(anyIf(v, k IN ('HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES')) != '', anyIf(v, k IN ('HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_C', 'HLA-C')))[1]),
    if(anyIf(v, k IN ('HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES')) != '', anyIf(v, k IN ('HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES')), splitByRegexp('\\s*[/,;]\\s*', anyIf(v, k IN ('HLA_C', 'HLA-C')))[2])] AS raw
  FROM (SELECT replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') AS pid, attribute_name AS k, trimBoth(attribute_value) AS v FROM snapshot_db.clinical_data_derived
    WHERE cancer_study_identifier = 'skcm_mskcc_2014' AND attribute_name IN ('HLA-A1', 'HLA_A1', 'HLA_A1_ALLELE', 'HLA_A1_ALLELES', 'HLA-A2', 'HLA_A2', 'HLA_A2_ALLELE', 'HLA_A2_ALLELES', 'HLA_A', 'HLA-A', 'HLA-B1', 'HLA_B1', 'HLA_B1_ALLELE', 'HLA_B1_ALLELES', 'HLA-B2', 'HLA_B2', 'HLA_B2_ALLELE', 'HLA_B2_ALLELES', 'HLA_B', 'HLA-B', 'HLA-C1', 'HLA_C1', 'HLA_C1_ALLELE', 'HLA_C1_ALLELES', 'HLA-C2', 'HLA_C2', 'HLA_C2_ALLELE', 'HLA_C2_ALLELES', 'HLA_C', 'HLA-C') AND trimBoth(attribute_value) != ''
      AND (type = 'sample' AND replaceOne(sample_unique_id, 'skcm_mskcc_2014_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') IN (SELECT pid FROM cohort)))
  GROUP BY pid
),
keys AS (
  SELECT pid, arrayMap(x -> if(x = '', '', arrayStringConcat(arraySlice(if(match(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), '[_:]'), splitByRegexp('[_:]', replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', '')), [substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 1, 2), substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 3)]), 1, 2), ':')), raw) AS k,
         arrayMin(arrayMap(x -> if(x = '', 99, length(if(match(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), '[_:]'), splitByRegexp('[_:]', replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', '')), [substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 1, 2), substring(replaceRegexpOne(lowerUTF8(x), '^(hla[-_]?)?[abc][*_]?', ''), 3)]))), raw)) AS nf0
  FROM gt
),
hom AS (SELECT pid, if(k[1] = '' OR k[2] = '', NULL, toUInt8(k[1] = k[2])) AS hA, if(k[3] = '' OR k[4] = '', NULL, toUInt8(k[3] = k[4])) AS hB, if(k[5] = '' OR k[6] = '', NULL, toUInt8(k[5] = k[6])) AS hC, toNullable(nf0) AS nf FROM keys),
loh AS (
  SELECT replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') AS pid, toNullable(max(lowerUTF8(trimBoth(attribute_value)) IN (lowerUTF8(trimBoth('Loss')), lowerUTF8(trimBoth('Yes')), lowerUTF8(trimBoth('LOH')), lowerUTF8(trimBoth('True'))))) AS loss
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'skcm_mskcc_2014' AND attribute_name IN ('HLA_A1_LOH', 'HLA_A2_LOH', 'HLA_B1_LOH', 'HLA_B2_LOH', 'HLA_C1_LOH', 'HLA_C2_LOH', 'HLA_LOH') AND trimBoth(attribute_value) != ''
    AND (type = 'sample' AND replaceOne(sample_unique_id, 'skcm_mskcc_2014_', '') IN (SELECT sid FROM cohort) OR type = 'patient' AND replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') IN (SELECT pid FROM cohort))
  GROUP BY pid
),
os AS (
  SELECT replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') AS pid,
         if(isFinite(ifNull(toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), nan)), toFloat64OrNull(anyIf(attribute_value, attribute_name = 'OS_MONTHS')), NULL) AS months,
         anyIf(attribute_value, attribute_name = 'OS_STATUS') AS status
  FROM snapshot_db.clinical_data_derived
  WHERE cancer_study_identifier = 'skcm_mskcc_2014' AND type = 'patient' AND attribute_name IN ('OS_MONTHS', 'OS_STATUS')
    AND replaceOne(patient_unique_id, 'skcm_mskcc_2014_', '') IN (SELECT pid FROM cohort)
  GROUP BY pid
)
SELECT hom.hA AS hA, hom.hB AS hB, hom.hC AS hC, hom.nf AS nf, loh.loss AS loss,
       if(os.months >= 0, os.months, NULL) AS m, if(os.status LIKE '1%', 1, 0) AS ev
FROM (SELECT DISTINCT pid FROM cohort) c LEFT JOIN hom ON hom.pid = c.pid LEFT JOIN loh ON loh.pid = c.pid LEFT JOIN os ON os.pid = c.pid
