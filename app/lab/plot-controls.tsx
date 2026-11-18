"use client";
// The plot view laid out as cBioPortal's Plots tab is, shared by the lab's plot card and the portal
// pages' Plots tab: each axis defined in its own block in a sidebar (horizontal above vertical, a swap
// between them, the unit and the point layers below), and beside it a line saying how many cases are shown,
// a box plot's colour and ring, and the figure. Under a narrow card the sidebar sits above the figure.
// Every control is an edit to the view, handed to `update`.
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "../_ui/dropdown-menu";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { AxisPicker } from "./view-chrome.tsx";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Choice, OptionSelect } from "../_ui/choice.tsx";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { CHIP, FIELD } from "../_ui/toolbar.ts";
import { profileUse, type ProfileInfo } from "../../lib/profile-catalog.ts";
import { DriverSettingsMenu } from "../_oncoprint/DriverSettingsMenu.tsx";
import type { PlotData } from "../../lib/plot.ts";
import { withAxis } from "../../lib/views/plot/axis-edit.ts";
import { PlotHover } from "./plot-hover.tsx";
import { DEFAULT_POINT_LAYERS, POINTS_CAP, LAYER_BASE, LAYER_COLORS, POINT_LAYER_CAP, POINT_RULE_N, POINT_RULE_N_MAX, layerLabel, type PointLayerSpec } from "../../lib/plot-layers.ts";

type Update = (fn: (view: any) => any) => void;
/** one half of a two-way switch, the chosen half filled */
const SEG = "h-ctl flex-1 rounded-none px-2 text-md font-normal first:rounded-l-md last:rounded-r-md [&+&]:-ml-px " +
  "aria-pressed:border-link aria-pressed:bg-link aria-pressed:text-card aria-pressed:hover:bg-link/90 aria-pressed:hover:text-card";
/** the points cap as the controls print it */
const CAP = POINTS_CAP.toLocaleString("en-US");

function LogToggle({ spec, side, numeric, off, busy, update }: { spec: any; side: "x" | "y"; numeric: boolean; off?: number; busy: boolean; update: Update }) {
  const axis = spec[side];
  if (!numeric || !axis || !("source" in axis) || (axis.source !== "clinical" && axis.source !== "molecular" && axis.source !== "assay" && axis.source !== "profile")) return null;
  // as on cBioPortal's Plots tab: unchecked and disabled while the axis has values below 0, the document keeping the choice
  const tip = off != null ? "no log scale here: this axis has values below 0 (the lowest " + off + "), and cBioPortal offers a log scale on such an axis only for an RNA-seq profile"
    : axis.source === "assay" ? "draw this axis on a log scale — log10(value), as cBioPortal draws a generic assay"
    : "draw this axis on a log scale — log2(max(value, 0) + 1), as cBioPortal draws it";
  return (
    <label className="chk text-md text-foreground" data-tip={tip}>
      <Checkbox checked={!!axis.log && off == null} disabled={busy || off != null}
        onCheckedChange={(c) => update((vv) => {
          const a = { ...vv[side] };
          if (c === true) a.log = true; else delete a.log;
          return { ...vv, [side]: a };
        })} />
      Log scale
    </label>
  );
}

