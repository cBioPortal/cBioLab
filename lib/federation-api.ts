// The federation API: what one cbio-lab instance (a peer) answers another (the coordinator) at
// /api/federation/v1/<op> (app/api/federation/v1/[op]/route.ts). Each op evaluates a request against
// a study THIS instance holds in its own databases and answers with aggregates — counts, sums,
// vocabulary — computed there. lib/federation-remote.ts is the client half.
//
// It is a protocol between two servers of this codebase, not a set of tools for an agent: agents
// have /api/mcp (mcp/tools.ts), which never serves these. Every op refuses an id-carrying cohort
// itself, whatever the caller checked, and answers only for a study held here — one this instance
// reaches through a peer of its own is refused, never relayed.
//
// The patient-level ops (patient-rows, patient-timeline, plot-cases, oncoprint-columns) exist only where this
// instance's operator writes rules in FEDERATION_DISCLOSE_PATIENTS (lib/disclosure.ts): a peer that
// has not opted in does not have them at all. See docs/DATA-BOUNDARY.md. There is no caller
// authentication yet: anyone who can reach this endpoint can read what it discloses.
import { z } from "zod";
import { resolveStudy, studyProfiles } from "./analysis.ts";
import { resolverFor, carriesPatientIds, studyRouting, routeStudy, PatientLevelResolver, PEER_TABLES, hasFederatedPlot, type PeerTable, type CourseOpts, type SequenceOpts } from "./federation.ts";
import { timelinePatientRowSource, TIMELINE_COLUMNS, PATIENT_ID } from "./patient-timeline.ts";
import { ALTERATION_COLUMNS, ALTERATION_PATIENT_COLUMNS, PATIENT_SAMPLE_COLUMNS, alterationPatientRowSource, alterationSource, patientSamplesSource } from "./patient-alterations.ts";
import { loopbackConnId, servingAsLoopbackPeer } from "./loopback-peer.ts";
import { allowedKinds, disclosedByThisInstance, PATIENT_KIND_NAMES, type PatientKind } from "./disclosure.ts";
import { checkQuery, cleanQuery, type QueryColumn, type RowSource, type TableQuery } from "./table-query.ts";
import { buildExplore } from "./explore.ts";
import { oncokbPin } from "./annotation.ts";
import { peerSource } from "./provenance.ts";
import { connections, directConnections } from "./ch.ts";
import { studiesFor } from "./study-list.ts";
import { catalogFor } from "./study-catalog.ts";
import { validateAxis, type PlotAxis, type PlotRequest, type AxisKind, type PointRank, type SparseCells, type Whiskers } from "./plot.ts";
import { resolveAxes } from "./plot-profile.ts";
import { setting } from "./settings.ts";
import { studyOncoprintInputs } from "./oncoprint.ts";

/** The protocol version, which is part of every op's path: a breaking change gets a new one. */
export const FEDERATION_VERSION = "v1";

/** One operation: its input, checked before it runs, and what it answers (or throws, refusing). */
export interface FederationOp {
  input: z.ZodType;
  /** patient-level: answers with patient or case identifiers, under the disclosure rules */
  patientLevel?: boolean;
  run: (args: any) => Promise<Record<string, unknown>>;
}

/** A timeline event to align on — survival's re-anchoring and the clinical course's day 0. */
const zEventAnchor = z.object({
  eventType: z.string().max(120),
  key: z.string().max(120).nullish(), value: z.string().max(200).nullish(),
  occurrence: z.enum(["FIRST", "LAST"]).nullish()
});
const zKinds = z.object({ xk: z.enum(["num", "cat", "none"]), yk: z.enum(["num", "cat", "none"]) });
const zExtent = z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() });

const ID_LIST = "cohort contains an explicit sample or patient list; identifiers are not accepted across instances";
const hideSql = () => setting("FEDERATION_HIDE_SQL") === "1";

/**
 * A study a federation op may answer for: one this instance holds in its own databases. A study
 * it reaches through a peer of its own is refused, so a call is never relayed or answered from the
 * wrong database.
 */
async function ownStudy(study: string): Promise<string> {
  const { peerForStudy } = await import("./federation-remote.ts");
  if (await peerForStudy(study)) throw new Error("study '" + study.slice(0, 60) + "' is not held by this instance");
  return resolveStudy(study);
}

