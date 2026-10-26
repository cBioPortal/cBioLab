"use client";
// Adding an upload from the saved-work manager, on whatever page it is open over: the studies its ids
// are matched against (those being explored, when the page explores any), then the upload itself
// (AddCustomData: load, check, name and save).
import { useMemo, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { AddCustomData } from "../lab/custom-data-panel.tsx";
import { useStudyList } from "../lab/use-catalogs.ts";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { RemoveBadge } from "../_ui/remove-badge.tsx";

const SHOWN = 8;

export function AddDataDialog({ initial, onAdded, onClose }: { initial: string[]; onAdded: (name: string) => void; onClose: () => void }) {
  const list = useStudyList();
  const [studies, setStudies] = useState(initial);
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return list.studies.filter((x) => !studies.includes(x.id) && (x.id.toLowerCase().includes(s) || x.name.toLowerCase().includes(s)));
  }, [q, list.studies, studies]);
  const name = (id: string) => list.studies.find((x) => x.id === id)?.name;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}
        className="cd-adddialog flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[94vw]">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-6">
          <DialogHeader><DialogTitle className="text-base">Add custom data</DialogTitle></DialogHeader>
          <div data-tw className="grid gap-2.5">
            <p className="m-0 text-md text-muted-foreground">
              Your own annotations (a curated metastasis site, a field extracted from the record), used like any clinical attribute.
              Its ids are matched against the studies it belongs to.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <b className="text-md">Studies</b>
              {studies.map((id) => <RemoveBadge key={id} label={"remove " + id} title={name(id)} onClick={() => setStudies((s) => s.filter((x) => x !== id))}>{id}</RemoveBadge>)}
              <label className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="find a study" className="h-ctl w-72 pl-7 text-md md:text-md"
                  placeholder={studies.length ? "add another study" : "find the study this data belongs to"}
                  onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { setStudies((s) => [...s, matches[0].id]); setQ(""); } }} />
              </label>
              {list.loading && <span className="text-sm text-muted-foreground"><LoaderCircle className="inline size-3.5 animate-spin" /> loading studies…</span>}
              {list.error && <span className="text-sm text-destructive">could not list studies: {list.error} <Button variant="link" size="inline" className="text-sm" onClick={list.retry}>retry</Button></span>}
            </div>
            {q.trim() && !list.loading && <div className="cd-studymatches grid max-w-3xl overflow-hidden rounded-md border border-border">
              {matches.slice(0, SHOWN).map((x) => (
                <button key={x.id} type="button" onClick={() => { setStudies((s) => [...s, x.id]); setQ(""); }}
                  className="flex items-baseline gap-2.5 border-b border-border/60 px-2.5 py-1.5 text-left text-md last:border-0 hover:bg-accent">
                  <code>{x.id}</code><span className="truncate text-muted-foreground">{x.name}</span>
                  <span className="ml-auto text-sm whitespace-nowrap text-muted-foreground">{x.patients.toLocaleString()} patients</span>
                </button>))}
              {!matches.length && <span className="px-2.5 py-1.5 text-md text-muted-foreground">No study matches “{q}”.</span>}
              {matches.length > SHOWN && <span className="px-2.5 py-1.5 text-sm text-muted-foreground">and {matches.length - SHOWN} more: keep typing</span>}
            </div>}
          </div>
          <div className="customdata">
            {studies.length
              ? <AddCustomData key={studies.join(",")} studies={studies} onAdded={onAdded} />
              : <p className="note flush">Choose the study above first: the upload&apos;s ids are matched to its patients or samples.</p>}
          </div>
        </div>
        <div data-tw className="flex justify-end border-t border-border bg-muted/40 px-6 py-3">
          <Button variant="outline" className="cd-cancel" onClick={onClose} title="close without adding anything">Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
