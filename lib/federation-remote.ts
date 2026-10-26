// Document-level federation: a peer cbio-lab reached over MCP.
//
// The peer holds data this instance cannot query directly — a different
// database, a different institution, a different trust domain. It exposes one
// tool, `federated_aggregates`, which evaluates a cohort definition against a
// study it holds and answers with counts only. This resolver is the client
// half; it satisfies exactly the same AggregateCapable contract as a local
// aggregate-only resolver, so lib/analysis.ts cannot tell the difference —
// which is the entire point.
//
// Note what this type does NOT have: members(). A remote peer is aggregate-only
// by construction, so oncoprints degrade for its studies exactly as they do for
// a local aggregate-only instance.
import type { CohortDef, ExploreResult } from "./types.ts";
import type { AggregateCapable, GeneCounts, Instance, SurvivalCount, PairCounts, AttrStats, PairMoments, VariantReport, LollipopReport, ProfileMoments, QueryLogEntry, SurvivalAnchor, EndpointColumns, TimelineSpan, CourseCount, CourseOpts, SequenceOpts, SequenceFlow, PlotData, PlotRequest, FederatedPlotCapable, PlotCasesCapable, ViolinBin } from "./federation.ts";
import type { AxisKind, PlotAxis, PlotShape, HighlightPoint, PlotPoint, PlotXYPoint, PointRank, SparseCells, Whiskers } from "./plot.ts";
import type { Moments } from "./stats.ts";
import type { ProfileInfo } from "./profile-catalog.ts";
import { carriesPatientIds, studyRouting } from "./federation.ts";
import { loopbackConnId, loopbackHeaders, loopbackUrl, servingAsLoopbackPeer } from "./loopback-peer.ts";
import { loopbackOnlyConn, noteFailedQuery } from "./ch.ts";
import { logOutbound } from "./federation-log.ts";
import { PEER_TABLES, type RemotePatientRows, type PeerRowsRequest, type PeerRowsAnswer } from "./federation.ts";
import { acceptedFromPeers, allowedKinds, PATIENT_KIND_NAMES, type PatientKind } from "./disclosure.ts";
import type { PatientTimeline, PatientEvent, PatientSample, PeerSource } from "./types.ts";
import type { StudyRow } from "./study-list.ts";
import type { StudyCatalog } from "./study-catalog.ts";
import { cohortSubquery, type CohortSql } from "./sql-kinds.ts";

interface RemoteAggregates {
  study: string; instance: string; count: number;
  geneCounts: GeneCounts[]; survivalCounts: SurvivalCount[]; survivalEndpoints?: string[] | null; pairCounts: PairCounts[]; attributeStats: AttrStats[]; pairMoments: PairMoments[]; variantCounts: VariantReport; lollipopCounts?: LollipopReport; profileMoments: ProfileMoments[];
  timelineSpan?: TimelineSpan[] | null; eventCourse?: CourseCount[] | null;
  treatmentSequence?: SequenceFlow[] | null;
  sequenceKeys?: { key: string; label: string; patients: number; values: number }[] | null;
  /** the SQL the peer compiled and ran, when it chooses to disclose it */
  cohortSql?: string | null;
  /** and the aggregate queries it ran to answer this call */
  queries?: QueryLogEntry[] | null;
  oncokbPin: string | null;
}

/**
 * The peer that holds `study`, if one does: PEER_MCP's STUDY=URL pairs (e.g.
 * "genie_public=http://127.0.0.1:3103/api/mcp"), else — with LOOPBACK_PEER — this app itself, for a
 * study on the connection it serves as a simulated peer (lib/loopback-peer.ts). While answering as
 * that peer, its studies are its own again, so they are read from their database.
 */
export async function peerForStudy(study: string): Promise<{ url: string; label: string } | null> {
  const url = peerMcpEntries().get(study);
  if (url) return { url, label: peerLabel() };
  const id = loopbackConnId();
  if (!id || servingAsLoopbackPeer()) return null;
  const conn = (await studyRouting()).get(study);
  if (conn?.id !== id) return null;
  return { url: loopbackUrl(), label: process.env.LOOPBACK_PEER_LABEL || conn.label + " (simulated peer)" };
}

