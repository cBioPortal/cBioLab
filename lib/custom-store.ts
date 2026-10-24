// Server-stored custom data: uploads saved so an analysis that uses one can be shared and re-run
// (db/migrations/0003_custom_datasets.sql). The ONLY module that touches those tables.
//
// - Every read and write passes lib/access.ts's canRead / canWrite / canShare: its owner, and its
//   group or everyone signed in as its sharing says. A principal is a signed-in user's id
//   (lib/auth.ts); a dataset saved before there were accounts has no owner and is readable by
//   nobody until scripts/claim-legacy.ts gives it one.
// - A version is immutable once written (enforced by a trigger too), so a document pinned to
//   { dataset, version } always reads the same rows.
// - Rows are stored as gzipped JSON and handed to the browser as stored: the browser sends them
//   with its requests exactly as it sends a local upload, so the engine is unchanged.
// - Every read of rows and every write is logged with its principal.
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { dbQuery } from "./db.ts";
import { validateCustomData, type CustomDataset, type CustomColumn, type CustomLevel } from "./custom-data.ts";
import { AccessError } from "./auth.ts";
import { groupsOf, readableWhere, canRead, canWrite, canShare, rightsOf, sharingOf, validateSharing, type Rights, type Shareable, type Sharing } from "./access.ts";

export interface DatasetSource { rowsIn: number; unmatched: number; duplicates: number; multiStudy: number; studies: string[] }

export interface DatasetVersionMeta {
  version: number; columns: CustomColumn[]; studies: string[]; rowCount: number; sha256: string;
  source: DatasetSource; createdBy: string; createdAt: string;
}
export interface DatasetMeta {
  id: string; slug: string; name: string; owner: string; ownerEmail: string; level: CustomLevel;
  latestVersion: number; createdAt: string; updatedAt: string; deletedAt: string | null;
  sharing: Sharing & { groupName: string | null };
  /** what the asking user may do with it */
  rights: Rights;
  versions: DatasetVersionMeta[];
}

interface DatasetRow extends Shareable {
  id: string; slug: string; name: string; level: CustomLevel; latest_version: number; created_at: string; updated_at: string; deleted_at: string | null;
  owner_email: string; group_name: string | null;
}
interface VersionRow { dataset_id: string; version: number; columns: CustomColumn[]; studies: string[]; row_count: number; rows_gz: Buffer; sha256: string; source: DatasetSource; created_by: string; created_at: string }

// ---------------------------------------------------------------------------
// Storage: SQL against lib/db.ts, which supplies the in-process Postgres where none is configured.
// ---------------------------------------------------------------------------

interface Store {
  /** the live datasets the principal may read (lib/access.ts) */
  datasets(principal: string): Promise<DatasetRow[]>;
  dataset(id: string): Promise<DatasetRow | null>;
  bySlug(owner: string, slug: string): Promise<DatasetRow | null>;
  versions(ids: string[]): Promise<Omit<VersionRow, "rows_gz">[]>;
  version(id: string, version: number): Promise<VersionRow | null>;
  /** creates the dataset row (when `create`) and its next version, atomically */
  write(d: { id: string; slug: string; name: string; owner: string; level: CustomLevel; create: boolean }, v: Omit<VersionRow, "created_at">): Promise<void>;
  softDelete(id: string): Promise<void>;
  log(principal: string, action: "read" | "create" | "version" | "delete", id: string, version: number | null): Promise<void>;
}

const DATASET = "select d.*, u.email as owner_email, g.name as group_name from custom_dataset d" +
  " left join app_user u on u.id = d.owner_id left join user_group g on g.id = d.group_id";
