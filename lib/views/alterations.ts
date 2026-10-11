// Alterations view: the cohort's patients, and one patient's Mutations, Copy Number Alterations and
// Structural Variants tables (cBioPortal's patient view) — four table views in one, each on
// lib/table-query.ts with its own query, the row sources in lib/patient-alterations.ts.
import type { ViewResult, AlterationsView, AlterationsResult, TableRows } from "../types.ts";
import type { PatientLevelCapable } from "../federation.ts";
import type { TablePart } from "../mutation-table.ts";
import { checkQuery, describeQuery, shownColumns, type TableQuery } from "../table-query.ts";
import { alterationsMethod } from "../method.ts";
import { PATIENT_ID } from "../patient-timeline.ts";
import { sampleMarks } from "../timeline-tracks.ts";
import {
  ALTERATION_TABLES, ALTERATION_TABLE_NAMES, ALTERATION_COLUMNS, ALTERATION_DEFAULT_COLUMNS, ALTERATION_PATIENT_COLUMNS, ALTERATION_PATIENT_DEFAULT_COLUMNS,
  alterationSource, alterationPatientRowSource, patientSamplesSource, type AlterationTable,
} from "../patient-alterations.ts";
import type { ViewRun } from "./run.ts";
import { TABLE_ROWS_MAX, listPosition, rowHolders, runRows, tableTail, viewQuery, type Rows } from "./rows.ts";
import { plural, refuse } from "./shared.ts";

type Cell = string | number | null;

/** A row's value in a column: numbers as numbers, OncoKB's call spelled as the SQL spells it. */
function cellOf(r: Record<string, unknown>, c: { id: string; numeric: boolean }): Cell {
  if (c.id === "annotation") {
    const o = String(r.oncogenicity || ""), lv = String(r.level || "");
    return o ? o + (lv ? " · " + lv.replace(/^LEVEL_/, "Level ") : "") : "";
  }
  const x = r[c.id];
  if (!c.numeric) return x == null ? "" : String(x);
  if (x == null || x === "") return null;
  const n = Number(x);
  return c.id === "vaf" ? Math.round(n * 1000) / 1000 : c.id === "freq" ? Math.round(n * 10) / 10 : n;
}

/** A page of rows as the result carries them, aligned with `cols`. */
const rowsOf = (r: Rows, cols: { id: string; numeric: boolean }[]) => r.rows.map((x) => ({
  cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? x.sample ?? ""),
  values: cols.map((c) => cellOf(x, c)) }));

/** The table's page size from its spec: 1 to TABLE_ROWS_MAX, 25 when unset; NaN when out of range. */
const pageSize = (n: unknown) => n == null ? 25 : Math.floor(Number(n));

