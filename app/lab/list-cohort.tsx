"use client";
// A cohort from a pasted list of sample or patient ids, wherever one can be made: a view's
// "+ Add cohort", the analysis's cohort panel, and the library. The list is matched to the
// studies' own cases and kept on the server (a stored id set, lib/id-set-store.ts); the cohort
// names it by its id, so the analysis and its link stay small however long the list is. Needs a
// sign-in, since the list is its saver's. The text stays in this component while it is typed.
import { useState } from "react";
import { Plus } from "lucide-react";
import type { CohortDef } from "../../lib/types.ts";
import { cn } from "../../lib/cn";
import { Button } from "../_ui/button";
import { Choice } from "../_ui/choice";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { Textarea } from "../_ui/textarea";
import { TB } from "../_ui/toolbar.ts";
import { api } from "./api.ts";

/** The reader's sign-in, as the places that save cohorts know it. */
export type SignInState = "off" | "locked" | "loading" | "ready" | "error";

/** One id per line, or separated by commas, semicolons, tabs or spaces. */
const splitIds = (text: string): string[] => text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

interface SavedList {
  set: { id: string; name: string; level: "sample" | "patient"; studies: string[]; count: number };
  unmatched: number; unmatchedExamples: string[]; duplicates: number; multiStudy: number;
  refused: { study: string; reason: string }[];
}

/**
 * The paste, match and confirm steps. `studies` are those the ids are matched in (a bare id is
 * looked up in each); `studyPicker`, when given, sits in front of the form to choose them.
 */
export function ListSource({ studies, studyPicker, saved, disabled, doneTitle, doneLabel, nameFor = (n) => n, onDone, onLogin }: {
  studies: string[];
  studyPicker?: React.ReactNode;
  saved: SignInState;
  /** the final action is not possible now; `doneTitle` says why */
  disabled?: boolean;
  doneTitle: (as: string) => string;
  doneLabel: React.ReactNode;
  /** the name the cohort takes where it goes, when that place already has a different one of this name */
  nameFor?: (name: string, def: CohortDef) => string;
  onDone: (name: string, def: CohortDef) => void | Promise<void>;
  onLogin: () => void;
}) {
  const [text, setText] = useState("");
  const [level, setLevel] = useState<"sample" | "patient">("sample");
  // no default: a list's name is how it is found again, in the analysis and the library
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<SavedList | null>(null);
  if (saved === "off") return <p className="note">A cohort from a list of ids is kept on the server, which needs a sign-in, and this deployment has none.</p>;
  if (saved === "locked") return <p className="note"><Button variant="link" size="inline" className="text-md" onClick={onLogin}>Sign in</Button> to make a cohort from a list of ids: the list is kept on the server, as yours.</p>;
  const ids = splitIds(text);
  const save = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await api.idSets.create({ name: name.trim(), level, studies, ids });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || res.statusText);
      setDone(j);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };
  const finish = async (as: string, d: CohortDef) => {
    setBusy(true); setErr(null);
    try { await onDone(as, d); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  };
  const def: CohortDef | null = done ? {
    all: [{ kind: done.set.level === "sample" ? "sampleList" : "patientList", set: done.set.id, label: done.set.name, n: done.set.count }],
    // a cohort names the studies it was matched in, so it means the same wherever it is used
    ...(done.set.studies.length > 1 ? { studies: done.set.studies } : { study: done.set.studies[0] }),
  } : null;
  const as = def ? nameFor(done!.set.name, def) : name.trim();
  const noun = level === "sample" ? "sample" : "patient";
  const reset = () => setDone(null);
  return (
    <div className="acd-list-ids flex flex-col gap-2.5">
      <p className="note mt-0">
        Paste {noun} ids, one per line or separated by commas or spaces, as <code>study:id</code> or bare ids, which are looked
        up in {studies.length ? studies.join(", ") : "the study you choose"}. They are matched to the {noun}s there, and the
        cohort is those {noun}s{noun === "sample" ? "' patients" : ""}.
      </p>
      <div className="viewtb">
        {studyPicker && <div className="tbz">{studyPicker}</div>}
        <div className="tbz">
          <span className="tbl">ids are</span>
          <Tabs value={level} onValueChange={(v) => { setLevel(v as "sample" | "patient"); reset(); }}>
            <TabsList className="h-ctl">
              <TabsTrigger value="sample" className="px-2.5 text-md">samples</TabsTrigger>
              <TabsTrigger value="patient" className="px-2.5 text-md">patients</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <Textarea aria-label={noun + " ids"} rows={6} className="font-mono text-md md:text-md" value={text}
        placeholder={level === "sample" ? "P-0000012-T01-IM3\nP-0000015-T01-IM3\n…" : "P-0000012\nP-0000015\n…"}
        onChange={(e) => { setText(e.target.value); reset(); }} />
      <div className="viewtb">
        <div className="tbz">
          <label className="tbfield">name <Input aria-label="set name" className="h-ctl w-56 text-md md:text-md" value={name} placeholder="name this list…"
            onChange={(e) => { setName(e.target.value); reset(); }} /></label>
          <Button variant="outline" size="sm" className={cn(TB, "idsetsave")} disabled={busy || !ids.length || !studies.length || !name.trim()}
            title={!studies.length ? "choose the study to match the ids in" : !ids.length ? "paste some ids first"
              : !name.trim() ? "name the list first: it is how it is found again, in the analysis and your library" : undefined}
            onClick={() => void save()}>
            {busy && !done && <span className="spinner" />}Match {ids.length ? ids.length.toLocaleString() + " id" + (ids.length === 1 ? "" : "s") : "ids"}</Button>
        </div>
      </div>
      {err && <p className="error m-0">{err}</p>}
      {done && def && <>
        <p className="note m-0 idsetresult">
          “{done.set.name}”: <strong>{done.set.count.toLocaleString()}</strong> {noun}{done.set.count === 1 ? "" : "s"}
          {done.set.studies.length > 1 ? " across " + done.set.studies.length + " studies" : " in " + done.set.studies[0]}
          {done.unmatched > 0 && <> · <span className="text-destructive">{done.unmatched.toLocaleString()} matched no {noun}</span>: {done.unmatchedExamples.slice(0, 5).join(", ")}{done.unmatched > 5 ? ", …" : ""}</>}
          {done.duplicates > 0 && <> · {done.duplicates.toLocaleString()} given more than once</>}
          {done.multiStudy > 0 && <> · {done.multiStudy.toLocaleString()} found in more than one study, kept in each</>}
          {done.refused.length > 0 && <> · not matched in {done.refused.map((r) => r.study + " (" + r.reason + ")").join(", ")}</>}
        </p>
        <div className="viewtb">
          <div className="tbz">
            <Button variant="outline" size="sm" className={cn(TB, "idsetdone")} disabled={disabled || busy} title={doneTitle(as)}
              onClick={() => void finish(as, def)}>{busy && <span className="spinner" />}{doneLabel}</Button>
          </div>
        </div>
        {as !== done.set.name && <p className="meta m-0">as “{as}”, since “{done.set.name}” is already taken by a different cohort</p>}
      </>}
    </div>
  );
}

