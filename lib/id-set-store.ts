// Stored id sets (db/migrations/0006_id_sets.sql): a cohort given as a list of sample or patient
// ids, kept on the server and named by documents by its id. The ONLY module that touches those
// tables.
//
// - Every read and write passes lib/access.ts's canRead / canShare: its owner, and its group or
//   everyone signed in as its sharing says. A principal is a signed-in user's id (lib/auth.ts).
// - A set's members never change once written (a trigger enforces it too), so a document naming a
//   set always means the same samples, and a request may keep a set it has read.
// - Members are stored as gzipped JSON ({study: [bare id, ...]}), matched against the studies'
//   own ids before they are stored (lib/id-sets-server.ts), so a set never names a case that is
//   not there.
// - Every read of members and every write is logged with its principal.
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";
import { groupsOf, readableWhere, canRead, canShare, rightsOf, sharingOf, validateSharing, type Rights, type Shareable, type Sharing } from "./access.ts";
import type { IdSetLevel, LoadedIdSet } from "./id-sets.ts";

/** how the list was matched when it was saved */
export interface IdSetSource { idsIn: number; unmatched: number; duplicates: number; multiStudy: number }

export interface IdSetMeta {
  id: string; name: string; owner: string; ownerEmail: string; level: IdSetLevel;
  studies: string[]; count: number; perStudy: Record<string, number>; sha256: string; source: IdSetSource;
  createdAt: string; updatedAt: string; deletedAt: string | null;
  sharing: Sharing & { groupName: string | null };
  /** what the asking user may do with it */
  rights: Rights;
}

interface SetRow extends Shareable {
  id: string; name: string; level: IdSetLevel; studies: string[]; id_count: number; per_study: Record<string, number>;
  sha256: string; source: IdSetSource; created_at: string; updated_at: string; deleted_at: string | null;
  owner_email: string; group_name: string | null;
}

/** The most ids one set holds: what one upload may hold (lib/custom-data-server.ts RESOLVE_LIMIT). */
export const ID_SET_MAX = 250_000;

const ROW = "select s.id, s.name, s.owner_id, s.level, s.studies, s.id_count, s.per_study, s.sha256, s.source, s.visibility, s.group_id," +
  " s.group_can_edit, s.created_at, s.updated_at, s.deleted_at, u.email as owner_email, g.name as group_name from id_set s" +
  " left join app_user u on u.id = s.owner_id left join user_group g on g.id = s.group_id";

/** Postgres hands back timestamps as Date; the API speaks ISO text. */
const iso = (x: unknown): string => x instanceof Date ? x.toISOString() : String(x);

const metaOf = (r: SetRow, principal: string, groups: Set<string>): IdSetMeta => ({
  id: r.id, name: r.name, owner: r.owner_id ?? "", ownerEmail: r.owner_email ?? "", level: r.level,
  studies: r.studies, count: r.id_count, perStudy: r.per_study, sha256: r.sha256, source: r.source,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deletedAt: r.deleted_at ? iso(r.deleted_at) : null,
  sharing: { ...sharingOf(r), groupName: r.group_name }, rights: rightsOf(principal, r, groups)
});

const log = (principal: string, action: "read" | "create" | "delete", id: string) =>
  dbQuery("insert into id_set_access_log (principal, action, set_id) values ($1, $2, $3)", [principal, action, id]);

const one = async (id: string): Promise<SetRow | null> =>
  /^[0-9a-f-]{36}$/.test(id) ? (await dbQuery<SetRow>(ROW + " where s.id = $1", [id]))[0] ?? null : null;

async function readable(principal: string, id: string): Promise<{ r: SetRow; groups: Set<string> }> {
  const r = await one(id);
  const groups = await groupsOf(principal);
  if (!r || !canRead(principal, r, groups)) throw new AccessError("no stored id set " + id + " that you may read", 404);
  return { r, groups };
}

/** Every live set this principal may read, newest first, without members. */
export async function listIdSets(principal: string): Promise<IdSetMeta[]> {
  const [rows, groups] = await Promise.all([
    dbQuery<SetRow>(ROW + " where s.deleted_at is null and " + readableWhere("s", 1) + " order by s.created_at desc limit 1000", [principal]),
    groupsOf(principal)]);
  return rows.map((r) => metaOf(r, principal, groups));
}

/** One set's description, without members. A deleted one is described too, saying when it went. */
export async function getIdSet(principal: string, id: string): Promise<IdSetMeta> {
  const { r, groups } = await readable(principal, id);
  return metaOf(r, principal, groups);
}

/** One set's members, per study. Refuses a deleted set; logged. */
export async function readIdSet(principal: string, id: string): Promise<{ meta: IdSetMeta; perStudy: Record<string, string[]> }> {
  const { r, groups } = await readable(principal, id);
  if (r.deleted_at) throw new AccessError("stored id set “" + r.name + "” was deleted on " + iso(r.deleted_at).slice(0, 10), 410);
  const [{ ids_gz }] = await dbQuery<{ ids_gz: Buffer }>("select ids_gz from id_set where id = $1", [r.id]);
  await log(principal, "read", r.id);
  return { meta: metaOf(r, principal, groups), perStudy: JSON.parse(gunzipSync(Buffer.from(ids_gz)).toString("utf8")) };
}

