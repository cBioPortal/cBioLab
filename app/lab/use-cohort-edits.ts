"use client";
// Editing the analysis document's cohorts: rename and note one (the cohort dialog), remove one,
// split one into arms (lib/partition-arms.ts) and edit those splits, make a cohort from an
// oncoprint drag, and freeze a selection into a custom-data feature. Also which studies the
// open analysis reads, for add-cohort mode. A rename carries every view's reference along.
import { useState } from "react";
import type { ColumnSelection } from "../_oncoprint/OncoprintFigure.tsx";
import type { AnalysisDoc, CohortDef, CohortSource, PartitionDef } from "../../lib/types.ts";
import { canonicalSplits, cohortHash } from "../../lib/cohort-hash.ts";
import type { SavedCohort } from "./use-saved.ts";
import type { SplitSpec } from "./partitions.tsx";
import { withoutPartition, renamePartitionChild, flattenSplits, editSplits, splitKey, renameInViews } from "../../lib/partition-arms.ts";
import { saveToServer, featureFromColumns, type StoredDataset } from "./custom-data-client.ts";
import { api } from "./api.ts";
import { cellExplorerFor, type CellExplorerDataset } from "../../lib/cell-explorer.ts";

import type { DocStore } from "./doc-store.ts";

/** A copied cohort against the saved cohort it came from: changed since, deleted, current — or unknown, while logged out or loading. */
export type CohortSourceState = {
  from: CohortSource; edited: boolean; state: "unknown" | "deleted" | "current" | "changed";
  /** the saved cohort's name, definition hash and entry now (current or changed only) */
  srcName?: string; now?: string; src?: SavedCohort;
};

/** What saving a cohort to the library would do: make a new saved cohort, or write over saved cohort `id`; saved as `as`. */
export type CohortSaveState = { action: "create" | "update"; id?: string; as: string };

/** What useCohortEdits needs from the analysis page. */
export interface CohortEditsPage {
  doc: AnalysisDoc;
  docs: DocStore;
  proposePartition: (req: { doc: AnalysisDoc; cohort: string; attribute?: string; gene?: string; oql?: string[]; name?: string; maxArms?: number; minCount?: number; }) => Promise<{ name: string; def: PartitionDef; note?: string; }>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setToast: React.Dispatch<React.SetStateAction<string | null>>;
  study: string;
  /** the login's saved cohorts, and whether they have arrived */
  saved: Record<string, SavedCohort>;
  savedReady: boolean;
  /** a cohort's inline id lists stored as id sets, where the reader is signed in (id-sets-client.ts) */
  storeLists: (def: CohortDef, name: string) => Promise<CohortDef>;
  persist: (name: string, def: CohortDef, lastEval: SavedCohort["lastEval"], id?: string) => Promise<SavedCohort>;
  /** a cohort's last evaluation, kept with it when saved */
  evalOf: (name: string) => SavedCohort["lastEval"];
}

