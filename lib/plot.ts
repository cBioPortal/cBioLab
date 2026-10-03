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

/** what goes on one axis */
export type PlotAxis =
  | { source: "clinical"; attribute: string; log?: boolean }
  | { source: "molecular"; profileType: string; gene: string; log?: boolean }
  /**
   * `genes` (2+) asks "is ANY of these altered" as one categorical — a pathway rollup (e.g. a
   * DDR gene set) instead of one gene at a time — and only for `by:"mutated"`: combining several
   * genes' mutation TYPES or copy-number states into one label has no single honest reading, so
   * that combination is refused rather than guessed at. `gene` (singular) is unchanged.
   */
  | { source: "alteration"; gene: string; by?: AlterationBy }
  | { source: "alteration"; genes: string[]; by?: "mutated" }
  | { source: "none" };
export type AlterationBy = "mutated" | "mutationType" | "cna";
const AXIS_SOURCES: readonly string[] = ["clinical", "molecular", "alteration", "none"] satisfies PlotAxis["source"][];
/** every gene named on an alteration axis, singular or set, uppercased */
function alterationGenes(a: { gene?: string; genes?: string[] }): string[] {
  return (a.genes && a.genes.length ? a.genes : a.gene != null ? [a.gene] : []).map((g) => String(g).toUpperCase());
}
/** a gene-set alteration axis takes at most this many genes */
export const ALTERATION_GENE_SET_CAP = 20;
export type AxisKind = "num" | "cat" | "none";
export type PlotShape = "scatter" | "box" | "table" | "waterfall";

/** how many distinct values a categorical axis may have before the plot is refused */
export const CATEGORY_CAP = 150;
/** the grid a scatter is binned onto: the payload is bounded by this, never by the cohort */
export const DEFAULT_BINS: [number, number] = [240, 160];
/**
 * How many points a box plot will draw over its boxes before it stops being a drawing. Above
 * this the same values come back as a violin: 290,000 jittered dots are a solid block, and the
 * density is both smaller to send and what the reader was looking for.
 */
export const POINTS_CAP = 5000;
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

