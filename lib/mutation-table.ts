// The mutation table: one gene's mutations in a cohort, one row per mutation call, with the columns
// cBioPortal's Mutations tab lists. Its rows name samples, so — like the clinical table — the query
// lives here, outside lib/federation*.ts's aggregate builders, and runs only through
// PatientLevelResolver.rowsPage: a participant that may not disclose a patient has no such method.
// The one other reader is the lollipop narrowed by the table's search (mutationRowKeysSql), which
// BaseResolver.lollipopCounts builds only on a patient-level participant and refuses everywhere else.
import { mutationStudySql, sq } from "./compiler.ts";
import { whereSql, type QueryColumn, type RowSource, type TableQuery } from "./table-query.ts";
import { impactSql, impactType, canonicalType, cellOf, cellLabel, IMPACT_TYPES, IMPACT_COLORS, LOLLIPOP_OWN_FILTERS } from "./lollipop.ts";
import { clinicalTable } from "./custom-data.ts";
import { discreteCnaProfileSql, inCohortSamples } from "./cohort2.ts";
import { ONCOKB_TABLE, ONCOKB_TUMOR_TYPE_TABLE } from "./annotation-store.ts";
import { hgvsgSql, variantAnnotationCte, variantColumnsSql, type VariantPins } from "./variant-annotation.ts";
import { HOTSPOT_GENES, hotspotCondSql } from "./hotspots.ts";
import { annotatingSql, offeredSources, unannotatedOrSql } from "./driver-sql.ts";
import { PUTATIVE_DRIVER, type ResolvedDrivers } from "./driver-settings.ts";
import { oqlFusionFilterSql, oqlMutationFilterSql } from "./oql.ts";
import type { LollipopOql } from "./federation.ts";
import { mutationTypeColumn } from "./mutation-type.ts";
import { CLIN_PATIENT, CLIN_SAMPLE, clinicalQueryColumn, type ClinicalColumn } from "./mutation-clinical.ts";
import { chromosomeSortSql, proteinChangeSortSql } from "./mutation-sort.ts";
import { finiteSql } from "./sql-number.ts";
import { entrezOf, fusionProteinChangeSql, oncokbSortSql, siteKey, svCallCtes, svCellSql, svDriverSql, svTypeSql } from "./sv-oncokb.ts";

export interface MutationColumn { id: string; name: string; numeric: boolean; tip?: string; unsorted?: boolean; firstSort?: "asc" | "desc";
  /** the Columns menu's Clinical tab (MUT-TB-5), with its Freq: the percent of queried samples with a value (MUT-STM-15) */
  group?: "clinical"; freq?: number }

/** the columns whose first header click sorts descending (MutationTable defaultSortDirection 'desc'); every other column's is ascending, numbers too */
const FIRST_SORT_DESC = new Set(["gnomad", "clinvar", "dbsnp"]);

