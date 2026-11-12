// The public variant annotations the mutation table reads: Genome Nexus's, from the shared store
// `annotation.variant` (docs/ANNOTATION.md), filled offline by `npm run annotate -- genome_nexus` and
// `genome_nexus_grch38`. One source per reference genome; a study reads the source of its own genome,
// at that source's pin, and the pins are echoed in the result.
import { chQuery, isAbortError } from "./ch.ts";
import { sq } from "./compiler.ts";
import { GENOME_NEXUS_SOURCES, SYNC_RUN_TABLE, VARIANT_TABLE, syncedStudiesSql } from "./annotation-store.ts";

export type GenomeBuild = keyof typeof GENOME_NEXUS_SOURCES;
/** each reference genome's Genome Nexus release the store is read at, or null when none is stored */
export type VariantPins = Record<GenomeBuild, string | null>;

const BUILDS = Object.keys(GENOME_NEXUS_SOURCES) as GenomeBuild[];
const PIN_ENV: Record<GenomeBuild, string> = { hg19: "GENOME_NEXUS_PIN", hg38: "GENOME_NEXUS_GRCH38_PIN" };

let pinCache: { at: number; pins: VariantPins } | null = null;
/**
 * The release each Genome Nexus source is read at: its setting (GENOME_NEXUS_PIN,
 * GENOME_NEXUS_GRCH38_PIN), else the release its most recent sync stored. Cached for five minutes; no
 * store, or no access to it, is no pin, and the mutation table then says the columns are empty.
 */
export async function variantPins(): Promise<VariantPins> {
  const set = Object.fromEntries(BUILDS.map((b) => [b, process.env[PIN_ENV[b]] || null])) as VariantPins;
  if (BUILDS.every((b) => set[b])) return set;
  if (!pinCache || Date.now() - pinCache.at >= 5 * 60_000) {
    try {
      const r = await chQuery<{ source: string; v: string }>(
        "SELECT source, argMax(version, started_at) AS v FROM " + SYNC_RUN_TABLE +
        " WHERE source IN (" + BUILDS.map((b) => sq(GENOME_NEXUS_SOURCES[b])).join(", ") + ") AND (annotated_new > 0 OR already_stored > 0) GROUP BY source");
      const by = new Map(r.data.map((x) => [x.source, x.v]));
      pinCache = { at: Date.now(), pins: Object.fromEntries(BUILDS.map((b) => [b, by.get(GENOME_NEXUS_SOURCES[b]) || null])) as VariantPins };
    } catch (e) {
      // a cancelled query is not an answer: caching it would empty the columns for five minutes
      if (isAbortError(e)) throw e;
      pinCache = { at: Date.now(), pins: { hg19: null, hg38: null } };
    }
  }
  return Object.fromEntries(BUILDS.map((b) => [b, set[b] || pinCache!.pins[b]])) as VariantPins;
}

/** "Genome Nexus GRCh37 2.2.3-vep116-clinvar20260208, GRCh38 …": the pins a result read, for its caveat and method */
export function describePins(p: VariantPins): string {
  const named = BUILDS.filter((b) => p[b]).map((b) => (b === "hg19" ? "GRCh37 " : "GRCh38 ") + p[b]);
  return named.length ? "Genome Nexus " + named.join(", ") : "";
}

let synced: { at: number; studies: Set<string> } | null = null;
/** of these studies, those no Genome Nexus sync has covered (their variants are not in the store) */
export async function studiesWithoutVariantAnnotation(studies: string[]): Promise<string[]> {
  if (!synced || Date.now() - synced.at >= 5 * 60_000) {
    try {
      const rows = await Promise.all(BUILDS.map((b) => chQuery<{ study: string }>(syncedStudiesSql(GENOME_NEXUS_SOURCES[b]))));
      synced = { at: Date.now(), studies: new Set(rows.flatMap((r) => r.data.map((x) => x.study))) };
    } catch (e) {
      if (isAbortError(e)) throw e;
      synced = { at: Date.now(), studies: new Set() };
    }
  }
  return studies.filter((s) => !synced!.studies.has(s));
}

/**
 * The stored annotation of each of a part's variants: a CTE `name` of (chr, start, end, ref, var, gd),
 * `gd` the source's JSON, read from the source of `study`'s own reference genome at its pin. `variants`
 * is a SELECT of the part's (chr, start, end, ref, var). Null when neither genome has a pin.
 */