/** PEER_MCP as a map from study to the peer URL that serves it. */
export function peerMcpEntries(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (process.env.PEER_MCP || "").split(/[,\s]+/).filter(Boolean)) {
    const i = entry.indexOf("=");
    if (i < 0) continue;
    const study = entry.slice(0, i).trim(), url = entry.slice(i + 1).trim();
    if (study && url && !out.has(study)) out.set(study, url);
  }
  return out;
}

const peerLabel = (): string => process.env.PEER_LABEL || "peer via MCP";

/**
 * The study list rows of every PEER_MCP peer, for the studies PEER_MCP maps to it: each peer is
 * asked once (federated_studies) and only the studies routed to it are kept, so a peer cannot add
 * a study this instance did not configure or take one routed elsewhere. A peer that does not
 * answer is reported in `failed` rather than thrown, so the reachable ones still list.
 */
export async function remoteStudies(): Promise<{ rows: StudyRow[]; failed: string[] }> {
  const byUrl = new Map<string, Set<string>>();
  for (const [study, url] of peerMcpEntries()) (byUrl.get(url) ?? byUrl.set(url, new Set()).get(url)!).add(study);
  const rows: StudyRow[] = [], failed: string[] = [];
  await Promise.all([...byUrl].map(async ([url, studies]) => {
    try {
      const ans = await mcpCall<{ studies: StudyRow[] }>(url, "federated_studies", {});
      for (const r of ans.studies || [])
        if (studies.has(r.id)) rows.push({ ...r, instance: "peer", instanceLabel: peerLabel() });
    } catch { failed.push(url); }
  }));
  // the simulated peer lists every study it holds: it is this app's own connection, configured here
  const loop = loopbackOnlyConn();
  if (loop) {
    try {
      const label = process.env.LOOPBACK_PEER_LABEL || loop.label + " (simulated peer)";
      for (const r of await loopbackStudies()) rows.push({ ...r, instance: "peer", instanceLabel: label });
    } catch { failed.push(loopbackUrl()); }
  }
  return { rows, failed };
}

/** The simulated peer's study list, from its own federated_studies (lib/loopback-peer.ts). */
export async function loopbackStudies(): Promise<StudyRow[]> {
  return (await mcpCall<{ studies: StudyRow[] }>(loopbackUrl(), "federated_studies", {})).studies || [];
}

/** The catalog of a study held by a remote peer (federated_catalog): vocabulary and counts only. */
export async function remoteCatalog(study: string, url: string): Promise<StudyCatalog> {
  const cat = await mcpCall<StudyCatalog>(url, "federated_catalog", { study });
  if (cat.study !== study) throw new Error("peer answered the catalog of '" + String(cat.study).slice(0, 60) + "' for '" + study + "'");
  return cat;
}

/** A study's profiles as the peer that holds it describes them (federated_profiles): metadata only. */
export async function remoteProfiles(study: string, url: string): Promise<{ profiles: string[]; gaProfiles: string[]; catalog: ProfileInfo[] }> {
  const r = await mcpCall<{ study: string; profiles?: string[]; gaProfiles?: string[]; catalog?: ProfileInfo[] }>(url, "federated_profiles", { study });
  if (r.study !== study) throw new Error("peer answered the profiles of '" + String(r.study).slice(0, 60) + "' for '" + study + "'");
  return { profiles: r.profiles || [], gaProfiles: r.gaProfiles || [], catalog: r.catalog || [] };
}

/**
 * The opt-in patient-level federation mode, as THIS instance (the coordinator) configures it: the
 * kinds of patient-level data it accepts from the peer serving `study` — its PEER_MCP_PATIENT_LEVEL
 * rules (lib/disclosure.ts). The peer must allow the same kinds in its MCP_DISCLOSE_PATIENTS; either
 * side alone changes nothing.
 */
export function peerPatientKinds(study: string): Set<PatientKind> {
  return allowedKinds(acceptedFromPeers(), study);
}

/**
 * Minimal MCP streamable-HTTP client: initialize, then tools/call. Kept
 * dependency-free and stateless so a peer can be any conforming server.
 */
