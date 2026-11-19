"use client";
// The Allele Freq header's VAF plot (PAT-MT-3, PAT-STM-7), the portal's CompactVAFPlot: a bar-chart
// icon beside the column's name; hovered or focused, the plot of each sample's allele frequencies, its
// histogram and density curve each ticked on or off, and a legend whose entry shows one sample alone.
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/_ui/popover";
import { hasVafs, vafPlotSvg, type VafSample } from "@/lib/views/alterations/vaf-plot";
import type { SampleMark } from "@/lib/timeline-tracks";

export function VafPlotHead({ vafs, marks }: { vafs: Record<string, number[]> | undefined; marks: Map<string, SampleMark> }) {
  const [open, setOpen] = useState(false);
  const [histogram, setHistogram] = useState(true);
  const [curve, setCurve] = useState(true);
  const [only, setOnly] = useState<string | null>(null);
  const samples: VafSample[] = useMemo(() => [...marks.values()].map((m) => ({ id: m.id, label: m.label, color: m.color, values: vafs?.[m.id] ?? [] })), [vafs, marks]);
  const drawn = useMemo(() => vafPlotSvg(samples, { histogram, curve, ...(only ? { only } : {}) }), [samples, histogram, curve, only]);
  if (!vafs || !hasVafs(samples)) return null;
  const legend = samples.filter((s) => s.values.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center text-muted-foreground" aria-label="VAF plot"
          onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
          <BarChart3 size={12} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto p-3 text-sm" onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <div className="mb-1">Variant allele frequency in the tumor sample</div>
        <div className="mb-1 flex gap-3">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={histogram} onChange={() => setHistogram(!histogram)} />histogram</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={curve} onChange={() => setCurve(!curve)} />density estimation</label>
        </div>
        <div className="flex items-start gap-2">
          <div dangerouslySetInnerHTML={{ __html: drawn.svg }} />
          {legend.length > 1 && <ul className="mt-4 flex list-none flex-col gap-1 p-0" aria-label="samples">
            {legend.map((s) => <li key={s.id}>
              <button type="button" className="inline-flex items-center gap-1 rounded border-0 bg-transparent px-1 hover:bg-muted" data-tip={"show " + s.id + " alone"}
                onMouseEnter={() => setOnly(s.id)} onMouseLeave={() => setOnly(null)} onFocus={() => setOnly(s.id)} onBlur={() => setOnly(null)}>
                <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={s.color} />
                  <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{s.label}</text></svg>
                <span className="font-mono text-xs">{s.id}</span>
              </button>
            </li>)}
          </ul>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
