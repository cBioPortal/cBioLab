"use client";
// Cards for the view kinds in lib/views-more.ts. The page draws every one of them the same way —
// ViewHead, then this kind's controls, then the server-rendered figure — so all that differs
// per kind lives here: its title, whether it takes a gene list, and its own settings.
import React from "react";

export interface MoreKindUi {
  label: string;
  /** the card's title */
  title: string;
  /** a gene list edited through the page's shared gene dialog */
  genes?: boolean;
  /** the most cohorts this view can draw at once */
  maxCohorts?: number;
}

export const MORE_KINDS: Record<string, MoreKindUi> = {
  attrition: { label: "Cohort attrition (CONSORT)", title: "Cohort attrition", maxCohorts: 6 },
  genome: { label: "Genome-wide copy number", title: "Genome-wide copy number", maxCohorts: 4 },
  pathways: { label: "Oncogenic pathways", title: "Oncogenic signalling pathways", maxCohorts: 4 }
};

export const isMoreKind = (k: unknown): boolean => Object.prototype.hasOwnProperty.call(MORE_KINDS, String(k));

/** What a card needs from the page: the view as written, its result, and a way to edit it. */
export interface MoreCtx {
  vi: number;
  /** the view as the DOCUMENT holds it (never the result, which has different fields) */
  spec: any;
  /** the view's result */
  v: any;
  busy: boolean;
  patch: (p: Record<string, unknown>) => void;
  attrs: { attribute: string; kind: string }[];
  profiles: string[];
  events: { canonical: string; label: string; n: number }[];
}

/** A one-line subtitle for the card header. */
export function moreSub(kind: string, spec: any, v: any): React.ReactNode {
  if (kind === "attrition") return "patients left after each clause, in order";
  if (kind === "pathways") return (spec.measure === "any" ? "any alteration" : "OncoKB drivers") + ", Sanchez-Vega et al. 2018";
  if (kind === "genome") return v.genome ? v.genome.build + ", " + v.genome.binMb + " Mb bins, from segments" : "from copy-number segments";
  void spec; void v;
  return null;
}

/** This kind's settings row, or nothing when it has none. */
export function MoreControls({ c }: { c: MoreCtx }) {
  const { spec, busy, patch } = c;
  if (spec.kind === "genome") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="bin width along the genome; a bin takes the value of the segment over its midpoint, so a narrower bin catches a narrower event">
          bins <select value={String(spec.binMb ?? 2)} disabled={busy} onChange={(e) => patch({ binMb: Number(e.target.value) })}>
            {[1, 2, 5, 10, 20].map((b) => <option key={b} value={b}>{b} Mb</option>)}
          </select>
        </label>
        <label className="tbfield" title="the |log2 segment mean| at or past which a bin counts as gained or lost">
          threshold <select value={String(spec.threshold ?? 0.2)} disabled={busy} onChange={(e) => patch({ threshold: Number(e.target.value) })}>
            {[0.1, 0.2, 0.3, 0.5, 1].map((t) => <option key={t} value={t}>±{t}</option>)}
          </select>
        </label>
        <label className="chk" title="chromosome X's log ratio mostly records sex against the reference, so it is off by default">
          <input type="checkbox" checked={spec.includeX === true} disabled={busy} onChange={(e) => patch({ includeX: e.target.checked || undefined })} /> chrX
        </label>
      </div>
    </div>
  );
  if (spec.kind === "pathways") return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="count only OncoKB-annotated drivers (as the paper counted curated oncogenic events), or every alteration">
          count <select value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onChange={(e) => patch({ measure: e.target.value === "any" ? "any" : undefined })}>
            <option value="driver">drivers</option><option value="any">any alteration</option>
          </select>
        </label>
        <label className="tbfield" title="how many of each pathway's most-altered genes to draw; the rest are pooled and counted, never dropped">
          genes shown <select value={String(spec.topGenes ?? 6)} disabled={busy} onChange={(e) => patch({ topGenes: Number(e.target.value) })}>
            {[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
  return null;
}

/** The view a fresh "add view" click starts from, built from what the study is known to have. */
export function defaultMoreView(kind: string, known: {
  genes: string[]; attrs: { attribute: string; kind: string }[]; profiles: string[];
  events: { canonical: string; label: string; n: number }[]; cohorts: string[];
}): Record<string, unknown> {
  void known;
  return { kind };
}
