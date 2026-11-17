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
 * Two CTEs at the pin: `gene` AS (gene, oncogenicity, level, resistance_level, diagnostic_level,
 * prognostic_level, driver), each gene's gene-level 'Fusion' call; `pair` AS (site1_entrez, site2_entrez,
 * sv_type, tumor_type, oncogenicity, level, resistance_level, diagnostic_level, prognostic_level, driver,
 * found), the per-pair calls for the pairs involving one of `genes`. `level` is the highest sensitive
 * level. Each call's fields come from one stored answer, its latest (the store is a ReplacingMergeTree
 * that may not have merged a re-sync yet). The gene-level store holds no diagnostic or prognostic
 * level: those are NULL there, unknown rather than none. Each ends with ",\n".
 */
export function svCallCtes(db: string, genes: string[], pin: string, names: { gene: string; pair: string }): string {
  const ids = "SELECT toString(entrez_gene_id) FROM (" + entrezOf(db, genes) + ")";
  const call = "c.1 AS oncogenicity, c.2 AS level, c.3 AS resistance_level";
  return names.gene + " AS (SELECT gene, " + call + ", CAST(NULL AS Nullable(String)) AS diagnostic_level, CAST(NULL AS Nullable(String)) AS prognostic_level,\n" +
    "    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver\n" +
    "  FROM (SELECT hugo_gene_symbol AS gene, argMax(tuple(toString(oncogenicity), toString(highest_sensitive_level), toString(highest_resistance_level)), resolved_at) AS c\n" +
    "    FROM " + ONCOKB_TABLE + " WHERE oncokb_version = " + sq(pin) + " AND alteration_type = 'SV' AND alteration = 'Fusion'\n" +
    "    GROUP BY gene)),\n" +
    names.pair + " AS (SELECT site1_entrez, site2_entrez, sv_type, tumor_type, " + call + ", toNullable(c.4) AS diagnostic_level, toNullable(c.5) AS prognostic_level,\n" +
    "    toUInt8(c.1 IN ('Oncogenic', 'Likely Oncogenic', 'Resistance')) AS driver, toUInt8(1) AS found\n" +
    "  FROM (SELECT site1_entrez, site2_entrez, sv_type, tumor_type,\n" +
    "      argMax(tuple(toString(t.oncogenicity), toString(t.highest_sensitive_level), toString(t.highest_resistance_level), toString(t.highest_diagnostic_level), toString(t.highest_prognostic_level)), t.resolved_at) AS c\n" +
    "    FROM " + ONCOKB_SV_TABLE + " AS t WHERE oncokb_version = " + sq(pin) + "\n" +
    "      AND (site1_entrez IN (" + ids + ") OR site2_entrez IN (" + ids + "))\n" +
    "    GROUP BY site1_entrez, site2_entrez, sv_type, tumor_type)),\n";
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

/**
 * The portal's OncoKB sort value of a call, as SQL: [oncogenic, sensitive level, resistance level, diagnostic
 * level, prognostic level] scored as oncokb-frontend-commons OncoKB.tsx sortValue and OncoKbUtils 367-421
 * score them (Oncogenic, Likely Oncogenic, Resistance 5, else 0; levels 1 6, 2 5, 3A 3, 3B 2, 4 1; R1 3,
 * R2 2, R3 1; Dx1 / Px1 3, 2 2, 3 1; anything else 0). Each argument is a column of the call ("LEVEL_1",
 * "LEVEL_R1", "LEVEL_Dx1" spellings); the array sorts element by element, descending for the portal's order.
 */
export function oncokbSortSql(oncogenicity: string, sensitive: string, resistance: string, diagnostic: string, prognostic: string): string {
  const lvl = (col: string) => "replaceOne(ifNull(" + col + ", ''), 'LEVEL_', '')";
  return "[toFloat64(if(ifNull(" + oncogenicity + ", '') IN ('Oncogenic', 'Likely Oncogenic', 'Resistance'), 5, 0)),\n" +
    "  toFloat64(transform(" + lvl(sensitive) + ", ['1', '2', '3A', '3B', '4'], [6, 5, 3, 2, 1], 0)),\n" +
    "  toFloat64(transform(" + lvl(resistance) + ", ['R1', 'R2', 'R3'], [3, 2, 1], 0)),\n" +
    "  toFloat64(transform(" + lvl(diagnostic) + ", ['Dx1', 'Dx2', 'Dx3'], [3, 2, 1], 0)),\n" +
    "  toFloat64(transform(" + lvl(prognostic) + ", ['Px1', 'Px2', 'Px3'], [3, 2, 1], 0))]";
}

/**
 * The structural-variant table's Annotation order, as SQL over its rows: the portal's
 * [OncoKB sort value, CIViC] (StructuralVariantTable's annotation column; CIViC is off, 0). The portal's
 * last element, whether a gene is an OncoKB cancer gene, waits on that list being stored
 * (lib/annotation-store.ts oncokbCancerGeneSql). Sorted descending, the portal's default.
 */
export const SV_ANNOTATION_ORDER = "arrayConcat(" + oncokbSortSql("oncogenicity", "level", "resistanceLevel", "diagnosticLevel", "prognosticLevel") + ", [toFloat64(0)])";
