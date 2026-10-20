"use client";
// The plot view laid out as cBioPortal's Plots tab is, shared by the lab's plot card and the portal
// pages' Plots tab: each axis defined in its own block in a sidebar (horizontal above vertical, a swap
// between them, the cases and highlights below), and beside it a line saying how many cases are shown,
// a box plot's colour and ring, and the figure. Under a narrow card the sidebar sits above the figure.
// Every control is an edit to the view, handed to `update`.
import { ArrowDown, ArrowUp } from "lucide-react";
import { AxisPicker, HighlightPicker } from "./view-chrome.tsx";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Choice } from "../_ui/choice.tsx";

type Update = (fn: (view: any) => any) => void;

function LogToggle({ spec, side, numeric, busy, update }: { spec: any; side: "x" | "y"; numeric: boolean; busy: boolean; update: Update }) {
  const axis = spec[side];
  if (!numeric || !axis || !("source" in axis) || (axis.source !== "clinical" && axis.source !== "molecular")) return null;
  return (
    <label className="chk text-md text-foreground" title="draw this axis on a log scale — log10(value + 1), so zero stays on the axis and a negative value is left out">
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

export function PlotControls({ spec, plot, attrs, profiles, loading, busy, highlightOptions, update, children }: {
  /** the view as the document holds it */
  spec: any;
  /** the last result's plot: which shape is on screen, which axis is numeric, how many cases it shows */
  plot?: { shape: string; n: number; x: { kind: string }; y: { kind: string }; coverage?: { total: number } };
  attrs: { attribute: string; kind: string }[]; profiles: string[]; loading?: boolean; busy: boolean;
  /** the cohorts that may be highlighted: every one but the plotted one and a split */
  highlightOptions: { name: string; label: string; depth: number }[];
  update: Update;
  /** the figure, and whatever the page covers it with while it waits */
  children: React.ReactNode;
}) {
  const chosen: string[] = Array.isArray(spec.highlight) ? spec.highlight : [];
  const unit = spec.unit || "sample";
  // A box is drawn with its categories across, whichever axis the document holds them on, so a
  // box whose categories sit on y shows its "vertical" axis across. Swapping makes the two agree.
  const boxTransposed = plot?.shape === "box" && plot.x.kind === "num";
  const boxDrawn = plot?.shape === "box" && !boxTransposed;
  const axisFields = (side: "x" | "y") => <>
    <AxisPicker side={side} stacked axis={spec[side]} attrs={attrs} profiles={profiles} loading={loading} busy={busy}
      onChange={(a) => update((vv) => ({ ...vv, [side]: a }))} />
    <LogToggle spec={spec} side={side} numeric={plot?.[side].kind === "num"} busy={busy} update={update} />
  </>;
  const total = plot?.coverage?.total;
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
            title={boxDrawn ? "a box plot is always drawn by category across, which this one already is — nothing to swap"
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
            {plot?.shape !== "table" && (highlightOptions.length > 0 || chosen.length > 0) && (
              <div className="axfield flex flex-col gap-1">
                <span className="axfield-name text-sm font-semibold text-foreground" title="other cohorts drawn over this one, each in its own colour">Highlight cohorts</span>
                <HighlightPicker stacked chosen={chosen} options={highlightOptions} busy={busy}
                  onChange={(next) => update((vv) => { const n = { ...vv }; if (next.length) n.highlight = next; else delete n.highlight; return n; })} />
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
          {plot?.shape === "box" && <div className="viewtb mt-0 mb-2.5">
            <div className="tbz">
              <span className="tbl" title="colours each group's violin and points by a category">colour samples by</span>
              <AxisPicker side="fill" axis={spec.colorBy} allowNone categorical attrs={attrs} profiles={profiles} loading={loading} busy={busy}
                onChange={(a) => update((vv) => { const n = { ...vv }; if (a) n.colorBy = a; else delete n.colorBy; return n; })} />
            </div>
            <div className="tbz">
              <AxisPicker side="ring" axis={spec.ringBy} allowNone categorical attrs={attrs} profiles={profiles} loading={loading} busy={busy}
                onChange={(a) => update((vv) => { const n = { ...vv }; if (a) n.ringBy = a; else delete n.ringBy; return n; })} />
            </div>
          </div>}
          {children}
        </div>
      </div>
    </div>
  );
}
