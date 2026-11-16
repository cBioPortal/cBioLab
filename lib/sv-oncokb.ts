// A structural variant's OncoKB calls, read from the version-pinned stores as cBioPortal asks for them,
// shared by the Structural Variants table, the mutation table's fusion rows and the lollipop's counts.
// The per-pair store (packages/annotation-sync oncokb-sv, `annotation.oncokb_sv`) keys a variant by
// its sites' Entrez ids, OncoKB's SV type and a tumour type: the sample's for the call a table cell
// shows, none ('') for the driver call. Where it holds no row for a variant (a study not synced), the
// two partners' gene-level calls stand in (`annotation.oncokb`, alteration 'Fusion').
import { sq } from "./compiler.ts";
import { ONCOKB_SV_TABLE, ONCOKB_TABLE } from "./annotation-store.ts";

/** The queried genes' Entrez ids, as the portal asks for structural variants (fetchStructuralVariantsUsingPOST's entrezGeneIds). */
export const entrezOf = (db: string, genes: string[]) =>
  "SELECT entrez_gene_id FROM " + db + ".gene WHERE hugo_gene_symbol IN (" + genes.map(sq).join(", ") + ")";

/** the SV types OncoKB takes for a one-gene variant, matched exactly (oncokb-frontend-commons deriveStructuralVariantType) */
const ONE_GENE_TYPES = ["DELETION", "TRANSLOCATION", "DUPLICATION", "INSERTION", "INVERSION", "FUSION"];
/** a site's Entrez id as the OncoKB SV store keys it: '' where the site names no gene */
export const siteKey = (col: string) => "if(ifNull(" + col + ", 0) = 0, '', toString(" + col + "))";
/**
 * a row's OncoKB SV type, as the portal derives it: FUSION when both sites name a gene, else the
 * variant's class when it is exactly one of OncoKB's types, else UNKNOWN. `s` prefixes the row's
 * `gene1`, `gene2` and `class` columns.
 */
export const svTypeSql = (s: string) =>
  "if((" + s + "gene1 != '') + (" + s + "gene2 != '') >= 2, 'FUSION', if(ifNull(" + s + "class, '') IN (" + ONE_GENE_TYPES.map(sq).join(", ") + "), " + s + "class, 'UNKNOWN'))";

/**
 * The Mutations tab's protein change for a structural variant (StoreUtils buildProteinChange): "A-B
 * Fusion" for two genes in the order stored; one gene (or the same gene at both sites) "A intragenic",
 * or "A intergenic" when the class is INTERGENIC, or empty, UNKNOWN or NA with the event info
 * "A-intergenic" (both without regard to case). `s` prefixes `gene1`, `gene2`, `class`, `eventInfo`.
 */
export function fusionProteinChangeSql(s: string): string {
  const g1 = s + "gene1", g2 = s + "gene2";
  const one = "if(" + g1 + " != '', " + g1 + ", " + g2 + ")";
  const cls = "upper(ifNull(" + s + "class, ''))";
  const intergenic = "(" + cls + " = 'INTERGENIC' OR (" + cls + " IN ('', 'UNKNOWN', 'NA') AND upper(ifNull(" + s + "eventInfo, '')) = concat(upper(" + one + "), '-INTERGENIC')))";
  return "multiIf(" + g1 + " != '' AND " + g2 + " != '' AND " + g1 + " != " + g2 + ", concat(" + g1 + ", '-', " + g2 + ", ' Fusion'), " +
    g1 + " != '' AND " + g2 + " != '', concat(" + g1 + ", ' intragenic'), " +
    g1 + " != '' OR " + g2 + " != '', concat(" + one + ", if(" + intergenic + ", ' intergenic', ' intragenic')), " +
    "'undefined intragenic')";
}

/**
 * Two CTEs at the pin: `gene` AS (gene, oncogenicity, level, driver), each gene's gene-level 'Fusion'
 * call; `pair` AS (site1_entrez, site2_entrez, sv_type, tumor_type, oncogenicity, level, driver, found),
 * the per-pair calls for the pairs involving one of `genes`. Each ends with ",\n".
 */
export function svCallCtes(db: string, genes: string[], pin: string, names: { gene: string; pair: string }): string {
  const ids = "SELECT toString(entrez_gene_id) FROM (" + entrezOf(db, genes) + ")";
  return names.gene + " AS (SELECT hugo_gene_symbol AS gene, any(oncogenicity) AS oncogenicity, any(highest_sensitive_level) AS level, toUInt8(max(is_driver)) AS driver\n" +
    "  FROM " + ONCOKB_TABLE + " WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'SV' AND alteration = 'Fusion'\n" +
    "  GROUP BY gene),\n" +
    names.pair + " AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, any(t.oncogenicity) AS oncogenicity, any(t.highest_sensitive_level) AS level,\n" +
    "    toUInt8(max(t.oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found\n" +
    "  FROM " + ONCOKB_SV_TABLE + " AS t WHERE oncokb_version = " + sq(pin) + "\n" +
    "    AND (site1_entrez IN (" + ids + ") OR site2_entrez IN (" + ids + "))\n" +
    "  GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type),\n";
}