/** The table's columns, in the portal's order. */
export const MUTATION_COLUMNS: MutationColumn[] = ([
  // a fusion row's gene is its site 1 gene, on its site 2 gene's table too (ResultsViewPageStore mutationsByGene)
  { id: "gene", name: "Gene", numeric: false, tip: "HUGO gene symbol" },
  // not `study`: a downloaded line already leads with the row's study id (app/api/table)
  { id: "studyOfOrigin", name: "Study of Origin", numeric: false, tip: "Study of Origin" },
  // the study's CANCER_TYPE attribute, which the portal lists among its clinical-attribute columns
  { id: "cancerTypeAll", name: "Cancer Type", numeric: false, tip: "Cancer Type" },
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
  // the row holds the type as stored (the portal downloads it so); the cell, search, filters and sort use its label
  { id: "mutationType", name: "Mutation Type", numeric: false, tip: "Consequence of the mutation on the protein (variant classification). Missense: Single amino acid substitution. IF: In-frame: adds or removes amino acids without a frameshift. Truncating: Truncates the protein. Nonsense: Premature stop codon. Nonstop: Loss of the stop codon. Nonstart: Loss of the start codon. FS: Frameshift: shifts the reading frame. FS del: Frameshift deletion: shifts the reading frame. FS ins: Frameshift insertion: shifts the reading frame. IF ins: In-frame insertion: adds amino acids without a frameshift. IF del: In-frame deletion: removes amino acids without a frameshift. Splice: Affects a splice site. Fusion: Gene fusion. Silent: No change to the amino acid sequence." },
  { id: "alteration", name: "Alteration", numeric: false },
  { id: "variantType", name: "Variant Type", numeric: false, tip: "Type of change at the DNA level (variant type). SNP: Single Nucleotide Polymorphism. DNP: Di-Nucleotide Polymorphism. TNP: Tri-Nucleotide Polymorphism. ONP: Oligo-Nucleotide Polymorphism. INS: Insertion. DEL: Deletion." },
  // the sample's call for the gene in the study's discrete copy-number profile, as its label; sorted by the call
  { id: "copyNumber", name: "Copy #", numeric: false, tip: "Putative copy number call for the gene in this sample. Hover over a value for details. Amp: High-level amplification. Gain: Low-level gain. Diploid: No copy number change. ShallowDel: Shallow (possibly heterozygous) deletion. DeepDel: Deep (possibly homozygous) deletion." },
  { id: "vaf", name: "Allele Freq (T)", numeric: true },
  { id: "vafNormal", name: "Allele Freq (N)", numeric: true, tip: "Variant allele frequency in the matched normal sample (variant reads / total reads)" },
  { id: "altCount", name: "Variant Reads", numeric: true },
  { id: "refCount", name: "Ref Reads", numeric: true },
  { id: "normalAltCount", name: "Variant Reads (Normal)", numeric: true, tip: "Number of reads supporting the variant allele in the matched normal sample" },
  { id: "normalRefCount", name: "Ref Reads (Normal)", numeric: true, tip: "Number of reads supporting the reference allele in the matched normal sample" },
  { id: "mutCount", name: "# Mut in Sample", numeric: true },
  // the canonical transcript's exon in the stored Genome Nexus annotation, "8/11"; the cell shows the exon
  { id: "exon", name: "Exon", numeric: false, tip: "Exon affected by the mutation, from the Genome Nexus annotation of the selected transcript" },
  { id: "chr", name: "Chromosome", numeric: false },
  { id: "start", name: "Start Pos", numeric: true },
  { id: "end", name: "End Pos", numeric: true },
  { id: "ref", name: "Ref", numeric: false },
  { id: "var", name: "Var", numeric: false },
  // from the mutation's own coordinates, as the portal builds it
  { id: "hgvsg", name: "HGVSg", numeric: false, tip: "Genomic change in HGVS notation (HGVSg). Click a value to view it in Genome Nexus." },
  // the rest from Genome Nexus, read from the offline store at its pin (lib/variant-annotation.ts)
  { id: "hgvsc", name: "HGVSc", numeric: false, tip: "Coding DNA change in HGVS notation (HGVSc) for the selected transcript" },
  { id: "status", name: "MS", numeric: false, tip: "Mutation Status" },
  { id: "validationStatus", name: "VS", numeric: false, tip: "Validation Status (VS): whether the mutation was confirmed by an independent validation experiment. V (Valid): Confirmed by an independent validation method. W (Wildtype): Validation found the wildtype allele. U (Unknown): Not validated, or validation status unknown." },
  { id: "center", name: "Center", numeric: false, tip: "Center that sequenced or called the mutation" },
  { id: "gnomad", name: "gnomAD", numeric: true,
    tip: "gnomAD population allele frequencies. Overall population allele frequency is shown. Hover over a frequency to see the frequency for each specific population." },
  { id: "clinvar", name: "ClinVar", numeric: false, tip: "ClinVar aggregates information about genomic variation and its relationship to human health." },
  { id: "dbsnp", name: "dbSNP", numeric: false,
    tip: "The Single Nucleotide Polymorphism Database (dbSNP) is a free public archive for genetic variation within and across different species. NOTE: Currently only SNPs, single base deletions and insertions are supported." },
  // SIGNAL's germline frequency, spelled at two significant digits and sorted by number
  { id: "signal", name: "SIGNAL", numeric: false, tip: "Prevalence of germline mutations in cancer patients from SIGNAL" },
] as MutationColumn[]).map((c) => ({ ...c, firstSort: FIRST_SORT_DESC.has(c.id) ? "desc" : "asc" }));

/**
 * The Annotation column's order, as SQL over the table's rows: the portal's [OncoKB sort value, CIViC,
 * hotspot, reVUE] (react-mutation-mapper Annotation.tsx 319-327; CIViC and reVUE are off, 0; a recurrent
 * Cancer Hotspot 1, the store holding no 3D hotspots). The portal's last element, whether the gene is an
 * OncoKB cancer gene, is the same for every row of one gene's table. Sorted descending, the portal's default.
 */
export const MUTATION_ANNOTATION_ORDER = "arrayConcat(" + oncokbSortSql("oncogenicity", "level", "resistanceLevel", "diagnosticLevel", "prognosticLevel") +
  ", [toFloat64(0), toFloat64(hot), toFloat64(0)])";

/**
 * A row's allele frequency as the portal writes it on screen and in its download (MUT-STM-5): 4 decimals below
 * 0.01, else 2, trailing zeros kept; '' for none. The one rule: the table's cell, its search and its CSV all read it.
 */
