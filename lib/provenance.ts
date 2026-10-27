// Where an analysis's data came from. A peer says who it is in every federated answer (`source`:
// its own name, the commit it runs, and when the study it answered for was last imported there);
// the coordinator keeps the first such report per study (lib/federation-remote.ts) and lists every
// source of a run, local or remote, in the result's `sources` (lib/analysis.ts).
import { chQuery, isAbortError, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import { BUILD_INFO } from "./build-info.ts";
import { studyRouting, type Resolver } from "./federation.ts";
import { setting } from "./settings.ts";
import type { AnalysisSource, PeerSource } from "./types.ts";

const IMPORTED_TTL = 5 * 60_000;
const imported = new Map<string, { at: number; value: Promise<string | null> }>();

/** When `study`'s data was last imported into the database `conn` reaches, or null if it can't tell. */
export function studyImported(study: string, conn: ChConn): Promise<string | null> {
  const key = conn.id + "|" + conn.db + "|" + study;
  const hit = imported.get(key);
  if (hit && Date.now() - hit.at < IMPORTED_TTL) return hit.value;
  const value = chQuery<{ d: string }>("SELECT toString(max(import_date)) AS d FROM " + conn.db + ".cancer_study WHERE cancer_study_identifier = " + sq(study), conn)
    .then((r) => (r.data[0]?.d || "").replace(/\.0+$/, "") || null)
    .catch((e) => { if (isAbortError(e)) throw e; return null; });
  imported.set(key, { at: Date.now(), value });
  value.catch(() => { if (imported.get(key)?.value === value) imported.delete(key); });
  return value;
}

/** What this instance reports about itself when it answers as a peer, for `study` if one is named. */
export async function peerSource(study?: string): Promise<PeerSource> {
  const conn = study ? (await studyRouting()).get(study) : undefined;
  const base = { name: conn?.label || setting("CLICKHOUSE_LABEL") || "primary", build: BUILD_INFO.label };
  return conn && study ? { ...base, study, imported: await studyImported(study, conn) } : base;
}

/** A remote resolver's view of its peer: where it is, and what the peer reported. */
interface PeerProvenance { url: string; reported: PeerSource | null; answeredAt: string | null }
const peerProvenance = (r: Resolver): PeerProvenance | null =>
  typeof (r as unknown as { provenance?: unknown }).provenance === "function"
    ? (r as unknown as { provenance(): PeerProvenance }).provenance() : null;

/** The source a study's resolver stands for: one per database here, one per peer endpoint. */
export function sourceKey(r: Resolver): string {
  const peer = peerProvenance(r);
  return peer ? "peer " + peer.url : "local " + r.instance.id;
}

/** Each study's place in describeSources' list, for the views' participation records to point at. */
export function sourceIndex(studies: string[], resolvers: Record<string, Resolver>): Map<string, number> {
  const keys: string[] = [], out = new Map<string, number>();
  for (const study of studies) {
    const r = resolvers[study];
    if (!r) continue;
    const key = sourceKey(r);
    if (!keys.includes(key)) keys.push(key);
    out.set(study, keys.indexOf(key));
  }
  return out;
}

/** Every source of a run, in the order its studies first appear, each with the studies it answered for. */
export async function describeSources(studies: string[], resolvers: Record<string, Resolver>): Promise<AnalysisSource[]> {
  const out: AnalysisSource[] = [], byKey = new Map<string, AnalysisSource>();
  for (const study of studies) {
    const r = resolvers[study];
    if (!r) continue;
    const key = sourceKey(r), peer = peerProvenance(r);
    let src = byKey.get(key);
    if (!src) {
      // a peer's label also says what it shares; the participation records say that per view
      const label = r.instance.label.replace(/ \(shares [^)]*\)$/, "").replace(/ \(aggregate-only\)$/, "");
      src = peer
        ? { label, remote: true, url: peer.url, ...(peer.reported ? { reportedName: peer.reported.name, build: peer.reported.build } : {}),
            ...(peer.answeredAt ? { answeredAt: peer.answeredAt } : {}), studies: [] }
        : { label, remote: false, build: BUILD_INFO.label, studies: [] };
      byKey.set(key, src);
      out.push(src);
    }
    const when = peer ? (peer.reported?.study === study ? peer.reported.imported ?? null : null)
      : await studyImported(study, r.instance.conn);
    src.studies.push({ study, imported: when });
  }
  return out;
}
