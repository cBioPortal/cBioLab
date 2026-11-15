// The mutation table: one gene's mutations in a cohort, one row per mutation call, with the columns
// cBioPortal's Mutations tab lists. Its rows name samples, so — like the clinical table — the query
// lives here, outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.rowsPage: a participant that may not disclose a patient has no such method.
import { mutationStudySql, sq } from "./compiler.ts";
import type { QueryColumn, RowSource } from "./table-query.ts";
import { impactSql, impactType, canonicalType, cellOf, cellLabel, IMPACT_TYPES, IMPACT_COLORS } from "./lollipop.ts";
import { clinicalTable } from "./custom-data.ts";
import { inCohortSamples } from "./cohort2.ts";
import { ONCOKB_TABLE, ONCOKB_TUMOR_TYPE_TABLE } from "./annotation-store.ts";
import { hgvsgSql, variantAnnotationCte, variantColumnsSql, type VariantPins } from "./variant-annotation.ts";
import { HOTSPOT_GENES, hotspotCondSql } from "./hotspots.ts";
import { oqlMutationFilterSql } from "./oql.ts";
import type { LollipopOql } from "./federation.ts";
import { entrezOf, fusionProteinChangeSql, siteKey, svCallCtes, svCellSql, svDriverSql, svTypeSql } from "./sv-oncokb.ts";

export interface MutationColumn { id: string; name: string; numeric: boolean; tip?: string; unsorted?: boolean }

/** The table's columns, in the portal's order. */
export const MUTATION_COLUMNS: MutationColumn[] = [
  { id: "sample", name: "Sample ID", numeric: false },
  { id: "cancerType", name: "Cancer Type Detailed", numeric: false },
  { id: "proteinChange", name: "Protein Change", numeric: false },
  // the stored protein start position: the codon the lollipop draws the mutation at. Filtered as a
  // set of values (the stems selected there), so a text column that sorts by number
  { id: "proteinPos", name: "Protein Position", numeric: false },
  { id: "annotation", name: "Annotation (OncoKB)", numeric: false },
  // MutationAssessor, SIFT, PolyPhen-2 and AlphaMissense on the canonical transcript; the portal does not sort it
  { id: "functionalImpact", name: "Functional Impact", numeric: false, unsorted: true,
    tip: "Functional impact of the variant on the protein: Mutation Assessor, SIFT, PolyPhen-2 and AlphaMissense predictions. Hover over a dot to see the prediction and its score." },
  { id: "mutationType", name: "Mutation Type", numeric: false },
  { id: "alteration", name: "Alteration", numeric: false },
  { id: "variantType", name: "Variant Type", numeric: false },
  { id: "vaf", name: "Allele Freq (T)", numeric: true },
  { id: "altCount", name: "Variant Reads", numeric: true },
  { id: "refCount", name: "Ref Reads", numeric: true },
  { id: "mutCount", name: "# Mut in Sample", numeric: true },
  { id: "chr", name: "Chromosome", numeric: false },
  { id: "start", name: "Start Pos", numeric: true },
  { id: "end", name: "End Pos", numeric: true },
  { id: "ref", name: "Ref", numeric: false },
  { id: "var", name: "Var", numeric: false },
  // from the mutation's own coordinates, as the portal builds it
  { id: "hgvsg", name: "HGVSg", numeric: false, tip: "Genomic change in HGVS notation (HGVSg). Click a value to view it in Genome Nexus." },
  // the rest from Genome Nexus, read from the offline store at its pin (lib/variant-annotation.ts)
  { id: "hgvsc", name: "HGVSc", numeric: false, tip: "Coding DNA change in HGVS notation (HGVSc) for the selected transcript" },
  { id: "status", name: "MS", numeric: false },
  { id: "gnomad", name: "gnomAD", numeric: true,
    tip: "gnomAD population allele frequencies. Overall population allele frequency is shown. Hover over a frequency to see the frequency for each specific population." },
  { id: "clinvar", name: "ClinVar", numeric: false, tip: "ClinVar aggregates information about genomic variation and its relationship to human health." },
  { id: "dbsnp", name: "dbSNP", numeric: false,
    tip: "The Single Nucleotide Polymorphism Database (dbSNP) is a free public archive for genetic variation within and across different species. NOTE: Currently only SNPs, single base deletions and insertions are supported." },
  // SIGNAL's germline frequency, spelled at two significant digits and sorted by number
  { id: "signal", name: "SIGNAL", numeric: false, tip: "Prevalence of germline mutations in cancer patients from SIGNAL" },
];

