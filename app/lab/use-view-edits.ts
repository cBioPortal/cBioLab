"use client";
// Editing the analysis document's views: add one (with defaults from what the study offers), remove,
// move, and change one's settings — `patchView`/`updateView` when the change re-runs it,
// `updateViewLocal` when the browser can apply it alone (use-analysis.ts leaves those out of its
// keys). Also what a view's header offers: which cohorts it may draw (cohortChoice). Every edit
// goes through the document store (doc-store.ts), so a view keeps its id and its card.
import { hasKindCard, defaultKindView, KIND_CARDS } from "./kind-cards";
import { pruneSort } from "../_oncoprint/OncoprintCard.tsx";
import type { GeneTrackSpec } from "../../lib/gene-tracks.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, OncoprintView } from "../../lib/types.ts";
import type { AddCohortTarget } from "./add-cohort-dialog.tsx";
import { expandSplits, type PartitionShape } from "../../lib/partition-arms.ts";
import { treatmentEventOf } from "../../lib/event-names.ts";
import { CohortNode } from "./view-chrome.tsx";

import type { DocStore } from "./doc-store.ts";

/** What useViewEdits needs from the analysis page. */
export interface ViewEditsPage {
  assayOptions: () => string[];
  busy: boolean;
  catalogAttrs: () => { attribute: string; kind: string; }[];
  contProfile: () => string | null;
  doc: AnalysisDoc;
  docs: DocStore;
  numericAttrs: () => string[];
  profileOptions: () => string[];
  result: AnalysisResult | null;
  viewAttrs: () => string[];
  viewEvents: () => { canonical: string; label: string; n: number; perPatient?: number; hasDurations?: boolean; }[];
  viewGenes: () => string[];
  viewIds: number[];
  VIEW_KINDS: { kind: string; label: string }[];
  /** open (a target) or close (null) the "+ Add cohort" dialog */
  setChooser: (t: AddCohortTarget | null) => void;
  setToast: (t: string | null) => void;
  study: string;
}

