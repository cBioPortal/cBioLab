// Stored id sets (db/migrations/0006_id_sets.sql): a cohort given as a list of sample or patient
// ids, kept on the server and named by documents by its id. The ONLY module that touches those
// tables.
//
// - A set is READ by its id: anyone holding a document or link that names it may read its members,
//   signed in or not, as they may read the link itself (docs/LINKS.md). Sharing (lib/access.ts)
//   decides only whose saved-work list it appears in.
// - Only its OWNER manages it: renames, shares, withdraws and restores it (canShare). A principal is
//   a signed-in user's id (lib/auth.ts); null is a reader who is not signed in.
// - Withdrawing (db/migrations/0011) keeps the row and its members: a document naming the set is
//   refused with who withdrew it, when, why, and the set its owner points to instead. It is one
//   set's: another set holding the same ids is another row and stays readable.
// - A set's members never change once written (a trigger enforces it too), so a document naming a
//   set always means the same samples, and a request may keep a set it has read.
// - Members are stored as gzipped JSON ({study: [bare id, ...]}), matched against the studies'
//   own ids before they are stored (lib/id-sets-server.ts), so a set never names a case that is
//   not there.
// - Every read of members and every write is logged with its principal ("anonymous" when none).
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";
import { groupsOf, readableWhere, canShare, rightsOf, sharingOf, validateSharing, type Rights, type Shareable, type Sharing } from "./access.ts";
import { linksNaming } from "./link-store.ts";
import { ID_SET_UUID, type IdSetLevel, type LoadedIdSet } from "./id-sets.ts";
import { withdrawalNote, withdrawnMessage, type IdSetWithdrawal } from "./id-set-withdrawal.ts";

/** how the list was matched when it was saved; for a lock's set, which cohort it froze and when */
export interface IdSetSource {
  idsIn: number; unmatched: number; duplicates: number; multiStudy: number;
  lockOf?: { cohort: string; at: string; dataVersion?: string; oncokbPin?: string | null };
}

export interface IdSetMeta {
  id: string; name: string; owner: string; ownerEmail: string; level: IdSetLevel;
  /** "list": ids someone gave; "lock": what a cohort selected when locked, with its other parts */
  kind: "list" | "lock";
  /** a lock's other lists and their sizes: "samples", "arm:<split> / <arm>" */
  parts: Record<string, number> | null;
  studies: string[]; count: number; perStudy: Record<string, number>; sha256: string; source: IdSetSource;
  createdAt: string; updatedAt: string;
  /** when its owner withdrew it; null while it is in use */
  deletedAt: string | null;
  /** who withdrew it, when, why and what replaces it; null while it is in use */
  withdrawal: IdSetWithdrawal | null;
  sharing: Sharing & { groupName: string | null };
  /** what the asking user may do with it */
  rights: Rights;
}

interface SetRow extends Shareable {
  id: string; name: string; level: IdSetLevel; kind: "list" | "lock"; parts: Record<string, number> | null; studies: string[]; id_count: number; per_study: Record<string, number>;
  sha256: string; source: IdSetSource; created_at: string; updated_at: string; deleted_at: string | null;
  withdrawn_note: string | null; replaced_by: string | null; replaced_by_name: string | null;
  owner_email: string; group_name: string | null;
}

/** A document names a set its owner withdrew: the refusal carries the withdrawal for the page to show. */
export class WithdrawnIdSetError extends AccessError {
  readonly withdrawal: IdSetWithdrawal;
  constructor(w: IdSetWithdrawal) { super(withdrawnMessage(w), 410); this.withdrawal = w; }
}

/** The most ids one set holds: what one upload may hold (lib/custom-data-server.ts RESOLVE_LIMIT). */
export const ID_SET_MAX = 250_000;

const ROW = "select s.id, s.name, s.owner_id, s.level, s.kind, s.parts, s.studies, s.id_count, s.per_study, s.sha256, s.source, s.visibility, s.group_id," +
  " s.group_can_edit, s.created_at, s.updated_at, s.deleted_at, s.withdrawn_note, s.replaced_by, r.name as replaced_by_name," +
  " u.email as owner_email, g.name as group_name from id_set s" +
  " left join app_user u on u.id = s.owner_id left join user_group g on g.id = s.group_id left join id_set r on r.id = s.replaced_by";