export function useCohortEdits(page: CohortEditsPage) {
  const { doc, docs, evalOf, persist, proposePartition, saved, savedReady, setError, setToast, storeLists, study } = page;

  // ---- editing a cohort's name/note (the gear menu's "edit…") -------------
  const [cohortEditing, setCohortEditing] = useState<string | null>(null); // the name AS IT IS in doc.cohorts right now

  // ---- save as feature: a selection frozen into a yes/no custom attribute ----
  const featureSaved = (d: StoredDataset) => {
    const yes = d.rows.filter((r) => r.values[0] === "Yes").length;
    return "saved feature \u201c" + d.name + "\u201d (custom:" + d.id + "/" + d.columns[0].name + "): " +
      yes.toLocaleString() + " " + d.level + "s Yes, " + (d.rows.length - yes).toLocaleString() + " No";
  };
  const featureFromSelection = async (sel: ColumnSelection, all: string[], studies: string[]) => {
    const d = await featureFromColumns(sel.name || "selection", sel.unit, sel.ids, all, studies);
    await saveToServer(d);
    setToast(featureSaved(d) + " \u2014 add it as a track, a split or a filter like any attribute");
    setTimeout(() => setToast(null), 6000);
  };

  /**
   * A drag across an oncoprint becomes a cohort of exactly those patients — an explicit list,
   * not a rule, so the document says plainly that it was picked by hand.
   *
   * Sample columns are resolved to their patients first: a cohort selects patients, so a
   * cohort named from a sample selection carries those patients (and therefore their other
   * samples too). Throwing is how the figure's dialog is told why it cannot be done.
   */
  const cohortFromSelection = async (sel: ColumnSelection, studies: string[]) => {
    const one = studies.length === 1 ? studies[0] : null;
    if (!one) throw new Error("a cohort is evaluated against one study; this figure pools " +
      studies.length + " (" + studies.join(", ") + "), and the columns are study-qualified — select within a single-study figure");
    let ids = sel.ids;
    if (sel.unit === "sample") {
      const res = await api.patientsOf({ study: one, samples: ids });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || res.statusText);
      ids = j.patients as string[];
      if (!ids.length) throw new Error("no patients found for those samples");
    }
    const taken = new Set(Object.keys(doc.cohorts || {}));
    let name = sel.name || "selection";
    for (let i = 2; taken.has(name); i++) name = (sel.name || "selection") + " " + i;
    const qualified = ids.map(id => one + ":" + id);
    const def = await storeLists({ all: [{ kind: "patientList", ids: qualified }] }, name);
    const now = docs.current.doc;
    docs.set({ ...now, cohorts: { ...now.cohorts, [name]: def } });
  };

  const removeCohort = (name: string) => {
    // its splits go with it (they are stored on it), and so does every view reference to their arms
    const base: AnalysisDoc = doc;
    const cs = { ...base.cohorts }; delete cs[name];
    // every view drawing it drops it; a view with none left stays, empty, waiting for a cohort
    const views = (base.views || [])
      .map(v => Array.isArray(v.cohorts) ? { ...v, cohorts: v.cohorts.filter(c => c !== name && !c.startsWith(name + " / ")) } : v);
    const d = { ...base, cohorts: cs, views };
    docs.set(d);
  };

  /**
   * Where a copied cohort stands against the saved cohort it came from (`from`, by the saved
   * cohort's id and the hash of what was copied): the saved one changed since, the copy was edited
   * here, the saved one is gone — or unknown, while logged out or still loading.
   */
  const cohortSource = (name: string): CohortSourceState | null => {
    const def = doc.cohorts?.[name];
    const from = def?.from;
    if (!def || !from) return null;
    const edited = cohortHash(def) !== from.hash;
    if (!savedReady) return { from, edited, state: "unknown" };
    const hit = Object.entries(saved).find(([, x]) => x.id === from.saved);
    if (!hit) return { from, edited, state: "deleted" };
    const [srcName, src] = hit;
    const now = cohortHash(src.def);
    return { from, edited, state: now === from.hash ? "current" : "changed", srcName, now, src };
  };
  /** Replace a copy with its saved cohort's current definition; the copy keeps its name here, its note and its splits. */
  const updateFromSaved = (name: string) => {
    const s = cohortSource(name);
    if (!s || !s.src || !(s.state === "changed" || (s.state === "current" && s.edited))) return;
    const cur = doc.cohorts![name];
    const next: CohortDef = { ...s.src.def, ...(cur.notes ? { notes: cur.notes } : {}), ...(cur.splits ? { splits: cur.splits } : {}),
      from: { saved: s.from.saved, name: s.srcName!, hash: s.now!, savedAt: s.src.savedAt } };
    docs.set({ ...doc, cohorts: { ...doc.cohorts, [name]: next } });
  };

  /**
   * Whether a cohort has anything to save to the library, and where it would go — null when there
   * is nothing to save, or while the saved cohorts are not known (logged out, loading). A cohort
   * copied from a saved one saves back over it once edited here or re-split; one whose saved
   * version has changed since is not offered, since saving would discard that change. A cohort
   * with no source matches a saved cohort by name.
   */
  const cohortSaveState = (name: string): CohortSaveState | null => {
    const def = doc.cohorts?.[name];
    if (!def || !savedReady) return null;
    const s = cohortSource(name);
    if (s) {
      if (s.state === "deleted") return { action: "create", as: name };
      if (s.state !== "current") return null;
      return s.edited || canonicalSplits(def) !== canonicalSplits(s.src!.def) ? { action: "update", id: s.src!.id, as: s.srcName! } : null;
    }
    const same = saved[name];
    if (!same) return { action: "create", as: name };
    return cohortHash(def) !== cohortHash(same.def) || canonicalSplits(def) !== canonicalSplits(same.def)
      ? { action: "update", id: same.id, as: name } : null;
  };
  /** Save a cohort to the library (cohortSaveState says where); the analysis's copy then names it as its source. */
  const saveCohortToLibrary = async (name: string) => {
    const st = cohortSaveState(name);
    const cur = doc.cohorts?.[name];
    if (!st || !cur) return;
    const { from: _from, ...def } = cur;
    try {
      const c = await persist(st.as, def, evalOf(name), st.id);
      const now = docs.current.doc;
      if (now.cohorts?.[name]) {
        // bookkeeping after a save, not an edit the reader would undo. What was saved may differ from
        // what was asked by its id lists, now stored as sets: the copy takes those too.
        const kept = cohortHash(c.def) === cohortHash(def) ? now.cohorts[name] : { ...c.def };
        docs.set({ ...now, cohorts: { ...now.cohorts, [name]: { ...kept, from: { saved: c.id, name: st.as, hash: cohortHash(c.def), savedAt: c.savedAt } } } }, { undoable: false });
      }
    } catch (e: any) {
      setError("could not save \u201c" + name + "\u201d: " + (e?.message || e));
    }
  };

  // ---- partitions: a cohort split into arms that add up to it ------------------------------
  const runEdited = (d: AnalysisDoc) => { docs.set(d); };
  // the page edits splits in their flat form (keyed "<cohort> / <split>") and writes them back
  // onto their cohorts as a tree (editSplits)
  const splitsFlat = () => flattenSplits(doc.cohorts || {});
  const setPartitionDef = (name: string, def: PartitionDef) =>
    runEdited(editSplits(doc, (f) => ({ ...f, partitions: { ...f.partitions, [name]: def } })));
  const removePartitionNamed = (name: string) => runEdited(editSplits(doc, (f) => withoutPartition(f, name).doc));
  const renamePartitionRow = (name: string, from: string, to: string) => {
    try { runEdited(editSplits(doc, (f) => renamePartitionChild(f, name, from, to))); }
    catch (e) { setError(String((e as Error)?.message || e)); }
  };
  /** Split a cohort (or an arm) by what the server proposes from the data, and switch the views
   *  that were showing only it to the new split — an edit to their lists, which each view's
   *  cohorts menu can change back. */
  const splitCohortBy = async (cohort: string, spec: SplitSpec) => {
    const { name, def } = await proposePartition({ doc, cohort, ...spec });
    const key = splitKey(cohort, name);
    const withSplit = editSplits(doc, (f) => ({ ...f, partitions: { ...f.partitions, [key]: { ...def, split: name } } }));
    // only a view showing just this cohort switches: one showing other cohorts too would then mix
    // whole cohorts with a split's groups, which a view does not draw
    const views = (withSplit.views || []).map((v) => {
      const list = Array.isArray(v.cohorts) ? v.cohorts : [];
      return list.length === 1 && list[0] === cohort ? { ...v, cohorts: [key] } : v;
    });
    runEdited({ ...withSplit, views });
  };

  // ---- "+ Add cohort": Explore over the analysis, adding to it instead of replacing it ---------
  /** the studies the analysis already uses: its default study and every cohort's own */
  const analysisStudies = (): string[] => {
    const ids = new Set<string>();
    if (doc.study) ids.add(doc.study);
    for (const c of Object.values(doc.cohorts || {})) {
      if (c.study) ids.add(c.study);
      for (const st of c.studies || []) ids.add(st);
    }
    if (!ids.size && study) ids.add(study);
    return [...ids];
  };

  const openCohortEdit = (name: string) => {
    setCohortEditing(name);
  };

  /** Rename a cohort and/or change its note, from the gear menu's "edit…" dialog.
   *  Renaming rewrites every `view.cohorts` reference too, so a view already
   *  scoped to this cohort keeps drawing it under its new name — and since
   *  the server keys everything (result.cohorts, every row/curve) by name,
   *  a rename re-runs the analysis, unlike a note-only edit, which changes no
   *  number and so re-runs nothing (use-analysis.ts leaves notes out of its keys). */
  const confirmCohortEdit = (newName: string, notes: string) => {
    if (!cohortEditing) return;
    const oldName = cohortEditing;
    const nextCohorts: Record<string, CohortDef> = {};
    for (const [k, v] of Object.entries(doc.cohorts || {})) {
      nextCohorts[k === oldName ? newName : k] = k === oldName ? { ...v, notes } : v;
    }
    if (newName === oldName) {
      // a note-only edit re-runs nothing, so nothing else would put it in the shareable link
      const d = { ...doc, cohorts: nextCohorts };
      docs.set(d);
      return;
    }
    // its splits travel with it; their arms are named after it, so views naming them follow too
    const views = renameInViews(doc.views, oldName, newName) as AnalysisDoc["views"];
    const d = { ...doc, cohorts: nextCohorts, views };
    docs.set(d);
  };

  // ---- a cohort's cells in Cell Explorer ----------------------------------
  /** the single-cell dataset a cohort's patients can be opened in, or null */
  const cohortCells = (name: string): CellExplorerDataset | null =>
    cellExplorerFor((doc.cohorts?.[name] as (CohortDef & { study?: string }) | undefined)?.study || doc.study || study);
  /** open the cohort's donors' cells in a new tab: the tab opens on the click (a later one is a blocked pop-up), the link follows */
  const openCohortCells = async (name: string) => {
    const w = window.open("about:blank", "_blank");
    try {
      const j = await (await api.cellExplorer({ mode: "link", doc, cohort: name })).json();
      if (j.error) throw new Error(j.error);
      if (w) { w.opener = null; w.location.href = j.url; } else window.open(j.url, "_blank", "noopener");
      setToast("“" + name + "”: " + j.donors.toLocaleString() + " of its " + j.patients.toLocaleString() + " patients " +
        (j.donorsChecked ? "have cells in " + j.label + " — opened in Cell Explorer" : "opened in Cell Explorer (its donor list could not be checked)"));
      setTimeout(() => setToast(null), 6000);
    } catch (e) {
      w?.close();
      setError("Cell Explorer: " + String((e as Error)?.message || e));
    }
  };

  return { cohortEditing, setCohortEditing, featureSaved, featureFromSelection, cohortFromSelection, removeCohort, runEdited, splitsFlat, setPartitionDef, removePartitionNamed, renamePartitionRow, splitCohortBy, analysisStudies, openCohortEdit, confirmCohortEdit, cohortSource, updateFromSaved, cohortSaveState, saveCohortToLibrary, cohortCells, openCohortCells };
}
