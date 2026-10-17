// Inline id lists in the page's documents become stored id sets (lib/id-set-store.ts) wherever the
// reader is signed in: a cohort picked on an oncoprint, donors from Cell Explorer, and every list
// still inline when a cohort or an analysis is saved. The document then names the set
// (`{"kind":"sampleList","set":"<id>"}`), so it, its ?doc= link and every request stay small
// however long the list is. Inline lists remain valid DSL for MCP clients, scripts and signed-out
// readers, who cannot read a set.
import type { AnalysisDoc, CohortDef } from "../../lib/types.ts";
import { api } from "./api.ts";

type ListKind = "sampleList" | "patientList";
interface InlineList { kind: ListKind; ids: string[] }

const isInline = (x: unknown): x is InlineList => {
  const o = x as { kind?: unknown; ids?: unknown; set?: unknown } | null;
  return !!o && (o.kind === "sampleList" || o.kind === "patientList") && Array.isArray(o.ids) && o.ids.length > 0 && o.set === undefined;
};

/** Save one inline list as a set; the clause naming it, or the list unchanged when none of its ids names a case. */
async function store(leaf: InlineList, name: string): Promise<object> {
  // only "<study>:<id>" ids select anyone inline (lib/cohort2.ts), so only those are stored
  const ids = leaf.ids.map(String).filter((s) => { const i = s.indexOf(":"); return i > 0 && i < s.length - 1; });
  if (!ids.length) return leaf;
  const studies = [...new Set(ids.map((s) => s.slice(0, s.indexOf(":"))))];
  const level = leaf.kind === "sampleList" ? "sample" : "patient";
  const res = await api.idSets.create({ name, level, studies, ids });
  const j = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok || j.error) {
    // a list naming no case here selects nobody here either way (none matched, or its studies are
    // held where patient ids may not go): nothing to store, and nothing lost by keeping it
    if (/none of the ids matched|cannot be matched against/.test(j.error || "")) return leaf;
    throw new Error("could not store the list of " + leaf.ids.length.toLocaleString() + " ids in “" + name + "”: " + (j.error || res.statusText));
  }
  const { kind: _k, ids: _ids, ...rest } = leaf as InlineList & Record<string, unknown>;
  return { ...rest, kind: leaf.kind, set: j.set.id, label: j.set.name, n: j.set.count };
}

/** `x` with every inline list under it stored, each named `name`; the same object when it has none. */
async function storeUnder<T>(x: T, name: string): Promise<T> {
  if (!x || typeof x !== "object") return x;
  if (isInline(x)) return (await store(x, name)) as T;
  if (Array.isArray(x)) {
    const out = await Promise.all(x.map((v) => storeUnder(v, name)));
    return out.every((v, i) => v === x[i]) ? x : (out as T);
  }
  const entries = Object.entries(x as Record<string, unknown>);
  const out = await Promise.all(entries.map(async ([k, v]) => [k, await storeUnder(v, name)] as const));
  return out.every(([, v], i) => v === entries[i][1]) ? x : (Object.fromEntries(out) as T);
}

/** A cohort with its inline lists stored as sets named after it; the same object when it has none. */
export function storeCohortLists(def: CohortDef, name: string): Promise<CohortDef> {
  return storeUnder(def, name);
}

/** A document with each cohort's inline lists stored as sets named after the cohort; the same object when it has none. */
export async function storeDocLists(doc: AnalysisDoc): Promise<AnalysisDoc> {
  const cohorts = doc.cohorts || {};
  const names = Object.keys(cohorts);
  const out = await Promise.all(names.map((n) => storeCohortLists(cohorts[n], n)));
  return out.every((d, i) => d === cohorts[names[i]]) ? doc : { ...doc, cohorts: Object.fromEntries(names.map((n, i) => [n, out[i]])) };
}