const VERSION_COLS = "dataset_id, version, columns, studies, row_count, sha256, source, created_by, created_at";
const store: Store = {
  async datasets(principal) {
    return dbQuery<DatasetRow>(DATASET + " where d.deleted_at is null and " + readableWhere("d", 1) + " order by d.updated_at desc limit 1000", [principal]);
  },
  async dataset(id) { return (await dbQuery<DatasetRow>(DATASET + " where d.id = $1", [id]))[0] ?? null; },
  async bySlug(owner, slug) { return (await dbQuery<DatasetRow>("select * from custom_dataset where owner_id = $1 and slug = $2", [owner, slug]))[0] ?? null; },
  async versions(ids) {
    return ids.length ? dbQuery("select " + VERSION_COLS + " from custom_dataset_version where dataset_id = any($1::uuid[]) order by version", [ids]) : [];
  },
  async version(id, version) {
    return (await dbQuery<VersionRow>("select * from custom_dataset_version where dataset_id = $1 and version = $2", [id, version]))[0] ?? null;
  },
  async write(d, v) {
    // one statement, so a dataset never exists without its version or points past its last one
    await dbQuery(
      "with ds as (" +
      (d.create
        ? "insert into custom_dataset (id, slug, name, owner_id, level, latest_version) values ($1::uuid, $2::text, $3::text, $4::uuid, $5::text, $6::int) returning id"
        : "update custom_dataset set name = $3::text, latest_version = $6::int where id = $1::uuid and latest_version = $6::int - 1 and deleted_at is null" +
          " and $2::text is not null and $4::text is not null and $5::text is not null returning id") +
      ") insert into custom_dataset_version (dataset_id, version, columns, studies, row_count, rows_gz, sha256, source, created_by)" +
      " select id, $6::int, $7::jsonb, $8::text[], $9::int, $10::bytea, $11::text, $12::jsonb, $13::text from ds",
      [d.id, d.slug, d.name, d.owner, d.level, v.version, JSON.stringify(v.columns), v.studies, v.row_count, v.rows_gz, v.sha256,
        JSON.stringify(v.source), v.created_by]);
    if (!(await this.version(d.id, v.version))) throw new Error("another version of this dataset was saved at the same time; reload and save again");
  },
  async softDelete(id) { await dbQuery("update custom_dataset set deleted_at = now() where id = $1 and deleted_at is null", [id]); },
  async log(principal, action, id, version) {
    await dbQuery("insert into custom_data_access_log (principal, action, dataset_id, version) values ($1, $2, $3, $4)", [principal, action, id, version]);
  }
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Postgres hands back timestamps as Date; the API speaks ISO text. */
const iso = (x: unknown): string => x instanceof Date ? x.toISOString() : String(x);

const metaOf = (d: DatasetRow, vs: Omit<VersionRow, "rows_gz">[], principal: string, groups: Set<string>): DatasetMeta => ({
  id: d.id, slug: d.slug, name: d.name, owner: d.owner_id ?? "", ownerEmail: d.owner_email ?? "", level: d.level, latestVersion: d.latest_version,
  createdAt: iso(d.created_at), updatedAt: iso(d.updated_at), deletedAt: d.deleted_at ? iso(d.deleted_at) : null,
  sharing: { ...sharingOf(d), groupName: d.group_name }, rights: rightsOf(principal, d, groups),
  versions: vs.filter((v) => v.dataset_id === d.id).map((v) => ({
    version: v.version, columns: v.columns, studies: v.studies, rowCount: v.row_count, sha256: v.sha256,
    source: v.source, createdBy: v.created_by, createdAt: iso(v.created_at)
  }))
});

/** Every live dataset this principal may read, newest first, without rows. */
export async function listDatasets(principal: string): Promise<DatasetMeta[]> {
  const [all, groups] = await Promise.all([store.datasets(principal), groupsOf(principal)]);
  const vs = await store.versions(all.map((d) => d.id));
  return all.map((d) => metaOf(d, vs, principal, groups));
}

async function readable(principal: string, id: string): Promise<{ d: DatasetRow; groups: Set<string> }> {
  const d = /^[0-9a-f-]{36}$/.test(id) ? await store.dataset(id) : null;
  const groups = await groupsOf(principal);
  if (!d || !canRead(principal, d, groups)) throw new AccessError("no custom dataset " + id + " that you may read", 404);
  return { d, groups };
}

/** One version's rows (gzipped JSON, as stored) and its metadata. Logged. */
export async function readVersion(principal: string, id: string, version?: number): Promise<{ meta: DatasetMeta; version: number; rowsGz: Buffer }> {
  const { d, groups } = await readable(principal, id);
  if (d.deleted_at) throw new AccessError("custom dataset “" + d.name + "” (" + d.slug + ") was deleted on " + iso(d.deleted_at).slice(0, 10), 410);
  const n = version ?? d.latest_version;
  const v = await store.version(d.id, n);
  if (!v) throw new AccessError("custom dataset “" + d.name + "” has no version " + n + " (latest is " + d.latest_version + ")", 404);
  await store.log(principal, "read", d.id, n);
  return { meta: metaOf(d, await store.versions([d.id]), principal, groups), version: n, rowsGz: Buffer.from(v.rows_gz) };
}

/**
 * Save an upload: a new dataset, or the next version of an existing one (`versionOf`). The
 * dataset is validated exactly as a request's customData is, so nothing is stored that the
 * engine would refuse.
 *
 * A new version names the version its changes were reviewed against (`baseVersion`, see
 * lib/custom-data-diff.ts), and is refused when that is no longer the latest — someone saved in
 * between, so what was confirmed is not what would be replaced — or when it is the same data again.
 */
export async function saveDataset(principal: string, input: unknown, source: unknown, versionOf?: string, baseVersion?: number): Promise<DatasetMeta> {
  const [ds] = validateCustomData([input]) as [CustomDataset];
  if (!ds || !ds.rows.length) throw new Error("a dataset needs at least one row");
  const src = (source && typeof source === "object" ? source : {}) as Partial<DatasetSource>;
  const studies = [...new Set(ds.rows.map((r) => r.study))].sort();
  const json = JSON.stringify(ds.rows);
  const row = {
    columns: ds.columns, studies, row_count: ds.rows.length, rows_gz: gzipSync(json, { level: 6 }),
    sha256: createHash("sha256").update(json).digest("hex"),
    source: { rowsIn: Number(src.rowsIn) || ds.rows.length, unmatched: Number(src.unmatched) || 0, duplicates: Number(src.duplicates) || 0,
      multiStudy: Number(src.multiStudy) || 0, studies: Array.isArray(src.studies) ? src.studies.map(String).slice(0, 50) : studies },
    created_by: principal
  };
  let target: DatasetRow | null = null, groups = new Set<string>();
  if (versionOf) {
    ({ d: target, groups } = await readable(principal, versionOf));
    if (target.deleted_at) throw new AccessError("custom dataset “" + target.name + "” was deleted; save it as a new dataset", 410);
    if (!canWrite(principal, target, groups)) throw new AccessError("you may read “" + target.name + "” but not add versions to it", 403);
    if (target.level !== ds.level) throw new Error("“" + target.name + "” is " + target.level + "-level; a new version must be too");
    if (!Number.isInteger(baseVersion)) throw new Error("a new version names the version its changes were compared against (baseVersion)");
    if (baseVersion !== target.latest_version)
      throw new AccessError("“" + target.name + "” is at v" + target.latest_version + " now, not the v" + baseVersion + " these changes were compared against: review them again", 409);
    const latest = (await store.versions([target.id])).find((v) => v.version === target!.latest_version);
    if (latest?.sha256 === row.sha256) throw new Error("this is the same data as v" + target.latest_version + " of “" + target.name + "”: nothing to save");
  } else {
    const clash = await store.bySlug(principal, ds.id);
    // a deleted dataset keeps its name, so an analysis pinned to it is still refused as deleted rather than reading another
    if (clash?.deleted_at) throw new Error("the name " + ds.id + " belonged to a dataset that was deleted, and is not reused: rename this upload");
    if (clash) throw new Error("a server dataset is already named " + ds.id + ": save as a new version of it, or rename this upload");
  }
  const id = target?.id ?? randomUUID(), version = target ? target.latest_version + 1 : 1;
  await store.write({ id, slug: target?.slug ?? ds.id, name: ds.name, owner: target?.owner_id ?? principal, level: ds.level, create: !target },
    { dataset_id: id, version, ...row });
  await store.log(principal, target ? "version" : "create", id, version);
  return metaOf((await store.dataset(id))!, await store.versions([id]), principal, target ? groups : await groupsOf(principal));
}

/** Delete (its owner only). */
export async function deleteDataset(principal: string, id: string): Promise<void> {
  const { d } = await readable(principal, id);
  if (!canShare(principal, d)) throw new AccessError("only its owner can delete “" + d.name + "”", 403);
  await store.softDelete(d.id);
  await store.log(principal, "delete", d.id, null);
}

/** Change how a dataset is shared (its owner only). It holds patient-level values: never shared but by this. */
export async function shareDataset(principal: string, id: string, sharing: unknown): Promise<DatasetMeta> {
  const { d, groups } = await readable(principal, id);
  if (!canShare(principal, d)) throw new AccessError("only its owner can change who “" + d.name + "” is shared with", 403);
  if (d.deleted_at) throw new AccessError("custom dataset “" + d.name + "” was deleted", 410);
  const s = validateSharing(sharing, groups);
  await dbQuery("update custom_dataset set visibility = $2, group_id = $3, group_can_edit = $4 where id = $1", [id, s.visibility, s.groupId, s.groupCanEdit]);
  return metaOf((await store.dataset(id))!, await store.versions([id]), principal, groups);
}

export function unpackRows(rowsGz: Buffer): CustomDataset["rows"] {
  return JSON.parse(gunzipSync(rowsGz).toString("utf8"));
}

// ---------------------------------------------------------------------------
// Per-request loading, for the engine's routes (lib/custom-data-server.ts)
// ---------------------------------------------------------------------------

/** Versions are immutable, so a version's rows can be kept; bounded by count. */
const ROWS_CACHE_MAX = 32;
const rowsCache = new Map<string, { meta: DatasetMeta; rows: CustomDataset["rows"] }>();
/** An access decision is re-checked at most this often per principal and dataset. */
const ACCESS_TTL_MS = 60_000;
const accessSeen = new Map<string, number>();

/**
 * A version's rows for one engine request. Access is re-checked, and the read logged, at most
 * once a minute per principal and dataset — not once per facet query; the rows themselves come
 * from memory once read, which is safe only because a version never changes.
 */
export async function loadVersionForRequest(principal: string, id: string, version: number): Promise<{ meta: DatasetMeta; rows: CustomDataset["rows"] }> {
  const key = id + "@" + version, who = principal + "\t" + id, now = Date.now();
  const hit = rowsCache.get(key);
  if (hit && (accessSeen.get(who) ?? 0) > now - ACCESS_TTL_MS) return hit;
  const r = await readVersion(principal, id, version);   // checks access, refuses a deleted dataset, logs
  accessSeen.set(who, now);
  const entry = hit ?? { meta: r.meta, rows: unpackRows(r.rowsGz) };
  rowsCache.delete(key); rowsCache.set(key, entry);
  while (rowsCache.size > ROWS_CACHE_MAX) rowsCache.delete(rowsCache.keys().next().value!);
  return entry;
}
