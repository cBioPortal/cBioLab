import { directConnections, withoutFailedQueries } from "../../../lib/ch.ts";
import { studiesFor, type StudyRow } from "../../../lib/study-list.ts";
import { peerMcpEntries, peerPatientKinds, remoteStudies } from "../../../lib/federation-remote.ts";
import { instanceForStudy } from "../../../lib/federation.ts";
import type { StudyAccess } from "../../../lib/view-coverage.ts";
import { pack, throughCache, dataVersion, resultEntry } from "../../../lib/next-cache.ts";
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
  resultEntry();
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
    return Response.json({ studies: await withAccess(studies) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

/**
 * Each study's access (lib/view-coverage.ts), so the page offers only views it can draw. Read from
 * this deployment's settings on every request, outside the cache: a changed setting applies at once.
 */
async function withAccess(rows: StudyRow[]): Promise<(StudyRow & { access?: StudyAccess })[]> {
  return Promise.all(rows.map(async (row) => {
    if (row.instance === "peer")
      return { ...row, access: { instance: row.instanceLabel, patientLevel: false, remote: true, shares: [...peerPatientKinds(row.id)] } };
    try {
      const inst = await instanceForStudy(row.id);
      return { ...row, access: { instance: inst.label, patientLevel: inst.mode === "patient-level", remote: false, shares: [] } };
    } catch { return row; }   // not routed here (a collision's loser): access unknown, nothing held against it
  }));
}
