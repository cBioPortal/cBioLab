// Evolution view: the cohort's patients with two or more samples and allele counts, and one
// patient's mutations followed across their samples (cBioPortal's Genomic Evolution tab) — a table
// view of the mutations (lib/table-query.ts, row sources in ./sql.ts) and the figure drawn from
// every mutation its query keeps (./figure.ts).
import type { ViewResult, TableRows } from "../../types.ts";
import { hasPatientTimeline, type PatientLevelCapable, type Resolver } from "../../federation.ts";
import type { TablePart } from "../../mutation-table.ts";
import { checkQuery, describeQuery, shownColumns, type TableQuery } from "../../table-query.ts";
import { PATIENT_ID } from "../../patient-timeline.ts";
import { sampleDays, sampleMarks } from "../../timeline-tracks.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, listPosition, rowHolders, runRows, tableTail, viewQuery, type Rows } from "../rows.ts";
import { plural, refuse } from "../shared.ts";
import {
  EVOLUTION_COLUMNS, EVOLUTION_DEFAULT_COLUMNS, EVOLUTION_PATIENT_COLUMNS, EVOLUTION_PATIENT_DEFAULT_COLUMNS,
  evolutionMutationsSource, evolutionPatientsSource, evolutionSamplesSource,
} from "./sql.ts";
import type { EvolutionView, EvolutionResult, EvolutionSample, EvolutionMutation, EvolutionCell, EvolutionStatus } from "./types.ts";
import { evolutionMethod } from "./method.ts";
import { EVOLUTION_KEY_COLUMNS, evolutionKey } from "./figure.ts";

type Cell = string | number | null;

/** A row's value in a column: numbers as numbers (VAF to three places), text as text. */
function cellOf(r: Record<string, unknown>, c: { id: string; numeric: boolean }): Cell {
  const x = r[c.id];
  if (!c.numeric) return x == null ? "" : String(x);
  if (x == null || x === "") return null;
  const n = Number(x);
  return c.id === "maxVaf" ? Math.round(n * 1000) / 1000 : n;
}
const rowsOf = (r: Rows, cols: { id: string; numeric: boolean }[]) => r.rows.map((x) => ({
  cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? x.sample ?? ""),
  values: cols.map((c) => cellOf(x, c)) }));

const pageSize = (n: unknown) => n == null ? 25 : Math.floor(Number(n));
const STATUSES: EvolutionStatus[] = ["called", "noVaf", "uncalled", "absent", "np"];
const n = (x: unknown) => x == null || x === "" ? null : Number(x);

/** A row's `cells` (the mutation in each sample, in the patient's sample order) as the figure takes them. */
export function cellsOf(raw: unknown, samples: string[]): EvolutionCell[] {
  const bySample = new Map<string, EvolutionCell>();
  for (const t of (Array.isArray(raw) ? raw : []) as unknown[]) {
    const a = Array.isArray(t) ? t : Object.values(t as Record<string, unknown>);
    const status = String(a[2]) as EvolutionStatus;
    if (!STATUSES.includes(status)) throw new Error("unexpected mutation state " + String(a[2]));
    const vaf = n(a[3]);
    bySample.set(String(a[1]), { status, vaf: vaf == null ? null : Math.round(vaf * 10000) / 10000, alt: n(a[4]), ref: n(a[5]) });
  }
  return samples.map((s) => bySample.get(s) || { status: "np", vaf: null, alt: null, ref: null });
}

/** Mutations one figure draws at most: past it, the reader narrows the table's query. */
export const EVOLUTION_DRAW_MAX = TABLE_ROWS_MAX;

