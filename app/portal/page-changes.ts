// What a portal page's link carries of its settings: only how its views differ from the page's
// defaults. The defaults are rebuilt from the link's query (?study=, ?genes=, ?filters=) or its
// cohorts, so a link with nothing changed carries nothing, and a changed setting costs its own
// bytes rather than every view's.
//
// The changes are tied to the page's layout — the kinds of its views, in order — by a short key.
// When the layout has changed since the link was made (a tab added, a view moved), an index would
// name another view, so the changes are not applied at all and the page says so. A default whose
// value changed under an unchanged layout is taken up: the link holds what the reader changed, not
// what they left alone.
import type { View } from "../../lib/types";

/** each changed view: its index, its settings that differ, and the default settings it no longer has */
export type ViewChange = [index: number, set: Record<string, unknown>, unset?: string[]];
export interface PageChanges { layout: string; views: ViewChange[] }

/** a short key for the kinds of a page's views, in order (FNV-1a) */
export function layoutKey(views: View[]): string {
  let h = 0x811c9dc5;
  for (const ch of views.map((v) => v.kind).join(",")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(36);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** how `now` differs from the page's defaults `fresh`; null when it does not */
export function pageChanges(fresh: View[], now: View[]): PageChanges | null {
  const views: ViewChange[] = [];
  now.forEach((v, i) => {
    const d = (fresh[i] || {}) as unknown as Record<string, unknown>, n = v as unknown as Record<string, unknown>;
    const set = Object.fromEntries(Object.entries(n).filter(([k, x]) => !same(x, d[k])));
    const unset = Object.keys(d).filter((k) => !(k in n));
    if (Object.keys(set).length || unset.length) views.push(unset.length ? [i, set, unset] : [i, set]);
  });
  return views.length ? { layout: layoutKey(fresh), views } : null;
}

/** the page's views with a link's changes made to them; null when they were made on another layout */
export function applyChanges(fresh: View[], c: PageChanges): View[] | null {
  if (!c || c.layout !== layoutKey(fresh) || !Array.isArray(c.views)) return null;
  const out = fresh.slice();
  for (const [i, set, unset] of c.views) {
    if (!Number.isInteger(i) || !out[i] || !set || typeof set !== "object") return null;
    const v = { ...out[i], ...set } as Record<string, unknown>;
    for (const k of unset || []) delete v[k];
    if (v.kind !== fresh[i].kind) return null;
    out[i] = v as unknown as View;
  }
  return out;
}