async function mcpCall<T = RemoteAggregates>(url: string, name: string, args: unknown): Promise<T> {
  // a peer that refused or did not answer is a failed query: whatever this answer becomes is not cached
  const t0 = Date.now(), loopback = isLoopbackCall(url);
  try {
    const out = await mcpCallOnce<T>(url, name, args);
    logOutbound(name, args, url, loopback, Date.now() - t0, { bytes: JSON.stringify(out).length });
    return out;
  } catch (e) {
    logOutbound(name, args, url, loopback, Date.now() - t0, { error: String((e as Error)?.message || e) });
    noteFailedQuery();
    throw e;
  }
}
/** Whether a call to `url` is this app calling itself, for the log; never throws. */
function isLoopbackCall(url: string): boolean {
  try { return Object.keys(loopbackHeaders(url)).length > 0; } catch { return false; }
}
async function mcpCallOnce<T>(url: string, name: string, args: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...loopbackHeaders(url),
  };
  const rpc = async (body: unknown, extra: Record<string, string> = {}) => {
    const res = await fetch(url, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body), cache: "no-store" });
    const text = await res.text();
    const sid = res.headers.get("mcp-session-id") || "";
    // streamable HTTP may answer as SSE; take the last data: line
    const line = text.includes("data:")
      ? text.split("\n").filter((l) => l.startsWith("data:")).pop()!.slice(5).trim()
      : text;
    return { sid, json: line ? JSON.parse(line) : null };
  };

  const init = await rpc({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cbio-lab-federation", version: "1.0.0" } }
  });
  const sessionHeaders: Record<string, string> = init.sid ? { "mcp-session-id": init.sid } : {};
  if (init.sid) await fetch(url, {
    method: "POST", headers: { ...headers, ...sessionHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
  }).catch(() => {});

  const out = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, sessionHeaders);
  const r = out.json?.result;
  if (!r) throw new Error("peer returned no result for " + name);
  if (r.isError) throw new Error("peer rejected: " + (r.content?.[0]?.text || "unknown"));
  const sc = r.structuredContent as T | undefined;
  if (!sc) throw new Error("peer returned no structured aggregates");
  return sc;
}

/**
 * Faceted catalog for a study held by a remote peer. Aggregates only: the peer
 * computes the facets against its own database and returns counts, so Explore
 * works over MCP exactly as it does over a direct connection.
 */
export async function remoteFacets(study: string, url: string, draft: CohortDef | null | undefined, label: string, geneSearch?: string): Promise<ExploreResult> {
  if (carriesPatientIds(draft))
    throw new Error("this draft contains an explicit sample or patient list, which is not sent to remote peer " + label);
  const facets = await mcpCall<ExploreResult>(url, "federated_facets", { study, draft: draft || null, geneSearch });
  // stamp provenance so the UI can badge peer-held rows
  return {
    ...facets,
    studyBreakdown: (facets.studyBreakdown || []).map((r) => ({ ...r, instance: "peer", instanceLabel: label }))
  };
}

/** a plot request as it travels to a peer: the axes, unit and grid, nothing else */
const plotSpecOut = (spec: PlotRequest) => ({ x: spec.x, y: spec.y, unit: spec.unit,
  ...(spec.colorBy ? { colorBy: spec.colorBy } : {}), ...(spec.ringBy ? { ringBy: spec.ringBy } : {}), ...(spec.bins ? { bins: spec.bins } : {}) });

