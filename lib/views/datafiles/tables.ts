// The datafiles view's tables: every file the Download tab offers, and its table of each sample's
// alterations, as row sources for lib/table-query.ts. Their rows name samples, so — like the mutation
// table — they run only through PatientLevelResolver's rows* methods (lib/views/rows.ts runRows); a
// participant that may not disclose patients has none. Every table holds one row per sample of the
// cohort (or of an altered / unaltered list), its status against the query read from the same CTEs
// as the view's counts (sql.ts), so a file and the frequencies cannot disagree.
import { sq, genomicStudySql, mutationStudySql } from "../../compiler.ts";
import { inCohortSamples, profiledCasesSql } from "../../cohort2.ts";
import type { TablePart } from "../../mutation-table.ts";
import type { QueryColumn, RowSource } from "../../table-query.ts";
import { lineCtes, lineProfiled, type LinePlan, type StudyOpts } from "./sql.ts";

/** What a part's study reads: its own plan of the lines (the data types it holds) and its options. */
export type StudyPlan = { lines: LinePlan[]; opts: StudyOpts };

export interface FileColumn { id: string; name: string; numeric: boolean }

/** The tables made from the samples' status against the query. */
export type StatusTable = "cases" | "altered" | "unaltered" | "matrix";
export const STATUS_TABLES: readonly StatusTable[] = ["cases", "altered", "unaltered", "matrix"];

/** A line's column id: its gene, or its gene and line number when the gene has several lines. */
export function lineColumns(lines: { line: string; gene: string }[]): FileColumn[] {
  return lines.map((l, k) => ({ id: lines.filter((x) => x.gene === l.gene).length > 1 ? l.gene + "_" + (k + 1) : l.gene, name: l.line, numeric: false }));
}

/** The columns of each status table, in download order. */
export function statusColumns(t: StatusTable, lines: { line: string; gene: string }[]): FileColumn[] {
  const sample = { id: "sample", name: "Sample ID", numeric: false }, patient = { id: "patient", name: "Patient ID", numeric: false };
  if (t === "altered" || t === "unaltered") return [sample, patient];
  if (t === "matrix") return [sample, { id: "altered", name: "Altered (1 / 0 / NP)", numeric: false }, ...lineColumns(lines)];
  return [sample, patient, { id: "altered", name: "Altered", numeric: false }, ...lineColumns(lines)];
}
export const STATUS_DEFAULTS = (t: StatusTable, lines: { line: string; gene: string }[]) => statusColumns(t, lines).map((c) => c.id);

/** The parts' samples with their status per line: `ev<k>` (events matched, '' when none), `pa<k>` / `pf<k>` (profiled in any / every type). */
function statusRows(parts: TablePart[], plan: (study: string) => StudyPlan): { ctes: string; union: string; n: number } {
  let n = 0;
  const ctes: string[] = [], selects: string[] = [];
  parts.forEach((p, i) => {
    const { lines, opts } = plan(p.study);
    n = lines.length;
    const pre = "d" + i;
    ctes.push("c" + i + " AS (" + p.cohortSql + "),\n" + lineCtes(pre, "c" + i, lines, opts));
    selects.push(
      "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord, s.pid AS patient, s.sid AS sid" +
      lines.map((l, k) => {
        const pr = lineProfiled(pre, l, "s.sid");
        return ",\n         e" + k + ".ev AS ev" + k + ", " + pr.any + " AS pa" + k + ", " + pr.every + " AS pf" + k;
      }).join("") + "\n" +
      "  FROM (SELECT DISTINCT pid, sid FROM c" + i + ") s\n" +
      lines.map((_, k) => "  LEFT JOIN " + pre + "_e" + k + " e" + k + " ON e" + k + ".sid = s.sid\n").join(""));
  });
  return { ctes: ctes.join(",\n"), union: selects.join("  UNION ALL\n"), n };
}

/**
 * One of the status tables over every (cohort, study) part: `cases` — each sample's status
 * ("altered", "unaltered" when profiled for every line's gene and data types, else "not profiled")
 * and per line the events it matched, "no alteration" or "not profiled" (profiled in none of the
 * line's types); `altered` / `unaltered` — those samples alone; `matrix` — the portal's sample
 * matrix, 1 / 0 with NP where the sample is not profiled. Default order: altered first, then sample.
 */
export function statusRowSource(t: StatusTable, parts: TablePart[], lines: { line: string; gene: string }[], plan: (study: string) => StudyPlan): RowSource {
  if (!parts.length) throw new Error("statusRowSource needs at least one part");
  const { ctes, union, n } = statusRows(parts, plan);
  const ks = Array.from({ length: n }, (_, k) => k);
  const status = "multiIf(" + ks.map((k) => "ev" + k + " != ''").join(" OR ") + ", 'altered', " + ks.map((k) => "pf" + k).join(" AND ") + ", 'unaltered', 'not profiled')";
  const derived = ks.map((k) => ",\n    multiIf(ev" + k + " != '', ev" + k + ", pa" + k + ", 'no alteration', 'not profiled') AS c" + k +
    ", multiIf(ev" + k + " != '', '1', pa" + k + ", '0', 'NP') AS m" + k).join("");
  const keep = t === "altered" ? "WHERE status = 'altered'" : t === "unaltered" ? "WHERE status = 'unaltered'" : "";
  const cols = statusColumns(t, lines);
  const lineIds = lineColumns(lines).map((c) => c.id);
  const text = (c: FileColumn): string => {
    if (c.id === "sample") return "sid";
    if (c.id === "patient") return "patient";
    if (c.id === "altered") return t === "matrix" ? "multiIf(status = 'altered', '1', status = 'unaltered', '0', 'NP')" : "status";
    return (t === "matrix" ? "m" : "c") + lineIds.indexOf(c.id);
  };
  return {
    with: "WITH " + ctes + ",\n" +
      "base AS (\n" + union + "),\n" +
      "rows AS (SELECT *, " + status + " AS status" + derived + ",\n    multiIf(status = 'altered', 0, status = 'unaltered', 1, 2) AS rank FROM base " + keep + ")\n",
    columns: cols.map((c): QueryColumn => ({ ...c, text: text(c), ...(c.id === "altered" ? { order: "rank" } : {}) })),
    select: "*",
    defaultOrder: "rank ASC",
    tiebreak: "sid, ord",
  };
}