/**
 * A field (`oncogenicity` or `level`) of the call a cell shows: the pair's row `pr` (joined on the
 * sample's tumour type) when found, else the stronger of the partners' gene-level calls `a1`, `a2`
 * (a driver before a non-driver, gene 1 when they tie).
 */
export const svCellSql = (f: string, pr = "pr", a1 = "a1", a2 = "a2") =>
  "if(" + pr + ".found = 1, " + pr + "." + f + ", if(" + a2 + ".oncogenicity != '' AND (" + a1 + ".oncogenicity = '' OR " + a2 + ".driver > " + a1 + ".driver), " + a2 + "." + f + ", " + a1 + "." + f + "))";

/** Whether the variant is a driver by the pair's row `pr` when found, else by either partner's gene-level call. */
export const svDriverSql = (pr: string, a1 = "a1", a2 = "a2") =>
  "toUInt8(if(" + pr + ".found = 1, " + pr + ".driver, greatest(" + a1 + ".driver, " + a2 + ".driver)))";

/** a genomic_event_derived structural-variant row's key, as svDriverKeySetSql lists the drivers' */
export const SV_EVENT_KEY = "concat(sample_unique_id, '\\t', hugo_gene_symbol, '\\t', sv_event_info)";

/** The keys (SV_EVENT_KEY) of `studies`' structural variants of `genes` that are drivers at the pin. */
export const svDriverKeySetSql = (db: string, pin: string, studies: string[], genes: string[]): string =>
  "SELECT DISTINCT " + SV_EVENT_KEY + " AS k FROM (" + svDriverKeysSql(db, pin, studies) + ") WHERE hugo_gene_symbol IN (" + genes.map(sq).join(", ") + ")";

/**
 * The structural variants that are drivers at the pin, as genomic_event_derived keys their rows
 * (sample_unique_id, hugo_gene_symbol, sv_event_info), one row per partner gene: OncoKB's call for
 * the pair with no tumour type, the query the portal's oncoprint asks (cancerTypeForOncoKb with no
 * tumour types), or, where the store holds no row for the pair (a study not synced), either partner's
 * gene-level Fusion call. `studies` narrows it to those studies' variants.
 */
export function svDriverKeysSql(db: string, pin: string, studies?: string[]): string {
  const only = studies?.length ? " AND cs.cancer_study_identifier IN (" + studies.map(sq).join(", ") + ")" : "";
  const geneCall = (alias: string) =>
    "LEFT JOIN (SELECT hugo_gene_symbol AS gene, toUInt8(max(is_driver)) AS driver FROM " + ONCOKB_TABLE +
    " WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'SV' AND alteration = 'Fusion' GROUP BY gene) " + alias;
  return "SELECT sample_unique_id, hugo_gene_symbol, sv_event_info FROM (\n" +
    "  SELECT v.sample_unique_id AS sample_unique_id, v.event_info AS sv_event_info, [v.gene1, v.gene2] AS genes,\n" +
    "         if(pr.found = 1, pr.driver, greatest(a1.driver, a2.driver)) AS driver\n" +
    "  FROM (SELECT concat(cs.cancer_study_identifier, '_', smp.stable_id) AS sample_unique_id, sv.event_info AS event_info,\n" +
    "               ifNull(g1.hugo_gene_symbol, '') AS gene1, ifNull(g2.hugo_gene_symbol, '') AS gene2, sv.class AS class,\n" +
    "               " + siteKey("sv.site1_entrez_gene_id") + " AS k1, " + siteKey("sv.site2_entrez_gene_id") + " AS k2\n" +
    "        FROM " + db + ".structural_variant sv\n" +
    "        JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = sv.genetic_profile_id\n" +
    "        JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "        JOIN " + db + ".sample smp ON smp.internal_id = sv.sample_id\n" +
    "        LEFT JOIN " + db + ".gene g1 ON g1.entrez_gene_id = sv.site1_entrez_gene_id\n" +
    "        LEFT JOIN " + db + ".gene g2 ON g2.entrez_gene_id = sv.site2_entrez_gene_id\n" +
    "        WHERE gp.genetic_alteration_type = 'STRUCTURAL_VARIANT'" + only + ") v\n" +
    "  LEFT JOIN (SELECT site1_entrez, site2_entrez, sv_type, toUInt8(max(oncogenicity IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'))) AS driver, toUInt8(1) AS found\n" +
    "             FROM " + ONCOKB_SV_TABLE + " WHERE oncokb_version = " + sq(pin) + " AND tumor_type = ''\n" +
    "             GROUP BY site1_entrez, site2_entrez, sv_type) pr\n" +
    "    ON pr.site1_entrez = v.k1 AND pr.site2_entrez = v.k2 AND pr.sv_type = " + svTypeSql("v.") + "\n" +
    "  " + geneCall("a1") + " ON a1.gene = v.gene1\n" +
    "  " + geneCall("a2") + " ON a2.gene = v.gene2\n" +
    ") ARRAY JOIN genes AS hugo_gene_symbol WHERE driver = 1 AND hugo_gene_symbol != ''";
}
