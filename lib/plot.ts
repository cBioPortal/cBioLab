// Plots: two axes over the same cases, aggregated INSIDE the database.
//
// The portal's Plots tab fetches every value to the browser and computes correlations,
// quartiles and contingency counts there. Nothing caps the point count, so a warehouse with
// 400,000 samples and ten billion molecular values cannot be plotted at all.
//
// Here the server returns a contract whose size is set by what can be DRAWN, not by what was
// measured: a two-dimensional bin grid for a scatter, per-group quartiles for a box, a
// contingency table for two categoricals. Every statistic — n, Pearson, Spearman, the fitted
// line, the quantiles — is computed where the rows already are, so it is exact rather than
// sampled, and the payload is a few kilobytes whatever the cohort's size.
//
// Everything here is aggregate-only: no query in this module projects an identifier. That is
// what lets an aggregate-only participant answer a plot at all (see docs/DATA-BOUNDARY.md).
import { sq } from "./compiler.ts";
import { DB } from "./ch.ts";
import { STYLE } from "./oncoprint-style.ts";
import { clinicalTable, ATTR_NAME_RE } from "./custom-data.ts";
import { parseOql, oqlCasesSql } from "./oql.ts";
import { OQL_ALTERED, OQL_UNALTERED, OQL_NOT_PROFILED, OQL_SEVERAL, OQL_STATEMENT_CAP, ALTERATION_GENE_SET_CAP } from "./plot-oql.ts";
import { oqlStatements } from "./oql-parse.ts";
import { profiledCasesSql } from "./cohort2.ts";

/** the alteration types a statement must be profiled in before "not matched" can mean "not altered" */
const OQL_PROFILED_TYPES: Partial<Record<string, ("MUTATION" | "CNA" | "SV")[]>> = {
  MUT: ["MUTATION"], CNA: ["CNA"], SV: ["SV"], ANY: ["MUTATION", "CNA", "SV"]
};

/** what goes on one axis */
export type PlotAxis =
  | { source: "clinical"; attribute: string; log?: boolean }
  /**
   * One of the study's own molecular profiles, by its id without the study prefix, and a gene. What
   * the axis is follows from the profile's own type and datatype (lib/profile-catalog.ts): a
   * mutation profile groups cases by mutation type (or `by: "mutated"`), a structural-variant
   * profile by whether the case has one, a discrete copy-number profile by its levels, and a
   * continuous one (expression, z-scores, log2 copy number, protein) is a number. Resolved against
   * the study before it runs (lib/plot-profile.ts) into the forms below; a profile the study does
   * not have is refused by name.
   */
  | { source: "profile"; profile: string; gene: string; by?: "mutationType" | "mutated"; log?: boolean }
  /**
   * The forms a profile axis resolves to, which the engine runs, and which a document may also give
   * directly: one gene's value in a profile (`discrete` reads it as copy-number levels), and below,
   * a gene's alterations from the event table. `label` is what the figure calls the axis.
   */
  | { source: "molecular"; profileType: string; gene: string; log?: boolean; discrete?: boolean; label?: string }
  /**
   * `genes` (2+) asks "is ANY of these altered" as one categorical — a pathway rollup (e.g. a
   * DDR gene set) instead of one gene at a time — and only for `by:"mutated"`: combining several
   * genes' mutation TYPES or copy-number states into one label has no single honest reading, so
   * that combination is refused rather than guessed at. `gene` (singular) is unchanged.
   */
  | { source: "alteration"; gene: string; by?: AlterationBy }
  | { source: "alteration"; genes: string[]; by?: "mutated" }
  /**
   * An OQL query, its statements separated by ";", a new line or ",". `by: "any"` (the default)
   * is one category: "Altered" when the case matches any statement, the portal's own reading of a
   * multi-gene query, "Unaltered" when it matches none and is profiled for every statement's gene,
   * "Not profiled" otherwise. `by: "statement"` gives each statement its own group, a case
   * matching two a group of the pair, three or more "3 or more lines", none "Unaltered" or "Not
   * profiled" by the same rule. Per patient (any of its samples) or per sample, following the unit.
   */
  | { source: "alteration"; oql: string; by?: "any" | "statement" }
  | { source: "none" };
export type AlterationBy = "mutated" | "mutationType" | "cna" | "sv";
const AXIS_SOURCES: readonly string[] = ["clinical", "profile", "molecular", "alteration", "none"] satisfies PlotAxis["source"][];
/** an alteration axis given as an OQL query, rather than as genes */
function isOqlAxis(a: PlotAxis): a is { source: "alteration"; oql: string; by?: "any" | "statement" } {
  return a.source === "alteration" && "oql" in a && a.oql != null;
}
export { OQL_ALTERED, OQL_UNALTERED, OQL_NOT_PROFILED, OQL_SEVERAL, OQL_STATEMENT_CAP, ALTERATION_GENE_SET_CAP };

/** every gene named on an alteration axis, singular or set, uppercased */
function alterationGenes(a: { gene?: string; genes?: string[] }): string[] {
  return (a.genes && a.genes.length ? a.genes : a.gene != null ? [a.gene] : []).map((g) => String(g).toUpperCase());
}
/** a patient-mode category for a patient whose samples carry different values */
export const MULTIPLE = "Multiple";
export type AxisKind = "num" | "cat" | "none";
export type PlotShape = "scatter" | "box" | "table" | "waterfall";

/** how many distinct values a categorical axis may have before the plot is refused */
export const CATEGORY_CAP = 150;
/** the grid a scatter is binned onto: the payload is bounded by this, never by the cohort */
export const DEFAULT_BINS: [number, number] = [240, 160];
export { POINTS_CAP, POINT_LAYER_CAP, LAYER_COLORS, LAYER_BASE, DEFAULT_POINT_LAYERS, POINT_RULE_N, POINT_RULE_N_MAX, layerLabel, type PointLayerSpec } from "./plot-layers.ts";
import { POINTS_CAP, POINT_RULE_N_MAX } from "./plot-layers.ts";
export { isAbsent, jitterFor } from "./plot-draw.ts";
import { isAbsent } from "./plot-draw.ts";
/**
 * Over the points cap, a scatter cell holding at most this many cases is drawn as its cases
 * rather than as a shade: the sparse fringe of the density, which is where the outliers are.
 * The threshold actually used is the largest value up to this whose points fit under the cap
 * (`sparseCellMax`).
 */
