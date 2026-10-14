// Server-stored custom data: uploads saved so an analysis that uses one can be shared and re-run
// (db/migrations/0003_custom_datasets.sql). The ONLY module that touches those tables.
//
// - Every read and write passes canRead / canWrite, which decide by owner and grant. Today the
//   one principal is "shared" (lib/auth.ts), so both say yes for every live dataset;
//   per-user and per-group access means filling in the grant table, not changing callers.
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

export interface DatasetSource { rowsIn: number; unmatched: number; duplicates: number; multiStudy: number; studies: string[] }

export interface DatasetVersionMeta {
  version: number; columns: CustomColumn[]; studies: string[]; rowCount: number; sha256: string;
  source: DatasetSource; createdBy: string; createdAt: string;
}
export interface DatasetMeta {
  id: string; slug: string; name: string; owner: string; level: CustomLevel;
  latestVersion: number; createdAt: string; updatedAt: string; deletedAt: string | null;
  versions: DatasetVersionMeta[];
}

interface DatasetRow { id: string; slug: string; name: string; owner: string; level: CustomLevel; latest_version: number; created_at: string; updated_at: string; deleted_at: string | null }
interface VersionRow { dataset_id: string; version: number; columns: CustomColumn[]; studies: string[]; row_count: number; rows_gz: Buffer; sha256: string; source: DatasetSource; created_by: string; created_at: string }
interface GrantRow { dataset_id: string; principal: string; role: "viewer" | "editor" }

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

function canRead(principal: string, d: DatasetRow, grants: GrantRow[]): boolean {
  return d.owner === principal || grants.some((g) => g.principal === principal);
}
function canWrite(principal: string, d: DatasetRow, grants: GrantRow[]): boolean {
  return d.owner === principal || grants.some((g) => g.principal === principal && g.role === "editor");
}

// ---------------------------------------------------------------------------
// Storage: SQL against lib/db.ts, which supplies the in-process Postgres where none is configured.
// ---------------------------------------------------------------------------

interface Store {
  datasets(): Promise<DatasetRow[]>;
  dataset(id: string): Promise<DatasetRow | null>;
  bySlug(owner: string, slug: string): Promise<DatasetRow | null>;
  versions(ids: string[]): Promise<Omit<VersionRow, "rows_gz">[]>;
  version(id: string, version: number): Promise<VersionRow | null>;
  grants(ids: string[]): Promise<GrantRow[]>;
  /** creates the dataset row (when `create`) and its next version, atomically */
  write(d: { id: string; slug: string; name: string; owner: string; level: CustomLevel; create: boolean }, v: Omit<VersionRow, "created_at">): Promise<void>;
  softDelete(id: string): Promise<void>;
  log(principal: string, action: "read" | "create" | "version" | "delete", id: string, version: number | null): Promise<void>;
}

