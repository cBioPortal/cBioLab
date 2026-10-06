// The Analysis document's version, and the one place an older document is brought up to date.
//
// Every document this app writes carries `"dsl": DOC_VERSION`. A document is read like this:
//   - no `dsl`: written before documents carried a version, or by a client that left it out —
//     every upgrade step runs, each acting only if the old shape it replaces is present
//   - an older version: upgraded step by step, each step saying what it changed
//   - this version: read as is
//   - a newer version: refused. An older engine reading a newer document would silently ignore
//     what it does not know (a split it cannot see shows the whole cohort), which is a wrong
//     answer with no error.
// Bump DOC_VERSION when the document's SHAPE changes, and also when what an unchanged document
// MEANS changes, so a saved analysis can say which rules it was written under. Pure and
// browser-safe: the page upgrades a document when it opens one, the engine whenever it runs one.

import { flattenSplits, splitsDrawn } from "./partition-arms.ts";

export const DOC_VERSION = "2.4";

/** what upgrading a document did, reported in the result so a reader is told, not left to notice */
export interface DocUpgrade {
  /** the version the document was written in; "unversioned" when it carried none */
  from: string;
  to: string;
  /** one line per change actually made to this document (empty when the shape needed none) */
  changes: string[];
}

function parse(v: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function compare(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

type AnyDoc = Record<string, any>;

/**
 * 2.2 → 2.3: top-level `partitions` ({name: {of, arms, other?}}) move onto the cohort they split,
 * as `cohorts[of].splits[name]`, or onto the arm they split (`arms[i].splits`, or `otherSplits`
 * for a split of the remainder). A split's children were "<partition> / <arm>" and are now
 * "<cohort> / <split> / <arm>", so a view listing one is rewritten to the new name.
 */
function partitionsToSplits(doc: AnyDoc, changes: string[]): AnyDoc {
  const parts: Record<string, AnyDoc> = doc.partitions;
  if (!parts || typeof parts !== "object" || !Object.keys(parts).length) {
    if ("partitions" in doc) { const { partitions: _drop, ...rest } = doc; return rest; }
    return doc;
  }
  const cohorts: Record<string, AnyDoc> = JSON.parse(JSON.stringify(doc.cohorts || {}));
  const newName: Record<string, string> = {};
  const owner = (of: string, chain: string[]): string => {
    for (const p of Object.keys(parts)) if (of.startsWith(p + " / ")) return flatName(p, chain) + of.slice(p.length);
    return of;
  };
  const flatName = (p: string, chain: string[]): string => {
    if (newName[p]) return newName[p];
    if (chain.includes(p)) throw new Error("partition “" + p + "” splits its own descendant");
    const of = String(parts[p]?.of || "");
    newName[p] = owner(of, [...chain, p]) + " / " + p;
    return newName[p];
  };
  for (const p of Object.keys(parts)) flatName(p, []);
  // attach parents before the splits nested under their arms
  const order = Object.keys(parts).sort((a, b) => newName[a].split(" / ").length - newName[b].split(" / ").length);
  const built: Record<string, AnyDoc> = {};
  for (const p of order) {
    const { of: _of, ...rest } = parts[p];
    const def: AnyDoc = { ...rest, arms: (rest.arms || []).map((a: AnyDoc) => ({ ...a })) };
    const of = owner(String(parts[p].of || ""), []);
    if (cohorts[of]) {
      cohorts[of].splits = { ...(cohorts[of].splits || {}), [p]: def };
    } else {
      const parent = Object.keys(built).find((q) => of.startsWith(newName[q] + " / "));
      if (!parent) throw new Error("partition “" + p + "” splits “" + parts[p].of + "”, which is not a cohort or an arm of a partition");
      const label = of.slice(newName[parent].length + 3);
      const pd = built[parent];
      const arm = (pd.arms || []).find((a: AnyDoc) => a.name === label);
      if (arm) arm.splits = { ...(arm.splits || {}), [p]: def };
      else if ((pd.other || "Other") === label) pd.otherSplits = { ...(pd.otherSplits || {}), [p]: def };
      else throw new Error("partition “" + p + "” splits “" + parts[p].of + "”, which is not an arm of “" + parent + "”");
    }
    built[p] = def;
  }
  const rename = (c: string): string => {
    for (const p of Object.keys(parts)) {
      if (c === p) return newName[p];
      if (c.startsWith(p + " / ")) return newName[p] + c.slice(p.length);
    }
    return c;
  };
  const views = (doc.views || []).map((v: AnyDoc) => Array.isArray(v?.cohorts) ? { ...v, cohorts: v.cohorts.map(rename) } : v);
  changes.push("moved " + Object.keys(parts).length + " split" + (Object.keys(parts).length === 1 ? "" : "s") +
    " (" + Object.keys(parts).join(", ") + ") onto the cohorts they split; their groups are now named “<cohort> / <split> / <arm>”");
  const { partitions: _drop, ...rest } = doc;
  return { ...rest, cohorts, views };
}

/**
 * 2.3 → 2.4: in 2.3 a split replaced what it split in every view — a view showing a split cohort,
 * by name or by default, drew that cohort's (first) split's arms instead, recursively. In 2.4 a
 * cohort's name is the whole cohort and a view names the split to draw its arms. Every view whose
 * drawing would change is given the explicit list it drew under 2.3, so it draws the same thing.
 */
function splitsNoLongerReplace(doc: AnyDoc, changes: string[]): AnyDoc {
  const flat = flattenSplits(doc.cohorts || {});
  if (!Object.keys(flat).length) return doc;
  const arms = (key: string) => [...flat[key].arms.map((a) => key + " / " + a.name), key + " / " + (flat[key].other || "Other")];
  const firstOf = new Map<string, string>();
  for (const [key, p] of Object.entries(flat)) if (!firstOf.has(p.of)) firstOf.set(p.of, key);
  const drew23 = (names: string[]): string[] => {
    const out: string[] = [];
    const visit = (n: string, seen: Set<string>) => {
      const key = flat[n] ? n : firstOf.get(n);
      if (!key || seen.has(key)) { out.push(n); return; }
      for (const c of arms(key)) visit(c, new Set(seen).add(key));
    };
    for (const n of names) visit(n, new Set());
    return out.filter((n, i) => out.indexOf(n) === i);
  };
  const drew24 = (names: string[]): string[] => {
    const out = names.flatMap((n) => flat[n] ? arms(n) : [n]);
    return out.filter((n, i) => out.indexOf(n) === i);
  };
  const authored = Object.keys(doc.cohorts || {});
  const shapes = Object.keys(flat).map((key) => ({ name: key, of: flat[key].of, comparable: arms(key) }));
  let fixed = 0;
  const several: number[] = [];
  const views = (doc.views || []).map((v: AnyDoc, i: number) => {
    if (!v || typeof v !== "object") return v;
    const list: string[] = Array.isArray(v.cohorts) && v.cohorts.length ? v.cohorts : authored;
    const before = drew23(list), after = drew24(list);
    if (before.length === after.length && before.every((n, k) => n === after[k])) return v;
    fixed++;
    // nested splits drew the groups of several splits at once, which a 2.4 view cannot
    if (splitsDrawn(before, shapes).length > 1) several.push(i + 1);
    return { ...v, cohorts: before };
  });
  if (fixed) changes.push(fixed + " view" + (fixed === 1 ? "" : "s") + " that drew a split cohort's arms now list" +
    (fixed === 1 ? "s" : "") + " them by name, since a cohort's name now means the whole cohort");
  if (several.length) changes.push("view" + (several.length === 1 ? " " : "s ") + several.join(", ") + " drew the groups of several splits at once, " +
    "which a view no longer does — choose one split in " + (several.length === 1 ? "its" : "their") + " cohorts menu");
  return fixed ? { ...doc, views } : doc;
}

/** each step upgrades from the version before `to`; unversioned documents start at the first */
const STEPS: { to: string; run: (doc: AnyDoc, changes: string[]) => AnyDoc }[] = [
  { to: "2.3", run: partitionsToSplits },
  { to: "2.4", run: splitsNoLongerReplace }
];

/**
 * Bring a document to DOC_VERSION. Returns it unchanged (same object) when it is already
 * current, so a caller can tell whether anything happened.
 */
export function upgradeDocument<D>(doc: D): { doc: D; upgrade: DocUpgrade | null } {
  const d = doc as unknown as AnyDoc;
  if (!d || typeof d !== "object") return { doc, upgrade: null };
  const current = parse(DOC_VERSION)!;
  const raw = d.dsl;
  const from = raw == null ? null : parse(String(raw));
  if (raw != null && !from) throw new Error("document version “" + raw + "” is not a version (expected e.g. \"" + DOC_VERSION + "\")");
  if (from && compare(from, current) > 0)
    throw new Error("this document was written for DSL " + raw + "; this server reads up to " + DOC_VERSION +
      " — open it on a newer deployment, or remove `dsl` to read it as " + DOC_VERSION + " at your own risk");
  if (from && compare(from, current) === 0) return { doc, upgrade: null };
  const changes: string[] = [];
  let out: AnyDoc = d;
  for (const step of STEPS) {
    if (from && compare(parse(step.to)!, from) <= 0) continue;
    out = step.run(out, changes);
  }
  out = { ...out, dsl: DOC_VERSION };
  // Every step only acts on the old shape it replaces, so an unversioned document already in the
  // current shape (one an assistant just wrote) passes through unchanged and is not reported.
  if (raw == null && !changes.length) return { doc: out as D, upgrade: null };
  return { doc: out as D, upgrade: { from: raw == null ? "unversioned" : String(raw), to: DOC_VERSION, changes } };
}
