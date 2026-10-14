// Saved cohorts and workspaces: CRUD over the `saved_artifacts` table (see
// db/migrations/0001_saved_artifacts.sql). Definitions only — never a frozen
// evaluation or a patient/sample id; see lib/db.ts and RATIONALE.md.
//
// Every call is made as a principal (lib/auth.ts): a row is visible to, and changed by, its
// owner only. Rows saved before there was a login have no owner and belong to the shared
// principal — today's only one — so nothing saved earlier disappears.
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
import { SHARED_PRINCIPAL } from "./auth.ts";

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
}

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

interface Row { id: string; kind: ArtifactKind; name: string; schema_version: number; definition: unknown; owner?: string | null; created_at: string | Date; updated_at: string | Date }

/** Postgres hands back timestamps as Date; the API speaks ISO text. */
const iso = (t: string | Date): string => new Date(t).toISOString();

/** An owner column of null predates the login and is read as the shared principal's. */
const ownerOf = (r: Row) => r.owner ?? SHARED_PRINCIPAL;

function fromRow(r: Row): SavedArtifact {
  return {
    id: r.id, kind: r.kind, name: r.name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    definition: migrate(r.kind, r.definition, r.schema_version),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at)
  };
}

function validateName(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) throw new Error("name is required");
  if (s.length > 200) throw new Error("name is too long (200 chars max)");
  return s;
}

// Storage: SQL against lib/db.ts, which supplies the in-process Postgres where none is configured.
interface Store {
  list(kind?: ArtifactKind): Promise<Row[]>;
  get(id: string): Promise<Row | null>;
  insert(kind: ArtifactKind, name: string, definition: unknown, owner: string): Promise<Row>;
  update(id: string, name: string, definition: unknown): Promise<Row | null>;
  remove(id: string): Promise<boolean>;
}

const store: Store = {
  async list(kind) {
    return kind
      ? dbQuery<Row>("select * from saved_artifacts where kind = $1 order by updated_at desc limit 500", [kind])
      : dbQuery<Row>("select * from saved_artifacts order by updated_at desc limit 500");
  },
  async get(id) {
    const rows = await dbQuery<Row>("select * from saved_artifacts where id = $1", [id]);
    return rows[0] ?? null;
  },
  async insert(kind, name, definition, owner) {
    const rows = await dbQuery<Row>(
      "insert into saved_artifacts (kind, name, schema_version, definition, owner) values ($1, $2, $3, $4, $5) returning *",
      [kind, name, CURRENT_SCHEMA_VERSION, JSON.stringify(definition), owner]
    );
    return rows[0];
  },
  async update(id, name, definition) {
    const rows = await dbQuery<Row>(
      "update saved_artifacts set name = $2, schema_version = $3, definition = $4 where id = $1 returning *",
      [id, name, CURRENT_SCHEMA_VERSION, JSON.stringify(definition)]
    );
    return rows[0] ?? null;
  },
  async remove(id) {
    const rows = await dbQuery<{ id: string }>("delete from saved_artifacts where id = $1 returning id", [id]);
    return rows.length > 0;
  }
};

export async function listArtifacts(principal: string, kind?: ArtifactKind): Promise<SavedArtifact[]> {
  const rows = await store.list(kind);
  return rows.filter((r) => ownerOf(r) === principal).map(fromRow);
}

/** The row, if it exists and this principal owns it: someone else's reads as absent. */
async function owned(principal: string, id: string): Promise<Row | null> {
  const row = await store.get(id);
  return row && ownerOf(row) === principal ? row : null;
}

export async function getArtifact(principal: string, id: string): Promise<SavedArtifact | null> {
  const row = await owned(principal, id);
  return row ? fromRow(row) : null;
}

export async function createArtifact(principal: string, kind: ArtifactKind, name: unknown, definition: unknown): Promise<SavedArtifact> {
  if (!isArtifactKind(kind)) throw new Error("kind must be 'cohort' or 'workspace'");
  const n = validateName(name);
  if (!definition || typeof definition !== "object") throw new Error("definition must be an object");
  const row = await store.insert(kind, n, definition, principal);
  return fromRow(row);
}

/** Rename and/or replace the definition. Either field may be omitted to leave it as-is. */
export async function updateArtifact(principal: string, id: string, patch: { name?: unknown; definition?: unknown }): Promise<SavedArtifact | null> {
  const existing = await getArtifact(principal, id);
  if (!existing) return null;
  const name = patch.name === undefined ? existing.name : validateName(patch.name);
  if (patch.definition !== undefined && (!patch.definition || typeof patch.definition !== "object"))
    throw new Error("definition must be an object");
  const definition = patch.definition === undefined ? existing.definition : patch.definition;
  const row = await store.update(id, name, definition);
  return row ? fromRow(row) : null;
}

export async function deleteArtifact(principal: string, id: string): Promise<boolean> {
  if (!(await owned(principal, id))) return false;
  return store.remove(id);
}