export const OUTLIER_CELL_MAX = 3;
/** bins per group in a violin */
export const VIOLIN_BINS = 40;
/** distinct colours a legend can carry before it stops being a legend */
export const COLOR_CAP = 12;

/**
 * The colour for one category. A mutation class or a copy-number state takes the colour the
 * oncoprint gives it, so a missense dot here is the same green as a missense cell there; anything
 * else takes the shared categorical cycle. Renderers never pick a colour of their own.
 */
export function categoryColor(label: string, i = 0): string {
  const l = String(label).toLowerCase();
  // "nothing here" needs to be visible ON WHITE, which the oncoprint's unaltered fill is not:
  // there it sits on a coloured row, here it is a dot on paper.
  if (isAbsent(label)) return STYLE.palette.groupLine;
  if (l === "multiple") return STYLE.palette.text;
  for (const m of STYLE.glyph.mutation.priority) if (m.label.toLowerCase().startsWith(l)) return m.color;
  for (const o of STYLE.glyph.cna.options) if (o.label.toLowerCase() === l) return o.color;
  if (l === "deep deletion") return STYLE.glyph.cna.options.find((o) => /deletion/i.test(o.label))?.color || STYLE.palette.categorical[0];
  const pal = STYLE.palette.categorical;
  return pal[i % pal.length];
}

export interface AxisCtx {
  study: string; db?: string; unit: "patient" | "sample"; cohortSql: string;
  /** what an OQL axis's DRIVER and EXP/PROT terms need, as a cohort's OQL leaf does */
  oncokbPin?: string | null; profiles?: string[];
}

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const ATTR_RE = ATTR_NAME_RE;
const PROFILE_RE = /^[A-Za-z0-9_.-]{1,64}$/;


/** the shape a pair of axes draws as — the portal's own rule, kept deliberately */
export function plotShape(x: AxisKind, y: AxisKind): PlotShape {
  if (x === "none" || y === "none") return "waterfall";
  if (x === "cat" && y === "cat") return "table";
  if (x === "num" && y === "num") return "scatter";
  return "box";
}

/** what an axis is called on the figure */
export function axisLabel(a: PlotAxis): string {
  if (a.source === "clinical") return a.log ? "log10(" + a.attribute + " + 1)" : a.attribute;
  if (a.source === "molecular") {
    const name = a.label || a.gene + " " + a.profileType;
    return a.log ? "log10(" + name + " + 1)" : name;
  }
  if (a.source === "profile") return a.gene + " " + a.profile;
  if (isOqlAxis(a)) {
    const q = oqlStatements(a.oql).join("; ");
    return (q.length > 48 ? q.slice(0, 47) + "…" : q) + (a.by === "statement" ? " (OQL, by line)" : " (OQL)");
  }
  if (a.source === "alteration") {
    const genes = alterationGenes(a);
    const name = genes.length > 1 ? (genes.length <= 4 ? genes.join("/") + " (any)" : genes.length + " genes (any)") : genes[0];
    return name + (a.by === "cna" ? " copy number" : a.by === "sv" ? " structural variant" : a.by === "mutationType" ? " mutation type" : " mutation status");
  }
  return "ordered cases";
}

/**
 * Is this axis numeric or categorical? A clinical attribute is the only one the DATA decides,
 * and only the owning study knows, because it declared the type — so the caller passes what the
 * study's own metadata says rather than sniffing values.
 */
export function axisKind(a: PlotAxis, clinicalKind?: (attr: string) => "num" | "cat" | undefined): AxisKind {
  if (a.source === "none") return "none";
  if (a.source === "profile") throw new Error("a profile axis is read only once resolved against the study's profiles (lib/plot-profile.ts)");
  if (a.source === "molecular") return a.discrete ? "cat" : "num";
  if (a.source === "alteration") return "cat";
  const k = clinicalKind ? clinicalKind(a.attribute) : undefined;
  if (!k) throw new Error("clinical attribute '" + a.attribute + "' is not declared by this study, so its type is unknown");
  return k;
}

export function validateAxis(a: PlotAxis, which: string): void {
  if (!a || typeof a !== "object" || !("source" in a)) throw new Error(which + " axis needs a source");
  if (!AXIS_SOURCES.includes(a.source))
    throw new Error(which + " axis: unknown source '" + String(a.source).slice(0, 40) + "' — use one of " + AXIS_SOURCES.join(", "));
  if (a.source === "clinical" && !ATTR_RE.test(String(a.attribute || "")))
    throw new Error(which + " axis: '" + a.attribute + "' is not a clinical attribute name");
  if (a.source === "profile") {
    if (!PROFILE_RE.test(String(a.profile || ""))) throw new Error(which + " axis: '" + a.profile + "' is not a profile");
    if (!GENE_RE.test(String(a.gene || "").toUpperCase()))
      throw new Error(which + " axis: a profile axis reads one gene; name it");
    if (a.by != null && a.by !== "mutationType" && a.by !== "mutated")
      throw new Error(which + " axis: a mutation profile groups by \"mutationType\" or \"mutated\"; not " + JSON.stringify(a.by));
  }
  if (a.source === "molecular") {
    if (!PROFILE_RE.test(String(a.profileType || ""))) throw new Error(which + " axis: '" + a.profileType + "' is not a profile type");
    // A molecular axis without a gene would ask the database for every gene of every case —
    // 630 million values in this warehouse — to draw one picture. It is refused by name.
    if (!GENE_RE.test(String(a.gene || "").toUpperCase()))
      throw new Error(which + " axis: a molecular axis needs one gene. Plotting a whole profile would read every gene of every case; name the gene you mean.");
  }
  if (isOqlAxis(a)) {
    if ("gene" in a || "genes" in a)
      throw new Error(which + " axis: an OQL axis is the query alone; drop gene and genes");
    if (a.by != null && a.by !== "any" && a.by !== "statement")
      throw new Error(which + " axis: an OQL axis groups by \"any\" (Altered or not) or \"statement\" (one group per line); not " + JSON.stringify(a.by));
    try { parseOql(String(a.oql)); }
    catch (e) { throw new Error(which + " axis: " + (e as Error).message, { cause: e }); }
    const n = oqlStatements(String(a.oql)).length;
    if (a.by === "statement" && n > OQL_STATEMENT_CAP)
      throw new Error(which + " axis: one group per line takes at most " + OQL_STATEMENT_CAP + " lines; this query has " + n);
    return;
  }
  if (a.source === "alteration") {
    const genes = alterationGenes(a);
    if (!genes.length) throw new Error(which + " axis: an alteration axis needs a gene, a gene set, or an OQL query");
    for (const g of genes) if (!GENE_RE.test(g)) throw new Error(which + " axis: '" + g + "' is not a valid gene symbol");
    if (genes.length > ALTERATION_GENE_SET_CAP)
      throw new Error(which + " axis: a gene-set alteration axis takes at most " + ALTERATION_GENE_SET_CAP + " genes; this asks for " + genes.length);
    if ("genes" in a && genes.length > 1 && a.by && a.by !== "mutated")
      throw new Error(which + " axis: a gene SET only supports by:\"mutated\" (any gene altered) — combining several genes' mutation types or copy-number states into one category has no single honest reading");
    if ((a.by as string) === "driver")
      throw new Error("driver-vs-VUS colouring is not supported yet: it needs the version-pinned annotation store joined per event");
  }
}