export class RemoteAggregateResolver implements AggregateCapable, FederatedPlotCapable {
  readonly instance: Instance;
  readonly study: string;
  private readonly url: string;
  /**
   * What the peer said it ran, learned from any answered call. SQL text carries
   * no patient data — and an id-carrying definition is refused before a request
   * is ever made — so a peer may disclose it without weakening the boundary.
   * A peer that declines simply does not send it, and provenance degrades to a
   * statement that it ran remotely.
   */
  private peerSql: string | null = null;
  /**
   * What the peer reports having run. The peer logs its own queries through the
   * same mechanism, so provenance survives the hop: the caller sees the actual
   * aggregate SQL, marked as having executed on the peer rather than here.
   */
  readonly queries: QueryLogEntry[] = [];
  /** what the peer said about itself in its first answer, and when (lib/provenance.ts) */
  private reported: PeerSource | null = null;
  private answeredAt: string | null = null;
  constructor(study: string, url: string, instance: Instance) {
    this.study = study;
    this.url = url;
    this.instance = instance;
  }
  /** Every call to the peer goes through here, so its first self-report is kept. */
  protected async call<T = RemoteAggregates>(name: string, args: unknown): Promise<T> {
    const r = await mcpCall<T>(this.url, name, args);
    const src = (r as { source?: PeerSource } | null)?.source;
    if (src && !this.reported) { this.reported = src; this.answeredAt = new Date().toISOString(); }
    return r;
  }
  /** Where this study's peer is, and what it reported about itself (null before it answered). */
  provenance(): { url: string; reported: PeerSource | null; answeredAt: string | null } {
    return { url: this.url, reported: this.reported, answeredAt: this.answeredAt };
  }
  private remember(r: { cohortSql?: string | null; queries?: QueryLogEntry[] | null }): void {
    if (!r) return;
    if (typeof r.cohortSql === "string" && r.cohortSql.trim()) this.peerSql = r.cohortSql;
    if (Array.isArray(r.queries))
      for (const q of r.queries) this.queries.push({ label: q.label, sql: q.sql, ms: q.ms, remote: true });
  }
  /** The peer compiles and runs its own SQL against its own schema. */
  cohortSql(): CohortSql {
    const head = "-- evaluated remotely by " + this.instance.label + " (" + this.url + ")\n";
    return cohortSubquery(this.peerSql
      ? head + "-- compiled and run BY THE PEER, against its own schema; only counts came back\n" + this.peerSql
      : head + "-- this instance receives aggregates only; the peer did not disclose its SQL");
  }
  /** nothing carrying identifiers is allowed to leave for a remote peer */
  private guard(def: CohortDef | null | undefined): void {
    if (carriesPatientIds(def))
      throw new Error("this cohort contains an explicit sample or patient list, which is not sent to remote peer " + this.instance.label);
  }
  async count(def: CohortDef | null | undefined): Promise<number> {
    this.guard(def);
    const r = await this.call("federated_aggregates", { study: this.study, cohort: def || {} });
    this.remember(r);
    return r.count;
  }
  async geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]> {
    this.guard(def);
    if (!genes.length) return [];
    const r = await this.call("federated_aggregates", { study: this.study, cohort: def || {}, genes });
    this.remember(r);
    return r.geneCounts;
  }
  async survivalCounts(def: CohortDef | null | undefined, endpoint = "OS", anchor?: SurvivalAnchor | null, columns?: EndpointColumns): Promise<SurvivalCount[]> {
    this.guard(def);
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, survival: true, endpoint, ...(anchor ? { anchor } : {}), ...(columns ? { endpointColumns: columns } : {}) });
    this.remember(r);
    return r.survivalCounts;
  }
  async survivalEndpoints(): Promise<string[]> {
    // the peer reports what IT can answer; asking costs one call with no cohort
    const r = await this.call("federated_aggregates", { study: this.study, cohort: {}, survivalEndpoints: true })
      .catch(() => ({ survivalEndpoints: [] as string[] }));
    return (r as { survivalEndpoints?: string[] }).survivalEndpoints || [];
  }
  async timelineSpan(def: CohortDef | null | undefined): Promise<TimelineSpan[]> {
    this.guard(def);
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, timelineSpan: true });
    this.remember(r);
    return r.timelineSpan || [];
  }
  async treatmentSequence(def: CohortDef | null | undefined, opts: SequenceOpts): Promise<SequenceFlow[]> {
    this.guard(def);
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, sequence: opts });
    this.remember(r);
    return r.treatmentSequence || [];
  }
  async sequenceKeys(def: CohortDef | null | undefined, eventType: string): Promise<{ key: string; label: string; patients: number; values: number }[]> {
    this.guard(def);
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, sequenceKeys: eventType });
    this.remember(r);
    return r.sequenceKeys || [];
  }
  async eventCourse(def: CohortDef | null | undefined, opts: CourseOpts): Promise<CourseCount[]> {
    this.guard(def);
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, course: opts });
    this.remember(r);
    return r.eventCourse || [];
  }
  /**
   * A plot, or one piece of a plot pooled across sites, answered by the peer in its own database
   * (federated_plot): aggregates only, the cohort definitions refused here if they carry ids.
   */
  protected async plotOp<T>(op: string, def: CohortDef | null | undefined, spec: PlotRequest | { x: PlotAxis; y: PlotAxis }, extra: Record<string, unknown> = {}): Promise<T> {
    this.guard(def);
    if (extra.highlight !== undefined) this.guard(extra.highlight as CohortDef);
    const r = await this.call<{ op: string; result: T; cohortSql?: string | null; queries?: QueryLogEntry[] | null }>("federated_plot",
      { study: this.study, cohort: def || {}, op, spec: plotSpecOut(spec as PlotRequest), ...extra });
    if (r.op !== op) throw new Error("the peer serving " + this.study + " answered '" + String(r.op).slice(0, 40) + "' when asked for '" + op + "'");
    this.remember(r);
    return r.result;
  }
  async plot(def: CohortDef | null | undefined, spec: PlotRequest): Promise<PlotData> {
    return this.plotOp<PlotData>("plot", def, spec);
  }
  async plotAxisKinds(spec: { x: PlotAxis; y: PlotAxis }): Promise<{ xk: AxisKind; yk: AxisKind; shape: PlotShape; xLabel: string; yLabel: string }> {
    return this.plotOp("axisKinds", null, spec);
  }
  async plotExtent(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind): Promise<{ n: number; x0: number; x1: number; y0: number; y1: number }> {
    return this.plotOp("extent", def, spec, { kinds: { xk, yk } });
  }
  async plotBinCounts(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind,
    bins: [number, number], extent: { x0: number; x1: number; y0: number; y1: number }): Promise<{ bx: number; by: number; n: number }[]> {
    return this.plotOp("bins", def, spec, { kinds: { xk, yk }, bins, extent });
  }
  async plotMoments(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind): Promise<Moments> {
    return this.plotOp("moments", def, spec, { kinds: { xk, yk } });
  }
  async plotTableCells(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind): Promise<{ cx: string; cy: string; n: number }[]> {
    return this.plotOp("table", def, spec, { kinds: { xk, yk } });
  }
  async plotBoxRows(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number }[]> {
    return this.plotOp("box", def, spec, { kinds: { xk, yk } });
  }
  async plotViolinCounts(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind,
    bins: number, range: [number, number]): Promise<ViolinBin[]> {
    return this.plotOp("violin", def, spec, { kinds: { xk, yk }, violinBins: bins, range });
  }
  async plotCoverage(def: CohortDef | null | undefined, spec: PlotRequest, xk: AxisKind, yk: AxisKind): Promise<NonNullable<PlotData["coverage"]>> {
    return this.plotOp("coverage", def, spec, { kinds: { xk, yk } });
  }
  async plotHighlightCount(def: CohortDef | null | undefined, highlight: CohortDef): Promise<number> {
    return this.plotOp("highlightCount", def, { x: { source: "none" }, y: { source: "none" } }, { highlight });
  }
  async plotHighlightBins(def: CohortDef | null | undefined, highlight: CohortDef, spec: PlotRequest, xk: AxisKind, yk: AxisKind,
    bins: [number, number], extent: { x0: number; x1: number; y0: number; y1: number }): Promise<{ bx: number; by: number; n: number }[]> {
    return this.plotOp("highlightBins", def, spec, { highlight, kinds: { xk, yk }, bins, extent });
  }
  async plotHighlightBoxRows(def: CohortDef | null | undefined, highlight: CohortDef, spec: PlotRequest, xk: AxisKind, yk: AxisKind):
    Promise<{ g: string; n: number; lo: number; hi: number; q1: number; median: number; q3: number }[]> {
    return this.plotOp("highlightBox", def, spec, { highlight, kinds: { xk, yk } });
  }

  async attributeQuantile(def: CohortDef | null | undefined, _attribute: string, _per: "patient" | "sample", _p: number): Promise<number | null> {
    this.guard(def);
    throw new Error("a percentile-based cutoff is not supported against " + this.study + " yet: it is served by a remote peer, " +
      "and this needs its own MCP method rather than guessing at one");
  }

  async pairCounts(def: CohortDef | null | undefined, pairs: [string, string][]): Promise<PairCounts[]> {
    this.guard(def);
    if (!pairs.length) return [];
    const r = await this.call("federated_aggregates", { study: this.study, cohort: def || {}, pairs });
    this.remember(r);
    return r.pairCounts || [];
  }
  async attributeStats(def: CohortDef | null | undefined, attributes: string[], opts?: { histograms?: boolean; topValues?: number }): Promise<AttrStats[]> {
    this.guard(def);
    if (!attributes.length) return [];
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, attributes, ...(opts?.histograms ? { attributeHistograms: true } : {}),
        ...(opts?.topValues != null ? { attributeTopValues: opts.topValues } : {}) });
    this.remember(r);
    return r.attributeStats || [];
  }
  async profileMoments(def: CohortDef | null | undefined, genes: string[], profileType: string): Promise<ProfileMoments[]> {
    this.guard(def);
    if (!genes.length || !profileType) return [];
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, momentGenes: genes, profileType });
    this.remember(r);
    return r.profileMoments || [];
  }
  async variantCounts(def: CohortDef | null | undefined, genes: string[], minCount = 1): Promise<VariantReport> {
    this.guard(def);
    if (!genes.length) return { variants: [], totals: [], minCount };
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, variantGenes: genes, minCount });
    this.remember(r);
    return r.variantCounts || { variants: [], totals: [], minCount };
  }
  async lollipopCounts(def: CohortDef | null | undefined, genes: string[], minCount = 1): Promise<LollipopReport> {
    this.guard(def);
    if (!genes.length) return { changes: [], types: [], totals: [], cohortSamples: 0, minCount, annotated: false };
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, lollipopGenes: genes, minCount });
    this.remember(r);
    // a peer on an older build answers without these; refuse by name rather than draw nothing
    if (!r.lollipopCounts)
      throw new Error("peer " + this.study + " does not report per-codon lollipop counts (it predates them); update that instance");
    return r.lollipopCounts;
  }
  async pairMoments(def: CohortDef | null | undefined, pairs: [string, string][], profileType: string): Promise<PairMoments[]> {
    this.guard(def);
    if (!pairs.length || !profileType) return [];
    const r = await this.call("federated_aggregates",
      { study: this.study, cohort: def || {}, pairs, profileType });
    this.remember(r);
    return r.pairMoments || [];
  }
}