/** cBioPortal turns the log scale on when an RNA-seq mRNA profile is chosen for an axis (maybeSetLogScale) */
function withRnaSeqLog(next: any, prev: any, catalog: ProfileInfo[]): any {
  if (!next || next.source !== "profile" || (prev && prev.source === "profile" && prev.profile === next.profile)) return next;
  const p = catalog.find((x) => x.profile === next.profile);
  return p && p.type.toUpperCase() === "MRNA_EXPRESSION" && next.profile.includes("rna_seq") ? { ...next, log: true } : next;
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

/** the plot's axes and colours that group by mutation, with what they group by */
function mutationAxes(spec: any, catalog: ProfileInfo[]): string[] {
  return [spec.x, spec.y, spec.colorBy, spec.ringBy].flatMap((a: any) => !a ? []
    : a.source === "alteration" && a.gene && (a.by === "driver" || a.by === "mutationType") ? [a.by]
    : a.source === "profile" && a.by !== "mutated" && catalog.some((p) => p.profile === a.profile && profileUse(p) === "mutation") ? [a.by || "mutationType"]
    : []);
}
/** whether a driver call can change what this plot draws */
const callsDrivers = (spec: any, catalog: ProfileInfo[]): boolean => mutationAxes(spec, catalog).length > 0;
/** whether it draws a mutation type, which driver settings split into Driver and VUS */
const splitsTypes = (spec: any, catalog: ProfileInfo[]): boolean => mutationAxes(spec, catalog).includes("mutationType");

export function PlotControls({ spec, plot, studies, attrs, catalog, loading, busy, cohortOptions, update, children }: {
  /** the view as the document holds it */
  spec: any;
  /** the last result's plot: which shape is on screen, each axis's name and kind, how many cases it shows, its layers */
  plot?: PlotData;
  /** the studies the last result was drawn over: a hovered case links to its page when there is one */
  studies?: string[];
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
  // a box always takes a colour (its density splits too); a scatter only while its cases are points
  const colourable = plot?.shape === "box" || (plot?.shape === "scatter" && plot.pointSet?.rule === "all" && !!plot.xyPoints?.length);
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
  const axisFields = (side: "x" | "y") => <>
    <AxisPicker side={side} stacked axis={spec[side]} attrs={attrs} catalog={catalog} loading={loading} busy={busy}
      onChange={(a) => update((vv) => withAxis(vv, side, withRnaSeqLog(a, vv[side], catalog)))} />
    <LogToggle spec={spec} side={side} numeric={plot?.[side].kind === "num"} off={plot?.logOff?.[side]} busy={busy} update={update} />
  </>;
  const total = plot?.coverage?.total;
  // a box's categories, and any the view names that this cohort lacks, so each can be unticked
  const categoryOptions = plot?.shape === "box" && spec.x?.source !== "cohort" && plot.categoryOptions?.length
    ? [...new Set([...plot.categoryOptions, ...(Array.isArray(spec.categories) ? spec.categories as string[] : [])])] : [];
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
          </AxisBlock>
          <Button variant="link" size="inline" className="plot-swap self-center text-md" disabled={busy}
            data-tip="put the horizontal axis's definition on the vertical axis, and the vertical one's on the horizontal"
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
            {plot?.shape === "scatter" && (
              <label className="chk plot-regression text-md text-foreground"
                data-tip="draw the least-squares line and label it y = mx + b with its R², rounded to two decimals as cBioPortal rounds them">
                <Checkbox checked={!!spec.regression} disabled={busy}
                  onCheckedChange={(c) => update((vv) => { const n = { ...vv }; if (c === true) n.regression = true; else delete n.regression; return n; })} />
                Show Regression Line
              </label>
            )}
            {categoryOptions.length > 0 && (
              <div className="axfield flex flex-col gap-1">
                <span className="axfield-name text-sm font-semibold text-foreground">Filter categories</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="plot-categories justify-between" disabled={busy}
                      data-tip="draw only the boxes of the categories ticked here; none ticked draws them all">
                      {spec.categories?.length ? spec.categories.length + " of " + categoryOptions.length : "all " + categoryOptions.length}
                      <ChevronDown className="opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-52 max-h-80 overflow-y-auto">
                    {categoryOptions.map((g) => (
                      // stays open, so several can be ticked in one go
                      <DropdownMenuCheckboxItem key={g} checked={!!spec.categories?.includes(g)} onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => update((vv) => {
                          const cur = new Set(vv.categories || []);
                          if (cur.has(g)) cur.delete(g); else cur.add(g);
                          const n = { ...vv };
                          if (cur.size) n.categories = [...cur]; else delete n.categories;
                          return n;
                        })}>{g}</DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {plot?.shape === "box" && spec.x?.source !== "cohort" && (plot.groups?.length || 0) > 1 && (
              <label className="chk plot-sort-median text-md text-foreground" data-tip="order the boxes by their values' median, lowest first, as cBioPortal does">
                <Checkbox checked={!!spec.sortByMedian} disabled={busy}
                  onCheckedChange={(c) => update((vv) => { const n = { ...vv }; if (c === true) n.sortByMedian = true; else delete n.sortByMedian; return n; })} />
                Sort Categories by Median
              </label>
            )}
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
            {callsDrivers(spec, catalog) && (
              <div className="axfield flex flex-col gap-1">
                <span className="axfield-name text-sm font-semibold text-foreground"
                  data-tip="which sources call a mutation a putative driver, for an axis or colour that tells Driver from VUS">Driver annotation</span>
                {/* the portal's Plots tab colours a mutation type as "(Driver)" or "(VUS)"; here a view asks for it by holding driver settings */}
                {splitsTypes(spec, catalog) && <label className="chk" data-tip="split each mutation type into Driver and VUS, as cBioPortal's Plots tab colours them">
                  <Checkbox checked={spec.drivers != null} disabled={busy}
                    onCheckedChange={(c) => update((vv) => { const n = { ...vv }; if (c === true) n.drivers = n.drivers || {}; else delete n.drivers; return n; })} />
                  mutation types as Driver / VUS</label>}
                {(spec.drivers != null || !splitsTypes(spec, catalog)) &&
                  // the plot does not report the study's custom calls, so they are offered and apply where the study has them
                  <DriverSettingsMenu menuId="plot-drivers" drivers={spec.drivers} busy={busy} filters={false} report={{ binary: true, tiers: [] }}
                    scope="this plot; it draws every mutation, VUS and germline included, as cBioPortal's Plots tab does"
                    onChange={(d) => update((vv) => ({ ...vv, drivers: d || {} }))} />}
              </div>
            )}
          </div>
        </aside>
        <div className="min-w-0">
          {plot && <p className="plot-showing m-0 mb-2.5 rounded-sm bg-muted px-2.5 py-1.5 text-md">
            {plot.filtered
              ? <>Showing {plot.n.toLocaleString()} of the {plot.filtered.paired.toLocaleString()} {unit}{plot.filtered.paired === 1 ? "" : "s"} with data on both axes: {plot.groups?.length || 0} of {plot.categoryOptions?.length || 0} categories</>
              : <>Showing {plot.n.toLocaleString()}{total != null && total > plot.n ? " of " + total.toLocaleString() : ""} {unit}{plot.n === 1 ? "" : "s"} with data on both axes</>}
          </p>}
          {/* colour and ring split a box's violin and points and a scatter's points; a scatter drawn as
              density and a contingency have no per-case colour, and a density scatter says so */}
          {(plot?.shape === "box" || plot?.shape === "scatter" || drawn.length > 0) && <div className="viewtb mt-0 mb-2.5">
            {plot?.shape === "scatter" && !colourable && <div className="tbz">
              <span className="tbl text-muted-foreground" data-tip="each cell of a density holds many cases, so there is no one colour to give it; a scatter is coloured when its cases are drawn as points">
                colour samples by: drawn as density, no per-case colour</span>
              {(spec.colorBy || spec.ringBy) && <button type="button" className="tbl underline" disabled={busy}
                data-tip="this plot still asks for a colour or ring it cannot draw while it is a density; clear it"
                onClick={() => update((vv) => { const n = { ...vv }; delete n.colorBy; delete n.ringBy; return n; })}>
                clear {[spec.colorBy ? "colour" : "", spec.ringBy ? "ring" : ""].filter(Boolean).join(" and ")}</button>}
            </div>}
            {colourable && <><div className="tbz">
              <span className="tbl" data-tip={plot?.shape === "box" ? "colours each group's violin and points by a category" : "colours each point by a category"}>colour samples by</span>
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
          <div className="plot-figure" data-hide={hidden.length ? hidden.join(" ") : undefined}>
            <PlotHover plot={plot} unit={unit} study={studies?.length === 1 ? studies[0] : undefined}>{children}</PlotHover>
          </div>
        </div>
      </div>
    </div>
  );
}