/**
 * A plot request as a caller sent it, made this instance's own: each axis resolved against this
 * study's profiles (a profile axis) and checked as a local view's axes are. Only the fields a plot
 * reads are kept.
 */
async function plotSpecHere(study: string, raw: any): Promise<PlotRequest> {
  if (!raw || typeof raw !== "object") throw new Error("a plot needs its axes");
  const { catalog } = await studyProfiles(study);
  const axes = resolveAxes({ x: raw.x as PlotAxis, y: raw.y as PlotAxis, colorBy: raw.colorBy as PlotAxis | undefined, ringBy: raw.ringBy as PlotAxis | undefined },
    [{ study, catalog }]);
  validateAxis(axes.x, "x"); validateAxis(axes.y, "y");
  if (axes.colorBy) validateAxis(axes.colorBy, "colorBy");
  if (axes.ringBy) validateAxis(axes.ringBy, "ringBy");
  const bins = Array.isArray(raw.bins) && raw.bins.length === 2 ? [Number(raw.bins[0]), Number(raw.bins[1])] as [number, number] : undefined;
  return { x: axes.x, y: axes.y, unit: raw.unit === "patient" ? "patient" : "sample",
    ...(axes.colorBy ? { colorBy: axes.colorBy } : {}), ...(axes.ringBy ? { ringBy: axes.ringBy } : {}), ...(bins ? { bins } : {}) };
}

// ---- aggregates ----------------------------------------------------------------
// Counts computed inside this instance's database; no patient id is ever returned, which is what
// makes federation safe to point at data that cannot be shared row-wise.

/**
 * A cohort's size and whatever aggregates the caller asks for: per-gene (profiled, altered, driver)
 * counts, survival triples, gene-pair 2x2 tables, clinical attribute statistics, the six sums behind
 * a correlation, variant and codon counts, timeline spans, the clinical course, treatment sequences.
 */