export async function runEvolution(view: EvolutionView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames } = ctx;
  const no = (msg: string) => refuse("evolution", ctx, msg);
  if (vNames.length !== 1) return no("an evolution view steps through one cohort's patients; this one draws " + vNames.length + " — name one in cohorts");
  const show = pageSize(view.rows);
  if (!(show >= 1 && show <= TABLE_ROWS_MAX)) return no("rows (the page size of the patient list) is 1 to " + TABLE_ROWS_MAX);
  if (view.patient != null && (typeof view.patient !== "object" || typeof view.patient.study !== "string" || typeof view.patient.id !== "string" || !PATIENT_ID.test(view.patient.id)))
    return no("patient is {study, id}: a study of the view's cohort and a patient id in it, e.g. {\"study\": \"glioma_msk_2018\", \"id\": \"IM-GBM-28\"}");
  if (view.chart != null && view.chart !== "line" && view.chart !== "heatmap") return no("chart is \"line\" (a line per mutation across the samples, the default) or \"heatmap\" (mutation × sample)");
  for (const k of ["sequential", "logScale", "dataRange"] as const)
    if (view[k] != null && typeof view[k] !== "boolean") return no(k + " is true or false");
  const q = viewQuery(view);
  { const bad = checkQuery(q, EVOLUTION_PATIENT_COLUMNS); if (bad) return no(bad); }
  if (view.mutations != null && (typeof view.mutations !== "object" || Array.isArray(view.mutations))) return no("mutations is the mutation table's query: {columns, search, filters, sort, rows}, each optional");
  const mSize = pageSize(view.mutations?.rows);
  if (!(mSize >= 1 && mSize <= TABLE_ROWS_MAX)) return no("mutations.rows (the table's page size) is 1 to " + TABLE_ROWS_MAX);
  const mq = viewQuery(view.mutations || {});
  { const bad = checkQuery(mq, EVOLUTION_COLUMNS); if (bad) return no("mutations: " + bad); }
  if (ctx.table != null && ctx.table !== "mutations") return no("table is mutations, or none for the patient list");
  const display = { chart: view.chart || "line", logScale: !!view.logScale, dataRange: !!view.dataRange } as const;

  // who may answer: a local patient-level participant (no peer serves this view's rows)
  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return no("no study here may disclose a patient's mutations (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  if (view.patient && !ctx.vStudies.includes(view.patient.study))
    return no("patient " + view.patient.id + " is named in " + view.patient.study + ", which this view's cohort does not span (" + ctx.vStudies.join(", ") + ")");
  if (view.patient && !holders.includes(view.patient.study))
    return no(view.patient.study + " is " + excluded.find((e) => e.study === view.patient!.study)!.reason + ", so its patients' mutations cannot be shown");

  const defaults = EVOLUTION_PATIENT_DEFAULT_COLUMNS;
  const shown = shownColumns(q, EVOLUTION_PATIENT_COLUMNS, defaults);
  const listRows = (size: number, opts: { values?: boolean; locate?: { study: string; patient: string }; whole?: boolean } = {}) =>
    runRows(opts.whole ? { ...ctx, page: undefined, values: undefined } : ctx, "evolution", holders, q, defaults, shown, size, (parts) => (db) => evolutionPatientsSource(parts, db),
      opts.values && ctx.values && !ctx.table ? { column: ctx.values, numeric: !!EVOLUTION_PATIENT_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined, undefined, opts.locate);
  /** the patient's samples in order — numbered markers, collection days, mutation panels — read whole */
  const samplesOf = async (pt: { study: string; id: string }): Promise<EvolutionSample[]> => {
    const res = ctx.resolvers[pt.study];
    if (!hasPatientTimeline(res)) throw new Error(pt.study + " cannot disclose a patient's samples and timeline");
    const [tl, panels] = await Promise.all([res.patientTimeline(pt.id),
      runRows({ ...ctx, page: undefined, values: undefined }, "evolution:samples", [pt.study], {}, ["sid"], ["sid", "panel"], TABLE_ROWS_MAX,
        (parts: TablePart[]) => (db) => evolutionSamplesSource(parts[0], pt.id, db))]);
    const panel = new Map(panels.rows.map((x) => [String(x.sid), String(x.panel ?? "")]));
    const days = sampleDays(tl.events);
    const own = new Set(tl.samples.map((s) => s.id));
    return [...sampleMarks(tl.samples, tl.events).values()].filter((m) => own.has(m.id)).map((m) => ({
      id: m.id, type: tl.samples.find((s) => s.id === m.id)?.type || "", label: m.label, color: m.color,
      day: days.has(m.id) ? days.get(m.id)! : null, panel: panel.get(m.id) || null }));
  };
  const mutationRows = (pt: { study: string; id: string }, order: string[], size: number) =>
    runRows(ctx, "evolution:mutations", [pt.study], mq, EVOLUTION_DEFAULT_COLUMNS, shownColumns(mq, EVOLUTION_COLUMNS, EVOLUTION_DEFAULT_COLUMNS), size,
      (parts: TablePart[]) => (db) => evolutionMutationsSource(parts[0], pt.id, db, order),
      ctx.values && ctx.table === "mutations" ? { column: ctx.values, numeric: !!EVOLUTION_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined);
  const mColumns = EVOLUTION_COLUMNS.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
  const tableOf = (r: Rows, rows: Rows["rows"]): TableRows<Cell> => ({ columns: mColumns, shown: shownColumns(mq, mColumns, EVOLUTION_DEFAULT_COLUMNS), defaults: EVOLUTION_DEFAULT_COLUMNS,
    query: mq, rows: rowsOf({ ...r, rows }, EVOLUTION_COLUMNS), offset: r.offset, pageSize: mSize, lists: r.lists, total: r.total, all: r.all, ...(r.values ? { values: r.values } : {}) });
  const listColumns = EVOLUTION_PATIENT_COLUMNS.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
  const listOf = (r: Rows) => ({ columns: listColumns, shown, defaults, query: q, rows: rowsOf(r, EVOLUTION_PATIENT_COLUMNS), offset: r.offset, pageSize: show,
    lists: r.lists, total: r.total, all: r.all, ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) });
  const empty: Rows = { rows: [], lists: [], total: 0, all: 0, offset: 0, groups: 1 };
  const partial = (a: EvolutionResult): ViewResult => ({ kind: "evolution", cohorts: vNames, evolution: a, participation: ctx.participationFor(ctx.vStudies, true) });
  const bare = { drawn: null, noVaf: 0, x: "sequence" as const, display };

  /** Whether `pt` is one of the cohort's patients and, if so, its row in the unfiltered list (drawable or not). */
  const memberRow = async (pt: { study: string; id: string }, drawable: boolean) => {
    const res = ctx.resolvers[pt.study] as unknown as PatientLevelCapable & Resolver;
    const member: TableQuery = { filters: { patient: { op: "equals", value: pt.id } } };
    const parts = vNames.filter((cn) => ctx.cohorts[cn].studies.includes(pt.study)).map((cn) => ({ cohort: cn, study: pt.study, cohortSql: res.cohortSql(ctx.doc.cohorts[cn]) }));
    const page = await res.rowsPage("evolution:member", (db) => evolutionPatientsSource(parts, db, drawable), member, defaults, 1, 0);
    return page.rows[0] || null;
  };
  /** why a patient of the cohort cannot be drawn */
  const whyNot = (pt: { id: string }, row: Record<string, unknown>) => Number(row.samples) < 2
    ? pt.id + " has " + plural(Number(row.samples), "sample") + "; following mutations across samples needs at least two"
    : pt.id + "'s " + plural(Number(row.mutations), "called mutation") + " carry no allele counts (variant and reference reads) in any sample, so there is no allele frequency to draw";

  try {
    // a page (or a column's values) of the patient's mutation table: that table alone
    if (ctx.table === "mutations" && (ctx.page || ctx.values)) {
      // the list's first patient, whatever page of the table is asked
      const first = view.patient ? null : await listRows(1, { whole: true });
      const want = view.patient ? { study: view.patient.study, id: view.patient.id } : first?.rows[0] ? { study: String(first.rows[0].study), id: String(first.rows[0].patient) } : null;
      if (!want) return no("the cohort has no patient with two or more samples and allele counts, so there is no mutation table to page");
      const samples = await samplesOf(want);
      const r = await mutationRows(want, samples.map((s) => s.id), mSize);
      return partial({ ...listOf(empty), patient: { ...want, samples }, mutations: tableOf(r, r.rows), ...bare });
    }
    const r = await listRows(show, { values: true, locate: view.patient && !ctx.page && !ctx.values ? { study: view.patient.study, patient: view.patient.id } : undefined });
    if (ctx.page || ctx.values) return partial({ ...listOf(r), patient: null, ...bare });

    const want = view.patient ? { study: view.patient.study, id: view.patient.id } : r.rows[0] ? { study: String(r.rows[0].study), id: String(r.rows[0].patient) } : null;
    if (!want) {
      // nothing to draw: say how many of the cohort's patients there are and why none can be drawn
      if (r.all > 0) return no("the patient list's query keeps none of the " + plural(r.all, "patient") + " that can be drawn (" + describeQuery(q, listColumns) + ")");
      const everyone = await runRows(ctx, "evolution:everyone", holders, {}, defaults, shown, 1, (parts) => (db) => evolutionPatientsSource(parts, db, false));
      const multi = await runRows(ctx, "evolution:everyone", holders, { filters: { samples: { min: 2 } } }, defaults, shown, 1, (parts) => (db) => evolutionPatientsSource(parts, db, false));
      if (everyone.total === 1 && everyone.rows[0]) return no(whyNot({ id: String(everyone.rows[0].patient) }, everyone.rows[0]));
      return no("no patient of this cohort can be drawn: of its " + plural(everyone.total, "patient") + ", " + (multi.total === 0 ? "none has" : "only " + plural(multi.total, "patient") + (multi.total === 1 ? " has" : " have")) +
        " two or more samples" + (multi.total ? ", and their mutations carry no allele counts (variant and reference reads)" : "") + " — the Genomic Evolution view needs both");
    }
    if (view.patient && !r.position) {
      // the named patient: one the list's query leaves out is drawn if it can be; else the reason it cannot
      if (!await memberRow(want, true)) {
        const row = await memberRow(want, false);
        return no(row ? whyNot(want, row) : want.id + " is not a patient of this cohort in " + want.study);
      }
    }
    const samples = await samplesOf(want);
    const order = samples.map((s) => s.id);
    const [position, m] = await Promise.all([
      listPosition(r, !!view.patient, (first) => listRows(1, { locate: first })),
      mutationRows(want, order, EVOLUTION_DRAW_MAX),
    ]);
    const table = tableOf(m, m.rows.slice(0, mSize));
    const over = m.total > EVOLUTION_DRAW_MAX;
    const kept = over ? [] : m.rows.map((x) => ({ x, cells: cellsOf(x.cells, order) }));
    const drawn: EvolutionMutation[] | null = over ? null : kept.filter((k) => k.cells.some((c) => c.status === "called"))
      .map((k) => ({ key: evolutionKey(EVOLUTION_KEY_COLUMNS.map((id) => cellOf(k.x, EVOLUTION_COLUMNS.find((c) => c.id === id)!))), gene: String(k.x.gene ?? ""), proteinChange: String(k.x.proteinChange ?? ""), mutationType: String(k.x.mutationType ?? ""), cells: k.cells }));
    const noVaf = over ? 0 : kept.length - drawn!.length;
    const noDay = samples.filter((s) => s.day == null).map((s) => s.id);
    const x: EvolutionResult["x"] = view.sequential || noDay.length ? "sequence" : "time";
    const undrawn = over ? "the mutation table's query keeps " + m.total.toLocaleString("en-US") + " mutations; one figure draws at most " + EVOLUTION_DRAW_MAX.toLocaleString("en-US") + " — narrow the table's search or filters" : undefined;
    const notSeq = samples.filter((s) => !s.panel).map((s) => s.id);
    const npCells = drawn ? drawn.reduce((a, d) => a + d.cells.filter((c) => c.status === "np").length, 0) : 0;
    const list = listOf(r);
    const sortName = q.sort ? listColumns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null;
    const tq = describeQuery(mq, mColumns);
    return {
      kind: "evolution", cohorts: vNames,
      evolution: { ...list, patient: { ...want, samples }, position, mutations: table, drawn, ...(undrawn ? { undrawn } : {}), noVaf, x,
        ...(!view.sequential && noDay.length ? { noDay } : {}), display },
      method: evolutionMethod({ cohorts: vNames, queryText: describeQuery(q, listColumns), sortName, desc: !!q.sort?.desc, shown: list.rows.length, lists: r.lists, excluded, instances: r.groups,
        patient: want, samples: samples.length, table: { total: m.total, all: m.all, queryText: tq }, drawn: drawn?.length ?? null, noVaf }),
      participation: ctx.participationFor(ctx.vStudies, true),
      ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
      caveat: want.id + ": " + plural(samples.length, "sample") + " in " + (x === "time" ? "collection order, placed by the day each was collected (days from diagnosis, from the study's timeline)" : "order (the numbered markers: by collection day where the timeline records it, then primary before metastasis, then by id), evenly spaced") + ". " +
        (!view.sequential && noDay.length ? "The samples are drawn in sequence because " + (noDay.length === samples.length ? "no sample's" : plural(noDay.length, "sample") + "'s") + " collection day is recorded (" + noDay.join(", ") + "). " : "") +
        (over ? "Not drawn: " + undrawn + ". " : (tq ? m.total.toLocaleString("en-US") + " of " + plural(m.all, "mutation") + " kept by the table's query (" + tq + "); " : plural(m.all, "mutation") + "; ") +
          drawn!.length.toLocaleString("en-US") + (drawn!.length === 1 ? " is" : " are") + " drawn" + (noVaf ? " — " + plural(noVaf, "mutation") + " with no allele counts in any sample " + (noVaf === 1 ? "is" : "are") + " listed but not drawn" : "") + ". ") +
        "VAF is variant reads ÷ (variant + reference reads) in each sample. A mutation called in one sample is followed into the others: there it is an uncalled mutation where the study's uncalled-mutations profile found variant reads (drawn with that VAF), " +
        "not found (VAF 0) where the sample was sequenced for the gene, or NOT PROFILED where the sample's panel does not cover the gene" + (notSeq.length ? " or the sample was not sequenced for mutations (" + notSeq.join(", ") + ")" : "") +
        " — never 0" + (npCells ? " (" + plural(npCells, "such cell") + " here)" : "") + ". " +
        (display.chart === "line" ? "A line joins a mutation's VAFs from the first to the last sample with variant reads, as the portal draws it; it bridges a not-profiled sample, or one called without allele counts, with a dashed segment" +
          (display.logScale ? "; the y axis is log-scaled, a VAF of 0 sitting at its floor of 0.001" : "") + (display.dataRange ? "; the y axis spans the VAFs drawn rather than 0 to 1" : "") + ". "
          : "The heatmap colours each sample's VAF from 0 to 1; grey is not found, white with a bar is not profiled. ") +
        "Fusions recorded as mutations are left out, as the portal leaves them out. " +
        "The patient list holds the cohort's patients with two or more samples and a mutation with allele counts: " + tableTail(r, q, listColumns, "patient", "with the most samples first, then by patient id", excluded, false),
    };
  } catch (e) { return no((e as Error).message); }
}
