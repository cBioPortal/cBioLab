"use client";
// The saved-work manager's Cohorts and Analyses tabs: the reader's own (shared as each says) and
// what others shared with them. Cohorts are ticked to analyse together; an analysis opens to work
// on. Either opens where the manager was opened from (useSaved().actions).
import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { ShareDialog, sharingLabel } from "../lab/share-dialog.tsx";
import { useGroups } from "../lab/use-groups.ts";
import { shareServerDataset } from "../lab/custom-data-client.ts";
import { useCustomDataState } from "../lab/custom-data-panel.tsx";
import { useSavedArtifacts, type ListState, type SavedArtifacts } from "../lab/use-saved.ts";
import { useStudyList } from "../lab/use-catalogs.ts";
import { api } from "../lab/api.ts";
import { ListCohortDialog } from "../lab/list-cohort.tsx";
import { CohortEditDialog } from "../lab/dialogs.tsx";
import type { SplitSpec } from "../lab/partitions.tsx";
import { requestLogin } from "../lab/custom-data-client.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { DOC_VERSION } from "../../lib/doc-version.ts";
import { editSplits, splitKey } from "../../lib/partition-arms.ts";
import type { ArtifactKind } from "../../lib/artifacts.ts";
import type { Sharing } from "../../lib/access.ts";
import type { AnalysisDoc, CohortDef, PartitionDef } from "../../lib/types.ts";
import type { SavedCohort } from "../lab/use-saved.ts";
import { useSaved } from "./saved-context.tsx";
import { SavedCohortRow } from "./cohort-menu.tsx";

const OWN = "yours, shared as each says";
const PRIVATE: Sharing = { visibility: "private", groupId: null, groupCanEdit: false };
/** an analysis takes at most this many cohorts */
const MAX_COHORTS = 16;

/** Whose an item shared with the reader is, and how it reaches them. */
const sharedBy = (x: { owner: { email: string; name: string | null }; sharing: Sharing & { groupName: string | null }; rights: { edit: boolean } }) =>
  "from " + (x.owner.name || x.owner.email) + " · " + (x.sharing.visibility === "public" ? "shared with everyone" : "shared with “" + x.sharing.groupName + "”") +
  (x.rights.edit ? " · you can edit" : "");

const byNewest = <T extends { savedAt: string }>(m: Record<string, T>) =>
  Object.entries(m).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));

/** An own item's sharing, as a small badge that opens the share dialog. */
function ShareBadge({ sharing, onClick }: { sharing?: Sharing & { groupName: string | null }; onClick: () => void }) {
  const label = sharing ? sharingLabel(sharing) : "only you";
  return <Button variant="link" size="inline" className="sharebadge text-sm" onClick={onClick} data-tip={"shared with " + label + " — change who"}>
    {sharing && sharing.visibility !== "private" ? "shared: " + label : "share…"}</Button>;
}

/** a one-cohort analysis of a saved cohort, in the study it is pinned to */
const cohortDoc = (name: string, def: CohortDef): AnalysisDoc =>
  ({ dsl: DOC_VERSION, study: def.study || def.studies?.[0] || "", cohorts: { [name]: def }, views: [] });

/** A list that is loading or failed says so; only a loaded one may be empty. */
function ListStatus({ state, what, empty, isEmpty }: { state: ListState; what: string; empty: string; isEmpty: boolean }) {
  if (state.pending) return <p className="note"><Waiting what={what} /></p>;
  if (state.error) return <p className="error">could not load {what}: {state.error}{" "}
    <Button variant="link" size="inline" onClick={state.retry}>retry</Button></p>;
  return isEmpty ? <p className="note">{empty}</p> : null;
}

/** The share dialog for one own cohort or analysis, and for the uploads and id lists it uses. */
function useShareDialog(saved: SavedArtifacts) {
  const login = useCustomDataState();
  const groups = useGroups(login.user?.id ?? null);
  const [sharing, setSharing] = useState<{ kind: ArtifactKind; id: string; name: string; sharing: Sharing } | null>(null);
  const dialog = sharing && <ShareDialog kind={sharing.kind === "workspace" ? "analysis" : "cohort"} name={sharing.name} sharing={sharing.sharing}
    groups={groups.groups} groupsError={groups.error}
    onSave={(s) => saved.share(sharing.kind, sharing.id, s)}
    onShareDatasets={async (items, s) => {
      for (const w of items) {
        if (w.kind !== "idSet") { await shareServerDataset(w.id, s); continue; }
        const res = await api.idSets.share(w.id, s);
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || res.statusText);
      }
    }}
    onClose={() => setSharing(null)} />;
  return { open: (kind: ArtifactKind, id: string, name: string, s?: Sharing) => setSharing({ kind, id, name, sharing: s ?? PRIVATE }), dialog };
}

