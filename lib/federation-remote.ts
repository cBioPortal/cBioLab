// Document-level federation: a peer Cohort Lab reached over MCP.
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
import type { AggregateCapable, GeneCounts, Instance, SurvivalCount, PairCounts, AttrStats, PairMoments, VariantReport, ProfileMoments, QueryLogEntry, SurvivalAnchor, TimelineSpan, CourseCount, CourseOpts, SequenceOpts, SequenceFlow, PlotData, PlotRequest } from "./federation.ts";
import { carriesPatientIds } from "./federation.ts";

interface RemoteAggregates {
  study: string; instance: string; count: number;
  geneCounts: GeneCounts[]; survivalCounts: SurvivalCount[]; survivalEndpoints?: string[] | null; pairCounts: PairCounts[]; attributeStats: AttrStats[]; pairMoments: PairMoments[]; variantCounts: VariantReport; profileMoments: ProfileMoments[];
  timelineSpan?: TimelineSpan[] | null; eventCourse?: CourseCount[] | null;
  treatmentSequence?: SequenceFlow[] | null;
  sequenceKeys?: { key: string; label: string; patients: number; values: number }[] | null;
  /** the SQL the peer compiled and ran, when it chooses to disclose it */
  cohortSql?: string | null;
  /** and the aggregate queries it ran to answer this call */
  queries?: QueryLogEntry[] | null;
  oncokbPin: string | null;
}

/** Peer registry: STUDY=URL pairs, e.g. "genie_public=http://127.0.0.1:3103/api/mcp". */
export function peerForStudy(study: string): { url: string; label: string } | null {
  const raw = process.env.PEER_MCP || "";
  for (const entry of raw.split(/[,\s]+/).filter(Boolean)) {
    const i = entry.indexOf("=");
    if (i < 0) continue;
    if (entry.slice(0, i).trim() === study) {
      const url = entry.slice(i + 1).trim();
      return { url, label: process.env.PEER_LABEL || "peer via MCP" };
    }
  }
  return null;
}

/**
 * Minimal MCP streamable-HTTP client: initialize, then tools/call. Kept
 * dependency-free and stateless so a peer can be any conforming server.
 */
async function mcpCall<T = RemoteAggregates>(url: string, name: string, args: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
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
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cohort-lab-federation", version: "1.0.0" } }
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
    throw new Error("this draft contains an explicit patient list, which is not sent to remote peer " + label);
  const facets = await mcpCall<ExploreResult>(url, "federated_facets", { study, draft: draft || null, geneSearch });
  // stamp provenance so the UI can badge peer-held rows
  return {
    ...facets,
    studyBreakdown: (facets.studyBreakdown || []).map((r) => ({ ...r, instance: "peer", instanceLabel: label }))
  };
}

