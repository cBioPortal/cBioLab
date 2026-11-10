"use client";
// The lollipop as the app shows it: each gene's plot, with the portal's gene summary beside it
// (transcript ids, somatic mutation frequency) and the Driver/VUS × alteration class grid as a
// control. The grid's selection — the cells hidden — is the view's `hide`, applied here from the
// whole result (lib/lollipop.ts filterHotspotGene), so a click redraws at once and re-runs nothing.
// The figure itself (lib/view-svg.ts) is the plot alone; a figure that travels without the app
// carries the summary and the selection in its caption instead.
import React, { useMemo, useRef, useState } from "react";
import type { ViewResultOf } from "../../lib/types.ts";
import { filterHotspotGene, clickCodon, type CodonSelection } from "../../lib/lollipop.ts";
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

/** The transcript and its ids, and the somatic mutation frequency — the portal's GeneSummary. */
function GeneSummary({ g }: { g: HotspotGene }) {
  const freq = g.cohortSamples ? fmtShare(g.somaticSamples / g.cohortSamples) : "–";
  return (
    <>
      <TranscriptSummary ids={g.ids} gene={g.gene} />
      <div className="lp-summary">
        <div className="lp-freq" data-tip={g.somaticSamples.toLocaleString() + " of " + g.cohortSamples.toLocaleString() + " samples carry a somatic mutation in " + g.gene}>
          <span>Somatic Mutation Frequency</span> <b>{freq}</b>
        </div>
      </div>
    </>
  );
}

/** One gene's plot: the renderer's figure, its stems clickable (use-stem-clicks.ts). */
function GenePlot({ gene, selected, onSelect }: { gene: HotspotGene; selected: number[]; onSelect: (next: number[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [legend, setLegend] = useState(false);
  useStemClicks(box, {
    pick: (codon, multi) => onSelect(clickCodon(selected, codon, multi)),
    clear: () => { if (selected.length) onSelect([]); },
  });
  return (
    <div className="lp-plot flex-[1_1_560px]">
      <div className="flex justify-end">
        <LollipopTools legend={legend} onLegend={setLegend} filename={gene.gene + "_mutation_diagram"}
          svg={() => { const w = box.current?.getBoundingClientRect().width; return w ? lollipopPanelsSvg([gene], { width: Math.round(w), theme: "light" }, "", { [gene.gene]: selected }) : null; }} />
      </div>
      {legend && <ColorLegend />}
      <div ref={box}>
        <DrawAtWidth draw={(width) => lollipopPanelsSvg([gene], { width }, "", { [gene.gene]: selected })} deps={[gene, selected.join(",")]} />
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

export function HotspotsBody({ v, hide: hideList, onHide, codons, onCodons }: { v: ViewResultOf<"hotspots">; hide?: string[]; onHide: (next: string[] | undefined) => void;
  /** the stems selected on each gene's plot, and where a click writes the next selection */
  codons?: CodonSelection; onCodons: (next: CodonSelection | undefined) => void }) {
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
          <GenePlot gene={d.gene} selected={picked(d.gene.gene)} onSelect={(next) => pick(d.gene.gene, next)} />
          <div className="lp-side">
            <GeneSummary g={genes[i]} />
            <AlterationGrid tally={genes[i].tally} classes={classes} hide={hide} onHide={set} />
          </div>
        </div>
      ))}
      {v.note && <p className="note">{v.note}</p>}
    </div>
  );
}
