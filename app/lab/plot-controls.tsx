"use client";
// The plot view laid out as cBioPortal's Plots tab is, shared by the lab's plot card and the portal
// pages' Plots tab: each axis defined in its own block in a sidebar (horizontal above vertical, a swap
// between them, the unit and the point layers below), and beside it a line saying how many cases are shown,
// a box plot's colour and ring, and the figure. Under a narrow card the sidebar sits above the figure.
// Every control is an edit to the view, handed to `update`.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { AxisPicker } from "./view-chrome.tsx";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Choice, OptionSelect } from "../_ui/choice.tsx";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { CHIP, FIELD } from "../_ui/toolbar.ts";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";
import { DEFAULT_POINT_LAYERS, POINTS_CAP, LAYER_BASE, LAYER_COLORS, POINT_LAYER_CAP, POINT_RULE_N, POINT_RULE_N_MAX, layerLabel, type PointLayerSpec } from "../../lib/plot-layers.ts";

type Update = (fn: (view: any) => any) => void;
/** one half of a two-way switch, the chosen half filled */
const SEG = "h-ctl flex-1 rounded-none px-2 text-md font-normal first:rounded-l-md last:rounded-r-md [&+&]:-ml-px " +
  "aria-pressed:border-link aria-pressed:bg-link aria-pressed:text-card aria-pressed:hover:bg-link/90 aria-pressed:hover:text-card";
/** the points cap as the controls print it */
const CAP = POINTS_CAP.toLocaleString("en-US");

function LogToggle({ spec, side, numeric, busy, update }: { spec: any; side: "x" | "y"; numeric: boolean; busy: boolean; update: Update }) {
  const axis = spec[side];
  if (!numeric || !axis || !("source" in axis) || (axis.source !== "clinical" && axis.source !== "molecular" && axis.source !== "assay" && axis.source !== "profile")) return null;
  return (
    <label className="chk text-md text-foreground" data-tip="draw this axis on a log scale — log10(value + 1), so zero stays on the axis and a negative value is left out">
      <Checkbox checked={!!axis.log} disabled={busy}
        onCheckedChange={(c) => update((vv) => {
          const a = { ...vv[side] };
          if (c === true) a.log = true; else delete a.log;
          return { ...vv, [side]: a };
        })} />
      Log scale
    </label>
  );
}

/** one axis's definition in the sidebar: its name down the side, its fields stacked beside it */
function AxisBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="plot-axis flex gap-1.5 rounded-md bg-muted py-2.5 pr-2.5 pl-1" aria-label={title}>
      <h3 className="m-0 rotate-180 text-center text-md font-normal text-primary [writing-mode:vertical-lr]">{title}</h3>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">{children}</div>
    </section>
  );
}