/** Postgres hands back timestamps as Date; the API speaks ISO text. */
const iso = (x: unknown): string => x instanceof Date ? x.toISOString() : String(x);

const withdrawalOf = (r: SetRow): IdSetWithdrawal | null => r.deleted_at ? {
  set: r.id, name: r.name, by: r.owner_email ?? "", at: iso(r.deleted_at), note: r.withdrawn_note ?? null,
  replacedBy: r.replaced_by ? { id: r.replaced_by, name: r.replaced_by_name ?? r.replaced_by } : null,
} : null;

const metaOf = (r: SetRow, principal: string | null, groups: Set<string>): IdSetMeta => ({
  id: r.id, name: r.name, owner: r.owner_id ?? "", ownerEmail: r.owner_email ?? "", level: r.level, kind: r.kind ?? "list", parts: r.parts ?? null,
  studies: r.studies, count: r.id_count, perStudy: r.per_study, sha256: r.sha256, source: r.source,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deletedAt: r.deleted_at ? iso(r.deleted_at) : null, withdrawal: withdrawalOf(r),
  sharing: { ...sharingOf(r), groupName: r.group_name }, rights: principal ? rightsOf(principal, r, groups) : { edit: false, share: false }
});

type LogAction = "read" | "create" | "withdraw" | "restore";
const log = (principal: string | null, action: LogAction, id: string) =>
  dbQuery("insert into id_set_access_log (principal, action, set_id) values ($1, $2, $3)", [principal ?? "anonymous", action, id]);

const one = async (id: string): Promise<SetRow | null> =>
  ID_SET_UUID.test(id) ? (await dbQuery<SetRow>(ROW + " where s.id = $1", [id]))[0] ?? null : null;

/** The set by its id, for anyone: reading needs only the id. */
async function byId(principal: string | null, id: string): Promise<{ r: SetRow; groups: Set<string> }> {
  const r = await one(id);
  if (!r) throw new AccessError("no stored id set " + id, 404);
  return { r, groups: principal ? await groupsOf(principal) : new Set() };
}

/** The set, for its owner only: everything that changes it. */
async function owned(principal: string, id: string, what: string): Promise<{ r: SetRow; groups: Set<string> }> {
  const x = await byId(principal, id);
  if (!canShare(principal, x.r)) throw new AccessError("only its owner can " + what + " “" + x.r.name + "”", 403);
  return x;
}

/**
 * The sets in this principal's saved work — their own and those shared with them — newest first,
 * without members. Withdrawn sets are left out unless `withdrawn` (then only the principal's own:
 * the owner is the one who can restore them).
 */
export async function listIdSets(principal: string, opts: { withdrawn?: boolean } = {}): Promise<IdSetMeta[]> {
  const live = "(s.deleted_at is null" + (opts.withdrawn ? " or s.owner_id = $1::uuid" : "") + ")";
  const [rows, groups] = await Promise.all([
    dbQuery<SetRow>(ROW + " where " + live + " and " + readableWhere("s", 1) + " order by s.created_at desc limit 1000", [principal]),
    groupsOf(principal)]);
  return rows.map((r) => metaOf(r, principal, groups));
}

/** One set's description, without members, for anyone with its id. A withdrawn one is described too, with its withdrawal. */
export async function getIdSet(principal: string | null, id: string): Promise<IdSetMeta> {
  const { r, groups } = await byId(principal, id);
  return metaOf(r, principal, groups);
}

type PerStudy = Record<string, string[]>;
const unpack = <T,>(gz: Buffer | null): T | null => gz ? JSON.parse(gunzipSync(Buffer.from(gz)).toString("utf8")) : null;

/** One set's members, per study, and a lock's other parts, for anyone with its id. Refuses a withdrawn set, saying why; logged. */
export async function readIdSet(principal: string | null, id: string): Promise<{ meta: IdSetMeta; perStudy: PerStudy; parts: Record<string, PerStudy> | null }> {
  const { r, groups } = await byId(principal, id);
  const w = withdrawalOf(r);
  if (w) throw new WithdrawnIdSetError(w);
  const [{ ids_gz, parts_gz }] = await dbQuery<{ ids_gz: Buffer; parts_gz: Buffer | null }>("select ids_gz, parts_gz from id_set where id = $1", [r.id]);
  await log(principal, "read", r.id);
  return { meta: metaOf(r, principal, groups), perStudy: unpack<PerStudy>(ids_gz)!, parts: unpack<Record<string, PerStudy>>(parts_gz) };
}

