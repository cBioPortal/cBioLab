"use client";
// The gene tables' Freq cell: its tooltip (gene-tables-cases.md GP1–GP2) names the gene panels,
// and each name opens a dialog listing that panel's genes (GP6–GP11).
import { useState } from "react";
import { api } from "./api.ts";
import { FloatingTip, useHoverTip, type TipBox } from "../_ui/tooltip";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Button } from "../_ui/button";
import { freqTipLines, panelNote, type GeneTableKind } from "../../lib/study-view-gene-tables.ts";
import type { GeneTableRow } from "../../lib/types.ts";

type Tip = { at: TipBox; row: GeneTableRow };
type Listed = { panel: string; genes?: string[]; error?: string };

/** a table's Freq tooltips and its panel dialog: the cells call `cell`, the table draws `node` once */
export function usePanelTips(kind: GeneTableKind, studies: string[]) {
  const { tip, move, hide, live } = useHoverTip<Tip>();
  const [open, setOpen] = useState<Listed | null>(null);

  const show = async (panel: string) => {
    hide();
    setOpen({ panel });
    let error = "";
    for (const study of studies) {
      const r = await api.genes({ panel: { id: panel, study } });
      const j = await r.json().catch(() => ({ error: "the server's answer could not be read" }));
      if (r.ok) { setOpen({ panel, genes: j.genes as string[] }); return; }
      error = j.error || "the panel's genes could not be read";
    }
    setOpen({ panel, error: error || "no study is selected" });
  };

  const cell = (row: GeneTableRow, text: string) => {
    const at = (el: HTMLElement): TipBox => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return (
      <button type="button" className="gnum gfreq"
        onPointerEnter={(e) => move({ at: at(e.currentTarget), row }, e.clientX, e.clientY)}
        onPointerLeave={(e) => move(null, e.clientX, e.clientY)}
        onFocus={(e) => { const b = at(e.currentTarget); move({ at: b, row }, b.left, b.top); }}
        onBlur={() => move(null, 0, 0)}>
        {text}
      </button>
    );
  };

  const lines = tip ? freqTipLines(kind, tip.row) : [];
  const panels = tip?.row.panels || [];
  const node = <>
    {tip && (
      <FloatingTip at={tip.at} live={live} className="freq-tip-box">
        <div className="freq-tip">
          {lines.slice(0, 2).map((l) => <div key={l}>{l}</div>)}
          <div>Gene panels:{" "}{panels.length ? panels.map((p, i) => (
            <span key={p}>{i > 0 && ", "}<button type="button" className="linkish" data-test={"gene-panel-linkout-" + p}
              onClick={() => { void show(p); }}>{p}</button></span>
          )) : "none"}</div>
        </div>
      </FloatingTip>
    )}
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle data-test="gene-panel-modal-title">{open?.panel}</DialogTitle></DialogHeader>
        <div className="max-h-[calc(100vh-210px)] overflow-y-auto" data-test="gene-panel-modal-body">
          {open && !open.genes && !open.error && <span className="spinner" data-tip="reading the panel's genes" />}
          {open?.error && <p className="note flush">{open.error}</p>}
          {open?.genes && <>
            {(() => { const note = panelNote(open.panel, open.genes); return note ? <p className="note flush">{note}</p> : null; })()}
            {open.genes.map((g) => <p key={g} className="flush">{g}</p>)}
          </>}
        </div>
        <DialogFooter><DialogClose asChild><Button variant="outline" data-test="modal-button">Close</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
  return { cell, node };
}
