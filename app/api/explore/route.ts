import { buildExplore, buildExploreFederated } from "../../../lib/explore.ts";
import { studyRouting, carriesPatientIds, instanceForStudy } from "../../../lib/federation.ts";
import { peerForStudy, remoteFacets } from "../../../lib/federation-remote.ts";
import { mergeExplore } from "../../../lib/explore.ts";
import { PRIMARY, withChContext, ensureChContext } from "../../../lib/ch.ts";
import { cacheLife } from "next/cache";
import { pack, throughCache, dataVersion } from "../../../lib/next-cache.ts";
import { studyProfiles, resolveStudy } from "../../../lib/analysis.ts";
import { chQuery } from "../../../lib/ch.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { assertCustomDataPresent } from "../../../lib/custom-data.ts";

export const maxDuration = 60;

async function oncokbPin() {
  try {
    const r = await chQuery("SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

export async function POST(req: Request) {
  // Every query this request issues runs inside the reader's connection: when they supersede
  // it by ticking another facet, the queries it still owes are abandoned instead of run to
  // completion for an answer nobody will read. See withChContext in lib/ch.ts.
  return withChContext({ signal: req.signal }, () => handle(req));
}


async function handle(req: Request) {
  try {
    const { customData, customRefs, ...body } = await req.json();
    // facets over uploaded data are the uploader's alone: answered directly, never cached
    if ((Array.isArray(customData) && customData.length) || (Array.isArray(customRefs) && customRefs.length))
      return Response.json(await withRequestCustomData(customData, () => ensureChContext(() => exploreFor(body)), { refs: customRefs, req }));
    return Response.json(await throughCache(async () => exploreEntry(body, await dataVersion()), () => ensureChContext(() => exploreFor(body))));
  } catch (e) {
    // The reader superseded this request: not a failure, and there is nobody left to tell.
    if ((e as { name?: string })?.name === "AbortError" || req.signal.aborted)
      return new Response(null, { status: 499 });
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}


async function exploreEntry(body: any, _version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await ensureChContext(() => exploreFor(body)));
}


async function exploreFor(body: any) {
  const requested = Array.isArray(body.studies) && body.studies.length
    ? body.studies : [body.study];
  const studies = [];
  for (const s of requested) studies.push(await resolveStudy(s));
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const profilesByStudy = new Map();
  for (const s of studies) profilesByStudy.set(s, await studyProfiles(s));
  const routing = await studyRouting();
  // Studies held by a remote peer are faceted over MCP; the rest locally.
  const remote = studies.filter((s) => !!peerForStudy(s));
  const local = studies.filter((s) => !remote.includes(s));
  const unreachable = local.filter((s) => !routing.has(s));
  if (unreachable.length)
    throw new Error("Explore cannot reach " + unreachable.join(", ") +
      " — no local connection and no MCP peer configured for it. Deselect it to continue.");
  const connByStudy = new Map(studies.map((s) => [s, routing.get(s) || PRIMARY]));
  // An explicit patient list must not be compiled into SQL for an instance that
  // is not entitled to patient-level data — the ids would cross the boundary
  // inside the query text (and, being study-scoped, could never match there).
  if (carriesPatientIds(body.draft)) {
    for (const s of studies) {
      if (remote.includes(s))
        throw new Error("this draft contains an explicit patient list, which cannot be sent to the remote peer holding " + s + "; remove that clause or deselect it");
      const inst = await instanceForStudy(s);
      if (inst.mode !== "patient-level")
        throw new Error("this draft contains an explicit patient list, which cannot be sent to " + inst.label + "; remove that clause or deselect " + s);
    }
  }
  const draft = body.draft || null;
  assertCustomDataPresent(draft);
  const geneSearch = typeof body.geneSearch === "string" ? body.geneSearch.slice(0, 40) : undefined;
  // Optional attribute allow-list — see buildExplore. Omitted means everything.
  const attributes = Array.isArray(body.attributes) ? body.attributes.map(String).slice(0, 60) : undefined;
  // genes the reader has asked to chart as their own alteration facet
  const geneCharts = Array.isArray(body.geneCharts) ? body.geneCharts.map(String).slice(0, 6) : undefined;
  // Derived facets beyond the fixed three (Explore's "show more derivations"
  // popup) — local studies only for now: a remote peer answers over its own
  // MCP tool, which does not yet accept this request, so it simply
  // contributes none of these facets rather than erroring (mergeExplore).
  const extraDerived = Array.isArray(body.extraDerived) ? body.extraDerived
    .filter((x: unknown): x is { metric: string; eventType: string; lineGap?: number } => {
      const r = x as { metric?: unknown; eventType?: unknown };
      return !!r && (r.metric === "lines" || r.metric === "treatmentSpan") && typeof r.eventType === "string" && !!r.eventType.trim();
    })
    .slice(0, 4)
    .map((x: { metric: string; eventType: string; lineGap?: number }) => ({ metric: x.metric as "lines" | "treatmentSpan",
      eventType: x.eventType.slice(0, 200), ...(x.lineGap != null ? { lineGap: Number(x.lineGap) } : {}) }))
    : undefined;
  const remoteParts = await Promise.all(remote.map((s) => {
    const peer = peerForStudy(s)!;
    return remoteFacets(s, peer.url, draft, peer.label, geneSearch);
  }));
  if (!local.length) {
    return remoteParts.length === 1 ? remoteParts[0] : mergeExplore(remoteParts);
  }
  const localResult = local.length === 1
    ? await buildExplore({ study: local[0], draft, oncokbPin: pin, geneSearch, attributes, geneCharts, extraDerived,
        ...profilesByStudy.get(local[0]), conn: connByStudy.get(local[0]) })
    : await buildExploreFederated({ studies: local, draft, oncokbPin: pin, profilesByStudy, connByStudy, geneSearch, attributes, geneCharts, extraDerived });
  return remoteParts.length ? mergeExplore([localResult, ...remoteParts]) : localResult;
}