export async function runAlterations(view: AlterationsView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames, pin } = ctx;
  const no = (msg: string) => refuse("alterations", ctx, msg);
  if (vNames.length !== 1) return no("an alterations view steps through one cohort's patients; this one draws " + vNames.length + " — name one in cohorts");
  const show = pageSize(view.rows);
  if (!(show >= 1 && show <= TABLE_ROWS_MAX)) return no("rows (the page size of the patient list) is 1 to " + TABLE_ROWS_MAX);
  if (view.patient != null && (typeof view.patient !== "object" || typeof view.patient.study !== "string" || typeof view.patient.id !== "string" || !PATIENT_ID.test(view.patient.id)))
    return no("patient is {study, id}: a study of the view's cohort and a patient id in it, e.g. {\"study\": \"msk_chord_2024\", \"id\": \"P-0024249\"}");
  const q = viewQuery(view);
  { const bad = checkQuery(q, ALTERATION_PATIENT_COLUMNS); if (bad) return no(bad); }
  // each table's own query and page size
  const tq = {} as Record<AlterationTable, { q: TableQuery; size: number }>;
  for (const t of ALTERATION_TABLES) {
    const spec = view[t];
    if (spec != null && (typeof spec !== "object" || Array.isArray(spec))) return no(t + " is that table's query: {columns, search, filters, sort, rows}, each optional");
    const size = pageSize(spec?.rows);
    if (!(size >= 1 && size <= TABLE_ROWS_MAX)) return no(t + ".rows (the table's page size) is 1 to " + TABLE_ROWS_MAX);
    const tqq = viewQuery(spec || {});
    const bad = checkQuery(tqq, ALTERATION_COLUMNS[t]);
    if (bad) return no(t + ": " + bad);
    tq[t] = { q: tqq, size };
  }
  const only = ctx.table == null ? null : (ALTERATION_TABLES as readonly string[]).includes(ctx.table) ? ctx.table as AlterationTable : undefined;
  if (only === undefined) return no("table is one of " + ALTERATION_TABLES.join(", ") + ", or none for the patient list");

  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return no("no study here may disclose a patient's alterations (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  if (view.patient && !ctx.vStudies.includes(view.patient.study))
    return no("patient " + view.patient.id + " is named in " + view.patient.study + ", which this view's cohort does not span (" + ctx.vStudies.join(", ") + ")");
  if (view.patient && !holders.includes(view.patient.study))
    return no(view.patient.study + " is " + excluded.find((e) => e.study === view.patient!.study)!.reason + ", so its patients' alterations cannot be shown");

  const defaults = ALTERATION_PATIENT_DEFAULT_COLUMNS;
  const shown = shownColumns(q, ALTERATION_PATIENT_COLUMNS, defaults);
  const listRows = (size: number, opts: { values?: boolean; locate?: { study: string; patient: string } } = {}) =>
    runRows(ctx, "alterations", holders, q, defaults, shown, size, (parts) => (db) => alterationPatientRowSource(parts, db),
      opts.values && ctx.values ? { column: ctx.values, numeric: !!ALTERATION_PATIENT_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined, undefined, opts.locate);
  /** the patient's samples in their order — the numbered markers, which order a gene's rows — read whole whatever page is asked */
  const samplesOf = async (pt: { study: string; id: string }) => {
    const r = await runRows({ ...ctx, page: undefined, values: undefined }, "alterations:samples", [pt.study], {}, ["sid"], ["sid", "type"], TABLE_ROWS_MAX,
      (parts: TablePart[]) => (db) => patientSamplesSource(parts[0], pt.id, db));
    const samples = r.rows.map((x) => ({ id: String(x.sid), type: String(x.type ?? "") }));
    return { samples, order: [...sampleMarks(samples, []).keys()] };
  };
  /** one of the patient's tables, for the page (or values) the request asks of it */
  const tableRows = async (t: AlterationTable, pt: { study: string; id: string }, order: string[]): Promise<{ r: Rows; rows: TableRows<Cell> }> => {
    const cols = ALTERATION_COLUMNS[t], { q: tqq, size } = tq[t], defs = ALTERATION_DEFAULT_COLUMNS[t];
    const r = await runRows(ctx, "alterations:" + t, [pt.study], tqq, defs, shownColumns(tqq, cols, defs), size,
      (parts: TablePart[]) => (db) => alterationSource(t, parts[0], pt.id, db, pin, order),
      ctx.values && only === t ? { column: ctx.values, numeric: !!cols.find((c) => c.id === ctx.values)?.numeric } : undefined);
    const columns = cols.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
    return { r, rows: { columns, shown: shownColumns(tqq, columns, defs), defaults: defs, query: tqq, rows: rowsOf(r, cols), offset: r.offset, pageSize: size,
      lists: r.lists, total: r.total, all: r.all, ...(r.values ? { values: r.values } : {}) } };
  };
  const listColumns = ALTERATION_PATIENT_COLUMNS.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
  const listOf = (r: Rows) => ({ columns: listColumns, shown, defaults, query: q, rows: rowsOf(r, ALTERATION_PATIENT_COLUMNS), offset: r.offset, pageSize: show,
    lists: r.lists, total: r.total, all: r.all, ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) });
  const partial = (a: AlterationsResult): ViewResult => ({ kind: "alterations", cohorts: vNames, alterations: a, participation: ctx.participationFor(ctx.vStudies, true) });

  try {
    // a page (or a column's values) of one of the patient's tables: that table alone
    if (only && (ctx.page || ctx.values)) {
      const pt = view.patient ? { study: view.patient.study, id: view.patient.id } : null;
      const first = pt ? null : await listRows(1);
      const want = pt || (first?.rows[0] ? { study: String(first.rows[0].study), id: String(first.rows[0].patient) } : null);
      if (!want) return no("the cohort's patient list is empty, so there is no patient's " + only + " table to page");
      const { rows } = await tableRows(only, want, (await samplesOf(want)).order);
      return partial({ ...listOf({ rows: [], lists: [], total: 0, all: 0, offset: 0, groups: 1 }), patient: { ...want, samples: [] }, tables: { [only]: rows }, oncokbPin: pin });
    }
    const r = await listRows(show, { values: true, locate: view.patient && !ctx.page && !ctx.values ? { study: view.patient.study, patient: view.patient.id } : undefined });
    if (ctx.page || ctx.values) return partial({ ...listOf(r), patient: null, tables: {}, oncokbPin: pin });

    // the patient listed: the one the view names (checked to be one of its cohort's patients), else the list's first
    const want = view.patient ? { study: view.patient.study, id: view.patient.id } : r.rows[0] ? { study: String(r.rows[0].study), id: String(r.rows[0].patient) } : null;
    if (want && view.patient && !r.position) {
      const res = ctx.resolvers[want.study] as unknown as PatientLevelCapable;
      const member: TableQuery = { filters: { patient: { op: "equals", value: want.id } } };
      const counts = await res.rowsCounts("alterations:member", (db) => alterationPatientRowSource(vNames.filter((cn) => ctx.cohorts[cn].studies.includes(want.study))
        .map((cn) => ({ cohort: cn, study: want.study, cohortSql: ctx.resolvers[want.study].cohortSql(ctx.doc.cohorts[cn]) })), db), member, defaults);
      if (!counts.some((c) => c.n > 0)) return no(want.id + " is not a patient of this cohort in " + want.study);
    }
    const smp = want ? await samplesOf(want) : null;
    const [position, ...tabs] = await Promise.all([
      want ? listPosition(r, !!view.patient, (first) => listRows(1, { locate: first })) : Promise.resolve(null),
      ...ALTERATION_TABLES.map((t) => want ? tableRows(t, want, smp!.order) : Promise.resolve(null)),
    ]);
    const tables: AlterationsResult["tables"] = {};
    ALTERATION_TABLES.forEach((t, i) => { const x = tabs[i]; if (x) tables[t] = x.rows; });
    const samples = smp?.samples || [];
    const list = listOf(r);
    const sortName = q.sort ? listColumns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null;
    const tableLine = (t: AlterationTable) => {
      const x = tables[t]!, d = describeQuery(x.query, x.columns);
      return ALTERATION_TABLE_NAMES[t] + ": " + (d ? x.total.toLocaleString("en-US") + " of " : "") + plural(x.all, "row") + (d ? " (" + d + ")" : "");
    };
    return {
      kind: "alterations", cohorts: vNames,
      alterations: { ...list, patient: want ? { ...want, samples } : null, position, tables, oncokbPin: pin },
      method: alterationsMethod({ cohorts: vNames, oncokbPin: pin, queryText: describeQuery(q, listColumns), sortName, desc: !!q.sort?.desc, shown: list.rows.length,
        lists: r.lists, excluded, instances: r.groups, patient: want,
        tables: want ? ALTERATION_TABLES.map((t) => ({ name: ALTERATION_TABLE_NAMES[t], total: tables[t]!.total, all: tables[t]!.all, queryText: describeQuery(tables[t]!.query, tables[t]!.columns) })) : [] }),
      participation: ctx.participationFor(ctx.vStudies, true),
      ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
      caveat: (want ? want.id + " — " + ALTERATION_TABLES.map(tableLine).join("; ") + ". " : "No patient to list: the cohort's patient list is empty. ") +
        "Each table lists a variant, a gene's call or an event once however many of the patient's samples carry it (Samples names them); allele frequency and read counts are the highest among those samples. " +
        "Copy number is the deep calls only (AMP, HOMDEL), as the portal's patient view lists them; Copy # on a mutation is the gene's deep calls anywhere in the patient. " +
        "Cohort % is the share of the study's samples profiled for the gene by their panel with a mutation in it, or with the same copy-number call. " +
        (pin ? "Annotation is OncoKB " + pin + " (oncogenicity and its highest sensitivity level); structural variants carry the study's own annotation, not OncoKB's. " : "No OncoKB version is pinned here, so the annotation columns are empty. ") +
        "The patient list: " + tableTail(r, q, listColumns, "patient", "with patients who have any alteration first, then by patient id", excluded, false),
    };
  } catch (e) { return no((e as Error).message); }
}
