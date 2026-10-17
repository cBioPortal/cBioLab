"use client";
// "+ Add cohort" on a view: one dialog with the places a cohort comes from — the analysis's own
// cohorts, the library (the login's saved cohorts and the built-in examples), Explore, where a new
// one is built and comes back to this view, and a pasted list of ids, saved as a stored id set.
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { CohortDef } from "../../lib/types.ts";
import { cohortHash } from "../../lib/cohort-hash.ts";
import CohortPills from "./pills";
import { CAT_COLORS } from "./view-chrome.tsx";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { Textarea } from "../_ui/textarea";
import { api } from "./api.ts";
import type { CellExplorerDataset } from "../../lib/cell-explorer.ts";

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
  /** saved cohorts are the signed-in reader's: "locked" when signed out, "off" where there is no sign-in */
  saved: "off" | "locked" | "loading" | "ready" | "error";
  savedError?: string | null;
  /** the login's saved cohorts: `id` is the artifact's, which survives a rename */
  cohorts: { id: string; name: string; def: CohortDef; savedAt: string }[];
  examples: { name: string; desc: string; def: CohortDef }[];
}

type Source = "analysis" | "library" | "explore" | "list" | "cells";

export function AddCohortDialog({ target, analysis, library, studies, onAdd, onExplore, onLogin, onClose, cells }: {
  target: AddCohortTarget | null;
  /** the analysis's cohorts in its order (the colour each has in its summary), with their sizes once known */
  analysis: { name: string; def: CohortDef; count: number | null; views: string[] }[];
  library: LibraryState;
  /** the studies the analysis uses: a pasted bare id is looked up in each */
  studies: string[];
  /** add a cohort to the view: an analysis cohort by name, or a library one with its definition */
  onAdd: (name: string, def?: CohortDef) => void;
  onExplore: () => void;
  onLogin: () => void;
  onClose: () => void;
  /** the study's single-cell dataset in Cell Explorer, when it has one: a cohort can come from its donors */
  cells?: CellExplorerDataset | null;
}) {
  const [source, setSource] = useState<Source>("analysis");
  const [q, setQ] = useState("");
  const available = target ? analysis.filter((c) => !target.has.includes(c.name)) : [];
  // each opening starts on the analysis's own cohorts, or the library when it has none to offer
  useEffect(() => {
    if (!target) return;
    setQ("");
    setSource(analysis.some((c) => !target.has.includes(c.name)) ? "analysis" : "library");
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
        <Button variant="outline" size="sm" className={TB} disabled={full} title={addTitle("“" + as + "”")} onClick={() => onAdd(as, copy)}>{replaces ? "Use" : <><Plus />Add</>}</Button>
      </li>
    );
  };
  const saved = library.cohorts.filter((c) => match(c.name));
  const examples = library.examples.filter((c) => match(c.name) || match(c.desc));

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      {target && <DialogContent aria-describedby={undefined}
        className="addcohortdialog flex max-h-[85vh] w-[min(94vw,40rem)] max-w-[40rem] flex-col gap-3 overflow-y-auto sm:max-w-[40rem]">
        <DialogHeader>
          <DialogTitle className="text-base">Add a cohort to <span className="font-normal text-muted-foreground">{target.title}</span></DialogTitle>
        </DialogHeader>
        {(full || replaces) && <p className="note m-0">
          {full ? "This view already draws its maximum of " + target.max + " cohorts — untick one in its cohorts menu to add another."
            : "This view draws one cohort, so the one you pick replaces “" + target.has[0] + "”."}
        </p>}
        <Tabs value={source} onValueChange={(v) => setSource(v as Source)}>
          <TabsList className="h-8">
            <TabsTrigger value="analysis" className="px-3 text-md">In this analysis <span className="text-muted-foreground">{available.length}</span></TabsTrigger>
            <TabsTrigger value="library" className="px-3 text-md">Library</TabsTrigger>
            <TabsTrigger value="explore" className="px-3 text-md">Build in Explore</TabsTrigger>
            <TabsTrigger value="list" className="px-3 text-md">From a list of ids</TabsTrigger>
            {cells && <TabsTrigger value="cells" className="px-3 text-md">From Cell Explorer</TabsTrigger>}
          </TabsList>
        </Tabs>

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
                <Button variant="outline" size="sm" className={TB} disabled={full} title={addTitle("“" + c.name + "”")} onClick={() => onAdd(c.name)}>{replaces ? "Use" : <><Plus />Add</>}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">{analysis.length
            ? "This view already draws every cohort in the analysis. Pick one from the library, or build a new one in Explore."
            : "This analysis has no cohorts yet. Pick one from the library, or build one in Explore."}</p>
        ))}

        {source === "library" && <>
          <Input className="h-8 text-md md:text-md" placeholder="search the library…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <h4 className="acd-h">Your saved cohorts</h4>
          {library.saved === "off" ? <p className="note">This deployment has no sign-in, so it keeps no saved cohorts.</p>
            : library.saved === "locked" ? <p className="note"><Button variant="link" size="inline" className="text-md" onClick={onLogin}>Sign in</Button> to see your saved cohorts.</p>
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
            <p className="note mt-0">
              Explore opens over this analysis with the studies it already uses. Filter with its charts, name the
              selection, and it comes back as a cohort of <strong>{target.title}</strong>; Cancel returns here with nothing added.
            </p>
            <Button disabled={full} title={full ? addTitle("") : undefined} onClick={onExplore}>Open Explore</Button>
          </div>
        )}
        {source === "list" && <ListSource studies={studies} saved={library.saved} full={full} replaces={replaces} addTitle={addTitle}
          nameFor={libraryName} onAdd={onAdd} onLogin={onLogin} />}
        {source === "cells" && cells && <CellsSource cells={cells} full={full} replaces={replaces} addTitle={addTitle}
          nameFor={libraryName} onAdd={onAdd} />}
      </DialogContent>}
    </Dialog>
  );
}