export class RemoteAggregateResolver implements AggregateCapable {
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
  constructor(study: string, url: string, instance: Instance) {
    this.study = study;
    this.url = url;
    this.instance = instance;
  }
  private remember(r: { cohortSql?: string | null; queries?: QueryLogEntry[] | null }): void {
    if (!r) return;
    if (typeof r.cohortSql === "string" && r.cohortSql.trim()) this.peerSql = r.cohortSql;
    if (Array.isArray(r.queries))
      for (const q of r.queries) this.queries.push({ label: q.label, sql: q.sql, ms: q.ms, remote: true });
  }
  /** The peer compiles and runs its own SQL against its own schema. */
  cohortSql(): string {
    const head = "-- evaluated remotely by " + this.instance.label + " (" + this.url + ")\n";
    return this.peerSql
      ? head + "-- compiled and run BY THE PEER, against its own schema; only counts came back\n" + this.peerSql
      : head + "-- this instance receives aggregates only; the peer did not disclose its SQL";
  }
  /** nothing carrying identifiers is allowed to leave for a remote peer */
  private guard(def: CohortDef | null | undefined): void {
    if (carriesPatientIds(def))
      throw new Error("this cohort contains an explicit patient list, which is not sent to remote peer " + this.instance.label);
  }
  async count(def: CohortDef | null | undefined): Promise<number> {
    this.guard(def);
    const r = await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {} });
    this.remember(r);
    return r.count;
  }
  async geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]> {
    this.guard(def);
    if (!genes.length) return [];
    const r = await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, genes });
    this.remember(r);
    return r.geneCounts;
  }
  async survivalCounts(def: CohortDef | null | undefined, endpoint = "OS", anchor?: SurvivalAnchor | null): Promise<SurvivalCount[]> {
    this.guard(def);
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, survival: true, endpoint, ...(anchor ? { anchor } : {}) });
    this.remember(r);
    return r.survivalCounts;
  }
  async survivalEndpoints(): Promise<string[]> {
    // the peer reports what IT can answer; asking costs one call with no cohort
    const r = await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: {}, survivalEndpoints: true })
      .catch(() => ({ survivalEndpoints: [] as string[] }));
    return (r as { survivalEndpoints?: string[] }).survivalEndpoints || [];
  }
  async timelineSpan(def: CohortDef | null | undefined): Promise<TimelineSpan[]> {
    this.guard(def);
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, timelineSpan: true });
    this.remember(r);
    return r.timelineSpan || [];
  }
  async treatmentSequence(def: CohortDef | null | undefined, opts: SequenceOpts): Promise<SequenceFlow[]> {
    this.guard(def);
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, sequence: opts });
    this.remember(r);
    return r.treatmentSequence || [];
  }
  async sequenceKeys(def: CohortDef | null | undefined, eventType: string): Promise<{ key: string; label: string; patients: number; values: number }[]> {
    this.guard(def);
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, sequenceKeys: eventType });
    this.remember(r);
    return r.sequenceKeys || [];
  }
  async eventCourse(def: CohortDef | null | undefined, opts: CourseOpts): Promise<CourseCount[]> {
    this.guard(def);
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, course: opts });
    this.remember(r);
    return r.eventCourse || [];
  }
  /**
   * Plots are not federated yet. A peer's bins would be counted on its own scale, and pooling
   * them with ours would draw a picture of neither cohort — so this refuses rather than
   * returning something that looks like an answer.
   */
  async plot(def: CohortDef | null | undefined, _spec: PlotRequest): Promise<PlotData> {
    this.guard(def);
    throw new Error("the peer serving " + this.study + " does not answer plots yet: bins from two sites are counted " +
      "on two scales, and pooling them needs a shared one");
  }

  async pairCounts(def: CohortDef | null | undefined, pairs: [string, string][]): Promise<PairCounts[]> {
    this.guard(def);
    if (!pairs.length) return [];
    const r = await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, pairs });
    this.remember(r);
    return r.pairCounts || [];
  }
  async attributeStats(def: CohortDef | null | undefined, attributes: string[]): Promise<AttrStats[]> {
    this.guard(def);
    if (!attributes.length) return [];
    const r = await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, attributes });
    this.remember(r);
    return r.attributeStats || [];
  }
  async profileMoments(def: CohortDef | null | undefined, genes: string[], profileType: string): Promise<ProfileMoments[]> {
    this.guard(def);
    if (!genes.length || !profileType) return [];
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, momentGenes: genes, profileType });
    this.remember(r);
    return r.profileMoments || [];
  }
  async variantCounts(def: CohortDef | null | undefined, genes: string[], minCount = 1): Promise<VariantReport> {
    this.guard(def);
    if (!genes.length) return { variants: [], totals: [], minCount };
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, variantGenes: genes, minCount });
    this.remember(r);
    return r.variantCounts || { variants: [], totals: [], minCount };
  }
  async pairMoments(def: CohortDef | null | undefined, pairs: [string, string][], profileType: string): Promise<PairMoments[]> {
    this.guard(def);
    if (!pairs.length || !profileType) return [];
    const r = await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, pairs, profileType });
    this.remember(r);
    return r.pairMoments || [];
  }
}
