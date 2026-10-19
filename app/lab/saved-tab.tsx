"use client";
// The Saved tab: the example cohorts and the reader's saved cohorts, ticked to analyse together,
// and their saved analyses. What it holds across a tab switch (the ticks, the previews, the
// sub-tab) belongs to the page, which keeps it while this unmounts.
import { useState } from "react";
import CohortPills, { type OnCustomData } from "./pills";
import { ShareDialog, sharingLabel } from "./share-dialog.tsx";
import { useGroups } from "./use-groups.ts";
import { shareServerDataset } from "./custom-data-client.ts";
import { api } from "./api.ts";
import { ListCohortDialog } from "./list-cohort.tsx";
import { cn } from "../../lib/cn";
import { TB } from "../_ui/toolbar.ts";
import { Plus, Save } from "lucide-react";
import type { ArtifactKind } from "../../lib/artifacts.ts";
import type { Sharing } from "../../lib/access.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import type { ServerState } from "./custom-data-client.ts";
import type { CohortDef } from "../../lib/types.ts";
import type { ListState, SavedArtifacts } from "./use-saved.ts";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";


const OWN = "yours, shared as each says";

/** Whose an item shared with the reader is, and how it reaches them. */
const sharedBy = (x: { owner: { email: string; name: string | null }; sharing: Sharing & { groupName: string | null }; rights: { edit: boolean } }) =>
  "from " + (x.owner.name || x.owner.email) + " · " + (x.sharing.visibility === "public" ? "shared with everyone" : "shared with “" + x.sharing.groupName + "”") +
  (x.rights.edit ? " · you can edit" : "");

/** An own item's sharing, as a small badge that opens the share dialog. */
function ShareBadge({ sharing, onClick }: { sharing?: Sharing & { groupName: string | null }; onClick: () => void }) {
  const label = sharing ? sharingLabel(sharing) : "only you";
  return <Button variant="link" size="inline" className="sharebadge text-sm" onClick={onClick} title={"shared with " + label + " — change who"}>
    {sharing && sharing.visibility !== "private" ? "shared: " + label : "share…"}</Button>;
}

/** A list that is loading or failed says so; only a loaded one may be empty. */
function ListStatus({ state, what, empty, isEmpty }: { state: ListState; what: string; empty: string; isEmpty: boolean }) {
  if (state.pending) return <p className="note"><Waiting what={what} /></p>;
  if (state.error) return <p className="error">could not load {what}: {state.error}{" "}
    <Button variant="link" size="inline" onClick={state.retry}>retry</Button></p>;
  return isEmpty ? <p className="note">{empty}</p> : null;
}

