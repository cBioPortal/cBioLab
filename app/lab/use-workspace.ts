"use client";
// The analysis as a saved workspace: the workspace dialog (save under a name, open one, delete
// it), template parameters and notes, a view's note (which belongs to a saved analysis, so its
// menu item exists only once there is one), and clearing the page for a new analysis.
import { useState } from "react";
import { parameterize } from "../../lib/params.ts";
import type { AnalysisDoc } from "../../lib/types.ts";
import { EMPTY_DOC } from "./doc-store.ts";
import { ViewHead } from "./view-chrome.tsx";

import type { DocStore } from "./doc-store.ts";
import type { SavedWorkspace } from "./use-saved.ts";

/** What useWorkspace needs from the analysis page. */
export interface WorkspacePage {
  canSave: () => boolean;
  doc: AnalysisDoc;
  docs: DocStore;
  goTab: (t: "explore" | "cohorts" | "analysis" | "examples") => void;
  persistSpaces: (name: string, doc: AnalysisDoc) => Promise<void>;
  removeSpace: (name: string) => Promise<void>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setStudy: React.Dispatch<React.SetStateAction<string>>;
  spaces: Record<string, SavedWorkspace>;
  study: string;
}

export function useWorkspace(page: WorkspacePage) {
  const { canSave, doc, docs, goTab, persistSpaces, removeSpace, setError, setStudy, spaces, study } = page;

  const [wsOpen, setWsOpen] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  // ---- editing a view's note (the gear menu's "add note…" / "edit note…") -
  const [viewNoteEditing, setViewNoteEditing] = useState<number | null>(null); // index into doc.views / result.views
  // ---- workspaces ----------------------------------------------------------
  const openWorkspaceSave = () => {
    if (!canSave()) return;
    setWsOpen(true);
  };
  const confirmWorkspaceSave = async (name: string) => {
    const d = { ...doc, title: name };
    docs.set(d);
    setWsError(null);
    try {
      await persistSpaces(name, d);
    } catch (e) { setWsError("could not save: " + String((e as Error)?.message || e)); }
  };
  const openWorkspace = (name: string) => {
    const w = spaces[name];
    if (!w) return;
    const d = w.doc;
    docs.replace(d);
    setError(null);
    if (d.study) setStudy(d.study);
    goTab("analysis");
  };
  const deleteWorkspace = async (name: string) => {
    setWsError(null);
    try { await removeSpace(name); }
    catch (e) { setWsError("could not delete: " + String((e as Error)?.message || e)); }
  };
  /** Lift the study and a shared gene list into parameters — see lib/params.ts. */
  const makeTemplate = () => {
    // parameterize returns the AUTHORED form, where a `genes` field may hold
    // "$genes". The editor state is typed as the resolved document because
    // every other reader wants that; this is the one place a reference enters,
    // so it is the one place that says so.
    const d = parameterize(doc) as AnalysisDoc;
    if (d === doc) { setError("nothing to lift: a template needs a study, or a gene list that every gene view shares"); return; }
    setError(null);
    docs.set(d);
  };
  /** Change one parameter and re-run — the whole point of a template. */
  const setParam = (key: string, value: unknown) => {
    const d = { ...doc, params: { ...(doc.params || {}), [key]: value } };
    docs.set(d);
  };
  const setNotes = (text: string) => {
    const d = { ...doc, notes: text };
    docs.set(d);   // no re-run: prose changes no numbers
  };

  /** the analysis exists as a saved workspace — what a view's note, like a cohort's, belongs to */
  const analysisSaved = !!(doc.title && spaces[doc.title]);
  /** a view's note belongs to a saved analysis, so its menu item exists only once there is one */
  const noteEdit = (vi: number) => analysisSaved ? () => openViewNoteEdit(vi) : undefined;
  const openViewNoteEdit = (vi: number) => {
    if (!analysisSaved) return;
    setViewNoteEditing(vi);
  };

  /** A view's note is exactly like a cohort's or the workspace's: prose the
   *  server never computes anything from, so this never re-runs — it patches
   *  `doc.views[vi].note` (what gets saved/shared) AND mirrors the same text
   *  straight into `result.views[vi].annotationNote` (what ViewHead actually
   *  reads to display it), since nothing else would otherwise tell the
   *  already-rendered card that its own annotation changed. */
  const confirmViewNoteEdit = (trimmed: string) => {
    if (viewNoteEditing == null) return;
    const vi = viewNoteEditing;
    const views = (doc.views || []).map((v: any, i: number) => {
      if (i !== vi) return v;
      const nv = { ...v };
      if (trimmed) nv.note = trimmed; else delete nv.note;
      return nv;
    });
    // the note is read from the document (use-analysis.ts): nothing re-runs
    docs.set({ ...doc, views });
  };

  const clearAnalysis = () => {
    const d = { ...EMPTY_DOC, study };
    docs.set(d); setError(null);
  };

  return { wsOpen, setWsOpen, wsError, setWsError, viewNoteEditing, setViewNoteEditing, openWorkspaceSave, confirmWorkspaceSave, openWorkspace, deleteWorkspace, makeTemplate, setParam, setNotes, analysisSaved, noteEdit, openViewNoteEdit, confirmViewNoteEdit, clearAnalysis };
}