/** One event as a peer sent it, checked field by field: a peer is another program, not this one. */
function asEvent(x: unknown): PatientEvent | null {
  const e = x as Record<string, unknown>;
  if (!e || typeof e.type !== "string" || !Number.isFinite(Number(e.start))) return null;
  const attrs = Array.isArray(e.attrs) ? (e.attrs as unknown[]).filter((a) => Array.isArray(a) && a.length === 2).map((a) => [String((a as unknown[])[0]).slice(0, 200), String((a as unknown[])[1]).slice(0, 2000)] as [string, string]) : [];
  return { type: e.type.slice(0, 200), start: Number(e.start), end: e.end == null || !Number.isFinite(Number(e.end)) ? null : Number(e.end), attrs };
}

/**
 * A peer in the opt-in patient-level federation mode: everything RemoteAggregateResolver answers,
 * plus the row tables of the kinds this instance accepts from it (`patientKinds`, from its
 * PEER_MCP_PATIENT_LEVEL rules) — the peer pages them in its own database from the cohort
 * definitions it is sent. Nothing else: no members(), no plot points, no regression rows, so every
 * other view still treats this peer as aggregate-only. A table of a kind not accepted is refused
 * before the network is touched; the peer refuses what its own MCP_DISCLOSE_PATIENTS does not allow.
 */
