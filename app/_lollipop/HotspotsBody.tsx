"use client";
// The lollipop as the app shows it: each gene's plot, with the portal's gene summary beside it
// (transcript ids, somatic mutation frequency) and the Driver/VUS × alteration class grid as a
// control. The grid's selection — the cells hidden — is the view's `hide`, applied here from the
// whole result (lib/lollipop.ts filterHotspotGene), so a click redraws at once and re-runs nothing.
// The figure itself (lib/view-svg.ts) is the plot alone; a figure that travels without the app
// carries the summary and the selection in its caption instead.
import React, { useMemo, useRef, useState } from "react";
import type { ViewResultOf } from "../../lib/types.ts";
import { filterHotspotGene, clickCodon, defaultYMax, lollipopGeneEmpty, nextYMax, hasGermlineRate, statusFilter, statusSelection, withStatusFilter, STATUS_COLUMN, type CodonSelection, type StatusSelection } from "../../lib/lollipop.ts";
import type { LollipopRows } from "../../lib/federation.ts";
import { AlterationGrid, classesOf } from "./AlterationGrid.tsx";
import { TranscriptSummary } from "./TranscriptSummary.tsx";
import { ColorLegend } from "./ColorLegend.tsx";
import { LollipopTools } from "./LollipopTools.tsx";
import { useStemClicks } from "./use-stem-clicks.ts";
import { lollipopPanelsSvg } from "../../lib/lollipop-svg.ts";
import { DrawAtWidth } from "../lab/figure.tsx";
import { fmtShare } from "../../lib/chart/format.ts";
import { X } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import type { HotspotGene } from "../../lib/views/hotspots/types.ts";

/**
 * The transcript and its ids, and the somatic (and, when any, germline) mutation frequency — the portal's GeneSummary.
 * With a germline mutation the two rates are the portal's Somatic / Germline badges (MutationStatusSelector): each
 * toggles that status in or out of the tab's mutations; the rates themselves never change with them.
 */
function GeneSummary({ g, grch38, status, onStatus }: { g: HotspotGene; grch38: boolean; status: StatusSelection; onStatus?: (next: StatusSelection) => void }) {
  const freq = g.cohortSamples ? fmtShare(g.somaticSamples / g.cohortSamples) : "–";
  const germline = hasGermlineRate(g);
  const badges = germline && !!onStatus;
  const rate = (key: keyof StatusSelection, label: string, value: string, tip: string) => badges
    ? <button type="button" className={"lp-freq lp-status w-full text-left" + (status[key] ? "" : " off")} aria-pressed={status[key]}
        data-tip={tip + " — click to " + (status[key] ? "leave out" : "show") + " " + key + " mutations"} onClick={() => onStatus!({ ...status, [key]: !status[key] })}>
        <span>{label}</span> <b>{value}</b>
      </button>
    : <div className="lp-freq" data-tip={tip}><span>{label}</span> <b>{value}</b></div>;
  return (
    <>
      <TranscriptSummary ids={g.ids} gene={g.gene} grch38={grch38} />
      {/* the portal shows no frequency for a gene with no mutation (ResultsViewMutationMapper) */}
      {!lollipopGeneEmpty(g) && <div className="lp-summary">
        {rate("somatic", "Somatic Mutation Frequency", freq, g.somaticSamples.toLocaleString() + " of " + g.cohortSamples.toLocaleString() + " samples carry a somatic mutation in " + g.gene)}
        {/* the portal adds the germline rate only when some sample has a germline mutation (MutationRateSummary), over the germline-consented samples where a study lists them */}
        {germline && rate("germline", "Germline Mutation Frequency", fmtShare((g.germlineSamples ?? 0) / (g.germlineCohortSamples ?? 1)),
          (g.germlineSamples ?? 0).toLocaleString() + " of " + (g.germlineCohortSamples ?? 0).toLocaleString() + " samples carry a germline mutation in " + g.gene)}
      </div>}
    </>
  );
}