export function CohortsPanel() {
  const login = useCustomDataState();
  const saved = useSavedArtifacts(login.user?.id ?? null);
  const { actions, close } = useSaved();
  const { studies } = useStudyList();
  const share = useShareDialog(saved);
  /** keys "saved:<name>" / "shared:<id>" */
  const [picked, setPicked] = useState<string[]>([]);
  const [newList, setNewList] = useState(false);
  /** the cohort whose name and note are being edited, and whether it was opened for the note */
  const [renaming, setRenaming] = useState<{ name: string; note: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** a name not yet used by one of the reader's cohorts: `base`, else `base (2)`, … */
  const freeName = (base: string) => { if (!saved.cohorts[base]) return base; for (let i = 2; ; i++) if (!saved.cohorts[base + " (" + i + ")"]) return base + " (" + i + ")"; };
  const attempt = async (what: string, f: () => Promise<unknown>) => {
    setErr(null);
    try { await f(); } catch (e) { setErr("could not " + what + ": " + String((e as Error)?.message || e)); }
  };
  const analyzeOne = (n: string, def: CohortDef) => { actions.openDoc(cohortDoc(n, def)); close(); };
  /** split by what the server proposes from the data, stored on the saved cohort; throws to the form */
  const split = async (n: string, c: SavedCohort, spec: SplitSpec) => {
    const doc = cohortDoc(n, c.def);
    const j = await (await api.partition({ doc, cohort: n, ...spec })).json();
    if (j.error) throw new Error(j.error);
    const { name, def } = j as { name: string; def: PartitionDef };
    const next = editSplits(doc, (f) => ({ ...f, partitions: { ...f.partitions, [splitKey(n, name)]: { ...def, split: name } } }));
    await saved.saveCohort(n, next.cohorts[n], c.lastEval ?? null, c.id);
  };
  const unsplit = (n: string, c: SavedCohort, s: string) => attempt("remove the split", async () => {
    const next = editSplits(cohortDoc(n, c.def), (f) => {
      const partitions = { ...f.partitions };
      delete partitions[splitKey(n, s)];
      return { ...f, partitions };
    });
    await saved.saveCohort(n, next.cohorts[n], c.lastEval ?? null, c.id);
  });
  const toggle = (key: string) => setPicked((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]);

  /** the ticked cohorts as a new analysis, with no views yet */
  const analyze = () => {
    const chosen: [string, CohortDef][] = [];
    for (const key of picked) {
      const rest = key.slice(key.indexOf(":") + 1);
      const other = key.startsWith("shared:") ? saved.sharedCohorts.find((x) => x.id === rest) : undefined;
      let name = other ? other.name : rest;
      const def = other ? other.item.def : saved.cohorts[name]?.def;
      // someone else's cohort may share a name with one already chosen: say whose it is
      if (other && chosen.some(([n]) => n === name)) name += " (" + (other.owner.name || other.owner.email) + ")";
      if (def) chosen.push([name, def]);
    }
    if (!chosen.length) return;
    const first = chosen[0][1];
    actions.openDoc({ dsl: DOC_VERSION, study: first.study || first.studies?.[0] || "", cohorts: Object.fromEntries(chosen), views: [] });
    close();
  };
  const remove = (name: string) => {
    if (!confirm("Delete the saved cohort “" + name + "”? Analyses that already use it keep their own copy.")) return;
    void attempt("delete", async () => { await saved.removeCohort(name); setPicked((p) => p.filter((k) => k !== "saved:" + name)); });
  };

  return <div className="card m-0">
    <div className="row savedbar">
      <Button size="sm" disabled={!picked.length || picked.length > MAX_COHORTS} onClick={analyze}
        data-tip={!picked.length ? "tick at least one cohort" : picked.length > MAX_COHORTS ? "an analysis takes at most " + MAX_COHORTS + " cohorts"
          : "start an analysis of the ticked cohorts together (replaces the analysis open in the lab)"}>
        Analyze selected
      </Button>
      <span className="meta">
        {picked.length === 0 ? "none selected"
          : picked.length + " selected" + (picked.length > MAX_COHORTS ? " — untick some first, an analysis takes at most " + MAX_COHORTS : "")}
      </span>
      {picked.length > 0 && <Button variant="link" size="inline" onClick={() => setPicked([])}>clear</Button>}
      <span className="spacer" />
      <Button variant="outline" size="sm" className={cn(TB, "newlistcohort")} onClick={() => setNewList(true)}
        data-tip="make a cohort from a pasted list of sample or patient ids, saved straight to your library">
        <Plus />New cohort from a list of ids…</Button>
    </div>
    {err && <p className="error">{err}</p>}
    <ListStatus state={saved.cohortsState} what="saved cohorts" isEmpty={!Object.keys(saved.cohorts).length && !saved.sharedCohorts.length}
      empty="Nothing saved yet — build one on the Explore page, make one from a list of ids, save one from an analysis, or ask chat." />
    {byNewest(saved.cohorts).map(([n, c]) => (
      <SavedCohortRow key={n} id={c.id} name={n} def={c.def} picked={picked.includes("saved:" + n)} onPick={() => toggle("saved:" + n)}
        meta={<>{c.lastEval && c.lastEval.count.toLocaleString() + " patients · "}saved {c.savedAt} · <ShareBadge sharing={c.sharing}
          onClick={() => share.open("cohort", c.id, n, c.sharing)} /></>}
        onAnalyze={() => analyzeOne(n, c.def)} onCustomData={actions.showClauseData?.(n)} onRemoveSplit={(s) => void unsplit(n, c, s)}
        own={{ onRename: () => setRenaming({ name: n, note: false }), onNote: () => setRenaming({ name: n, note: true }), onEditFilters: () => { actions.editCohort(c.id); close(); }, onSplit: (spec) => split(n, c, spec),
          onDuplicate: () => attempt("duplicate", () => saved.saveCohort(freeName(n + " copy"), c.def, c.lastEval ?? null)), onDelete: () => remove(n) }} />
    ))}
    {saved.sharedCohorts.map((x) => (
      <SavedCohortRow key={x.id} id={x.id} name={x.name} def={x.item.def} picked={picked.includes("shared:" + x.id)} onPick={() => toggle("shared:" + x.id)}
        meta={<>{sharedBy(x)} · saved {x.item.savedAt}</>}
        onAnalyze={() => analyzeOne(x.name, x.item.def)} onCustomData={actions.showClauseData?.(x.name)}
        onCopy={() => attempt("copy", () => saved.saveCohort(freeName(x.name), x.item.def, null))} />
    ))}

    {newList && <ListCohortDialog title="New cohort from a list of ids" chooseFrom={studies.map((s) => ({ id: s.id, name: s.name }))} saved="ready"
      doneLabel={<><Save />Save to your library</>} doneTitle={(as) => "save “" + as + "” to your library"}
      nameFor={freeName}
      onDone={async (name, def) => { await saved.saveCohort(name, def, null); }} onLogin={requestLogin} onClose={() => setNewList(false)} />}
    {renaming && saved.cohorts[renaming.name] && <CohortEditDialog name={renaming.name} notes={saved.cohorts[renaming.name].def.notes || ""} focusNotes={renaming.note}
      taken={(n) => !!saved.cohorts[n]}
      onSave={(name, notes) => {
        const c = saved.cohorts[renaming.name];
        const { notes: _old, ...def } = c.def;
        void attempt("rename", async () => {
          await saved.saveCohort(name, notes.trim() ? { ...def, notes: notes.trim() } : def, c.lastEval ?? null, c.id);
          setPicked((p) => p.map((k) => k === "saved:" + renaming.name ? "saved:" + name : k));
        });
      }}
      onClose={() => setRenaming(null)} />}
    {share.dialog}
  </div>;
}

export function AnalysesPanel() {
  const login = useCustomDataState();
  const saved = useSavedArtifacts(login.user?.id ?? null);
  const { actions, close } = useSaved();
  const share = useShareDialog(saved);
  const [err, setErr] = useState<string | null>(null);
  const remove = async (name: string) => {
    setErr(null);
    try { await saved.removeWorkspace(name); }
    catch (e) { setErr("could not delete: " + String((e as Error)?.message || e)); }
  };

  return <div className="grid2">
    <div className="card m-0">
      <h2>Saved analyses <span className="plain">— {OWN}</span></h2>
      <ListStatus state={saved.workspacesState} what="saved analyses" isEmpty={!Object.keys(saved.workspaces).length}
        empty={'Nothing saved yet — build an analysis with at least one view, then "Save analysis" on the Analysis tab.'} />
      {byNewest(saved.workspaces).map(([n, w]) => {
        const views = (w.doc.views || []).length;
        return (
          <div key={n} className="listrow">
            <div className="listrow-head">
              <strong>{n}</strong>
              <span className="meta">{views} view{views === 1 ? "" : "s"}</span>
              <span className="meta">saved {w.savedAt}</span>
              <span className="spacer" />
              <ShareBadge sharing={w.sharing} onClick={() => share.open("workspace", w.id, n, w.sharing)} />
              <Button variant="link" size="inline" onClick={() => { actions.openDoc({ ...w.doc, title: n }); close(); }}>open</Button>
              <Button variant="link" size="inline" onClick={() => void remove(n)}>delete</Button>
            </div>
          </div>
        );
      })}
      {err && <p className="error">{err}</p>}
    </div>
    {saved.sharedWorkspaces.length > 0 && <div className="card m-0">
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
              <Button variant="link" size="inline" onClick={() => { actions.openShared(x.id); close(); }}>open</Button>
            </div>
          </div>
        );
      })}
    </div>}
    {share.dialog}
  </div>;
}
