// Stored id sets in a request: a `sampleList`/`patientList` leaf that names a stored set
// (`{"kind":"sampleList","set":"<uuid>"}`) instead of carrying its ids.
//
// The request boundary (lib/id-sets-server.ts) reads each set the request names, as its signed-in
// reader, and puts it here for the length of the request. The cohort compiler (lib/cohort2.ts)
// then names one ClickHouse external table per set and study:
//
//   ... AND <id> IN (SELECT id FROM _idset_<set>_<study hash>)
//
// and lib/ch.ts uploads that table with any statement that names it and with no other. So a set
// of any size costs one short line of SQL, never a statement past ClickHouse's max_query_size
// (an inlined list hits it near 12,000 sample ids), and the document and its ?doc= link carry
// a uuid instead of the list.
//
// Patient-data boundary (docs/DATA-BOUNDARY.md): the ids are patient-level. Each study's table
// goes only to the connection of the patient-level instance holding that study, decided at the
// request boundary; lib/ch.ts refuses to upload it anywhere else.
//
// Pure apart from the AsyncLocalStorage: no I/O, safe to import from lib/ch.ts and lib/cohort2.ts.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export type IdSetLevel = "patient" | "sample";

/** A set as one request reads it: its members per study, as bare ids. */
export interface LoadedIdSet {
  id: string;
  name: string;
  level: IdSetLevel;
  count: number;
  perStudy: Record<string, string[]>;
  /** a lock's other lists in the same set, at the set's own level: "arm:<split> / <arm>" */
  parts?: Record<string, Record<string, string[]>>;
}

const membersOf = (s: LoadedIdSet, part: string): Record<string, string[]> | undefined => part ? s.parts?.[part] : s.perStudy;

interface IdSetCtx {
  sets: Map<string, LoadedIdSet>;
  /** study -> the connection id of the patient-level instance holding it */
  studyConn: Map<string, string>;
  /** external table name -> what it uploads (a set's main list or one of its parts), and where it may go */
  tables: Map<string, { set: string; study: string; part: string; data?: string }>;
}
const store = new AsyncLocalStorage<IdSetCtx>();

export const ID_SET_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ID_SET_STRUCTURE = "id String";

/** The external table holding one set's ids (or one part's) for one study. Stable, so its SQL can be read and cached by name. */
export function idSetTableName(set: string, study: string, part = ""): string {
  const h = (x: string, n: number) => createHash("sha256").update(x).digest("hex").slice(0, n);
  return "_idset_" + set.replace(/-/g, "") + "_" + h(study, 10) + (part ? "_" + h(part, 8) : "");
}

/** Run `fn` with these sets readable by the compiler. */
export function withIdSets<T>(sets: LoadedIdSet[], studyConn: Map<string, string>, fn: () => Promise<T>): Promise<T> {
  if (!sets.length) return fn();
  const tables = new Map<string, { set: string; study: string; part: string }>();
  for (const s of sets) {
    for (const study of Object.keys(s.perStudy)) tables.set(idSetTableName(s.id, study), { set: s.id, study, part: "" });
    for (const [part, m] of Object.entries(s.parts || {}))
      for (const study of Object.keys(m)) tables.set(idSetTableName(s.id, study, part), { set: s.id, study, part });
  }
  return store.run({ sets: new Map(sets.map((s) => [s.id, s])), studyConn, tables }, fn);
}

/**
 * True when this request reads a stored set. Such an answer is not written to the shared result
 * cache (lib/next-cache.ts): a cached computation runs outside the request, where the set's table
 * is not there to upload, and reading a set must be checked against its reader every time.
 */
export function hasIdSets(): boolean {
  return !!store.getStore()?.sets.size;
}

/** The set a request read, or a specific refusal saying why it is not there. */
export function loadedIdSet(set: string): LoadedIdSet {
  const s = store.getStore()?.sets.get(set);
  if (!s) throw new Error("this cohort names stored id set " + set + ", which this request did not read: a stored set is read for a signed-in " +
    "request through the web app's API (log in, or check you may read it). MCP clients and links without a sign-in carry their ids inline.");
  return s;
}

/** The set if this request read it: for a readback, which must not fail where compiling would. */
export function idSetIfLoaded(set: string): LoadedIdSet | null {
  return store.getStore()?.sets.get(set) ?? null;
}

/**
 * The table a compiled statement reads one set's ids — or one of its parts' — for `study` from, or
 * null when it holds no ids for that study (most of a cross-study set belongs to the other studies
 * of the fan-out).
 */
export function idSetTable(set: string, study: string, level: IdSetLevel, part = ""): string | null {
  const s = loadedIdSet(set);
  if (part && !s.parts?.[part]) throw new Error("stored id set “" + s.name + "” has no part “" + part + "”");
  const l = s.level; // a lock's arms are held at the level of its main list
  if (l !== level)
    throw new Error("stored id set “" + s.name + "”" + (part ? " (" + part + ")" : "") + " holds " + l + " ids; name it in a " + l + "List clause, not a " + level + "List");
  return membersOf(s, part)?.[study]?.length ? idSetTableName(set, study, part) : null;
}

const tsv = (s: string) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

/** The id-set tables a statement names, for lib/ch.ts. Refuses a connection not entitled to them. */
export function idSetExternalsFor(query: string, connId: string): { name: string; structure: string; data: string }[] {
  const s = store.getStore();
  if (!s || !query.includes("_idset_")) return [];
  const out: { name: string; structure: string; data: string }[] = [];
  for (const [name, t] of s.tables) {
    if (!new RegExp("(^|[^A-Za-z0-9_])" + name + "([^A-Za-z0-9_]|$)").test(query)) continue;
    if (s.studyConn.get(t.study) !== connId)
      throw new Error("stored id set " + t.set + " holds patient-level ids for " + t.study + ", which cannot be sent to instance '" + connId + "'");
    t.data ??= membersOf(s.sets.get(t.set)!, t.part)![t.study].map(tsv).join("\n") + "\n";
    out.push({ name, structure: ID_SET_STRUCTURE, data: t.data });
  }
  return out;
}

/** Every stored set a document, definition or request body names, in first-seen order. */
export function idSetRefsIn(x: unknown): string[] {
  const out = new Set<string>();
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as { kind?: unknown; set?: unknown; lock?: unknown };
    if ((o.kind === "sampleList" || o.kind === "patientList") && o.set !== undefined) {
      if (typeof o.set !== "string" || !ID_SET_UUID.test(o.set)) throw new Error(o.kind + " clause: set must be a stored id set's id (a uuid), got " + JSON.stringify(o.set));
      out.add(o.set);
    }
    // a locked cohort's frozen samples, and each locked arm's (lib/cohort-lock.ts)
    if (o.lock && typeof o.lock === "object") {
      const l = o.lock as { set?: unknown; children?: Record<string, { set?: unknown }> };
      for (const m of [l, ...Object.values(l.children && typeof l.children === "object" ? l.children : {})])
        if (typeof m?.set === "string" && ID_SET_UUID.test(m.set)) out.add(m.set);
    }
    Object.values(v).forEach(walk);
  };
  walk(x);
  return [...out];
}
