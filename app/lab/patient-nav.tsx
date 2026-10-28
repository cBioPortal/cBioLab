"use client";
// What the views that show one patient of a cohort at a time share (the timeline, the alterations
// tables): ‹ prev / next › through the cohort's patients in the patient list's order — the order its
// search, filters and sort give it, as the result's `position` places the shown patient — and the
// list itself (the shared table, app/_table/DataTable.tsx) in a dialog, where a click picks one.
import React from "react";
import { ChevronLeft, ChevronRight, List, X } from "lucide-react";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogTitle } from "../_ui/dialog";
import { TB } from "../_ui/toolbar.ts";

export type PatientKey = { study: string; id: string };
export type ListPosition = { index: number; prev: PatientKey | null; next: PatientKey | null } | null | undefined;

/** ← and → step to the patient before or after — not while typing, nor inside the list's dialog. */
export function patientKeys(position: ListPosition, go: (to: PatientKey | null | undefined) => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest?.("input, select, textarea, dialog, [role=dialog]")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(position?.prev); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(position?.next); }
  };
}

/**
 * The patient list in a modal, mounted while open. Esc inside one of the table's own popovers closes
 * that popover, not the list. The dialog is centred without a transform, so the table's popovers,
 * which are fixed to the viewport, are placed against the viewport.
 */
export function PatientsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: (close: () => void) => React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} showCloseButton={false}
        onEscapeKeyDown={(e) => { if (document.querySelector("[role=dialog].tl-patients .dt-pop")) e.preventDefault(); }}
        className="tl-patients inset-0 m-auto block h-fit max-h-[88vh] w-[min(94vw,72rem)] max-w-[94vw] translate-none overflow-auto p-4 sm:max-w-[94vw]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <Button type="button" variant="ghost" size="sm" className={TB} onClick={onClose} aria-label="close the patient list"><X />close</Button>
        </div>
        {children(onClose)}
      </DialogContent>
    </Dialog>
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
        <Button type="button" variant="outline" size="sm" className={TB} disabled={updating || !pos?.prev} data-tip={"the patient before this one in the list" + who(pos?.prev) + " — or press ←"}
          onClick={() => go(pos?.prev)}><ChevronLeft />prev</Button>
        <span className="tl-pos">
          {shown && pos ? <>patient <b>{(pos.index + 1).toLocaleString()}</b> of {total.toLocaleString()}</>
            : shown ? <>{shown} is not in the list as filtered</>
            : <>no patients</>}
        </span>
        <Button type="button" variant="outline" size="sm" className={TB} disabled={updating || !pos?.next} data-tip={"the patient after this one in the list" + who(pos?.next) + " — or press →"}
          onClick={() => go(pos?.next)}>next<ChevronRight /></Button>
        {shown && !pos && <Button type="button" variant="outline" size="sm" className={TB} disabled={updating || !total} onClick={first} data-tip="show the list's first patient">go to the first patient</Button>}
        <Button type="button" variant="outline" size="sm" className={TB} onClick={openList} data-tip={"the cohort's patients: search, filter, sort, download, and click one to " + what}><List />List/Search</Button>
      </div>
    </div>
  );
}
