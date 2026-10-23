// The hla view's SQL: what its runner (run.ts) asks each participant's database for.
// hla: HLA class I genotype and HLA LOH per patient
import { pidOf } from "../../federation-views.ts";
import { sq } from "../../compiler.ts";
import { clinicalTable } from "../../custom-data.ts";
import { clinicalValueFoldSql } from "../../event-names.ts";
import { finiteSql } from "../../sql-number.ts";

export interface HlaRowsOpts {
  /** per locus A, B, C: the attributes that may hold its first allele, its second, or both as one "x/y" value */
  loci: { first: string[]; second: string[]; pair: string[] }[];
  /** allele-name fields compared (1, 2, or 99 for all) */
  fields: number;
  lohAttributes: string[]; lohValues: string[];
  months: string; status: string;
  covariates: string[];
}

/** an allele's name as its fields: hla_a_02_01_01_01, A*02:01 and A0201 all start ["02", "01"] */
const hlaFieldsSql = (x: string) => {
  const y = "replaceRegexpOne(lowerUTF8(" + x + "), '^(hla[-_]?)?[abc][*_]?', '')";
  return "if(match(" + y + ", '[_:]'), splitByRegexp('[_:]', " + y + "), [substring(" + y + ", 1, 2), substring(" + y + ", 3)])";
};

/**
 * One row per patient of the cohort: per locus whether its two alleles match at `fields` fields
 * (hA, hB, hC; NULL when either allele is missing), the fewest fields any allele was typed at (nf),
 * HLA LOH in any sample (loss; NULL when no sample has a call), the endpoint (m, ev) and each
 * covariate as c0, c1, … (the patient's, or the first sample's). Values only: the patient id joins
 * the CTEs and is never returned. Run only through PatientLevelResolver.viewRows.
 */
export function hlaRowsSql(cohortSql: string, study: string, db: string, o: HlaRowsOpts): string {
  const names = [...o.loci.flatMap((l) => [...l.first, ...l.second, ...l.pair]), ...o.lohAttributes, o.months, o.status, ...o.covariates];
  for (const a of names) if (!/^[A-Za-z0-9_:/.-]{1,128}$/.test(a)) throw new Error("bad attribute name '" + String(a).slice(0, 40) + "'");
  const pid = pidOf("patient_unique_id", study);
  const inList = (xs: string[]) => xs.length ? "k IN (" + xs.map(sq).join(", ") + ")" : "0";
  const allele = (l: HlaRowsOpts["loci"][number], i: 1 | 2) => {
    const own = "anyIf(v, " + inList(i === 1 ? l.first : l.second) + ")";
    return "if(" + own + " != '', " + own + ", splitByRegexp('\\\\s*[/,;]\\\\s*', anyIf(v, " + inList(l.pair) + "))[" + i + "])";
  };
  const genoAttrs = o.loci.flatMap((l) => [...l.first, ...l.second, ...l.pair]);
  const fields = Math.max(1, Math.min(99, Math.floor(o.fields)));
  const key = (x: string) => "arrayStringConcat(arraySlice(" + hlaFieldsSql(x) + ", 1, " + fields + "), ':')";
  const homAt = (i: number) => "if(k[" + (2 * i + 1) + "] = '' OR k[" + (2 * i + 2) + "] = '', NULL, toUInt8(k[" + (2 * i + 1) + "] = k[" + (2 * i + 2) + "]))";
  const covs = o.covariates;
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "gt AS (\n" +
    "  SELECT pid, [" + o.loci.flatMap((l) => [allele(l, 1), allele(l, 2)]).join(",\n    ") + "] AS raw\n" +
    "  FROM (SELECT " + pid + " AS pid, attribute_name AS k, trimBoth(attribute_value) AS v FROM " + clinicalTable(db, genoAttrs) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + genoAttrs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "      AND " + pid + " IN (SELECT pid FROM cohort))\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "keys AS (\n" +
    "  SELECT pid, arrayMap(x -> if(x = '', '', " + key("x") + "), raw) AS k,\n" +
    "         arrayMin(arrayMap(x -> if(x = '', 99, length(" + hlaFieldsSql("x") + ")), raw)) AS nf0\n" +
    "  FROM gt\n" +
    "),\n" +
    "hom AS (SELECT pid, " + homAt(0) + " AS hA, " + homAt(1) + " AS hB, " + homAt(2) + " AS hC, toNullable(nf0) AS nf FROM keys),\n" +
    "loh AS (\n" +
    "  SELECT " + pid + " AS pid, toNullable(max(" + clinicalValueFoldSql("attribute_value") + " IN (" + o.lohValues.map((v) => clinicalValueFoldSql(sq(v))).join(", ") + "))) AS loss\n" +
    "  FROM " + clinicalTable(db, o.lohAttributes) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + o.lohAttributes.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         " + finiteSql("anyIf(attribute_value, attribute_name = " + sq(o.months) + ")") + " AS months,\n" +
    "         anyIf(attribute_value, attribute_name = " + sq(o.status) + ") AS status\n" +
    "  FROM " + clinicalTable(db, [o.months, o.status]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type = 'patient' AND attribute_name IN (" + sq(o.months) + ", " + sq(o.status) + ")\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")" +
    (covs.length
      ? ",\ncov AS (\n" +
        "  SELECT " + pid + " AS pid" + covs.map((c, i) => ",\n         toNullable(argMinIf(trimBoth(attribute_value), sample_unique_id, attribute_name = " + sq(c) + ")) AS c" + i).join("") + "\n" +
        "  FROM " + clinicalTable(db, covs) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name IN (" + covs.map(sq).join(", ") + ") AND trimBoth(attribute_value) != ''\n" +
        "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid\n" +
        ")\n"
      : "\n") +
    "SELECT hom.hA AS hA, hom.hB AS hB, hom.hC AS hC, hom.nf AS nf, loh.loss AS loss,\n" +
    "       if(os.months >= 0, os.months, NULL) AS m, if(os.status LIKE '1%', 1, 0) AS ev" + covs.map((_, i) => ", cov.c" + i + " AS c" + i).join("") + "\n" +
    "FROM cohort LEFT JOIN hom ON hom.pid = cohort.pid LEFT JOIN loh ON loh.pid = cohort.pid LEFT JOIN os ON os.pid = cohort.pid" +
    (covs.length ? " LEFT JOIN cov ON cov.pid = cohort.pid" : "")
  );
}

/** the attribute names in a study that mention HLA, with how many values each holds */
export function hlaAttributesSql(_cohortSql: string, study: string, db: string): string {
  return "SELECT attribute_name AS name, any(type) AS type, count() AS n FROM " + clinicalTable(db, []) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name ILIKE '%hla%' AND trimBoth(attribute_value) != ''\n" +
    "GROUP BY name ORDER BY name LIMIT 40";
}