/**
 * The portal's Y-Axis Max: a slider from 1 to the default maximum (the tallest stem, at least 5) and a number
 * box that also takes larger values; below 1 is read as 1, and the default itself clears the setting.
 */
function YAxisMax({ gene, value, onChange }: { gene: HotspotGene; value?: number; onChange: (next: number | undefined) => void }) {
  const def = defaultYMax(gene);
  const set = (n: number) => { const next = nextYMax(n, def); if (next !== null) onChange(next); };
  const shown = value ?? def;
  return (
    <label className="inline-flex items-center gap-1.5 text-sm" data-tip={"the y axis's maximum; the default is " + def + ", the tallest stem (at least 5)"}>
      <span>Y-Axis Max:</span>
      <input type="range" min={1} max={def} step={1} value={Math.min(shown, def)} aria-label={"y axis maximum for " + gene.gene} onChange={(e) => set(Number(e.target.value))} />
      <input type="number" min={1} step={1} value={shown} className="w-16 rounded border px-1" aria-label={"y axis maximum for " + gene.gene + ", any value"}
        onChange={(e) => { if (e.target.value.trim() !== "") set(Number(e.target.value)); }} />
    </label>
  );
}

/** One gene's plot: the renderer's figure, its stems clickable (use-stem-clicks.ts). */
function GenePlot({ gene, selected, onSelect, annotated, yMax, onYMax }: { gene: HotspotGene; selected: number[]; onSelect: (next: number[]) => void; annotated: boolean;
  /** the y axis's maximum the reader set, and where a change writes it (undefined: the default) */
  yMax?: number; onYMax: (next: number | undefined) => void }) {
  const caps = yMax != null ? { [gene.gene]: yMax } : undefined;
  const box = useRef<HTMLDivElement>(null);
  const [legend, setLegend] = useState(false);
  useStemClicks(box, {
    pick: (codon, multi) => onSelect(clickCodon(selected, codon, multi)),
    clear: () => { if (selected.length) onSelect([]); },
  });
  return (
    <div className="lp-plot flex-[1_1_560px]">
      <div className="flex items-center justify-end gap-3">
        <YAxisMax gene={gene} value={yMax} onChange={onYMax} />
        <LollipopTools legend={legend} onLegend={setLegend} filename={gene.gene + "_mutation_diagram"}
          svg={() => { const w = box.current?.getBoundingClientRect().width; return w ? lollipopPanelsSvg([gene], { width: Math.round(w), theme: "light" }, "", { [gene.gene]: selected }, caps) : null; }} />
      </div>
      {legend && <ColorLegend drivers={annotated} />}
      <div ref={box}>
        <DrawAtWidth draw={(width) => lollipopPanelsSvg([gene], { width }, "", { [gene.gene]: selected }, caps)} deps={[gene, selected.join(","), yMax ?? ""]} />
      </div>
    </div>
  );
}

/**
 * The codons selected on one gene's plot, as the banner lists them: each a badge a click removes,
 * with how many of the mutations drawn sit there.
 */
function SelectedCodons({ g, selected, onSelect }: { g: HotspotGene; selected: number[]; onSelect: (next: number[]) => void }) {
  const n = g.positions.filter((q) => selected.includes(q.pos)).reduce((a, q) => a + q.n, 0);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {g.gene} codon{selected.length === 1 ? "" : "s"}
      {selected.map((p) => (
        <Button key={p} type="button" variant="outline" size="sm" className={TB} aria-label={"deselect codon " + p}
          data-tip={"deselect codon " + p} onClick={() => onSelect(selected.filter((x) => x !== p))}>{p}<X /></Button>
      ))}
      <span className="meta">({n.toLocaleString()} mutation{n === 1 ? "" : "s"} drawn there)</span>
    </span>
  );
}