const aggregates: FederationOp = {
  input: z.object({
    study: z.string().max(120),
    cohort: z.record(z.string(), z.any()),
    genes: z.array(z.string()).max(20).nullish(),
    survival: z.boolean().nullish(),
    // survival endpoint prefix — OS, PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS (default OS)
    endpoint: z.string().max(40).nullish(),
    // exact outcome columns, for a study whose columns don't follow that naming
    endpointColumns: z.object({ months: z.string().max(64), status: z.string().max(64) }).nullish(),
    // re-anchors survival to a timeline event; the answer then carries each stratum's delayed entry
    anchor: zEventAnchor.nullish(),
    survivalEndpoints: z.boolean().nullish(),
    // gene pairs: each pair's 2x2 among the cohort's samples profiled for both
    pairs: z.array(z.tuple([z.string(), z.string()])).max(66).nullish(),
    // value counts for categorical attributes, (n, sum, sum of squares, min, max) for numeric
    attributes: z.array(z.string()).max(20).nullish(),
    // each numeric attribute's (value, count) distribution: safe only because the caller compares
    // cohorts confined to this one study (a median is not additive across sites)
    attributeHistograms: z.boolean().nullish(),
    attributeTopValues: z.number().int().min(1).max(500).nullish(),
    momentGenes: z.array(z.string()).max(12).nullish(),
    variantGenes: z.array(z.string()).max(12).nullish(),
    lollipopGenes: z.array(z.string()).max(12).nullish(),
    // suppression floor applied HERE before returning variant counts
    minCount: z.number().int().min(1).max(1000).nullish(),
    timelineSpan: z.boolean().nullish(),
    course: z.object({
      anchor: zEventAnchor.nullable(),
      eventTypes: z.array(z.string().max(120)).max(20),
      binMonths: z.number().positive().max(120),
      from: z.number().int().min(-600).max(600), to: z.number().int().min(-600).max(600)
    }).nullish(),
    sequence: z.object({
      eventType: z.string().max(120), labelKey: z.string().max(120),
      exclude: z.array(z.string().max(200)).max(200),
      lineGap: z.number().int().min(1).max(3650), maxSteps: z.number().int().min(1).max(10),
      lineClasses: z.union([z.enum(["systemic", "all"]), z.array(z.string().max(120)).max(50)]).nullish()
    }).nullish(),
    sequenceKeys: z.string().max(120).nullish(),
    // with `pairs` or `momentGenes`, a continuous molecular profile (e.g. mRNA z-scores)
    profileType: z.string().max(120).nullish()
  }),
  async run({ study, cohort, genes, survival, pairs, attributes, attributeHistograms, attributeTopValues, profileType, variantGenes, lollipopGenes, minCount, momentGenes, endpoint, endpointColumns, survivalEndpoints, anchor, timelineSpan, course, sequence, sequenceKeys }: { timelineSpan?: boolean | null; course?: CourseOpts | null; sequence?: SequenceOpts | null; sequenceKeys?: string | null; study: string; cohort: any; genes?: string[] | null; survival?: boolean | null; pairs?: [string, string][] | null; attributes?: string[] | null; attributeHistograms?: boolean | null; attributeTopValues?: number | null; profileType?: string | null; variantGenes?: string[] | null; lollipopGenes?: string[] | null; minCount?: number | null; momentGenes?: string[] | null; endpoint?: string | null; endpointColumns?: { months: string; status: string } | null; survivalEndpoints?: boolean | null; anchor?: any }) {
    // Refused here, by the peer, whatever the caller checked: an explicit list compiles to the
    // ids themselves, and beside a clinical attribute a count of 0 or 1 reads one patient's value.
    if (carriesPatientIds(cohort)) throw new Error(ID_LIST);
    const s = await ownStudy(study);
    const { profiles, gaProfiles } = await studyProfiles(s);
    const pin = await oncokbPin();
    const res = await resolverFor(s, { oncokbPin: pin, profiles, gaProfiles });
    const [sizes, geneCounts, survivalCounts, pairCounts, attributeStats, pairMoments, variantCounts, profileMoments, endpointList, lollipopCounts] = await Promise.all([
      res.sizes(cohort),
      genes && genes.length ? res.geneCounts(cohort, genes) : Promise.resolve([]),
      survival ? res.survivalCounts(cohort, endpoint || "OS", anchor || null, endpointColumns || undefined) : Promise.resolve([]),
      pairs && pairs.length ? res.pairCounts(cohort, pairs) : Promise.resolve([]),
      attributes && attributes.length ? res.attributeStats(cohort, attributes, { histograms: !!attributeHistograms, ...(attributeTopValues != null ? { topValues: attributeTopValues } : {}) }) : Promise.resolve([]),
      pairs && pairs.length && profileType ? res.pairMoments(cohort, pairs, profileType) : Promise.resolve([]),
      variantGenes && variantGenes.length
        ? res.variantCounts(cohort, variantGenes, minCount || 1)
        : Promise.resolve({ variants: [], totals: [], minCount: minCount || 1 }),
      momentGenes && momentGenes.length && profileType
        ? res.profileMoments(cohort, momentGenes, profileType) : Promise.resolve([]),
      survivalEndpoints ? res.survivalEndpoints() : Promise.resolve([] as string[]),
      lollipopGenes && lollipopGenes.length ? res.lollipopCounts(cohort, lollipopGenes, minCount || 1) : Promise.resolve(null)
    ]);
    const [spans, courseCounts, flows, keys] = await Promise.all([
      timelineSpan ? res.timelineSpan(cohort) : Promise.resolve(null),
      course ? res.eventCourse(cohort, course) : Promise.resolve(null),
      sequence ? res.treatmentSequence(cohort, sequence) : Promise.resolve(null),
      sequenceKeys ? res.sequenceKeys(cohort, sequenceKeys) : Promise.resolve(null)
    ]);
    // SQL text carries no patient data, and an id-carrying definition was refused above, so
    // disclosing what we ran restores end-to-end provenance for the caller. A deployment that
    // treats its schema as sensitive sets FEDERATION_HIDE_SQL=1 and the caller degrades gracefully.
    const hide = hideSql();
    // `count` is the cohort's patients (the owners of its samples), `samples` its samples
    return { study: s, instance: res.instance.label, count: sizes.patients, samples: sizes.samples, geneCounts, survivalCounts, pairCounts, attributeStats, pairMoments, variantCounts, profileMoments, survivalEndpoints: endpointList,
      ...(lollipopCounts ? { lollipopCounts } : {}), ...(spans ? { timelineSpan: spans } : {}), ...(courseCounts ? { eventCourse: courseCounts } : {}),
      ...(flows ? { treatmentSequence: flows } : {}), ...(keys ? { sequenceKeys: keys } : {}),
      cohortSql: hide ? null : res.cohortSql(cohort), queries: hide ? null : res.queries, oncokbPin: pin, source: await peerSource(s) };
  }
};