export const VAF_TEXT = "if(vaf IS NULL, '', if(vaf < 0.01, toDecimalString(vaf, 4), toDecimalString(vaf, 2)))";

/** Shown unless the view names its columns: the portal's own default set. */
export const MUTATION_DEFAULT_COLUMNS = ["sample", "cancerType", "proteinChange", "annotation", "mutationType", "copyNumber", "vaf", "mutCount"];

/** What decides three of the default columns, over the table's every row (not its search or filters); undefined where unknown */
export interface MutationDefaultFacts {
  /** a queried study has a discrete copy-number profile (ResultsViewPageStore studyToMolecularProfileDiscreteCna) */
  discreteCna?: boolean;
  /** some row has a non-zero tumour allele frequency */
  nonZeroVaf?: boolean;
  /** distinct non-empty Cancer Type Detailed values */
  cancerTypes?: number;
}

/**
 * The default columns as the portal's table picks them from its data (ResultsViewMutationTable,
 * MutationTable): Copy # when a queried study has a discrete CNA profile (DiscreteCNAColumnFormatter
 * isVisible), Allele Freq (T) when a row has a non-zero frequency (TumorAlleleFreqColumnFormatter
 * isVisible), Cancer Type Detailed when the rows hold more than one (CancerTypeColumnFormatter
 * isVisible). A fact not known keeps its column.
 */
export function mutationDefaultColumns(f: MutationDefaultFacts): string[] {
  const drop = new Set<string>();
  if (f.discreteCna === false) drop.add("copyNumber");
  if (f.nonZeroVaf === false) drop.add("vaf");
  if (f.cancerTypes !== undefined && f.cancerTypes <= 1) drop.add("cancerType");
  return MUTATION_DEFAULT_COLUMNS.filter((id) => !drop.has(id));
}

/**
 * The lollipop grid's cell a mutation falls in, spelled as the grid labels it ("Missense · Driver"):
 * its protein impact class (the lollipop's own mapping, lib/lollipop.ts) and driver status — every
 * mutation a driver when no OncoKB version is pinned, as the lollipop counts them then.
 */
export function alterationSql(pin: string | boolean | null): string {
  const klass = "transform(" + impactSql("mutationType") + ", [" + IMPACT_TYPES.map((k) => "'" + k + "'").join(", ") + "], [" +
    IMPACT_TYPES.map((k) => "'" + IMPACT_COLORS[k].label + "'").join(", ") + "], 'Other')";
  return "concat(" + klass + ", " + (pin ? "if(drv = 1, ' · Driver', ' · VUS')" : "' · Driver'") + ")";
}
/** The same, in the browser, for a row the table returned. */
export function alterationOf(mutationType: string, driver: boolean, pin: string | boolean | null): string {
  return cellLabel(cellOf(impactType(canonicalType(mutationType)), pin ? driver : true));
}

/** How each column reads off the rows: as text (search, text filters, value lists), as a number, and its order. */
function queryColumn(c: MutationColumn, pin: string | boolean | null): QueryColumn {
  const str = (x: string) => "ifNull(toString(" + x + "), '')";
  const num = (x: string) => "CAST(" + x + " AS Nullable(Float64))";
  switch (c.id) {
    case "sample": return { ...c, text: "sid" };
    case "studyOfOrigin": return { ...c, text: str("studyName") };
    // spelled as the table shows it, so search and the value list match what is on screen
    case "annotation": return { ...c, text: "if(oncogenicity = '', '', concat(oncogenicity, if(level = '', '', concat(' · ', replaceOne(level, 'LEVEL_', 'Level ')))))", order: MUTATION_ANNOTATION_ORDER };
    // the portal's sort values (MUT-STM-9): position, then the letters' character codes; chromosome as a number, X 23, Y 24
    case "proteinChange": return { ...c, text: str("proteinChange"), order: proteinChangeSortSql("proteinChange") };
    case "chr": return { ...c, text: str("chr"), order: chromosomeSortSql("chr") };
    case "alteration": return { ...c, text: alterationSql(pin) };
    case "proteinPos": return { ...c, text: str("pos"), order: "pos" };
    // as the screen and the download show it (the rows' vafText), so a search finds the shown number
    case "vaf": return { ...c, text: "vafText", num: num("vaf") };
    // the portal sorts HGVSc by the number after "c." (Hgvsc.tsx), ClinVar by its significance
    case "hgvsc": return { ...c, text: "hgvsc", order: "toInt64OrNull(extract(hgvsc, 'c\\.(-?[0-9]+)'))" };
    case "clinvar": return { ...c, text: "if(clinvar = '' OR clinvarConflicting = '', clinvar, concat(clinvar, '(', clinvarConflicting, ')'))", order: "nullIf(clinvar, '')" };
    case "signal": return { ...c, text: str(SIGNAL_TEXT), order: "signalFreq" };
    // the portal sorts gnomAD by the overall frequency, dbSNP by its id; Functional Impact is not sorted
    case "gnomad": return { ...c, text: str("gnomadFreq"), num: "gnomadFreq" };
    case "dbsnp": return { ...c, text: "rsid", order: "nullIf(rsid, '')" };
    case "functionalImpact": return { ...c, text: "functionalImpact" };
    case "mutationType": return { ...c, ...mutationTypeColumn("mutationType") };
    case "copyNumber": return { ...c, text: "copyNumber", order: "cnv" };
    case "exon": return { ...c, text: str("exon"), order: "toInt32OrNull(splitByChar('/', exon)[1])" };
    case "vafNormal": return { ...c, text: str("vafNormal"), num: num("vafNormal") };
    // shown blank at 0, sorted by the count as stored
    case "normalAltCount": case "normalRefCount": return { ...c, text: str(c.id), num: num(c.id + "Raw") };
    default: return c.numeric ? { ...c, text: str(c.id), num: num(c.id) } : { ...c, text: str(c.id) };
  }
}

