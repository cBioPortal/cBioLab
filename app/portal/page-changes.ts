// What a portal page's link carries of its settings: only how its views differ from the page's
// defaults. The defaults are rebuilt from the link's query (?study=, ?genes=, ?filters=) or its
// cohorts, so a link with nothing changed carries nothing, and a changed setting costs its own
// bytes rather than every view's.
//
// Each change names its view as the page shows it — "Tab › View", or "Tab › Sub-tab › View"
// (arrange in page-doc.ts) — and stands on its own: it applies wherever the page still has that
// view, of the same kind, and is reported as not applying where it does not. A default whose value
// changed since is taken up: the link holds what the reader changed, not what they left alone.
import type { View } from "../../lib/types";

/** one changed view's settings that differ, and the default settings it no longer has */
export type ViewChange = [set: Record<string, unknown>, unset?: string[]];
/** the page's changed views, by name */
export type PageChanges = Record<string, ViewChange>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** how `now` differs from the page's defaults `fresh`, by the views' `names`; null when it does not */
export function pageChanges(names: string[], fresh: View[], now: View[]): PageChanges | null {
  const out: PageChanges = {};
  now.forEach((v, i) => {
    const d = (fresh[i] || {}) as unknown as Record<string, unknown>, n = v as unknown as Record<string, unknown>;
    const set = Object.fromEntries(Object.entries(n).filter(([k, x]) => !same(x, d[k])));
    const unset = Object.keys(d).filter((k) => !(k in n));
    if (Object.keys(set).length || unset.length) out[names[i]] = unset.length ? [set, unset] : [set];
  });
  return Object.keys(out).length ? out : null;
}

/**
 * The page's views with a link's changes made to them, and the names of the changes that did not
 * apply: no view of that name, or one the change would make another kind.
 */
export function applyChanges(names: string[], fresh: View[], c: PageChanges | null): { views: View[]; missed: string[] } {
  const views = fresh.slice(), missed: string[] = [];
  for (const [name, change] of Object.entries(c && typeof c === "object" && !Array.isArray(c) ? c : {})) {
    const i = names.indexOf(name);
    const [set, unset] = Array.isArray(change) ? change : [];
    if (i < 0 || !set || typeof set !== "object") { missed.push(name); continue; }
    const v = { ...views[i], ...set } as Record<string, unknown>;
    for (const k of Array.isArray(unset) ? unset : []) delete v[k];
    if (v.kind !== fresh[i].kind) { missed.push(name); continue; }
    views[i] = v as unknown as View;
  }
  return { views, missed };
}
