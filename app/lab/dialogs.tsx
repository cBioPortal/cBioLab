"use client";
// The analysis page's text dialogs. Each owns what is being typed, so a keystroke re-renders the
// dialog alone rather than the page and every view card on it. Each is mounted when opened: it
// starts from the values it is given, opens at once (Esc, focus trapping and the backdrop come
// from the dialog primitive), and reports when it closes so the page can unmount it.
import { useState } from "react";
import type { AnalysisDoc } from "../../lib/types.ts";
import { cn } from "../../lib/cn";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Label } from "../_ui/label";
import { Textarea } from "../_ui/textarea";

/** A form in a modal that is open while mounted; Esc, a backdrop click and Cancel all close it. */
function FormDialog({ className, title, onClose, onSubmit, children, footer }: {
  /** the dialog's own name, as a class, for tests to find it by */
  className: string;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  /** the actions, after Cancel; a submit button among them submits the form */
  footer: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className={cn("gap-0 sm:max-w-md", className)}>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-3">
          <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
          {children}
          <DialogFooter className="mt-1 items-center">{footer}</DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const META = "text-sm text-muted-foreground";
const FIELD = "h-9 text-md md:text-md";
const AREA = "min-h-18 bg-muted text-md md:text-md";

function CancelSave({ onClose, disabled, label = "Save" }: { onClose: () => void; disabled?: boolean; label?: string }) {
  return <>
    <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
    <Button type="submit" disabled={disabled}>{label}</Button>
  </>;
}

/** Explore's "Save as a cohort": the name, prefilled with the bar's own. */
export function SaveCohortDialog({ initial, meta, onSave, onClose }: {
  initial: string; meta: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <FormDialog className="savedialog" title="Save as a cohort" onClose={onClose}
      onSubmit={() => { const n = name.trim(); if (!n) return; onSave(n); onClose(); }}
      footer={<CancelSave onClose={onClose} disabled={!name.trim()} />}>
      <p className={META}>{meta}</p>
      <Input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="cohort name…" />
    </FormDialog>
  );
}

/** Explore's "Save as feature": the name of the yes/no attribute the current filters become. */
export function SaveFeatureDialog({ initial, meta, onSave, onClose }: {
  initial: string; meta: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <FormDialog className="savedialog featuredialog" title="Save as feature" onClose={onClose}
      onSubmit={() => { const n = name.trim(); if (!n) return; onSave(n); onClose(); }}
      footer={<CancelSave onClose={onClose} disabled={!name.trim()} />}>
      <p className={META}>{meta}</p>
      <p className="text-md text-muted-foreground">Patients matching the current filters are <b>Yes</b>, every other patient of the selected
        studies <b>No</b>. The feature is saved with your custom data, frozen as it is now, and can be charted, split
        and filtered on like any attribute.</p>
      <Input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="feature name…" />
    </FormDialog>
  );
}

/** The cohort gear menu's "edit…": name and note together, since renaming is the one cohort-level
 *  edit the app supports without reopening Explore or the JSON editor. */
export function CohortEditDialog({ name: initialName, notes: initialNotes, taken, onSave, onClose }: {
  name: string; notes: string;
  /** another cohort already has this name */
  taken: (name: string) => boolean;
  onSave: (name: string, notes: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog className="cohortdialog" title="Edit cohort" onClose={onClose}
      onSubmit={() => {
        const n = name.trim();
        if (!n) return;
        if (n !== initialName && taken(n)) { setError("a cohort named “" + n + "” already exists"); return; }
        onSave(n, notes); onClose();
      }}
      footer={<CancelSave onClose={onClose} disabled={!name.trim()} />}>
      <div className="grid gap-1.5">
        <Label htmlFor="cename" className={META}>Name</Label>
        <Input id="cename" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cenotes" className={META}>Note</Label>
        <Textarea id="cenotes" className={AREA} value={notes} onChange={(e) => setNotes(e.target.value)} spellCheck
          placeholder="What is this cohort? Why is it defined this way?" />
      </div>
      {error && <p className="error text-md text-destructive">{error}</p>}
    </FormDialog>
  );
}

/** A view gear menu's "add note…" / "edit note…": one line of prose drawn below its title (see
 *  ViewHead) — what this figure shows, or what to read first, not a second title. Empty removes it. */
export function ViewNoteDialog({ note: initial, onSave, onClose }: {
  note: string; onSave: (note: string) => void; onClose: () => void;
}) {
  const [note, setNote] = useState(initial);
  return (
    <FormDialog className="cohortdialog" title="View note" onClose={onClose}
      onSubmit={() => { onSave(note.trim()); onClose(); }}
      footer={<CancelSave onClose={onClose} />}>
      <div className="grid gap-1.5">
        <Label htmlFor="vntext" className={META}>Note</Label>
        <Textarea id="vntext" className={AREA} value={note} onChange={(e) => setNote(e.target.value)} autoFocus spellCheck
          placeholder="What does this figure show? What should a reader look at first?" />
      </div>
    </FormDialog>
  );
}

/**
 * The workspace editor: name, parameters, notes, and what to do with it, behind the "Save
 * workspace" button on the Analysis tab. Parameters and notes are the document's own and change
 * as they are edited (a parameter re-runs the views that use it); the name is saved with Save.
 */
export function WorkspaceDialog({ doc, saved, busy, unusedParams, error, onParam, onNotes, onDelete, onSave, onClose }: {
  doc: AnalysisDoc;
  /** the workspace as saved under this document's title, if it is */
  saved: { doc: AnalysisDoc; savedAt: string } | undefined;
  busy: boolean;
  unusedParams: string[] | undefined;
  error: string | null;
  onParam: (name: string, value: unknown) => void;
  onNotes: (notes: string) => void;
  onDelete: () => void;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  // only ever prefilled with the workspace's OWN name — never a cohort name or a generic
  // fallback standing in for one, which read as though the app had already named it for you
  const [name, setName] = useState(doc.title || "");
  const nViews = (doc.views || []).length;
  const nParams = doc.params ? Object.keys(doc.params).length : 0;
  return (
    <FormDialog className="wsdialog sm:max-w-lg" title={saved ? "Workspace" : "Save workspace"} onClose={onClose}
      onSubmit={() => { const n = name.trim(); if (!n) return; onSave(n); onClose(); }}
      footer={<>
        {saved && (
          <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={busy}
            title={"delete the saved workspace “" + doc.title + "”"} onClick={onDelete}>Delete</Button>
        )}
        <CancelSave onClose={onClose} disabled={!name.trim()} label={saved ? "Save changes" : "Save"} />
      </>}>
      <p className={cn(META, "meta")}>
        {nViews} view{nViews === 1 ? "" : "s"}
        {doc.params ? " · " + nParams + " parameter" + (nParams === 1 ? "" : "s") : ""}
        {!saved ? " · not saved yet"
          : JSON.stringify(saved.doc) !== JSON.stringify(doc) ? " · unsaved changes"
          : " · saved " + saved.savedAt}
      </p>
      <Input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="workspace name…" />

      {doc.params && nParams > 0 ? (
        <div className="grid gap-1.5 rounded-sm border bg-muted px-2.5 py-2">
          <div className="flex items-baseline gap-1.5">
            <strong className="text-md">Parameters</strong>
            <span className={META}>— change one here and every view that uses it re-runs</span>
          </div>
          {Object.entries(doc.params).map(([k, v]) => (
            <ParamRow key={k} name={k} value={v} busy={busy} onChange={(val) => onParam(k, val)} />
          ))}
          {unusedParams?.length ? (
            <p className="text-sm text-muted-foreground">
              Declared but never used: {unusedParams.map((x) => "$" + x).join(", ")} — usually a
              rename that missed a reference.
            </p>
          ) : null}
        </div>
      ) : nViews > 0 && (
        <p className="text-md text-muted-foreground">
          No parameters yet — “make a template” beside the document lifts the study and a
          shared gene list out, so this workup can be re-pointed in one edit.
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="wsnotes" className={META}>Notes</Label>
        <Textarea id="wsnotes" className={AREA} value={doc.notes || ""} spellCheck
          placeholder="What is this analysis for? What should a reader look at first?"
          onChange={(e) => onNotes(e.target.value)} />
      </div>
      {error && <p className="error text-md text-destructive">{error}</p>}
    </FormDialog>
  );
}

const PARAM = "flex items-center gap-2 text-md";
const PARAM_NAME = "min-w-22 text-accent-foreground";

/**
 * One editable template parameter. The control follows the value's TYPE, so a gene list edits as
 * chips and a study edits as text — the point of a template is that retargeting is a normal edit,
 * not JSON surgery.
 */
function ParamRow({ name, value, busy, onChange }:
  { name: string; value: unknown; busy: boolean; onChange: (v: unknown) => void }) {
  const [add, setAdd] = useState("");
  if (Array.isArray(value)) {
    const items = value.map(String);
    return (
      <div className={PARAM}>
        <code className={PARAM_NAME}>${name}</code>
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {items.map(x => (
            <button key={x} type="button" className="pill cursor-pointer px-2 py-0.5 text-sm" disabled={busy}
              title={"remove " + x} onClick={() => onChange(items.filter(y => y !== x))}>
              {x} <span aria-hidden="true">×</span>
            </button>
          ))}
          <Input list="view-genes" placeholder="add…" value={add} disabled={busy} className="h-7 w-28 text-md md:text-md"
            onChange={e => setAdd(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = add.trim().toUpperCase();
              if (v && !items.includes(v)) onChange([...items, v]);
              setAdd("");
            }} />
        </div>
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <div className={PARAM}>
        <code className={PARAM_NAME}>${name}</code>
        <Input type="number" className="h-7 flex-1 text-md md:text-md" value={value} disabled={busy}
          onChange={e => onChange(Number(e.target.value))} />
      </div>
    );
  }
  return (
    <div className={PARAM}>
      <code className={PARAM_NAME}>${name}</code>
      <Input className="h-7 flex-1 text-md md:text-md" value={String(value ?? "")} disabled={busy}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}