/** SIGNAL's frequency at two significant digits, as the portal's download spells it (0 as "0"). */
const SIGNAL_TEXT = "if(signalFreq IS NULL, NULL, if(signalFreq = 0, '0', " +
  "toString(toFloat64(round(toDecimal64(signalFreq, 12), 1 - toInt32(floor(log10(signalFreq))))))))";

/** One (cohort, study) part of a table: the cohort's SQL as that study's resolver compiles it. */
export interface TablePart { cohort: string; study: string; cohortSql: string }

/**
 * A mutation row's driver call. Without `drivers`, OncoKB at the pin (the sample's tumour type's call
 * where one is stored; never a germline mutation, which the portal asks about by HGVSc) or a Cancer
 * Hotspot. With the page's settings (lib/driver-settings.ts), any switched-on source that is offered,
 * as the portal's annotateMutationPutativeDriver: the study's Putative_Driver call, a counted tier,
 * that OncoKB call, a hotspot.
 */
function mutationDrvSql(p: TablePart, db: string, pin: string | null, pins: VariantPins, hot: string, drivers?: ResolvedDrivers): string {
  const oncokb = "(NOT m.germ AND if(tt.found = 1, tt.driver, ifNull(ann.driver, 0)))";
  // the row's Cancer Hotspot match ("0" when none can match), located as the portal locates a variant
  const hotspot = hot !== "0" ? hot : null;
  if (!drivers) return pin ? "toUInt8(" + oncokb + (hotspot ? " OR " + hotspot : "") + ")" : "toUInt8(0)";
  const or: string[] = [];
  if (drivers.custom) or.push("ifNull(m.driverFilter, '') = " + sq(PUTATIVE_DRIVER));
  if (drivers.tiers === null) or.push("ifNull(m.driverTiersFilter, '') != ''");
  else if (drivers.tiers.length) or.push("ifNull(m.driverTiersFilter, '') IN (" + drivers.tiers.map(sq).join(", ") + ")");
  if (drivers.oncokb && pin) or.push(oncokb);
  if (drivers.hotspots && hotspot) or.push(hotspot);
  return unannotatedOrSql(annotatingSql(drivers, offeredSources(drivers, pin, pins).sure, db, p.study), or.length ? "toUInt8(" + or.join(" OR ") + ")" : "toUInt8(0)");
}

