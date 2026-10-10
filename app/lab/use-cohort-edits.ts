"use client";
// Editing the analysis document's cohorts: rename and note one (the cohort dialog), remove one,
// split one into arms (lib/partition-arms.ts) and edit those splits, make a cohort from an
// oncoprint drag, and freeze a selection into a custom-data feature. Also which studies the
// open analysis reads, for add-cohort mode. A rename carries every view's reference along.
import { useState } from "react";
import type { ColumnSelection } from "../_oncoprint/OncoprintFigure.tsx";
import type { AnalysisDoc, CohortDef, PartitionDef } from "../../lib/types.ts";
import type { SplitSpec } from "./partitions.tsx";
import { withoutPartition, renamePartitionChild, flattenSplits, editSplits, splitKey, renameInViews } from "../../lib/partition-arms.ts";
import { saveToServer, featureFromColumns, type StoredDataset } from "./custom-data-client.ts";
import { api } from "./api.ts";

import type { DocStore } from "./doc-store.ts";

/** What useCohortEdits needs from the analysis page. */
export interface CohortEditsPage {
  doc: AnalysisDoc;
  docs: DocStore;
  proposePartition: (req: { doc: AnalysisDoc; cohort: string; attribute?: string; gene?: string; oql?: string[]; name?: string; maxArms?: number; minCount?: number; }) => Promise<{ name: string; def: PartitionDef; note?: string; }>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setToast: React.Dispatch<React.SetStateAction<string | null>>;
  study: string;
}

export function useCohortEdits(page: CohortEditsPage) {
  const { doc, docs, proposePartition, setError, setToast, study } = page;

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
    const d: AnalysisDoc = { ...doc, cohorts: { ...doc.cohorts, [name]: { all: [{ kind: "patientList", ids: qualified }] } } };
    docs.set(d);
  };

  const removeCohort = (name: string) => {
    // its splits go with it (they are stored on it), and so does every view reference to their arms
    const base: AnalysisDoc = doc;
    const cs = { ...base.cohorts }; delete cs[name];
    // views naming the cohort explicitly drop it; a view with no cohorts left goes too
    const views = (base.views || [])
      .map(v => Array.isArray(v.cohorts) ? { ...v, cohorts: v.cohorts.filter(c => c !== name && !c.startsWith(name + " / ")) } : v)
      .filter(v => !Array.isArray(v.cohorts) || v.cohorts.length);
    const d = { ...base, cohorts: cs, views };
    docs.set(d);
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
    const authored = Object.keys(doc.cohorts || {});
    const views = (withSplit.views || []).map((v) => {
      const list = Array.isArray(v.cohorts) && v.cohorts.length ? v.cohorts : authored;
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

  return { cohortEditing, setCohortEditing, featureSaved, featureFromSelection, cohortFromSelection, removeCohort, runEdited, splitsFlat, setPartitionDef, removePartitionNamed, renamePartitionRow, splitCohortBy, analysisStudies, openCohortEdit, confirmCohortEdit };
}