export class RemotePatientResolver extends RemoteAggregateResolver implements RemotePatientRows {
  readonly peerUrl: string;
  readonly patientKinds: ReadonlySet<PatientKind>;
  constructor(study: string, url: string, instance: Instance, kinds: Iterable<PatientKind>) {
    super(study, url, instance);
    this.peerUrl = url;
    this.patientKinds = new Set(kinds);
    // A plot's cases, only where this instance accepts them from the peer (the `plot` kind): the
    // methods are this object's own, never the class's, so a peer that does not share them has no
    // way to be asked — the guarantee the boundary tests check.
    if (this.patientKinds.has("plot")) Object.assign(this, plotCaseMethods(this));
  }
  /** a call for a plot's cases, its refusal said in terms of the rules that decide it */
  async casesCall<T>(op: string, def: CohortDef | null | undefined, spec: PlotRequest, extra: Record<string, unknown>): Promise<T> {
    this.refuseIds([def, extra.highlight as CohortDef | undefined]);
    return this.disclosed(this.call<{ op: string; points: T; queries?: QueryLogEntry[] | null }>("federated_plot_cases",
      { study: this.study, cohort: def || {}, op, spec: plotSpecOut(spec), ...extra }).then((r) => {
      if (r.op !== op) throw new Error("the peer serving " + this.study + " answered '" + String(r.op).slice(0, 40) + "' when asked for '" + op + "'");
      if (Array.isArray(r.queries)) for (const q of r.queries) this.queries.push({ label: q.label, sql: q.sql, ms: q.ms, remote: true });
      return r.points;
    }), "plot");
  }
  protected refuseIds(defs: (CohortDef | null | undefined)[]): void {
    // the patient this view asks for is the entitlement; an explicit id LIST in a cohort is not part of it
    if (defs.some(carriesPatientIds))
      throw new Error("a cohort here contains an explicit sample or patient list, which is not sent to remote peer " + this.instance.label);
  }
  /** a refusal from the peer, said in terms of the setting that decides it */
  protected disclosed<T>(p: Promise<T>, kind: PatientKind): Promise<T> {
    const what = PATIENT_KIND_NAMES[kind];
    return p.catch((e: Error) => {
      const m = String(e?.message || e);
      throw new Error(/tool .*not found|unknown tool|-32601/i.test(m)
        ? "the peer serving " + this.study + " does not share patient-level data (it has not set MCP_DISCLOSE_PATIENTS), though this instance's PEER_MCP_PATIENT_LEVEL accepts " + what + " from it"
        : /not a study this instance discloses|does not disclose/.test(m)
          ? "the peer serving " + this.study + " does not share " + what + " of " + this.study + " (its MCP_DISCLOSE_PATIENTS does not allow it)"
          : m);
    });
  }
  async patientRows(req: PeerRowsRequest): Promise<PeerRowsAnswer> {
    const kind = PEER_TABLES[req.table];
    if (!kind) throw new Error("not a table a peer serves: " + String(req.table).slice(0, 40));
    if (!this.patientKinds.has(kind))
      throw new Error("this instance does not accept " + PATIENT_KIND_NAMES[kind] + " from the peer serving " + this.study + " (PEER_MCP_PATIENT_LEVEL)");
    this.refuseIds(req.parts.map((p) => p.def));
    const r = await this.disclosed(this.call<PeerRowsAnswer & { queries?: QueryLogEntry[] | null }>("federated_patient_rows", {
      study: this.study, table: req.table, parts: req.parts.map((p) => ({ cohort: p.cohort, cohortDef: p.def || {} })), source: this.instance.label,
      query: req.query, defaults: req.defaults, mode: req.mode,
      ...(req.limit != null ? { limit: req.limit } : {}), ...(req.offset != null ? { offset: req.offset } : {}), ...(req.column ? { column: req.column } : {}),
      ...(req.patient ? { patient: req.patient } : {}), ...(req.subject ? { subject: req.subject } : {}), ...(req.oncokbPin ? { oncokbPin: req.oncokbPin } : {}),
    }), kind);
    // the table the peer answered with: a peer on a build from before named tables answers every call with the
    // timeline's list and names none, so anything else it sends without saying so is refused rather than shown
    const served = (r as { table?: unknown }).table ?? "timeline";
    if (served !== req.table)
      throw new Error("the peer serving " + this.study + " answered with " + String(served).slice(0, 40) + " rows when asked for " + req.table +
        "; it predates sharing " + PATIENT_KIND_NAMES[kind] + " over MCP — update that instance");
    if (Array.isArray(r.queries)) for (const q of r.queries) this.queries.push({ label: q.label, sql: q.sql, ms: q.ms, remote: true });
    // what the peer answered for is what it was asked about: its own study, the asked cohorts — and a table of one patient's, that patient
    const cohorts = new Set(req.parts.map((p) => p.cohort));
    const own = <T extends Record<string, unknown>>(xs: T[] | undefined) => (xs || []).filter((x) => x.study === this.study && cohorts.has(String(x.cohort)));
    const rows = own(r.rows).filter((x) => !req.subject || x.patient === req.subject.patient);
    const rank = typeof r.rank === "number" && Number.isInteger(r.rank) && r.rank >= 0 ? r.rank : null;
    return { rows, counts: own(r.counts as unknown as Record<string, unknown>[]) as unknown as PeerRowsAnswer["counts"], values: r.values || [], rank,
      oncokbPin: typeof r.oncokbPin === "string" ? r.oncokbPin.slice(0, 40) : null };
  }
}