// A plot, or one of the per-site pieces a pooled plot is built from: counts, bins, sums,
// quartiles. Aggregates only; the cases behind a plot are plot-cases', under the disclosure rules.
// The axes come as the caller resolved them (or as profile axes, resolved here against this study's
// own profiles) and are checked here.
const plot: FederationOp = {
  input: z.object({
    study: z.string().max(120),
    cohort: z.record(z.string(), z.any()),
    op: z.enum(["plot", "axisKinds", "extent", "bins", "moments", "table", "box", "violin", "coverage", "highlightCount", "highlightBins", "highlightBox"]),
    // x, y, unit, and optionally colorBy, ringBy, bins: the plot as a view states it
    spec: z.record(z.string(), z.any()),
    kinds: zKinds.nullish(),
    bins: z.tuple([z.number().int().min(1).max(1000), z.number().int().min(1).max(1000)]).nullish(),
    extent: zExtent.nullish(),
    // for violin: how many bins to cut the shared range into, and that range
    violinBins: z.number().int().min(4).max(200).nullish(),
    range: z.tuple([z.number(), z.number()]).nullish(),
    // for the highlight ops: the second cohort, whose cases within the first are counted
    highlight: z.record(z.string(), z.any()).nullish(),
  }),
  async run(args: { study: string; cohort: any; op: string; spec: any; kinds?: { xk: AxisKind; yk: AxisKind } | null; bins?: [number, number] | null;
    extent?: { x0: number; x1: number; y0: number; y1: number } | null; violinBins?: number | null; range?: [number, number] | null; highlight?: any }) {
    if (carriesPatientIds(args.cohort) || carriesPatientIds(args.highlight)) throw new Error(ID_LIST);
    const s = await ownStudy(args.study);
    const { profiles, gaProfiles } = await studyProfiles(s);
    const res = await resolverFor(s, { oncokbPin: await oncokbPin(), profiles, gaProfiles });
    if (!hasFederatedPlot(res)) throw new Error(s + " is not held by this instance's own database");
    const spec = await plotSpecHere(s, args.spec);
    const k = args.kinds, need = (x: unknown, what: string) => { if (x == null) throw new Error(args.op + " needs " + what); };
    const hl = args.highlight as Parameters<typeof res.plotHighlightCount>[1];
    let result: unknown;
    switch (args.op) {
      case "plot": result = await res.plot(args.cohort, spec); break;
      case "axisKinds": result = await res.plotAxisKinds(spec); break; // no cohort: the axes alone decide
      case "extent": need(k, "kinds"); result = await res.plotExtent(args.cohort, spec, k!.xk, k!.yk); break;
      case "bins": need(k, "kinds"); need(args.bins, "bins"); need(args.extent, "extent"); result = await res.plotBinCounts(args.cohort, spec, k!.xk, k!.yk, args.bins!, args.extent!); break;
      case "moments": need(k, "kinds"); result = await res.plotMoments(args.cohort, spec, k!.xk, k!.yk); break;
      case "table": need(k, "kinds"); result = await res.plotTableCells(args.cohort, spec, k!.xk, k!.yk); break;
      case "box": need(k, "kinds"); result = await res.plotBoxRows(args.cohort, spec, k!.xk, k!.yk); break;
      case "violin": need(k, "kinds"); need(args.violinBins, "violinBins"); need(args.range, "range");
        result = await res.plotViolinCounts(args.cohort, spec, k!.xk, k!.yk, args.violinBins!, args.range!); break;
      case "coverage": need(k, "kinds"); result = await res.plotCoverage(args.cohort, spec, k!.xk, k!.yk); break;
      case "highlightCount": need(hl, "highlight"); result = await res.plotHighlightCount(args.cohort, hl); break;
      case "highlightBins": need(hl, "highlight"); need(k, "kinds"); need(args.bins, "bins"); need(args.extent, "extent");
        result = await res.plotHighlightBins(args.cohort, hl, spec, k!.xk, k!.yk, args.bins!, args.extent!); break;
      case "highlightBox": need(hl, "highlight"); need(k, "kinds"); result = await res.plotHighlightBoxRows(args.cohort, hl, spec, k!.xk, k!.yk); break;
      default: throw new Error("unknown op");
    }
    const hide = hideSql();
    return { study: s, op: args.op, result, cohortSql: hide || args.op === "axisKinds" ? null : res.cohortSql(args.cohort), queries: hide ? null : res.queries, source: await peerSource(s) };
  }
};