/**
 * Save a set: members already matched to the studies' own ids (lib/id-sets-server.ts), as bare
 * ids per study. Empty studies are dropped; a set with no members at all is refused.
 */
export async function saveIdSet(principal: string, input: { name: string; level: IdSetLevel; perStudy: Record<string, string[]>; source: IdSetSource }): Promise<IdSetMeta> {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("a stored id set needs a name");
  if (input.level !== "patient" && input.level !== "sample") throw new Error("level must be 'patient' or 'sample'");
  const perStudy: Record<string, string[]> = {};
  for (const study of Object.keys(input.perStudy).sort()) {
    const ids = [...new Set(input.perStudy[study].map(String))].sort();
    if (ids.length) perStudy[study] = ids;
  }
  const studies = Object.keys(perStudy);
  const count = studies.reduce((n, s) => n + perStudy[s].length, 0);
  if (!count) throw new Error("none of the ids matched a " + input.level + " of the studies given; nothing to save");
  if (count > ID_SET_MAX) throw new Error("a stored id set holds at most " + ID_SET_MAX.toLocaleString("en-US") + " ids; this one has " + count.toLocaleString("en-US"));
  const json = JSON.stringify(perStudy);
  const id = randomUUID();
  await dbQuery(
    "insert into id_set (id, name, owner_id, level, studies, id_count, per_study, ids_gz, sha256, source)" +
    " values ($1::uuid, $2, $3::uuid, $4, $5::text[], $6::int, $7::jsonb, $8::bytea, $9, $10::jsonb)",
    [id, name, principal, input.level, studies, count, JSON.stringify(Object.fromEntries(studies.map((s) => [s, perStudy[s].length]))),
      gzipSync(json, { level: 6 }), createHash("sha256").update(json).digest("hex"), JSON.stringify(input.source)]);
  await log(principal, "create", id);
  return metaOf((await one(id))!, principal, await groupsOf(principal));
}

/** Delete (its owner only): a document naming it is refused from then on, saying so. */
export async function deleteIdSet(principal: string, id: string): Promise<void> {
  const { r } = await readable(principal, id);
  if (!canShare(principal, r)) throw new AccessError("only its owner can delete “" + r.name + "”", 403);
  await dbQuery("update id_set set deleted_at = now() where id = $1 and deleted_at is null", [r.id]);
  forget(r.id);
  await log(principal, "delete", r.id);
}

/** Change how a set is shared (its owner only). It holds patient-level ids: never shared but by this. */
export async function shareIdSet(principal: string, id: string, sharing: unknown): Promise<IdSetMeta> {
  const { r, groups } = await readable(principal, id);
  if (!canShare(principal, r)) throw new AccessError("only its owner can change who “" + r.name + "” is shared with", 403);
  if (r.deleted_at) throw new AccessError("stored id set “" + r.name + "” was deleted", 410);
  const s = validateSharing(sharing, groups);
  await dbQuery("update id_set set visibility = $2, group_id = $3, group_can_edit = $4 where id = $1", [r.id, s.visibility, s.groupId, s.groupCanEdit]);
  forget(r.id);
  return metaOf((await one(r.id))!, principal, groups);
}

/** The sets an analysis names that some of its audience could not read (lib/artifacts.ts). */
export async function idSetSharingGaps(ids: string[]): Promise<(Shareable & { id: string; name: string; group_name: string | null })[]> {
  return ids.length ? dbQuery("select s.id, s.name, s.owner_id, s.visibility, s.group_id, s.group_can_edit, g.name as group_name" +
    " from id_set s left join user_group g on g.id = s.group_id where s.id = any($1::uuid[])", [ids]) : [];
}

// ---------------------------------------------------------------------------
// Per-request loading, for the request boundary (lib/id-sets-server.ts)
// ---------------------------------------------------------------------------

/** Members never change, so a set can be kept once read; bounded by count. */
const CACHE_MAX = 16;
const cache = new Map<string, LoadedIdSet>();
/** An access decision is re-checked at most this often per principal and set. */
const ACCESS_TTL_MS = 60_000;
const accessSeen = new Map<string, number>();

/** Drop what this process remembers of a set, so its next read checks access again: on delete and on a sharing change. */
function forget(id: string): void {
  cache.delete(id);
  for (const k of accessSeen.keys()) if (k.endsWith("\t" + id)) accessSeen.delete(k);
}

/**
 * A set's members for one engine request. Access is re-checked, and the read logged, at most once
 * a minute per principal and set; the members come from memory once read, which is safe only
 * because they never change. Deleting or re-sharing a set forgets it at once in this process;
 * another replica sees the change within that minute.
 */
export async function loadIdSetForRequest(principal: string, id: string): Promise<LoadedIdSet> {
  const who = principal + "\t" + id, now = Date.now();
  const hit = cache.get(id);
  if (hit && (accessSeen.get(who) ?? 0) > now - ACCESS_TTL_MS) return hit;
  const r = await readIdSet(principal, id);   // checks access, refuses a deleted set, logs
  accessSeen.set(who, now);
  const entry: LoadedIdSet = hit ?? { id: r.meta.id, name: r.meta.name, level: r.meta.level, count: r.meta.count, perStudy: r.perStudy };
  cache.delete(id); cache.set(id, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return entry;
}
