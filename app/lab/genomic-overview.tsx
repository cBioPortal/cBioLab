"use client";
// The Patient page's genomic overview, as cbioportal-frontend's patient view draws it
// (patientView/genomicOverview/GenomicOverview.tsx and shared/components/igv): igv.js with the
// patient's mutations (MUT) above their copy-number segments (CNA), 18 px a sample, and beside the
// tracks the sample's numbered marker, its mutation count / altered-genome share, and its gene panel.
// It opens compact — no navigation bar, ideogram, sequence or RefSeq track — and turns into the full
// browser when zoomed (double-click, a chromosome, or a row clicked in the alteration tables);
// "Reset view" goes back. The track menus' sort is off, as the portal turns it off.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SegmentsResult } from "../../lib/views/segments/types";
import {
  CNA_TRACK, MUT_TRACK, OVERVIEW_ROW, cnaAlteredPct, overviewMutFeatures, overviewSegFeatures, overviewTrackHeight, panelIcons, trackSamples, type PanelIcon,
} from "../../lib/views/segments/igv";
import { lollipopColor } from "../../lib/lollipop";
import { emitLocus, onLocus, patientKey } from "./locus-bus";
import { Button } from "../_ui/button";

type IgvModule = typeof import("igv").default;
type Browser = Awaited<ReturnType<IgvModule["createBrowser"]>>;
type Mode = "compact" | "advanced";
const WHOLE_GENOME = "all";
const RULER_COMPACT = 20;

const mutColor = (mtype: string) => lollipopColor([{ mtype, driver: true, rows: 1 }]).color;

/** GenomicOverview.tracks: MUT then CNA, each listing its samples in row order */
function overviewTracks(s: SegmentsResult) {
  const tracks: Record<string, unknown>[] = [];
  const mutSamples = trackSamples(s, "mut"), cnaSamples = trackSamples(s, "cna");
  if (mutSamples.length) tracks.push({
    name: MUT_TRACK, type: "mut", displayMode: "EXPANDED", expandedRowHeight: OVERVIEW_ROW,
    height: overviewTrackHeight(mutSamples.length), samples: mutSamples,
    color: (f: { color?: string }) => f.color, features: overviewMutFeatures(s, mutColor),
  });
  if (cnaSamples.length) tracks.push({
    name: CNA_TRACK, type: "seg", isLog: true, displayMode: "EXPANDED", expandedRowHeight: OVERVIEW_ROW,
    height: overviewTrackHeight(cnaSamples.length), samples: cnaSamples, features: overviewSegFeatures(s),
  });
  return { tracks, mutSamples, cnaSamples };
}

/** GenomicOverview.igvProps: the compact view hides the browser's chrome; the advanced one is the full browser */
function browserConfig(build: string, mode: Mode, locus: string, tracks: Record<string, unknown>[]) {
  const core = { genome: build, locus, tracks, showTrackLabels: false, showAllChromosomes: false, showGearColumn: false, showTrackDragHandles: false, showSampleNames: false };
  return mode === "compact"
    ? { ...core, showNavigation: false, showIdeogram: false, showCenterGuide: false, showCursorTrackingGuide: false }
    : { ...core, showNavigation: true, showIdeogram: true };
}

const Marker = ({ label, color }: { label: string; color: string }) => (
  <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill={color} /><text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{label}</text></svg>
);

const PanelBadge = ({ icon }: { icon: PanelIcon | undefined }) => icon
  ? <span className="rounded-[5px] px-[5px] py-px align-text-top text-[x-small]" style={{ background: (icon.color === "blue" ? "#0000ff" : icon.color) + "33" }}
    data-tip={icon.panel ? "Gene panel: " + icon.panel : "Gene panel information not found. Sample is presumed to be whole exome/genome sequenced."}>{icon.label}</span>
  : null;