export function useViewEdits(page: ViewEditsPage) {
  const { assayOptions, busy, catalogAttrs, contProfile, doc, docs, numericAttrs, profileOptions, result, viewAttrs, viewEvents, viewGenes, viewIds, VIEW_KINDS, setChooser, setToast, study } = page;

  const viewTitle = (kind: string): string => (VIEW_KINDS.find((k) => k.kind === kind) || { label: kind }).label;
  /** the most cohorts a view of this kind draws at once (its cohorts menu enforces the same) */
  const maxCohortsOf = (kind: string): number | undefined =>
    hasKindCard(kind) ? KIND_CARDS[kind].maxCohorts
    : ["hotspots", "coexpression", "cooccurrence", "plot", "sequence"].includes(kind) ? 1
    : kind === "oncoprint" ? 4 : undefined;
  /** what an empty view of this kind will draw, said where its "+ Add cohort" is */
  const emptyViewHint = (kind: string): string => {
    const max = maxCohortsOf(kind), min = hasKindCard(kind) ? KIND_CARDS[kind].minCohorts : undefined;
    if (max === 1) return "It draws one cohort.";
    if (min && max) return "It compares " + (min === max ? "exactly " + min : min + " to " + max) + " cohorts.";
    if (max) return "It draws up to " + max + " cohorts, side by side.";
    return "Add one cohort, or several to compare them.";
  };

  /** Drop one view from the document. Removing a view can't change any OTHER
   *  view's answer — each view's result depends only on its own definition
   *  and the cohort definitions it draws from, neither of which removal
   *  touches — so this splices `result.views` locally instead of re-running
   *  everything, the same way moveView (below) already does. */
  const removeViews = (drop: (v: any, i: number) => boolean) => {
    const all = doc.views || [];
    const keep = all.map((v: any, j: number) => !drop(v, j));
    const views = all.filter((_: any, j: number) => keep[j]);
    docs.set({ ...doc, views });
  };
  const removeView = (i: number) => removeViews((_, j) => j === i);

  /** Swap a view with its neighbour. Order is cosmetic — the computed result for
   *  each view is unchanged, so this reorders `result.views` too rather than
   *  re-running the document just to move a card. */
  const moveView = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    const views = [...(doc.views || [])];
    if (j < 0 || j >= views.length) return;
    [views[i], views[j]] = [views[j], views[i]];
    docs.set({ ...doc, views });
  };

  const addView = (kind: string) => {
    const genes = viewGenes();
    const v: any =
      kind === "survival" ? { kind }
      : kind === "clinical" ? { kind, attributes: viewAttrs() }
      : kind === "coexpression" ? { kind, genes: genes.slice(0, 5), profileType: contProfile() }
      : kind === "hotspots" ? { kind, genes: genes.slice(0, 4), minCount: 1 }
      : kind === "plot" ? (() => {
          // start from two attributes this study actually declares, and fall back to an
          // alteration axis, which every study can answer
          const nums = numericAttrs();
          if (nums.length >= 2) return { kind, x: { source: "clinical", attribute: nums[0] }, y: { source: "clinical", attribute: nums[1] }, unit: "sample" };
          const cat = catalogAttrs().find((a) => a.kind !== "num");
          return { kind, unit: "sample",
            x: { source: "alteration", gene: genes[0] || "TP53", by: "mutationType" },
            y: cat ? { source: "clinical", attribute: cat.attribute } : { source: "alteration", gene: genes[1] || "KRAS", by: "mutated" } };
        })()
      : kind === "course" ? (() => {
          const evs = viewEvents();
          // Rank by STRUCTURE, not by how common the type is. Picking the two
          // commonest gives Sequencing and Sample acquisition on MSK-CHORD —
          // exactly one event per patient and no duration, i.e. filing records
          // that draw a spike and nothing else. A type that carries durations is
          // a state worth plotting; one that recurs is an event worth counting;
          // one that happens once per patient is neither.
          const tier = (e: any) => e.hasDurations ? 2 : (e.perPatient || 0) >= 1.5 ? 1 : 0;
          const ranked = [...evs].sort((a, b) => tier(b) - tier(a) || b.n - a.n);
          // The anchor wants the opposite property: a landmark nearly everyone
          // has. A therapy start is the classic one; failing that, the most
          // universal event.
          const anchorOn = evs.find(e => e.hasDurations)
            || [...evs].sort((a, b) => b.n - a.n)[0];
          return { kind, eventTypes: ranked.slice(0, 2).map(e => e.canonical),
                   ...(anchorOn ? { anchor: { eventType: anchorOn.label, occurrence: "FIRST" } } : {}),
                   binMonths: 3, fromMonths: -12, toMonths: 60 };
        })()
      : kind === "sequence" ? (() => {
          const tx = treatmentEventOf(viewEvents());
          return { kind, ...(tx ? { eventType: tx.canonical } : {}), labelKey: "SUBTYPE",
                   lineGap: 90, maxSteps: 3, topN: 8 };
        })()
      : kind === "cooccurrence" ? { kind, genes: genes.slice(0, 6) }
      : kind === "oncoprint" ? { kind, genes: genes.slice(0, 5) }
      : kind === "cox" ? { kind, covariates: [{ source: "alteration", gene: genes[0] || "TP53", by: "mutated" }] }
      : hasKindCard(kind) ? defaultKindView(kind, { genes, attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), events: viewEvents(), cohorts: [] })
      : kind === "logistic" ? { kind,
          outcome: { source: "alteration", gene: genes[0] || "TP53", by: "mutated" }, outcomeEvent: "Mutated",
          covariates: [{ source: "clinical", attribute: viewAttrs()[0] || "SEX" }] }
      : { kind, genes };
    // With one cohort in the document a new view draws it, unless the view needs more than one;
    // otherwise it draws nothing until a cohort is added to it (its card says so and offers one).
    // Every other card's answer is already cached under its key.
    const names = Object.keys(doc.cohorts || {});
    const min = (hasKindCard(kind) && KIND_CARDS[kind].minCohorts) || 1;
    docs.set({ ...doc, views: [{ ...v, cohorts: names.length === 1 && min <= 1 ? names : [] }, ...(doc.views || [])] });
  };

  /** Rewrite one view in the document; only its own query re-runs (use-analysis.ts) — editing this
   *  view's settings can't change any OTHER view's answer. */
  const patchView = (i: number, patch: Record<string, unknown>) => {
    // a new object at the same position keeps its view id (app/lab/doc-store.ts), so the card is not remounted
    const views = (doc.views || []).map((v: any, j: number) => j === i ? { ...v, ...patch } : v);
    for (const v of views as any[]) if (v.anchor == null) delete v.anchor;   // null means "study baseline"
    docs.set({ ...doc, views });
  };

  const updateView = (vi: number, patch: (v: any) => any) => {
    // the edited view keeps its id (app/lab/doc-store.ts): its card is not remounted, and the
    // re-run's answer finds its slot
    const views = (doc.views || []).map((v, i: number) => i === vi ? patch(v) : v);
    docs.set({ ...doc, views });
  };

  /**
   * A view change the browser can apply itself — how the oncoprint is drawn, not what it
   * draws. The document and the URL still record it, so the link, the server SVG, the CLI
   * and the Python package reproduce the same figure; only the round trip is skipped.
   */
  const updateViewLocal = (vi: number, patch: (v: any) => any) => {
    const views = (doc.views || []).map((v, i: number) => i === vi ? patch(v) : v);
    const d = { ...doc, views };
    docs.set(d);
  };
  /** Which cohorts a view draws, always by name. None left makes the view empty, waiting for one. */
  const setViewCohorts = (vi: number, names: string[], all: string[]) => updateView(vi, (v: any) => {
    const next = { ...v };
    next.cohorts = all.filter((n) => names.includes(n));
    // a document's splitBy targets the view's own single chosen cohort (it has no picker of its
    // own) — so narrowing to exactly one carries an existing splitBy along to it,
    // same attribute/gene/oql, rather than leaving it pointed at whatever it last targeted.
    if (next.splitBy && names.length === 1 && next.splitBy.cohort !== names[0])
      next.splitBy = { ...next.splitBy, cohort: names[0] };
    // a timeline's (or alterations view's) patient belongs to its cohort: another cohort starts at its own first patient
    if ((next.kind === "timeline" || next.kind === "alterations") && JSON.stringify(next.cohorts) !== JSON.stringify(v.cohorts)) delete next.patient;
    return next;
  });
  const setViewAttrs = (vi: number, attributes: string[]) => updateView(vi, (v: any) => ({ ...v, attributes }));

  const setViewGenes = (vi: number, genes: GeneTrackSpec[]) =>
    updateView(vi, v => pruneSort({ ...v, genes }));

  /** the document's view at vi, whatever its kind */
  const docView = (vi: number): any => ((doc.views || [])[vi] || {});

  /** what a view's cohort picker needs: today's choice, everything on offer, and where to write it */
  /** the document's splits as the engine sees them, from the last result */
  const partitionShapes = (): PartitionShape[] => Object.entries((result && result.splits) || {}).map(([name, p]) =>
    ({ name, of: p.of, comparable: p.children.filter((c) => c.role !== "notEvaluable").map((c) => c.name) }));
  const cohortChoice = (vi: number, v: any, max?: number) => {
    // On offer: each cohort, whole; under it each of its splits (drawn as its arms); under that
    // each arm, and any split of an arm, the same way. A view chooses any of them — a cohort and
    // its split can be drawn by different views, or side by side in one. "+ add a cohort…" at the
    // foot brings one in from the library or Explore.
    const shapes = partitionShapes();
    const authored = Object.keys(doc.cohorts || {});
    const nodes: CohortNode[] = [];
    const countOf = (n: string) => result?.cohorts[n]?.count ?? null;
    const offer = (n: string, label: string, kind: CohortNode["kind"], depth: number) => {
      if (result && !result.cohorts[n]) return;
      nodes.push({ name: n, label, kind, depth, count: countOf(n) });
      for (const p of shapes.filter((x) => x.of === n)) {
        nodes.push({ name: p.name, label: p.name.slice(n.length + 3), kind: "split", depth: depth + 1, count: countOf(n), groups: p.comparable.length });
        for (const c of p.comparable) offer(c, c.slice(p.name.length + 3), "arm", depth + 2);
      }
    };
    for (const n of authored) offer(n, n, "cohort", 0);
    const all = nodes.map((x) => x.name);
    let chosen = (Array.isArray(v.cohorts) ? v.cohorts : []).filter((n: string) => all.includes(n));
    // a view that draws one cohort draws the first group its list stands for: show that, not the list
    if (max === 1 && chosen.length) chosen = [expandSplits(chosen, shapes)[0]].filter((n) => all.includes(n));
    // what the view draws, in the order it colours them (the engine expands the list the same way)
    const drawn = expandSplits(chosen, shapes).filter((n) => !result || result.cohorts[n]);
    return { chosen, all, nodes, drawn, max, busy, viewKey: viewIds[vi] ?? vi, onChange: (next: string[]) => setViewCohorts(vi, next, all),
      onAdd: () => openCohortChooser(vi) };
  };

  /** What "+ Add cohort" on view vi adds to: the view by id, so an edit while the dialog is open cannot retarget it. */
  const cohortTarget = (vi: number): AddCohortTarget => {
    const v = docView(vi);
    return { viewId: viewIds[vi] ?? vi, title: viewTitle(v.kind), max: maxCohortsOf(v.kind),
      has: Array.isArray(v.cohorts) ? v.cohorts : [] };
  };
  function openCohortChooser(vi: number) { setChooser(cohortTarget(vi)); }
  /**
   * Put a cohort in a view: one of the analysis's by name, or a new one with its definition (from
   * the library or Explore), which joins the analysis's cohorts. A one-cohort view swaps; a view at
   * its limit refuses, saying so.
   */
  const addCohortToView = (target: AddCohortTarget, name: string, def?: CohortDef, studyHint?: string) => {
    const cur = docs.current.doc;
    const vi = docs.current.ids.indexOf(target.viewId);
    if (vi < 0) { setToast("That view was removed, so “" + name + "” was not added."); return; }
    const v: any = (cur.views || [])[vi];
    const has: string[] = Array.isArray(v.cohorts) ? v.cohorts : [];
    const max = maxCohortsOf(v.kind);
    if (max != null && max > 1 && has.length >= max && !has.includes(name)) {
      setToast(viewTitle(v.kind) + " draws at most " + max + " cohorts; untick one in its cohorts menu to add “" + name + "”.");
      return;
    }
    const cohorts = def && !cur.cohorts?.[name] ? { ...(cur.cohorts || {}), [name]: def } : (cur.cohorts || {});
    const list = max === 1 ? [name] : has.includes(name) ? has : [...has, name];
    const views = (cur.views || []).map((x: any, i: number) => i === vi ? { ...x, cohorts: list } : x);
    const firstStudy = def?.study || def?.studies?.[0] || studyHint || study;
    docs.set({ ...cur, ...(cur.study ? {} : { study: firstStudy }), cohorts, views });
    setChooser(null);
  };

  /** the view at index vi, read as an oncoprint view (its editor only renders there) */
  const ocView = (vi: number): OncoprintView => ((doc.views || [])[vi] || {}) as OncoprintView;

  return { removeViews, removeView, moveView, addView, patchView, updateView, updateViewLocal, setViewCohorts, setViewAttrs, setViewGenes, docView, partitionShapes, cohortChoice, ocView, viewTitle, maxCohortsOf, emptyViewHint, cohortTarget, openCohortChooser, addCohortToView };
}
