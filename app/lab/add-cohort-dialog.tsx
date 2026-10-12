"use client";
// "+ Add cohort" on a view: one dialog with the three places a cohort comes from — the analysis's
// own cohorts, the library (the login's saved cohorts and the built-in examples), and Explore,
// where a new one is built and comes back to this view.
import { useEffect, useRef, useState } from "react";
import type { CohortDef } from "../../lib/types.ts";
import { cohortHash } from "../../lib/cohort-hash.ts";
import CohortPills from "./pills";
import { CAT_COLORS } from "./view-chrome.tsx";

export interface AddCohortTarget {
  /** the view's id in the doc store: an edit made while the dialog is open cannot retarget it */
  viewId: number;
  title: string;
  /** the most cohorts this view draws at once, when it has a limit */
  max?: number;
  /** the cohorts it draws now */
  has: string[];
}

export interface LibraryState {
  /** saved cohorts are the login's: "locked" when logged out, "off" where there is no login */
  saved: "off" | "locked" | "loading" | "ready" | "error";
  savedError?: string | null;
  /** the login's saved cohorts: `id` is the artifact's, which survives a rename */
  cohorts: { id: string; name: string; def: CohortDef; savedAt: string }[];
  examples: { name: string; desc: string; def: CohortDef }[];
}

type Source = "analysis" | "library" | "explore";

