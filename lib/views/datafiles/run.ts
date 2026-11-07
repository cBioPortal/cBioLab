// Datafiles view: cBioPortal's Results-page Download tab — one cohort's files for a gene query, its
// gene alteration frequencies and its table of each sample's alterations. The counts are aggregates
// (sql.ts, through viewAggregate); every file and the case table are table views on
// lib/table-query.ts (tables.ts), downloaded whole through POST /api/table naming the file.
import type { ViewResult, TableRows } from "../../types.ts";
import { parseOql, OQL_PROFILE } from "../../oql-parse.ts";
import { MAX_GENE_SYMBOLS } from "../../gene-tracks.ts";
import { hasViewAggregates } from "../../federation.ts";
import { inGeneticAlterationDerived, type ProfileInfo } from "../../profile-catalog.ts";
import { checkQuery, describeQuery, shownColumns, type TableQuery } from "../../table-query.ts";
import type { TablePart } from "../../mutation-table.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, rowHolders, runRows, tableTail, viewQuery, type Rows } from "../rows.ts";
import { plural, refuse } from "../shared.ts";
import { datafilesCountsSql, type DataType, type LinePlan } from "./sql.ts";
import { STATUS_TABLES, lineColumns, matrixColumns, matrixRowSource, statusColumns, statusRowSource, type FileColumn, type MatrixFile, type StatusTable, type StudyPlan } from "./tables.ts";
import type { DataFile, DatafilesResult, DatafilesView, LineFrequency } from "./types.ts";
import { datafilesMethod } from "./method.ts";

type Cell = string | number | null;

/** the most lines a query may have: a gene list's own limit (lib/gene-tracks.ts) */
export const DATAFILES_MAX_LINES = MAX_GENE_SYMBOLS;

/** The data types a study's profiles say it holds, as the profiled clause names them. */
export function heldTypes(catalog: ProfileInfo[]): DataType[] {
  const out: DataType[] = [];
  if (catalog.some((p) => p.type === "MUTATION_EXTENDED")) out.push("MUTATION");
  if (catalog.some((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype.toUpperCase() === "DISCRETE")) out.push("CNA");
  if (catalog.some((p) => p.type === "STRUCTURAL_VARIANT")) out.push("SV");
  return out;
}

/** The portal's order of profile types in its Download tab (DownloadUtils.decideMolecularProfileSortingOrder). */
const PROFILE_ORDER = ["MUTATION_EXTENDED", "COPY_NUMBER_ALTERATION", "GENESET_SCORE", "MRNA_EXPRESSION", "METHYLATION", "METHYLATION_BINARY", "PROTEIN_LEVEL"];

/** The query's lines checked: each one gene's OQL entry. A string naming what is wrong, or the lines with their genes. */
export function checkLines(oql: unknown): string | { line: string; gene: string; specs: string[] }[] {
  if (!Array.isArray(oql) || !oql.length || oql.some((x) => typeof x !== "string" || !x.trim()))
    return "oql is the gene query, one OQL entry per line, e.g. [\"TP53\", \"KRAS: MUT AMP\"]";
  if (oql.length > DATAFILES_MAX_LINES) return "oql takes at most " + DATAFILES_MAX_LINES + " lines; this has " + oql.length + " — remove " + (oql.length - DATAFILES_MAX_LINES);
  const out: { line: string; gene: string; specs: string[] }[] = [];
  for (const raw of oql as string[]) {
    const line = raw.trim();
    let parsed;
    try { parsed = parseOql(line); } catch (e) { return "oql line \"" + line + "\": " + (e as Error).message; }
    if (parsed.length !== 1) return "oql line \"" + line + "\" names " + parsed.length + " genes; give each gene its own line";
    out.push({ line, gene: parsed[0].gene, specs: parsed[0].specs.map((s) => s.type) });
  }
  return out;
}

/** The files a cohort's studies can offer, from their profiles: which studies hold each one. */
export function fileList(catalogs: Record<string, ProfileInfo[]>, studies: string[]): { id: string; name: string; description: string; studies: string[]; matrix: MatrixFile }[] {
  const holding = (test: (p: ProfileInfo) => boolean) => studies.filter((st) => (catalogs[st] || []).some(test));
  const out: { id: string; name: string; description: string; studies: string[]; matrix: MatrixFile }[] = [];
  const mut = holding((p) => p.type === "MUTATION_EXTENDED");
  if (mut.length) out.push({ id: "mutations", name: "Mutations (OQL is not in effect)", studies: mut, matrix: { kind: "mutations" },
    description: "per sample and gene: its mutations' protein changes, space-separated ([germline] marked); WT when profiled with none; NP when its panel did not cover the gene" });
  const sv = holding((p) => p.type === "STRUCTURAL_VARIANT");
  if (sv.length) out.push({ id: "sv", name: "Structural Variants (OQL is not in effect)", studies: sv, matrix: { kind: "sv" },
    description: "per sample and gene: its structural variants' event info; NA when it has none; NP when its panel did not cover the gene" });
  const profiles = new Map<string, ProfileInfo>();
  for (const st of studies) for (const p of catalogs[st] || []) if (inGeneticAlterationDerived(p.type) && !profiles.has(p.profile)) profiles.set(p.profile, p);
  const rank = (p: ProfileInfo) => { const i = PROFILE_ORDER.indexOf(p.type); return i < 0 ? PROFILE_ORDER.length : i; };
  for (const p of [...profiles.values()].sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.profile.localeCompare(b.profile))) {
    const discrete = p.type === "COPY_NUMBER_ALTERATION" && p.datatype.toUpperCase() === "DISCRETE";
    out.push({ id: "profile:" + p.profile, name: p.name || p.profile, studies: holding((x) => x.profile === p.profile), matrix: { kind: "profile", profile: p.profile, discrete },
      description: "per sample and gene: its value in " + p.profile + " (" + p.type.toLowerCase().replace(/_/g, " ") + ", " + p.datatype.toLowerCase() + ")" +
        (discrete ? "; NA when none is stored; NP when its panel did not cover the gene" : "; NA when none is stored") });
  }
  return out;
}

