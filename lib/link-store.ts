// Stored links (db/migrations/0012_stored_links.sql): the ONLY module that touches stored_link.
// lib/links.ts holds the rules (what is stored, how a page reads it back); docs/LINKS.md the design.
//
// A link's id is the first 132 bits of the SHA-256 of its parameters (canonicalLinkJson), so
// storing the same parameters twice is one row, and a row never changes (a trigger refuses it).
// Anyone may store or read one: a stored link carries no more than the ?doc= link it stands for.
import { createHash } from "node:crypto";
import { dbQuery } from "./db.ts";
import { AccessError } from "./auth.ts";
import { idSetRefsIn } from "./id-sets.ts";
import { readUrlJson } from "./url-json.ts";
import { canonicalLinkJson, validateLinkParams, LINK_ID, type LinkParams } from "./links.ts";

/** The id the parameters are stored under. */
export function linkId(p: LinkParams): string {
  return createHash("sha256").update(canonicalLinkJson(p)).digest("base64url").slice(0, 22);
}

/** The stored id sets the parameters name, in any value that decodes as URL JSON (lib/url-json.ts). */
export function setRefsOf(p: LinkParams): string[] {
  const out = new Set<string>();
  for (const v of Object.values(p)) {
    const x = readUrlJson(v);
    if (x && typeof x === "object") { try { for (const id of idSetRefsIn(x)) out.add(id); } catch { /* a malformed reference names no set */ } }
  }
  return [...out];
}

/** Store parameters (checked first); the id they are stored under. Storing the same ones again is a no-op. */
export async function saveLink(principal: string | null, input: unknown): Promise<{ id: string }> {
  const p = validateLinkParams(input);
  const id = linkId(p);
  const size = Object.entries(p).reduce((n, [k, v]) => n + k.length + v.length, 0);
  await dbQuery("insert into stored_link (id, params, size, set_refs, created_by) values ($1, $2::jsonb, $3, $4::uuid[], $5::uuid) on conflict (id) do nothing",
    [id, canonicalLinkJson(p), size, setRefsOf(p), principal]);
  return { id };
}

/** A stored link's parameters; refused, saying so, when there is none by that id. */
export async function readLink(id: string): Promise<LinkParams> {
  const row = LINK_ID.test(id) ? (await dbQuery<{ params: LinkParams | string }>("select params from stored_link where id = $1", [id]))[0] : undefined;
  if (!row) throw new AccessError("no stored link " + JSON.stringify(id.slice(0, 40)) + " on this deployment: it was made on another, or mistyped", 404);
  return typeof row.params === "string" ? JSON.parse(row.params) : row.params;
}

/** How many stored links name this id set. */
export async function linksNaming(setId: string): Promise<number> {
  const [r] = await dbQuery<{ n: string | number }>("select count(*) as n from stored_link where set_refs @> array[$1::uuid]", [setId]);
  return Number(r?.n ?? 0);
}
