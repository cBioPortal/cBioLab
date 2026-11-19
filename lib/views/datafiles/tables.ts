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
import { lineCtes, lineProfiled, profiledIn, type CallKind, type DataType, type LinePlan, type StudyOpts } from "./sql.ts";
import { parseOql, type OqlSpec } from "../../oql-parse.ts";
import { specText } from "../../oql-match.ts";

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

/** a case-table column of one gene's calls of one kind (the portal's hidden per-alteration columns) */
export interface AltColumn extends FileColumn { gene: string; kind: CallKind }
const KIND_OF: Partial<Record<OqlSpec["type"], CallKind>> = { MUT: "mut", CNA: "cna", SV: "sv", EXP: "exp", PROT: "prot" };

/**
 * The portal's per-alteration columns of the case table, hidden at first (CaseAlterationTable, after the line
 * columns): per gene in query order, one per command of its lines as written back (parsedOQLAlterationToSourceOQL),
 * each once, "<gene>: <command>", a later line's first (DownloadTab geneAlterationMap: _.union(this line's, the earlier)); a bare line's commands are the query's default OQL (`defaults`,
 * buildDefaultOQLProfile: "AMP", "HOMDEL", "MUT", "FUSION"). A column reads its command's kind of call, so AMP
 * and HOMDEL both read copy number, as the portal's.
 */
export function alterationColumns(lines: { gene: string; specs: OqlSpec[] }[], defaults: string[]): AltColumn[] {
  const out: AltColumn[] = [];
  const add = (gene: string, command: string, spec: OqlSpec) => {
    const kind = KIND_OF[spec.type], name = gene + ": " + command;
    if (kind && !out.some((c) => c.name === name)) out.push({ id: "alt_" + out.length, name, numeric: false, gene, kind });
  };
  for (const gene of [...new Set(lines.map((l) => l.gene))])
    for (const l of lines.filter((x) => x.gene === gene).reverse())
      for (const s of l.specs) {
        if (s.type !== "ANY") { add(gene, specText(s), s); continue; }
        for (const d of defaults) add(gene, d, parseOql(gene + ": " + d)[0].specs[0]);
      }
  return out;
}

/** The columns of each status table, in download order; the case table's per-alteration columns (`alts`) last. */
export function statusColumns(t: StatusTable, lines: { line: string; gene: string }[], alts: AltColumn[] = []): FileColumn[] {
  const sample = { id: "sample", name: "Sample ID", numeric: false }, patient = { id: "patient", name: "Patient ID", numeric: false };
  if (t === "altered" || t === "unaltered") return [sample, patient];
  if (t === "matrix") return [sample, { id: "altered", name: "Altered (1 / 0 / NP)", numeric: false }, ...lineColumns(lines)];
  return [{ id: "study", name: "Study ID", numeric: false }, sample, patient, { id: "altered", name: "Altered", numeric: false }, ...lineColumns(lines), ...alts];
}
export const STATUS_DEFAULTS = (t: StatusTable, lines: { line: string; gene: string }[]) => statusColumns(t, lines).map((c) => c.id);

const DATA_TYPE: Partial<Record<CallKind, DataType>> = { mut: "MUTATION", cna: "CNA", sv: "SV" };
/**
 * A per-alteration column's cell for sample `s.sid` (CaseAlterationTable generatePseudoOqlSummary): "not profiled" when
 * its gene is off the sample's panel for the kind's data type (an EXP / PROT kind, never), whatever was called; else
 * the calls of that kind every line of the gene matched, in line order, each once, with their notes; else "no alteration".
 */
function altCell(pre: string, lines: LinePlan[], c: AltColumn): string {
  const ks = lines.flatMap((l, k) => (l.gene === c.gene ? [k] : []));
  const type = DATA_TYPE[c.kind];
  const profiled = !type ? "1" : lines.some((l) => l.gene === c.gene && l.types.includes(type)) ? profiledIn(pre, c.gene, type, "s.sid") : "0";
  const calls = "arrayStringConcat(arrayDistinct(arrayConcat(" + ks.map((k) => "e" + k + ".k_" + c.kind).join(", ") + ")), ', ')";
  return "multiIf(NOT " + profiled + ", 'not profiled', " + calls + " != '', " + calls + ", 'no alteration')";
}

