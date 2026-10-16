import { STUDY, withoutFailedQueries } from "../../../lib/ch";
import { studyRouting, restrictedStudies } from "../../../lib/federation";
import { catalogFor } from "../../../lib/study-catalog.ts";
import { peerForStudy, remoteCatalog } from "../../../lib/federation-remote.ts";
import { cacheLife } from "next/cache";
import { pack, throughCache, dataVersion } from "../../../lib/next-cache.ts";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const study = (url.searchParams.get("study") || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
    // A study PEER_MCP routes to a peer is described by that peer, over MCP: its database is
    // not this instance's to read.
    const peer = await peerForStudy(study);
    if (peer) return Response.json(await throughCache(async () => peerCatalogEntry(study, peer.url, await dataVersion()), () => remoteCatalog(study, peer.url)));
    // A study lives on whichever instance holds it (AACR GENIE is not on the primary), so ask
    // the same routing the analysis engine uses rather than assuming the default database.
    // A study the routing withholds by policy is unreachable here too, not served from PRIMARY.
    // Checked before the cache: a refusal is an answer to give, not one to keep.
    if (!(await studyRouting()).has(study)) return Response.json({ error: restrictedStudies.has(study)
      ? "Study '" + study + "' is restricted and not available here" : "Study '" + study + "' not found" }, { status: 400 });
    return Response.json(await throughCache(async () => catalogEntry(study, await dataVersion()), () => catalogFor(study)));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

async function catalogEntry(study: string, _version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await withoutFailedQueries(() => catalogFor(study)));
}

async function peerCatalogEntry(study: string, url: string, _version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await withoutFailedQueries(() => remoteCatalog(study, url)));
}