export function AddCohortDialog({ target, analysis, library, onAdd, onExplore, onLogin, onClose }: {
  target: AddCohortTarget | null;
  /** the analysis's cohorts in its order (the colour each has in its summary), with their sizes once known */
  analysis: { name: string; def: CohortDef; count: number | null; views: string[] }[];
  library: LibraryState;
  /** add a cohort to the view: an analysis cohort by name, or a library one with its definition */
  onAdd: (name: string, def?: CohortDef) => void;
  onExplore: () => void;
  onLogin: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Source>("analysis");
  const [q, setQ] = useState("");
  const available = target ? analysis.filter((c) => !target.has.includes(c.name)) : [];
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (target && !d.open) {
      setQ("");
      setSource(analysis.some((c) => !target.has.includes(c.name)) ? "analysis" : "library");
      d.showModal();
    }
    if (!target && d.open) d.close();
  }, [target]); // eslint-disable-line

  const full = !!target && target.max != null && target.max > 1 && target.has.length >= target.max;
  const replaces = !!target && target.max === 1 && target.has.length > 0;
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const taken = new Map(analysis.map((c) => [c.name, c.def] as const));
  /** a library cohort whose name the analysis already uses for a different definition is added under a new name;
   *  the same definition (by hash, so a copy carrying notes or its source still matches) is reused */
  const libraryName = (name: string, def: CohortDef) => {
    const want = cohortHash(def);
    const same = (d?: CohortDef) => !!d && cohortHash(d) === want;
    if (!taken.has(name) || same(taken.get(name))) return name;
    for (let i = 2; ; i++) if (!taken.has(name + " (" + i + ")") || same(taken.get(name + " (" + i + ")"))) return name + " (" + i + ")";
  };
  const addTitle = (what: string) => full ? "this view draws at most " + target!.max + " cohorts — remove one in its cohorts menu first"
    : replaces ? "this view draws one cohort — this replaces “" + target!.has[0] + "”" : "add " + what + " to this view";
  const libraryRow = (name: string, def: CohortDef, desc?: string, source?: { id: string; savedAt: string }) => {
    const as = libraryName(name, def);
    // a saved cohort's copy records where it came from and what it was, so the analysis can later
    // tell that the saved one has changed and offer the new version (lib/cohort-hash.ts)
    const copy: CohortDef = source ? { ...def, from: { saved: source.id, name, hash: cohortHash(def), savedAt: source.savedAt } } : def;
    return (
      <li key={name} className="acd-row">
        <div className="acd-main">
          <div className="acd-name">{name}{as !== name && <span className="meta"> — added as “{as}”, since this analysis already has a different “{name}”</span>}</div>
          <div className="meta" title={desc}>{desc}</div>
          <div className="acd-def"><CohortPills def={def} /></div>
        </div>
        <button className="tbbtn" disabled={full} title={addTitle("“" + as + "”")} onClick={() => onAdd(as, copy)}>{replaces ? "Use" : "Add"}</button>
      </li>
    );
  };
  const saved = library.cohorts.filter((c) => match(c.name));
  const examples = library.examples.filter((c) => match(c.name) || match(c.desc));

  return (
    <dialog ref={ref} className="namedialog addcohortdialog" aria-label="add a cohort to this view"
      onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      {target && <>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h3>Add a cohort to <span className="plain">{target.title}</span></h3>
          <button className="linklike" onClick={() => ref.current?.close()}>close</button>
        </div>
        {(full || replaces) && <p className="note" style={{ marginTop: 0 }}>
          {full ? "This view already draws its maximum of " + target.max + " cohorts — untick one in its cohorts menu to add another."
            : "This view draws one cohort, so the one you pick replaces “" + target.has[0] + "”."}
        </p>}
        <div className="tabs acd-tabs" role="tablist">
          <button role="tab" aria-selected={source === "analysis"} className={source === "analysis" ? "active" : ""} onClick={() => setSource("analysis")}>
            In this analysis <span className="meta">{available.length}</span></button>
          <button role="tab" aria-selected={source === "library"} className={source === "library" ? "active" : ""} onClick={() => setSource("library")}>
            Library</button>
          <button role="tab" aria-selected={source === "explore"} className={source === "explore" ? "active" : ""} onClick={() => setSource("explore")}>
            Build in Explore</button>
        </div>

        {source === "analysis" && (available.length ? (
          <ul className="acd-list">
            {available.map((c) => (
              <li key={c.name} className="acd-row">
                <div className="acd-main">
                  <div className="acd-name">
                    <span className="cohortswatch" aria-hidden="true" style={{ background: CAT_COLORS[analysis.indexOf(c) % CAT_COLORS.length] }} />
                    {c.name} {c.count != null && <><strong>{c.count.toLocaleString()}</strong> <span className="meta">patients</span></>}
                  </div>
                  <div className="meta" title={c.views.join(", ")}>{c.views.length ? "in " + c.views.join(", ") : "in no view yet"}</div>
                  <div className="acd-def"><CohortPills def={c.def} /></div>
                </div>
                <button className="tbbtn" disabled={full} title={addTitle("“" + c.name + "”")} onClick={() => onAdd(c.name)}>{replaces ? "Use" : "Add"}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">{analysis.length
            ? "This view already draws every cohort in the analysis. Pick one from the library, or build a new one in Explore."
            : "This analysis has no cohorts yet. Pick one from the library, or build one in Explore."}</p>
        ))}

        {source === "library" && <>
          <input className="acd-search" placeholder="search the library…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <h4 className="acd-h">Your saved cohorts</h4>
          {library.saved === "off" ? <p className="note">This deployment has no login, so it keeps no saved cohorts.</p>
            : library.saved === "locked" ? <p className="note"><button className="linklike" onClick={onLogin}>Log in</button> to see your saved cohorts.</p>
            : library.saved === "loading" ? <p className="note"><span className="spinner" /> loading your saved cohorts…</p>
            : library.saved === "error" ? <p className="error">Your saved cohorts could not be loaded: {library.savedError || "unknown error"}</p>
            : !library.cohorts.length ? <p className="note">You have no saved cohorts yet — save one from Explore (“Save as a cohort”).</p>
            : !saved.length ? <p className="note">No saved cohort matches “{q}”.</p>
            : <ul className="acd-list">{saved.map((c) => libraryRow(c.name, c.def, "saved " + c.savedAt, { id: c.id, savedAt: c.savedAt }))}</ul>}
          <h4 className="acd-h">Examples</h4>
          {examples.length ? <ul className="acd-list">{examples.map((c) => libraryRow(c.name, c.def, c.desc))}</ul>
            : <p className="note">No example matches “{q}”.</p>}
        </>}

        {source === "explore" && (
          <div className="acd-explore">
            <p className="note" style={{ marginTop: 0 }}>
              Explore opens over this analysis with the studies it already uses. Filter with its charts, name the
              selection, and it comes back as a cohort of <strong>{target.title}</strong>; Cancel returns here with nothing added.
            </p>
            <button className="primary" disabled={full} title={full ? addTitle("") : undefined} onClick={onExplore}>Open Explore</button>
          </div>
        )}
      </>}
    </dialog>
  );
}
