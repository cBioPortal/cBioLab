"use client";
// The segments view's card body: the result's segments as an igv.js seg track, as cBioPortal's CN
// Segments tab draws them — drag to pan, zoom, search a gene or locus, click a track to sort by
// value. The result holds each drawn sample's whole-genome segments; the view's gene or region is
// only where IGV starts.
import React, { useEffect, useRef, useState } from "react";
import type { SegmentsResult } from "../../lib/views/segments/types";
import { igvLocus, igvSegFeatures } from "../../lib/views/segments/igv";

type IgvModule = typeof import("igv").default;
type Browser = Awaited<ReturnType<IgvModule["createBrowser"]>>;

/** at most this many samples are drawn a row each; past it the track fills a fixed height */
const EXPANDED_MAX = 40;
const FILL_HEIGHT = 600;
/** a few samples (one patient's) get rows tall enough to read their names against */
const FEW = 10, FEW_ROW = 24, ROW = 13;
const TRACK_NAME = "Copy-number segments";

const rowsOf = (s: SegmentsResult) => s.samples.filter((x) => x.segs.length).length;

function segTrack(s: SegmentsResult) {
  const n = rowsOf(s), row = n <= FEW ? FEW_ROW : ROW;
  return {
    type: "seg" as const, format: "seg" as const, name: TRACK_NAME, isLog: true,
    ...(n <= EXPANDED_MAX
      ? { displayMode: "EXPANDED" as const, expandedRowHeight: row, height: n * row, maxHeight: n * row }
      : { displayMode: "FILL" as const, height: FILL_HEIGHT }),
    features: igvSegFeatures(s),
  };
}

export function SegmentsIgv({ s }: { s: SegmentsResult }) {
  const box = useRef<HTMLDivElement>(null);
  const browser = useRef<Browser | null>(null);
  const igvMod = useRef<IgvModule | null>(null);
  const built = useRef<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // one browser per genome build; a new result swaps the track and moves to its locus
  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        if (!igvMod.current) igvMod.current = (await import("igv/dist/igv.esm.js")).default;
        if (gone || !box.current) return;
        const igv = igvMod.current;
        if (!browser.current || built.current !== s.build) {
          if (browser.current) igv.removeBrowser(browser.current);
          browser.current = null; setReady(false);
          const b = await igv.createBrowser(box.current, { genome: s.build, locus: igvLocus(s), showSampleNames: rowsOf(s) <= EXPANDED_MAX, tracks: [segTrack(s)] } as never);
          if (gone) { igv.removeBrowser(b); return; }
          browser.current = b; built.current = s.build;
        } else {
          const b = browser.current;
          b.removeTrackByName(TRACK_NAME);
          await b.loadTrack(segTrack(s) as never);
          b.search(igvLocus(s));
        }
        if (!gone) { setReady(true); setFailed(null); }
      } catch (e) {
        if (!gone) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { gone = true; };
  }, [s]);

  useEffect(() => () => {
    if (browser.current && igvMod.current) igvMod.current.removeBrowser(browser.current);
    browser.current = null; built.current = null;
  }, []);

  return (
    <div className="segigv" aria-busy={!ready && !failed}>
      {!ready && !failed && <p className="note">loading the genome browser…</p>}
      {failed && <p className="note">The genome browser failed to load: {failed}</p>}
      <div ref={box} data-testid="segments-igv" />
    </div>
  );
}