export function GenomicOverview({ s }: { s: SegmentsResult }) {
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const browser = useRef<Browser | null>(null);
  const igvMod = useRef<IgvModule | null>(null);
  const locus = useRef<string>(WHOLE_GENOME);
  const [mode, setMode] = useState<Mode>("compact");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** where the MUT and CNA tracks' rows start, from the top of the row of columns */
  const [tops, setTops] = useState<{ mut?: number; cna?: number }>({});
  const key = s.samples[0] ? patientKey(s.samples[0].study, s.samples[0].patient) : "";
  const { tracks, mutSamples, cnaSamples } = useMemo(() => overviewTracks(s), [s]);
  const bySample = useMemo(() => new Map(s.samples.map((x) => [x.sample, x])), [s]);
  const mutCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of s.mutations || []) { const id = s.samples[m.s].sample; n.set(id, (n.get(id) || 0) + 1); }
    return n;
  }, [s]);
  const icons = useMemo(() => panelIcons(s.samples), [s]);

  const measure = useCallback(() => {
    const b = browser.current, r = row.current;
    if (!b || !r) return;
    const top0 = r.getBoundingClientRect().top;
    const at = (name: string) => {
      const t = b.findTracks((x: { name?: string }) => x.name === name)[0] as unknown as { trackView?: { viewports?: { viewportElement?: HTMLElement }[] } } | undefined;
      const el = t?.trackView?.viewports?.[0]?.viewportElement;
      return el ? el.getBoundingClientRect().top - top0 : undefined;
    };
    setTops({ mut: at(MUT_TRACK), cna: at(CNA_TRACK) });
  }, []);

  // one browser per mode (the portal re-creates IGV when its navigation bar comes or goes), at the locus it was at
  useEffect(() => {
    let gone = false;
    setReady(false);
    void (async () => {
      try {
        if (!igvMod.current) igvMod.current = (await import("igv/dist/igv.esm.js")).default;
        if (gone || !box.current) return;
        const igv = igvMod.current;
        if (browser.current) { igv.removeBrowser(browser.current); browser.current = null; }
        const b = await igv.createBrowser(box.current, browserConfig(s.build, mode, locus.current, tracks) as never);
        if (gone) { igv.removeBrowser(b); return; }
        browser.current = b;
        const any = b as unknown as { findTracks: (f: (t: { type?: string; config?: { type?: string } }) => boolean) => ({ contextMenuItemList?: unknown })[]; removeTrack: (t: unknown) => void };
        // compact: no RefSeq genes and no sequence (showSequenceTrack: false, reference.tracks: [])
        if (mode === "compact") for (const t of any.findTracks((t) => t.type === "annotation" || t.config?.type === "sequence" || t.type === "sequence")) any.removeTrack(t);
        // compactRulerTrack: the ruler at half its height (RULER_TRACK_FULL_HEIGHT / 2)
        // and its drawing shifted up a quarter of its full height, so the chromosome names stay in view (updateChromosomeTrack)
        if (mode === "compact") {
          for (const t of any.findTracks((t) => (t as { id?: string }).id === "ruler"))
            (t as { trackView?: { setTrackHeight?: (h: number, force?: boolean) => void } }).trackView?.setTrackHeight?.(RULER_COMPACT, true);
          const root = box.current.shadowRoot;
          if (root) { const st = document.createElement("style"); st.textContent = '.igv-viewport[data-track-type="ruler"] canvas { margin-top: -' + RULER_COMPACT / 2 + "px; }"; root.appendChild(st); }
        }
        // disableContextMenuSort
        for (const t of any.findTracks((t) => t.type === "seg" || t.type === "mut")) t.contextMenuItemList = undefined;
        b.on("locuschange", (frames: { getLocusString: () => string; chr: string }[]) => {
          locus.current = frames.map((f) => f.chr.toLowerCase() === WHOLE_GENOME ? WHOLE_GENOME : f.getLocusString()).join(" ");
          // handleLocusChange: anything but the whole genome is the advanced view
          if (locus.current !== WHOLE_GENOME) setMode("advanced");
          requestAnimationFrame(measure);
        });
        setReady(true); setFailed(null);
        requestAnimationFrame(measure);
      } catch (e) {
        if (!gone) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { gone = true; };
  }, [s, mode, tracks, measure]);

  useEffect(() => () => {
    if (browser.current && igvMod.current) igvMod.current.removeBrowser(browser.current);
    browser.current = null;
  }, []);

  useLayoutEffect(() => {
    const r = row.current;
    if (!r) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(r);
    return () => ro.disconnect();
  }, [measure]);

  // a row clicked in the patient's alteration tables zooms to its gene
  useEffect(() => key ? onLocus(key, (e) => {
    if (e.kind !== "gene") return;
    locus.current = e.gene;
    if (mode === "advanced" && browser.current) void browser.current.search(e.gene);
    else setMode("advanced");
  }) : undefined, [key, mode]);

  const reset = () => {
    locus.current = WHOLE_GENOME;
    if (mode === "compact" && browser.current) void browser.current.search(WHOLE_GENOME);
    setMode("compact");
    if (key) emitLocus(key, { kind: "reset" });
  };

  /** one column's cells beside a track: a sample per OVERVIEW_ROW, from the track's top */
  const column = (top: number | undefined, samples: string[], cell: (id: string) => React.ReactNode) => top == null ? null :
    samples.map((id, i) => <div key={id} className="absolute inset-x-0 flex items-center justify-center" style={{ top: top + i * OVERVIEW_ROW, height: OVERVIEW_ROW }}>{cell(id)}</div>);

  return (
    <div className="segigv" aria-busy={!ready && !failed}>
      <div className="viewtb">
        <span className="note">Click alteration for detail. Double-click to zoom.</span>
        {mode === "advanced" && <Button type="button" variant="outline" size="sm" onClick={reset} data-tip="back to the whole genome, compact">Reset view</Button>}
      </div>
      {!ready && !failed && <p className="note">loading the genome browser…</p>}
      {failed && <p className="note">The genome browser failed to load: {failed}</p>}
      <div ref={row} className="relative flex">
        <div className="relative w-5 shrink-0">
          {[...column(tops.mut, mutSamples, (id) => { const m = bySample.get(id)?.mark; return m ? <span data-tip={id}><Marker {...m} /></span> : null; }) || [],
            ...column(tops.cna, cnaSamples, (id) => { const m = bySample.get(id)?.mark; return m ? <span data-tip={id}><Marker {...m} /></span> : null; }) || []]
            .map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}
        </div>
        <div ref={box} className="min-w-0 flex-1" data-testid="segments-igv" />
        <div className="relative w-12 shrink-0 [&>div]:justify-end">
          {[...column(tops.mut, mutSamples, (id) => <span className="text-sm font-bold" data-tip="Number of mutation events.">{mutCount.get(id) || 0}</span>) || [],
            ...column(tops.cna, cnaSamples, (id) => {
              const pct = cnaAlteredPct(bySample.get(id)?.segs || []);
              return <span className="text-sm font-bold" data-tip={pct == null ? "Copy number segment data not available"
                : "Percentage of copy number altered chromosome regions (mean copy number log value >0.2 or <-0.2) out of measured regions."}>{pct == null ? "N/A" : pct.toFixed(1) + "%"}</span>;
            }) || []].map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}
        </div>
        {icons.show && <div className="relative w-10 shrink-0">
          {[...column(tops.mut, mutSamples, (id) => <PanelBadge icon={icons.mut.get(id)} />) || [],
            ...column(tops.cna, cnaSamples, (id) => <PanelBadge icon={icons.cna.get(id)} />) || []].map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}
        </div>}
      </div>
    </div>
  );
}