/** A part's rows, every column the table has, labelled with its cohort, study and document order. */
function partRows(p: TablePart, i: number, db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql, drivers?: ResolvedDrivers): { ctes: string; rows: string } {
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
    "         referenceAllele AS ref, tumorSeqAllele AS var, tumorAltCount AS altCount, tumorRefCount AS refCount, mutationStatus AS status, proteinPosStart AS pos,\n" +
    "         center, validationStatus AS vs, normalAltCount AS nAlt, normalRefCount AS nRef" +
    (drivers ? ", driverFilter, driverTiersFilter" : "") + "\n" +
    "  FROM " + db + ".mutation_derived\n" +
    "  WHERE " + mutationStudySql(p.study) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + "\n" +
    "    AND molecularProfileId NOT LIKE '%uncalled%' AND " + inCohortSamples("sampleId", "c" + i) + (filter ? "\n    AND " + filter : "") + "\n" +
    "),\n" +
    fusionCtes(p, i, db, gene, pin) +
    // Cancer Type Detailed as the portal's table reads it: the sample's tumour type, the study's for a sample with neither type attribute
    sampleTumorTypeCte("ct" + i, p.study, db, "SELECT sid FROM m" + i + " UNION ALL SELECT sid FROM v" + i) + ",\n" +
    attr("MUTATION_COUNT", "mc" + i) + ",\n" +
    attr("CANCER_TYPE", "cta" + i) + ",\n" +
    copyNumberCte(p, i, db) + ",\n" +
    (pin ? tumorTypeCtes(p, i, db) : "");
  const gn = variantAnnotationCte("g" + i, db, p.study, "SELECT chr, start, end, ref, var FROM m" + i, pins);
  // a Cancer Hotspot (recurrent), the Annotation sort's hotspot element; the store holds no 3D hotspots. A call
  // with any part of its genomic location missing matches none, as the portal's extractGenomicLocation gives it no location
  const located = "ifNull(m.chr, '') != '' AND ifNull(m.start, 0) != 0 AND ifNull(m.end, 0) != 0 AND ifNull(m.ref, '') != '' AND ifNull(m.var, '') != ''";
  const hot = gn && HOTSPOT_GENES.has(gene) ? "(" + located + " AND " + hotspotCondSql("m.mutationType", "ifNull(g.gd, '')") + ")" : "0";
  const rows =
    "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
    "         (SELECT rg.name FROM " + db + ".cancer_study cs JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "          WHERE cs.cancer_study_identifier = " + sq(p.study) + ") AS build,\n" +
    "         m.pid AS patient, m.sid AS sid, nullIf(ct.tumorType, '') AS cancerType, m.proteinChange AS proteinChange,\n" +
    // a germline mutation has no protein-change call: the portal asks OncoKB about it by HGVSc
    // (StoreUtils queryOncoKbData), which this store does not hold
    (pin ? "         if(m.germ, '', if(tt.found = 1, tt.oncogenicity, ann.oncogenicity)) AS oncogenicity, if(m.germ, '', if(tt.found = 1, tt.level, ann.level)) AS level,\n" +
      "         " + ["resistance", "diagnostic", "prognostic"].map((l) => "if(m.germ, '', if(tt.found = 1, tt." + l + "_level, ann." + l + "_level)) AS " + l + "Level").join(", ") + ",\n"
      : "         '' AS oncogenicity, '' AS level, '' AS resistanceLevel, '' AS diagnosticLevel, '' AS prognosticLevel,\n") +
    "         " + mutationDrvSql(p, db, pin, pins, hot, drivers) + " AS drv,\n" +
    "         toUInt8(" + (pin ? hot : "0") + ") AS hot,\n" +
    "         m.mutationType AS mutationType, upper(m.variantType) AS variantType,\n" +
    "         if(m.altCount > 0 AND m.refCount >= 0, m.altCount / (m.altCount + m.refCount), NULL) AS vaf, " + VAF_TEXT + " AS vafText,\n" +
    // none for a 0 frequency, a count of 0 or less blank, as the portal's cells are: they sort and filter as missing
    "         if(m.altCount > 0, m.altCount, NULL) AS altCount, if(m.refCount > 0, m.refCount, NULL) AS refCount,\n" +
    "         toInt64OrNull(mc.v) AS mutCount, m.chr AS chr, m.start AS start, m.end AS end, m.ref AS ref, m.var AS var, m.status AS status, m.pos AS pos,\n" +
    "         " + hgvsgSql("ifNull(m.chr, '')", "ifNull(m.start, 0)", "ifNull(m.end, 0)", "ifNull(m.ref, '')", "ifNull(m.var, '')") + " AS hgvsg,\n" +
    "         " + variantColumnsSql(gn ? "ifNull(g.gd, '')" : "''", gene) + ",\n" +
    "         " + extraColumnsSql(p, db, sq(gene), "m.center", "m.vs", "m.nAlt", "m.nRef") + "\n" +
    "  FROM " + (pin ? "mt" : "m") + i + " AS m\n" +
    (pin ? "  LEFT JOIN ann ON ann.alteration = m.proteinChange\n" +
      "  LEFT JOIN att AS tt ON tt.alteration = m.proteinChange AND tt.consequence = m.consequence AND tt.tumor_type = m.tumorType\n" : "") +
    (gn ? "  LEFT JOIN g" + i + " AS g ON g.chr = m.chr AND g.start = m.start AND g.end = m.end AND g.ref = m.ref AND g.var = m.var\n" : "") +
    "  LEFT JOIN ct" + i + " AS ct ON ct.sid = m.sid LEFT JOIN mc" + i + " AS mc ON mc.sid = m.sid\n" +
    "  LEFT JOIN cta" + i + " AS cta ON cta.sid = m.sid LEFT JOIN cn" + i + " AS cn ON cn.sid = m.sid AND cn.g = " + sq(gene) + "\n";
  return { ctes: ctes + (gn ? gn + ",\n" : ""), rows: rows + "  UNION ALL\n" + fusionRows(p, i, db, gene, pin, pins, oql, drivers) };
}

