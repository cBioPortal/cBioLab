// Saved cohorts and workspaces: CRUD over the `saved_artifacts` table (see
// db/migrations/0001_saved_artifacts.sql). Definitions only — never a frozen
// evaluation or a patient/sample id; see lib/db.ts and RATIONALE.md.
//
// Every call is made as a principal — the signed-in user's id (lib/auth.ts). Who may see, change
// and share a row is lib/access.ts's to decide: its owner always; its group or everyone signed in
// as its sharing says. Something the principal may not see reads as absent; something they may
// see but not change is refused (403); a change made from a stale copy is refused (409). Rows
// saved before there were accounts have no owner and are seen by nobody until
// scripts/claim-legacy.ts gives them one.
//
// Schema-versioned like the DSL documents themselves: CURRENT_SCHEMA_VERSION
// is stamped on every write, and `migrate()` is the one place a stored
// definition is brought forward to the shape the rest of the app expects,
// mirroring how lib/params.ts's resolveParams() is the one boundary every
// document passes through before compilers see it. Today there is exactly one
// version, so migrate() is the identity function — but the column and the
// call site exist now, while adding them costs nothing, rather than being
// retrofitted under pressure the day the DSL makes a breaking change.
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";
import { groupsOf, readableWhere, canRead, canWrite, canShare, rightsOf, sharingOf, validateSharing, covers,
  type Rights, type Shareable, type Sharing, type Visibility } from "./access.ts";

export const CURRENT_SCHEMA_VERSION = 1;

export type ArtifactKind = "cohort" | "workspace";

export interface SavedArtifact {
  id: string;
  kind: ArtifactKind;
  name: string;
  schemaVersion: number;
  definition: unknown;
  createdAt: string;
  updatedAt: string;
  /** counts writes: an update naming an older one is refused */
  version: number;
  owner: { id: string; email: string; name: string | null };
  sharing: Sharing & { groupName: string | null };
  /** what the asking user may do with it */
  rights: Rights;
}

/** A custom dataset an analysis uses that some of the people it is shared with cannot read. */
export interface DatasetWarning { id: string; slug: string; name: string; visibility: Visibility; groupName: string | null; yours: boolean }

const KINDS: ArtifactKind[] = ["cohort", "workspace"];
export function isArtifactKind(k: unknown): k is ArtifactKind {
  return typeof k === "string" && (KINDS as string[]).includes(k);
}

/** Bring a stored definition forward to CURRENT_SCHEMA_VERSION. Identity for now. */
function migrate(kind: ArtifactKind, definition: unknown, fromVersion: number): unknown {
  if (fromVersion > CURRENT_SCHEMA_VERSION)
    throw new Error("saved " + kind + " is schema v" + fromVersion + ", newer than this server understands (v" + CURRENT_SCHEMA_VERSION + ")");
  return definition;
}

interface Row extends Shareable {
  id: string; kind: ArtifactKind; name: string; schema_version: number; definition: unknown; version: number;
  created_at: string | Date; updated_at: string | Date;
  owner_email: string; owner_name: string | null; group_name: string | null;
}

/** Postgres hands back timestamps as Date; the API speaks ISO text. */
const iso = (t: string | Date): string => new Date(t).toISOString();

function fromRow(r: Row, principal: string, groups: Set<string>): SavedArtifact {
  return {
    id: r.id, kind: r.kind, name: r.name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    definition: migrate(r.kind, r.definition, r.schema_version),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), version: r.version,
    owner: { id: r.owner_id!, email: r.owner_email, name: r.owner_name },
    sharing: { ...sharingOf(r), groupName: r.group_name },
    rights: rightsOf(principal, r, groups),
  };
}

