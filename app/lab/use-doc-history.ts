// The analysis document's history: every change the reader makes is a browser history entry, so
// Back and Forward step through edits, and Undo / Redo (buttons, Ctrl/Cmd-Z, Shift-Ctrl/Cmd-Z or
// Ctrl-Y) are the same steps. An edit that breaks a view is one Back away from the last document
// that worked.
//
// The URL holds the whole document (`?doc=`), so an entry needs nothing else to be restored. Each
// entry is stamped with its depth, and the page remembers the depth it loaded at: Undo and Redo
// cover the changes made since this page load, and nothing before it — after a reload there is
// nothing to undo, and Undo never steps off the app. The browser's own Back and Forward still
// walk every entry, and restore each one's document. A tab switch rewrites the current entry rather than adding one, and
// going back keeps the tab the reader is on.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc } from "../../lib/types.ts";
import type { DocStore } from "./doc-store.ts";
import { readUrlJson } from "../../lib/url-json.ts";

const KEY = "labDepth";

export interface DocHistory {
  /** write `search` ("?…") as a new entry (an undoable change) or over the current one */
  record: (search: string, push: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const depthOf = (state: unknown): number | null => {
  const d = state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
  return typeof d === "number" ? d : null;
};

/** `?doc=` → the document it holds; null when there is none or it does not decode */
export function decodeDocParam(search: string): AnalysisDoc | null {
  return readUrlJson<AnalysisDoc>(new URLSearchParams(search).get("doc"));
}

export function useDocHistory(docs: DocStore, emptyDoc: AnalysisDoc, currentTab: () => string): DocHistory {
  const depth = useRef(0);
  /** the depth this page load started at: Undo goes no further back */
  const base = useRef(0);
  /** the furthest step made since then: Redo goes no further forward */
  const max = useRef(0);
  const [, render] = useState(0);
  const sync = () => render((n) => n + 1);

  useEffect(() => {
    // stamp the entry the page opened on, so coming back to it is recognised as ours
    depth.current = base.current = max.current = depthOf(history.state) ?? 0;
    try { history.replaceState({ ...(history.state || {}), [KEY]: depth.current }, "", location.href); } catch { /* history is a convenience */ }
    sync();

    const onPop = (e: PopStateEvent) => {
      const d = depthOf(e.state);
      if (d == null) return;
      depth.current = d;
      docs.restore(decodeDocParam(location.search) ?? emptyDoc);
      // the document goes back; the tab the reader is on stays
      try {
        const q = new URLSearchParams(location.search);
        q.set("tab", currentTab());
        history.replaceState({ ...(history.state || {}), [KEY]: d }, "", "?" + q.toString());
      } catch { /* as above */ }
      sync();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // a text field keeps its own undo
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { if (depth.current > base.current) { e.preventDefault(); history.back(); } }
      else if ((k === "z" && e.shiftKey) || k === "y") { if (depth.current >= base.current && depth.current < max.current) { e.preventDefault(); history.forward(); } }
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    record: (search, push) => {
      try {
        if (push) {
          depth.current += 1;
          max.current = depth.current;   // a new step drops whatever was ahead of it, as the browser does
          history.pushState({ ...(history.state || {}), [KEY]: depth.current }, "", search);
          sync();
        } else {
          history.replaceState({ ...(history.state || {}), [KEY]: depth.current }, "", search);
        }
      } catch { /* URL state is a convenience, never a failure */ }
    },
    undo: () => { if (depth.current > base.current) history.back(); },
    redo: () => { if (depth.current >= base.current && depth.current < max.current) history.forward(); },
    get canUndo() { return depth.current > base.current; },
    get canRedo() { return depth.current >= base.current && depth.current < max.current; },
  };
}