/** a ranked layer's count, typed in its chip and handed on when the field is left or Enter pressed */
function LayerCount({ n, all, busy, onCommit }: { n?: number; all?: string; busy: boolean; onCommit: (n: number | undefined) => void }) {
  const [draft, setDraft] = useState(n == null ? "" : String(n));
  useEffect(() => setDraft(n == null ? "" : String(n)), [n]);
  const commit = () => {
    // an empty field is "all" where the layer has one
    if (!draft && all) { if (n != null) onCommit(undefined); return; }
    const v = Math.round(Number(draft));
    if (draft && Number.isFinite(v) && v >= 1 && v <= POINT_RULE_N_MAX && v !== n) onCommit(v); else setDraft(n == null ? "" : String(n));
  };
  return <Input className={cn(FIELD, "h-6 w-12 px-1 text-sm")} value={draft} disabled={busy} inputMode="numeric" placeholder={all ? "all" : undefined}
    aria-label="how many cases" data-tip={"how many cases (1–" + POINT_RULE_N_MAX + ")" + (all ? "; empty for " + all : "")}
    onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

/**
 * The view's point layers: subsets of the plotted cohort drawn in colour over it, one chip per
 * layer in the figure's colour for it, in order (the first layer draws a case two layers share),
 * and a menu offering the rules and cohorts not yet chosen, up to the cap.
 */
function PointLayers({ layers, plot, cohortOptions, axisName, busy, onChange }: {
  layers: PointLayerSpec[];
  plot?: { shape: string; x: { kind: string }; y: { kind: string }; layers?: { shown: string; why?: string; n: number; of?: number }[] };
  cohortOptions: { name: string; label: string; depth: number }[];
  axisName: (side: "x" | "y") => string;
  busy: boolean;
  onChange: (next: PointLayerSpec[]) => void;
}) {
  const has = (f: (l: PointLayerSpec) => boolean) => layers.some(f);
  const offers: [string, string, PointLayerSpec][] = [];
  if (!has((l) => "rule" in l && l.rule === "outliers")) offers.push(["outliers", "outliers (past " + CAP + " cases)", { rule: "outliers" }]);
  for (const side of ["x", "y"] as const)
    if (plot?.[side].kind === "num" && !has((l) => "rule" in l && l.rule === "extremes" && l.axis === side))
      offers.push(["extremes:" + side, "top and bottom " + POINT_RULE_N + " by " + axisName(side), { rule: "extremes", axis: side }]);
  if (plot?.shape === "scatter" && !has((l) => "rule" in l && l.rule === "trend"))
    offers.push(["trend", POINT_RULE_N + " furthest from the fit", { rule: "trend" }]);
  for (const o of cohortOptions)
    if (!has((l) => "cohort" in l && l.cohort === o.name)) offers.push(["cohort:" + o.name, "\u00a0".repeat(o.depth * 2) + o.label, { cohort: o.name }]);
  const full = layers.length >= POINT_LAYER_CAP;
  const move = (i: number) => { const next = [...layers]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next); };
  return (
    <div className="plot-layers flex flex-col gap-1">
      {layers.map((l, i) => {
        // the result's layers come back in the view's order; under its chip, why one drew nothing or how much of it was drawn
        const res = plot?.layers?.[i];
        const layerNote = res?.shown === "none" ? "Not drawn: " + (res.why || "nothing to draw") + "."
          : res?.of ? "The " + res.n.toLocaleString() + " most extreme of " + res.of.toLocaleString() + "." : null;
        return <div key={i} className="flex flex-col gap-0.5">
        <div className="plot-layer flex min-h-ctl items-center gap-1 rounded-sm border bg-card py-0.5 pr-0.5 pl-1.5 text-sm"
          data-tip={i ? "drawn under the layers above it: a case they share is theirs" : "drawn first: a case it shares with a later layer is its own"}>
          <span className="size-2.5 flex-none rounded-full" style={{ background: LAYER_COLORS[i] }} />
          <span className="min-w-0 flex-1 truncate" data-tip={"cohort" in l ? l.cohort : layerLabel(l, axisName)}>{"cohort" in l ? l.cohort : layerLabel(l, axisName)}</span>
          {"rule" in l && (l.rule !== "outliers" || plot?.shape === "box") && (
            <LayerCount n={l.rule === "outliers" ? l.n : l.n ?? POINT_RULE_N} busy={busy}
              all={l.rule === "outliers" ? "as many as the figure draws, shared between the groups" : undefined}
              onCommit={(n) => onChange(layers.map((x, j) => j !== i ? x : n == null ? { rule: "outliers" } : { ...x, n } as PointLayerSpec))} />
          )}
          {i > 0 && <Button type="button" variant="ghost" size="icon-xs" className="size-5 text-muted-foreground" disabled={busy}
            aria-label="draw this layer before the one above it" data-tip="draw this layer before the one above it" onClick={() => move(i)}><ArrowUp /></Button>}
          <Button type="button" variant="ghost" size="icon-xs" className="size-5 text-muted-foreground" disabled={busy}
            aria-label={"remove the layer " + ("cohort" in l ? l.cohort : layerLabel(l, axisName))} data-tip="remove this layer"
            onClick={() => onChange(layers.filter((_, j) => j !== i))}><X /></Button>
        </div>
        {layerNote && <p className="plot-layer-why m-0 pl-1.5 text-sm text-muted-foreground">{layerNote}</p>}
        </div>;
      })}
      {!layers.length && <p className="m-0 text-sm text-muted-foreground">none: the plotted cohort alone</p>}
      <OptionSelect className="w-full max-w-none" value="" disabled={busy || full || !offers.length} ariaLabel="add a point layer"
        title={full ? "a plot draws at most " + POINT_LAYER_CAP + " point layers; remove one to add another"
          : !offers.length ? "every rule and cohort this plot can draw is already a layer" : "add a subset to draw in its own colour"}
        onValueChange={(v) => { const o = offers.find((x) => x[0] === v); if (o) onChange([...layers, o[2]]); }}>
        <option value="">+ add a layer</option>
        {offers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </OptionSelect>
    </div>
  );
}

export function PlotControls({ spec, plot, attrs, catalog, loading, busy, cohortOptions, update, children }: {
  /** the view as the document holds it */
  spec: any;
  /** the last result's plot: which shape is on screen, each axis's name and kind, how many cases it shows, its layers */
  plot?: { shape: string; n: number; x: { kind: string; label: string }; y: { kind: string; label: string }; coverage?: { total: number };
    layers?: { label: string; color: string; n: number; shown: string; why?: string; of?: number }[]; pointSet?: { rule: string; why?: string } };
  attrs: { attribute: string; kind: string }[];
  /** the studies' profiles as they describe them, for each axis's Data picker */
  catalog: ProfileInfo[]; loading?: boolean; busy: boolean;
  /** the cohorts a point layer may be: every one but the plotted one and a split */
  cohortOptions: { name: string; label: string; depth: number }[];
  update: Update;
  /** the figure, and whatever the page covers it with while it waits */
  children: React.ReactNode;
}) {
  const layers: PointLayerSpec[] = Array.isArray(spec.points) ? spec.points : DEFAULT_POINT_LAYERS;
  // Which of the plotted cohort and its layers are hidden: a reading gesture, kept in the browser
  // like a hover (invariant 9), and dropped when the layers drawn change.
  const drawn = (plot?.layers || []).map((l, i) => ({ ...l, i })).filter((l) => l.shown !== "none");
  const drawnKey = drawn.map((l) => l.i + ":" + l.label).join("|");
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => setHidden([]), [drawnKey]);
  useEffect(() => {
    if (!hidden.length) return;
    const off = (e: KeyboardEvent) => { if (e.key === "Escape") setHidden([]); };
    window.addEventListener("keydown", off);
    return () => window.removeEventListener("keydown", off);
  }, [hidden]);
  const toggle = (k: string) => setHidden((h) => h.includes(k) ? h.filter((x) => x !== k) : [...h, k]);
  const chip = (k: string, color: string, text: string) => {
    const shown = !hidden.includes(k);
    return <Button key={k} type="button" variant="outline" size="xs" className={cn(CHIP, "h-ctl gap-1.5", !shown && "text-muted-foreground line-through")} aria-pressed={shown}
      data-tip={shown ? "hide " + text + " (Esc shows everything)" : "show " + text} onClick={() => toggle(k)}>
      <span className="size-2.5 flex-none rounded-full" style={{ background: color, opacity: shown ? 1 : 0.35 }} />{text}
    </Button>;
  };
  const axisName = (side: "x" | "y") => plot?.[side].label || side;
  const unit = spec.unit || "sample";
  // A box is drawn with its categories across, whichever axis the document holds them on, so a
  // box whose categories sit on y shows its "vertical" axis across. Swapping makes the two agree.
  const boxTransposed = plot?.shape === "box" && plot.x.kind === "num";
  const boxDrawn = plot?.shape === "box" && !boxTransposed;
  const axisFields = (side: "x" | "y") => <>
    <AxisPicker side={side} stacked axis={spec[side]} attrs={attrs} catalog={catalog} loading={loading} busy={busy}
      onChange={(a) => update((vv) => ({ ...vv, [side]: a }))} />
    <LogToggle spec={spec} side={side} numeric={plot?.[side].kind === "num"} busy={busy} update={update} />
  </>;
  const total = plot?.coverage?.total;
  // Points is a choice only where the cases can be drawn: past the cap, or where a study may not
  // show them (a result asked for every case and got none), the plot is a density whatever the view says
  const pointsWhy = !plot ? null
    : plot.n > POINTS_CAP ? plot.n.toLocaleString() + " " + unit + "s, more than the " + CAP + " that can be drawn as points."
    : spec.allPoints !== false && plot.n && plot.pointSet?.rule !== "all"
      ? "Not drawn as points: " + (plot.pointSet?.why || "a study in it may not show individual cases") + "."
    : null;
  const asPoints = spec.allPoints !== false && !pointsWhy;
  const drawAs = (points: boolean) => update((vv) => { const n = { ...vv }; if (points) delete n.allPoints; else n.allPoints = false; return n; });
  return (
    <div className="@container mt-2.5" data-tw>
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="plot-side flex flex-col gap-1.5" aria-label="plot axes">
          <AxisBlock title="Horizontal axis">
            {axisFields("x")}
            {boxTransposed && <p className="m-0 text-sm text-muted-foreground">A box plot draws its categories across, so this axis is drawn up the side. Swap to make them agree.</p>}
          </AxisBlock>
          {/* a box drawn as the document says has nothing to swap: its categories are already across */}
          <Button variant="link" size="inline" className="plot-swap self-center text-md" disabled={busy || boxDrawn}
            data-tip={boxDrawn ? "a box plot is always drawn by category across, which this one already is — nothing to swap"
              : "put the horizontal axis's definition on the vertical axis, and the vertical one's on the horizontal"}
            onClick={() => update((vv) => ({ ...vv, x: vv.y, y: vv.x }))}><ArrowUp />Swap axes<ArrowDown /></Button>
          <AxisBlock title="Vertical axis">
            {axisFields("y")}
          </AxisBlock>
          <div className="mt-2.5 flex flex-col gap-2.5">
            <div className="axfield flex flex-col gap-1">
              <span className="axfield-name text-sm font-semibold text-foreground">Each point is a</span>
              <Choice size="ctl" className="w-full" value={unit} disabled={busy}
                title="what a point is: a sample, or a patient with its samples combined (a number's mean, a category's common value or Multiple)"
                onChange={(u) => update((vv) => ({ ...vv, unit: u }))}
                options={[["sample", "sample"], ["patient", "patient"]]} />
            </div>
            {plot?.shape !== "table" && (
              <div className="axfield flex flex-col gap-1">
                <span className="axfield-name text-sm font-semibold text-foreground">Draw each {unit} as</span>
                <div className="plot-drawas flex" role="group" aria-label={"draw each " + unit + " as"}>
                  <Button type="button" variant="outline" size="sm" className={SEG} aria-pressed={asPoints} disabled={busy || !!pointsWhy}
                    data-tip={"every " + unit + " as a point, up to " + CAP} onClick={() => drawAs(true)}>Points</Button>
                  <Button type="button" variant="outline" size="sm" className={SEG} aria-pressed={!asPoints} disabled={busy}
                    data-tip="a shaded density per group or grid cell, the highlights below drawn over it" onClick={() => drawAs(false)}>Density</Button>
                </div>
                {pointsWhy && <p className="plot-drawas-why m-0 text-sm text-muted-foreground">{pointsWhy}</p>}
              </div>
            )}
            {plot?.shape !== "table" && (
              <div className="axfield flex flex-col gap-1">
                <span className="axfield-name text-sm font-semibold text-foreground"
                  data-tip="Highlight groups of cases as coloured points over the plot. A case in more than one layer takes the colour of the first.">Highlight</span>
                <PointLayers layers={layers} plot={plot} cohortOptions={cohortOptions} axisName={axisName} busy={busy}
                  onChange={(next) => update((vv) => ({ ...vv, points: next }))} />
              </div>
            )}
          </div>
        </aside>
        <div className="min-w-0">
          {plot && <p className="plot-showing m-0 mb-2.5 rounded-sm bg-muted px-2.5 py-1.5 text-md">
            Showing {plot.n.toLocaleString()}{total != null && total > plot.n ? " of " + total.toLocaleString() : ""} {unit}{plot.n === 1 ? "" : "s"} with data on both axes
          </p>}
          {/* colour and ring split a box's violin and points; a scatter's density and a contingency
              have no per-case colour, so the controls appear only with a box on screen */}
          {(plot?.shape === "box" || drawn.length > 0) && <div className="viewtb mt-0 mb-2.5">
            {plot?.shape === "box" && <><div className="tbz">
              <span className="tbl" data-tip="colours each group's violin and points by a category">colour samples by</span>
              <AxisPicker side="fill" axis={spec.colorBy} allowNone categorical attrs={attrs} catalog={catalog} loading={loading} busy={busy}
                onChange={(a) => update((vv) => { const n = { ...vv }; if (a) n.colorBy = a; else delete n.colorBy; return n; })} />
            </div>
            <div className="tbz">
              <AxisPicker side="ring" axis={spec.ringBy} allowNone categorical attrs={attrs} catalog={catalog} loading={loading} busy={busy}
                onChange={(a) => update((vv) => { const n = { ...vv }; if (a) n.ringBy = a; else delete n.ringBy; return n; })} />
            </div></>}
            {drawn.length > 0 && <div className="tbz plot-solo">
              <span className="tbl" data-tip="this browser only: hide or show the plotted cases and each layer; Esc shows everything">show</span>
              {chip("base", LAYER_BASE, "all " + unit + "s (" + plot!.n.toLocaleString() + ")")}
              {drawn.map((l) => chip(String(l.i), l.color, l.label + " (" + l.n.toLocaleString() + ")"))}
            </div>}
          </div>}
          <div className="plot-figure" data-hide={hidden.length ? hidden.join(" ") : undefined}>{children}</div>
        </div>
      </div>
    </div>
  );
}