/**
 * The parts' samples with their status per line: `ev<k>` (events matched, '' when none; with `notes`, each with
 * its germline / driver note), `pa<k>` / `pf<k>` (profiled in any / every type).
 */
function statusRows(parts: TablePart[], plan: (study: string) => StudyPlan, notes: boolean, alts: AltColumn[] = []): { ctes: string; union: string; n: number } {
  let n = 0;
  const ctes: string[] = [], selects: string[] = [];
  parts.forEach((p, i) => {
    const { lines, opts } = plan(p.study);
    n = lines.length;
    const pre = "d" + i;
    ctes.push("c" + i + " AS (" + p.cohortSql + "),\n" + lineCtes(pre, "c" + i, lines, opts, { notes }));
    selects.push(
      "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord, s.pid AS patient, s.sid AS sid" +
      lines.map((l, k) => {
        const pr = lineProfiled(pre, l, "s.sid");
        return ",\n         e" + k + ".ev AS ev" + k + ", " + pr.any + " AS pa" + k + ", " + pr.every + " AS pf" + k;
      }).join("") + alts.map((c, j) => ",\n         " + altCell(pre, lines, c) + " AS h" + j).join("") + "\n" +
      "  FROM (SELECT DISTINCT pid, sid FROM c" + i + ") s\n" +
      lines.map((_, k) => "  LEFT JOIN " + pre + "_e" + k + " e" + k + " ON e" + k + ".sid = s.sid\n").join(""));
  });
  return { ctes: ctes.join(",\n"), union: selects.join("  UNION ALL\n"), n };
}

/**
 * One of the status tables over every (cohort, study) part: `cases` — each sample's study and status
 * as the portal's Altered column writes it (1 altered; 0 unaltered, when profiled for every line's gene
 * and data types; else NP, where the portal writes 0 — a sample not profiled is not unaltered) and per line the events it matched, "no alteration" or "not profiled" (profiled in none of the
 * line's types); `altered` / `unaltered` — those samples alone; `matrix` — the portal's sample
 * matrix, 1 / 0 with NP where the sample is not profiled. Default order: altered first, then sample.
 */
export function statusRowSource(t: StatusTable, parts: TablePart[], lines: { line: string; gene: string }[], plan: (study: string) => StudyPlan, alts: AltColumn[] = []): RowSource {
  if (!parts.length) throw new Error("statusRowSource needs at least one part");
  const caseAlts = t === "cases" ? alts : [];
  const { ctes, union, n } = statusRows(parts, plan, t === "cases", caseAlts);
  const ks = Array.from({ length: n }, (_, k) => k);
  const status = "multiIf(" + ks.map((k) => "ev" + k + " != ''").join(" OR ") + ", 'altered', " + ks.map((k) => "pf" + k).join(" AND ") + ", 'unaltered', 'not profiled')";
  const derived = ks.map((k) => ",\n    multiIf(ev" + k + " != '', ev" + k + ", pa" + k + ", 'no alteration', 'not profiled') AS c" + k +
    ", multiIf(ev" + k + " != '', '1', pa" + k + ", '0', 'NP') AS m" + k).join("");
  const keep = t === "altered" ? "WHERE status = 'altered'" : t === "unaltered" ? "WHERE status = 'unaltered'" : "";
  const cols = statusColumns(t, lines, caseAlts);
  const lineIds = lineColumns(lines).map((c) => c.id);
  const text = (c: FileColumn): string => {
    if (c.id === "sample") return "sid";
    if (c.id === "patient") return "patient";
    if (c.id === "study") return "study";
    if (c.id === "altered") return "multiIf(status = 'altered', '1', status = 'unaltered', '0', 'NP')";
    if (c.id.startsWith("alt_")) return "h" + caseAlts.findIndex((a) => a.id === c.id);
    return (t === "matrix" ? "m" : "c") + lineIds.indexOf(c.id);
  };
  return {
    with: "WITH " + ctes + ",\n" +
      "base AS (\n" + union + "),\n" +
      "rows AS (SELECT *, " + status + " AS status" + derived + ",\n    multiIf(status = 'altered', 2, status = 'unaltered', 1, 0) AS rank FROM base " + keep + ")\n",
    columns: cols.map((c): QueryColumn => ({ ...c, text: text(c), ...(c.id === "altered" ? { order: "rank" } : {}) })),
    select: "*",
    defaultOrder: "rank DESC",
    tiebreak: "sid, ord",
  };
}

