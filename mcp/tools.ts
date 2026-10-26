// Shared MCP tool registry — consumed by mcp/server.ts (standalone) and app/api/[transport]/route.ts (Vercel).
import { z } from "zod";
import { chQuery, DB, STUDY, PORTAL } from "../lib/ch.ts";
import { compileCohort, compileLines, catalogSqls, lineCatalogSqls, LINE_TYPE } from "../lib/compiler.ts";
import { buildContract } from "../lib/oncoprint.ts";
import { contractToSvg } from "../lib/oncoprint-svg.ts";
import { viewToSvg, viewTitle } from "../lib/view-svg.ts";
import sharp from "sharp";
import { ensureFonts } from "../lib/fonts.ts";
import { renderDslMarkdown } from "../lib/dsl-reference.ts";
import { analysisText } from "../lib/result-text.ts";
import {
  createCampaign, getCampaign, addHypotheses, lockCampaign, runCampaign, checkFeasibility, reportText
} from "../lib/campaign.ts";
import { HYPOTHESIS_GRAMMAR } from "../lib/hypothesis.ts";
import { runAnalysis, resolveStudy, studyProfiles } from "../lib/analysis.ts";
import { resolverFor, carriesPatientIds, studyRouting, routeStudy, PatientLevelResolver, PEER_TABLES, hasFederatedPlot, type PeerTable, type CourseOpts, type SequenceOpts } from "../lib/federation.ts";
import { timelinePatientRowSource, TIMELINE_COLUMNS, PATIENT_ID } from "../lib/patient-timeline.ts";
import { ALTERATION_COLUMNS, ALTERATION_PATIENT_COLUMNS, PATIENT_SAMPLE_COLUMNS, alterationPatientRowSource, alterationSource, patientSamplesSource } from "../lib/patient-alterations.ts";
import { loopbackConnId } from "../lib/loopback-peer.ts";
import { allowedKinds, disclosedByThisInstance, PATIENT_KIND_NAMES, type PatientKind } from "../lib/disclosure.ts";
import { checkQuery, cleanQuery, type QueryColumn, type RowSource, type TableQuery } from "../lib/table-query.ts";
import { buildExplore } from "../lib/explore.ts";
import { oncokbPin } from "../lib/annotation.ts";
import { peerSource } from "../lib/provenance.ts";
import { connections, directConnections } from "../lib/ch.ts";
import { studiesFor } from "../lib/study-list.ts";
import { catalogFor } from "../lib/study-catalog.ts";
import type { AnalysisDoc, AnalysisResult, Contract } from "../lib/types.ts";
import type { OncoprintSpec } from "../lib/views/oncoprint/types.ts";
import { validateAxis, type PlotAxis, type PlotRequest, type AxisKind, type PointRank, type SparseCells, type Whiskers } from "../lib/plot.ts";
import { resolveAxes } from "../lib/plot-profile.ts";

// ---------- shared zod fragments (the tools' input schemas) ----------
const zSelector = z.object({
  eventType: z.string().max(200).describe("Event type from describe_study, or 'Treatment line (derived)'"),
  attrs: z.array(z.object({ key: z.string().max(200), value: z.string().max(500) })).max(3).optional()
    .describe("String-equality attribute filters, ANDed. Line events support LINE_NO and COMPOSITION."),
  numeric: z.object({ key: z.string().max(200), op: z.enum([">", ">=", "<", "<=", "="]), value: z.number() })
    .nullish().describe("Numeric predicate on an attribute value (non-numeric values never match)"),
  occurrence: z.enum(["ANY", "FIRST", "LAST"]).optional()
    .describe("Pin to one event per patient BEFORE the relation is evaluated"),
  minDurationDays: z.number().min(0).nullish().describe("Only events lasting >= N days (needs a stop date)")
});
const zRel = z.object({
  type: z.enum(["NONE", "BEFORE", "DURING", "NOT_FOLLOWED_BY"]),
  minDays: z.number().min(0).optional().describe("BEFORE: exclusive lower bound after A.start (default 0)"),
  maxDays: z.number().min(0).optional().describe("BEFORE: inclusive upper bound after A.start (required for BEFORE)"),
  withinDays: z.number().min(1).optional().describe("NOT_FOLLOWED_BY: absence window (required)"),
  observed: z.boolean().optional().describe("NOT_FOLLOWED_BY: require follow-up past the window. STRONGLY recommended (default it to true) — without it, 'no event' conflates with 'lost to follow-up'.")
});
const zCohortDsl = {
  a: zSelector.describe("Anchor event selector (A)"),
  b: zSelector.nullish().describe("Second event selector (B); omit when rel.type is NONE"),
  rel: zRel,
  priorGuard: z.boolean().optional()
    .describe("Restrict to patients NLP-flagged 'No prior medications'. Set true whenever the question depends on 'first' (first line, treatment-naive), because ~20% of treated patients had prior treatment elsewhere and ~20% are undetermined."),
  lineGap: z.number().min(1).max(3650).optional()
    .describe("Treatment-free gap (days) that starts a new derived treatment line (default 90)")
};

const CAVEATS = {
  absence: "Absence query: 'no event recorded' is not proof it didn't happen. The observability guard (observed:true) was " ,
  priorMed: "In this study ~20% of treated patients carry the 'Prior medications to MSK' flag and ~20% have no determination; without priorGuard, 'first X' means first observed at MSK, not necessarily first ever.",
  lines: "Treatment lines are DERIVED from event sequence by interval-merging systemic therapy with a gap rule; 'line 1' means first line observed in this study unless priorGuard is set."
};

function cohortCaveats(args: any): string[] {
  const out: string[] = [];
  if (args.rel && args.rel.type === "NOT_FOLLOWED_BY")
    out.push(CAVEATS.absence + (args.rel.observed ? "applied." : "NOT applied — interpret with caution."));
  const usesFirst = [args.a, args.b].some((s: any) => s && s.occurrence === "FIRST");
  if (usesFirst && !args.priorGuard) out.push(CAVEATS.priorMed);
  const usesLines = [args.a, args.b].some((s: any) => s && s.eventType === LINE_TYPE);
  if (usesLines) out.push(CAVEATS.lines);
  return out;
}

function text(t: string) { return { content: [{ type: "text", text: t }] }; }

/**
 * The engine the tools run on. The Next route passes the cached one (lib/next-cache.ts); the
 * stdio server has no Next runtime, so it runs the engine directly.
 */
export interface ToolEngine {
  runAnalysis: (doc: AnalysisDoc) => Promise<AnalysisResult>;
  buildContract: (spec: OncoprintSpec) => Promise<Contract>;
}
const DIRECT: ToolEngine = { runAnalysis: (doc) => runAnalysis(doc), buildContract: (spec) => buildContract(spec) };

/** A timeline event to align on — survival's re-anchoring and the clinical course's day 0. */
const zEventAnchor = z.object({
  eventType: z.string().max(120),
  key: z.string().max(120).nullish(), value: z.string().max(200).nullish(),
  occurrence: z.enum(["FIRST", "LAST"]).nullish()
});

/**
 * A study a federation tool may answer for: one this instance holds in its own databases. A study
 * it reaches through a peer of its own is refused, so a call is never relayed or answered from the
 * wrong database.
 */
