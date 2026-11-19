// Alterations view: the cohort's patients, and one patient's Mutations, Copy Number Alterations and
// Structural Variants tables (cBioPortal's patient view) — four table views in one, each on
// lib/table-query.ts with its own query, the row sources in lib/patient-alterations.ts.
import type { ViewResult, TableRows } from "../../types.ts";
import { peerRowsFor, type PatientLevelCapable, type PeerTable, type Resolver } from "../../federation.ts";
import type { TablePart } from "../../mutation-table.ts";
import { checkQuery, describeQuery, shownColumns, type TableQuery } from "../../table-query.ts";
import { PATIENT_ID } from "../../patient-timeline.ts";
import { sampleMarks } from "../../timeline-tracks.ts";
import { mutationTypeLabel } from "../../mutation-type.ts";
import {
  ALTERATION_TABLES, ALTERATION_TABLE_NAMES, ALTERATION_COLUMNS, ALTERATION_PATIENT_COLUMNS, ALTERATION_PATIENT_DEFAULT_COLUMNS,
  alterationDefaults, alterationSource, mrnaRankProfile, type MrnaRank, alterationPatientRowSource, patientProfiledSource, patientSamplesSource, type AlterationPart, type AlterationTable,
} from "../../patient-alterations.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, listPosition, rowHolders, runRows, tableTail, viewQuery, type RemoteRows, type Rows } from "../rows.ts";
import { patientSampleEvents, plural, refuse } from "../shared.ts";
import type { AlterationsView, AlterationsResult, AlleleReads, CohortCount } from "./types.ts";
import { alterationsMethod } from "./method.ts";

type Cell = string | number | null;

/** A row's value in a column: numbers as numbers, OncoKB's call spelled as the SQL spells it. */
function cellOf(r: Record<string, unknown>, c: { id: string; numeric: boolean }): Cell {
  if (c.id === "annotation") {
    const o = String(r.oncogenicity || ""), lv = String(r.level || "");
    return o ? o + (lv ? " · " + lv.replace(/^LEVEL_/, "Level ") : "") : "";
  }
  const x = r[c.id];
  // the portal's label, which the column searches, filters and sorts by; the stored type rides in the row's detail
  if (c.id === "mutationType") return mutationTypeLabel(x == null ? "" : String(x));
  if (!c.numeric) return x == null ? "" : String(x);
  if (x == null || x === "") return null;
  const n = Number(x);
  return n;
}

/** A mutation's reads in each sample carrying it with allele counts, in the patient's sample order: what its Allele Freq cell draws. */
function readsOf(x: unknown): AlleleReads[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.map((t) => ({ sample: String(t[0]), alt: Number(t[1]), ref: Number(t[2]) }));
}

/** A row's Cohort counts, when its table reads them: what the Cohort cell draws and its tooltip says. */
function cohortOf(x: Record<string, unknown>): CohortCount | undefined {
  if (x.cohortOf == null) return undefined;
  const kw = String(x.keyword ?? "");
  return { n: Number(x.cohortN ?? 0), of: Number(x.cohortOf), ...(kw ? { keyword: kw, keywordN: Number(x.cohortKwN ?? 0) } : {}) };
}

/**
 * A page of rows as the result carries them, aligned with `cols`; a mutation row's detail holds its
 * per-sample reads and its stored type (the cell shows the portal's label); a mutation or copy-number
 * row's, its Cohort counts.
 */
