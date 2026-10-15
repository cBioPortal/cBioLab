// The analysis document's history: every change the reader makes is a browser history entry, so
// Back and Forward step through edits, and Undo / Redo (buttons, Ctrl/Cmd-Z, Shift-Ctrl/Cmd-Z or
// Ctrl-Y) are the same steps. An edit that breaks a view is one Back away from the last document
// that worked.
//
// The URL holds the whole document (`?doc=`), so an entry needs nothing else to be restored. Each
// entry is stamped with its depth — how many edits since this page was opened — which is what tells
// Undo it has reached the document the page opened with (it never steps off the app), and Redo
// whether a later step exists. A tab switch rewrites the current entry rather than adding one, and
// going back keeps the tab the reader is on.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc } from "../../lib/types.ts";
import type { DocStore } from "./doc-store.ts";

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
  const b64 = new URLSearchParams(search).get("doc");
  if (!b64) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); }
  catch { return null; }
}

export function useDocHistory(docs: DocStore, emptyDoc: AnalysisDoc, currentTab: () => string): DocHistory {
  const depth = useRef(0);
  const max = useRef(0);
  const [, render] = useState(0);
  const sync = () => render((n) => n + 1);

  useEffect(() => {
    // stamp the entry the page opened on, so coming back to it is recognised as ours
    depth.current = max.current = depthOf(history.state) ?? 0;
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
      if (k === "z" && !e.shiftKey) { if (depth.current > 0) { e.preventDefault(); history.back(); } }
      else if ((k === "z" && e.shiftKey) || k === "y") { if (depth.current < max.current) { e.preventDefault(); history.forward(); } }
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
    undo: () => { if (depth.current > 0) history.back(); },
    redo: () => { if (depth.current < max.current) history.forward(); },
    get canUndo() { return depth.current > 0; },
    get canRedo() { return depth.current < max.current; },
  };
}
