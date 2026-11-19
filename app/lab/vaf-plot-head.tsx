"use client";
// The Allele Freq header's VAF plot (PAT-MT-3, PAT-STM-7), the portal's CompactVAFPlot: a bar-chart
// icon beside the column's name; hovered, or clicked to keep it open, the plot of each sample's allele
// frequencies, its histogram and density curve each ticked on or off, and a legend of the samples in
// view whose entry shows one sample alone.
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { HoverPopover } from "@/app/_ui/hover-popover";
import { Checkbox } from "@/app/_ui/checkbox";
import { hasVafs, vafPlotSvg, vafSeries, type VafSample } from "@/lib/views/alterations/vaf-plot";
import type { SampleMark } from "@/lib/timeline-tracks";
import { SampleMarker } from "@/app/portal/sample-marker";

export function VafPlotHead({ vafs, marks }: { vafs: Record<string, number[]> | undefined; marks: Map<string, SampleMark> }) {
  // the ticks outlast the popover's closing, as the portal's plot (kept mounted) keeps them
  const [histogram, setHistogram] = useState(true);
  const [curve, setCurve] = useState(true);
  const samples: VafSample[] = useMemo(() => [...marks.values()].map((m) => ({ id: m.id, label: m.label, color: m.color, values: vafs?.[m.id] ?? [] })), [vafs, marks]);
  if (!vafs || !hasVafs(samples)) return null;
  return (
    <HoverPopover trigger={<BarChart3 size={12} aria-hidden="true" />} side="top" className="w-auto p-3 text-sm"
      pinned={{ label: "VAF plot", tip: "the samples' allele frequencies: hover to see them, click to keep them open", className: "inline-flex items-center text-muted-foreground" }}>
      <VafPlot samples={samples} histogram={histogram} curve={curve} setHistogram={setHistogram} setCurve={setCurve} />
    </HoverPopover>
  );
}

/** The plot, worked out when the popover opens and once per patient's data; the ticks and the legend only redraw it. */
function VafPlot({ samples, histogram, curve, setHistogram, setCurve }: {
  samples: VafSample[]; histogram: boolean; curve: boolean; setHistogram: (on: boolean) => void; setCurve: (on: boolean) => void;
}) {
  const [only, setOnly] = useState<string | null>(null);
  const series = useMemo(() => vafSeries(samples), [samples]);
  const drawn = useMemo(() => vafPlotSvg(series, { histogram, curve, ...(only ? { only } : {}) }), [series, histogram, curve, only]);
  return (
    <>
      <div className="mb-1">Variant allele frequency in the tumor sample</div>
      <div className="mb-1 flex gap-3">
        <label className="chk"><Checkbox checked={histogram} onCheckedChange={(on) => setHistogram(on === true)} /> histogram</label>
        <label className="chk"><Checkbox checked={curve} onCheckedChange={(on) => setCurve(on === true)} /> density estimation</label>
      </div>
      <div className="flex items-start gap-2">
        <div dangerouslySetInnerHTML={{ __html: drawn.svg }} />
        {samples.length > 1 && <ul className="mt-4 flex list-none flex-col gap-1 p-0" aria-label="samples">
          {samples.map((s) => <li key={s.id}>
            <button type="button" className="inline-flex items-center gap-1 rounded border-0 bg-transparent px-1 hover:bg-muted"
              data-tip={s.values.length ? "show " + s.id + " alone" : s.id + " has no allele counts"}
              onMouseEnter={() => setOnly(s.id)} onMouseLeave={() => setOnly(null)} onFocus={() => setOnly(s.id)} onBlur={() => setOnly(null)}>
              <SampleMarker mark={s} className="shrink-0" /><span className="font-mono text-xs">{s.id}</span>
            </button>
          </li>)}
        </ul>}
      </div>
    </>
  );
}
