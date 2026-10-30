import { parseBody, ExploreRequest } from "../../../lib/api-schemas.ts";
import { buildExplore, buildExploreFederated, buildAssayFacets } from "../../../lib/explore.ts";
import { ENTITY_RE } from "../../../lib/generic-assay.ts";
import { studyRouting, carriesPatientIds, instanceForStudy } from "../../../lib/federation.ts";
import { peerForStudy, remoteFacets } from "../../../lib/federation-remote.ts";
import { mergeExplore } from "../../../lib/explore.ts";
import { PRIMARY, withChContext, ensureChContext, withoutFailedQueries } from "../../../lib/ch.ts";
import { pack, throughCache, cacheVersion, resultEntry } from "../../../lib/next-cache.ts";
import { studyProfilesMany, resolveStudy } from "../../../lib/analysis.ts";
import { oncokbPin } from "../../../lib/annotation.ts";
import type { ProfileInfo } from "../../../lib/profile-catalog.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { assertCustomDataPresent } from "../../../lib/custom-data.ts";
import { idSetRefsIn } from "../../../lib/id-sets.ts";
import type { DerivedRequest } from "../../../lib/types.ts";

export const maxDuration = 60;

export async function POST(req: Request) {
  // Every query this request issues runs inside the reader's connection: when they supersede
  // it by ticking another facet, the queries it still owes are abandoned instead of run to
  // completion for an answer nobody will read. See withChContext in lib/ch.ts.
  return withChContext({ signal: req.signal }, () => handle(req));
}


async function handle(req: Request) {
  try {
    const { customData, customRefs, ...body } = parseBody(ExploreRequest, await req.json());
    // facets over uploaded data or a stored id set are their reader's alone: answered directly, never cached
    if ((Array.isArray(customData) && customData.length) || (Array.isArray(customRefs) && customRefs.length) || idSetRefsIn(body.draft).length)
      return Response.json(await withRequestCustomData(customData, () => ensureChContext(() => exploreFor(body)), { refs: customRefs, req, uses: body.draft }));
    return Response.json(await throughCache(async () => exploreEntry(body, await cacheVersion()), () => ensureChContext(() => exploreFor(body))));
  } catch (e) {
    // The reader superseded this request: not a failure, and there is nobody left to tell.
    if ((e as { name?: string })?.name === "AbortError" || req.signal.aborted)
      return new Response(null, { status: 499 });
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}


async function exploreEntry(body: any, _version: string): Promise<string> {
  "use cache: remote";
  resultEntry();
  return pack(await ensureChContext(() => withoutFailedQueries(() => exploreFor(body))));
}


async function exploreFor(body: any) {
  const requested = Array.isArray(body.studies) && body.studies.length
    ? body.studies : [body.study];
  const studies = await Promise.all(requested.map((s: string) => resolveStudy(s)));
  const pin = process.env.ONCOKB_PIN || await oncokbPin();
  const profilesByStudy = await studyProfilesMany(studies);
  const routing = await studyRouting();
  // Studies held by a remote peer are faceted through their federation API; the rest locally.
  const peers = new Map((await Promise.all(studies.map(async (s) => [s, await peerForStudy(s)] as const))).filter(([, p]) => p) as [string, { url: string; label: string }][]);
  const remote = studies.filter((s) => peers.has(s));
  const local = studies.filter((s) => !remote.includes(s));
  const unreachable = local.filter((s) => !routing.has(s));
  if (unreachable.length)
    throw new Error("Explore cannot reach " + unreachable.join(", ") +
      " — no local connection and no federation peer configured for it. Deselect it to continue.");
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
  // The derived facets to compute — none unless asked for. Local studies only for now: a remote
  // peer answers through its federation API, which does not accept this request, so it contributes none
  // of these facets rather than erroring (mergeExplore).
  const DERIVED = new Set(["followupMonths", "historyMonths", "alteredGenes", "lines", "treatmentSpan"]);
  const derived = Array.isArray(body.derived) ? body.derived
    .filter((x: unknown): x is DerivedRequest => {
      const r = x as { metric?: unknown; eventType?: unknown };
      if (!r || typeof r.metric !== "string" || !DERIVED.has(r.metric)) return false;
      // the two built on an event type need one
      return (r.metric !== "lines" && r.metric !== "treatmentSpan") || (typeof r.eventType === "string" && !!r.eventType.trim());
    })
    .slice(0, 8)
    .map((x: DerivedRequest) => ({ metric: x.metric, ...(x.eventType ? { eventType: String(x.eventType).slice(0, 200) } : {}),
      ...(x.lineGap != null ? { lineGap: Number(x.lineGap) } : {}) }))
    : undefined;
  const remoteParts = await Promise.all(remote.map((s) => {
    const peer = peers.get(s)!;
    return remoteFacets(s, peer.url, draft, peer.label, geneSearch);
  }));
  // every study's profiles as it describes them (a peer's from the peer), once per profile id, for a plot axis's Data picker
  const profileCatalog = [...new Map(studies.flatMap((st) => (profilesByStudy.get(st)?.catalog || []).map((p: ProfileInfo) => [p.profile, p] as const))).values()];
  if (!local.length) {
    return { ...(remoteParts.length === 1 ? remoteParts[0] : mergeExplore(remoteParts)), profileCatalog };
  }
  const { catalog: _c, ...oneProfiles } = profilesByStudy.get(local[0]) || {};
  const localResult = local.length === 1
    ? await buildExplore({ study: local[0], draft, oncokbPin: pin, geneSearch, attributes, geneCharts, derived,
        ...oneProfiles, conn: connByStudy.get(local[0]) })
    : await buildExploreFederated({ studies: local, draft, oncokbPin: pin, profilesByStudy, connByStudy, geneSearch, attributes, geneCharts, derived });
  const assayFacets = body.assayCharts && body.assayCharts.length
    ? await buildAssayFacets({ studies: local, draft, oncokbPin: pin, profilesByStudy, connByStudy,
        charts: body.assayCharts.filter((c: { profileType: string; entity: string }) => ENTITY_RE.test(c.entity)) })
    : undefined;
  const result = remoteParts.length ? mergeExplore([localResult, ...remoteParts]) : localResult;
  return { ...result, profileCatalog, ...(assayFacets ? { assayFacets } : {}) };
}