/** Sum each line's counts across studies (never their percentages) and take the frequency. */
export function frequencies(lines: { line: string; gene: string }[], answers: Record<string, unknown>[]): LineFrequency[] {
  return lines.map((l, k) => {
    const sum = (f: string) => answers.reduce((n, a) => n + (Number(a[f + "_" + k]) || 0), 0);
    const altered = sum("alt"), profiled = sum("prof");
    return { line: l.line, gene: l.gene, altered, profiled, percent: profiled ? Math.round(altered / profiled * 1000) / 10 : null, offPanel: sum("off") };
  });
}

const rowsOf = (r: Rows, cols: FileColumn[], text: (x: Record<string, unknown>, c: FileColumn) => Cell) => r.rows.map((x) => ({
  cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? ""),
  values: cols.map((c) => text(x, c)) }));

/** The table's page size from its spec: 1 to TABLE_ROWS_MAX, 25 when unset; NaN when out of range. */
const pageSize = (n: unknown) => n == null ? 25 : Math.floor(Number(n));

export async function runDatafiles(view: DatafilesView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames, pin } = ctx;
  const no = (msg: string) => refuse("datafiles", ctx, msg);
  if (vNames.length !== 1) return no("a datafiles view offers one cohort's files; this one draws " + vNames.length + " — name one in cohorts");
  const checked = checkLines(view.oql);
  if (typeof checked === "string") return no(checked);
  const lines = checked.map((l) => ({ line: l.line, gene: l.gene }));
  const genes = [...new Set(lines.map((l) => l.gene))];
  const size = pageSize(view.rows);
  if (!(size >= 1 && size <= TABLE_ROWS_MAX)) return no("rows (the page size of the case table) is 1 to " + TABLE_ROWS_MAX);
  const q = viewQuery(view);
  const caseCols = statusColumns("cases", lines);
  { const bad = checkQuery(q, caseCols); if (bad) return no(bad); }

  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return no("no study here may disclose patients' samples (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  const catalogs: Record<string, ProfileInfo[]> = {}, profiles: Record<string, string[]> = {};
  await Promise.all(holders.map(async (st) => { const sp = await ctx.studyProfiles(st); catalogs[st] = sp.catalog || []; profiles[st] = sp.profiles; }));
  const plans: Record<string, StudyPlan> = {};
  for (const st of holders) {
    const held = heldTypes(catalogs[st]);
    const plan: LinePlan[] = checked.map((l) => ({ line: l.line, gene: l.gene,
      types: [...new Set(l.specs.flatMap((t) => OQL_PROFILE[t as keyof typeof OQL_PROFILE] || []))].filter((t) => held.includes(t)) }));
    plans[st] = { lines: plan, opts: { study: st, db: ctx.resolvers[st].instance.conn.db, pin, profiles: profiles[st] } };
  }
  const planOf = (st: string) => plans[st];
  const unchecked = checked.filter((l) => l.specs.some((t) => t === "EXP" || t === "PROT")).map((l) => l.line);
  const offered = fileList(catalogs, holders);
  const table = ctx.table == null ? "cases" : ctx.table;
  const known = [...STATUS_TABLES, ...offered.map((f) => f.id)];
  if (!known.includes(table)) return no("table is one of " + known.join(", ") + " (the files these studies offer), or none for the case table");

  /** one table's rows (the page or values asked for) and its TableRows */
  const tableRows = async (id: string, tq: TableQuery, n: number): Promise<{ r: Rows; rows: TableRows<Cell> }> => {
    const file = offered.find((f) => f.id === id);
    const cols = file ? matrixColumns(genes) : statusColumns(id as StatusTable, lines);
    const defs = cols.map((c) => c.id);
    const shown = shownColumns(tq, cols, defs);
    const r = await runRows(ctx, "datafiles:" + id, file ? file.studies : holders, tq, defs, shown, n,
      (parts: TablePart[]) => (db) => file ? matrixRowSource(file.matrix, parts, genes, db) : statusRowSource(id as StatusTable, parts, lines, planOf),
      ctx.values ? { column: ctx.values, numeric: false } : undefined);
    const lineIds = lineColumns(lines).map((c) => c.id);
    const reads = (x: Record<string, unknown>, c: FileColumn): Cell => {
      if (file) { const j = cols.indexOf(c); return String(j === 0 ? x.sid ?? "" : j === 1 ? x.patient ?? "" : x["g" + (j - 2)] ?? ""); }
      // the status tables' columns, read off their rows as tables.ts names them
      if (c.id === "sample") return String(x.sid ?? "");
      if (c.id === "patient") return String(x.patient ?? "");
      if (c.id === "altered") return id === "matrix" ? (x.status === "altered" ? "1" : x.status === "unaltered" ? "0" : "NP") : String(x.status ?? "");
      return String(x[(id === "matrix" ? "m" : "c") + lineIds.indexOf(c.id)] ?? "");
    };
    return { r, rows: { columns: cols, shown, defaults: defs, query: tq, rows: rowsOf(r, cols, reads), offset: r.offset, pageSize: n,
      lists: r.lists, total: r.total, all: r.all, ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) } };
  };
  const result = (d: DatafilesResult, extra: Partial<ViewResult> = {}): ViewResult =>
    ({ kind: "datafiles", cohorts: vNames, datafiles: d, participation: ctx.participationFor(ctx.vStudies, true), ...extra } as ViewResult);
  const lineInfo = lines.map((l, k) => ({ ...l, column: caseCols[3 + k].id }));
  const empty = { samples: 0, altered: 0, unaltered: 0, unprofiled: 0 };
  const files = (counts: DatafilesResult["counts"], perStudy: Record<string, number>): DataFile[] => [
    ...offered.map((f) => ({ id: f.id, name: f.name, description: f.description, group: "data" as const, rows: f.studies.reduce((n, st) => n + (perStudy[st] || 0), 0),
      ...(f.studies.length < ctx.vStudies.length ? { studies: f.studies } : {}) })),
    { id: "altered", name: "Altered samples", group: "list", rows: counts.altered, description: "the samples the query alters (any line), one per row" },
    { id: "unaltered", name: "Unaltered samples", group: "list", rows: counts.unaltered,
      description: "the samples no line alters that were profiled for every queried gene in every data type the query reads, one per row" },
    { id: "matrix", name: "Sample matrix: every sample, 1 = altered, 0 = unaltered, NP = not profiled", group: "list", rows: counts.samples,
      description: "per sample: whether the query alters it, and per line whether that line does" },
  ];

  try {
    // a page (or a column's values) of one file, or the whole of it for the download: that table alone
    if ((ctx.table != null && ctx.table !== "cases") || ctx.page || ctx.values) {
      const { rows } = await tableRows(table, table === "cases" ? q : {}, size);
      return result({ ...rows, lines: lineInfo, counts: empty, frequency: [], files: [], tables: table === "cases" ? {} : { [table]: rows }, unchecked, oncokbPin: pin });
    }
    const def = ctx.doc.cohorts[vNames[0]];
    const [answers, cases] = await Promise.all([
      Promise.all(holders.map(async (st) => {
        const r = ctx.resolvers[st];
        if (!hasViewAggregates(r)) throw new Error(st + " cannot count its samples here");
        const [row] = await r.viewAggregate("datafiles:counts", def, (cs, _s, db) => datafilesCountsSql(cs, plans[st].lines, { ...plans[st].opts, db }));
        return { study: st, row: row || {} };
      })),
      tableRows("cases", q, size),
    ]);
    const num = (a: Record<string, unknown>, f: string) => Number(a[f]) || 0;
    const counts = { samples: 0, altered: 0, unaltered: 0, unprofiled: 0 };
    const perStudy: Record<string, number> = {};
    for (const a of answers) {
      perStudy[a.study] = num(a.row, "n");
      counts.samples += num(a.row, "n"); counts.altered += num(a.row, "altered"); counts.unaltered += num(a.row, "unaltered");
    }
    counts.unprofiled = counts.samples - counts.altered - counts.unaltered;
    const frequency = frequencies(lines, answers.map((a) => a.row));
    const r = cases.r;
    const sortName = q.sort ? caseCols.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null;
    const pct = (n: number) => counts.samples ? " (" + (Math.round(n / counts.samples * 1000) / 10) + "%)" : "";
    const off = frequency.filter((f) => f.offPanel > 0);
    return result({ ...cases.rows, lines: lineInfo, counts, frequency, files: files(counts, perStudy), tables: {}, unchecked, oncokbPin: pin }, {
      method: datafilesMethod({ lines, cohort: vNames[0], studies: holders, counts, frequency, oncokbPin: pin, queryText: describeQuery(q, caseCols), sortName, desc: !!q.sort?.desc,
        shown: cases.rows.rows.length, lists: r.lists, excluded, instances: r.groups }),
      ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
      caveat: "The query alters " + plural(counts.altered, "sample") + pct(counts.altered) + " of the cohort's " + plural(counts.samples, "sample") +
        "; " + plural(counts.unaltered, "sample") + " are unaltered (profiled for every queried gene in every data type the query reads)" +
        (counts.unprofiled ? " and " + plural(counts.unprofiled, "sample") + " are neither: not altered, but not profiled for all of it, so not known to be unaltered" : "") + ". " +
        "A line's frequency is the samples it alters ÷ the samples profiled for its gene in any data type the line reads (their gene panels decide), " +
        (holders.length > 1 ? "its counts added across studies, never its percentages averaged; " : "") +
        "a sample its panel does not cover is not profiled, never wild-type. " +
        (off.length ? off.map((f) => f.line + ": " + plural(f.offPanel, "altered sample") + " outside its panel's coverage, left out of the frequency").join("; ") + ". " : "") +
        (unchecked.length ? "Expression or protein conditions (" + unchecked.join(", ") + ") cannot be checked for profiling: every sample counts as profiled for them. " : "") +
        "The case table and the altered / unaltered lists follow the query's OQL; the gene-by-sample files list every call of each gene (OQL is not in effect), as the portal's do. " +
        (pin ? "DRIVER reads OncoKB " + pin + ". " : "") +
        (holders.length > 1 ? "Studies are not deduplicated: a sample is listed under its own study. " : "") +
        "The case table: " + tableTail(r, q, caseCols, "sample", "with altered samples first, then by sample id", excluded, false),
    });
  } catch (e) { return no((e as Error).message); }
}