/**
 * A cohort from Cell Explorer: a link to the dataset filtered to some donors, or donor ids pasted,
 * matched to the study's patients on the server (lib/cell-explorer-server.ts). The text stays in
 * this component while it is typed.
 */
function CellsSource({ cells, full, replaces, addTitle, nameFor, onAdd }: {
  cells: CellExplorerDataset; full: boolean; replaces: boolean; addTitle: (what: string) => string;
  nameFor: (name: string, def: CohortDef) => string; onAdd: (name: string, def?: CohortDef) => void;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("from Cell Explorer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<{ def: CohortDef; donors: number; patients: number; unmatched: string[]; from: string } | null>(null);
  const match = async () => {
    setBusy(true); setErr(null); setFound(null);
    try {
      const j = await (await api.cellExplorer({ mode: "import", study: cells.study, text })).json();
      if (j.error) throw new Error(j.error);
      setFound(j);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };
  const as = found ? nameFor(name.trim() || "from Cell Explorer", found.def) : name.trim();
  return (
    <div className="acd-cells flex flex-col gap-2.5">
      <p className="note mt-0">
        Paste a Cell Explorer link to <strong>{cells.label}</strong> filtered by {cells.obsColumn} (its “share” link), or the donor
        ids themselves, separated by commas, spaces or lines. They are matched to {cells.study}'s patients
        {cells.patientAttribute ? " through " + cells.patientAttribute : ""}; the cohort is that list of patients.
      </p>
      <Textarea aria-label="Cell Explorer link or donor ids" rows={4} className="text-md md:text-md" value={text}
        placeholder={"https://cell-explorer.cbioportal.org/view?config=…\nor SPECTRUM-OV-002, SPECTRUM-OV-007, …"}
        onChange={(e) => { setText(e.target.value); setFound(null); }} />
      <div className="viewtb">
        <div className="tbz">
          <Button variant="outline" size="sm" className={TB} disabled={busy || !text.trim()} onClick={() => void match()}>
            {busy && <span className="spinner" />}Find patients</Button>
        </div>
      </div>
      {err && <p className="error m-0">{err}</p>}
      {found && <>
        <p className="note m-0">
          {found.donors.toLocaleString()} donor{found.donors === 1 ? "" : "s"} from the {found.from === "link" ? "link" : "list"} → <strong>{found.patients.toLocaleString()}</strong> patient{found.patients === 1 ? "" : "s"}
          {found.unmatched.length > 0 && <> · <span className="text-destructive">{found.unmatched.length} not a donor of {cells.study}</span>: {found.unmatched.slice(0, 5).join(", ")}{found.unmatched.length > 5 ? ", …" : ""}</>}
        </p>
        <div className="viewtb">
          <div className="tbz">
            <label className="tbfield">name <Input aria-label="cohort name" className="h-ctl w-56 text-md md:text-md" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <Button variant="outline" size="sm" className={TB} disabled={full} title={addTitle("“" + as + "”")}
              onClick={() => onAdd(as, found.def)}>{replaces ? "Use" : <><Plus />Add</>}</Button>
          </div>
        </div>
        {as !== (name.trim() || "from Cell Explorer") && <p className="meta m-0">added as “{as}”, since this analysis already has a different “{name.trim()}”</p>}
      </>}
    </div>
  );
}

/** One id per line, or separated by commas, semicolons, tabs or spaces. */
const splitIds = (text: string): string[] => text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

interface SavedSet {
  set: { id: string; name: string; level: "sample" | "patient"; studies: string[]; count: number };
  unmatched: number; unmatchedExamples: string[]; duplicates: number; multiStudy: number;
  refused: { study: string; reason: string }[];
}

/**
 * A cohort from a pasted list of sample or patient ids. The list is matched to the studies' own
 * cases and saved on the server as a stored id set (lib/id-set-store.ts); the cohort names the
 * set by its id, so the document and its link stay small however long the list is. Needs a
 * sign-in, since the set is its saver's. The text stays in this component while it is typed.
 */
function ListSource({ studies, saved, full, replaces, addTitle, nameFor, onAdd, onLogin }: {
  studies: string[]; saved: LibraryState["saved"]; full: boolean; replaces: boolean; addTitle: (what: string) => string;
  nameFor: (name: string, def: CohortDef) => string; onAdd: (name: string, def?: CohortDef) => void; onLogin: () => void;
}) {
  const [text, setText] = useState("");
  const [level, setLevel] = useState<"sample" | "patient">("sample");
  const [name, setName] = useState("from a list");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<SavedSet | null>(null);
  if (saved === "off") return <p className="note">A list of ids is kept on the server as a stored id set, which needs a sign-in, and this deployment has none.</p>;
  if (saved === "locked") return <p className="note"><Button variant="link" size="inline" className="text-md" onClick={onLogin}>Sign in</Button> to add a cohort from a list of ids: the list is kept on the server as your stored id set.</p>;
  const ids = splitIds(text);
  const save = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await api.idSets.create({ name: name.trim() || "from a list", level, studies, ids });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || res.statusText);
      setDone(j);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };
  const def: CohortDef | null = done ? {
    all: [{ kind: done.set.level === "sample" ? "sampleList" : "patientList", set: done.set.id, label: done.set.name, n: done.set.count }],
    ...(done.set.studies.length > 1 ? { studies: done.set.studies } : done.set.studies[0] !== studies[0] ? { study: done.set.studies[0] } : {}),
  } : null;
  const as = def ? nameFor(done!.set.name, def) : name.trim();
  const noun = level === "sample" ? "sample" : "patient";
  return (
    <div className="acd-list-ids flex flex-col gap-2.5">
      <p className="note mt-0">
        Paste {noun} ids, one per line or separated by commas or spaces, as <code>study:id</code> or bare ids, which are looked
        up in {studies.length ? studies.join(", ") : "the analysis's study"}. The ids are matched to the {noun}s there and kept on
        the server as a stored id set; the cohort names the set, so the analysis and its links stay small however long the list is.
      </p>
      <div className="viewtb">
        <div className="tbz">
          <span className="tbl">ids are</span>
          <Tabs value={level} onValueChange={(v) => { setLevel(v as "sample" | "patient"); setDone(null); }}>
            <TabsList className="h-ctl">
              <TabsTrigger value="sample" className="px-2.5 text-md">samples</TabsTrigger>
              <TabsTrigger value="patient" className="px-2.5 text-md">patients</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <Textarea aria-label={noun + " ids"} rows={6} className="font-mono text-md md:text-md" value={text}
        placeholder={level === "sample" ? "P-0000012-T01-IM3\nP-0000015-T01-IM3\n…" : "P-0000012\nP-0000015\n…"}
        onChange={(e) => { setText(e.target.value); setDone(null); }} />
      <div className="viewtb">
        <div className="tbz">
          <label className="tbfield">name <Input aria-label="set name" className="h-ctl w-56 text-md md:text-md" value={name}
            onChange={(e) => { setName(e.target.value); setDone(null); }} /></label>
          <Button variant="outline" size="sm" className={cn(TB, "idsetsave")} disabled={busy || !ids.length || !studies.length}
            title={!studies.length ? "the analysis names no study to match the ids in" : !ids.length ? "paste some ids first" : undefined}
            onClick={() => void save()}>
            {busy && <span className="spinner" />}Match and save {ids.length ? ids.length.toLocaleString() + " id" + (ids.length === 1 ? "" : "s") : ""}</Button>
        </div>
      </div>
      {err && <p className="error m-0">{err}</p>}
      {done && def && <>
        <p className="note m-0 idsetresult">
          Saved “{done.set.name}”: <strong>{done.set.count.toLocaleString()}</strong> {noun}{done.set.count === 1 ? "" : "s"}
          {done.set.studies.length > 1 ? " across " + done.set.studies.length + " studies" : " in " + done.set.studies[0]}
          {done.unmatched > 0 && <> · <span className="text-destructive">{done.unmatched.toLocaleString()} matched no {noun}</span>: {done.unmatchedExamples.slice(0, 5).join(", ")}{done.unmatched > 5 ? ", …" : ""}</>}
          {done.duplicates > 0 && <> · {done.duplicates.toLocaleString()} given more than once</>}
          {done.multiStudy > 0 && <> · {done.multiStudy.toLocaleString()} found in more than one study, kept in each</>}
          {done.refused.length > 0 && <> · not matched in {done.refused.map((r) => r.study + " (" + r.reason + ")").join(", ")}</>}
        </p>
        <div className="viewtb">
          <div className="tbz">
            <Button variant="outline" size="sm" className={TB} disabled={full} title={addTitle("“" + as + "”")}
              onClick={() => onAdd(as, def)}>{replaces ? "Use" : <><Plus />Add</>}</Button>
          </div>
        </div>
        {as !== done.set.name && <p className="meta m-0">added as “{as}”, since this analysis already has a different “{done.set.name}”</p>}
      </>}
    </div>
  );
}