export function variantAnnotationCte(name: string, db: string, study: string, variants: string, pins: VariantPins): string | null {
  const read = BUILDS.filter((b) => pins[b]);
  if (!read.length) return null;
  const sourceOfStudy = "(SELECT multiIf(" + read.map((b) => "rg.name = " + sq(b) + ", " + sq(GENOME_NEXUS_SOURCES[b])).join(", ") + ", '') FROM " +
    db + ".cancer_study cs JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id WHERE cs.cancer_study_identifier = " + sq(study) + ")";
  return name + " AS (SELECT chr, start_position AS start, end_position AS end, reference_allele AS ref, variant_allele AS var, any(data) AS gd\n" +
    "  FROM " + VARIANT_TABLE + "\n" +
    "  WHERE (source, version) IN (" + read.map((b) => "(" + sq(GENOME_NEXUS_SOURCES[b]) + ", " + sq(pins[b]!) + ")").join(", ") + ") AND source = " + sourceOfStudy + "\n" +
    "    AND (chr, start_position, end_position, reference_allele, variant_allele) IN (" + variants + ")\n" +
    "  GROUP BY chr, start, end, ref, var)";
}

/**
 * The columns a mutation row reads off its variant's stored annotation `gd` (empty when it has none),
 * as cBioPortal's mutation table computes them:
 * - `gnOk`: the variant has a stored annotation (false when the store holds none, or Genome Nexus could not annotate it);
 * - `hgvsc`: the consequence on the canonical transcript (MSKCC overrides) of the gene the table lists;
 * - `clinvar`, `clinvarConflicting`, `clinvarId`: ClinVar's clinical significance, its conflicting
 *   classifications, and the variation id (0: ClinVar has no record of the variant);
 * - `signal`: SIGNAL's germline entry (the last whose status names germline), as JSON, and
 *   `signalFreq`, its overall frequency (Σ carriers / Σ patients), when its status is germline;
 * - `tc`: the canonical transcript's consequence, as JSON (SIFT, PolyPhen-2 and AlphaMissense are read off it);
 * - `rsid`: dbSNP's id; `gnomadRaw`, `vcfRaw`, `seqRegion`: gnomAD's counts and what its link is built from,
 *   and `gnomadFreq`, the overall allele frequency as the portal's gnomAD column sorts it;
 * - `maRaw`: MutationAssessor's call; `functionalImpact`: the Functional Impact column as the portal downloads it.
 */
export function variantColumnsSql(gd: string, gene: string): string {
  const tid = "JSONExtractString(" + gd + ", 'canonical', " + sq(gene) + ")";
  const sg = "arrayLast(e -> position(JSONExtractString(e, 'mutationStatus'), 'germline') > 0, JSONExtractArrayRaw(" + gd + ", 'signal'))";
  const counts = (field: string) => "arraySum(arrayMap(c -> JSONExtractFloat(c, " + sq(field) + "), JSONExtractArrayRaw(sig, 'countsByTumorType')))";
  return "JSONExtractBool(" + gd + ", 'ok') AS gnOk,\n" +
    "         arrayFirst(t -> JSONExtractString(t, 'transcriptId') = " + tid + ", JSONExtractArrayRaw(" + gd + ", 'transcripts')) AS tc,\n" +
    "         JSONExtractString(tc, 'hgvsc') AS hgvsc,\n" +
    "         JSONExtractString(" + gd + ", 'clinvar', 'significance') AS clinvar, JSONExtractString(" + gd + ", 'clinvar', 'conflicting') AS clinvarConflicting,\n" +
    "         JSONExtractUInt(" + gd + ", 'clinvar', 'id') AS clinvarId,\n" +
    "         " + sg + " AS sig,\n" +
    "         if(lower(JSONExtractString(sig, 'mutationStatus')) = 'germline' AND " + counts("tumorTypeCount") + " > 0, " +
    counts("variantCount") + " / " + counts("tumorTypeCount") + ", NULL) AS signalFreq,\n" +
    "         JSONExtractString(" + gd + ", 'rsid') AS rsid, JSONExtractRaw(" + gd + ", 'gnomad') AS gnomadRaw, JSONExtractRaw(" + gd + ", 'vcf') AS vcfRaw,\n" +
    "         JSONExtractString(" + gd + ", 'seqRegion') AS seqRegion,\n" +
    "         " + gnomadFreqSql(gd) + " AS gnomadFreq,\n" +
    "         JSONExtractRaw(" + gd + ", 'mutationAssessor') AS maRaw,\n" +
    // the portal spells it for any variant Genome Nexus answered, one it could not annotate included (all NA)
    "         if(" + gd + " != '', " + functionalImpactSql(gd) + ", '') AS functionalImpact";
}

/**
 * gnomAD's overall allele frequency as the portal's gnomAD column sorts it (Gnomad.tsx): with both exome
 * and genome counts, their pooled allele count over their pooled allele number; with one, its stored
 * frequency, or its count over its number; with neither, NULL.
 */
