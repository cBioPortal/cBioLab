"use client";
// The analysis page's text dialogs. Each owns what is being typed, so a keystroke re-renders the
// dialog alone rather than the page and every view card on it. Each is mounted when opened: it
// starts from the values it is given, shows itself as a native modal (Esc, focus trapping and the
// backdrop come from the platform), and reports when it closes so the page can unmount it.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc } from "../../lib/types.ts";

/** A native modal dialog shown on mount, closed by Esc, a backdrop click or `close()`. */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const close = () => ref.current?.close();
  return {
    close,
    props: { ref, onClose, onClick: (e: React.MouseEvent) => { if (e.target === ref.current) close(); } },
  };
}

/** Explore's "Save as a cohort": the name, prefilled with the bar's own. */
export function SaveCohortDialog({ initial, meta, onSave, onClose }: {
  initial: string; meta: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const { props, close } = useModal(onClose);
  const [name, setName] = useState(initial);
  return (
    <dialog {...props} className="namedialog savedialog">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; close(); onSave(n); }}>
        <h3>Save as a cohort</h3>
        <p className="meta">{meta}</p>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="cohort name…" />
        <div className="row dlgactions">
          <button type="button" className="linklike" onClick={close}>cancel</button>
          <button className="primary" type="submit" disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </dialog>
  );
}

/** Explore's "Save as feature": the name of the yes/no attribute the current filters become. */
export function SaveFeatureDialog({ initial, meta, onSave, onClose }: {
  initial: string; meta: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const { props, close } = useModal(onClose);
  const [name, setName] = useState(initial);
  return (
    <dialog {...props} className="namedialog savedialog featuredialog">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; close(); onSave(n); }}>
        <h3>Save as feature</h3>
        <p className="meta">{meta}</p>
        <p className="note flush">Patients matching the current filters are <b>Yes</b>, every other patient of the selected
          studies <b>No</b>. The feature is saved with your custom data, frozen as it is now, and can be charted, split
          and filtered on like any attribute.</p>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="feature name…" />
        <div className="row dlgactions">
          <button type="button" className="linklike" onClick={close}>cancel</button>
          <button className="primary" type="submit" disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </dialog>
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
  const { props, close } = useModal(onClose);
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  return (
    <dialog {...props} className="namedialog cohortdialog">
      <form method="dialog" onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        if (n !== initialName && taken(n)) { setError("a cohort named “" + n + "” already exists"); return; }
        close(); onSave(n, notes);
      }}>
        <h3>Edit cohort</h3>
        <label className="wslabel" htmlFor="cename">Name</label>
        <input id="cename" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label className="wslabel dlgsection" htmlFor="cenotes">Note</label>
        <textarea id="cenotes" value={notes} onChange={(e) => setNotes(e.target.value)} spellCheck
          placeholder="What is this cohort? Why is it defined this way?" />
        <div className="row dlgactions">
          <button type="button" className="linklike" onClick={close}>cancel</button>
          <button className="primary" type="submit" disabled={!name.trim()}>Save</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </dialog>
  );
}

/** A view gear menu's "add note…" / "edit note…": one line of prose drawn below its title (see
 *  ViewHead) — what this figure shows, or what to read first, not a second title. Empty removes it. */
export function ViewNoteDialog({ note: initial, onSave, onClose }: {
  note: string; onSave: (note: string) => void; onClose: () => void;
}) {
  const { props, close } = useModal(onClose);
  const [note, setNote] = useState(initial);
  return (
    <dialog {...props} className="namedialog cohortdialog">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); close(); onSave(note.trim()); }}>
        <h3>View note</h3>
        <label className="wslabel" htmlFor="vntext">Note</label>
        <textarea id="vntext" value={note} onChange={(e) => setNote(e.target.value)} autoFocus spellCheck
          placeholder="What does this figure show? What should a reader look at first?" />
        <div className="row dlgactions">
          <button type="button" className="linklike" onClick={close}>cancel</button>
          <button className="primary" type="submit">Save</button>
        </div>
      </form>
    </dialog>
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
  const { props, close } = useModal(onClose);
  // only ever prefilled with the workspace's OWN name — never a cohort name or a generic
  // fallback standing in for one, which read as though the app had already named it for you
  const [name, setName] = useState(doc.title || "");
  const nViews = (doc.views || []).length;
  const nParams = doc.params ? Object.keys(doc.params).length : 0;
  return (
    <dialog {...props} className="namedialog wsdialog">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n) return; close(); onSave(n); }}>
        <h3>{saved ? "Workspace" : "Save workspace"}</h3>
        <p className="meta">
          {nViews} view{nViews === 1 ? "" : "s"}
          {doc.params ? " · " + nParams + " parameter" + (nParams === 1 ? "" : "s") : ""}
          {!saved ? " · not saved yet"
            : JSON.stringify(saved.doc) !== JSON.stringify(doc) ? " · unsaved changes"
            : " · saved " + saved.savedAt}
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="workspace name…" />

        {doc.params && nParams > 0 ? (
          <div className="params dlgsection">
            <div className="row paramshead">
              <strong>Parameters</strong>
              <span className="meta">— change one here and every view that uses it re-runs</span>
            </div>
            {Object.entries(doc.params).map(([k, v]) => (
              <ParamRow key={k} name={k} value={v} busy={busy} onChange={(val) => onParam(k, val)} />
            ))}
            {unusedParams?.length ? (
              <p className="note flush-tight">
                Declared but never used: {unusedParams.map((x) => "$" + x).join(", ")} — usually a
                rename that missed a reference.
              </p>
            ) : null}
          </div>
        ) : nViews > 0 && (
          <p className="note dlgsection flush-x">
            No parameters yet — “make a template” beside the document lifts the study and a
            shared gene list out, so this workup can be re-pointed in one edit.
          </p>
        )}

        <label className="wslabel dlgsection" htmlFor="wsnotes">Notes</label>
        <textarea id="wsnotes" value={doc.notes || ""} spellCheck
          placeholder="What is this analysis for? What should a reader look at first?"
          onChange={(e) => onNotes(e.target.value)} />

        <div className="row dlgactions split">
          <div className="row dlggroup">
            {saved && (
              <button type="button" className="linklike" disabled={busy}
                title={"delete the saved workspace “" + doc.title + "”"} onClick={onDelete}>delete</button>
            )}
          </div>
          <div className="row dlggroup">
            <button type="button" className="linklike" onClick={close}>cancel</button>
            <button className="primary" type="submit" disabled={!name.trim()}>{saved ? "Save changes" : "Save"}</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </dialog>
  );
}

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
      <div className="paramrow">
        <code>${name}</code>
        <div className="pillwrap">
          {items.map(x => (
            <button key={x} type="button" className="pill" disabled={busy}
              title={"remove " + x} onClick={() => onChange(items.filter(y => y !== x))}>
              {x} <span aria-hidden="true">×</span>
            </button>
          ))}
          <input list="view-genes" placeholder="add…" value={add} disabled={busy}
            style={{ width: "7rem" }}
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
      <div className="paramrow">
        <code>${name}</code>
        <input type="number" value={value} disabled={busy}
          onChange={e => onChange(Number(e.target.value))} />
      </div>
    );
  }
  return (
    <div className="paramrow">
      <code>${name}</code>
      <input value={String(value ?? "")} disabled={busy}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}