export interface AxisCtx { study: string; db?: string; unit: "patient" | "sample"; cohortSql: string }

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const ATTR_RE = ATTR_NAME_RE;
const PROFILE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** categories that mean "this case has none of that", which draw as neutral and never as a ring */
export function isAbsent(label: string): boolean {
  return /^(not mutated|neutral|no data|wild type|none|)$/i.test(String(label).trim());
}

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
  if (a.source === "molecular") return a.log ? "log10(" + a.gene + " " + a.profileType + " + 1)" : a.gene + " " + a.profileType;
  if (a.source === "alteration") {
    const genes = alterationGenes(a);
    const name = genes.length > 1 ? (genes.length <= 4 ? genes.join("/") + " (any)" : genes.length + " genes (any)") : genes[0];
    return name + (a.by === "cna" ? " copy number" : a.by === "mutationType" ? " mutation type" : " mutation status");
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
  if (a.source === "molecular") return "num";
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
  if (a.source === "molecular") {
    if (!PROFILE_RE.test(String(a.profileType || ""))) throw new Error(which + " axis: '" + a.profileType + "' is not a profile type");
    // A molecular axis without a gene would ask the database for every gene of every case —
    // 630 million values in this warehouse — to draw one picture. It is refused by name.
    if (!GENE_RE.test(String(a.gene || "").toUpperCase()))
      throw new Error(which + " axis: a molecular axis needs one gene. Plotting a whole profile would read every gene of every case; name the gene you mean.");
  }
  if (a.source === "alteration") {
    const genes = alterationGenes(a);
    if (!genes.length) throw new Error(which + " axis: an alteration axis needs a gene, or a gene set");
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
    // patient rows and sample rows both exist; in sample mode a patient's value repeats across
    // that patient's samples, in patient mode a sample's value stands in for the patient.
    // Only the study knows whether the attribute is a number, so the caller says which.
    const val = kind === "num" ? logOf(a, "toFloat64OrNull(attribute_value)") : "attribute_value";
    const valCd = kind === "num" ? logOf(a, "toFloat64OrNull(cd.attribute_value)") : "cd.attribute_value";
    const defined = (e: string) => kind === "num" ? " AND " + e + " IS NOT NULL" : "";
    const own = "SELECT " + strip(sample ? "sample_unique_id" : "patient_unique_id", study) + " AS id, " + val + " AS v, " +
      (sample ? "1" : "1") + " AS pref\n" +
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
    return "SELECT id, argMax(v, pref) AS v FROM (\n" + own + "\n  UNION ALL\n" + other + "\n) GROUP BY id";
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

  if (a.source === "alteration") {
    const genes = alterationGenes(a), by = a.by || "mutated";
    const idCol = strip(sample ? "sd.sample_unique_id" : "sd.patient_unique_id", study);
    // every case in the cohort appears, because "no alteration" is an answer and not a missing value
    const events = "SELECT sample_unique_id, mutation_type, variant_type, cna_alteration\n" +
      "     FROM " + db + ".genomic_event_derived\n" +
      "     WHERE cancer_study_identifier = " + sq(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")";
    const value = by === "cna"
      ? "if(countIf(g.cna_alteration >= 2) > 0, 'Amplification', if(countIf(g.cna_alteration <= -2) > 0, 'Deep deletion', 'Neutral'))"
      : by === "mutationType"
        // one class per case; a case carrying two of them is its own honest category
        ? "multiIf(countIf(g.variant_type = 'mutation') = 0, 'Not mutated'," +
          " length(groupUniqArrayIf(" + MUT_CLASS + ", g.variant_type = 'mutation')) > 1, 'Multiple'," +
          " arrayElement(groupUniqArrayIf(" + MUT_CLASS + ", g.variant_type = 'mutation'), 1))"
        : "if(countIf(g.variant_type = 'mutation') > 0, 'Mutated', 'Not mutated')";
    return "SELECT " + idCol + " AS id, " + value + " AS v\n" +
      "FROM " + db + ".sample_derived sd\n" +
      "LEFT JOIN (\n     " + events + "\n) g ON g.sample_unique_id = sd.sample_unique_id\n" +
      "WHERE sd.cancer_study_identifier = " + sq(study) + " AND " + inCohort("sd.patient_unique_id") + "\n" +
      "GROUP BY id";
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
    "SELECT count() AS total, countIf(id IN (SELECT id FROM xs)) AS nx, countIf(id IN (SELECT id FROM ys)) AS ny FROM cases";
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
  const [bx, by] = [Math.max(2, Math.min(600, Math.round(bins[0]))), Math.max(2, Math.min(600, Math.round(bins[1])))];
  const eCte = extent
    ? ",    e AS (SELECT " + num(extent.x0) + " AS x0, " + num(extent.x1) + " AS x1, " +
        num(extent.y0) + " AS y0, " + num(extent.y1) + " AS y1)\n"
    : ",    e AS (SELECT min(x) x0, max(x) x1, min(y) y0, max(y) y1 FROM pair)\n";
  return pairCte(xSel, ySel, cohortSql) + eCte +
    "SELECT least(" + (bx - 1) + ", toUInt32(floor((x - x0) / nullIf(x1 - x0, 0) * " + bx + "))) AS bx,\n" +
    "       least(" + (by - 1) + ", toUInt32(floor((y - y0) / nullIf(y1 - y0, 0) * " + by + "))) AS by,\n" +
    "       count() AS n\n" +
    "FROM pair, e GROUP BY bx, by";
}

/** a finite number as a SQL literal — extents cross this module's boundary as numbers, never strings */
function num(x: number): string {
  if (!Number.isFinite(x)) throw new Error("plotBinsSql: extent must be finite numbers");
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
  colorSel?: string, ringSel?: string): string {
  return "WITH cohort AS (" + cohortSql + "),\n" +
    "     vs AS (" + numSel + "),\n" +
    "     gs AS (" + catSel + ")" +
    (colorSel ? ",\n     cs AS (" + colorSel + ")" : "") +
    (ringSel ? ",\n     rs AS (" + ringSel + ")" : "") + "\n" +
    "SELECT vs.id AS id, gs.v AS g, vs.v AS v" + (colorSel ? ", cs.v AS c" : "") + (ringSel ? ", rs.v AS r" : "") + "\n" +
    "FROM vs INNER JOIN gs ON gs.id = vs.id" +
    (colorSel ? "\n  LEFT JOIN cs ON cs.id = vs.id" : "") +
    (ringSel ? "\n  LEFT JOIN rs ON rs.id = vs.id" : "") + "\n" +
    "LIMIT " + (Math.max(1, Math.min(50000, Math.round(cap))) + 1);
}

/**
 * Where a point sits across its box. Deterministic from the case id, as the portal's jitter is,
 * so the same figure comes out of the server SVG, the browser and the Python package rather than
 * moving every time it is drawn.
 */
export function jitterFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const f = Math.abs(Math.sin(h >>> 0)) * 10000;
  return (f - Math.floor(f)) * 2 - 1;
}

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
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// ---- the contract a plot returns -------------------------------------------
/** what a plot asks for; the shape it draws as is decided from the axes, not requested */
/** one drawn value, with its case id and whatever it is coloured by */
export interface PlotPoint { id: string; g: string; v: number; c?: string; r?: string }

export interface PlotRequest {
  x: PlotAxis; y: PlotAxis; unit?: "patient" | "sample"; bins?: [number, number];
  /** colour the values by a category: the fill, and optionally a ring, as the portal does */
  colorBy?: PlotAxis; ringBy?: PlotAxis;
}
export interface PlotGroup { g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number; loWhisker: number; hiWhisker: number }
export interface PlotData {
  shape: "scatter" | "box" | "table";
  n: number;
  x: { label: string; kind: AxisKind };
  y: { label: string; kind: AxisKind };
  extent?: { x0: number; x1: number; y0: number; y1: number };
  grid?: [number, number];
  bins?: { bx: number; by: number; n: number }[];
  stats?: { pearson: number | null; spearman: number | null; slope: number | null; intercept: number | null;
            pPearson: number | null; pSpearman: number | null };
  groups?: PlotGroup[];
  /** the values behind the boxes: points when few enough and the reader may see cases, else a density */
  points?: PlotPoint[];
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
  /** cases in the cohort, and how many carry each axis — what the inner join left out, and why */
  coverage?: { total: number; nx: number; ny: number };
}
