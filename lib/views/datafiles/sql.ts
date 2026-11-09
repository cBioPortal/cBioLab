// The datafiles view's SQL: how each of a cohort's samples stands against each line of the gene query
// (altered, and profiled for it), shared by the counts below and the patient-level tables
// (tables.ts) so the frequencies and the files can never disagree; and the counts themselves.
import { profiledCasesSql } from "../../cohort2.ts";
import { oqlEventsSql, type OqlPins } from "../../oql.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

export type DataType = "MUTATION" | "CNA" | "SV";

/** One line of the query as one study reads it. */
export interface LinePlan {
  /** the line as written ("TP53: MUT") and its gene */
  line: string; gene: string;
  /** the data types the line reads that the study holds: a sample is profiled for the line when its panel covers the gene in one of these */
  types: DataType[];
}
/** What a study's SQL needs besides the lines: the OncoKB version (DRIVER) and its profiles (EXP / PROT). */
export interface StudyOpts { study: string; db: string; pin: string | null; profiles: string[]; pins?: OqlPins }

/** The CTE name for one gene and data type's profiled samples, under prefix `p`. */
const profiledName = (p: string, gene: string, type: DataType) => p + "_prof_" + gene.replace(/[^A-Za-z0-9]/g, "_") + "_" + type;

/**
 * The CTEs one (cohort, study) part needs, every name under prefix `p`: `<p>_e<k>` — each sample of
 * the cohort (`cohort`, columns pid, sid) the line alters, with the events it matched (`ev`, kinds in
 * order, comma-separated) — and one `<p>_prof_<gene>_<type>` per gene and data type the lines read:
 * the study's samples profiled for that gene in that type, by their panels (profiledCasesSql, the
 * profiled clause's rule).
 */
export function lineCtes(p: string, cohort: string, lines: LinePlan[], o: StudyOpts): string {
  const out: string[] = [];
  lines.forEach((l, k) => {
    out.push(p + "_e" + k + " AS (\n" +
      "  SELECT sid, arrayStringConcat(arrayMap(x -> x.2, arraySort(groupUniqArray((o, ev)))), ', ') AS ev\n" +
      "  FROM (" + oqlEventsSql(l.line, { oncokbPin: o.pin, profiles: o.profiles, pins: o.pins, study: o.study, db: o.db }) + ")\n" +
      "  WHERE sid IN (SELECT sid FROM " + cohort + ")\n" +
      "  GROUP BY sid)");
  });
  const seen = new Set<string>();
  for (const l of lines) for (const t of l.types) {
    const name = profiledName(p, l.gene, t);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name + " AS (" + profiledCasesSql(l.gene, t, { study: o.study, db: o.db, unit: "sample" }) + ")");
  }
  return out.join(",\n");
}

/**
 * A sample (`sid`, its bare id) against line `k`: profiled in ANY data type the line reads (what the
 * frequency's denominator counts, as the portal's does), and in EVERY one (what calling it unaltered
 * needs). A line reading no data type the study's panels record — an expression or protein condition
 * alone — counts every sample as profiled, and the view says so.
 */
export function lineProfiled(p: string, l: LinePlan, sid: string): { any: string; every: string } {
  if (!l.types.length) return { any: "1", every: "1" };
  const ins = l.types.map((t) => sid + " IN (SELECT profiled_id FROM " + profiledName(p, l.gene, t) + ")");
  return { any: "(" + ins.join(" OR ") + ")", every: "(" + ins.join(" AND ") + ")" };
}

/**
 * Per sample of the cohort: how many there are, how many the query alters (any line), how many it
 * leaves unaltered (no line, and profiled for every line's gene and data types), and per line `k`
 * the samples it alters among those profiled for it (`alt_k`), those profiled (`prof_k`) and those it
 * alters that their panels say were not profiled (`off_k`). Counts only: the samples never leave.
 */
export function datafilesCountsSql(cohortSql: string, lines: LinePlan[], o: StudyOpts): AggregateSql {
  const flags = lines.map((l, k) => {
    const pr = lineProfiled("d", l, "s.sid");
    return "s.sid IN (SELECT sid FROM d_e" + k + ") AS a" + k + ", " + pr.any + " AS p" + k + ", " + pr.every + " AS f" + k;
  });
  const anyAlt = "(" + lines.map((_, k) => "a" + k).join(" OR ") + ")";
  const everyProf = "(" + lines.map((_, k) => "f" + k).join(" AND ") + ")";
  return aggregateSql(
    "WITH cohort AS (" + cohortSql + "),\n" +
    lineCtes("d", "cohort", lines, o) + ",\n" +
    "flags AS (SELECT " + flags.join(",\n  ") + "\n  FROM (SELECT DISTINCT sid FROM cohort) s)\n" +
    "SELECT count() AS n, countIf(" + anyAlt + ") AS altered, countIf(NOT " + anyAlt + " AND " + everyProf + ") AS unaltered" +
    lines.map((_, k) => ",\n  countIf(a" + k + " AND p" + k + ") AS alt_" + k + ", countIf(p" + k + ") AS prof_" + k + ", countIf(a" + k + " AND NOT p" + k + ") AS off_" + k).join("") +
    "\nFROM flags");
}