async function ownStudy(study: string): Promise<string> {
  const { peerForStudy } = await import("../lib/federation-remote.ts");
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

export function registerTools(server: any, engine: ToolEngine = DIRECT): void {

  // ---- federation endpoint -------------------------------------------------
  // What a peer instance exposes to another cbio-lab: AGGREGATES ONLY.
  // Counts computed inside this instance's database; no patient id is ever
  // returned, which is what makes document-level federation safe to point at
  // data that cannot be shared row-wise.
  server.registerTool(
    "federated_aggregates",
    {
      description:
        "Federation endpoint for another cbio-lab instance. Evaluates a cohort definition against a study THIS instance holds and returns aggregates only — cohort size, per-gene (profiled, altered, driver) counts, (months, event, n) survival triples, and per-gene-pair 2x2 tables. Never returns patient identifiers. Used by a coordinating instance to include this site's patients in compare and survival views without patient-level data leaving.",
      inputSchema: {
        study: z.string().max(120).describe("Study id held by this instance"),
        cohort: z.record(z.string(), z.any()).describe("Cohort definition (v2 DSL; see describe_dsl)"),
        genes: z.array(z.string()).max(20).nullish().describe("Genes for per-gene counts"),
        survival: z.boolean().nullish().describe("Also return (months, event, n) survival triples"),
        endpoint: z.string().max(40).nullish()
          .describe("Survival endpoint prefix for `survival` — OS, PFS, DFS, DSS… reads <X>_MONTHS/<X>_STATUS (default OS)"),
        endpointColumns: z.object({ months: z.string().max(64), status: z.string().max(64) }).nullish()
          .describe("Override the <endpoint>_MONTHS/<endpoint>_STATUS naming convention with exact column names, for a study whose outcome columns don't follow it — `endpoint` is then just a display label"),
        anchor: zEventAnchor.nullish().describe("Re-anchor survival to a timeline event. Returns (entry, months, event, n) — entry is the delayed-entry time, without which anchoring manufactures immortal time."),
        survivalEndpoints: z.boolean().nullish()
          .describe("Return the survival endpoints THIS study declares, so a caller can offer only what exists"),
        pairs: z.array(z.tuple([z.string(), z.string()])).max(66).nullish()
          .describe("Gene pairs for co-occurrence: returns each pair's 2x2 (both/onlyA/onlyB/neither) among patients profiled for BOTH genes"),
        attributes: z.array(z.string()).max(20).nullish()
          .describe("Clinical attributes to describe: value counts for categorical, (n, sum, sum of squares, min, max) for numeric. Never individual values."),
        attributeHistograms: z.boolean().nullish()
          .describe("With `attributes`, also return each numeric attribute's complete (value, count) distribution — an exact median/IQR or rank-sum test needs it, and it is safe only because the caller is comparing cohorts confined to THIS one study (a median is not additive across sites the way sum/sumsq is)"),
        attributeTopValues: z.number().int().min(1).max(500).nullish()
          .describe("Categorical attributes: return only the N most frequent values (and `distinct`, how many there are), instead of refusing one with more than 200"),
        momentGenes: z.array(z.string()).max(12).nullish()
          .describe("With `profileType`, genes for per-gene (n, sum, sum of squares) on that profile — enough to define a z-score reference distribution without disclosing any value"),
        variantGenes: z.array(z.string()).max(12).nullish()
          .describe("Genes for per-protein-change (lollipop) counts: how many patients carry each variant, plus per-gene totals"),
        lollipopGenes: z.array(z.string()).max(12).nullish()
          .describe("Genes for per-codon (lollipop) counts, the way cBioPortal's mutation tab counts them: distinct (patient, protein change) pairs per protein start position, raw rows per mutation type for the colour, per-gene totals and the cohort's sample count"),
        minCount: z.number().int().min(1).max(1000).nullish()
          .describe("Suppression floor applied by THIS instance before returning variant counts; variants carried by fewer patients are withheld"),
        timelineSpan: z.boolean().nullish()
          .describe("Per timeline event type: patients, events, distinct days and first/last day — what a clinical-course view needs to know whether the study records time at all"),
        course: z.object({
          anchor: zEventAnchor.nullable(),
          eventTypes: z.array(z.string().max(120)).max(20),
          binMonths: z.number().positive().max(120),
          from: z.number().int().min(-600).max(600), to: z.number().int().min(-600).max(600)
        }).nullish().describe("The clinical course: per time bin relative to the anchor, how many patients were observable and how many were in each event state (counts only)"),
        sequence: z.object({
          eventType: z.string().max(120), labelKey: z.string().max(120),
          exclude: z.array(z.string().max(200)).max(200),
          lineGap: z.number().int().min(1).max(3650), maxSteps: z.number().int().min(1).max(10),
          lineClasses: z.union([z.enum(["systemic", "all"]), z.array(z.string().max(120)).max(50)]).nullish()
        }).nullish().describe("Treatment sequences: (step, from, to, n, fate) flows between derived treatment lines (counts only)"),
        sequenceKeys: z.string().max(120).nullish()
          .describe("The attribute keys of this timeline event type that can label a treatment, with how many patients and distinct values each has"),
        profileType: z.string().max(120).nullish()
          .describe("With `pairs`, a continuous molecular profile (e.g. an mRNA z-score profile): returns the six sums (n, Sx, Sy, Sxy, Sxx, Syy) per pair, which are sufficient for a correlation and carry no individual value")
      }
    },
    async ({ study, cohort, genes, survival, pairs, attributes, attributeHistograms, attributeTopValues, profileType, variantGenes, lollipopGenes, minCount, momentGenes, endpoint, endpointColumns, survivalEndpoints, anchor, timelineSpan, course, sequence, sequenceKeys }: { timelineSpan?: boolean | null; course?: CourseOpts | null; sequence?: SequenceOpts | null; sequenceKeys?: string | null; study: string; cohort: any; genes?: string[] | null; survival?: boolean | null; pairs?: [string, string][] | null; attributes?: string[] | null; attributeHistograms?: boolean | null; attributeTopValues?: number | null; profileType?: string | null; variantGenes?: string[] | null; lollipopGenes?: string[] | null; minCount?: number | null; momentGenes?: string[] | null; endpoint?: string | null; endpointColumns?: { months: string; status: string } | null; survivalEndpoints?: boolean | null; anchor?: any }) => {
      try {
        // Refused here, by the peer, whatever the caller checked: an explicit list compiles to the
        // ids themselves, and beside a clinical attribute a count of 0 or 1 reads one patient's value.
        if (carriesPatientIds(cohort))
          throw new Error("cohort contains an explicit sample or patient list; identifiers are not accepted across instances");
        const s = await ownStudy(study);
        const { profiles, gaProfiles } = await studyProfiles(s);
        const pin = await oncokbPin();
        const res = await resolverFor(s, { oncokbPin: pin, profiles, gaProfiles });
        const [count, geneCounts, survivalCounts, pairCounts, attributeStats, pairMoments, variantCounts, profileMoments, endpointList, lollipopCounts] = await Promise.all([
          res.count(cohort),
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
        // SQL text carries no patient data, and an id-carrying definition was refused
        // above, so disclosing what we ran restores end-to-end provenance for the
        // caller. A deployment that treats its schema as sensitive sets
        // FEDERATION_HIDE_SQL=1 and the caller degrades gracefully.
        const hideSql = process.env.FEDERATION_HIDE_SQL === "1";
        const cohortSql = hideSql ? null : res.cohortSql(cohort);
        const payload = { study: s, instance: res.instance.label, count, geneCounts, survivalCounts, pairCounts, attributeStats, pairMoments, variantCounts, profileMoments, survivalEndpoints: endpointList, ...(lollipopCounts ? { lollipopCounts } : {}), ...(spans ? { timelineSpan: spans } : {}), ...(courseCounts ? { eventCourse: courseCounts } : {}), ...(flows ? { treatmentSequence: flows } : {}), ...(keys ? { sequenceKeys: keys } : {}), cohortSql, queries: hideSql ? null : res.queries, oncokbPin: pin };
        return {
          content: [{ type: "text" as const, text: `aggregates for ${s}: ${count.toLocaleString()} patients` +
            (geneCounts.length ? `, ${geneCounts.length} gene counts` : "") +
            (survivalCounts.length ? `, ${survivalCounts.length} survival strata` : "") +
            (pairCounts.length ? `, ${pairCounts.length} gene-pair tables` : "") +
            (attributeStats.length ? `, ${attributeStats.length} clinical attributes` : "") + " (no patient identifiers returned)" }],
          structuredContent: { ...payload, source: await peerSource(s) }
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  // A plot, or one of the per-site pieces a pooled plot is built from: counts, bins, sums,
  // quartiles. Aggregates only, like federated_aggregates; the cases behind a plot are
  // federated_plot_cases', under the disclosure rules. The axes come as the caller resolved them
  // (or as profile axes, resolved here against this study's own profiles) and are checked here.
  server.registerTool(
    "federated_plot",
    {
      description:
        "Federation endpoint for another cbio-lab instance's plot view: evaluates a cohort definition against a study THIS instance holds and returns a plot's aggregates — " +
        "a whole plot (density grid, quartiles, violin, contingency, coefficients), or one piece of a plot pooled across sites: the axes' kinds, the extent, bin counts on a shared grid and extent, " +
        "the six sums behind a correlation, box quartiles, a box's density on a shared range, contingency cells, coverage, or a second cohort's count, cells or quartiles within it. Never returns patient identifiers.",
      inputSchema: {
        study: z.string().max(120),
        cohort: z.record(z.string(), z.any()),
        op: z.enum(["plot", "axisKinds", "extent", "bins", "moments", "table", "box", "violin", "coverage", "highlightCount", "highlightBins", "highlightBox"]),
        spec: z.record(z.string(), z.any()).describe("x, y, unit, and optionally colorBy, ringBy, bins: the plot as a view states it"),
        kinds: z.object({ xk: z.enum(["num", "cat", "none"]), yk: z.enum(["num", "cat", "none"]) }).nullish(),
        bins: z.tuple([z.number().int().min(1).max(1000), z.number().int().min(1).max(1000)]).nullish(),
        extent: z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() }).nullish(),
        violinBins: z.number().int().min(4).max(200).nullish().describe("for violin: how many bins to cut the shared range into"),
        range: z.tuple([z.number(), z.number()]).nullish().describe("for violin: the value range every site bins over"),
        highlight: z.record(z.string(), z.any()).nullish().describe("for the highlight ops: the second cohort, whose cases within the first are counted"),
      }
    },
    async (args: { study: string; cohort: any; op: string; spec: any; kinds?: { xk: AxisKind; yk: AxisKind } | null; bins?: [number, number] | null;
      extent?: { x0: number; x1: number; y0: number; y1: number } | null; violinBins?: number | null; range?: [number, number] | null; highlight?: any }) => {
      try {
        if (carriesPatientIds(args.cohort) || carriesPatientIds(args.highlight))
          throw new Error("cohort contains an explicit sample or patient list; identifiers are not accepted across instances");
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
        const hideSql = process.env.FEDERATION_HIDE_SQL === "1";
        return {
          content: [{ type: "text" as const, text: "plot " + args.op + " for " + s + " (aggregates; no patient identifiers returned)" }],
          structuredContent: { study: s, op: args.op, result, cohortSql: hideSql || args.op === "axisKinds" ? null : res.cohortSql(args.cohort), queries: hideSql ? null : res.queries, source: await peerSource(s) }
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  // A study's molecular profiles as it describes them (genetic_profile: type, datatype, name), so a
  // caller can read a profile axis as this study means it. Metadata only.
  server.registerTool(
    "federated_profiles",
    {
      description: "Federation endpoint: the molecular profiles of a study THIS instance holds, each with its alteration type, datatype and name. Metadata only; no data values.",
      inputSchema: { study: z.string().max(120) }
    },
    async ({ study }: { study: string }) => {
      try {
        const s = await ownStudy(study);
        const p = await studyProfiles(s);
        return { content: [{ type: "text" as const, text: s + ": " + p.catalog.length + " profiles" }],
          structuredContent: { study: s, profiles: p.profiles, gaProfiles: p.gaProfiles, catalog: p.catalog, source: await peerSource(s) } };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  // ---- opt-in patient-level federation ---------------------------------------
  // Registered ONLY where this instance's operator writes rules in MCP_DISCLOSE_PATIENTS
  // (lib/disclosure.ts): a peer that has not opted in does not have these tools at all. Each call is
  // checked against those rules — the study, and the kind of patient-level data the table belongs to
  // (PEER_TABLES) — for a study this instance holds at patient level itself. The coordinator must
  // accept the same kind (PEER_MCP_PATIENT_LEVEL); see docs/DATA-BOUNDARY.md. There is no caller
  // authentication yet: anyone who can reach this endpoint can read what it discloses.
  if ((process.env.MCP_DISCLOSE_PATIENTS || "").trim()) {
    const held = async (study: string, kind: PatientKind): Promise<{ s: string; res: PatientLevelResolver }> => {
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
    };
    const rejected = (e: unknown) => ({ content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true });
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

    server.registerTool(
      "federated_patient_rows",
      {
        description:
          "Patient-level federation endpoint (opt-in: MCP_DISCLOSE_PATIENTS rules) for another cbio-lab instance's patient views, computed in THIS instance's database for a study it holds: " +
          "the timeline's patient list (table 'timeline'); the alterations view's patient list ('alterations'), and one patient's samples, mutations, copy-number alterations and structural variants " +
          "('alterations:samples' / ':mutations' / ':cna' / ':sv', naming the patient in subject) — a page of rows, the per-cohort counts, one column's values, or one patient's place in the order, " +
          "searched, filtered and sorted here. Each table is answered only where this instance's rules disclose its kind for the study. Returns patient identifiers.",
        inputSchema: {
          study: z.string().max(120),
          table: z.enum(Object.keys(PEER_TABLES) as [PeerTable, ...PeerTable[]]).default("timeline"),
          parts: z.array(z.object({ cohort: z.string().max(200), cohortDef: z.record(z.string(), z.any()) })).min(1).max(6),
          source: z.string().max(200).describe("What the caller calls this instance: a patient list's Source column"),
          query: z.record(z.string(), z.any()).nullish(),
          defaults: z.array(z.string().max(40)).max(20),
          mode: z.enum(["page", "counts", "values", "rank"]),
          limit: z.number().int().min(1).max(10000).nullish(),
          offset: z.number().int().min(0).nullish(),
          column: z.string().max(40).nullish(),
          patient: z.string().max(80).nullish(),
          subject: z.object({ patient: z.string().max(80), order: z.array(z.string().max(120)).max(500).nullish() }).nullish()
            .describe("For a table of one patient's: whose, and their samples' order (the Samples column's)"),
          oncokbPin: z.string().max(40).nullish().describe("The OncoKB version the caller annotates with, used unless this instance pins its own (ONCOKB_PIN)"),
        }
      },
      async ({ study, table, parts, source, query, defaults, mode, limit, offset, column, patient, subject, oncokbPin }: { study: string; table: PeerTable; parts: { cohort: string; cohortDef: any }[]; source: string; query?: any; defaults: string[]; mode: "page" | "counts" | "values" | "rank"; limit?: number | null; offset?: number | null; column?: string | null; patient?: string | null; subject?: { patient: string; order?: string[] | null } | null; oncokbPin?: string | null }) => {
        try {
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
            : table === "alterations" ? (db) => alterationPatientRowSource(sourced, db)
            : table === "alterations:samples" ? (db) => patientSamplesSource(sourced[0], subject!.patient, db)
            : (db) => alterationSource(table.slice("alterations:".length) as "mutations" | "cna" | "sv", sourced[0], subject!.patient, db, pin, subject!.order || []);
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
          const hideSql = process.env.FEDERATION_HIDE_SQL === "1";
          return {
            content: [{ type: "text" as const, text: `${table} rows for ${s} (${mode}) — patient-level, disclosed under MCP_DISCLOSE_PATIENTS (${PATIENT_KIND_NAMES[PEER_TABLES[table]]})` }],
            structuredContent: { table, ...out, ...(annotated ? { oncokbPin: pin } : {}), queries: hideSql ? null : res.queries, source: await peerSource(s) }
          };
        } catch (e) { return rejected(e); }
      });

    server.registerTool(
      "federated_patient_timeline",
      {
        description:
          "Patient-level federation endpoint (opt-in: MCP_DISCLOSE_PATIENTS) for another cbio-lab instance's timeline view: every clinical event (days from diagnosis, with all attributes) and the samples of ONE patient of a study THIS instance holds. Returns that patient's record.",
        inputSchema: { study: z.string().max(120), patient: z.string().max(80) }
      },
      async ({ study, patient }: { study: string; patient: string }) => {
        try {
          if (!PATIENT_ID.test(patient)) throw new Error("not a patient id");
          const { s, res } = await held(study, "timeline");
          const t = await res.patientTimeline(patient);
          if (!t.events.length && !t.samples.length) throw new Error(patient + " has no record in " + s);
          const hideSql = process.env.FEDERATION_HIDE_SQL === "1";
          return {
            content: [{ type: "text" as const, text: `timeline of ${patient} (${s}): ${t.events.length} events, ${t.samples.length} samples — patient-level, disclosed under MCP_DISCLOSE_PATIENTS` }],
            structuredContent: { study: s, patient, events: t.events, samples: t.samples, queries: hideSql ? null : res.queries, source: await peerSource(s) }
          };
        } catch (e) { return rejected(e); }
      });

    server.registerTool(
      "federated_plot_cases",
      {
        description:
          "Patient-level federation endpoint (opt-in: MCP_DISCLOSE_PATIENTS rules, kind 'plot') for another cbio-lab instance's plot view: the cases a plot draws as points, with their case ids, " +
          "for a study THIS instance holds — every case up to the cap, a box's values beyond given whiskers, a scatter's cases in sparse cells of a given grid, the extremes on an axis or the cases " +
          "furthest from a fitted line, or a second cohort's cases within the first. Returns case identifiers.",
        inputSchema: {
          study: z.string().max(120),
          cohort: z.record(z.string(), z.any()),
          op: z.enum(["points", "scatterPoints", "ranked", "highlightPoints"]),
          spec: z.record(z.string(), z.any()),
          cap: z.number().int().min(1).max(50000).nullish(),
          outside: z.array(z.object({ g: z.string().max(200), loWhisker: z.number(), hiWhisker: z.number() }).passthrough()).max(200).nullish(),
          sparse: z.object({ grid: z.tuple([z.number().int(), z.number().int()]), extent: z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number() }), cellMax: z.number().int().min(1).max(100) }).nullish(),
          rank: z.union([z.object({ by: z.enum(["x", "y"]), n: z.number().int().min(1).max(500) }),
            z.object({ by: z.literal("residual"), n: z.number().int().min(1).max(500), slope: z.number(), intercept: z.number() })]).nullish(),
          kinds: z.object({ xk: z.enum(["num", "cat", "none"]), yk: z.enum(["num", "cat", "none"]) }).nullish(),
          highlight: z.record(z.string(), z.any()).nullish(),
        }
      },
      async (args: { study: string; cohort: any; op: string; spec: any; cap?: number | null; outside?: Whiskers[] | null; sparse?: SparseCells | null;
        rank?: PointRank | null; kinds?: { xk: AxisKind; yk: AxisKind } | null; highlight?: any }) => {
        try {
          if (carriesPatientIds(args.cohort) || carriesPatientIds(args.highlight))
            throw new Error("a cohort contains an explicit sample or patient list; identifier lists are not accepted across instances");
          const { s, res } = await held(args.study, "plot");
          const spec = await plotSpecHere(s, args.spec);
          const cap = args.cap ?? undefined;
          let points: unknown;
          if (args.op === "points") points = await res.plotPoints(args.cohort, spec, cap, args.outside ?? undefined);
          else if (args.op === "scatterPoints") points = await res.plotScatterPoints(args.cohort, spec, cap, args.sparse ?? undefined);
          else if (args.op === "ranked") {
            if (!args.rank || !args.kinds) throw new Error("ranked needs rank and kinds");
            points = await res.plotRankedPoints(args.cohort, spec, args.kinds.xk, args.kinds.yk, args.rank);
          } else {
            if (!args.highlight || !args.kinds) throw new Error("highlightPoints needs highlight and kinds");
            points = await res.plotHighlightPoints(args.cohort, args.highlight, spec, args.kinds.xk, args.kinds.yk, cap);
          }
          const hideSql = process.env.FEDERATION_HIDE_SQL === "1";
          return {
            content: [{ type: "text" as const, text: "plot " + args.op + " for " + s + " — patient-level, disclosed under MCP_DISCLOSE_PATIENTS (" + PATIENT_KIND_NAMES.plot + ")" }],
            structuredContent: { study: s, op: args.op, points, queries: hideSql ? null : res.queries, source: await peerSource(s) }
          };
        } catch (e) { return rejected(e); }
      });
  }

  // Faceting counterpart to federated_aggregates: everything the Explore page
  // needs, as aggregates. Same guarantee — attribute names, value counts, gene
  // and event counts; never a patient identifier.
  server.registerTool(
    "federated_facets",
    {
      description:
        "Federation endpoint for another cbio-lab instance: the faceted catalog for a study THIS instance holds — clinical attributes with value counts (or numeric min/median/max), timeline event types, most-altered genes, case lists, molecular profiles, and the study's patient count — optionally conditioned on a draft cohort. Aggregates only; never returns patient identifiers. Lets a coordinating instance browse and filter this site's data without querying its database.",
      inputSchema: {
        study: z.string().max(120).describe("Study id held by this instance"),
        draft: z.record(z.string(), z.any()).nullish().describe("Optional draft cohort definition (v2 DSL) to condition every count on"),
        geneSearch: z.string().max(40).nullish().describe("Restrict the gene tables to symbols containing this substring")
      }
    },
    async ({ study, draft, geneSearch }: { study: string; draft?: any; geneSearch?: string | null }) => {
      try {
        if (carriesPatientIds(draft))
          throw new Error("draft contains an explicit sample or patient list; identifiers are not accepted across instances");
        const s = await ownStudy(study);
        const { profiles, gaProfiles } = await studyProfiles(s);
        const conn = await routeStudy(s);
        const facets = await buildExplore({
          study: s, draft: draft || null, oncokbPin: await oncokbPin(),
          geneSearch: geneSearch || undefined, profiles, gaProfiles, conn
        });
        return {
          content: [{ type: "text" as const, text: `facets for ${s}: ${facets.clinical.length} clinical attributes, ` +
            `${facets.mutatedGenes?.length ?? 0} mutated genes, ${facets.events.length} event types (aggregates only)` }],
          // `genes` (the retired combined list) stays empty for coordinators whose merge still sums it
          structuredContent: { ...facets, genes: [], source: await peerSource(s) } as unknown as Record<string, unknown>
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  // The study list and the study catalog, for a coordinator that holds none of this instance's
  // databases: the counts and vocabulary its study picker and cohort builder show. Like the
  // facets, they name no patient.
  server.registerTool(
    "federated_studies",
    {
      description:
        "Federation endpoint for another cbio-lab instance: the studies THIS instance holds in its own databases, one row each — name, cancer type, patient and sample counts, how many patients have timeline events, and which data types it carries. Counts only; never returns patient identifiers.",
      inputSchema: {}
    },
    async () => {
      try {
        const { servingAsLoopbackPeer } = await import("../lib/loopback-peer.ts");
        const conns = servingAsLoopbackPeer() ? connections().filter((c) => c.id === loopbackConnId()) : directConnections();
        const studies = (await Promise.all(conns.map((c) => studiesFor(c)))).flat();
        return {
          content: [{ type: "text" as const, text: `${studies.length} studies held by this instance (counts only)` }],
          structuredContent: { studies, source: await peerSource() }
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  server.registerTool(
    "federated_catalog",
    {
      description:
        "Federation endpoint for another cbio-lab instance: the cohort-builder catalog of a study THIS instance holds — timeline event types with patient and event counts, their attribute keys and values, survival endpoints, and the derived treatment lines. Vocabulary and counts only; never returns patient identifiers.",
      inputSchema: { study: z.string().max(120).describe("Study id held by this instance") }
    },
    async ({ study }: { study: string }) => {
      try {
        const s = await ownStudy(study);
        const cat = await catalogFor(s);
        return {
          content: [{ type: "text" as const, text: `catalog for ${s}: ${cat.types.length} event types, ${cat.totalPatients} patients` }],
          structuredContent: { ...cat, source: await peerSource(s) } as unknown as Record<string, unknown>
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true };
      }
    });

  server.tool(
    "describe_dsl",
    "The complete, generated reference for the cbio-lab DSL: the Analysis document (cohorts + views), every clause kind (OQL, clinical, timeline events, case lists, continuous genomic data, ...), cross-study federation semantics, the OncoprintSpec, and runnable examples. Read this before composing documents by hand; it is generated from the same source as the docs and the in-app chat grammar, and its examples are CI-executed against the live compiler.",
    {},
    async () => ({ content: [{ type: "text", text: renderDslMarkdown() }] })
  );

  server.tool(
    "run_analysis",
    "Execute a full Analysis document — the v2 DSL: named cohorts built from OQL genomic status, clinical attributes, timeline events, case lists, and continuous genomic data (optionally federated across studies), plus views: compare (alteration frequencies with Fisher p), clinical (attribute distributions per cohort), cooccurrence (pairwise 2x2 tests), hotspots (mutation lollipop), coexpression (gene-pair correlation), survival (Kaplan-Meier), cox (multivariate hazard ratios, forest plot), logistic (multivariate logistic regression on a binary outcome, odds ratios), course (event timelines), sequence (treatment-line flows), plot (scatter/box/table of any two axes), oncoprint, attrition (CONSORT-style counts after each cohort clause), genome (genome-wide copy-number gain/loss frequency from segments), pathways (the ten Sanchez-Vega oncogenic pathways, % altered per cohort), diffexpr (two-cohort differential expression volcano plus preranked GSEA), paired (primary-vs-metastasis or before-vs-after-treatment concordance within patients; omit genes to scan every gene, pairBy.studies to pool studies that label samples differently), clonality (FACETS clonal/subclonal calls, LOH, genome doubling, purity, ploidy), incidence (cumulative incidence of a timeline event with death as a competing risk, Gray's test), labs (a lab value's course and response from a treatment start, e.g. PSA50, with a waterfall), acquired (alterations acquired under therapy: each patient's sample before a treatment start against their sample after it, per gene acquired vs lost with McNemar q; omit genes to scan), ctdna (plasma cfDNA against tissue within patients: per gene both / tissue-only / plasma-only with positive percent agreement, the share with ctDNA detected, and overall survival by ctDNA detected), exclusivity (mutual exclusivity and co-occurrence of up to 20 genes against each tumour's alteration burden, DISCOVER, beside the plain Fisher test), hla (HLA class I genotype: the share homozygous at 0/1/2+ of HLA-A, -B, -C and with HLA LOH, and overall survival by each with log-rank and Cox HRs, optionally adjusted; patient-level studies only), cutpoint (the cut of a numeric marker such as TMB that best splits survival: scan between the 10th and 90th percentiles, permutation-corrected p beside the naive one, KM at the cut, optional per-stratum cuts; patient-level studies only), predictive (gene x treatment interaction per gene: the gene's survival HR among the treated and the untreated and their interaction p, BH q; patient-level studies only), txendpoints (real-world treatment endpoints from a treatment start — time to next treatment, time on treatment or real-world PFS — as Kaplan-Meier curves with log-rank), rmst (restricted mean survival time to tau per cohort with differences and ratios, for non-proportional hazards; landmark analysis from given months), multistate (an illness-death model — start, progression, death — from day 0: state occupation over time, cumulative hazards, transition rates and a hazard ratio per transition), instability (genomic instability from copy-number segments: fraction of genome altered, arm-level gains and losses and the aneuploidy score per cohort, with a rank test), cancertypes (a gene list's alteration frequency per cancer type, the portal's Cancer Types Summary), overlap (how cohorts' patients intersect, as an UpSet plot), enrichment (every gene's alteration frequency compared between cohorts, the portal's Genomic Alterations tab), assays (every entity of a generic-assay profile — mutational signatures, arm-level copy number, treatment response — compared between cohorts), composition (what each case is made of — cell types, cell states, signatures — as stacked bars per case and each cohort's mean, every part of each cohort set against the others), mutations (one gene's mutation table: every call with sample, protein change, OncoKB annotation, allele frequency; patient-level studies only), table (the clinical data table: each sample or patient with every clinical attribute, patient-level studies only), timeline (one patient's clinical timeline as on cBioPortal's patient view — treatments, diagnoses, samples, lab values from diagnosis — with the cohorts' patients listed to pick from; patient-level studies only), alterations (one patient's Mutations, Copy Number Alterations and Structural Variants tables as on cBioPortal's patient view, each searchable, filterable and sortable, with the cohort's patients listed to pick from; patient-level studies only), correlates (every gene's expression correlated with one gene's, the portal's Co-expression tab), riskmodel (an OncoCast-style elastic-net Cox ensemble predicting survival from mutated genes, held-out C-index and Kaplan-Meier risk groups; patient-level studies only), forest (one exposure's hazard ratio per cancer type, study or cohort, pooled by a DerSimonian–Laird random-effects meta-analysis with I² and Cochran's Q; patient-level studies only), adjusted (every frequently mutated gene compared between two cohorts by logistic regression on covariates such as MSI and TMB, adjusted beside raw odds ratios; patient-level studies only), actionability (each patient's highest OncoKB therapeutic level and resistance level per cohort or cancer type, and its primary/metastasis concordance), drivernegative (one cohort split into patients with and without an OncoKB driver in a canonical driver list, panel-aware, and every other gene's frequency compared between them), organotropism (which genes' alterations go with metastasis to which organ, per-organ flags, timeline sites or biopsy sites, Cochran–Mantel–Haenszel within cancer types as a gene × site heatmap, plus the cumulative incidence of one site by one gene's status with death competing), molsubtype (a published molecular classifier per patient — the endometrial POLE-ultramutated / MMR-deficient / p53-abnormal / NSMP hierarchy, with not-classifiable patients kept apart — as subtype shares per cohort and by an attribute, and overall survival by subtype), germline (germline carriers per gene among patients sequenced, and how often their tumour has a somatic second hit in the same gene — a mutation or deep deletion — against non-carriers, with optional overall survival by carrier status). Every view's figure is returned as an image. Call describe_dsl first for the grammar and runnable examples. Returns per-cohort counts with plain-language readbacks, view results, caveats you MUST surface to the user, and a link that opens this exact document in the interactive editor.",
    {
      document: z.object({}).passthrough()
        .describe("The Analysis document: {dsl?, study, cohorts: {name: def (may carry splits), ...}, views: [...]}. Grammar and examples: describe_dsl.")
    },
    async ({ document }: { document: AnalysisDoc }) => {
      let r;
      try { r = await engine.runAnalysis(document); }
      catch (e) { return text("REJECTED: " + String((e as Error)?.message || e) + "\nCall describe_dsl for the grammar and runnable examples."); }
      const base = process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
      const docB64 = Buffer.from(JSON.stringify(document)).toString("base64url");
      const content: any[] = [];
      const out = analysisText(document, r);
      // FIGURES. lib/view-svg.ts renders every view kind the app draws, and the
      // oncoprint carries its own SVG, so the same renderer that produces the
      // web figure produces this one — a chat client sees the chart, not a
      // description of it. Rasterised at a fixed light theme, because the CSS
      // custom properties that follow the page theme have no meaning outside it.
      //
      // Capped: each PNG is a sizeable base64 block in the model's context, and
      // four figures is a workup rather than a gallery. What is dropped is named
      // rather than silently omitted.
      const MAX_FIGURES = 4;
      const drawn: string[] = [];
      let skipped = 0;
      for (const v of r.views) {
        if (v.error) continue;
        const svg = (v.kind === "oncoprint" ? v.svg : undefined) || viewToSvg(v, { theme: "light" });
        if (!svg) continue;
        if (drawn.length >= MAX_FIGURES) { skipped++; continue; }
        ensureFonts();
        const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
        content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
        drawn.push(viewTitle(v));
      }
      if (drawn.length)
        out.push(`Figures attached, in order:\n` +
          drawn.map((t, i) => `  ${i + 1}. ${t}`).join("\n") +
          (skipped ? `\n  (${skipped} further figure${skipped === 1 ? "" : "s"} not attached — open the editor link below)` : ""));

      out.push(`Interactive editor (share with the user — opens this exact document, live): ${base}/lab?doc=${docB64}` +
        `\nThat page also shows the generated SQL for every cohort (full provenance).`);
      content.push({ type: "text", text: out.join("\n\n") });
      return { content };
    });

  server.tool(
    "describe_study",
    "Get the study's queryable vocabulary: timeline event types with patient counts, their attribute keys and common values, the synthetic 'Treatment line (derived)' event type, and study-level caveats. Call this once before composing cohort queries.",
    {},
    async () => {
      const sqls = catalogSqls(DB, STUDY);
      const [tRes, vRes] = [await chQuery(sqls.types), await chQuery(sqls.values)];
      const values: Record<string, Record<string, string[]>> = {};
      vRes.data.forEach((r) => { (values[r.t] = values[r.t] || {}); (values[r.t][r.k] = values[r.t][r.k] || []).push(r.v); });
      const lc = lineCatalogSqls(DB, STUDY);
      const combos = (await chQuery(lc.combos)).data.map((r) => r.combo);
      const lines: string[] = [];
      lines.push(`Study: ${STUDY} (unit of counting: patient). Portal: ${PORTAL}/study/summary?id=${STUDY}`);
      lines.push("\nEvent types (patients | events):");
      for (const t of tRes.data) {
        lines.push(`- ${t.t}: ${Number(t.n_pat).toLocaleString()} pts | ${Number(t.n_ev).toLocaleString()} events`);
        const keys = values[t.t] || {};
        for (const k of Object.keys(keys).slice(0, 8))
          lines.push(`    ${k}: ${keys[k].slice(0, 10).join(", ")}${keys[k].length > 10 ? ", …" : ""}`);
      }
      lines.push(`- ${LINE_TYPE}: derived at query time (gap rule, default 90d). Attributes: LINE_NO (1..n), COMPOSITION (${combos.slice(0, 8).join(", ")}, …)`);
      lines.push("\nCaveats: " + CAVEATS.priorMed + " Dates are per-patient day offsets; only intervals/orderings are meaningful.");
      return text(lines.join("\n"));
    });

  server.tool(
    "query_cohort",
    "Define a patient cohort by temporal relationships between clinical timeline events and count it. Semantics: a patient is in the cohort if there EXISTS a pair of event occurrences satisfying the relation. Returns counts, a plain-language readback (echo it to the user to confirm intent), a days-from-A-to-B histogram for BEFORE queries, sample patient portal links, and caveats you MUST surface to the user.",
    zCohortDsl,
    async (args: any) => {
      const q = { db: DB, study: STUDY, a: args.a, b: args.b, rel: args.rel, priorGuard: !!args.priorGuard, lineGap: args.lineGap, patientsLimit: 10 };
      const { countSql, patientsSql, histSql, histBucket } = compileCohort(q);
      const c = await chQuery(countSql);
      const matched = Number(c.data[0].matched), denom = Number(c.data[0].denom);
      const pts = (await chQuery(patientsSql)).data.map((r) => r.pid);
      const out: string[] = [];
      out.push(`Cohort: ${matched.toLocaleString()} patients (of ${denom.toLocaleString()} with the anchor event, ${denom ? (100 * matched / denom).toFixed(1) : 0}%).`);
      if (histSql) {
        const h = await chQuery(histSql);
        if (h.data.length) {
          out.push(`Days from A to first subsequent B (bucket=${histBucket}d): ` +
            h.data.map((r) => `${r.bucket}–${Number(r.bucket) + histBucket - 1}d:${r.n}`).join("  "));
        }
      }
      out.push("Sample patients: " + pts.slice(0, 6).map((p) => `${PORTAL}/patient?studyId=${STUDY}&caseId=${p}`).join("  "));
      const cv = cohortCaveats(args);
      if (cv.length) out.push("CAVEATS (tell the user): " + cv.join(" | "));
      out.push(`Query ran in ${c._ms}ms scanning ${Number(c.statistics?.rows_read).toLocaleString()} rows.`);
      return text(out.join("\n\n"));
    });

  server.tool(
    "derive_treatment_lines",
    "Derive lines of therapy for the study by interval-merging systemic-therapy events (Chemo/Immuno/Targeted/Hormone/Biologic/Investigational) per patient, starting a new line after a treatment-free gap. Returns the lines-per-patient distribution and the top line-1 to line-2 regimen transitions.",
    {
      gap: z.number().min(1).max(3650).default(90).describe("Treatment-free gap in days that starts a new line"),
      guard: z.boolean().default(false).describe("Restrict to 'No prior medications' patients so line numbers are absolute")
    },
    async ({ gap, guard }: { gap: number; guard: boolean }) => {
      const { histSql, transSql } = compileLines(DB, STUDY, gap, guard);
      const h = await chQuery(histSql);
      const t = await chQuery(transSql);
      const out: string[] = [];
      out.push(`Lines per patient (gap=${gap}d${guard ? ", 'No prior medications' only" : ""}): ` +
        h.data.map((r) => `${Number(r.bucket) >= 8 ? "8+" : r.bucket}:${Number(r.n).toLocaleString()}`).join("  "));
      out.push("Top 1L→2L transitions: " + t.data.map((r) => `${r.line1}→${r.line2}:${r.n}`).join("  "));
      out.push("CAVEAT (tell the user): " + CAVEATS.lines + (guard ? "" : " " + CAVEATS.priorMed));
      return text(out.join("\n\n"));
    });

  server.tool(
    "render_oncoprint",
    "Render an oncoprint image for gene alterations across a cohort (or across column groups defined by two cohorts). Columns are patients, staircase-sorted; cells show mutations by class, high-level CNA (amp/deep-deletion only), and structural variants; striped cells mean the gene was NOT on that patient's sequencing panel (distinct from unaltered); per-track frequencies use panel-aware denominators. Returns a PNG plus the track statistics.",
    {
      genes: z.array(z.string()).min(1).max(12).describe("Gene symbols for tracks, e.g. ['TP53','KRAS','MSH3']"),
      cohort: z.object(zCohortDsl).nullish().describe("Cohort for the columns; omit for all patients (ignored when groups given)"),
      groups: z.array(z.object({ name: z.string().max(60), dsl: z.object(zCohortDsl) })).max(4).nullish()
        .describe("Optional column groups, each its own cohort DSL — e.g. progressors vs non-progressors side by side"),
      patientList: z.array(z.string().max(64)).max(10000).nullish()
        .describe("Explicit patient IDs (e.g. imported from a portal custom case list) to use as the cohort — overrides `cohort`; ids not in the study are dropped"),
      derivedEventTracks: z.array(z.object({ label: z.string().max(60), expression: z.object(zCohortDsl) })).max(3).nullish()
        .describe("Optional phenotype tracks from cohort-DSL expressions, e.g. 'Reached 2L'"),
      sort: z.array(z.string()).max(4).nullish()
        .describe("Column sort: ordered track keys — 'genomic' (default staircase), a clinical track label (must also be in clinical), or '-label' for descending; missing values sort last"),
      clinical: z.array(z.string()).max(8).nullish().describe("Clinical attribute tracks, e.g. ['OS_STATUS','CURRENT_AGE_DEID']; sample-level attributes fall back to a sample value per patient; numeric attributes render as continuous heat tracks; unknown names render a labeled '(no data)' track"),
      heatmap: z.array(z.object({ profileType: z.string().max(120), genes: z.array(z.string()).max(12).nullish(), entities: z.array(z.string()).max(12).nullish() })).max(4).nullish()
        .describe("Continuous molecular-profile heatmap tracks (portal-style), e.g. [{profileType:'mrna_median_Zscores'}] — one row per gene (defaults to the gene tracks), patient value = mean across samples; z-score profiles use a fixed diverging +-3 blue-white-red ramp; unknown profiles error listing what the study has; profileType 'VAF' is a synthetic profile rendering mutation variant-allele fraction from loaded alt/ref counts; a numeric generic-assay profile (mutational signatures, methylation, …) takes entities:[...] (its entity ids) in place of genes")
    },
    async ({ genes, cohort, groups, derivedEventTracks, clinical, heatmap, sort, patientList }: any) => {
      const spec: OncoprintSpec = {
        genes,
        clinical: clinical || [],
        ...(heatmap && heatmap.length ? { heatmap } : {}),
        ...(sort && sort.length ? { sort } : {}),
        derivedEvents: derivedEventTracks || [],
        cohort: patientList && patientList.length ? { dsl: { patients: patientList } } : (cohort ? { dsl: cohort } : null),
        layout: groups && groups.length ? { groupBy: { kind: "cohorts" as const, groups } } : null,
        conventions: { lineGap: 90 }
      };
      ensureFonts();
      const contract = await engine.buildContract(spec);
      const svg = contractToSvg(contract, 1200);
      const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
      const stats = contract.tracks.filter((t) => t.kind === "gene")
        .map((t) => `${t.label}: ${t.driverPct}% driver / ${t.freqPct}% any (${t.driverAltered}/${t.altered}/${t.profiled} driver/altered/profiled)`).join("  ");
      const base = process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
      const specB64 = Buffer.from(JSON.stringify(spec)).toString("base64url");
      const provUrl = base + "/provenance?spec=" + specB64;
      const summary =
        `Oncoprint: ${contract.stats.nColumns.toLocaleString()} patients` +
        (contract.groups.length > 1 ? ` in groups ${contract.groups.map((g) => `${g.name}(${g.count})`).join(", ")}` : "") +
        `.\nGene frequencies (panel-aware denominators): ${stats}` +
        `\nConventions: CNA ±2 only; striped = not profiled (not the same as unaltered); solid = putative driver, faded = VUS.` +
        (String(contract.conventions.annotation).startsWith("MOCK")
          ? `\nANNOTATION SOURCE (tell the user): ${contract.conventions.annotation} — driver/VUS calls are a mock placeholder; treat driver percentages as illustrative only.`
          : `\nAnnotations: ${contract.conventions.annotation} — driver/VUS classification is version-pinned; the same spec re-renders identically against this release.`) +
        `\nProvenance (share this with the user): ${provUrl}\n` +
        `That page re-renders this exact oncoprint and shows the DSL spec and every generated SQL query.` +
        `\nInteractive figure (share this too — it opens THIS oncoprint with live controls): ${base}/oncoprint-lab?spec=${specB64}` +
        `\nThe same figure outside the browser, if the user works in a terminal or a notebook: ` +
        `${base}/oncoprint-lab/cli?spec=${specB64} (the node and Python command lines, run against this spec) and ` +
        `${base}/oncoprint-lab/python?spec=${specB64} (the cohortlab package in a Pyodide notebook).` +
        `\nModifications the user can ask for right here in chat: add or remove gene tracks (up to 12); ` +
        `add clinical attribute tracks, up to 8 (e.g. OS_STATUS, GENDER, SMOKING_PREDICTIONS_3_CLASSES; numeric ones like CURRENT_AGE_DEID render as heat); ` +
        `add derived-event phenotype tracks from any cohort expression (e.g. "reached 3rd line", "had surgery"); ` +
        `regroup columns by different cohorts (up to 4 side-by-side); change the treatment-line gap rule (lineGap); ` +
        `restrict any group to treatment-naive patients (priorGuard); sort columns by a clinical track ('sort':['CANCER_TYPE'] or '-CURRENT_AGE_DEID' for descending); add molecular heatmap tracks where the study has continuous profiles (e.g. heatmap:[{profileType:'mrna_median_Zscores'}]) and sort by them. Offer 1-2 of these as next steps when relevant.`;
      return {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          { type: "text", text: summary }
        ]
      };
    });

  // ---- hypothesis campaigns: this tool as the referee for any hypothesis generator ----------
  const appBase = () => process.env.APP_BASE_URL || "https://cohort-lab.vercel.app";
  const campaignErr = (e: unknown) => text("REJECTED: " + String((e as Error)?.message || e));
  const zHyp = z.object({
    statement: z.string().max(400), rationale: z.string().max(2000).nullish(),
    doc: z.object({}).passthrough(), primary: z.object({}).passthrough(),
    direction: z.enum(["higher", "lower", "any"]).nullish()
  });

  server.tool(
    "campaign_create",
    "Start a hypothesis campaign: a research question whose hypotheses this tool will pre-register, test on a fixed discovery half of the patients, correct for multiplicity across the whole campaign, and replicate on the held-out half. Use this when you are GENERATING hypotheses and want them tested honestly. Returns the campaign id and the hypothesis format. Workflow: campaign_create → campaign_check_hypothesis (optional, per hypothesis) → campaign_register → campaign_lock → campaign_run → campaign_report.",
    { question: z.string().min(5).max(1000), study: z.string().max(120).nullish() },
    async ({ question, study }: { question: string; study?: string | null }) => {
      try {
        const c = await createCampaign(question, study || "msk_chord_2024");
        return text(`Campaign ${c.id} created for ${c.study}.\nPage for the researcher: ${appBase()}/campaign/${c.id}\n` +
          `Plan (fixed now): FDR ${c.plan.fdr} across all tested hypotheses; replication p < ${c.plan.replicationAlpha} on the held-out half; arms ≥ ${c.plan.minArm}.\n\n` +
          HYPOTHESIS_GRAMMAR + "\n\nThe Analysis document grammar is in describe_dsl.");
      } catch (e) { return campaignErr(e); }
    }
  );

  server.tool(
    "campaign_check_hypothesis",
    "Check one hypothesis without registering it: is the document well-formed, does the engine accept it, and how many patients fall in each compared group on the discovery half. Returns cohort sizes only — never an outcome — so checking cannot leak a result into the choice of what to test.",
    { hypothesis: zHyp, study: z.string().max(120).nullish() },
    async ({ hypothesis, study }: { hypothesis: any; study?: string | null }) => {
      const h = { ...hypothesis, doc: { ...hypothesis.doc, study: hypothesis.doc?.study || study || "msk_chord_2024" } };
      const f = await checkFeasibility(h, engine.runAnalysis);
      return text(f.ok ? `TESTABLE. Discovery-half group sizes: ${JSON.stringify(f.n)}` : `NOT TESTABLE: ${f.reason}` + (f.n ? ` (sizes: ${JSON.stringify(f.n)})` : ""));
    }
  );

  server.tool(
    "campaign_register",
    "Register hypotheses on a draft campaign. Each is validated and checked for feasibility; malformed ones are rejected with the reason, groups too small to test register as untestable (they stay on the record). Identical tests are refused as duplicates.",
    { campaign_id: z.string().max(40), hypotheses: z.array(zHyp).min(1).max(40), source: z.enum(["generator", "researcher"]).nullish() },
    async ({ campaign_id, hypotheses, source }: { campaign_id: string; hypotheses: any[]; source?: "generator" | "researcher" | null }) => {
      try {
        const r = await addHypotheses(campaign_id, hypotheses, source || "generator", engine.runAnalysis);
        return text(`Registered ${r.added.length}:\n` + r.added.map((h) => `  #${h.position} ${h.feasibility?.ok ? "testable " + JSON.stringify(h.feasibility.n) : "UNTESTABLE — " + h.feasibility?.reason}: ${h.statement}`).join("\n") +
          (r.rejected.length ? `\nRejected ${r.rejected.length} (fix and resubmit):\n` + r.rejected.map((x) => `  "${x.statement}": ${x.reason}`).join("\n") : ""));
      } catch (e) { return campaignErr(e); }
    }
  );

  server.tool(
    "campaign_lock",
    "Pre-register: freeze the campaign's hypothesis list and hash it, before any result exists. Irreversible — the database refuses any later addition, removal or edit. Confirm with the user before calling.",
    { campaign_id: z.string().max(40) },
    async ({ campaign_id }: { campaign_id: string }) => {
      try {
        const c = await lockCampaign(campaign_id);
        return text(`Locked at ${c.lockedAt}. Receipt (sha256 over every registered test): ${c.ledgerHash}\n${c.hypotheses.filter((h) => h.feasibility?.ok).length} testable hypotheses will be run.`);
      } catch (e) { return campaignErr(e); }
    }
  );

  server.tool(
    "campaign_run",
    "Run a locked campaign: every testable hypothesis on the discovery half, one Benjamini–Hochberg correction across all of them, and replication of the survivors on the held-out validation half. Returns the full report, nulls included. Report it to the user as it is — the funnel and the failures are the point.",
    { campaign_id: z.string().max(40) },
    async ({ campaign_id }: { campaign_id: string }) => {
      try { return text(reportText(await runCampaign(campaign_id, engine.runAnalysis), appBase())); }
      catch (e) { return campaignErr(e); }
    }
  );

  server.tool(
    "campaign_report",
    "The current state of a campaign: every registered hypothesis with its result so far, and the funnel from registered to replicated.",
    { campaign_id: z.string().max(40) },
    async ({ campaign_id }: { campaign_id: string }) => {
      try { return text(reportText(await getCampaign(campaign_id), appBase())); }
      catch (e) { return campaignErr(e); }
    }
  );
}

