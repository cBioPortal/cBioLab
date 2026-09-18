// Saved cohorts and workspaces: CRUD over the `saved_artifacts` table (see
// db/migrations/0001_saved_artifacts.sql). Definitions only — never a frozen
// evaluation or a patient/sample id; see lib/db.ts and RATIONALE.md.
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

interface Row { id: string; kind: ArtifactKind; name: string; schema_version: number; definition: unknown; created_at: string; updated_at: string }

function fromRow(r: Row): SavedArtifact {
  return {
    id: r.id, kind: r.kind, name: r.name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    definition: migrate(r.kind, r.definition, r.schema_version),
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

function validateName(name: unknown): string {
  const s = String(name ?? "").trim();
  if (!s) throw new Error("name is required");
  if (s.length > 200) throw new Error("name is too long (200 chars max)");
  return s;
}

export async function listArtifacts(kind?: ArtifactKind): Promise<SavedArtifact[]> {
  const rows = kind
    ? await dbQuery<Row>("select * from saved_artifacts where kind = $1 order by updated_at desc limit 500", [kind])
    : await dbQuery<Row>("select * from saved_artifacts order by updated_at desc limit 500");
  return rows.map(fromRow);
}

export async function getArtifact(id: string): Promise<SavedArtifact | null> {
  const rows = await dbQuery<Row>("select * from saved_artifacts where id = $1", [id]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function createArtifact(kind: ArtifactKind, name: unknown, definition: unknown): Promise<SavedArtifact> {
  if (!isArtifactKind(kind)) throw new Error("kind must be 'cohort' or 'workspace'");
  const n = validateName(name);
  if (!definition || typeof definition !== "object") throw new Error("definition must be an object");
  const rows = await dbQuery<Row>(
    "insert into saved_artifacts (kind, name, schema_version, definition) values ($1, $2, $3, $4) returning *",
    [kind, n, CURRENT_SCHEMA_VERSION, JSON.stringify(definition)]
  );
  return fromRow(rows[0]);
}

/** Rename and/or replace the definition. Either field may be omitted to leave it as-is. */
export async function updateArtifact(id: string, patch: { name?: unknown; definition?: unknown }): Promise<SavedArtifact | null> {
  const existing = await getArtifact(id);
  if (!existing) return null;
  const name = patch.name === undefined ? existing.name : validateName(patch.name);
  if (patch.definition !== undefined && (!patch.definition || typeof patch.definition !== "object"))
    throw new Error("definition must be an object");
  const definition = patch.definition === undefined ? existing.definition : patch.definition;
  const rows = await dbQuery<Row>(
    "update saved_artifacts set name = $2, schema_version = $3, definition = $4 where id = $1 returning *",
    [id, name, CURRENT_SCHEMA_VERSION, JSON.stringify(definition)]
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const rows = await dbQuery<{ id: string }>("delete from saved_artifacts where id = $1 returning id", [id]);
  return rows.length > 0;
}