/** A gene-by-sample file: each queried gene's mutations, structural variants, or values in one molecular profile. */
export type MatrixFile = { kind: "mutations" } | { kind: "sv" } | { kind: "profile"; profile: string; discrete: boolean }
  /** the portal's cna.txt: each study's own selected (first) discrete copy-number profile, by study */
  | { kind: "cna"; profiles: Record<string, string> };

/** a file the portal writes for every queried sample, NP for a study without its kind of profile (RDL-STM-4); the rest list their holders' samples (RDL-STM-5) */
export const everySample = (f: MatrixFile): boolean => f.kind !== "profile";

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
    values: "SELECT " + bare + " AS sid, hugo_gene_symbol AS gene, arrayStringConcat(arraySort(groupArray(sv_event_info)), ' ') AS val\n" +
      "    FROM " + db + ".genomic_event_derived WHERE " + genomicStudySql(study) + " AND variant_type = 'structural_variant'\n" +
      "      AND hugo_gene_symbol IN " + inGenes + " AND " + inCohortSamples(bare, cohort) + " GROUP BY sid, gene",
    missing: "NA", type: "SV" };
  const profile = f.kind === "cna" ? f.profiles[study] : f.profile;
  return {
    values: "SELECT " + bare + " AS sid, hugo_gene_symbol AS gene, any(ifNull(alteration_value, 'NA')) AS val\n" +
      "    FROM " + db + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study) + " AND profile_type = " + sq(profile) + "\n" +
      "      AND hugo_gene_symbol IN " + inGenes + " AND " + inCohortSamples(bare, cohort) + " GROUP BY sid, gene",
    missing: "NA", type: f.kind === "cna" || f.discrete ? "CNA" : null };
}

/**
 * A gene-by-sample file over every part, one row per sample of the cohort: per gene, the sample's
 * mutations (protein changes, space-separated, germline ones marked; WT when profiled and none),
 * structural variants (event info; NA when none) or its value in the profile (NA when none is
 * stored) — NP where its panel did not cover the gene in that data type (mutations, structural
 * variants and discrete copy number; the panels record nothing finer for the other profiles).
 * The query's OQL is not in effect, as on the portal: every call of the gene is listed. A part whose
 * study `holds` no such profile still has a row per sample, NP in every gene (the portal's file lists
 * every queried sample); none of its data is read.
 */
export function matrixRowSource(f: MatrixFile, parts: TablePart[], genes: string[], db: string, holds: (part: TablePart) => boolean = () => true): RowSource {
  if (!parts.length) throw new Error("matrixRowSource needs at least one part");
  const ctes: string[] = [], selects: string[] = [];
  parts.forEach((p, i) => {
    if (!holds(p)) {
      ctes.push("c" + i + " AS (" + p.cohortSql + ")");
      selects.push(
        "  SELECT " + sq(p.cohort) + " AS cohort, " + sq(p.study) + " AS study, " + i + " AS ord, s.pid AS patient, s.sid AS sid" +
        genes.map((_, j) => ", 'NP' AS g" + j).join("") + "\n" +
        "  FROM (SELECT DISTINCT pid, sid FROM c" + i + ") s\n");
      return;
    }
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