// A study's molecular profiles as it describes them (genetic_profile: type, datatype, name), so a
// caller can read a profile axis as this study means it. Metadata only.
const profiles: FederationOp = {
  input: z.object({ study: z.string().max(120) }),
  async run({ study }: { study: string }) {
    const s = await ownStudy(study);
    const p = await studyProfiles(s);
    return { study: s, profiles: p.profiles, gaProfiles: p.gaProfiles, catalog: p.catalog, source: await peerSource(s) };
  }
};

// Everything the Explore page needs, as aggregates, optionally conditioned on a draft cohort:
// attribute names, value counts, gene and event counts; never a patient identifier.
const facets: FederationOp = {
  input: z.object({
    study: z.string().max(120),
    draft: z.record(z.string(), z.any()).nullish(),
    // restricts the gene tables to symbols containing this substring
    geneSearch: z.string().max(40).nullish()
  }),
  async run({ study, draft, geneSearch }: { study: string; draft?: any; geneSearch?: string | null }) {
    if (carriesPatientIds(draft)) throw new Error("draft contains an explicit sample or patient list; identifiers are not accepted across instances");
    const s = await ownStudy(study);
    const { profiles, gaProfiles } = await studyProfiles(s);
    const conn = await routeStudy(s);
    const out = await buildExplore({
      study: s, draft: draft || null, oncokbPin: await oncokbPin(),
      geneSearch: geneSearch || undefined, profiles, gaProfiles, conn
    });
    // `genes` (the retired combined list) stays empty for coordinators whose merge still sums it
    return { ...out, genes: [], source: await peerSource(s) } as unknown as Record<string, unknown>;
  }
};

// The study list and the study catalog, for a coordinator that holds none of this instance's
// databases: the counts and vocabulary its study picker and cohort builder show. Like the facets,
// they name no patient.
const studies: FederationOp = {
  input: z.object({}),
  async run() {
    const conns = servingAsLoopbackPeer() ? connections().filter((c) => c.id === loopbackConnId()) : directConnections();
    return { studies: (await Promise.all(conns.map((c) => studiesFor(c)))).flat(), source: await peerSource() };
  }
};

const catalog: FederationOp = {
  input: z.object({ study: z.string().max(120) }),
  async run({ study }: { study: string }) {
    const s = await ownStudy(study);
    return { ...await catalogFor(s), source: await peerSource(s) } as unknown as Record<string, unknown>;
  }
};

// ---- opt-in patient-level federation ---------------------------------------
// Each call is checked against FEDERATION_DISCLOSE_PATIENTS — the study, and the kind of
// patient-level data the table belongs to (PEER_TABLES) — for a study this instance holds at patient
// level itself. The coordinator must accept the same kind (FEDERATION_ACCEPT_PATIENT_LEVEL).

async function held(study: string, kind: PatientKind): Promise<{ s: string; res: PatientLevelResolver }> {
  // the rules are checked on the study as asked, before anything is read, and again as resolved
  const refuse = (x: string) => new Error(x.slice(0, 120) + " is not a study this instance discloses " + PATIENT_KIND_NAMES[kind] + " of");
  if (!allowedKinds(disclosedByThisInstance(), study).has(kind)) throw refuse(study);
  const s = await resolveStudy(study);
  if (!allowedKinds(disclosedByThisInstance(), s).has(kind)) throw refuse(s);
  // with a simulated peer (lib/loopback-peer.ts) the rules are that peer's: only its connection's studies are disclosed
  const loop = loopbackConnId();
  if (loop && (await studyRouting()).get(s)?.id !== loop) throw refuse(s);
  const { profiles, gaProfiles } = await studyProfiles(s);
  const res = await resolverFor(s, { oncokbPin: await oncokbPin(), profiles, gaProfiles });
  // only what this instance holds itself at patient level: never a peer's data relayed, never an aggregate-only study
  if (!(res instanceof PatientLevelResolver)) throw new Error(s + " is not held here at patient level");
  return { s, res };
}