function gnomadFreqSql(gd: string): string {
  const f = (x: string, part: string, key: string) => "JSONExtractFloat(" + gd + ", 'gnomad', '" + x + "', '" + part + "', '" + key + "')";
  const has = (x: string) => "JSONType(" + gd + ", 'gnomad', '" + x + "') = 'Object'";
  const one = (x: string) => "coalesce(JSONExtract(" + gd + ", 'gnomad', '" + x + "', 'alleleFrequency', 'af', 'Nullable(Float64)'), if(" +
    f(x, "alleleNumber", "an") + " > 0, " + f(x, "alleleCount", "ac") + " / " + f(x, "alleleNumber", "an") + ", 0))";
  const an = f("exome", "alleleNumber", "an") + " + " + f("genome", "alleleNumber", "an");
  return "multiIf(" + has("exome") + " AND " + has("genome") + ", if(" + an + " > 0, (" + f("exome", "alleleCount", "ac") + " + " + f("genome", "alleleCount", "ac") + ") / (" + an + "), 0), " +
    has("exome") + ", " + one("exome") + ", " + has("genome") + ", " + one("genome") + ", NULL)";
}

/** a JSON value as JavaScript's template literal prints it: a number as JS writes it, a missing key "undefined", null "null" */
function jsText(json: string, ...path: string[]): string {
  const at = json + ", " + path.map(sq).join(", ");
  return "multiIf(NOT JSONHas(" + at + "), 'undefined', JSONType(" + at + ") = 'Null', 'null', JSONType(" + at + ") IN ('Int64', 'UInt64', 'Double'), " +
    "toString(JSONExtractFloat(" + at + ")), JSONExtractString(" + at + "))";
}

/**
 * The Functional Impact column as the portal downloads it (FunctionalImpactColumnFormatter.download):
 * MutationAssessor, SIFT, PolyPhen-2 and AlphaMissense on the canonical transcript, each "NA" when it has
 * no call, joined by ";".
 */
function functionalImpactSql(gd: string): string {
  const has = (key: string) => "(JSONExtractFloat(tc, '" + key + "') != 0 OR JSONExtractString(tc, '" + key.replace("Score", "Prediction") + "') != '')";
  const part = (label: string, score: string, pred: string) =>
    "concat('" + label + ": ', if(" + has(score) + ", concat('impact: ', " + jsText("tc", pred) + ", ', score: ', " + jsText("tc", score) + "), 'NA'))";
  const am = "(JSONExtractFloat(tc, 'alphaMissense', 'score') != 0 OR JSONExtractString(tc, 'alphaMissense', 'pathogenicity') != '')";
  return "concat(" +
    "concat('MutationAssessor: ', if(JSONType(" + gd + ", 'mutationAssessor') = 'Object', concat('impact: ', " + jsText(gd, "mutationAssessor", "prediction") +
      ", ', score: ', " + jsText(gd, "mutationAssessor", "score") + "), 'NA')), ';', " +
    part("SIFT", "siftScore", "siftPrediction") + ", ';', " + part("Polyphen-2", "polyphenScore", "polyphenPrediction") + ", ';', " +
    "concat('AlphaMissense: ', if(" + am + ", concat('pathogenicity: ', " + jsText("tc", "alphaMissense", "pathogenicity") + ", ', score: ', " + jsText("tc", "alphaMissense", "score") + "), 'NA')))";
}

/**
 * HGVSg as cBioPortal builds it from the mutation's own coordinates (MutationUtils.generateHgvsgByMutation),
 * not from the store: an insertion, a deletion, a substitution, a delins; empty when a part is missing,
 * -1 or NA, or both alleles are '-'.
 */
export function hgvsgSql(chr: string, start: string, end: string, ref: string, alt: string): string {
  const valid = "(" + chr + " != '' AND " + start + " > 0 AND " + end + " > 0 AND " + ref + " NOT IN ('', 'NA') AND " + alt + " NOT IN ('', 'NA') AND NOT (" + ref + " = '-' AND " + alt + " = '-'))";
  const s = "toString(" + start + ")", e = "toString(" + end + ")";
  return "if(" + valid + ", concat(" + chr + ", ':g.', multiIf(" +
    ref + " = '-', concat(" + s + ", '_', " + e + ", 'ins', " + alt + "), " +
    alt + " = '-', if(" + start + " = " + end + ", concat(" + s + ", 'del'), concat(" + s + ", '_', " + e + ", 'del')), " +
    "length(" + ref + ") = 1 AND length(" + alt + ") = 1, concat(" + s + ", " + ref + ", '>', " + alt + "), " +
    "length(" + ref + ") = 1, concat(" + s + ", 'delins', " + alt + "), " +
    "concat(" + s + ", '_', " + e + ", 'delins', " + alt + "))), '')";
}
