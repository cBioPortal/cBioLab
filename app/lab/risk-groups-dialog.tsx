"use client";
// The risk model's groups: equal quantiles of the held-out score (`groups`), or cuts at chosen
// quantiles (`cuts`), set in a dialog over the score's histogram. Each cut is a handle on one
// slider laid exactly over the histogram's axis, snapping to whole percentiles; the groups'
// shares are previewed as the handles move (a cut is a quantile, so a group's share is the
// distance between its cuts — nothing is asked of the server), and nothing reaches the document
// until Apply. The dialog owns its draft, so dragging re-renders it alone, not the page.
import { useLayoutEffect, useMemo, useState } from "react";

import { riskHistogramFigure, riskGroupNames, riskScaled, cutLandsAt } from "../../lib/views/riskmodel/figure.ts";
import { fmtInt } from "../../lib/svg-kit.ts";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { RemoveBadge } from "../_ui/remove-badge";
import { Slider } from "../_ui/slider";
import { TB, FIELD } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { SvgAtWidth } from "./figure.tsx";
import type { RiskmodelResult } from "../../lib/views/riskmodel/types.ts";

/** what the view's groups are: n equal quantiles, or cuts at whole percentiles */
type Groups = { groups: number } | { cuts: number[] };
/** cuts at most 4 (5 groups, the engine's limit), and at least this many percentiles apart, so no group is empty */
const MAX_CUTS = 4, MIN_GAP = 5;
/** a preset that matches the draft reads as pressed (a toggle in a toolbar: TB at the control height) */
const PRESSED = "aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground";
/** the slider thumb's width (app/_ui/slider.tsx, size-4) */
const THUMB = 16;

const PRESETS: { label: string; g: Groups }[] = [
  { label: "Median", g: { groups: 2 } }, { label: "Tertiles", g: { groups: 3 } }, { label: "Quartiles", g: { groups: 4 } },
  { label: "Top 20%", g: { cuts: [80] } }, { label: "Top 10%", g: { cuts: [90] } },
];

/** equal-quantile groups by their usual names (the presets' words) */
const EQUAL_NAMES: Record<number, string> = { 2: "halves (median)", 3: "tertiles", 4: "quartiles", 5: "quintiles" };

/** the view's groups as the dialog holds them: cuts as whole percentiles */
export function groupsOf(spec: { groups?: number; cuts?: number[] }): Groups {
  return spec.cuts ? { cuts: spec.cuts.map((c) => Math.round(c * 100)) } : { groups: spec.groups ?? 3 };
}
/** where the handles are: the cuts, or the equal quantiles' percentiles */
const percentsOf = (g: Groups) => "cuts" in g ? g.cuts : Array.from({ length: g.groups - 1 }, (_, k) => Math.round((k + 1) * 100 / g.groups));
const same = (a: Groups, b: Groups) => JSON.stringify(a) === JSON.stringify(b);