const rowsOf = (r: Rows, cols: { id: string; numeric: boolean }[]) => r.rows.map((x) => {
  const reads = readsOf(x.reads);
  const typed = cols.some((c) => c.id === "mutationType");
  const mrnaZ = x.mrnaZ == null ? undefined : Number(x.mrnaZ);
  const cohort = cohortOf(x);
  // the samples in view not profiled for the row's gene (PAT-GP-2): the Samples cell's grey pills
  const notProfiled = Array.isArray(x.notProfiled) && x.notProfiled.length ? (x.notProfiled as unknown[]).map(String) : null;
  // the Gene panel cell's list (with the unprofiled samples' panels), where it differs from the column's value
  const genePanelShown = x.genePanelShown && x.genePanelShown !== x.genePanel ? String(x.genePanelShown) : null;
  const detail = { ...(reads ? { reads } : {}), ...(typed ? { mutationType: String(x.mutationType ?? "") } : {}), ...(cohort ? { cohort } : {}), ...(notProfiled ? { notProfiled } : {}), ...(genePanelShown ? { genePanelShown } : {}), ...(mrnaZ != null && Number.isFinite(mrnaZ) ? { mrnaZ } : {}) };
  return { cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: String(x.sid ?? x.sample ?? ""),
    values: cols.map((c) => cellOf(x, c)), ...(Object.keys(detail).length ? { detail } : {}) };
});

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
  if (view.genesProfiled != null && view.genesProfiled !== "any" && view.genesProfiled !== "all")
    return no("genesProfiled is \"any\" (every row, the default) or \"all\" (only genes profiled in every sample in view)");
  const genes = view.genesProfiled || "any";
  if (view.samples != null && view.samples !== "patient" && view.samples !== "cohort")
    return no("samples is \"patient\" (every sample of the patient, the default) or \"cohort\" (only the cohort's samples)");
  const scope = view.samples || "patient";
  const only = ctx.table == null ? null : (ALTERATION_TABLES as readonly string[]).includes(ctx.table) ? ctx.table as AlterationTable : undefined;
  if (only === undefined) return no("table is one of " + ALTERATION_TABLES.join(", ") + ", or none for the patient list");

  // who may answer: a local patient-level participant, or a peer whose rules allow patient alterations
  const { holders, excluded, viaPeer } = rowHolders(ctx, "alterations");
  const peerOf = (r: Resolver) => peerRowsFor(r, "alterations");
  /** a peer pages `table` itself; what it annotated with is recorded for the result */
  let peerPin: string | null | undefined;
  const remote = (table: PeerTable, subject?: RemoteRows["subject"]): RemoteRows =>
    ({ of: peerOf, table, subject, samples: scope, oncokbPin: pin, onAnswer: (a) => { if (a.oncokbPin !== undefined) peerPin = a.oncokbPin; } });
  // the Source column: this portal's own database, or the peer's label (set where the peer pages its rows)
  /** where a patient's tables came from: a peer's are marked, as the timeline marks its record */
  const sourceOf = (study: string) => peerOf(ctx.resolvers[study]) ? { source: { label: ctx.resolvers[study].instance.label, remote: true } } : {};
  /** the OncoKB version a patient's tables were annotated with: the peer's, for a patient it served */
  const pinOf = (study: string) => peerOf(ctx.resolvers[study]) ? peerPin ?? null : pin;
  const sourced = (parts: TablePart[]): AlterationPart[] => parts.map((p) => ({ ...p, source: "this portal (" + ctx.resolvers[p.study].instance.label + ")" }));
  if (!holders.length) return no("no study here may disclose a patient's alterations (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  if (view.patient && !ctx.vStudies.includes(view.patient.study))
    return no("patient " + view.patient.id + " is named in " + view.patient.study + ", which this view's cohort does not span (" + ctx.vStudies.join(", ") + ")");
  if (view.patient && !holders.includes(view.patient.study))
    return no(view.patient.study + " is " + excluded.find((e) => e.study === view.patient!.study)!.reason + ", so its patients' alterations cannot be shown");

  const defaults = ALTERATION_PATIENT_DEFAULT_COLUMNS;
  const shown = shownColumns(q, ALTERATION_PATIENT_COLUMNS, defaults);
  const listRows = (size: number, opts: { values?: boolean; locate?: { study: string; patient: string } } = {}) =>
    runRows(ctx, "alterations", holders, q, defaults, shown, size, (parts) => (db) => alterationPatientRowSource(sourced(parts), db, scope),
      opts.values && ctx.values ? { column: ctx.values, numeric: !!ALTERATION_PATIENT_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined, remote("alterations"), opts.locate);
  /** the patient's samples in their order — the numbered markers, which order a gene's rows — read whole whatever page is asked */
  const samplesOf = async (pt: { study: string; id: string }, which = scope) => {
    const r = await runRows({ ...ctx, page: undefined, values: undefined }, "alterations:samples", [pt.study], {}, ["sid"], ["sid", "type"], TABLE_ROWS_MAX,
      (parts: TablePart[]) => (db) => patientSamplesSource(parts[0], pt.id, db, which), undefined,
      { ...remote("alterations:samples", { patient: pt.id }), samples: which });
    return r.rows.map((x) => ({ id: String(x.sid), type: String(x.type ?? "") }));
  };
  /**
   * every sample of the patient numbered as the header numbers them (collection day, type, id), its
   * sample events read beside the samples; `order` (the numbered markers' order) orders a gene's rows
   */
  const numbered = async (pt: { study: string; id: string }) => {
    const [samples, ev] = await Promise.all([samplesOf(pt, "patient"), patientSampleEvents(ctx, pt.study, pt.id)]);
    const marks = sampleMarks(samples, ev.events);
    return { samples: [...marks.values()].filter((m) => samples.some((x) => x.id === m.id)), order: [...marks.keys()], note: ev.note };
  };
  /**
   * per table, whether the study holds its profile and which of the patient's samples it holds (the
   * portal's not-profiled alerts); a peer's patient is not asked (null)
   */
  const profilingOf = async (pt: { study: string; id: string }): Promise<AlterationsResult["profiling"] | null> => {
    const res = ctx.resolvers[pt.study];
    if (peerOf(res)) return null;
    const page = await (res as unknown as PatientLevelCapable).rowsPage("alterations:profiled", (db) => patientProfiledSource(
      { cohort: vNames[0], study: pt.study, cohortSql: "" }, pt.id, db), {}, ["sid"], TABLE_ROWS_MAX, 0);
    const out = {} as NonNullable<AlterationsResult["profiling"]>;
    for (const t of ALTERATION_TABLES) {
      const has = page.rows.length > 0 && page.rows.every((x) => Number(x[t]) !== -1);
      out[t] = { study: has, profiled: has ? page.rows.filter((x) => Number(x[t]) === 1).map((x) => String(x.sid)) : [] };
    }
    return out;
  };
  /**
   * whether the Mutations and CNA tables hold a row whose gene some sample in view was not profiled
   * for (the portal shows its "Different gene panels" menu only then, PAT-MT-6); a peer's patient is
   * not asked (null)
   */
  const mixedPanelsOf = async (pt: { study: string; id: string }, order: string[], inView: number): Promise<AlterationsResult["mixedPanels"] | null> => {
    const res = ctx.resolvers[pt.study];
    if (peerOf(res)) return null;
    // one sample in view has no menu to offer
    if (inView < 2) return { mutations: false, cna: false };
    const part = { cohort: vNames[0], study: pt.study, cohortSql: scope === "cohort" ? res.cohortSql(ctx.doc.cohorts[vNames[0]]) : "" };
    const count = (t: "mutations" | "cna") => (res as unknown as PatientLevelCapable).rowsCounts("alterations:mixed-" + t, (db) => alterationSource(t, part, pt.id, db, null, order, scope, { genes: "any", inAll: true }),
      { filters: { inAll: { max: 0 } } }, alterationDefaults(t, inView)).then((c) => c.some((x) => x.n > 0));
    const [mutations, cna] = await Promise.all([count("mutations"), count("cna")]);
    return { mutations, cna };
  };
  /** genesProfiled "all" needs each sample's panels, which a peer does not send: refused for a peer's patient, never ignored */
  const peerRefusal = (pt: { study: string; id: string }) => genes === "all" && peerOf(ctx.resolvers[pt.study])
    ? no("genesProfiled \"all\" is not available for " + pt.id + ", whose tables come from " + ctx.resolvers[pt.study].instance.label + " via federation; set it to \"any\"") : null;
  /** whether a table's query reads a column (shows, filters, sorts or lists its values) */
  const asks = (tq: TableQuery, c: string) => !!(tq.columns?.includes(c) || tq.filters?.[c] || tq.sort?.column === c || ctx.values === c);
  /** whether a table's query reads the inAll column, so each row's panel coverage must be worked out */
  const asksInAll = (tq: TableQuery) => asks(tq, "inAll");
  /** whether the Gene panel column's values are needed: asked for, or a page read whole (the download, which writes every column) */
  const asksPanels = (tq: TableQuery) => asks(tq, "genePanel") || !!ctx.page;
  /**
   * the mutation table's mRNA Expr. ranking: with one sample in view and an mRNA z-score profile in its
   * study, that sample and profile (PAT-MT-5); a peer's patient is not asked (null)
   */
  const mrnaOf = async (pt: { study: string; id: string }, inView: string[]): Promise<MrnaRank | null> => {
    if (inView.length !== 1 || peerOf(ctx.resolvers[pt.study])) return null;
    const profile = mrnaRankProfile(pt.study, (await ctx.studyProfiles(pt.study)).profiles);
    return profile ? { profile, sample: inView[0] } : null;
  };
  /** one of the patient's tables, for the page (or values) the request asks of it; `inView` the patient's samples the tables read, `mrna` the mutations' ranking */
  const tableRows = async (t: AlterationTable, pt: { study: string; id: string }, order: string[], inView: string[], rank: MrnaRank | null): Promise<{ r: Rows; rows: TableRows<Cell> }> => {
    const mrna = t === "mutations" ? rank : null;
    const cols = ALTERATION_COLUMNS[t], { q: tqq, size } = tq[t], defs = alterationDefaults(t, inView.length, !!mrna);
    const r = await runRows(ctx, "alterations:" + t, [pt.study], tqq, defs, shownColumns(tqq, cols, defs), size,
      (parts: TablePart[]) => (db) => alterationSource(t, parts[0], pt.id, db, pin, order, scope, { genes, inAll: asksInAll(tqq) || (inView.length > 1 && t !== "sv"), panels: t !== "sv" && asksPanels(tqq) }, mrna),
      ctx.values && only === t ? { column: ctx.values, numeric: !!cols.find((c) => c.id === ctx.values)?.numeric } : undefined,
      remote(("alterations:" + t) as PeerTable, { patient: pt.id, order }));
    const columns = cols.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric, ...(c.unsorted ? { unsorted: true } : {}) }));
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
      { const refused = peerRefusal(want); if (refused) return refused; }
      // numbered by collection day; the columns by how many samples are in view (the cohort's, or all)
      const [smp, inCohort] = await Promise.all([numbered(want), scope === "cohort" ? samplesOf(want, "cohort") : null]);
      const inView = (inCohort || smp.samples).map((x) => x.id);
      const { rows } = await tableRows(only, want, smp.order, inView, only === "mutations" ? await mrnaOf(want, inView) : null);
      return partial({ ...listOf({ rows: [], lists: [], total: 0, all: 0, offset: 0, groups: 1 }), patient: { ...want, samples: [], ...sourceOf(want.study) }, tables: { [only]: rows },
        oncokbPin: pinOf(want.study) });
    }
    const r = await listRows(show, { values: true, locate: view.patient && !ctx.page && !ctx.values ? { study: view.patient.study, patient: view.patient.id } : undefined });
    if (ctx.page || ctx.values) return partial({ ...listOf(r), patient: null, tables: {}, oncokbPin: pin });

    // the patient listed: the one the view names (checked to be one of its cohort's patients), else the list's first
    const want = view.patient ? { study: view.patient.study, id: view.patient.id } : r.rows[0] ? { study: String(r.rows[0].study), id: String(r.rows[0].patient) } : null;
    if (want) { const refused = peerRefusal(want); if (refused) return refused; }
    if (want && view.patient && !r.position) {
      // the named patient must be one of the view's cohort's patients — asked of whoever holds them
      const res = ctx.resolvers[want.study], rem = peerOf(res);
      const member: TableQuery = { filters: { patient: { op: "equals", value: want.id } } };
      const inCohorts = vNames.filter((cn) => ctx.cohorts[cn].studies.includes(want.study));
      const counts = rem
        ? (await rem.patientRows({ table: "alterations", parts: inCohorts.map((cn) => ({ cohort: cn, def: ctx.doc.cohorts[cn] })), query: member, defaults, mode: "counts" })).counts || []
        : await (res as unknown as PatientLevelCapable).rowsCounts("alterations:member", (db) => alterationPatientRowSource(
          sourced(inCohorts.map((cn) => ({ cohort: cn, study: want.study, cohortSql: res.cohortSql(ctx.doc.cohorts[cn]) }))), db), member, defaults);
      if (!counts.some((c) => c.n > 0)) return no(want.id + " is not a patient of this cohort in " + want.study);
    }
    // every sample of the patient numbers the markers, as the portal's sample view keeps each sample's number;
    // with samples: "cohort", the cohort's are the ones the tables read and the card shows
    const [smp, inCohort, profiled] = want ? await Promise.all([numbered(want), scope === "cohort" ? samplesOf(want, "cohort") : null, profilingOf(want)]) : [null, null, null];
    const inView = want ? (inCohort || smp!.samples).map((x) => x.id) : [];
    const mrna = want ? await mrnaOf(want, inView) : null;
    const [mixed, position, ...tabs] = await Promise.all([
      want ? mixedPanelsOf(want, smp!.order, inCohort ? inCohort.length : smp!.samples.length) : Promise.resolve(null),
      want ? listPosition(r, !!view.patient, (first) => listRows(1, { locate: first })) : Promise.resolve(null),
      ...ALTERATION_TABLES.map((t) => want ? tableRows(t, want, smp!.order, inView, mrna) : Promise.resolve(null)),
    ]);
    const tables: AlterationsResult["tables"] = {};
    ALTERATION_TABLES.forEach((t, i) => { const x = tabs[i]; if (x) tables[t] = x.rows; });
    const samples = smp?.samples || [];
    const shownPin = want ? pinOf(want.study) : pin;
    const list = listOf(r);
    const sortName = q.sort ? listColumns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null;
    const tableLine = (t: AlterationTable) => {
      const x = tables[t]!, d = describeQuery(x.query, x.columns);
      return ALTERATION_TABLE_NAMES[t] + ": " + (d ? x.total.toLocaleString("en-US") + " of " : "") + plural(x.all, "row") + (d ? " (" + d + ")" : "");
    };
    return {
      kind: "alterations", cohorts: vNames,
      alterations: { ...list, patient: want ? { ...want, samples, ...(inCohort ? { shown: inCohort.map((x) => x.id) } : {}), ...sourceOf(want.study) } : null, position, tables, ...(profiled ? { profiling: profiled } : {}), ...(mixed ? { mixedPanels: mixed } : {}), oncokbPin: shownPin },
      method: alterationsMethod({ samples: scope, genesProfiled: genes, mrnaProfile: mrna?.profile ?? null, cohorts: vNames, oncokbPin: shownPin, queryText: describeQuery(q, listColumns), sortName, desc: !!q.sort?.desc, shown: list.rows.length,
        lists: r.lists, excluded, instances: r.groups, patient: want,
        tables: want ? ALTERATION_TABLES.map((t) => ({ name: ALTERATION_TABLE_NAMES[t], total: tables[t]!.total, all: tables[t]!.all, queryText: describeQuery(tables[t]!.query, tables[t]!.columns) })) : [] }),
      participation: ctx.participationFor(ctx.vStudies, true),
      ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
      caveat: (want ? want.id + " — " + ALTERATION_TABLES.map(tableLine).join("; ") + ". " : "No patient to list: the cohort's patient list is empty. ") +
        "Each table lists a variant, a gene's call or an event once however many of the patient's samples carry it (Samples names them); allele frequency and read counts are the highest among those samples, each sample's reads drawn beside them; sorting by allele frequency compares the samples' frequencies in sample order. " +
        (smp?.note && smp.samples.length > 1 ? smp.note + " " : "") +
        (genes === "all" ? "Mutations and Copy Number Alterations keep only genes profiled in every sample in view (genesProfiled \"all\"); rows whose gene a sample's panel leaves out are not listed. " : "") +
        "Copy number is the deep calls only (AMP, HOMDEL), as the portal's patient view lists them" +
        (tables.mutations?.shown.includes("copy") ? "; Copy # on a mutation is the gene's deep calls anywhere in " + (scope === "cohort" ? "the cohort's samples of the patient. " : "the patient. ") : ". ") +
        (want && inCohort ? "Only " + plural(inCohort.length, "sample") + " of " + want.id + "'s " + (smp?.samples.length ?? 0) + " " + (inCohort.length === 1 ? "is" : "are") + " in the cohort, and the tables read only " + (inCohort.length === 1 ? "it" : "those") + " (samples: \"cohort\"); each keeps its number among all the patient's samples. " : "") +
        "Cohort % is the share of the study's samples profiled for the gene by their panel with a mutation in it (blank for a mutation with no keyword, as the portal's), or with the same copy-number call; a mutation's cell also gives the share, over the same samples, with its keyword (APC truncating). " +
        (mrna ? "mRNA Expr. is the gene's percentile in " + mrna.sample + " among every sample's value of it in " + mrna.profile + " (ties ranked at the highest). " : "") +
        (want && peerOf(ctx.resolvers[want.study]) ? want.id + "'s tables come from " + ctx.resolvers[want.study].instance.label + " via federation, computed in its database. " : "") +
        (shownPin ? "Annotation is OncoKB " + shownPin + " (oncogenicity and its highest sensitivity level); structural variants carry the study's own annotation, not OncoKB's. " : "No OncoKB version is pinned here, so the annotation columns are empty. ") +
        (viaPeer.length ? "Patients of " + viaPeer.join(", ") + " come from " + [...new Set(viaPeer.map((st) => ctx.resolvers[st].instance.label))].join(", ") +
          " via federation: a peer whose rules and this instance's both allow patient alterations (its Source column says so); every view their rules do not name treats it as aggregate-only. " : "") +
        "The patient list: " + tableTail(r, q, listColumns, "patient", "with patients who have any alteration first, then by patient id", excluded, false),
    };
  } catch (e) { return no((e as Error).message); }
}