/** Distinct, sorted ids per study, empty studies dropped. */
function tidy(m: PerStudy): PerStudy {
  const out: PerStudy = {};
  for (const study of Object.keys(m).sort()) {
    const ids = [...new Set(m[study].map(String))].sort();
    if (ids.length) out[study] = ids;
  }
  return out;
}
const sizeOf = (m: PerStudy) => Object.values(m).reduce((n, x) => n + x.length, 0);

/**
 * Save a set: members already matched to the studies' own ids (lib/id-set-import.ts), as bare
 * ids per study. Empty studies are dropped; a set with no members at all is refused unless
 * `allowEmpty` (a lock freezing a cohort or arm that held nobody).
 */
export async function saveIdSet(principal: string, input: { name: string; level: IdSetLevel; perStudy: Record<string, string[]>; source: IdSetSource;
  /** a lock's other lists, kept in the same row (db/migrations/0007) */
  parts?: Record<string, PerStudy> },
  opts: { allowEmpty?: boolean } = {}): Promise<IdSetMeta> {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("a stored id set needs a name");
  if (input.level !== "patient" && input.level !== "sample") throw new Error("level must be 'patient' or 'sample'");
  const perStudy = tidy(input.perStudy);
  const studies = Object.keys(perStudy);
  const count = sizeOf(perStudy);
  const parts = input.parts ? Object.fromEntries(Object.entries(input.parts).map(([k, m]) => [k, tidy(m)])) : null;
  // a pasted list that matched nothing is a mistake; a locked arm that held nobody is a fact (lib/cohort-lock-server.ts)
  if (!count && !opts.allowEmpty) throw new Error("none of the ids matched a " + input.level + " of the studies given; nothing to save");
  if (count > ID_SET_MAX) throw new Error("a stored id set holds at most " + ID_SET_MAX.toLocaleString("en-US") + " ids; this one has " + count.toLocaleString("en-US"));
  const json = JSON.stringify(perStudy);
  const id = randomUUID();
  const partsJson = parts ? JSON.stringify(parts) : null;
  await dbQuery(
    "insert into id_set (id, name, owner_id, level, studies, id_count, per_study, ids_gz, sha256, source, kind, parts, parts_gz)" +
    " values ($1::uuid, $2, $3::uuid, $4, $5::text[], $6::int, $7::jsonb, $8::bytea, $9, $10::jsonb, $11, $12::jsonb, $13::bytea)",
    [id, name, principal, input.level, studies, count, JSON.stringify(Object.fromEntries(studies.map((s) => [s, perStudy[s].length]))),
      gzipSync(json, { level: 6 }), createHash("sha256").update(json + (partsJson ?? "")).digest("hex"), JSON.stringify(input.source),
      parts ? "lock" : "list", parts ? JSON.stringify(Object.fromEntries(Object.entries(parts).map(([k, m]) => [k, sizeOf(m)]))) : null,
      partsJson ? gzipSync(partsJson, { level: 6 }) : null]);
  await log(principal, "create", id);
  return metaOf((await one(id))!, principal, await groupsOf(principal));
}

/**
 * Withdraw a set (its owner only): every document naming it is refused from then on, with who
 * withdrew it, when, `note`, and `replacedBy` — a set readers should use instead, which must exist
 * and not be withdrawn itself. Withdrawing again replaces the note and the replacement.
 */
export async function withdrawIdSet(principal: string, id: string, opts: { note?: unknown; replacedBy?: unknown } = {}): Promise<IdSetMeta> {
  const { r, groups } = await owned(principal, id, "withdraw");
  const note = withdrawalNote(opts.note);
  let replacedBy: string | null = null;
  if (opts.replacedBy != null && opts.replacedBy !== "") {
    if (typeof opts.replacedBy !== "string" || !ID_SET_UUID.test(opts.replacedBy)) throw new Error("replacedBy must be a stored id set's id (a uuid)");
    if (opts.replacedBy === r.id) throw new Error("a set cannot replace itself");
    const next = await one(opts.replacedBy);
    if (!next) throw new AccessError("no stored id set " + opts.replacedBy + " to point readers to", 404);
    if (next.deleted_at) throw new Error("“" + next.name + "” is withdrawn too: point readers to a set in use");
    replacedBy = next.id;
  }
  await dbQuery("update id_set set deleted_at = coalesce(deleted_at, now()), withdrawn_note = $2, replaced_by = $3 where id = $1", [r.id, note, replacedBy]);
  forget(r.id);
  await log(principal, "withdraw", r.id);
  return metaOf((await one(r.id))!, principal, groups);
}