export function SavedTab({
  login, onLogin, sub, onSub, picked, onTogglePick, onClearPicked, onAnalyze,
  studies, onNewFromList, saved, onOpenWorkspace, onOpenShared, onDeleteWorkspace, wsError, onCustomData,
}: {
  login: ServerState;
  onLogin: () => void;
  sub: "cohorts" | "analyses";
  onSub: (s: "cohorts" | "analyses") => void;
  /** keys "saved:<name>" / "shared:<id>" */
  picked: string[];
  onTogglePick: (key: string) => void;
  onClearPicked: () => void;
  onAnalyze: () => void;
  /** the studies a new cohort from a list may be matched in */
  studies: { id: string; name: string }[];
  /** save a cohort made from a list of ids to the library */
  onNewFromList: (name: string, def: CohortDef) => Promise<void>;
  /** open an analysis someone shared with the reader, by id */
  onOpenShared: (id: string) => void;
  saved: SavedArtifacts;
  onOpenWorkspace: (name: string) => void;
  onDeleteWorkspace: (name: string) => void;
  wsError: string | null;
  onCustomData: (cohort: string) => OnCustomData;
}) {
  const groups = useGroups(login.user?.id ?? null);
  const [sharing, setSharing] = useState<{ kind: ArtifactKind; id: string; name: string; sharing: Sharing } | null>(null);
  const [newList, setNewList] = useState(false);
  if (!login.loaded) return <div className="card"><Waiting what="your sign-in" /></div>;
  if (!login.unlocked) return <div className="card">
    <p className="flush">Saved cohorts and analyses are your own.{" "}
      {login.enabled
        ? <><Button size="sm" onClick={onLogin}>Sign in</Button> to see and save them.</>
        : "This deployment has no sign-in, so nothing can be saved on it."}</p>
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

      <h2 className="savedsec flex items-center gap-2.5">
        <span>Saved cohorts <span className="plain">— {OWN}. Tick any to include above; delete here.</span></span>
        <Button variant="outline" size="sm" className={cn(TB, "newlistcohort ml-auto")} onClick={() => setNewList(true)}
          title="make a cohort from a pasted list of sample or patient ids, saved straight to your library">
          <Plus />New cohort from a list of ids…</Button>
      </h2>
      <ListStatus state={saved.cohortsState} what="saved cohorts" isEmpty={!Object.keys(saved.cohorts).length}
        empty="Nothing saved yet — build one on the Explore page, make one from a list of ids, save one from an analysis, or ask chat." />
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
            <ShareBadge sharing={c.sharing} onClick={() => setSharing({ kind: "cohort", id: c.id, name: n, sharing: c.sharing ?? PRIVATE })} />
            <Button variant="link" size="inline" onClick={() => saved.removeCohort(n)}>delete</Button>
          </div>
          <div className="listrow-body"><CohortPills def={c.def} onCustomData={onCustomData(n)} /></div>
        </div>
      ))}

      {saved.sharedCohorts.length > 0 && <>
        <h2 className="savedsec">Shared with you <span className="plain">— others' cohorts you may use. Tick any to include above.</span></h2>
        {saved.sharedCohorts.map((x) => (
          <div key={x.id} className="listrow">
            <div className="listrow-head">
              <label className="pick">
                <Checkbox checked={picked.includes("shared:" + x.id)} onCheckedChange={() => onTogglePick("shared:" + x.id)} />
                <strong>{x.name}</strong>
              </label>
              <span className="meta">{sharedBy(x)}</span>
              <span className="meta">saved {x.item.savedAt}</span>
            </div>
            <div className="listrow-body"><CohortPills def={x.item.def} onCustomData={onCustomData(x.name)} /></div>
          </div>
        ))}
      </>}
    </div>}

    {sub === "analyses" && <div className="grid2">
      <div className="card">
        <h2>Saved analyses <span className="plain">— {OWN}</span></h2>
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
                <ShareBadge sharing={w.sharing} onClick={() => setSharing({ kind: "workspace", id: w.id, name: n, sharing: w.sharing ?? PRIVATE })} />
                <Button variant="link" size="inline" onClick={() => onOpenWorkspace(n)}>open</Button>
                <Button variant="link" size="inline" onClick={() => onDeleteWorkspace(n)}>delete</Button>
              </div>
            </div>
          );
        })}
        {wsError && <p className="error">{wsError}</p>}
      </div>
      {saved.sharedWorkspaces.length > 0 && <div className="card">
        <h2>Shared with you <span className="plain">— others' analyses. Opening one gives you a working copy{saved.sharedWorkspaces.some((x) => x.rights.edit) ? "; where you can edit, you can also save back to it" : ""}.</span></h2>
        {saved.sharedWorkspaces.map((x) => {
          const views = (x.item.doc.views || []).length;
          return (
            <div key={x.id} className="listrow">
              <div className="listrow-head">
                <strong>{x.name}</strong>
                <span className="meta">{views} view{views === 1 ? "" : "s"}</span>
                <span className="meta">{sharedBy(x)}</span>
                <span className="spacer" />
                <Button variant="link" size="inline" onClick={() => onOpenShared(x.id)}>open</Button>
              </div>
            </div>
          );
        })}
      </div>}
    </div>}

    {newList && <ListCohortDialog title="New cohort from a list of ids" chooseFrom={studies} saved="ready"
      doneLabel={<><Save />Save to your library</>} doneTitle={(as) => "save “" + as + "” to your library"}
      nameFor={(n) => { if (!saved.cohorts[n]) return n; for (let i = 2; ; i++) if (!saved.cohorts[n + " (" + i + ")"]) return n + " (" + i + ")"; }}
      onDone={onNewFromList} onLogin={onLogin} onClose={() => setNewList(false)} />}

    {sharing && <ShareDialog kind={sharing.kind === "workspace" ? "analysis" : "cohort"} name={sharing.name} sharing={sharing.sharing}
      groups={groups.groups} groupsError={groups.error}
      onSave={(s) => saved.share(sharing.kind, sharing.id, s)}
      onShareDatasets={async (items, s) => {
        for (const w of items) {
          if (w.kind !== "idSet") { await shareServerDataset(w.id, s); continue; }
          const res = await api.idSets.share(w.id, s);
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || res.statusText);
        }
      }}
      onClose={() => setSharing(null)} />}
  </div>;
}

const PRIVATE: Sharing = { visibility: "private", groupId: null, groupCanEdit: false };