const VERSION_COLS = "dataset_id, version, columns, studies, row_count, sha256, source, created_by, created_at";
const store: Store = {
  async datasets() { return dbQuery<DatasetRow>("select * from custom_dataset order by updated_at desc limit 500"); },
  async dataset(id) { return (await dbQuery<DatasetRow>("select * from custom_dataset where id = $1", [id]))[0] ?? null; },
  async bySlug(owner, slug) { return (await dbQuery<DatasetRow>("select * from custom_dataset where owner = $1 and slug = $2", [owner, slug]))[0] ?? null; },
  async versions(ids) {
    return ids.length ? dbQuery("select " + VERSION_COLS + " from custom_dataset_version where dataset_id = any($1::uuid[]) order by version", [ids]) : [];
  },
  async version(id, version) {
    return (await dbQuery<VersionRow>("select * from custom_dataset_version where dataset_id = $1 and version = $2", [id, version]))[0] ?? null;
  },
  async grants(ids) {
    return ids.length ? dbQuery<GrantRow>("select dataset_id, principal, role from custom_dataset_grant where dataset_id = any($1::uuid[])", [ids]) : [];
  },
  async write(d, v) {
    // one statement, so a dataset never exists without its version or points past its last one
    await dbQuery(
      "with ds as (" +
      (d.create
        ? "insert into custom_dataset (id, slug, name, owner, level, latest_version) values ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::int) returning id"
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

const metaOf = (d: DatasetRow, vs: Omit<VersionRow, "rows_gz">[]): DatasetMeta => ({
  id: d.id, slug: d.slug, name: d.name, owner: d.owner, level: d.level, latestVersion: d.latest_version,
  createdAt: iso(d.created_at), updatedAt: iso(d.updated_at), deletedAt: d.deleted_at ? iso(d.deleted_at) : null,
  versions: vs.filter((v) => v.dataset_id === d.id).map((v) => ({
    version: v.version, columns: v.columns, studies: v.studies, rowCount: v.row_count, sha256: v.sha256,
    source: v.source, createdBy: v.created_by, createdAt: iso(v.created_at)
  }))
});

/** Every live dataset this principal may read, newest first, without rows. */
export async function listDatasets(principal: string): Promise<DatasetMeta[]> {
  const all = (await store.datasets()).filter((d) => !d.deleted_at);
  const grants = await store.grants(all.map((d) => d.id));
  const mine = all.filter((d) => canRead(principal, d, grants.filter((g) => g.dataset_id === d.id)));
  const vs = await store.versions(mine.map((d) => d.id));
  return mine.map((d) => metaOf(d, vs));
}

async function readable(principal: string, id: string): Promise<DatasetRow> {
  const d = /^[0-9a-f-]{36}$/.test(id) ? await store.dataset(id) : null;
  if (!d || !canRead(principal, d, await store.grants([d.id]))) throw new AccessError("no custom dataset " + id + " that you may read", 404);
  return d;
}

/** One version's rows (gzipped JSON, as stored) and its metadata. Logged. */
export async function readVersion(principal: string, id: string, version?: number): Promise<{ meta: DatasetMeta; version: number; rowsGz: Buffer }> {
  const d = await readable(principal, id);
  if (d.deleted_at) throw new AccessError("custom dataset “" + d.name + "” (" + d.slug + ") was deleted on " + iso(d.deleted_at).slice(0, 10), 410);
  const n = version ?? d.latest_version;
  const v = await store.version(d.id, n);
  if (!v) throw new AccessError("custom dataset “" + d.name + "” has no version " + n + " (latest is " + d.latest_version + ")", 404);
  await store.log(principal, "read", d.id, n);
  return { meta: metaOf(d, await store.versions([d.id])), version: n, rowsGz: Buffer.from(v.rows_gz) };
}

/**
 * Save an upload: a new dataset, or the next version of an existing one (`versionOf`). The
 * dataset is validated exactly as a request's customData is, so nothing is stored that the
 * engine would refuse.
 */
export async function saveDataset(principal: string, input: unknown, source: unknown, versionOf?: string): Promise<DatasetMeta> {
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
  let target: DatasetRow | null = null;
  if (versionOf) {
    target = await readable(principal, versionOf);
    if (target.deleted_at) throw new AccessError("custom dataset “" + target.name + "” was deleted; save it as a new dataset", 410);
    if (!canWrite(principal, target, await store.grants([target.id]))) throw new AccessError("you may read “" + target.name + "” but not add versions to it", 403);
    if (target.level !== ds.level) throw new Error("“" + target.name + "” is " + target.level + "-level; a new version must be too");
  } else {
    const clash = await store.bySlug(principal, ds.id);
    // a deleted dataset keeps its name, so an analysis pinned to it is still refused as deleted rather than reading another
    if (clash?.deleted_at) throw new Error("the name " + ds.id + " belonged to a dataset that was deleted, and is not reused: rename this upload");
    if (clash) throw new Error("a server dataset is already named " + ds.id + ": save as a new version of it, or rename this upload");
  }
  const id = target?.id ?? randomUUID(), version = target ? target.latest_version + 1 : 1;
  await store.write({ id, slug: target?.slug ?? ds.id, name: ds.name, owner: target?.owner ?? principal, level: ds.level, create: !target },
    { dataset_id: id, version, ...row });
  await store.log(principal, target ? "version" : "create", id, version);
  return metaOf((await store.dataset(id))!, await store.versions([id]));
}

export async function deleteDataset(principal: string, id: string): Promise<void> {
  const d = await readable(principal, id);
  if (!canWrite(principal, d, await store.grants([d.id]))) throw new AccessError("you may read “" + d.name + "” but not delete it", 403);
  await store.softDelete(d.id);
  await store.log(principal, "delete", d.id, null);
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