/** each table's columns, and whether it is one patient's (named in `subject`) rather than a cohort's patient list */
const TABLES: Record<PeerTable, { columns: QueryColumn[]; perPatient: boolean }> = {
  "timeline": { columns: TIMELINE_COLUMNS, perPatient: false },
  "alterations": { columns: ALTERATION_PATIENT_COLUMNS, perPatient: false },
  "alterations:samples": { columns: PATIENT_SAMPLE_COLUMNS, perPatient: true },
  "alterations:mutations": { columns: ALTERATION_COLUMNS.mutations, perPatient: true },
  "alterations:cna": { columns: ALTERATION_COLUMNS.cna, perPatient: true },
  "alterations:sv": { columns: ALTERATION_COLUMNS.sv, perPatient: true },
};
const PIN = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * The patient views' tables, computed in THIS instance's database: the timeline's and the
 * alterations view's patient lists, and one patient's samples, mutations, copy-number alterations
 * and structural variants — a page of rows, the per-cohort counts, one column's values, or one
 * patient's place in the order, searched, filtered and sorted here.
 */
const patientRows: FederationOp = {
  patientLevel: true,
  input: z.object({
    study: z.string().max(120),
    table: z.enum(Object.keys(PEER_TABLES) as [PeerTable, ...PeerTable[]]).default("timeline"),
    parts: z.array(z.object({ cohort: z.string().max(200), cohortDef: z.record(z.string(), z.any()) })).min(1).max(6),
    // what the caller calls this instance: a patient list's Source column
    source: z.string().max(200),
    query: z.record(z.string(), z.any()).nullish(),
    defaults: z.array(z.string().max(40)).max(20),
    mode: z.enum(["page", "counts", "values", "rank"]),
    limit: z.number().int().min(1).max(10000).nullish(),
    offset: z.number().int().min(0).nullish(),
    column: z.string().max(40).nullish(),
    patient: z.string().max(80).nullish(),
    // for a table of one patient's: whose, and their samples' order (the Samples column's)
    subject: z.object({ patient: z.string().max(80), order: z.array(z.string().max(120)).max(500).nullish() }).nullish(),
    // the alterations tables: every sample of a patient, or only the cohort's
    samples: z.enum(["patient", "cohort"]).nullish(),
    // the OncoKB version the caller annotates with, used unless this instance pins its own (ONCOKB_PIN)
    oncokbPin: z.string().max(40).nullish(),
  }),
  async run({ study, table, parts, source, query, defaults, mode, limit, offset, column, patient, subject, samples, oncokbPin }: { study: string; table: PeerTable; parts: { cohort: string; cohortDef: any }[]; source: string; query?: any; defaults: string[]; mode: "page" | "counts" | "values" | "rank"; limit?: number | null; offset?: number | null; column?: string | null; patient?: string | null; subject?: { patient: string; order?: string[] | null } | null; samples?: "patient" | "cohort" | null; oncokbPin?: string | null }) {
    const scope = samples === "cohort" ? "cohort" : "patient";
    if (parts.some((p) => carriesPatientIds(p.cohortDef)))
      throw new Error("a cohort contains an explicit sample or patient list; identifier lists are not accepted across instances");
    const t = TABLES[table];
    if (!t) throw new Error("not a table this instance serves");
    const { s, res } = await held(study, PEER_TABLES[table]);
    const q = cleanQuery((query || {}) as TableQuery);
    const bad = checkQuery(q, t.columns);
    if (bad) throw new Error(bad);
    const known = new Set(t.columns.map((c) => c.id));
    if (defaults.some((d) => !known.has(d))) throw new Error("defaults name unknown columns");
    if (t.perPatient && (!subject || !PATIENT_ID.test(subject.patient))) throw new Error(table + " is one patient's table; subject names the patient");
    if (oncokbPin && !PIN.test(oncokbPin)) throw new Error("not an OncoKB version");
    const label = source.replace(/[^\w .,()/:-]/g, "").slice(0, 120);
    const sourced = parts.map((p) => ({ cohort: p.cohort, study: s, cohortSql: res.cohortSql(p.cohortDef), source: label }));
    // OncoKB's call is on the mutation and copy-number tables alone; the answer says which version it is
    const annotated = table === "alterations:mutations" || table === "alterations:cna";
    const pin = annotated ? process.env.ONCOKB_PIN || oncokbPin || null : null;
    const src: (db: string) => RowSource =
      table === "timeline" ? (db) => timelinePatientRowSource(sourced, db)
      : table === "alterations" ? (db) => alterationPatientRowSource(sourced, db, scope)
      : table === "alterations:samples" ? (db) => patientSamplesSource(sourced[0], subject!.patient, db, scope)
      : (db) => alterationSource(table.slice("alterations:".length) as "mutations" | "cna" | "sv", sourced[0], subject!.patient, db, pin, subject!.order || [], scope);
    const tag = table + ":" + mode;
    let out: Record<string, unknown>;
    if (mode === "counts") out = { counts: await res.rowsCounts(tag, src, q, defaults) };
    else if (mode === "values") {
      if (!column || !known.has(column)) throw new Error("values needs one of the table's columns");
      out = { values: await res.rowsValues(tag, src, q, defaults, column) };
    } else if (mode === "rank") {
      if (!patient || !PATIENT_ID.test(patient)) throw new Error("rank needs a patient id");
      out = { rank: await res.rowsRank(tag, src, q, defaults, s, patient) };
    } else out = { rows: (await res.rowsPage(tag, src, q, defaults, limit || 25, offset || 0)).rows };
    return { table, ...out, ...(annotated ? { oncokbPin: pin } : {}), ...(table !== "timeline" ? { samples: scope } : {}), queries: hideSql() ? null : res.queries, source: await peerSource(s) };
  }
};