/**
 * `cn<i>` AS (sid, g, v): each of the part's samples' calls in the study's discrete copy-number profile
 * (the one with the highest id where a study has several), for the gene and the fusion rows' site 1
 * genes. A value that is not a whole number (MSK's −1.5) is no call: the portal's API serves none.
 */
function copyNumberCte(p: TablePart, i: number, db: string): string {
  const pre = sq(p.study + "_");
  return "cn" + i + " AS (SELECT replaceOne(sample_unique_id, " + pre + ", '') AS sid, hugo_gene_symbol AS g, any(" + finiteSql("alteration_value") + ") AS v\n" +
    "  FROM " + db + ".genetic_alteration_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(p.study) + " AND profile_type = " + discreteCnaProfileSql(p.study, db) + "\n" +
    "    AND sample_unique_id IN (SELECT concat(" + pre + ", sid) FROM (SELECT sid FROM m" + i + " UNION ALL SELECT sid FROM v" + i + "))\n" +
    "  GROUP BY sid, g)";
}

/**
 * The columns PR G added, the same for mutation and fusion rows (so their UNION lines up): the row's
 * gene, the study's name, the sample's CANCER_TYPE, its Copy # (the call, and its label as the portal
 * writes it), validation status and centre as stored, the normal allele frequency as the portal shows
 * it (4 decimals below 0.01, else 2; none at 0 or with a count missing), the normal read counts (none at
 * 0, sorted by the count as stored) and the canonical transcript's exon (`tc`, from variantColumnsSql).
 */
function extraColumnsSql(p: TablePart, db: string, gene: string, center: string, vs: string, nAlt: string, nRef: string): string {
  const cnv = "if(cn.v = floor(cn.v), toInt8(cn.v), NULL)";
  const vafN = "if(" + nAlt + " > 0 AND " + nRef + " >= 0, " + nAlt + " / (" + nAlt + " + " + nRef + "), NULL)";
  return gene + " AS gene, (SELECT name FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(p.study) + ") AS studyName, cta.v AS cancerTypeAll,\n" +
    "         " + cnv + " AS cnv, multiIf(cnv IS NULL, '', cnv = 2, 'Amp', cnv = 1, 'Gain', cnv = 0, 'Diploid', cnv = -1, 'ShallowDel', 'DeepDel') AS copyNumber,\n" +
    "         " + vs + " AS validationStatus, " + center + " AS center,\n" +
    "         round(" + vafN + ", if(" + vafN + " < 0.01, 4, 2)) AS vafNormal,\n" +
    "         if(" + nAlt + " > 0, " + nAlt + ", NULL) AS normalAltCount, " + nAlt + " AS normalAltCountRaw,\n" +
    "         if(" + nRef + " > 0, " + nRef + ", NULL) AS normalRefCount, " + nRef + " AS normalRefCountRaw,\n" +
    "         JSONExtractString(tc, 'exon') AS exon";
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
 * variant is never germline for the driver call (ResultsViewPageStoreUtils, isGermline false). Under
 * the query's OQL, the fusions a line of either partner wants (lib/oql.ts oqlFusionFilterSql).
 */