/**
 * The paste form in a dialog of its own: for the analysis's cohort panel (the analysis's studies)
 * and the library (a study chosen here, since there is no analysis to take one from).
 */
export function ListCohortDialog({ title, studies, chooseFrom, saved, doneLabel, doneTitle, nameFor, onDone, onLogin, onClose }: {
  title: string;
  /** the studies to match in; absent → the reader chooses one from `chooseFrom` */
  studies?: string[];
  chooseFrom?: { id: string; name: string }[];
  saved: SignInState;
  doneLabel: React.ReactNode;
  doneTitle: (as: string) => string;
  nameFor?: (name: string, def: CohortDef) => string;
  onDone: (name: string, def: CohortDef) => Promise<void>;
  onLogin: () => void;
  onClose: () => void;
}) {
  const [study, setStudy] = useState("");
  const picker = !studies && (
    <label className="tbfield">study <Choice size="ctl" className="w-72" value={study} onChange={setStudy} placeholder="choose a study…"
      pending={chooseFrom && chooseFrom.length ? undefined : "loading studies…"}
      options={(chooseFrom || []).map((s) => [s.id, s.name + " (" + s.id + ")"] as const)} /></label>
  );
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="listcohortdialog flex max-h-[85vh] w-[min(94vw,40rem)] max-w-[40rem] flex-col gap-3 overflow-y-auto sm:max-w-[40rem]">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        <ListSource studies={studies || (study ? [study] : [])} studyPicker={picker || undefined} saved={saved}
          doneLabel={doneLabel} doneTitle={doneTitle} nameFor={nameFor} onLogin={onLogin}
          onDone={async (n, d) => { await onDone(n, d); onClose(); }} />
      </DialogContent>
    </Dialog>
  );
}

/** The usual final button: add, or use in place of the one cohort a view draws. */
export const addLabel = (replaces: boolean) => replaces ? "Use" : <><Plus />Add</>;