/** Every clinical event (days from diagnosis, with all attributes) and the samples of ONE patient. */
const patientTimeline: FederationOp = {
  patientLevel: true,
  input: z.object({ study: z.string().max(120), patient: z.string().max(80) }),
  async run({ study, patient }: { study: string; patient: string }) {
    if (!PATIENT_ID.test(patient)) throw new Error("not a patient id");
    const { s, res } = await held(study, "timeline");
    const t = await res.patientTimeline(patient);
    if (!t.events.length && !t.samples.length) throw new Error(patient + " has no record in " + s);
    return { study: s, patient, events: t.events, samples: t.samples, queries: hideSql() ? null : res.queries, source: await peerSource(s) };
  }
};

/**
 * The cases a plot draws as points, with their case ids (kind 'plot'): every case up to the cap, a
 * box's most extreme values beyond given whiskers, a scatter's cases in sparse cells of a given grid,
 * the extremes on an axis or the cases furthest from a fitted line, or a second cohort's cases
 * within the first.
 */
const plotCases: FederationOp = {
  patientLevel: true,
  input: z.object({
    study: z.string().max(120),
    cohort: z.record(z.string(), z.any()),
    op: z.enum(["points", "outliers", "scatterPoints", "ranked", "highlightPoints"]),
    spec: z.record(z.string(), z.any()),
    cap: z.number().int().min(1).max(50000).nullish(),
    outside: z.array(z.object({ g: z.string().max(200), loWhisker: z.number(), hiWhisker: z.number() }).passthrough()).max(200).nullish(),
    sparse: z.object({ grid: z.tuple([z.number().int(), z.number().int()]), extent: zExtent, cellMax: z.number().int().min(1).max(100) }).nullish(),
    rank: z.union([z.object({ by: z.enum(["x", "y"]), n: z.number().int().min(1).max(500) }),
      z.object({ by: z.literal("residual"), n: z.number().int().min(1).max(500), slope: z.number(), intercept: z.number() })]).nullish(),
    kinds: zKinds.nullish(),
    highlight: z.record(z.string(), z.any()).nullish(),
  }),
  async run(args: { study: string; cohort: any; op: string; spec: any; cap?: number | null; outside?: Whiskers[] | null; sparse?: SparseCells | null;
    rank?: PointRank | null; kinds?: { xk: AxisKind; yk: AxisKind } | null; highlight?: any }) {
    if (carriesPatientIds(args.cohort) || carriesPatientIds(args.highlight))
      throw new Error("a cohort contains an explicit sample or patient list; identifier lists are not accepted across instances");
    const { s, res } = await held(args.study, "plot");
    const spec = await plotSpecHere(s, args.spec);
    const cap = args.cap ?? undefined;
    let points: unknown;
    if (args.op === "points") points = await res.plotPoints(args.cohort, spec, cap);
    else if (args.op === "outliers") {
      if (!args.outside || cap == null) throw new Error("outliers needs outside and cap");
      points = await res.plotOutlierPoints(args.cohort, spec, cap, args.outside);
    }
    else if (args.op === "scatterPoints") points = await res.plotScatterPoints(args.cohort, spec, cap, args.sparse ?? undefined);
    else if (args.op === "ranked") {
      if (!args.rank || !args.kinds) throw new Error("ranked needs rank and kinds");
      points = await res.plotRankedPoints(args.cohort, spec, args.kinds.xk, args.kinds.yk, args.rank);
    } else {
      if (!args.highlight || !args.kinds) throw new Error("highlightPoints needs highlight and kinds");
      points = await res.plotHighlightPoints(args.cohort, args.highlight, spec, args.kinds.xk, args.kinds.yk, cap);
    }
    return { study: s, op: args.op, points, queries: hideSql() ? null : res.queries, source: await peerSource(s) };
  }
};