/** Put a withdrawn set back in use (its owner only): documents naming it read it again. */
export async function restoreIdSet(principal: string, id: string): Promise<IdSetMeta> {
  const { r, groups } = await owned(principal, id, "restore");
  await dbQuery("update id_set set deleted_at = null, withdrawn_note = null, replaced_by = null where id = $1", [r.id]);
  forget(r.id);
  await log(principal, "restore", r.id);
  return metaOf((await one(r.id))!, principal, groups);
}

/**
 * How much of what is stored names this set (its owner only), for the owner to see before
 * withdrawing it: saved cohorts and analyses — everyone's, counted, never listed — and stored links.
 */
export async function idSetUsage(principal: string, id: string): Promise<{ cohorts: number; analyses: number; links: number }> {
  const { r } = await owned(principal, id, "see what uses");
  const [counts, links] = await Promise.all([
    dbQuery<{ kind: string; n: string | number }>(
      "select kind, count(*) as n from saved_artifacts where position($1 in definition::text) > 0 group by kind", [r.id]),
    linksNaming(r.id)]);
  const n = (k: string) => Number(counts.find((c) => c.kind === k)?.n ?? 0);
  return { cohorts: n("cohort"), analyses: n("workspace"), links };
}

/** Change whose saved-work list a set appears in (its owner only). Reading it needs only its id. */
export async function shareIdSet(principal: string, id: string, sharing: unknown): Promise<IdSetMeta> {
  const { r, groups } = await owned(principal, id, "change who sees");
  if (r.deleted_at) throw new AccessError("stored id set “" + r.name + "” is withdrawn: restore it first", 410);
  const s = validateSharing(sharing, groups);
  await dbQuery("update id_set set visibility = $2, group_id = $3, group_can_edit = $4 where id = $1", [r.id, s.visibility, s.groupId, s.groupCanEdit]);
  forget(r.id);
  return metaOf((await one(r.id))!, principal, groups);
}


// ---------------------------------------------------------------------------
// Per-request loading, for the request boundary (lib/id-sets-server.ts)
// ---------------------------------------------------------------------------

/** Members never change, so a set can be kept once read; bounded by count. */
const CACHE_MAX = 16;
const cache = new Map<string, LoadedIdSet>();
/** Whether a set is still in use is re-checked, and its read logged, at most this often per principal and set. */
const ACCESS_TTL_MS = 60_000;
const accessSeen = new Map<string, number>();

/** Drop what this process remembers of a set, so its next read sees it as it now is: on withdrawal, restoration and a sharing change. */
function forget(id: string): void {
  cache.delete(id);
  for (const k of accessSeen.keys()) if (k.endsWith("\t" + id)) accessSeen.delete(k);
}

/**
 * A set's members for one engine request, for anyone with its id (`principal` null when not signed
 * in). Whether it is still in use is re-checked, and the read logged, at most once a minute per
 * principal and set; the members come from memory once read, which is safe only because they never
 * change. Withdrawing a set forgets it at once in this process; another replica sees the change
 * within that minute.
 */
export async function loadIdSetForRequest(principal: string | null, id: string): Promise<LoadedIdSet> {
  const who = (principal ?? "anonymous") + "\t" + id, now = Date.now();
  const hit = cache.get(id);
  if (hit && (accessSeen.get(who) ?? 0) > now - ACCESS_TTL_MS) return hit;
  const r = await readIdSet(principal, id);   // refuses a withdrawn set, logs
  accessSeen.set(who, now);
  const entry: LoadedIdSet = hit ?? { id: r.meta.id, name: r.meta.name, level: r.meta.level, count: r.meta.count, perStudy: r.perStudy,
    ...(r.parts ? { parts: r.parts } : {}) };
  cache.delete(id); cache.set(id, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return entry;
}
