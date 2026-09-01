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
import type { AggregateCapable, GeneCounts, Instance, SurvivalCount, PairCounts, AttrStats, PairMoments, VariantReport } from "./federation.ts";
import { carriesPatientIds } from "./federation.ts";

interface RemoteAggregates {
  study: string; instance: string; count: number;
  geneCounts: GeneCounts[]; survivalCounts: SurvivalCount[]; pairCounts: PairCounts[]; attributeStats: AttrStats[]; pairMoments: PairMoments[]; variantCounts: VariantReport;
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
  constructor(study: string, url: string, instance: Instance) {
    this.study = study;
    this.url = url;
    this.instance = instance;
  }
  /** The peer compiles and runs its own SQL; we never see it (or its data). */
  cohortSql(): string {
    return "-- evaluated remotely by " + this.instance.label + " (" + this.url + ")\n" +
      "-- this instance receives aggregates only; the peer's SQL and rows stay there";
  }
  /** nothing carrying identifiers is allowed to leave for a remote peer */
  private guard(def: CohortDef | null | undefined): void {
    if (carriesPatientIds(def))
      throw new Error("this cohort contains an explicit patient list, which is not sent to remote peer " + this.instance.label);
  }
  async count(def: CohortDef | null | undefined): Promise<number> {
    this.guard(def);
    return (await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {} })).count;
  }
  async geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]> {
    this.guard(def);
    if (!genes.length) return [];
    return (await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, genes })).geneCounts;
  }
  async survivalCounts(def: CohortDef | null | undefined): Promise<SurvivalCount[]> {
    this.guard(def);
    return (await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, survival: true })).survivalCounts;
  }
  async pairCounts(def: CohortDef | null | undefined, pairs: [string, string][]): Promise<PairCounts[]> {
    this.guard(def);
    if (!pairs.length) return [];
    return (await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, pairs })).pairCounts || [];
  }
  async attributeStats(def: CohortDef | null | undefined, attributes: string[]): Promise<AttrStats[]> {
    this.guard(def);
    if (!attributes.length) return [];
    return (await mcpCall(this.url, "federated_aggregates", { study: this.study, cohort: def || {}, attributes })).attributeStats || [];
  }
  async variantCounts(def: CohortDef | null | undefined, genes: string[], minCount = 1): Promise<VariantReport> {
    this.guard(def);
    if (!genes.length) return { variants: [], totals: [], minCount };
    return (await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, variantGenes: genes, minCount })).variantCounts
      || { variants: [], totals: [], minCount };
  }
  async pairMoments(def: CohortDef | null | undefined, pairs: [string, string][], profileType: string): Promise<PairMoments[]> {
    this.guard(def);
    if (!pairs.length || !profileType) return [];
    return (await mcpCall(this.url, "federated_aggregates",
      { study: this.study, cohort: def || {}, pairs, profileType })).pairMoments || [];
  }
}