function fusionRows(p: TablePart, i: number, db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql, drivers?: ResolvedDrivers): string {
  const drv = drivers ? unannotatedOrSql(annotatingSql(drivers, offeredSources(drivers, pin, pins).sure, db, p.study), pin && drivers.oncokb ? svDriverSql("vn", "va1", "va2") : "toUInt8(0)")
    : pin ? svDriverSql("vn", "va1", "va2") : "toUInt8(0)";
  const filter = oql ? oqlFusionFilterSql(oql.lines, "v.gene1", "v.gene2", drv) : null;
  return "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord,\n" +
    "         (SELECT rg.name FROM " + db + ".cancer_study cs JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "          WHERE cs.cancer_study_identifier = " + sq(p.study) + ") AS build,\n" +
    "         v.pid AS patient, v.sid AS sid, nullIf(ct.tumorType, '') AS cancerType, " + fusionProteinChangeSql("v.") + " AS proteinChange,\n" +
    // in the mutation rows' column order (the UNION ALL matches by position)
    (pin ? "         " + svCellSql("oncogenicity", "vp", "va1", "va2") + " AS oncogenicity, " + svCellSql("level", "vp", "va1", "va2") + " AS level,\n" +
        "         " + svCellSql("resistance_level", "vp", "va1", "va2") + " AS resistanceLevel, " + svCellSql("diagnostic_level", "vp", "va1", "va2") + " AS diagnosticLevel, " +
        svCellSql("prognostic_level", "vp", "va1", "va2") + " AS prognosticLevel,\n"
      : "         '' AS oncogenicity, '' AS level, '' AS resistanceLevel, '' AS diagnosticLevel, '' AS prognosticLevel,\n") +
    "         " + drv + " AS drv,\n" +
    "         toUInt8(0) AS hot,\n" +
    "         'Fusion' AS mutationType, upper(v.class) AS variantType,\n" +
    "         NULL AS vaf, '' AS vafText, NULL AS altCount, NULL AS refCount,\n" +
    "         toInt64OrNull(mc.v) AS mutCount, v.chr AS chr, v.start AS start, NULL AS end, NULL AS ref, NULL AS var, v.status AS status, NULL AS pos,\n" +
    "         '' AS hgvsg,\n" +
    "         " + variantColumnsSql("''", gene) + ",\n" +
    "         " + extraColumnsSql(p, db, "v.gene1", "'N/A'", "NULL", "NULL", "NULL") + "\n" +
    "  FROM v" + i + " AS v\n" +
    (pin ? "  LEFT JOIN vk" + i + " AS vk ON vk.sid = v.sid\n" +
      "  LEFT JOIN sva AS va1 ON va1.gene = v.gene1 AND v.gene1 != '' LEFT JOIN sva AS va2 ON va2.gene = v.gene2 AND v.gene2 != ''\n" +
      "  LEFT JOIN svp AS vp ON vp.site1_entrez = v.k1 AND vp.site2_entrez = v.k2 AND vp.sv_type = " + svTypeSql("v.") + " AND vp.tumor_type = vk.tumorType\n" +
      "  LEFT JOIN svp AS vn ON vn.site1_entrez = v.k1 AND vn.site2_entrez = v.k2 AND vn.sv_type = " + svTypeSql("v.") + " AND vn.tumor_type = ''\n" : "") +
    "  LEFT JOIN ct" + i + " AS ct ON ct.sid = v.sid LEFT JOIN mc" + i + " AS mc ON mc.sid = v.sid\n" +
    "  LEFT JOIN cta" + i + " AS cta ON cta.sid = v.sid LEFT JOIN cn" + i + " AS cn ON cn.sid = v.sid AND cn.g = v.gene1\n" +
    (filter ? "  WHERE " + filter + "\n" : "");
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

/**
 * Each part's clinical attributes the table's clinical columns read, as one map per sample and one per
 * patient (as lib/clinical-table.ts keeps them), for the rows' samples and patients only.
 */
function clinicalMapCtes(parts: TablePart[], db: string, clinical: ClinicalColumn[]): string {
  // every attribute at both levels: a study records each for its samples or its patients, and two studies may differ
  const attrs = clinical.map((c) => sq(c.id));
  const map = (name: string, per: "sample" | "patient", key: "sid" | "pid") => {
    return name + " AS (\n" + parts.map((p, i) => {
      const pre = sq(p.study + "_"), col = per === "sample" ? "sample_unique_id" : "patient_unique_id";
      return "  SELECT " + sq(p.study) + " AS st, replaceOne(" + col + ", " + pre + ", '') AS k,\n" +
        "         CAST((groupArray(attribute_name), groupArray(attribute_value)), 'Map(String, String)') AS m\n" +
        "  FROM " + clinicalTable(db, clinical.map((c) => c.id)) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(p.study) + " AND type = " + sq(per) +
        (attrs.length ? " AND attribute_name IN (" + attrs.join(", ") + ")" : " AND 0") + " AND attribute_value != ''\n" +
        "    AND " + col + " IN (SELECT concat(" + pre + ", x) FROM (SELECT " + key + " AS x FROM m" + i + " UNION ALL SELECT " + key + " AS x FROM v" + i + "))\n" +
        "  GROUP BY k\n";
    }).join("  UNION ALL\n") + "),\n";
  };
  return map("clins", "sample", "sid") + map("clinp", "patient", "pid");
}