/** Shown unless the view names its columns: the portal's own default set. */
export const MUTATION_DEFAULT_COLUMNS = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "mutCount"];

/**
 * The lollipop grid's cell a mutation falls in, spelled as the grid labels it ("Missense · Driver"):
 * its protein impact class (the lollipop's own mapping, lib/lollipop.ts) and driver status — every
 * mutation a driver when no OncoKB version is pinned, as the lollipop counts them then.
 */
export function alterationSql(pin: string | null): string {
  const klass = "transform(" + impactSql("mutationType") + ", [" + IMPACT_TYPES.map((k) => "'" + k + "'").join(", ") + "], [" +
    IMPACT_TYPES.map((k) => "'" + IMPACT_COLORS[k].label + "'").join(", ") + "], 'Other')";
  return "concat(" + klass + ", " + (pin ? "if(drv = 1, ' · Driver', ' · VUS')" : "' · Driver'") + ")";
}
/** The same, in the browser, for a row the table returned. */
export function alterationOf(mutationType: string, driver: boolean, pin: string | null): string {
  return cellLabel(cellOf(impactType(canonicalType(mutationType)), pin ? driver : true));
}

/** How each column reads off the rows: as text (search, text filters, value lists), as a number, and its order. */
function queryColumn(c: MutationColumn, pin: string | null): QueryColumn {
  const str = (x: string) => "ifNull(toString(" + x + "), '')";
  const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
  switch (c.id) {
    case "sample": return { ...c, text: "sid" };
    // spelled as the table shows it, so search and the value list match what is on screen
    case "annotation": return { ...c, text: "if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level ')))))", order: "drv" };
    case "proteinChange": return { ...c, text: str("proteinChange"), order: "pos" };
    case "alteration": return { ...c, text: alterationSql(pin) };
    case "proteinPos": return { ...c, text: str("pos"), order: "pos" };
    case "vaf": return { ...c, text: str("round(vaf, 2)"), num: num("vaf") };
    // the portal sorts HGVSc by the number after "c." (Hgvsc.tsx), ClinVar by its significance
    case "hgvsc": return { ...c, text: "hgvsc", order: "toInt64OrNull(extract(hgvsc, 'c\\.(-?[0-9]+)'))" };
    case "clinvar": return { ...c, text: "if(clinvar = '' OR clinvarConflicting = '', clinvar, concat(clinvar, '(', clinvarConflicting, ')'))", order: "nullIf(clinvar, '')" };
    case "signal": return { ...c, text: str(SIGNAL_TEXT), order: "signalFreq" };
    // the portal sorts gnomAD by the overall frequency, dbSNP by its id; Functional Impact is not sorted
    case "gnomad": return { ...c, text: str("gnomadFreq"), num: "gnomadFreq" };
    case "dbsnp": return { ...c, text: "rsid", order: "nullIf(rsid, '')" };
    case "functionalImpact": return { ...c, text: "functionalImpact" };
    default: return c.numeric ? { ...c, text: str(c.id), num: num(c.id) } : { ...c, text: str(c.id) };
  }
}

/** SIGNAL's frequency at two significant digits, as the portal's download spells it (0 as "0"). */
const SIGNAL_TEXT = "if(signalFreq IS NULL, NULL, if(signalFreq = 0, '0', " +
  "toString(toFloat64(round(toDecimal64(signalFreq, 12), 1 - toInt32(floor(log10(signalFreq))))))))";

/** One (cohort, study) part of a table: the cohort's SQL as that study's resolver compiles it. */
export interface TablePart { cohort: string; study: string; cohortSql: string }

