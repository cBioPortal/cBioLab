// Cancer Hotspots as a driver source: a mutation is a hotspot when Genome Nexus's record of its
// variant (stored offline in annotation.variant, lib/variant-annotation.ts) holds a recurrent
// hotspot of the kind the mutation is, as cBioPortal decides it (cbioportal-utils
// CancerHotspotsUtils.isLinearClusterHotspot): a splice mutation needs a splice-site hotspot, any
// other a single-residue or in-frame-indel one; 3D hotspots never count. Only the genes the portal
// asks about (lib/hotspot-genes.ts) can be hotspots.
import { sq } from "./compiler.ts";
import { GENOME_NEXUS_SOURCES, VARIANT_TABLE } from "./annotation-store.ts";
import { HOTSPOT_GENE_LIST } from "./hotspot-genes.ts";

export const HOTSPOT_GENES: ReadonlySet<string> = new Set(HOTSPOT_GENE_LIST);

const isSplice = (mutationType: string | null | undefined) => !!mutationType && mutationType.toLowerCase().includes("splice");

/** One mutation's hotspot call from the hotspots its variant's record holds. */
export function isHotspotCall(gene: string | null | undefined, mutationType: string | null | undefined, hotspots: readonly { type?: string | null }[]): boolean {
  // a mutation with no gene symbol is asked about too (filterMutationsOnNonHotspotGenes)
  if (gene && !HOTSPOT_GENES.has(gene)) return false;
  const types = hotspots.map((h) => String(h.type ?? "").toLowerCase());
  return isSplice(mutationType)
    ? types.some((t) => t.includes("splice"))
    : types.some((t) => t.includes("single") || t.includes("indel"));
}

/** the same test as SQL (gene list aside), over a mutation type expression and a variant record's JSON `data` */
export function hotspotCondSql(mutationType: string, data: string): string {
  const list = "JSONExtractArrayRaw(" + data + ", 'hotspots')";
  const has = (words: string[]) => "arrayExists(h -> " + words.map((w) => "positionCaseInsensitive(JSONExtractString(h, 'type'), " + sq(w) + ") > 0").join(" OR ") + ", " + list + ")";
  return "if(positionCaseInsensitive(ifNull(" + mutationType + ", ''), 'splice') > 0, " + has(["splice"]) + ", " + has(["single", "indel"]) + ")";
}

/**
 * The (hugo_gene_symbol, alteration, mutation_type) of the mutations of `studies` (of `genes`, when
 * given) that are hotspots, as SQL — alteration and mutation type spelled as genomic_event_derived
 * spells them, so a driver test over events is a set lookup. Each study's variants are read from its
 * reference genome's Genome Nexus release in `pins`; null when no release is pinned.
 */
export function hotspotKeysSql(db: string, studies: string[], genes: string[] | null, pins: { hg19: string | null; hg38: string | null }): string | null {
  const read = (Object.keys(GENOME_NEXUS_SOURCES) as (keyof typeof GENOME_NEXUS_SOURCES)[]).filter((b) => pins[b]);
  if (!read.length) return null;
  const wanted = (genes ? genes.filter((g) => HOTSPOT_GENES.has(g)) : [...HOTSPOT_GENES]);
  // no study, or no gene the portal asks about: SQL that runs and selects nothing
  const inList = (xs: string[]) => (xs.length ? "IN (" + xs.map(sq).join(", ") + ")" : "IN (NULL) AND 0");
  const sourceOf = "multiIf(" + read.map((b) => "rg.name = " + sq(b) + ", " + sq(GENOME_NEXUS_SOURCES[b])).join(", ") + ", '')";
  const muts =
    "SELECT m.`GENE.hugoGeneSymbol` AS hugo_gene_symbol, m.proteinChange AS alteration, ifNull(m.mutationType, '') AS mutation_type,\n" +
    "      st.src AS src, assumeNotNull(m.chr) AS chr, m.startPosition AS start, m.endPosition AS end,\n" +
    "      assumeNotNull(m.referenceAllele) AS ref, assumeNotNull(m.tumorSeqAllele) AS var\n" +
    "    FROM " + db + ".mutation_derived m\n" +
    "    INNER JOIN (SELECT cs.cancer_study_identifier AS study, " + sourceOf + " AS src FROM " + db + ".cancer_study cs\n" +
    "      JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id\n" +
    "      WHERE cs.cancer_study_identifier " + inList(studies) + ") st ON st.study = m.studyId\n" +
    "    WHERE m.studyId " + inList(studies) + " AND m.`GENE.hugoGeneSymbol` " + inList(wanted) + "\n" +
    // a location only when every part is present and non-empty (MutationUtils.extractGenomicLocation)
    "      AND st.src != '' AND ifNull(m.chr, '') != '' AND ifNull(m.startPosition, 0) != 0 AND ifNull(m.endPosition, 0) != 0\n" +
    "      AND ifNull(m.referenceAllele, '') != '' AND ifNull(m.tumorSeqAllele, '') != '' AND ifNull(m.proteinChange, '') != ''";
  return (
    "SELECT DISTINCT mu.hugo_gene_symbol AS hugo_gene_symbol, mu.alteration AS alteration, mu.mutation_type AS mutation_type FROM (\n" +
    "    " + muts + "\n" +
    "  ) mu\n" +
    "  INNER JOIN (SELECT source, chr, start_position, end_position, reference_allele, variant_allele, any(data) AS d FROM " + VARIANT_TABLE + "\n" +
    "    WHERE (source, version) IN (" + read.map((b) => "(" + sq(GENOME_NEXUS_SOURCES[b]) + ", " + sq(pins[b]!) + ")").join(", ") + ")\n" +
    "      AND JSONLength(data, 'hotspots') > 0\n" +
    "    GROUP BY source, chr, start_position, end_position, reference_allele, variant_allele) v\n" +
    "  ON v.source = mu.src AND v.chr = mu.chr AND v.start_position = mu.start AND v.end_position = mu.end\n" +
    "    AND v.reference_allele = mu.ref AND v.variant_allele = mu.var\n" +
    "  WHERE " + hotspotCondSql("mu.mutation_type", "v.d")
  );
}