/**
 * One study's share of an oncoprint (kind 'oncoprint'): its columns in each group, with the rows the
 * figure is assembled from — alterations, panel coverage, sample counts, and the clinical, heatmap
 * and overlay tracks the spec asks for. The coordinator draws them as columns beside its own.
 */
const oncoprintColumns: FederationOp = {
  patientLevel: true,
  input: z.object({
    study: z.string().max(120),
    groups: z.array(z.union([z.record(z.string(), z.any()), z.literal(false)])).max(4).nullable(),
    genes: z.array(z.any()).min(1).max(40),
    clinical: z.array(z.string().max(120)).max(8),
    heatmap: z.array(z.record(z.string(), z.any())).max(4),
    overlays: z.array(z.record(z.string(), z.any())).max(2),
    unit: z.enum(["patient", "sample"]),
    lineGap: z.number().int().min(1).max(100000),
  }),
  async run(args: { study: string; groups: (Record<string, unknown> | false)[] | null; genes: unknown[]; clinical: string[];
    heatmap: Record<string, unknown>[]; overlays: Record<string, unknown>[]; unit: "patient" | "sample"; lineGap: number }) {
    if ((args.groups || []).some((g) => g && carriesPatientIds(g))) throw new Error(ID_LIST);
    const { s, res } = await held(args.study, "oncoprint");
    const { queries, ...inputs } = await studyOncoprintInputs(s, res.instance.conn, args as never, await oncokbPin());
    return { study: s, ...inputs, queries: hideSql() ? null : queries, source: await peerSource(s) };
  }
};

/**
 * The ops this instance serves, as its settings stand now. The patient-level ones are present ONLY
 * when FEDERATION_DISCLOSE_PATIENTS has rules: without them, asking for one is asking for an op that
 * does not exist.
 */
export function federationOps(): Map<string, FederationOp> {
  const ops = new Map<string, FederationOp>([
    ["aggregates", aggregates], ["plot", plot], ["profiles", profiles],
    ["facets", facets], ["studies", studies], ["catalog", catalog],
  ]);
  if ((setting("FEDERATION_DISCLOSE_PATIENTS") || "").trim()) {
    ops.set("patient-rows", patientRows);
    ops.set("patient-timeline", patientTimeline);
    ops.set("plot-cases", plotCases);
    ops.set("oncoprint-columns", oncoprintColumns);
  }
  return ops;
}

export type FederationAnswer = { status: 200; body: Record<string, unknown> } | { status: 400 | 404 | 422; body: { error: string } };

/**
 * Answer one call: the op looked up, its input checked, then run. A refusal is an answer like any
 * other (422, naming why), so the caller can report it; nothing is thrown past here.
 */
export async function answerFederation(name: string, input: unknown): Promise<FederationAnswer> {
  const op = federationOps().get(name);
  if (!op) return { status: 404, body: { error: "no federation op '" + name.slice(0, 60) + "' here" } };
  const parsed = op.input.safeParse(input ?? {});
  if (!parsed.success) return { status: 400, body: { error: "bad request for " + name + ": " + parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 400) } };
  try {
    return { status: 200, body: await op.run(parsed.data) };
  } catch (e) {
    return { status: 422, body: { error: String((e as Error)?.message || e) } };
  }
}