/** The plot-case methods a peer that shares them answers, each a federated_plot_cases call. */
function plotCaseMethods(r: RemotePatientResolver): PlotCasesCapable {
  return {
    plotPoints: (def, spec, cap?: number) =>
      r.casesCall<PlotPoint[] | null>("points", def, spec, cap != null ? { cap } : {}),
    plotOutlierPoints: (def, spec, cap: number, whiskers: Whiskers[]) =>
      r.casesCall<{ points: PlotPoint[]; total: number }>("outliers", def, spec, { cap, outside: whiskers }),
    plotScatterPoints: (def, spec, cap?: number, sparse?: SparseCells) =>
      r.casesCall<PlotXYPoint[] | null>("scatterPoints", def, spec, { ...(cap != null ? { cap } : {}), ...(sparse ? { sparse } : {}) }),
    plotRankedPoints: (def, spec, xk, yk, rank: PointRank) =>
      r.casesCall<HighlightPoint[]>("ranked", def, spec, { kinds: { xk, yk }, rank }),
    plotHighlightPoints: (def, highlight, spec, xk, yk, cap?: number) =>
      r.casesCall<HighlightPoint[] | null>("highlightPoints", def, spec, { highlight, kinds: { xk, yk }, ...(cap != null ? { cap } : {}) }),
  };
}

