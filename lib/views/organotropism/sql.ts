// The organotropism view's SQL: what its runner (run.ts) asks each participant's database for.
import { pidOf, orgAttr, incidenceCountsSql, type EnrichAlteration, geneList, ENRICH_PANEL_TYPE, enrichEventCond } from "../../federation-views.ts";
import { clinicalTable } from "../../custom-data.ts";
import { sq } from "../../compiler.ts";
import { foldedEqualsSql, clinicalValueFoldSql, nameFoldSql } from "../../event-names.ts";
import { driverJoin } from "../../federation.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** Which site sources the cohort's patients carry: patients with a flag attribute (and how many
 *  flags), with a site on the timeline, and with a biopsy-site value. Counts only. */
export function orgSourcesSql(cohortSql: string, study: string, db: string, o: { prefix: string; eventType: string; key: string; attribute: string }): AggregateSql {
  const pid = pidOf("patient_unique_id", study), prefix = orgAttr(o.prefix), attr = orgAttr(o.attribute);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT\n" +
    "  (SELECT uniqExact(" + pid + ") FROM " + clinicalTable(db, []) + " WHERE cancer_study_identifier = " + sq(study) +
    " AND startsWith(attribute_name, " + sq(prefix) + ") AND " + pid + " IN (SELECT pid FROM cohort)) AS flag_patients,\n" +
    "  (SELECT uniqExact(attribute_name) FROM " + clinicalTable(db, []) + " WHERE cancer_study_identifier = " + sq(study) +
    " AND startsWith(attribute_name, " + sq(prefix) + ") AND " + pid + " IN (SELECT pid FROM cohort)) AS flags,\n" +
    "  (SELECT uniqExact(p.stable_id) FROM " + db + ".clinical_event ce\n" +
    "     JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
    "     JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "     JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "   WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", o.eventType) + " AND " + foldedEqualsSql("d.key", o.key) +
    " AND trimBoth(d.value) != '' AND p.stable_id IN (SELECT pid FROM cohort)) AS timeline_patients,\n" +
    "  (SELECT uniqExact(" + pid + ") FROM " + clinicalTable(db, [attr]) + " WHERE cancer_study_identifier = " + sq(study) +
    " AND attribute_name = " + sq(attr) + " AND trimBoth(attribute_value) != '' AND " + pid + " IN (SELECT pid FROM cohort)) AS sample_patients\n" +
    "FROM system.one"
  ));
}

/** Per site: patients evaluable for it and those with a metastasis there. Counts only. */
export function orgSitesSql(cohortSql: string, study: string, db: string, src: OrgSource): AggregateSql {
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" + orgSiteCtes(study, db, src) + "\n" +
    "SELECT ps.site AS site, any(sl.label) AS label, count() AS evaluable, sum(ps.has) AS with_site\n" +
    "FROM ps INNER JOIN sl ON sl.site = ps.site GROUP BY site"
  ));
}

/** Sample source: the biopsy-site values that ORG_SITE_MAP sends to "Other", with their patients. Counts only. */
export function orgOtherValuesSql(cohortSql: string, study: string, db: string, attribute: string): AggregateSql {
  const pid = pidOf("patient_unique_id", study), attr = orgAttr(attribute);
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + ")\n" +
    "SELECT trimBoth(attribute_value) AS value, uniqExact(" + pid + ") AS patients\n" +
    "FROM " + clinicalTable(db, [attr]) + "\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attr) + " AND trimBoth(attribute_value) != ''\n" +
    "  AND " + pid + " IN (SELECT pid FROM cohort) AND " + orgSiteMapExpr("attribute_value") + " = 'Other'\n" +
    "GROUP BY value ORDER BY patients DESC, value LIMIT 30"
  ));
}

/** The cohort's most altered genes (patients with the alteration on a covering panel), at most `limit`. Counts only. */
export function orgTopGenesSql(cohortSql: string, study: string, db: string, g: Omit<OrgGenes, "genes">, limit: number): AggregateSql {
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" + orgGeneCtes(study, db, { ...g, genes: null }) + "\n" +
    "SELECT gene, count() AS altered FROM alt GROUP BY gene ORDER BY altered DESC, gene LIMIT " + Math.max(1, Math.min(200, Math.floor(limit)))
  ));
}

