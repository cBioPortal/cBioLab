"use client";
// The Patient page's gene panel window (PatientViewGenePanelModal, GenesList; PAT-GP-3): titled
// "Gene Panel", the panel's id and gene count, a filter box, the genes down three columns, and the
// list's download. Any gene-panel link on the page opens it (PAT-GP-4).
import { useRef, useState } from "react";
import { api } from "./api.ts";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { filterPanelGenes, panelGeneRows, panelGenesTsv } from "../../lib/gene-panel-list.ts";
import { saveBlob } from "../../lib/study-view-download.ts";

type Shown = { panel: string; genes?: string[]; error?: string };
const COLUMNS = 3;

/** the window, and `open(panel)` for the page's panel links; `study` holds the panel's definition */
export function useGenePanelDialog(study: string) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [filter, setFilter] = useState("");
  // the request the open window waits for; a reply to an earlier one (or after closing) is dropped
  const asked = useRef(0);
  const close = () => { asked.current++; setShown(null); setFilter(""); };
  const open = async (panel: string) => {
    const mine = ++asked.current;
    setShown({ panel }); setFilter("");
    const answer = (s: Shown) => { if (asked.current === mine) setShown(s); };
    const r = await api.genes({ panel: { id: panel, study } }).catch(() => null);
    if (!r) return answer({ panel, error: "the server could not be reached" });
    const j = await r.json().catch(() => ({ error: "the server's answer could not be read" }));
    answer(r.ok && Array.isArray(j.genes) ? { panel, genes: j.genes as string[] } : { panel, error: j.error || "the panel's genes could not be read" });
  };
  const kept = shown?.genes ? filterPanelGenes(shown.genes, filter) : [];
  const node = (
    <Dialog open={!!shown} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent data-test="patient-gene-panel">
        <DialogHeader><DialogTitle data-test="gene-panel-modal-title">Gene Panel</DialogTitle></DialogHeader>
        <div className="max-h-[calc(100vh-210px)] overflow-y-auto" data-test="gene-panel-modal-body">
          {shown && !shown.genes && !shown.error && <span className="spinner" data-tip="reading the panel's genes" />}
          {shown?.error && <p className="note flush">{shown.error}</p>}
          {shown?.genes && <>
            <h4 className="flush">{shown.panel}</h4>
            <div className="flex items-center gap-2">
              <span>Number of genes: {shown.genes.length}</span>
              <span className="spacer" />
              <Input className="h-8 w-48" aria-label="filter the panel's genes" placeholder="filter genes" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <Button variant="outline" size="sm" onClick={() => saveBlob(shown.panel + ".tsv", new Blob([panelGenesTsv(shown.genes!)], { type: "text/tab-separated-values" }))}>Download</Button>
            </div>
            <table className="dt-table" data-test="gene-panel-genes">
              <thead><tr>{Array.from({ length: COLUMNS }, (_, i) => <th key={i}>{i === 0 ? "Genes" : ""}</th>)}</tr></thead>
              <tbody>{panelGeneRows(kept, COLUMNS).map((row, i) => <tr key={i}>{row.map((g, j) => <td key={j}>{g}</td>)}</tr>)}</tbody>
            </table>
          </>}
        </div>
        <DialogFooter><DialogClose asChild><Button variant="outline" data-test="modal-button">Close</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { open, node };
}
