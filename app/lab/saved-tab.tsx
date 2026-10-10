"use client";
// The Saved tab: the example cohorts and the reader's saved cohorts, ticked to analyse together,
// and their saved analyses. What it holds across a tab switch (the ticks, the previews, the
// sub-tab) belongs to the page, which keeps it while this unmounts.
import CohortPills, { type OnCustomData } from "./pills";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import type { ServerState } from "./custom-data-client.ts";
import type { CohortDef } from "../../lib/types.ts";
import type { ListState, SavedArtifacts } from "./use-saved.ts";

export type ExampleCohort = { name: string; desc: string; def: CohortDef };
export type ExampleEval = { count?: number; error?: string; busy?: boolean } | null;

const SHARED = "everyone who logs in sees these: one shared login, no per-user ownership yet";

/** A list that is loading or failed says so; only a loaded one may be empty. */
function ListStatus({ state, what, empty, isEmpty }: { state: ListState; what: string; empty: string; isEmpty: boolean }) {
  if (state.pending) return <p className="note"><Waiting what={what} /></p>;
  if (state.error) return <p className="error">could not load {what}: {state.error}{" "}
    <button className="linklike" onClick={state.retry}>retry</button></p>;
  return isEmpty ? <p className="note">{empty}</p> : null;
}

export function SavedTab({
  login, onLogin, sub, onSub, examples, picked, onTogglePick, onClearPicked, onAnalyze,
  evals, onPreview, onSaveExample, saved, onOpenWorkspace, onDeleteWorkspace, wsError, onCustomData,
}: {
  login: ServerState;
  onLogin: () => void;
  sub: "cohorts" | "analyses";
  onSub: (s: "cohorts" | "analyses") => void;
  examples: ExampleCohort[];
  /** keys "ex:<name>" / "saved:<name>" */
  picked: string[];
  onTogglePick: (key: string) => void;
  onClearPicked: () => void;
  onAnalyze: () => void;
  evals: Record<string, ExampleEval>;
  onPreview: (ex: ExampleCohort) => void;
  onSaveExample: (ex: ExampleCohort) => void;
  saved: SavedArtifacts;
  onOpenWorkspace: (name: string) => void;
  onDeleteWorkspace: (name: string) => void;
  wsError: string | null;
  onCustomData: (cohort: string) => OnCustomData;
}) {
  if (!login.loaded) return <div className="card"><Waiting what="your login" /></div>;
  if (!login.unlocked) return <div className="card">
    <p className="flush">Saved cohorts and analyses belong to your login.{" "}
      {login.enabled
        ? <><button className="primary" onClick={onLogin}>Log in</button> to see and save them.</>
        : "This deployment has no login, so nothing can be saved on it."}</p>
  </div>;

  const byNewest = <T extends { savedAt: string }>(m: Record<string, T>) =>
    Object.entries(m).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));

  return <div>
    <div className="tabs">
      <button className={sub === "cohorts" ? "active" : ""} onClick={() => onSub("cohorts")}>Cohorts</button>
      <button className={sub === "analyses" ? "active" : ""} onClick={() => onSub("analyses")}>Analyses</button>
    </div>

    {sub === "cohorts" && <div className="card">
      <div className="row savedbar">
        <h2 className="flush">Cohorts <span className="plain">— tick any, then analyse them together</span></h2>
        <span className="spacer" />
        <span className="meta">
          {picked.length === 0 ? "none selected"
            : picked.length + " selected" + (picked.length > 16 ? " — untick some first, an analysis takes at most 16" : "")}
        </span>
        <button className="primary" disabled={!picked.length} onClick={onAnalyze}
          title={picked.length ? "analyse the ticked cohorts together (replaces the current document)" : "tick at least one cohort"}>
          Analyze selected
        </button>
        {picked.length > 0 && <button className="linklike" onClick={onClearPicked}>clear</button>}
      </div>

      <h2 className="savedsec">Examples</h2>
      {examples.map(ex => {
        const ev = evals[ex.name];
        return (
          <div key={ex.name} className="listrow">
            <div className="listrow-head">
              <label className="pick">
                <input type="checkbox" checked={picked.includes("ex:" + ex.name)} onChange={() => onTogglePick("ex:" + ex.name)} />
                <strong>{ex.name}</strong>
              </label>
              <span className="meta">{ex.desc}</span>
              {ev && ev.count != null && <span className="meta"><strong>{ev.count.toLocaleString()}</strong> pts</span>}
              {ev && ev.busy && <span className="spinner" />}
              <span className="spacer" />
              <button className="linklike" onClick={() => onPreview(ex)}>preview</button>
              <button className="linklike" onClick={() => onSaveExample(ex)}>save</button>
            </div>
            {ev && ev.error && <div className="error">{ev.error}</div>}
          </div>
        );
      })}

      <h2 className="savedsec">
        Saved cohorts <span className="plain">— {SHARED}. Tick any to include above; delete here.</span>
      </h2>
      <ListStatus state={saved.cohortsState} what="saved cohorts" isEmpty={!Object.keys(saved.cohorts).length}
        empty="Nothing saved yet — save an example above, build one on the Explore page, or ask chat." />
      {byNewest(saved.cohorts).map(([n, c]) => (
        <div key={n} className="listrow">
          <div className="listrow-head">
            <label className="pick">
              <input type="checkbox" checked={picked.includes("saved:" + n)} onChange={() => onTogglePick("saved:" + n)} />
              <strong>{n}</strong>
            </label>
            {c.lastEval && <span className="meta">{c.lastEval.count.toLocaleString()} pts</span>}
            <span className="meta">saved {c.savedAt}</span>
            <span className="spacer" />
            <button className="linklike" onClick={() => saved.removeCohort(n)}>delete</button>
          </div>
          <div className="listrow-body"><CohortPills def={c.def} onCustomData={onCustomData(n)} /></div>
        </div>
      ))}
    </div>}

    {sub === "analyses" && <div className="grid2">
      <div className="card">
        <h2>Saved analyses <span className="plain">— {SHARED}</span></h2>
        <ListStatus state={saved.workspacesState} what="saved analyses" isEmpty={!Object.keys(saved.workspaces).length}
          empty={'Nothing saved yet — build an analysis with at least one view, then "Save workspace" on the Analysis tab.'} />
        {byNewest(saved.workspaces).map(([n, w]) => {
          const views = (w.doc.views || []).length;
          return (
            <div key={n} className="listrow">
              <div className="listrow-head">
                <strong>{n}</strong>
                <span className="meta">{views} view{views === 1 ? "" : "s"}</span>
                <span className="meta">saved {w.savedAt}</span>
                <span className="spacer" />
                <button className="linklike" onClick={() => onOpenWorkspace(n)}>open</button>
                <button className="linklike" onClick={() => onDeleteWorkspace(n)}>delete</button>
              </div>
            </div>
          );
        })}
        {wsError && <p className="error">{wsError}</p>}
      </div>
    </div>}
  </div>;
}
