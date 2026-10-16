import { directConnections, withoutFailedQueries } from "../../../lib/ch.ts";
import { studiesFor, type StudyRow } from "../../../lib/study-list.ts";
import { peerMcpEntries, remoteStudies } from "../../../lib/federation-remote.ts";
import { cacheLife } from "next/cache";
import { pack, throughCache, dataVersion } from "../../../lib/next-cache.ts";
import { connection } from "next/server";

async function allStudies(): Promise<StudyRow[]> {
  let failed = 0;
  const [per, remote] = await Promise.all([
    Promise.all(directConnections().map((c) =>
      studiesFor(c).catch(() => { failed++; return [] as StudyRow[]; }))),   // one bad peer must not empty the catalog
    remoteStudies()]);
  failed += remote.failed.length;
  // a study PEER_MCP routes to a peer is the peer's, as it is for the analysis engine
  const peerHeld = peerMcpEntries();
  const seen = new Set<string>();
  const merged: StudyRow[] = [];
  for (const rows of [remote.rows, ...per]) for (const row of rows) {
    if (seen.has(row.id) || (row.instance !== "peer" && peerHeld.has(row.id))) continue;  // first instance wins a collision
    seen.add(row.id);
    merged.push(row);
  }
  merged.sort((a, b) => b.patients - a.patients);
  // ...but a catalog missing an instance is served, not kept for a day
  if (failed) throw new Partial(merged);
  return merged;
}
async function studiesEntry(_version: string): Promise<string> {
  "use cache: remote";
  cacheLife("days");
  return pack(await withoutFailedQueries(() => allStudies()));
}
/** what the reachable instances returned, when one of them did not answer */
class Partial extends Error { constructor(readonly rows: StudyRow[]) { super("an instance did not answer"); } }

export async function GET() {
  await connection();
  try {
    let studies: StudyRow[];
    try { studies = await throughCache(async () => studiesEntry(await dataVersion()), allStudies); }
    catch (e) { if (!(e instanceof Partial)) throw e; studies = e.rows; }
    return Response.json({ studies });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