export function HotspotsBody({ v, hide: hideList, onHide, codons, onCodons, yMax, onYMax, table, onTable }: { v: ViewResultOf<"hotspots">; hide?: string[]; onHide: (next: string[] | undefined) => void;
  /** the table query that narrows the plot (the view's `table`), and where the Somatic / Germline badges write its status filter (omitted: no badges) */
  table?: LollipopRows; onTable?: (next: LollipopRows | undefined) => void;
  /** the stems selected on each gene's plot, and where a click writes the next selection */
  codons?: CodonSelection; onCodons: (next: CodonSelection | undefined) => void;
  /** each gene's y-axis maximum the reader set, and where a change writes it (omitted: no control) */
  yMax?: Record<string, number>; onYMax?: (next: Record<string, number> | undefined) => void }) {
  const genes = useMemo(() => (v.hotspots || []) as HotspotGene[], [v.hotspots]);
  const hide = useMemo(() => new Set(hideList || []), [hideList]);
  const classes = classesOf(genes.map((g) => g.tally));
  const set = (next: string[]) => onHide(next.length ? [...next].sort() : undefined);
  const drawn = useMemo(() => genes.map((g) => filterHotspotGene(g, [...hide])), [genes, hide]);
  if (!genes.length) return <p className="note">{v.note || "no mutations in these genes for this cohort"}</p>;
  const shown = drawn.reduce((n, d) => n + d.shown, 0), total = drawn.reduce((n, d) => n + d.total, 0);
  const unclassed = drawn.reduce((n, d) => n + d.unclassed, 0);
  const picked = (gene: string) => (codons || {})[gene] || [];
  const pick = (gene: string, next: number[]) => {
    const all: CodonSelection = { ...(codons || {}), [gene]: next };
    if (!next.length) delete all[gene];
    onCodons(Object.keys(all).length ? all : undefined);
  };
  const anyPicked = drawn.some((d) => picked(d.gene.gene).length);
  return (
    <div className="lp">
      {hide.size > 0 && (
        <div className="lp-banner" role="status">
          Showing <b>{shown.toLocaleString()}</b> of {total.toLocaleString()} mutations
          {unclassed ? <span className="meta"> ({unclassed.toLocaleString()} from a site that reports no alteration class, drawn regardless)</span> : null}
          <Button type="button" variant="outline" size="sm" className={TB} onClick={() => set([])}><X />remove filter</Button>
        </div>
      )}
      {anyPicked ? (
        <div className="lp-banner flex-wrap" role="status">
          Selected:
          {drawn.filter((d) => picked(d.gene.gene).length).map((d) => (
            <SelectedCodons key={d.gene.gene} g={d.gene} selected={picked(d.gene.gene)} onSelect={(next) => pick(d.gene.gene, next)} />
          ))}
          <Button type="button" variant="outline" size="sm" className={TB} onClick={() => onCodons(undefined)}><X />clear selection</Button>
        </div>
      ) : (
        <p className="meta">Click a lollipop to select its codon; shift-click to select several. Click the plot elsewhere to clear.</p>
      )}
      {drawn.map((d, i) => (
        <div key={d.gene.gene} className="lp-gene">
          <GenePlot gene={d.gene} selected={picked(d.gene.gene)} onSelect={(next) => pick(d.gene.gene, next)} annotated={v.annotated !== false} yMax={yMax?.[d.gene.gene]} onYMax={(n) => { if (!onYMax) return; const all = { ...(yMax || {}) }; if (n == null) delete all[d.gene.gene]; else all[d.gene.gene] = n; onYMax(Object.keys(all).length ? all : undefined); }} />
          <div className="lp-side">
            <GeneSummary g={genes[i]} grch38={!!v.grch38} status={statusSelection(table && table.gene === genes[i].gene ? table.filters?.[STATUS_COLUMN] : undefined)}
              {...(onTable ? { onStatus: (sel: StatusSelection) => onTable(withStatusFilter(table, genes[i].gene, statusFilter(sel))) } : {})} />
            <AlterationGrid tally={genes[i].tally} classes={classes} hide={hide} onHide={set} annotated={v.annotated !== false} />
          </div>
        </div>
      ))}
      {v.note && <p className="note">{v.note}</p>}
    </div>
  );
}