function allRows(parts: TablePart[], db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql, drivers?: ResolvedDrivers, clinical: ClinicalColumn[] = []): string {
  const built = parts.map((p, i) => partRows(p, i, db, gene, pin, pins, oql, drivers));
  return "WITH " +
    (pin
      // each call's fields from one stored answer, its latest; the gene-level store holds no diagnostic or prognostic level (NULL: unknown)
      ? "ann AS (SELECT alteration, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, CAST(NULL AS Nullable(String)) AS diagnostic_level,\n" +
        "    CAST(NULL AS Nullable(String)) AS prognostic_level, toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver\n" +
        "  FROM (SELECT alteration, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c\n" +
        "    FROM " + ONCOKB_TABLE + " WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION' AND hugo_gene_symbol = " + sq(gene) + "\n" +
        "    GROUP BY alteration)),\n" +
        "att AS (SELECT alteration, consequence, tumor_type, c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level, toNullable(c.4) AS diagnostic_level,\n" +
        "    toNullable(c.5) AS prognostic_level, toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found\n" +
        "  FROM (SELECT alteration, consequence, tumor_type, argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level),\n" +
        "      toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c\n" +
        "    FROM " + ONCOKB_TUMOR_TYPE_TABLE + " AS t WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'MUTATION' AND hugo_gene_symbol = " + sq(gene) + "\n" +
        "    GROUP BY alteration, consequence, tumor_type)),\n" +
        // the gene's structural variants' calls, for its fusion rows
        svCallCtes(db, [gene], pin, { gene: "sva", pair: "svp" })
      : "") +
    built.map((b) => b.ctes).join("") +
    (clinical.length
      // the rows with their sample's and patient's attribute maps (CLIN_SAMPLE, CLIN_PATIENT), which the clinical columns read
      ? "rows0 AS (\n" + built.map((b) => b.rows).join("  UNION ALL\n") + "),\n" + clinicalMapCtes(parts, db, clinical) +
        "rows AS (SELECT r.*, cs.m AS " + CLIN_SAMPLE + ", cp.m AS " + CLIN_PATIENT + " FROM rows0 AS r\n" +
        "  LEFT JOIN clins AS cs ON cs.st = r.study AND cs.k = r.sid LEFT JOIN clinp AS cp ON cp.st = r.study AND cp.k = r.patient)\n"
      : "rows AS (\n" + built.map((b) => b.rows).join("  UNION ALL\n") + ")\n");
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
export function mutationRowSource(parts: TablePart[], db: string, gene: string, pin: string | null, pins: VariantPins, oql?: LollipopOql, drivers?: ResolvedDrivers, clinical: ClinicalColumn[] = []): RowSource {
  if (!parts.length) throw new Error("mutationRowSource needs at least one part");
  return {
    with: allRows(parts, db, gene, pin, pins, oql, drivers, clinical),
    columns: [...MUTATION_COLUMNS.map((c) => queryColumn(c, drivers ? true : pin)), ...clinical.map(clinicalQueryColumn)],
    select: "*",
    // the portal's default: Annotation, descending (skin_results_view_tables_default_sort_column)
    defaultOrder: MUTATION_ANNOTATION_ORDER + " DESC, pos ASC NULLS LAST",
    tiebreak: "sid, ord, proteinChange",
    // the same change in one patient's several samples (MutationUtils groupMutationsByGeneAndPatientAndProteinChange; one gene per table)
    duplicateKey: "(study, patient, ifNull(proteinChange, ''))",
    units: { sample: "sid", patient: "patient" },
  };
}

/**
 * The rows one part's table keeps under the query `q` — its search over the shown columns and its
 * column filters — as `(sid, proteinChange, mutationType, rowKeySql)`, the lollipop's own key for a
 * mutation or fusion row: two calls of one change in one sample differ by their genomic position or
 * alleles (a fusion's, by site 1). The table's Alteration and Protein Position filters are left out: they are the grid's
 * and the plot's own selection, which narrow the table alone (the portal's badge counts ignore the
 * badge filter, and a selected codon narrows only the table).
 */
export function mutationRowKeysSql(part: TablePart, db: string, gene: string, pin: string | null, pins: VariantPins, oql: LollipopOql | undefined, q: TableQuery, clinical: ClinicalColumn[] = []): string {
  const src = mutationRowSource([part], db, gene, pin, pins, oql, undefined, clinical);
  return src.with + "SELECT sid, proteinChange, ifNull(mutationType, '') AS mutationType, " + rowKeySql("chr", "start", "end", "ref", "var") + " AS rk FROM rows\n" +
    "WHERE " + whereSql(src, { ...q, filters: Object.fromEntries(Object.entries(q.filters || {}).filter(([id]) => !LOLLIPOP_OWN_FILTERS.has(id))) }, MUTATION_DEFAULT_COLUMNS);
}

/** a row's genomic position and alleles as one string (a fusion: site 1's chromosome and position), the same for the table's rows and the lollipop's */
export const rowKeySql = (chr: string, start: string, end: string, ref: string, alt: string): string =>
  "concat(ifNull(toString(" + chr + "), ''), ':', ifNull(toString(" + start + "), ''), '-', ifNull(toString(" + end + "), ''), ':', ifNull(toString(" + ref + "), ''), '>', ifNull(toString(" + alt + "), ''))";