/**
 * A peer whose rules allow timelines: RemotePatientResolver plus the timeline view's other need,
 * one patient's record. Built only when this instance accepts timelines from it.
 */
export class RemoteTimelineResolver extends RemotePatientResolver {
  async patientTimeline(patient: string): Promise<PatientTimeline> {
    if (!this.patientKinds.has("timeline"))
      throw new Error("this instance does not accept patient timelines from the peer serving " + this.study + " (PEER_MCP_PATIENT_LEVEL)");
    const r = await this.disclosed(this.call<{ study: string; patient: string; events: unknown[]; samples: unknown[]; queries?: QueryLogEntry[] | null }>(
      "federated_patient_timeline", { study: this.study, patient }), "timeline");
    if (r.study !== this.study || r.patient !== patient) throw new Error("peer answered for " + r.study + "/" + r.patient + ", not " + this.study + "/" + patient);
    if (Array.isArray(r.queries)) for (const q of r.queries) this.queries.push({ label: q.label, sql: q.sql, ms: q.ms, remote: true });
    const events = (Array.isArray(r.events) ? r.events : []).map(asEvent);
    if (events.some((e) => !e)) throw new Error("peer sent a timeline event this instance cannot read");
    const samples: PatientSample[] = (Array.isArray(r.samples) ? r.samples : []).map((x) => ({ id: String((x as PatientSample).id).slice(0, 120), type: String((x as PatientSample).type ?? "").slice(0, 120) }));
    return { study: this.study, patient, events: events as PatientEvent[], samples, source: { label: this.instance.label, remote: true } };
  }
}

