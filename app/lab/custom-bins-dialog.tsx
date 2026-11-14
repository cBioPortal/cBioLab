"use client";
// A numeric chart's "Custom Bins" (the Study View's STS-BAR-8): Quartiles, Median split, Generate
// bins from a size and a starting value, or Custom bins typed as edges. An empty Custom box goes
// back to the default bins (STS-STM-10).
import { useState } from "react";
import type { NumericBin } from "../../lib/types.ts";
import { binEdges, parseEdges, parseGenerate, type BinMethod, type ChartBins } from "../../lib/study-view-bins.ts";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { Label } from "../_ui/label";
import { RadioGroup, RadioGroupItem } from "../_ui/radio-group";
import { Textarea } from "../_ui/textarea";

type Method = BinMethod["method"];
const METHODS: [Method, string][] = [["quartile", "Quartiles"], ["median", "Median split"], ["generate", "Generate bins"], ["custom", "Custom bins"]];

export default function CustomBinsDialog({ label, bars, current, onApply, onClose }: {
  label: string;
  /** the chart's bars as drawn now: the Custom box starts from their edges */
  bars: NumericBin[] | undefined;
  current: ChartBins | undefined;
  /** the chart's new bin method; null for the default bins */
  onApply: (bins: BinMethod | null) => void;
  onClose: () => void;
}) {
  const cur = current?.bins;
  const [method, setMethod] = useState<Method>(cur?.method ?? "custom");
  const [edges, setEdges] = useState((cur?.method === "custom" ? cur.edges : binEdges(bars)).join(", "));
  const [size, setSize] = useState(cur?.method === "generate" ? String(cur.size) : "");
  const [anchor, setAnchor] = useState(cur?.method === "generate" ? String(cur.anchor) : "0");
  const result = (): { bins: BinMethod | null } | { why: string } => {
    if (method === "quartile" || method === "median") return { bins: { method } };
    if (method === "generate") return parseGenerate(size, anchor);
    const r = parseEdges(edges);
    return "why" in r ? r : { bins: r.edges ? { method: "custom", edges: r.edges } : null };
  };
  const r = result();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-tw aria-describedby={undefined} className="custombins gap-0 sm:max-w-md">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if ("why" in r) return; onApply(r.bins); onClose(); }}>
          <DialogHeader><DialogTitle className="text-base">Custom Bins · {label}</DialogTitle></DialogHeader>
          <RadioGroup value={method} onValueChange={(v) => setMethod(v as Method)} className="gap-2" aria-label="bin method">
            {METHODS.map(([m, name]) => (
              <div key={m} className="flex items-center gap-2">
                <RadioGroupItem value={m} id={"cb-" + m} />
                <Label htmlFor={"cb-" + m} className="text-md font-normal">{name}</Label>
              </div>
            ))}
          </RadioGroup>
          {method === "custom" && <div className="grid gap-1.5">
            <Label htmlFor="cb-edges" className="text-sm text-muted-foreground">Bin boundaries of the x axis, separated by commas (empty: the default bins)</Label>
            <Textarea id="cb-edges" value={edges} onChange={(e) => setEdges(e.target.value)} rows={3} />
          </div>}
          {method === "generate" && <div className="flex gap-3">
            <div className="grid gap-1.5"><Label htmlFor="cb-size" className="text-sm text-muted-foreground">Bin size</Label>
              <Input id="cb-size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="cb-anchor" className="text-sm text-muted-foreground">Min value</Label>
              <Input id="cb-anchor" inputMode="decimal" value={anchor} onChange={(e) => setAnchor(e.target.value)} /></div>
          </div>}
          {"why" in r && <p className="error text-md text-destructive">{r.why}</p>}
          <DialogFooter className="mt-1 items-center">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={"why" in r} data-tip={"why" in r ? r.why : undefined}>Update</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