/** A gene-by-sample file: each queried gene's mutations, structural variants, or values in one molecular profile. */
export type MatrixFile = { kind: "mutations" } | { kind: "sv" } | { kind: "profile"; profile: string; discrete: boolean };

export function matrixColumns(genes: string[]): FileColumn[] {
  return [{ id: "sample", name: "Sample ID", numeric: false }, { id: "patient", name: "Patient ID", numeric: false },
    ...genes.map((g) => ({ id: g, name: g, numeric: false }))];
}

/** The file's values per (sample, gene) in one study, as `sid, gene, val`; what a profiled sample without one reads; the data type whose panels say who was profiled (none: every sample). */
function matrixValues(f: MatrixFile, study: string, db: string, genes: string[], cohort: string): { values: string; missing: string; type: "MUTATION" | "CNA" | "SV" | null } {
  const inGenes = "(" + genes.map(sq).join(", ") + ")";
  const bare = "replaceOne(sample_unique_id, " + sq(study + "_") + ", '')";
  if (f.kind === "mutations") return {
    values: "SELECT sampleId AS sid, `GENE.hugoGeneSymbol` AS gene,\n" +
      "      arrayStringConcat(arraySort(groupArray(concat(proteinChange, if(lower(ifNull(mutationStatus, '')) = 'germline', ' [germline]', '')))), ' ') AS val\n" +
      "    FROM " + db + ".mutation_derived WHERE " + mutationStudySql(study) + " AND `GENE.hugoGeneSymbol` IN " + inGenes + "\n" +
      "      AND molecularProfileId NOT LIKE '%uncalled%' AND " + inCohortSamples("sampleId", cohort) + " GROUP BY sid, gene",
    missing: "WT", type: "MUTATION" };
  if (f.kind === "sv") return {
    values: "SELECT " + bare + " AS sid, hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupUniqArray(sv_event_info)), ', ') AS val\n" +
      "    FROM " + db + ".genomic_event_derived WHERE " + genomicStudySql(study) + " AND variant_type = 'structural_variant'\n" +
      "      AND hugo_gene_symbol IN " + inGenes + " AND " + inCohortSamples(bare, cohort) + " GROUP BY sid, gene",
    missing: "NA", type: "SV" };
  return {
    values: "SELECT " + bare + " AS sid, hugo_gene_symbol AS gene, any(ifNull(alteration_value, 'NA')) AS val\n" +
      "    FROM " + db + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study) + " AND profile_type = " + sq(f.profile) + "\n" +
      "      AND hugo_gene_symbol IN " + inGenes + " AND " + inCohortSamples(bare, cohort) + " GROUP BY sid, gene",
    missing: "NA", type: f.discrete ? "CNA" : null };
}

/**
 * A gene-by-sample file over every part, one row per sample of the cohort: per gene, the sample's
 * mutations (protein changes, space-separated, germline ones marked; WT when profiled and none),
 * structural variants (event info; NA when none) or its value in the profile (NA when none is
 * stored) — NP where its panel did not cover the gene in that data type (mutations, structural
 * variants and discrete copy number; the panels record nothing finer for the other profiles).
 * The query's OQL is not in effect, as on the portal: every call of the gene is listed.
 */
export function matrixRowSource(f: MatrixFile, parts: TablePart[], genes: string[], db: string): RowSource {
  if (!parts.length) throw new Error("matrixRowSource needs at least one part");
  const ctes: string[] = [], selects: string[] = [];
  parts.forEach((p, i) => {
    const v = matrixValues(f, p.study, db, genes, "c" + i);
    ctes.push("c" + i + " AS (" + p.cohortSql + "),\n" + "v" + i + " AS (\n    " + v.values + ")" +
      (v.type ? genes.map((g, j) => ",\n" + "p" + i + "_" + j + " AS (" + profiledCasesSql(g, v.type!, { study: p.study, db, unit: "sample" }) + ")").join("") : ""));
    selects.push(
      "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord, s.pid AS patient, s.sid AS sid" +
      genes.map((g, j) => ",\n         " + (v.type ? "if(s.sid NOT IN (SELECT profiled_id FROM p" + i + "_" + j + "), 'NP', " : "(") +
        "if(countIf(v.gene = " + sq(g) + ") > 0, anyIf(v.val, v.gene = " + sq(g) + "), " + sq(v.missing) + ")) AS g" + j).join("") + "\n" +
      "  FROM (SELECT DISTINCT pid, sid FROM c" + i + ") s\n" +
      "  LEFT JOIN v" + i + " v ON v.sid = s.sid\n" +
      "  GROUP BY s.pid, s.sid\n");
  });
  return {
    with: "WITH " + ctes.join(",\n") + ",\nrows AS (\n" + selects.join("  UNION ALL\n") + ")\n",
    columns: matrixColumns(genes).map((c, j): QueryColumn => ({ ...c, text: j === 0 ? "sid" : j === 1 ? "patient" : "g" + (j - 2) })),
    select: "*",
    defaultOrder: "ord ASC",
    tiebreak: "sid, ord",
  };
}
