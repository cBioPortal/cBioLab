// The input files a view's Python script reads, built from the view's own recorded queries.
//
// Most scripts embed their input (lib/method.ts, pyTable). The rest `pd.read_csv` a file the
// reader was told to export: patient-level rows for a Cox or logistic fit, and any aggregate table
// too large to inline. This runs the view's queries, assembles each table exactly as the view
// assembled it, and returns the files by the names the script reads — for the notebook download
// (app/api/analysis/notebook) and for scripts/check-method-scripts.ts, which runs the scripts.
//
// Rows never come from anywhere but the queries the view itself ran, so nothing here accepts SQL
// from a caller. A view whose queries ran on a federated peer is refused: a peer answers with
// aggregates only (docs/DATA-BOUNDARY.md), so there are no rows to export and none to rebuild.
import { chQuery, PRIMARY } from "./ch.ts";
import { studyRouting } from "./federation.ts";
import type { ViewResult } from "./types.ts";

/** Most rows one recorded query may return to be exported. */
export const MAX_QUERY_ROWS = 1_000_000;
/** Most CSV text, across all of a view's files, the server will assemble before giving up. */
export const MAX_CSV_CHARS = 60_000_000;

/** A request the export refuses, with the HTTP status it maps to. */
export class ExportRefused extends Error {
  readonly status: 403 | 413 | 422;
  constructor(message: string, status: 403 | 413 | 422) { super(message); this.status = status; }
}

type Row = Record<string, unknown>;
export type MethodFiles = Record<string, string>;
type Run = (study: string, sql: string) => Promise<Row[]>;

const csvField = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s; };
const toCsv = (rows: Row[], cols: string[]) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvField(r[c])).join(","))].join("\n") + "\n";