/** A part's rows, every column the table has, labelled with its cohort, study and document order. */
function partRows(p: TablePart, i: number, db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql): { ctes: string; rows: string } {
  const filter = oql ? oqlMutationFilterSql(oql.lines, gene, { study: p.study, db, oncokbPin: pin, ...(oql.drivers !== undefined ? { drivers: oql.drivers, hotspotPins: pins } : {}) }) : null;
  const pre = sq(p.study + "_");
  const attr = (name: string, as: string) =>
    as + " AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, any(attribute_value) AS v FROM " + clinicalTable(db, [name]) + "\n" +
    "  WHERE cancer_study_identifier = " + sq(p.study) + " AND type = 'sample' AND attribute_name = " + sq(name) + "\n" +
    "    AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM (SELECT sid FROM m" + i + " UNION ALL SELECT sid FROM v" + i + ")) GROUP BY sid)";
  const ctes =
    "c" + i + " AS (" + p.cohortSql + "),\n" +
    "m" + i + " AS (\n" +
    "  SELECT patientId AS pid, sampleId AS sid, proteinChange, mutationType, variantType, chr, startPosition AS start, endPosition AS end,\n" +
    "         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos\n" +
    "  FROM " + db + ".mutation_derived\n" +
    "  WHERE " + mutationStudySql(p.study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + "\n" +
    "    AND molecularProfileId NOT LIKE '%uncalled%' AND " + inCohortSamples("sampleId", "c" + i) + (filter ? "\n    AND " + filter : "") + "\n" +
    "),\n" +
    fusionCtes(p, i, db, gene, pin) +
    attr("CANCER_TYPE_DETAILED", "ct" + i) + ",\n" +
    attr("MUTATION_COUNT", "mc" + i) + ",\n" +
    (pin ? tumorTypeCtes(p, i, db) : "");
  const gn = variantAnnotationCte("g" + i, db, p.study, "SELECT chr, start, end, ref, var FROM m" + i, pins);
  const rows =
    "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
    "         (SELECT rg.name FROM " + db + ".cancer_study cs JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "          WHERE cs.cancer_study_identifier = " + sq(p.study) + ") AS build,\n" +
    "         m.pid AS patient, m.sid AS sid, ct.v AS cancerType, m.proteinChange AS proteinChange,\n" +
    // a germline mutation has no protein-change call: the portal asks OncoKB about it by HGVSc
    // (StoreUtils queryOncoKbData), which this store does not hold
    (pin ? "         if(m.germ, '', if(tt.found = 1, tt.oncogenicity, ann.oncogenicity)) AS oncogenicity, if(m.germ, '', if(tt.found = 1, tt.level, ann.level)) AS level,\n" +
      "         toUInt8((NOT m.germ AND if(tt.found = 1, tt.driver, ifNull(ann.driver, 0)))" + (gn && HOTSPOT_GENES.has(gene) ? " OR " + hotspotCondSql("m.mutationType", "ifNull(g.gd, '')") : "") + ") AS drv,\n"
      : "         '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,\n") +
    "         m.mutationType AS mutationType, m.variantType AS variantType,\n" +
    "         if(m.altCount + m.refCount > 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, m.altCount AS altCount, m.refCount AS refCount,\n" +
    "         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos,\n" +
    "         " + hgvsgSql("ifNull(m.chr, '')", "ifNull(m.start, 0)", "ifNull(m.end, 0)", "ifNull(m.ref, '')", "ifNull(m.var, '')") + " AS hgvsg,\n" +
    "         " + variantColumnsSql(gn ? "ifNull(g.gd, '')" : "''", gene) + "\n" +
    "  FROM " + (pin ? "mt" : "m") + i + " AS m\n" +
    (pin ? "  LEFT JOIN ann ON ann.alteration = m.proteinChange\n" +
      "  LEFT JOIN att AS tt ON tt.alteration = m.proteinChange AND tt.consequence = m.consequence AND tt.tumor_type = m.tumorType\n" : "") +
    (gn ? "  LEFT JOIN g" + i + " AS g ON g.chr = m.chr AND g.start = m.start AND g.end = m.end AND g.ref = m.ref AND g.var = m.var\n" : "") +
    "  LEFT JOIN ct" + i + " AS ct ON ct.sid = m.sid LEFT JOIN mc" + i + " AS mc ON mc.sid = m.sid\n";
  return { ctes: ctes + (gn ? gn + ",\n" : ""), rows: rows + "  UNION ALL\n" + fusionRows(p, i, db, gene, pin) };
}

/**
 * `v<i>`: the part's structural variants whose site 1 or site 2 is the gene (by Entrez id, as the portal
 * fetches them), in the cohort's samples, each as the Mutations tab lists it (ResultsViewPageStore
 * mutationsByGene): its sites' genes, class and event info, site 1's chromosome and position, its status
 * and, at a pin, its OncoKB SV store keys (lib/sv-oncokb.ts) and its sample's tumour type (`vk<i>`).
 */