function validateName(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) throw new Error("name is required");
  if (s.length > 200) throw new Error("name is too long (200 chars max)");
  return s;
}
function validateDefinition(d: unknown): unknown {
  if (!d || typeof d !== "object") throw new Error("definition must be an object");
  return d;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = "select a.*, u.email as owner_email, u.name as owner_name, g.name as group_name from saved_artifacts a" +
  " join app_user u on u.id = a.owner_id left join user_group g on g.id = a.group_id";

async function row(id: string): Promise<Row | null> {
  return UUID.test(id) ? (await dbQuery<Row>(SELECT + " where a.id = $1", [id]))[0] ?? null : null;
}

/** The row if this principal may read it (with their groups), else null: someone else's private row reads as absent. */
async function readable(principal: string, id: string): Promise<{ r: Row; groups: Set<string> } | null> {
  const r = await row(id);
  if (!r) return null;
  const groups = await groupsOf(principal);
  return canRead(principal, r, groups) ? { r, groups } : null;
}

/** Everything this principal may read: their own, their groups', and everyone's. Newest first. */
export async function listArtifacts(principal: string, kind?: ArtifactKind): Promise<SavedArtifact[]> {
  const groups = await groupsOf(principal);
  const rows = await dbQuery<Row>(SELECT + " where " + readableWhere("a", 1) + (kind ? " and a.kind = $2" : "") +
    " order by a.updated_at desc limit 1000", kind ? [principal, kind] : [principal]);
  return rows.map((r) => fromRow(r, principal, groups));
}

export async function getArtifact(principal: string, id: string): Promise<SavedArtifact | null> {
  const x = await readable(principal, id);
  return x ? fromRow(x.r, principal, x.groups) : null;
}

/** A new item, private to its creator. */
export async function createArtifact(principal: string, kind: ArtifactKind, name: unknown, definition: unknown): Promise<SavedArtifact> {
  if (!isArtifactKind(kind)) throw new Error("kind must be 'cohort' or 'workspace'");
  const [r] = await dbQuery<{ id: string }>(
    "insert into saved_artifacts (kind, name, schema_version, definition, owner_id) values ($1, $2, $3, $4, $5) returning id",
    [kind, validateName(name), CURRENT_SCHEMA_VERSION, JSON.stringify(validateDefinition(definition)), principal]);
  return (await getArtifact(principal, r.id))!;
}

/**
 * Rename and/or replace the definition (either may be omitted). `version`, when given, is the one
 * the change was made from: if someone has saved since, the change is refused, not merged.
 */
export async function updateArtifact(principal: string, id: string,
  patch: { name?: unknown; definition?: unknown; version?: unknown }): Promise<SavedArtifact | null> {
  const x = await readable(principal, id);
  if (!x) return null;
  const { r, groups } = x;
  if (!canWrite(principal, r, groups)) throw new AccessError("“" + r.name + "” is shared with you to read, not to change", 403);
  const name = patch.name === undefined ? r.name : validateName(patch.name);
  const definition = patch.definition === undefined ? r.definition : validateDefinition(patch.definition);
  const from = patch.version === undefined ? r.version : Number(patch.version);
  const done = await dbQuery<{ id: string }>(
    "update saved_artifacts set name = $2, schema_version = $3, definition = $4, version = version + 1" +
    " where id = $1 and version = $5 returning id", [id, name, CURRENT_SCHEMA_VERSION, JSON.stringify(definition), from]);
  if (!done.length) {
    const now = await row(id);
    throw new AccessError("“" + r.name + "” was changed" + (now ? " (now version " + now.version + ")" : "") +
      " since you opened it (version " + from + "); reload it before saving", 409);
  }
  return getArtifact(principal, id);
}

/**
 * Change how an item is shared (its owner only). For an analysis, also names the custom datasets
 * it uses that some of its new audience could not read — those are never shared automatically.
 */
export async function shareArtifact(principal: string, id: string, sharing: unknown): Promise<{ artifact: SavedArtifact; warnings: DatasetWarning[] } | null> {
  const x = await readable(principal, id);
  if (!x) return null;
  if (!canShare(principal, x.r)) throw new AccessError("only its owner can change who “" + x.r.name + "” is shared with", 403);
  const s = validateSharing(sharing, x.groups);
  await dbQuery("update saved_artifacts set visibility = $2, group_id = $3, group_can_edit = $4 where id = $1",
    [id, s.visibility, s.groupId, s.groupCanEdit]);
  const artifact = (await getArtifact(principal, id))!;
  return { artifact, warnings: await datasetWarnings(artifact) };
}

/** The datasets an analysis pins (`uploads`) that its audience could not all read. */
export async function datasetWarnings(a: SavedArtifact): Promise<DatasetWarning[]> {
  const pins = (a.definition as { uploads?: { dataset?: unknown }[] })?.uploads;
  const ids = [...new Set((Array.isArray(pins) ? pins : []).map((p) => p?.dataset).filter((d): d is string => typeof d === "string" && UUID.test(d)))];
  if (!ids.length || a.sharing.visibility === "private") return [];
  const ds = await dbQuery<Shareable & { id: string; slug: string; name: string; group_name: string | null }>(
    "select d.*, g.name as group_name from custom_dataset d left join user_group g on g.id = d.group_id where d.id = any($1::uuid[])", [ids]);
  return ds.filter((d) => !covers(sharingOf(d), a.sharing)).map((d) => ({
    id: d.id, slug: d.slug, name: d.name, visibility: d.visibility, groupName: d.group_name, yours: d.owner_id === a.owner.id,
  }));
}

/** Delete (its owner only). False when there is nothing this principal can see by that id. */
export async function deleteArtifact(principal: string, id: string): Promise<boolean> {
  const x = await readable(principal, id);
  if (!x) return false;
  if (!canShare(principal, x.r)) throw new AccessError("only its owner can delete “" + x.r.name + "”", 403);
  return (await dbQuery<{ id: string }>("delete from saved_artifacts where id = $1 returning id", [id])).length > 0;
}