/**
 * Per (site, gene, stratum): the patients evaluable for the site AND profiled for the gene, those
 * of them with a metastasis there, those altered, and those both — the four margins of one 2×2
 * per stratum (a patient's `stratifyBy` value; "Multiple" when their samples disagree, '' when none
 * is recorded). Counts only.
 */
export function orgCountsSql(cohortSql: string, study: string, db: string, src: OrgSource, g: OrgGenes & { genes: string[] }, stratifyBy: string | null): AggregateSql {
  const pid = pidOf("patient_unique_id", study);
  const strat = stratifyBy ? orgAttr(stratifyBy) : null;
  return aggregateSql((
    "WITH cohort AS (" + cohortSql + "),\n" + orgSiteCtes(study, db, src) + ",\n" + orgGeneCtes(study, db, g) + ",\n" +
    "st AS (\n" +
    (strat
      ? "  SELECT " + pid + " AS pid, if(uniqExact(" + clinicalValueFoldSql("attribute_value") + ") > 1, 'Multiple', any(trimBoth(attribute_value))) AS s\n" +
        "  FROM " + clinicalTable(db, [strat]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(strat) + " AND trimBoth(attribute_value) != ''\n" +
        "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
        "  GROUP BY pid\n"
      : "  SELECT pid, '' AS s FROM cohort\n") +
    ")\n" +
    "SELECT ps.site AS site, prof.gene AS gene, st.s AS stratum, count() AS n, sum(ps.has) AS with_site,\n" +
    "       countIf(alt.pid != '') AS altered, countIf(ps.has = 1 AND alt.pid != '') AS both\n" +
    "FROM ps INNER JOIN prof ON prof.pid = ps.pid\n" +
    "  LEFT JOIN alt ON alt.pid = ps.pid AND alt.gene = prof.gene\n" +
    "  LEFT JOIN st ON st.pid = ps.pid\n" +
    "GROUP BY site, gene, stratum"
  ));
}

/**
 * Cumulative incidence of the first timeline site event (src's event type, key = `siteValue`) with
 * death competing, for the cohort's patients profiled for `gene` and altered in it (`altered`) or
 * not: incidenceCountsSql over that half of the cohort. Counts only.
 */
export function orgIncidenceSql(cohortSql: string, study: string, db: string, src: OrgSource, g: OrgGenes & { genes: [string] }, altered: boolean, siteValue: string): AggregateSql {
  const half = "SELECT pid FROM (" + cohortSql + ") WHERE pid IN (\n  WITH cohort AS (" + cohortSql + "),\n" + orgGeneCtes(study, db, g) + "\n" +
    "  SELECT pid FROM prof)\n  AND pid " + (altered ? "" : "NOT ") + "IN (\n  WITH cohort AS (" + cohortSql + "),\n" + orgGeneCtes(study, db, g) + "\n  SELECT pid FROM alt)";
  return aggregateSql(incidenceCountsSql(half, study, db, { eventType: src.eventType || "Diagnosis", attrs: [{ key: src.key || "TUMOR_SITE", value: siteValue }] }, null));
}

// ---------------------------------------------------------------------------
// organotropism: which genes go with metastasis to which organ

export type OrgSourceKind = "flags" | "timeline" | "sample";
export interface OrgSource {
  kind: OrgSourceKind;
  /** flags: the per-organ attributes' common prefix (e.g. DMETS_DX_), valued Yes / No */
  prefix?: string;
  /** timeline: the event type and the key whose value names the site */
  eventType?: string; key?: string;
  /** sample: the attribute naming a metastasis sample's biopsy site, mapped through ORG_SITE_MAP */
  attribute?: string;
}

/**
 * The organ a free-text biopsy site is counted under: the first rule whose pattern matches the
 * lower-cased value; anything else is "Other". The rules are ours, written against the public
 * METASTATIC_SITE vocabularies (msk_met_2021, msk_chord_2024, msk_impact_50k_2026), and every
 * result lists the values that fell to "Other".
 */
export const ORG_SITE_MAP: [string, string][] = [
  ["Lymph node", "lymph|\\bln\\b|node|axilla"],
  ["CNS/Brain", "brain|cereb|csf|epidural|dura\\b|dural|mening|spinal cord|cns"],
  ["Liver", "liver|hepat"],
  ["Lung", "^lung|pulmon|\\blung\\b"],
  ["Pleura", "pleura"],
  ["Bone", "bone|spine|vertebr|\\brib\\b|femur|iliac|sacr|stern|scapula|humer|skull|acetab|clavic|tibia|ischi|pubic|calvari"],
  ["Adrenal gland", "adrenal"],
  ["Peritoneum / abdomen", "periton|omentum|mesenter|abdom|diaphragm|intra-abdominal|ascites"],
  ["Bowel / GI tract", "bowel|colon|rect|intestin|duoden|ileum|jejun|append|stomach|gastr|esophag|biliary|gallbladder|pancrea"],
  ["Skin / soft tissue", "skin|scalp|soft tissue|chest wall|subcut|muscle|\\bback\\b|paraspinal|breast"],
  ["Genital organs", "ovar|uter|vagin|adnex|endomet|cervix|fallop|genital|testi|prostat|vulva"],
  ["Kidney / urinary tract", "kidney|renal|bladder|ureter|urethr|\\but\\b"],
  ["Head and neck", "head|neck|thyroid|parotid|oral|tongue|larynx|orbit"],
  ["Mediastinum / heart", "mediastin|pericard|heart"],
];

/** A biopsy-site value's organ, in SQL (ORG_SITE_MAP's rules over the lower-cased, trimmed value). */
export function orgSiteMapExpr(expr: string): string {
  const v = "lowerUTF8(trimBoth(" + expr + "))";
  return "multiIf(" + ORG_SITE_MAP.map(([organ, re]) => "match(" + v + ", " + sq(re) + "), " + sq(organ)).join(", ") + ", 'Other')";
}
const ORG_YES = "('yes', 'y', 'true', '1')", ORG_NO = "('no', 'n', 'false', '0')";

/**
 * `ps`: one row per (patient, site) the source can speak to, `has` 1 when the patient has a
 * metastasis there; `sl`: each site's label. Flags: a patient is evaluable for a site when its
 * flag is recorded Yes or No. Timeline: a patient with any site recorded is evaluable for every
 * site seen. Sample: every cohort patient is evaluable; a site is one a sample was taken from.
 */
function orgSiteCtes(study: string, db: string, src: OrgSource): string {
  const pid = pidOf("patient_unique_id", study);
  if (src.kind === "flags") {
    const prefix = orgAttr(src.prefix || "DMETS_DX_");
    return (
      "fl AS (\n" +
      "  SELECT " + pid + " AS pid, substring(attribute_name, " + (prefix.length + 1) + ") AS site,\n" +
      "         max(" + clinicalValueFoldSql("attribute_value") + " IN " + ORG_YES + ") AS has,\n" +
      "         max(" + clinicalValueFoldSql("attribute_value") + " IN " + ORG_YES + " OR " + clinicalValueFoldSql("attribute_value") + " IN " + ORG_NO + ") AS known\n" +
      "  FROM " + clinicalTable(db, []) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND startsWith(attribute_name, " + sq(prefix) + ") AND length(attribute_name) > " + prefix.length + "\n" +
      "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
      "  GROUP BY pid, site\n" +
      "),\n" +
      "ps AS (SELECT pid, site, toUInt8(has) AS has FROM fl WHERE known),\n" +
      "sl AS (SELECT DISTINCT site, site AS label FROM ps)"
    );
  }
  if (src.kind === "timeline") {
    return (
      "evr AS (\n" +
      "  SELECT DISTINCT p.stable_id AS pid, " + nameFoldSql("d.value") + " AS site, trimBoth(d.value) AS raw\n" +
      "  FROM " + db + ".clinical_event ce\n" +
      "  JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
      "  JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
      "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
      "  WHERE cs.cancer_study_identifier = " + sq(study) + " AND " + foldedEqualsSql("ce.event_type", src.eventType || "Diagnosis") + "\n" +
      "    AND " + foldedEqualsSql("d.key", src.key || "TUMOR_SITE") + " AND trimBoth(d.value) != ''\n" +
      "    AND p.stable_id IN (SELECT pid FROM cohort)\n" +
      "),\n" +
      "ev AS (SELECT DISTINCT pid, site FROM evr),\n" +
      "sl AS (SELECT site, min(raw) AS label FROM evr GROUP BY site),\n" +
      "ps AS (\n" +
      "  SELECT e.pid AS pid, s.site AS site, toUInt8((e.pid, s.site) IN (SELECT pid, site FROM ev)) AS has\n" +
      "  FROM (SELECT DISTINCT pid FROM ev) e CROSS JOIN (SELECT site FROM sl) s\n" +
      ")"
    );
  }
  const attr = orgAttr(src.attribute || "METASTATIC_SITE");
  return (
    "sm AS (\n" +
    "  SELECT DISTINCT " + pid + " AS pid, " + orgSiteMapExpr("attribute_value") + " AS site\n" +
    "  FROM " + clinicalTable(db, [attr]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(attr) + " AND trimBoth(attribute_value) != ''\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    "sl AS (SELECT DISTINCT site, site AS label FROM sm),\n" +
    "ps AS (\n" +
    "  SELECT c.pid AS pid, s.site AS site, toUInt8((c.pid, s.site) IN (SELECT pid, site FROM sm)) AS has\n" +
    "  FROM (SELECT DISTINCT pid FROM cohort) c CROSS JOIN (SELECT site FROM sl) s\n" +
    ")"
  );
}

export interface OrgGenes { genes: string[] | null; alteration: EnrichAlteration; driverPin: string | null }

/** `prof` (patient, gene) for every listed gene a patient's panel covers for the alteration type (whole-exome
 *  covers all); `alt` the same pairs with the alteration called on a covering panel (OncoKB drivers only with
 *  driverPin). Without a gene list, `alt` holds every gene. Both read `cohort`. */
function orgGeneCtes(study: string, db: string, g: OrgGenes): string {
  const sdPid = pidOf("sd.patient_unique_id", study), gPid = pidOf("g.patient_unique_id", study);
  const list = g.genes ? geneList(g.genes) : null;
  return (
    "pp AS (\n" +
    "  SELECT DISTINCT " + sdPid + " AS pid, toString(sp.gene_panel_id) AS panel\n" +
    "  FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = " + sq(ENRICH_PANEL_TYPE[g.alteration]) + "\n" +
    "    AND " + sdPid + " IN (SELECT pid FROM cohort)\n" +
    "),\n" +
    (list
      ? "prof AS (\n" +
        "  SELECT DISTINCT pp.pid AS pid, gp.gene AS gene FROM pp JOIN " + db + ".gene_panel_to_gene_derived gp ON gp.gene_panel_id = pp.panel WHERE gp.gene IN (" + list + ")\n" +
        "  UNION DISTINCT\n" +
        "  SELECT pid, arrayJoin([" + list + "]) AS gene FROM pp WHERE panel = 'WES'\n" +
        "),\n"
      : "") +
    "alt AS (\n" +
    "  SELECT DISTINCT " + gPid + " AS pid, g.hugo_gene_symbol AS gene\n" +
    "  FROM " + db + ".genomic_event_derived g\n" + (g.driverPin ? driverJoin(g.driverPin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + " AND " + enrichEventCond(g.alteration) + " AND NOT g.off_panel\n" +
    (list ? "    AND g.hugo_gene_symbol IN (" + list + ")\n" : "") + (g.driverPin ? "    AND ann.is_driver\n" : "") +
    "    AND " + gPid + " IN (SELECT pid FROM cohort)\n" +
    ")"
  );
}