function fusionCtes(p: TablePart, i: number, db: string, gene: string, pin: string | null): string {
  return "v" + i + " AS (\n" +
    "  SELECT pt.stable_id AS pid, smp.stable_id AS sid, ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2,\n" +
    "         sv.class AS class, sv.event_info AS eventInfo, sv.site1_chromosome AS chr, sv.site1_position AS start, sv.sv_status AS status,\n" +
    "         " + siteKey("sv.site1_entrez_gene_id") + " AS k1, " + siteKey("sv.site2_entrez_gene_id") + " AS k2\n" +
    "  FROM " + db + ".structural_variant sv\n" +
    "  JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "  JOIN " + db + ".sample smp ON smp.internal_id = sv.sample_id\n" +
    "  JOIN " + db + ".patient pt ON pt.internal_id = smp.patient_id\n" +
    "  LEFT JOIN " + db + ".gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id\n" +
    "  LEFT JOIN " + db + ".gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(p.study) + " AND gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'\n" +
    "    AND (sv.site1_entrez_gene_id IN (" + entrezOf(db, [gene]) + ") OR sv.site2_entrez_gene_id IN (" + entrezOf(db, [gene]) + "))\n" +
    "    AND " + inCohortSamples("smp.stable_id", "c" + i) + "\n" +
    "),\n" +
    (pin ? sampleTumorTypeCte("vk" + i, p.study, db, "SELECT sid FROM v" + i) + ",\n" : "");
}

/**
 * The part's fusion rows, column for column as partRows' mutation rows: the protein change as the
 * portal builds it, mutation type Fusion, the variant class upper-cased as the portal's Variant Type
 * shows it, no allele counts, codon or genomic change (so no Genome Nexus annotation). At a pin, the
 * Annotation cell is the pair's call for the sample's tumour type and the driver status the pair's call
 * with none, as the portal asks each (lib/sv-oncokb.ts, with its gene-level fallback); a structural
 * variant is never germline for the driver call (ResultsViewPageStoreUtils, isGermline false).
 */
function fusionRows(p: TablePart, i: number, db: string, gene: string, pin: string | null): string {
  return "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
    "         (SELECT rg.name FROM " + db + ".cancer_study cs JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "          WHERE cs.cancer_study_identifier = " + sq(p.study) + ") AS build,\n" +
    "         v.pid AS patient, v.sid AS sid, ct.v AS cancerType, " + fusionProteinChangeSql("v.") + " AS proteinChange,\n" +
    (pin ? "         " + svCellSql("oncogenicity", "vp", "va1", "va2") + " AS oncogenicity, " + svCellSql("level", "vp", "va1", "va2") + " AS level, " +
        svDriverSql("vn", "va1", "va2") + " AS drv,\n"
      : "         '' AS oncogenicity, '' AS level, toUInt8(0) AS drv,\n") +
    "         'Fusion' AS mutationType, upper(v.class) AS variantType,\n" +
    "         NULL AS vaf, NULL AS altCount, NULL AS refCount,\n" +
    "         toInt64OrNull(mc.v) AS mutCount, v.chr AS chr, v.start AS start, NULL AS end, NULL AS ref, NULL AS var, v.status AS status, NULL AS pos,\n" +
    "         '' AS hgvsg,\n" +
    "         " + variantColumnsSql("''", gene) + "\n" +
    "  FROM v" + i + " AS v\n" +
    (pin ? "  LEFT JOIN vk" + i + " AS vk ON vk.sid = v.sid\n" +
      "  LEFT JOIN sva AS va1 ON va1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS va2 ON va2.gene = v.gene2 AND v.gene2 != ''\n" +
      "  LEFT JOIN svp AS vp ON vp.site1_entrez = v.k1 AND vp.site2_entrez = v.k2 AND vp.sv_type = " + svTypeSql("v.") + " AND vp.tumor_type = vk.tumorType\n" +
      "  LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = " + svTypeSql("v.") + " AND vn.tumor_type = ''\n" : "") +
    "  LEFT JOIN ct" + i + " AS ct ON ct.sid = v.sid LEFT JOIN mc" + i + " AS mc ON mc.sid = v.sid\n";
}

/**
 * `name` AS (sid, tumorType): the tumour type the portal asks OncoKB with (StoreUtils
 * generateUniqueSampleKeyToTumorTypeMap) for each of a study's samples `sids` (SQL selecting a
 * column `sid`, bare sample ids): the sample's CANCER_TYPE_DETAILED; for a sample with neither
 * CANCER_TYPE nor CANCER_TYPE_DETAILED, its study's cancer type; for one with CANCER_TYPE alone,
 * none (''). The same rule as the sync's key spaces (packages/annotation-sync, oncokb-tumor-type and
 * oncokb-sv). The mutation and structural-variant tables both read it.
 */