// ---- one axis as a subquery of (id, value) --------------------------------
// `id` is a case id and never leaves the database: every query below groups it away.

const strip = (col: string, study: string) => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";

/**
 * SELECT id, v — one value per case. A case with no value simply has no row, which is how a
 * pair becomes an inner join and only cases measured on BOTH axes are plotted.
 */
/**
 * A numeric axis with `log: true` reads log10(v + 1): a count of zero stays on the axis, and a
 * value below zero has no such log, so it is left out — NULL, which every caller already treats as
 * "no value" and the plot's coverage line counts.
 */
function logOf(a: PlotAxis, expr: string): string {
  if (!("log" in a && a.log)) return expr;
  return "if(" + expr + " >= 0, log10(" + expr + " + 1), NULL)";
}

export function axisSelect(a: PlotAxis, ctx: AxisCtx, kind: AxisKind = "num"): string {
  const db = ctx.db || DB, study = ctx.study, sample = ctx.unit === "sample";
  const inCohort = (col: string) => strip(col, study) + " IN (SELECT pid FROM cohort)";

  if (a.source === "clinical") {
    // Patient rows and sample rows both exist, and a case's own kind of row wins. In sample mode a
    // patient's value repeats across that patient's samples. In patient mode the patient's samples
    // are combined: a number is their mean, a category is the samples' common value, or "Multiple"
    // when they differ (combineNote says so in the caption).
    // Only the study knows whether the attribute is a number, so the caller says which.
    const val = kind === "num" ? logOf(a, "toFloat64OrNull(attribute_value)") : "attribute_value";
    const valCd = kind === "num" ? logOf(a, "toFloat64OrNull(cd.attribute_value)") : "cd.attribute_value";
    const defined = (e: string) => kind === "num" ? " AND " + e + " IS NOT NULL" : "";
    const own = "SELECT " + strip(sample ? "sample_unique_id" : "patient_unique_id", study) + " AS id, " + val + " AS v, " +
      "1 AS pref\n" +
      "  FROM " + clinicalTable(db, [a.attribute]) + "\n" +
      "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(a.attribute) +
      " AND attribute_value != ''" + defined(val) + "\n    AND type = " + (sample ? "'sample'" : "'patient'") + " AND " + inCohort("patient_unique_id");
    const other = sample
      ? "SELECT " + strip("sd.sample_unique_id", study) + " AS id, " + valCd + " AS v, 0 AS pref\n" +
        "  FROM " + clinicalTable(db, [a.attribute]) + " cd\n" +
        "  JOIN " + db + ".sample_derived sd ON sd.patient_unique_id = cd.patient_unique_id\n" +
        "  WHERE cd.cancer_study_identifier = " + sq(study) + " AND cd.attribute_name = " + sq(a.attribute) +
        " AND cd.attribute_value != ''" + defined(valCd) + "\n    AND cd.type = 'patient' AND " + inCohort("cd.patient_unique_id")
      : "SELECT " + strip("patient_unique_id", study) + " AS id, " + val + " AS v, 0 AS pref\n" +
        "  FROM " + clinicalTable(db, [a.attribute]) + "\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(a.attribute) +
        " AND attribute_value != ''" + defined(val) + "\n    AND type = 'sample' AND " + inCohort("patient_unique_id");
    const combined = kind === "num" ? "avgIf(v, pref = 0)"
      : "if(uniqExactIf(v, pref = 0) > 1, " + sq(MULTIPLE) + ", anyIf(v, pref = 0))";
    return "SELECT id, if(countIf(pref = 1) > 0, anyIf(v, pref = 1), " + combined + ") AS v FROM (\n" + own + "\n  UNION ALL\n" + other + "\n) GROUP BY id";
  }

  if (a.source === "molecular" && a.discrete) {
    // A discrete copy-number profile's own calls, one level per case, labelled as the portal labels
    // them; a value outside the five levels is its own category, as written. In patient mode a
    // patient whose samples disagree is "Multiple", the rule every categorical axis follows.
    const gene = String(a.gene).toUpperCase();
    const level = "multiIf(x = -2, 'Deep deletion', x = -1, 'Shallow deletion', x = 0, 'Diploid', x = 1, 'Gain', x = 2, 'Amplification', toString(x))";
    return "SELECT id, if(uniqExact(lv) > 1, " + sq(MULTIPLE) + ", any(lv)) AS v FROM (\n" +
      "SELECT " + strip(sample ? "sd.sample_unique_id" : "sd.patient_unique_id", study) + " AS id, " + level.replace(/\bx\b/g, "toFloat64OrNull(ga.alteration_value)") + " AS lv\n" +
      "FROM " + db + ".genetic_alteration_derived ga\n" +
      "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
      "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(a.profileType) +
      " AND ga.hugo_gene_symbol = " + sq(gene) + "\n" +
      "  AND toFloat64OrNull(ga.alteration_value) IS NOT NULL AND " + inCohort("sd.patient_unique_id") + ")\n" +
      "GROUP BY id";
  }
  if (a.source === "molecular") {
    const gene = String(a.gene).toUpperCase();
    // patient mode averages a patient's samples, the same rule the oncoprint's heatmap uses; a
    // value the log leaves undefined drops the case, so coverage counts it as having none
    const q = "SELECT " + strip(sample ? "sd.sample_unique_id" : "sd.patient_unique_id", study) + " AS id,\n" +
      "       " + logOf(a, sample ? "argMax(toFloat64OrNull(ga.alteration_value), 1)" : "avg(toFloat64OrNull(ga.alteration_value))") + " AS v\n" +
      "FROM " + db + ".genetic_alteration_derived ga\n" +
      "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
      "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(a.profileType) +
      " AND ga.hugo_gene_symbol = " + sq(gene) + "\n" +
      "  AND toFloat64OrNull(ga.alteration_value) IS NOT NULL AND " + inCohort("sd.patient_unique_id") + "\n" +
      "GROUP BY id";
    return a.log ? "SELECT id, v FROM (" + q + ") WHERE v IS NOT NULL" : q;
  }

  if (isOqlAxis(a)) {
    // Every case in the cohort, so "unaltered" is counted rather than missing. Each statement is
    // matched on its own, and a case it did not match is "Unaltered" only when it is profiled for
    // that statement's gene in every alteration type the statement asks about (panel-aware, as a
    // cohort split decides it); a sample whose panel omits the gene is never counted as wild type.
    // each statement names its group as typed, its gene in capitals
    const statements = oqlStatements(a.oql).map((st) => st.replace(/^[A-Za-z0-9.-]+/, (g) => g.toUpperCase()).replace(/\s+/g, " "));
    const idCol = strip(sample ? "sd.sample_unique_id" : "sd.patient_unique_id", study);
    const o = { oncokbPin: ctx.oncokbPin, profiles: ctx.profiles, study, db, unit: ctx.unit };
    // the case column is `oql_case`, not `id`: ClickHouse would otherwise resolve `id` to another axis's alias
    const matched = statements.map((st) => "oql_case IN (SELECT pid FROM (" + oqlCasesSql(st, o) + "))");
    const profiled = statements.map((st) => {
      const types = [...new Set(parseOql(st)[0].specs.flatMap((sp) => OQL_PROFILED_TYPES[sp.type] || []))];
      const gene = parseOql(st)[0].gene;
      // expression and protein thresholds read a value, not a panel: a case with no value is not matched, and not "not profiled"
      return types.length ? types.map((t) => "oql_case IN (SELECT profiled_id FROM (" + profiledCasesSql(gene, t, { study, db, unit: ctx.unit }) + "))").join(" AND ") : "1";
    });
    const none = "if(" + profiled.map((p) => "(" + p + ")").join(" AND ") + ", " + sq(OQL_UNALTERED) + ", " + sq(OQL_NOT_PROFILED) + ")";
    const value = a.by === "statement"
      ? "multiIf(length(hit) = 0, " + none + ", length(hit) = 1, hit[1], length(hit) = 2, concat(hit[1], ' + ', hit[2]), " + sq(OQL_SEVERAL) + ")"
      : "if(length(hit) > 0, " + sq(OQL_ALTERED) + ", " + none + ")";
    return "SELECT oql_case AS id, " + value + " AS v FROM (\n" +
      "SELECT oql_case, arrayFilter((l, m) -> m, [" + statements.map(sq).join(", ") + "], [" + matched.join(", ") + "]) AS hit FROM (\n" +
      "SELECT DISTINCT " + idCol + " AS oql_case FROM " + db + ".sample_derived sd\n" +
      "WHERE sd.cancer_study_identifier = " + sq(study) + " AND " + inCohort("sd.patient_unique_id") + "))";
  }
  if (a.source === "alteration") {
    const genes = alterationGenes(a), by = a.by || "mutated";
    const idCol = strip(sample ? "sd.sample_unique_id" : "sd.patient_unique_id", study);
    // every case in the cohort appears, because "no alteration" is an answer and not a missing value
    const events = "SELECT sample_unique_id, mutation_type, variant_type, cna_alteration\n" +
      "     FROM " + db + ".genomic_event_derived\n" +
      "     WHERE cancer_study_identifier = " + sq(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
      "       AND mutation_status != 'UNCALLED'"; // read support, not a call (lib/oql.ts specCond)
    const hit = by === "cna" ? "abs(g.cna_alteration) >= 2" : by === "sv" ? "g.variant_type = 'structural_variant'" : "g.variant_type = 'mutation'";
    const value = by === "cna"
      ? "if(countIf(g.cna_alteration >= 2) > 0, 'Amplification', if(countIf(g.cna_alteration <= -2) > 0, 'Deep deletion', 'Neutral'))"
      : by === "sv"
        ? "if(countIf(" + hit + ") > 0, 'Structural variant', 'No structural variant')"
      : by === "mutationType"
        // one class per case; a case carrying two of them is its own honest category
        ? "multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated'," +
          " length(groupUniqArrayIf(" + MUT_CLASS + ", g.variant_type = 'mutation')) > 1, 'Multiple'," +
          " arrayElement(groupUniqArrayIf(" + MUT_CLASS + ", g.variant_type = 'mutation'), 1))"
        : "if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated')";
    // A case with no such alteration is "not mutated" (neutral, no SV) only when it is profiled for
    // every gene of the axis in that alteration type; otherwise it is "Not profiled", never counted
    // as wild type (the panel-aware rule). The case column is alt_case, not id, for the reason the
    // OQL axis's is oql_case.
    const type = by === "cna" ? "CNA" as const : by === "sv" ? "SV" as const : "MUTATION" as const;
    const profiled = genes.map((g) => "alt_case IN (SELECT profiled_id FROM (" + profiledCasesSql(g, type, { study, db, unit: ctx.unit }) + "))").join(" AND ");
    return "SELECT alt_case AS id, if(hits = 0 AND NOT (" + profiled + "), " + sq(OQL_NOT_PROFILED) + ", v0) AS v FROM (\n" +
      "SELECT " + idCol + " AS alt_case, " + value + " AS v0, countIf(" + hit + ") AS hits\n" +
      "FROM " + db + ".sample_derived sd\n" +
      "LEFT JOIN (\n     " + events + "\n) g ON g.sample_unique_id = sd.sample_unique_id\n" +
      "WHERE sd.cancer_study_identifier = " + sq(study) + " AND " + inCohort("sd.patient_unique_id") + "\n" +
      "GROUP BY alt_case)";
  }
  throw new Error("axis source '" + (a as { source: string }).source + "' cannot be selected");
}

/** mutation classes, spelled the way the oncoprint's legend spells them */
const MUT_CLASS =
  "multiIf(lower(g.mutation_type) LIKE 'missense%', 'Missense'," +
  " lower(g.mutation_type) LIKE 'nonsense%' OR lower(g.mutation_type) LIKE 'frame_shift%' OR lower(g.mutation_type) LIKE 'nonstop%', 'Truncating'," +
  " lower(g.mutation_type) LIKE 'splice%', 'Splice'," +
  " lower(g.mutation_type) LIKE 'in_frame%', 'Inframe'," +
  " lower(g.mutation_type) LIKE '5''flank%' OR lower(g.mutation_type) LIKE 'promoter%', 'Promoter', 'Other')";

// ---- the pair, and the four contracts -------------------------------------

const pairCte = (x: string, y: string, cohortSql: string) =>
  "WITH cohort AS (" + cohortSql + "),\n" +
  "     xs AS (" + x + "),\n" +
  "     ys AS (" + y + "),\n" +
  "     pair AS (SELECT xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)\n";

/**
 * How many cases have BOTH axes, and the extremes — one cheap query, run before any binning so
 * a plot can report its size and refuse a scan nobody meant to ask for.
 */
export function plotCountSql(xSel: string, ySel: string, cohortSql: string, numeric: boolean): string {
  return pairCte(xSel, ySel, cohortSql) +
    (numeric
      ? "SELECT count() AS n, min(x) AS x0, max(x) AS x1, min(y) AS y0, max(y) AS y1 FROM pair"
      : "SELECT count() AS n, uniqExact(x) AS kx, uniqExact(y) AS ky FROM pair");
}

/**
 * How many cases the cohort has and how many carry each axis. Only cases measured on BOTH axes
 * are plotted — an inner join, which is right — but a plot that doesn't say how many fell out,
 * and on which axis, reads as being about the whole cohort. Counts only; no id leaves.
 */
export function plotCoverageSql(xSel: string, ySel: string, ctx: AxisCtx): string {
  const db = ctx.db || DB;
  const universe = ctx.unit === "sample"
    ? "SELECT DISTINCT " + strip("sample_unique_id", ctx.study) + " AS id FROM " + db + ".sample_derived\n" +
      "  WHERE cancer_study_identifier = " + sq(ctx.study) + " AND " + strip("patient_unique_id", ctx.study) + " IN (SELECT pid FROM cohort)"
    : "SELECT pid AS id FROM cohort";
  return "WITH cohort AS (" + ctx.cohortSql + "),\n     cases AS (" + universe + "),\n" +
    "     xs AS (" + xSel + "),\n     ys AS (" + ySel + ")\n" +
    "SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny" +
    (ctx.unit === "sample" ? "" : ",\n  (SELECT count() FROM (SELECT patient_unique_id FROM " + db + ".sample_derived\n" +
      "    WHERE cancer_study_identifier = " + sq(ctx.study) + " AND " + strip("patient_unique_id", ctx.study) + " IN (SELECT pid FROM cohort)\n" +
      "    GROUP BY patient_unique_id HAVING count() > 1)) AS multi") +
    " FROM cases";
}

/**
 * In patient mode, how a patient's several samples became one point: said whenever the cohort has
 * such patients, since every kind of axis combines them by its own rule. Empty in sample mode.
 */
export function combineNote(d: PlotData, unit: "patient" | "sample"): string {
  const m = d.coverage?.multi;
  if (unit !== "patient" || !m) return "";
  return m.toLocaleString("en-US") + " patient" + (m === 1 ? " has" : "s have") + " more than one sample: a numeric value is the mean of " +
    (m === 1 ? "its" : "their") + " samples', a category the samples' common value or \u201c" + MULTIPLE + "\u201d where they differ, and an alteration counts if any sample has it.";
}

/** The sentence a plot leads its caption with when the pair left cases out; empty when none were. */
export function coverageNote(d: PlotData, unit: "patient" | "sample"): string {
  const c = d.coverage;
  if (!c || !(c.total > d.n)) return "";
  const f = (n: number) => n.toLocaleString("en-US");
  const miss = [
    c.total - c.nx > 0 ? f(c.total - c.nx) + " have no " + d.x.label : "",
    c.total - c.ny > 0 ? f(c.total - c.ny) + " have no " + d.y.label : ""
  ].filter(Boolean);
  return f(d.n) + " of " + f(c.total) + " " + unit + "s have a value on both axes" +
    (miss.length ? " (" + miss.join("; ") + ")" : "") + "; only those are drawn.";
}

/** exact statistics over every point: both coefficients and the least-squares line */
export function plotStatsSql(xSel: string, ySel: string, cohortSql: string): string {
  return pairCte(xSel, ySel, cohortSql) +
    "SELECT count() AS n, corr(x, y) AS pearson, rankCorr(x, y) AS spearman,\n" +
    "       simpleLinearRegression(x, y).1 AS slope, simpleLinearRegression(x, y).2 AS intercept\n" +
    "FROM pair";
}

/**
 * Six sums over every point — the federated counterpart of plotStatsSql. n, Σx, Σy, Σxy, Σx², Σy²
 * are additive across sites and sufficient for Pearson's r and the OLS line (lib/stats.ts's
 * pearsonFromMoments / regressionFromMoments), the same sufficient-statistic argument
 * pairMomentsSql already makes for co-expression. Spearman is deliberately not here: a rank
 * correlation needs the pooled GLOBAL ranking, which no per-site aggregate can reconstruct.
 */
export function plotMomentsSql(xSel: string, ySel: string, cohortSql: string): string {
  return pairCte(xSel, ySel, cohortSql) +
    "SELECT count() AS n, sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx, sum(y * y) AS syy\n" +
    "FROM pair";
}

/**
 * The scatter, as counts per cell. The grid is fixed, so the answer is bounded: 240x160 can
 * hold 38,400 cells and real data fills a couple of thousand of them.
 *
 * `extent`, when given, replaces each site's own min/max with a caller-supplied one shared across
 * every participant in a federated plot — otherwise cell (5,3) means a different (x,y) range at
 * each site, and summing them draws a picture of neither. Omitted for a single-study plot, which
 * still bins over its own range exactly as before.
 */
export function plotBinsSql(xSel: string, ySel: string, cohortSql: string, bins: [number, number] = DEFAULT_BINS,
  extent?: { x0: number; x1: number; y0: number; y1: number }): string {
  const [bx, by] = clampGrid(bins);
  const eCte = extent
    ? ",    e AS (SELECT " + num(extent.x0) + " AS x0, " + num(extent.x1) + " AS x1, " +
        num(extent.y0) + " AS y0, " + num(extent.y1) + " AS y1)\n"
    : ",    e AS (SELECT min(x) x0, max(x) x1, min(y) y0, max(y) y1 FROM pair)\n";
  return pairCte(xSel, ySel, cohortSql) + eCte +
    "SELECT " + binIndex("x", bx) + " AS bx,\n" +
    "       " + binIndex("y", by) + " AS by,\n" +
    "       count() AS n\n" +
    "FROM pair, e GROUP BY bx, by";
}

/** the grid a request asks for, held to what a figure can draw */
function clampGrid(bins: [number, number]): [number, number] {
  return [Math.max(2, Math.min(600, Math.round(bins[0]))), Math.max(2, Math.min(600, Math.round(bins[1])))];
}

/**
 * Which of `n` cells a value falls in, against the extent CTE `e`. One expression for the
 * density and for the sparse-cell points, so a point is never assigned a cell the density did
 * not count it in.
 */
function binIndex(col: "x" | "y", n: number): string {
  return "least(" + (n - 1) + ", toUInt32(floor((" + col + " - " + col + "0) / nullIf(" + col + "1 - " + col + "0, 0) * " + n + ")))";
}

/**
 * The cell threshold for a scatter's outlier points: the largest k up to `max` such that every
 * case in a cell of at most k cases fits under `cap` points. 0 when even the cells of one case
 * hold more than `cap` — then no subset is drawn, and the caller says so rather than drawing
 * some of them.
 */
export function sparseCellMax(bins: { n: number }[], cap: number, max = OUTLIER_CELL_MAX): number {
  let k = 0;
  for (let t = 1; t <= max; t++) {
    const cases = bins.reduce((a, b) => b.n <= t ? a + b.n : a, 0);
    if (cases > cap) break;
    k = t;
  }
  return k;
}

/** a finite number as a SQL literal — extents and whiskers cross this module's boundary as numbers, never strings */
function num(x: number): string {
  if (!Number.isFinite(x)) throw new Error("a plot's extent and whiskers must be finite numbers");
  return String(x);
}

/** per category: the count, the quartiles and the extremes — everything a box needs */
export function plotBoxSql(numSel: string, catSel: string, cohortSql: string): string {
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "     vs AS (" + numSel + "),\n" +
    "     gs AS (" + catSel + ")\n" +
    "SELECT gs.v AS g, count() AS n, min(vs.v) AS lo, max(vs.v) AS hi,\n" +
    "       quantilesExact(0.25, 0.5, 0.75)(vs.v) AS q\n" +
    "FROM vs INNER JOIN gs ON gs.id = vs.id\n" +
    "GROUP BY g ORDER BY n DESC LIMIT " + (CATEGORY_CAP + 1);
}

/**
 * The values behind a box, as a density per group — bins, not points, so this is an aggregate
 * and stays answerable by a participant that may not disclose a case.
 */
export function plotViolinSql(numSel: string, catSel: string, cohortSql: string, bins = VIOLIN_BINS, colorSel?: string): string {
  const b = Math.max(4, Math.min(200, Math.round(bins)));
  // Cut the bins over the middle 99% rather than min..max. One mutation count of 25,697 would
  // otherwise put every other value in bin 0, and the density would be a solid block. The box
  // is drawn between its whiskers, and the renderer clips whatever falls outside.
  // With a colour, the density splits by class: the key gains one dimension and the payload
  // stays bounded by groups x bins x classes rather than by the cohort.
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "     vs AS (" + numSel + "),\n" +
    "     gs AS (" + catSel + ")" + (colorSel ? ",\n     cs AS (" + colorSel + ")" : "") + ",\n" +
    "     j AS (SELECT gs.v AS g, vs.v AS x" + (colorSel ? ", cs.v AS c" : "") + " FROM vs INNER JOIN gs ON gs.id = vs.id" +
      (colorSel ? "\n            LEFT JOIN cs ON cs.id = vs.id" : "") + "),\n" +
    "     e AS (SELECT quantileExact(0.005)(x) x0, quantileExact(0.995)(x) x1 FROM j)\n" +
    // the extent travels with the bins: a box is drawn between its whiskers, so the renderer
    // needs to know what value a bin index stands for rather than assuming it spans the axis
    "SELECT g, least(" + (b - 1) + ", toUInt32(floor((x - x0) / nullIf(x1 - x0, 0) * " + b + "))) AS b, " +
      (colorSel ? "c, " : "") + "count() AS n, any(x0) AS vx0, any(x1) AS vx1\n" +
    "FROM j, e GROUP BY g, b" + (colorSel ? ", c" : "");
}

/**
 * The points behind a box, WITH their case ids, so a reader can find one.
 *
 * This is the only query in this module that returns an identifier, and it is deliberately not
 * exported through lib/federation.ts with the aggregate builders: it is reachable solely from
 * `PatientLevelResolver`, the participant whose entitlement is to see cases. An aggregate-only
 * site has no method that could call it — see docs/DATA-BOUNDARY.md.
 */
export function plotPointsSql(numSel: string, catSel: string, cohortSql: string, cap = POINTS_CAP,
  colorSel?: string, ringSel?: string, outside?: Whiskers[]): string {
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "     vs AS (" + numSel + "),\n" +
    "     gs AS (" + catSel + ")" +
    (colorSel ? ",\n     cs AS (" + colorSel + ")" : "") +
    (ringSel ? ",\n     rs AS (" + ringSel + ")" : "") + "\n" +
    "SELECT vs.id AS id, gs.v AS g, vs.v AS v" + (colorSel ? ", cs.v AS c" : "") + (ringSel ? ", rs.v AS r" : "") + "\n" +
    "FROM vs INNER JOIN gs ON gs.id = vs.id" +
    (colorSel ? "\n  LEFT JOIN cs ON cs.id = vs.id" : "") +
    (ringSel ? "\n  LEFT JOIN rs ON rs.id = vs.id" : "") + "\n" +
    (outside ? outsideWhiskers(outside) + "\n" : "") +
    "LIMIT " + (Math.max(1, Math.min(50000, Math.round(cap))) + 1);
}

/**
 * A ranked layer's points, WITH their case ids: the `n` highest and `n` lowest values of one axis
 * (per group on a box), or on a scatter the `n` cases furthest from the fitted line. Returns ids,
 * so like plotPointsSql it stays out of lib/federation.ts's aggregate builders and is reachable
 * only from `PatientLevelResolver`. Bounded by `n`, so no cap is needed.
 */
export function plotRankedPointsSql(xSel: string, ySel: string, cohortSql: string, shape: "scatter" | "box",
  numFirst: boolean, rank: PointRank): string {
  const n = Math.max(1, Math.min(POINT_RULE_N_MAX, Math.round(rank.n)));
  const head = pairIdCte(xSel, ySel, cohortSql);
  if (shape === "box") {
    // the numeric axis is the value, the categorical one the group, whichever the document put first
    const cols = numFirst ? "id, y AS g, x AS v" : "id, x AS g, y AS v";
    return head + "SELECT * FROM (\n" +
      "  (SELECT " + cols + " FROM pair ORDER BY v DESC, id LIMIT " + n + " BY g)\n  UNION DISTINCT\n" +
      "  (SELECT " + cols + " FROM pair ORDER BY v ASC, id LIMIT " + n + " BY g))";
  }
  if (rank.by === "residual")
    return head + "SELECT id, x, y FROM pair ORDER BY abs(y - (" + num(rank.intercept) + " + " + num(rank.slope) + " * x)) DESC, id LIMIT " + n;
  const col = rank.by;
  return head + "SELECT * FROM (\n" +
    "  (SELECT id, x, y FROM pair ORDER BY " + col + " DESC, id LIMIT " + n + ")\n  UNION DISTINCT\n" +
    "  (SELECT id, x, y FROM pair ORDER BY " + col + " ASC, id LIMIT " + n + "))";
}

/** the pair of axes per case, keeping the case id: the start of every id-returning plot query */
const pairIdCte = (x: string, y: string, cohortSql: string) =>
  "WITH cohort AS (" + cohortSql + "),\n" +
  "     xs AS (" + x + "),\n" +
  "     ys AS (" + y + "),\n" +
  "     pair AS (SELECT xs.id AS id, xs.v AS x, ys.v AS y FROM xs INNER JOIN ys ON ys.id = xs.id)\n";

/** one group's whiskers, which is all a box's outlier query needs to know about it */
export interface Whiskers { g: string; loWhisker: number; hiWhisker: number }

/**
 * WHERE a value lies beyond its own group's Tukey whiskers. The whiskers were computed by the
 * box query and cross back in as literals, a group label quoted and a bound a finite number. A
 * group not listed has no whiskers to be outside of, so none of its values match.
 */
function outsideWhiskers(ws: Whiskers[]): string {
  if (!ws.length) return "WHERE 0";
  const at = "indexOf([" + ws.map((w) => sq(w.g)).join(", ") + "], gs.v)";
  const arr = (f: (w: Whiskers) => number) => "[" + ws.map((w) => num(f(w))).join(", ") + "]";
  return "WHERE " + at + " > 0 AND (vs.v < arrayElement(" + arr((w) => w.loWhisker) + ", " + at + ")" +
    " OR vs.v > arrayElement(" + arr((w) => w.hiWhisker) + ", " + at + "))";
}

/**
 * The cases of a plotted cohort that are also in a highlight cohort: the plotted cohort's SQL
 * narrowed by the highlight's. A cohort expression like any other (it projects `pid`), so the
 * aggregate builders take it unchanged and a highlight is answered by the same queries as the
 * figure under it.
 */
export function highlightCohortSql(cohortSql: string, highlightSql: string): string {
  return "SELECT pid FROM (" + cohortSql + ") WHERE pid IN (SELECT pid FROM (" + highlightSql + "))";
}

/** how many patients of a highlight are in the plotted cohort — a count, so any participant may answer */
export function plotHighlightCountSql(cohortSql: string, highlightSql: string): string {
  return "SELECT count() AS n FROM (" + highlightCohortSql(cohortSql, highlightSql) + ")";
}

/**
 * A scatter's points, WITH their case ids — the highlight layer drawn over the density.
 * Like plotPointsSql it returns identifiers, so it stays out of lib/federation.ts's aggregate
 * builders and is reachable only from `PatientLevelResolver`.
 */
export function plotScatterPointsSql(xSel: string, ySel: string, cohortSql: string, cap = POINTS_CAP,
  sparse?: SparseCells): string {
  const limit = "LIMIT " + (Math.max(1, Math.min(50000, Math.round(cap))) + 1);
  if (!sparse) return "WITH cohort AS (" + cohortSql + "),\n" +
    "     xs AS (" + xSel + "),\n" +
    "     ys AS (" + ySel + ")\n" +
    "SELECT xs.id AS id, xs.v AS x, ys.v AS y\n" +
    "FROM xs INNER JOIN ys ON ys.id = xs.id\n" + limit;
  // the cases of every cell holding at most `cellMax` of them, binned exactly as plotBinsSql
  // bins the density over the same extent and grid
  const [bx, by] = clampGrid(sparse.grid), e = sparse.extent;
  if (!(sparse.cellMax >= 1)) throw new Error("plotScatterPointsSql: cellMax must be at least 1");
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "     xs AS (" + xSel + "),\n" +
    "     ys AS (" + ySel + "),\n" +
    "     e AS (SELECT " + num(e.x0) + " AS x0, " + num(e.x1) + " AS x1, " + num(e.y0) + " AS y0, " + num(e.y1) + " AS y1),\n" +
    "     c AS (SELECT xs.id AS id, xs.v AS x, ys.v AS y, " + binIndex("x", bx) + " AS bx, " + binIndex("y", by) + " AS by\n" +
    "           FROM xs INNER JOIN ys ON ys.id = xs.id, e),\n" +
    "     sparse AS (SELECT bx, by FROM c GROUP BY bx, by HAVING count() <= " + Math.round(sparse.cellMax) + ")\n" +
    "SELECT id, x, y FROM c WHERE (bx, by) IN (SELECT bx, by FROM sparse)\n" + limit;
}

/** which cells of a scatter's density are drawn as their cases: the plot's own grid and extent, and the threshold */
export interface SparseCells { grid: [number, number]; extent: { x0: number; x1: number; y0: number; y1: number }; cellMax: number }

/** the contingency table, one row per occupied cell */
export function plotTableSql(xSel: string, ySel: string, cohortSql: string): string {
  return pairCte(xSel, ySel, cohortSql) +
    // no row cap below the whole table: callers refuse a pair past CATEGORY_CAP per axis first,
    // so CATEGORY_CAP² bounds it, and a table missing its smallest cells would be a wrong one
    "SELECT x AS cx, y AS cy, count() AS n FROM pair GROUP BY cx, cy ORDER BY n DESC LIMIT " + CATEGORY_CAP * CATEGORY_CAP;
}

// ---- pure helpers, shared with the renderers -------------------------------

/** Tukey's fences: the whiskers reach the furthest value inside 1.5 x IQR, as the portal's do. */
export function tukey(q1: number, q3: number, lo: number, hi: number): { loWhisker: number; hiWhisker: number; iqr: number } {
  const iqr = q3 - q1;
  return { loWhisker: Math.max(lo, q1 - 1.5 * iqr), hiWhisker: Math.min(hi, q3 + 1.5 * iqr), iqr };
}

/**
 * A two-sided p-value for a correlation coefficient, from Student's t on n-2 degrees of
 * freedom — the same test the portal applies to the same coefficients.
 */
export function corrPValue(r: number | null, n: number): number | null {
  if (r == null || !Number.isFinite(r) || n <= 2) return null;
  if (Math.abs(r) >= 1) return 0;
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * studentTail(t, n - 2);
}

/** upper tail of Student's t, by the incomplete beta function */
function studentTail(t: number, df: number): number {
  const x = df / (df + t * t);
  return 0.5 * incBeta(x, df / 2, 0.5);
}
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // the continued fraction below converges only on this side; the identity covers the other
  if (x > (a + 1) / (a + b + 2)) return 1 - incBeta(1 - x, b, a);
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    const num = i === 0 ? 1 : i % 2 === 0
      ? (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
      : -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d; f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  return front * (f - 1);
}
function lgamma(z: number): number {
  // eslint-disable-next-line no-loss-of-precision -- the published coefficients, digit for digit
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const x = z;
  let y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  // eslint-disable-next-line no-loss-of-precision -- the published coefficients, digit for digit
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// ---- the contract a plot returns -------------------------------------------
/** what a plot asks for; the shape it draws as is decided from the axes, not requested */
/** one drawn value, with its case id and whatever it is coloured by */
export interface PlotPoint { id: string; g: string; v: number; c?: string; r?: string }
/** one drawn scatter case, with its id */
export interface PlotXYPoint { id: string; x: number; y: number }
/**
 * Whether the plotted cohort's own cases are drawn as points. `all`: every case, at or under the
 * points cap. `none`: density alone, and `why` says why. Subsets drawn in colour over it are the
 * view's point layers (`PlotLayer`).
 */
export interface PointSet {
  rule: "all" | "none";
  /** points drawn */
  drawn: number;
  why?: string;
}

/** how a ranked layer orders the cases: by one axis's value (per group on a box), or by distance from the fitted line */
export type PointRank = { by: "x" | "y"; n: number } | { by: "residual"; n: number; slope: number; intercept: number };

/** A point layer as drawn: what it holds, how many of its cases are on the figure, and as what. */
export interface PlotLayer {
  kind: "outliers" | "extremes" | "trend" | "cohort";
  /** what the key calls it */
  label: string;
  color: string;
  /** a cohort layer: the cohort, its patients, and how many of them are in the plotted cohort */
  name?: string;
  patients?: number;
  inPlot?: number;
  /** the layer's cases with a value on both axes, in the plot's unit */
  n: number;
  /** points drawn, once cases an earlier layer already drew are left to it */
  drawn?: number;
  /** the layer's cases an earlier layer drew: hidden on the figure, shown when the layer that drew them is hidden */
  shared?: HighlightPoint[];
  /** for each shared case, the place in the list of the layer that drew it */
  sharedOwners?: number[];
  shown: "points" | "density" | "boxes" | "none";
  /** why it is not drawn as points, when it is not */
  why?: string;
  points?: HighlightPoint[];
  bins?: { bx: number; by: number; n: number }[];
  groups?: PlotGroup[];
  /** a scatter's outliers: the cells holding at most this many cases, left unshaded under their points */
  cellMax?: number;
}

export interface PlotRequest {
  x: PlotAxis; y: PlotAxis; unit?: "patient" | "sample"; bins?: [number, number];
  /** colour the values by a category: the fill, and optionally a ring, as the portal does */
  colorBy?: PlotAxis; ringBy?: PlotAxis;
}
/** one highlighted case: a scatter's (x, y), or a box's group and value */
export type HighlightPoint = { id: string; x: number; y: number } | { id: string; g: string; v: number };
export interface PlotGroup { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number; loWhisker: number; hiWhisker: number }
export interface PlotData {
  shape: "scatter" | "box" | "table";
  n: number;
  /** `log`: the axis carries log10(v + 1), so the figure labels its ticks in the original units */
  x: { label: string; kind: AxisKind; log?: boolean };
  y: { label: string; kind: AxisKind; log?: boolean };
  extent?: { x0: number; x1: number; y0: number; y1: number };
  grid?: [number, number];
  bins?: { bx: number; by: number; n: number }[];
  stats?: { pearson: number | null; spearman: number | null; slope: number | null; intercept: number | null;
            pPearson: number | null; pSpearman: number | null };
  groups?: PlotGroup[];
  /** the values behind the boxes: every one, when few enough and the reader may see cases */
  points?: PlotPoint[];
  /** a scatter's cases drawn as points: every one, when few enough and the reader may see cases */
  xyPoints?: PlotXYPoint[];
  /** whether the plotted cohort's own cases are points, how many, and why not when they are not */
  pointSet?: PointSet;
  violin?: { g: string; b: number; n: number; c?: string }[];
  /** what the colours mean: the fill category, the ring category, and the key to draw */
  colorLabel?: string;
  ringLabel?: string;
  legend?: { label: string; color: string; ring?: boolean }[];
  violinBins?: number;
  /** the value range the violin's bins were cut over, which is not the range the box is drawn on */
  violinExtent?: [number, number];
  /** which of the two the figure is drawing, and why — the caption says so too */
  overlay?: "points" | "violin" | "none";
  cells?: { cx: string; cy: string; n: number }[];
  note?: string;
  /** cases in the cohort, how many have each axis, and (patient mode) how many patients have several samples */
  coverage?: { total: number; nx: number; ny: number; multi?: number };
  /** the point layers drawn over the plot, in the view's order (the first holds a case two share) */
  layers?: PlotLayer[];
}
