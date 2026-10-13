"use client";
// The Saved tab: the example cohorts and the reader's saved cohorts, ticked to analyse together,
// and their saved analyses. What it holds across a tab switch (the ticks, the previews, the
// sub-tab) belongs to the page, which keeps it while this unmounts.
import CohortPills, { type OnCustomData } from "./pills";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import type { ServerState } from "./custom-data-client.ts";
import type { CohortDef } from "../../lib/types.ts";
import type { ListState, SavedArtifacts } from "./use-saved.ts";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";

export type ExampleCohort = { name: string; desc: string; def: CohortDef };
export type ExampleEval = { count?: number; error?: string; busy?: boolean } | null;

const SHARED = "everyone who logs in sees these: one shared login, no per-user ownership yet";

/** A list that is loading or failed says so; only a loaded one may be empty. */
function ListStatus({ state, what, empty, isEmpty }: { state: ListState; what: string; empty: string; isEmpty: boolean }) {
  if (state.pending) return <p className="note"><Waiting what={what} /></p>;
  if (state.error) return <p className="error">could not load {what}: {state.error}{" "}
    <Button variant="link" size="inline" onClick={state.retry}>retry</Button></p>;
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
        ? <><Button size="sm" onClick={onLogin}>Log in</Button> to see and save them.</>
        : "This deployment has no login, so nothing can be saved on it."}</p>
  </div>;

  const byNewest = <T extends { savedAt: string }>(m: Record<string, T>) =>
    Object.entries(m).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));

  return <div>
    <Tabs value={sub} onValueChange={(v) => onSub(v as typeof sub)} className="mb-3">
      <TabsList aria-label="saved" className="h-8">
        <TabsTrigger value="cohorts" className="px-3 text-md">Cohorts</TabsTrigger>
        <TabsTrigger value="analyses" className="px-3 text-md">Analyses</TabsTrigger>
      </TabsList>
    </Tabs>

    {sub === "cohorts" && <div className="card">
      <div className="row savedbar">
        <h2 className="flush">Cohorts <span className="plain">— tick any, then analyse them together</span></h2>
        <span className="spacer" />
        <span className="meta">
          {picked.length === 0 ? "none selected"
            : picked.length + " selected" + (picked.length > 16 ? " — untick some first, an analysis takes at most 16" : "")}
        </span>
        <Button size="sm" disabled={!picked.length} onClick={onAnalyze}
          title={picked.length ? "analyse the ticked cohorts together (replaces the current document)" : "tick at least one cohort"}>
          Analyze selected
        </Button>
        {picked.length > 0 && <Button variant="link" size="inline" onClick={onClearPicked}>clear</Button>}
      </div>

      <h2 className="savedsec">Examples</h2>
      {examples.map(ex => {
        const ev = evals[ex.name];
        return (
          <div key={ex.name} className="listrow">
            <div className="listrow-head">
              <label className="pick">
                <Checkbox checked={picked.includes("ex:" + ex.name)} onCheckedChange={() => onTogglePick("ex:" + ex.name)} />
                <strong>{ex.name}</strong>
              </label>
              <span className="meta">{ex.desc}</span>
              {ev && ev.count != null && <span className="meta"><strong>{ev.count.toLocaleString()}</strong> pts</span>}
              {ev && ev.busy && <span className="spinner" />}
              <span className="spacer" />
              <Button variant="link" size="inline" onClick={() => onPreview(ex)}>preview</Button>
              <Button variant="link" size="inline" onClick={() => onSaveExample(ex)}>save</Button>
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
              <Checkbox checked={picked.includes("saved:" + n)} onCheckedChange={() => onTogglePick("saved:" + n)} />
              <strong>{n}</strong>
            </label>
            {c.lastEval && <span className="meta">{c.lastEval.count.toLocaleString()} pts</span>}
            <span className="meta">saved {c.savedAt}</span>
            <span className="spacer" />
            <Button variant="link" size="inline" onClick={() => saved.removeCohort(n)}>delete</Button>
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
                <Button variant="link" size="inline" onClick={() => onOpenWorkspace(n)}>open</Button>
                <Button variant="link" size="inline" onClick={() => onDeleteWorkspace(n)}>delete</Button>
              </div>
            </div>
          );
        })}
        {wsError && <p className="error">{wsError}</p>}
      </div>
    </div>}
  </div>;
}