/** The toolbar's button: what the groups are now, opening the dialog. */
export function RiskGroupsButton({ spec, m, busy, onApply }: {
  spec: { groups?: number; cuts?: number[] }; m: RiskmodelResult | undefined; busy: boolean;
  onApply: (patch: { groups?: number; cuts?: number[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const g = groupsOf(spec);
  // the button is the way in; what the groups are now is drawn in the figure and said in its title
  const now = "cuts" in g ? "cut at the " + g.cuts.join(", ") + "th percentile" + (g.cuts.length > 1 ? "s" : "") + " of the risk score"
    : (EQUAL_NAMES[g.groups] ?? g.groups + " equal groups") + ": equal shares of patients by risk score, tied scores kept together";
  return <>
    <Button variant="outline" size="sm" className={TB + " riskgroupsbtn"} disabled={busy || !m}
      title={!m ? "waiting for the model: the groups are cut from its scores" : now + " — click to change"} onClick={() => setOpen(true)}>
      groups
    </Button>
    {open && m && <RiskGroupsDialog m={m} initial={g} onClose={() => setOpen(false)}
      onApply={(next) => { onApply("cuts" in next ? { cuts: next.cuts.map((c) => c / 100), groups: undefined } : { groups: next.groups === 3 ? undefined : next.groups, cuts: undefined }); setOpen(false); }} />}
  </>;
}

/**
 * An element's width, followed as it changes — through a callback ref, because a dialog's content
 * mounts a render after the dialog (Radix portals it), after a plain ref's effect has already run.
 */
function usePortalWidth(min: number) {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(Math.max(min, Math.floor(el.clientWidth / 8) * 8));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return { ref, width };
}

/** One cut's percentile, typed: its own draft, committed on Enter or leaving the field, so a value is never judged half-typed. */
function CutField({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => boolean }) {
  const [text, setText] = useState(String(value));
  const [was, setWas] = useState(value);
  if (was !== value) { setWas(value); setText(String(value)); }
  // a value the dialog refuses (it says why) leaves the cut where it was, and the field shows it
  const commit = () => { const v = Number(text); if (!text.trim() || v === value || !onCommit(v)) setText(String(value)); };
  return <Input type="number" min={1} max={99} aria-label={label} className={FIELD + " w-16"} value={text}
    onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />;
}

function RiskGroupsDialog({ m, initial, onApply, onClose }: { m: RiskmodelResult; initial: Groups; onApply: (g: Groups) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Groups>(initial);
  const [note, setNote] = useState("");
  const { ref, width } = usePortalWidth(320);
  const pcts = percentsOf(draft);
  const scoreAt = (p: number) => m.percentiles[Math.max(0, Math.min(100, p))];
  const fig = useMemo(() => width == null ? null : riskHistogramFigure(m, width, pcts.map(scoreAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the drawing's inputs are the result, the width and the cuts
    [m, width, pcts.join(",")]);
  // a handle's value is its 0–10 score ×100, so the track is the histogram's axis; it snaps to the nearest whole percentile
  const handleValue = (p: number) => Math.round(riskScaled(m, scoreAt(p)) * 100);
  // a moved handle's percentile: the one whose score is nearest where it was moved to, and of those
  // (tied scores share one) the nearest its last; at least one step in the direction it moved, so an
  // arrow key always gets somewhere even where a step of the score stays inside one percentile
  const movedTo = (from: number, v: number) => {
    let best = from;
    for (let p = 1; p <= 99; p++) {
      const d = Math.abs(handleValue(p) - v), db = Math.abs(handleValue(best) - v);
      if (d < db || (d === db && Math.abs(p - from) < Math.abs(best - from))) best = p;
    }
    const dir = Math.sign(v - handleValue(from));
    return best === from && dir ? Math.max(1, Math.min(99, from + dir)) : best;
  };
  const setCuts = (next: number[]): boolean => {
    const sorted = [...next].sort((a, b) => a - b);
    const bad = sorted.some((c, k) => c < 1 || c > 99 || !Number.isInteger(c) || (k > 0 && c - sorted[k - 1] < MIN_GAP));
    if (bad) { setNote("cuts are whole percentiles from 1 to 99, at least " + MIN_GAP + " apart, so no group is empty"); return false; }
    setNote("");
    setDraft({ cuts: sorted });
    return true;
  };
  // a cut added in the middle of the widest group, so it always lands where it splits something
  const edges = [0, ...pcts, 100];
  const widest = edges.slice(1).map((e, k) => [e - edges[k], k] as const).sort((a, b) => b[0] - a[0])[0];
  const canAdd = pcts.length < MAX_CUTS && widest[0] >= 2 * MIN_GAP;
  const scored = m.histogram.counts.reduce((a, b) => a + b, 0);
  // the groups as the model will make them: each cut where tied scores move it, and cuts that land together merged
  const lands = pcts.map((p) => cutLandsAt(m.percentiles, p));
  const landed = [...new Set(lands)].filter((x) => x > 0 && x < 100).sort((a, b) => a - b);
  const groupEdges = [0, ...landed, 100];
  const names = riskGroupNames(landed.length + 1);
  const domain = fig?.domain ?? [0, 10];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-tw className="riskgroupsdialog gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Risk groups</DialogTitle>
          <DialogDescription className="text-sm">
            Cut the held-out risk score into groups: equal shares, or at the percentiles you choose. Drag a cut, type its percentile, or add one.
          </DialogDescription>
        </DialogHeader>
        <div className="viewtb">
          <div className="tbz"><span className="tbl">presets</span>
            {PRESETS.map((x) => <Button key={x.label} type="button" variant="outline" size="sm" className={cn(TB, PRESSED)} aria-pressed={same(draft, x.g)}
              onClick={() => { setNote(""); setDraft(x.g); }}>{x.label}</Button>)}
          </div>
        </div>
        <div ref={ref} className="relative">
          {fig && <SvgAtWidth svg={fig.svg} className="riskgroupsfig" />}
          {/* the handles sit on the histogram's axis line, centred on it. Radix keeps a thumb's centre half a
              thumb inside each end of the track, so the track runs half a thumb past the plot on both sides */}
          {fig && <div className="absolute" style={{ left: fig.plotL - THUMB / 2, width: fig.plotR - fig.plotL + THUMB, top: fig.axisY - THUMB / 2 }}>
            <Slider aria-label="cut" className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-transparent" min={Math.round(domain[0] * 100)} max={Math.round(domain[1] * 100)} step={1}
              value={pcts.map(handleValue)} onValueChange={(vs) => setCuts(vs.map((v, k) => v === handleValue(pcts[k]) ? pcts[k] : movedTo(pcts[k], v)))} />
          </div>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-live="polite">
          {names.map((n, k) => {
            const share = groupEdges[k + 1] - groupEdges[k];
            return <span key={k}><b className="font-semibold">{n}</b> {share}%{m.validation ? "" : " (≈" + fmtInt(Math.round(share / 100 * scored)) + ")"}</span>;
          })}
        </div>
        <div className="viewtb">
          <div className="tbz"><span className="tbl">cuts</span>
            {pcts.map((p, k) => <span key={k} className="flex items-center gap-1">
              <CutField value={p} label={"cut " + (k + 1) + ", percentile"} onCommit={(v) => setCuts(pcts.map((q, j) => j === k ? v : q))} />
              <span className="text-sm text-muted-foreground">% · {riskScaled(m, scoreAt(p)).toFixed(1)}
                {lands[k] !== p && <> · <span className="text-foreground" title="this many patients share one score here, and patients with the same score stay in one group">falls at {lands[k]}%: tied scores</span></>}</span>
              <RemoveBadge label={"the cut at " + p + "%"} className="px-1" disabled={pcts.length === 1}
                title={pcts.length === 1 ? "two groups need one cut" : "remove this cut"} onClick={() => setCuts(pcts.filter((_, j) => j !== k))}>{""}</RemoveBadge>
            </span>)}
            <Button type="button" variant="outline" size="sm" className={TB} disabled={!canAdd}
              title={pcts.length >= MAX_CUTS ? "at most " + MAX_CUTS + " cuts (5 groups)" : !canAdd ? "no group is wide enough to split" : "add a cut in the middle of the widest group"}
              onClick={() => setCuts([...pcts, Math.round((edges[widest[1]] + edges[widest[1] + 1]) / 2)])}>+ add cut</Button>
          </div>
        </div>
        {note && <p className="text-sm text-destructive" role="alert">{note}</p>}
        {landed.length < pcts.length && <p className="text-sm">{pcts.length - landed.length === 1 ? "Two cuts land" : "Cuts land"} at the same place among tied scores, so the model makes {landed.length + 1} groups, not {pcts.length + 1}.</p>}
        <p className="text-sm text-muted-foreground">
          Shares are of the held-out scores{m.validation ? " of the discovery half, whose quantiles cut the validation half" : ""}, to about a percentile; patients with the
          same score stay in one group, so a cut among tied scores moves to their edge, as shown. Cuts placed while looking at the survival curves overstate how well they separate — confirm one with “validate on held-out half”.
        </p>
        <DialogFooter className="items-center">
          <Button type="button" variant="ghost" className="mr-auto" onClick={() => { setNote(""); setDraft({ groups: 3 }); }}>Reset to tertiles</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" className="riskgroupsapply" disabled={same(draft, initial)} onClick={() => onApply(draft)}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