/** The files a script reads and does not carry: `pd.read_csv("<name>"` with a literal name. */
export function wantedFiles(python: string | undefined): string[] {
  return [...new Set([...(python || "").matchAll(/pd\.read_csv\("([^"]+)"/g)].map((m) => m[1]))];
}

/** Whether any of the view's numbers came from a federated peer. */
export function hasRemoteRows(v: Pick<ViewResult, "queries" | "participation">): boolean {
  return !!v.queries?.some((q) => q.remote) || !!v.participation?.studies.some((s) => s.remote);
}

/** Runs a recorded query on the instance that owns its study, capped at MAX_QUERY_ROWS rows. */
const runRecorded: Run = async (study, sql) => {
  const conn = (await studyRouting()).get(study) || PRIMARY;
  const rows = (await chQuery("SELECT * FROM (\n" + sql + "\n) LIMIT " + (MAX_QUERY_ROWS + 1), conn)).data as Row[];
  if (rows.length > MAX_QUERY_ROWS)
    throw new ExportRefused("a query for this view returns more than " + MAX_QUERY_ROWS.toLocaleString() + " rows; narrow the cohort to export its rows", 413);
  return rows;
};

/**
 * The files the view's script reads, or why they cannot be built. `files` is empty when the
 * script carries its own input. `missing` names files the script reads that no recorded query
 * can rebuild for this kind of view; the caller says so rather than shipping a script that fails.
 */
export async function methodFiles(v: ViewResult, run: Run = runRecorded): Promise<{ files: MethodFiles; missing: string[] }> {
  const wanted = wantedFiles(v.method?.python);
  if (!wanted.length) return { files: {}, missing: [] };
  if (hasRemoteRows(v))
    throw new ExportRefused("this view includes patients held by a federated portal, which answers with aggregates only, so its rows cannot be exported", 403);

  const files: MethodFiles = {};
  let chars = 0;
  const put = (name: string, csv: string) => {
    chars += csv.length;
    if (chars > MAX_CSV_CHARS) throw new ExportRefused("the data this view's script reads is too large to export", 413);
    files[name] = csv;
  };
  const qs = v.queries || [];

  if (v.kind === "cox") {
    // one file per fitted cohort ("cox_rows.csv", or "cox_rows_<cohort>.csv"); the fetch steps list the cohorts in the order the queries ran
    const fetches = v.method!.steps.filter((s) => s.kind === "fetch");
    const rowsQs = qs.filter((q) => q.label.startsWith("coxRows:"));
    if (fetches.length !== rowsQs.length) throw new ExportRefused("the Cox view's fetch steps and queries do not line up", 422);
    const byFile = new Map<string, Row[]>();
    for (let i = 0; i < rowsQs.length; i++) {
      const scope = fetches[i].scope || "";
      const cohort = scope.includes(" · ") ? scope.split(" · ")[0] : "";
      const file = "cox_rows" + (cohort ? "_" + cohort.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") : "") + ".csv";
      const rows = (await run(rowsQs[i].study, rowsQs[i].sql)).map((r) => ({ study: rowsQs[i].study, ...r }));
      byFile.set(file, [...(byFile.get(file) || []), ...rows]);
    }
    for (const [f, rows] of byFile) put(f, toCsv(rows, Object.keys(rows[0] || { study: 1 })));
  } else if (v.kind === "logistic") {
    const rows: Row[] = [];
    for (const q of qs.filter((q) => q.label === "logisticRows")) rows.push(...(await run(q.study, q.sql)).map((r) => ({ study: q.study, ...r })));
    put("logistic_rows.csv", toCsv(rows, Object.keys(rows[0] || { study: 1 })));
  } else if (v.kind === "diffexpr") {
    const sums = new Map<string, { cohort: string; gene: string; n: number; sx: number; sxx: number }>();
    for (const q of qs.filter((q) => q.label.startsWith("diffexpr:moments:"))) {
      const cohort = q.label.slice("diffexpr:moments:".length);
      for (const r of await run(q.study, q.sql)) {
        const k = cohort + "\t" + r.gene, cur = sums.get(k) || { cohort, gene: String(r.gene), n: 0, sx: 0, sxx: 0 };
        cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx); sums.set(k, cur);
      }
    }
    put("diffexpr_moments.csv", toCsv([...sums.values()], ["cohort", "gene", "n", "sx", "sxx"]));
  } else if (v.kind === "enrichment") {
    // altered and panel-profiled samples per (cohort, gene), plus each cohort's whole-exome samples,
    // assembled exactly as the view assembles them
    const altered = new Map<string, number>(), panel = new Map<string, number>(), wes = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) || 0) + n);
    for (const q of qs) {
      const [, part, cohort] = /^enrichment:(altered|panels|wes):(.*)$/.exec(q.label) || [];
      if (!part) continue;
      for (const r of await run(q.study, q.sql)) {
        if (part === "altered") add(altered, cohort + "\t" + r.gene, Number(r.altered));
        else if (part === "panels") add(panel, cohort + "\t" + r.gene, Number(r.profiled));
        else add(wes, cohort, Number(r.n));
      }
    }
    const rows: Row[] = [];
    for (const k of new Set([...altered.keys()])) {
      const [cohort, gene] = k.split("\t");
      const alt = altered.get(k) || 0;
      rows.push({ cohort, gene, altered: alt, profiled: Math.max(alt, (panel.get(k) || 0) + (wes.get(cohort) || 0)) });
    }
    // a cohort with no altered sample in a gene is still profiled for it
    const cohortsSeen = [...new Set([...wes.keys(), ...rows.map((r) => String(r.cohort))])];
    const genesSeen = new Set(rows.map((r) => String(r.gene)));
    for (const gene of genesSeen) for (const cohort of cohortsSeen) {
      const k = cohort + "\t" + gene;
      if (!altered.has(k)) rows.push({ cohort, gene, altered: 0, profiled: (panel.get(k) || 0) + (wes.get(cohort) || 0) });
    }
    put("enrichment_counts.csv", toCsv(rows, ["cohort", "gene", "altered", "profiled"]));
  } else if (v.kind === "assays") {
    // per (cohort, entity) moments, or per (cohort, entity, called value) counts, summed across studies
    const numeric = new Map<string, { cohort: string; entity: string; n: number; sx: number; sxx: number }>();
    const counts = new Map<string, { cohort: string; entity: string; value: string; n: number }>();
    for (const q of qs) {
      const [, part, cohort] = /^assays:(moments|values):(.*)$/.exec(q.label) || [];
      if (!part) continue;
      for (const r of await run(q.study, q.sql)) {
        if (part === "moments") {
          const k = cohort + "\t" + r.entity, cur = numeric.get(k) || { cohort, entity: String(r.entity), n: 0, sx: 0, sxx: 0 };
          cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx); numeric.set(k, cur);
        } else {
          const value = String(r.value ?? "").trim();
          if (["", "NA", "N/A", "NaN", "nan", "null", "NULL"].includes(value)) continue;
          const k = cohort + "\t" + r.entity + "\t" + value, cur = counts.get(k) || { cohort, entity: String(r.entity), value, n: 0 };
          cur.n += Number(r.n); counts.set(k, cur);
        }
      }
    }
    if (wanted.includes("assays_moments.csv")) put("assays_moments.csv", toCsv([...numeric.values()], ["cohort", "entity", "n", "sx", "sxx"]));
    if (wanted.includes("assays_counts.csv")) put("assays_counts.csv", toCsv([...counts.values()], ["cohort", "entity", "value", "n"]));
  } else if (v.kind === "correlates") {
    const rows: Row[] = [];
    for (const q of qs.filter((q) => q.label === "correlates:moments")) rows.push(...(await run(q.study, q.sql)).map((r) => ({ study: q.study, ...r })));
    put("correlates_sums.csv", toCsv(rows, ["study", "gene", "n", "sx", "sy", "sxy", "sxx", "syy", "rsx", "rsy", "rsxy", "rsxx", "rsyy"]));
  }
  return { files, missing: wanted.filter((f) => !(f in files)) };
}