export function sampleTumorTypeCte(name: string, study: string, db: string, sids: string): string {
  const pre = sq(study + "_");
  const types = ["CANCER_TYPE", "CANCER_TYPE_DETAILED"];
  return name + " AS (SELECT s.sid AS sid,\n" +
    "    if(ifNull(k.sid, '') = '', (SELECT t.name FROM " + db + ".cancer_study cs JOIN " + db + ".type_of_cancer t ON t.type_of_cancer_id = cs.type_of_cancer_id\n" +
    "      WHERE cs.cancer_study_identifier = " + sq(study) + "), if(ifNull(k.nd, 0) > 0, k.d, '')) AS tumorType\n" +
    "  FROM (SELECT DISTINCT sid FROM (" + sids + ")) AS s\n" +
    "  LEFT JOIN (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, countIf(attribute_name = 'CANCER_TYPE_DETAILED') AS nd,\n" +
    "      anyIf(attribute_value, attribute_name = 'CANCER_TYPE_DETAILED') AS d FROM " + clinicalTable(db, types) + "\n" +
    "    WHERE cancer_study_identifier = " + sq(study) + " AND type = 'sample' AND attribute_name IN ('CANCER_TYPE', 'CANCER_TYPE_DETAILED')\n" +
    "      AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM (" + sids + ")) GROUP BY sid) AS k ON k.sid = s.sid)";
}

/** A part's mutations with the tumour type the portal asks OncoKB with (sampleTumorTypeCte), and whether each is germline. */
function tumorTypeCtes(p: TablePart, i: number, db: string): string {
  return sampleTumorTypeCte("k" + i, p.study, db, "SELECT sid FROM m" + i) + ",\n" +
    "mt" + i + " AS (SELECT m.*, ifNull(m.mutationType, '') AS consequence, positionCaseInsensitive(ifNull(m.status, ''), 'germline') > 0 AS germ,\n" +
    "    k.tumorType AS tumorType FROM m" + i + " AS m LEFT JOIN k" + i + " AS k ON k.sid = m.sid),\n";
}

function allRows(parts: TablePart[], db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql): string {
  const built = parts.map((p, i) => partRows(p, i, db, gene, pin, pins, oql));
  return "WITH " +
    (pin
      ? "ann AS (SELECT alteration, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, max(is_driver) AS driver\n" +
        "  FROM " + ONCOKB_TABLE + " WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION' AND hugo_gene_symbol = " + sq(gene) + "\n" +
        "  GROUP BY alteration),\n" +
        "att AS (SELECT alteration, consequence, tumor_type, any(t.oncogenicity) AS oncogenicity, any(t.highest_sensitive_level) AS level,\n" +
        "    max(t.oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found\n" +
        "  FROM " + ONCOKB_TUMOR_TYPE_TABLE + " AS t WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION' AND hugo_gene_symbol = " + sq(gene) + "\n" +
        "  GROUP BY alteration, consequence, tumor_type),\n" +
        // the gene's structural variants' calls, for its fusion rows
        svCallCtes(db, [gene], pin, { gene: "sva", pair: "svp" })
      : "") +
    built.map((b) => b.ctes).join("") +
    "rows AS (\n" + built.map((b) => b.rows).join("  UNION ALL\n") + ")\n";
}

/**
 * One gene's mutations across every (cohort, study) part a table spans, for lib/table-query.ts to
 * search, filter, sort and page in the database — so the order is global (studies interleave, as in
 * the portal's table) and any page is one query however deep. Uncalled calls are left out, as the
 * portal leaves them out; the sample's detailed cancer type and mutation count come from the
 * study's own attributes; the OncoKB call at `pin` when there is one; Genome Nexus's HGVSc, ClinVar
 * and SIGNAL at the pin of the study's reference genome (`pins`), when it has one. With no sort,
 * drivers come first, then by codon. All parts must live in the database this runs in.
 */
export function mutationRowSource(parts: TablePart[], db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql): RowSource {
  if (!parts.length) throw new Error("mutationRowSource needs at least one part");
  return {
    with: allRows(parts, db, gene, pin, pins, oql),
    columns: MUTATION_COLUMNS.map((c) => queryColumn(c, pin)),
    select: "*",
    defaultOrder: "drv DESC, pos ASC NULLS LAST",
    tiebreak: "sid, ord, proteinChange",
  };
}
