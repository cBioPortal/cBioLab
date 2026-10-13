"use client";
// What the views that show one patient of a cohort at a time share (the timeline, the alterations
// tables): ‹ prev / next › through the cohort's patients in the patient list's order — the order its
// search, filters and sort give it, as the result's `position` places the shown patient — and the
// list itself (the shared table, app/_table/DataTable.tsx) in a dialog, where a click picks one.
import React, { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, List, X } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "./toolbar.ts";

export type PatientKey = { study: string; id: string };
export type ListPosition = { index: number; prev: PatientKey | null; next: PatientKey | null } | null | undefined;

/** ← and → step to the patient before or after — not while typing, nor inside the list's dialog. */
export function patientKeys(position: ListPosition, go: (to: PatientKey | null | undefined) => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest?.("input, select, textarea, dialog")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(position?.prev); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(position?.next); }
  };
}

/**
 * The patient list as a native modal (Esc, focus trapping and the backdrop are the platform's),
 * mounted while open. Esc inside one of the table's own popovers closes that popover, not the list.
 */
export function PatientsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: (close: () => void) => React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const popEsc = useRef(false);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const close = () => ref.current?.close();
  return (
    <dialog ref={ref} className="tl-patients" aria-label={title} onClose={onClose}
      onKeyDownCapture={(e) => { popEsc.current = e.key === "Escape" && !!ref.current?.querySelector(".dt-pop"); }}
      onCancel={(e) => { if (popEsc.current) e.preventDefault(); popEsc.current = false; }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="tl-patients-head">
        <h3 className="flush">{title}</h3>
        <Button type="button" variant="ghost" size="sm" className={TB} onClick={close} aria-label="close the patient list"><X />close</Button>
      </div>
      {children(close)}
    </dialog>
  );
}

/** Prev / next through the cohort's patients in the list's order, and the list itself. */
export function PatientNav({ shown, position, total, updating, go, first, openList, what }: {
  /** the patient shown, or null when the list is empty */
  shown: string | null; position: ListPosition; total: number; updating: boolean;
  go: (to: PatientKey | null | undefined) => void; first: () => void; openList: () => void;
  /** what clicking a patient in the list does, for the button's title ("draw it", "list its alterations") */
  what: string;
}) {
  const pos = position;
  const who = (x: { id: string } | null | undefined) => x ? " (" + x.id + ")" : "";
  return (
    <div className="viewtb tl-nav">
      <div className="tbz">
        <Button type="button" variant="outline" size="sm" className={TB} disabled={updating || !pos?.prev} title={"the patient before this one in the list" + who(pos?.prev) + " — or press ←"}
          onClick={() => go(pos?.prev)}><ChevronLeft />prev</Button>
        <span className="tl-pos">
          {shown && pos ? <>patient <b>{(pos.index + 1).toLocaleString()}</b> of {total.toLocaleString()}</>
            : shown ? <>{shown} is not in the list as filtered</>
            : <>no patients</>}
        </span>
        <Button type="button" variant="outline" size="sm" className={TB} disabled={updating || !pos?.next} title={"the patient after this one in the list" + who(pos?.next) + " — or press →"}
          onClick={() => go(pos?.next)}>next<ChevronRight /></Button>
        {shown && !pos && <Button type="button" variant="outline" size="sm" className={TB} disabled={updating || !total} onClick={first} title="show the list's first patient">go to the first patient</Button>}
        <Button type="button" variant="outline" size="sm" className={TB} onClick={openList} title={"the cohort's patients: search, filter, sort, download, and click one to " + what}><List />List/Search</Button>
      </div>
    </div>
  );
}
