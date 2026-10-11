// The analysis page's document, with a stable id for each view and the JSON editor's text.
//
// A view's id is what its card is keyed by and what a one-view re-run finds its slot by, so it
// must follow the view through edits, moves and removals, and must NOT carry over to a different
// view that happens to sit at the same position after a new document is loaded. The ids are kept
// in a list parallel to `doc.views` rather than inside the views, so the document — what is
// shared, saved, sent to the engine and shown as JSON — never carries them.
//
// Three ways in, one per kind of change:
//   set(d)     an edit of the document on the page: a view keeps its id if it is the same object
//              as before, else (when the list did not change length) the id of its position
//   replace(d) a different document (an example, a link, a new analysis): every view is new
//   commit(d)  a document validated elsewhere (the AI tools): a view whose JSON is unchanged
//              keeps its id, so its card is not remounted
//
// The store updates synchronously (a ref), so an edit's view id is known to the request it starts
// in the same handler; React re-renders from it, and every change is announced once (URL sync).
import { useRef, useState } from "react";
import type { AnalysisDoc, View } from "../../lib/types.ts";
import { DOC_VERSION } from "../../lib/doc-version.ts";

/** `epoch` counts replace()s: a different document, whose numbers must never stand in for this one's */
export interface DocState { doc: AnalysisDoc; ids: number[]; text: string; nextId: number; epoch: number }

const views = (d: AnalysisDoc): unknown[] => (d.views || []) as unknown[];
const textOf = (d: AnalysisDoc) => JSON.stringify(d, null, 2);

export function initialDocState(doc: AnalysisDoc): DocState {
  const n = views(doc).length;
  return { doc, ids: Array.from({ length: n }, (_, i) => i), text: textOf(doc), nextId: n, epoch: 0 };
}

/** Ids for an edit: the same object keeps its id; otherwise, in a list of unchanged length, the position's. */
export function alignIds(s: DocState, d: AnalysisDoc): { ids: number[]; nextId: number } {
  const prev = views(s.doc), next = views(d);
  const byObject = new Map<unknown, number[]>();
  prev.forEach((v, i) => { const q = byObject.get(v) || []; q.push(s.ids[i]); byObject.set(v, q); });
  const taken = new Set<number>();
  let nextId = s.nextId;
  const ids = next.map((v) => {
    const q = byObject.get(v);
    const id = q && q.length ? q.shift()! : null;
    if (id != null) taken.add(id);
    return id;
  });
  const samePositions = prev.length === next.length;
  return {
    ids: ids.map((id, i) => {
      if (id != null) return id;
      if (samePositions && !taken.has(s.ids[i])) { taken.add(s.ids[i]); return s.ids[i]; }
      return nextId++;
    }),
    nextId,
  };
}

/** Ids for a validated document: a view whose JSON is unchanged keeps its id. */
export function matchIds(s: DocState, d: AnalysisDoc): { ids: number[]; nextId: number } {
  const byJson = new Map<string, number[]>();
  views(s.doc).forEach((v, i) => { const k = JSON.stringify(v); const q = byJson.get(k) || []; q.push(s.ids[i]); byJson.set(k, q); });
  let nextId = s.nextId;
  const ids = views(d).map((v) => { const q = byJson.get(JSON.stringify(v)); return q && q.length ? q.shift()! : nextId++; });
  return { ids, nextId };
}

export function setDoc(s: DocState, d: AnalysisDoc): DocState { return { ...s, doc: d, ...alignIds(s, d), text: textOf(d) }; }
export function replaceDoc(s: DocState, d: AnalysisDoc): DocState {
  const n = views(d).length;
  return { doc: d, ids: Array.from({ length: n }, (_, i) => s.nextId + i), text: textOf(d), nextId: s.nextId + n, epoch: s.epoch + 1 };
}
export function commitDoc(s: DocState, d: AnalysisDoc): DocState { return { ...s, doc: d, ...matchIds(s, d), text: textOf(d) }; }

export interface DocStore {
  /** the latest state — current even before React has re-rendered */
  readonly current: DocState;
  set(d: AnalysisDoc): void;
  replace(d: AnalysisDoc): void;
  commit(d: AnalysisDoc): void;
  /** the JSON editor's draft; changes nothing else */
  setText(text: string): void;
  /** the ids `d`'s views have, or would have if it were set now */
  idsFor(d: AnalysisDoc): number[];
}

/** The page's document store. `onChange` is told about every new document (not about text drafts). */
export function useDocStore(initial: AnalysisDoc, onChange: (d: AnalysisDoc) => void): DocStore {
  const ref = useRef<DocState | null>(null);
  if (!ref.current) ref.current = initialDocState(initial);
  const [, render] = useState(0);
  const changed = useRef(onChange);
  changed.current = onChange;
  const store = useRef<DocStore | null>(null);
  if (!store.current) {
    const apply = (next: DocState, announce: boolean) => {
      ref.current = next;
      render((n) => n + 1);
      if (announce) changed.current(next.doc);
    };
    store.current = {
      get current() { return ref.current!; },
      set: (d) => apply(setDoc(ref.current!, d), true),
      replace: (d) => apply(replaceDoc(ref.current!, d), true),
      commit: (d) => apply(commitDoc(ref.current!, d), true),
      setText: (text) => apply({ ...ref.current!, text }, false),
      idsFor: (d) => d === ref.current!.doc ? ref.current!.ids : alignIds(ref.current!, d).ids,
    };
  }
  return store.current;
}

/** The views a new analysis starts with. "compare" is left out: computing driver/any/p for every
 *  gene across every cohort is by far the slowest view, and this set exists to make Analyze feel
 *  instant — add it per document with "+ Compare genes". */
export const DEFAULT_VIEWS: View[] = [
  { kind: "survival" },
  { kind: "oncoprint", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR"] }
];
/** the default views, each drawing `cohorts` — a view draws only the cohorts it names */
export const defaultViews = (cohorts: string[]): View[] => DEFAULT_VIEWS.map((v) => ({ ...v, cohorts: [...cohorts] }));

/** The document a new page starts from: already the current version, so opening the page
 *  upgrades (and writes into the URL) nothing. */
export const EMPTY_DOC: AnalysisDoc = { dsl: DOC_VERSION, cohorts: {}, views: [] };
