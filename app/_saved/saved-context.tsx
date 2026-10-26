"use client";
// The reader's saved work, opened from anywhere: a dialog on any page, on the tab the moment calls
// for (`useSaved().open("groups")`, or `?saved=groups` in any page's link), and the same manager
// as its own page at /saved. Opening something saved acts on the page it was opened from when that
// page can (the lab opens an analysis in place, `useSavedActions`); anywhere else it is a link to
// the lab.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisDoc } from "../../lib/types.ts";
import type { OnCustomData } from "../lab/pills.tsx";
import { encodeParam } from "../portal/page-doc.ts";
import { SavedDialog } from "./saved-manager.tsx";
import { isSavedTab, type SavedTab } from "./saved-tabs.ts";


/** What opening something saved does where the manager was opened. */
export interface SavedActions {
  /** an analysis to work on: one saved, or cohorts ticked to analyse together */
  openDoc: (doc: AnalysisDoc) => void;
  /** a working copy of an analysis someone shared, which may save back to theirs */
  openShared: (id: string) => void;
  /** a cohort's clause on uploaded data, shown with the rows behind it (the lab only) */
  showClauseData?: (cohort: string) => OnCustomData;
  /** an upload was added, changed or deleted (the lab re-reads Explore's attributes) */
  onDataChanged?: () => void;
  /** add an upload (the lab opens Custom data → Add data on the studies explored) */
  addData?: () => void;
  /** one of the reader's saved cohorts, by id, in Explore to change its filters */
  editCohort: (id: string) => void;
}

const labHref = (params: Record<string, string>) => "/lab?" + new URLSearchParams(params).toString();
/** Away from the lab, opening is a link to it. */
export const LINK_ACTIONS: SavedActions = {
  openDoc: (doc) => location.assign(labHref({ tab: "analysis", doc: encodeParam(doc) })),
  openShared: (id) => location.assign(labHref({ tab: "analysis", shared: id })),
  addData: () => location.assign(labHref({ tab: "explore" })),
  editCohort: (id) => location.assign(labHref({ tab: "explore", editCohort: id })),
};

interface SavedCtx {
  open: (tab: SavedTab, note?: string) => void;
  close: () => void;
  /** the page's own actions, while it is mounted (useSavedActions) */
  actions: SavedActions;
  setActions: (a: SavedActions | null) => void;
}
const Ctx = createContext<SavedCtx | null>(null);

export function SavedProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<SavedTab | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [own, setOwn] = useState<SavedActions | null>(null);
  const open = useCallback((t: SavedTab, n?: string) => { setTab(t); setNote(n ?? null); }, []);
  const close = useCallback(() => { setTab(null); setNote(null); }, []);
  const value = useMemo(() => ({ open, close, actions: own ?? LINK_ACTIONS, setActions: setOwn }), [open, close, own]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <SavedDialog tab={tab} note={note} onTab={(t) => { setTab(t); setNote(null); }} onClose={close} />
    </Ctx.Provider>
  );
}

export function useSaved(): SavedCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSaved outside SavedProvider (app/layout.tsx)");
  return c;
}

/** A page that can open saved things in place says how, for as long as it is mounted. */
export function useSavedActions(actions: SavedActions) {
  const { setActions } = useSaved();
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    setActions({
      openDoc: (d) => latest.current.openDoc(d),
      openShared: (id) => latest.current.openShared(id),
      showClauseData: (c) => latest.current.showClauseData?.(c) ?? (() => {}),
      onDataChanged: () => latest.current.onDataChanged?.(),
      addData: () => latest.current.addData?.(),
      editCohort: (id) => latest.current.editCohort(id),
    });
    return () => setActions(null);
  }, [setActions]);
}

/**
 * `?saved=<tab>` in a page's link opens the manager on that tab, once; the parameter is then dropped
 * so a reload does not reopen it. Called from the page's own content (the site header), so it runs
 * once that content has hydrated: an open dialog hides the rest of the page from assistive tech, and
 * doing that to parts not yet hydrated breaks their hydration.
 */
export function useOpenSavedFromUrl() {
  const { open } = useSaved();
  useEffect(() => {
    const u = new URL(location.href), t = u.searchParams.get("saved");
    if (!isSavedTab(t)) return;
    u.searchParams.delete("saved");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    open(t);
  }, [open]);
}
