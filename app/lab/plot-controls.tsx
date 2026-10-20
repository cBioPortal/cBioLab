"use client";
// The plot view's settings bar, shared by the lab's plot card and the portal pages' Plots tab:
// both axes (with a log scale for a numeric one), a box plot's colour and ring, the highlighted
// cohorts, the unit and the axis swap. Every control is an edit to the view, handed to `update`.
import { ArrowLeftRight } from "lucide-react";
import { AxisPicker, HighlightPicker } from "./view-chrome.tsx";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { Choice } from "../_ui/choice.tsx";
import { TB } from "../_ui/toolbar.ts";

type Update = (fn: (view: any) => any) => void;

function LogToggle({ spec, side, numeric, busy, update }: { spec: any; side: "x" | "y"; numeric: boolean; busy: boolean; update: Update }) {
  const axis = spec[side];
  if (!numeric || !axis || !("source" in axis) || (axis.source !== "clinical" && axis.source !== "molecular")) return null;
  return (
    <label className="chk" title={"draw " + side + " on a log scale — log10(value + 1), so zero stays on the axis and a negative value is left out"}>
      <Checkbox checked={!!axis.log} disabled={busy}
        onCheckedChange={(c) => update((vv) => {
          const a = { ...vv[side] };
          if (c === true) a.log = true; else delete a.log;
          return { ...vv, [side]: a };
        })} />
      log
    </label>
  );
}

export function PlotControls({ spec, plot, attrs, profiles, loading, busy, highlightOptions, update }: {
  /** the view as the document holds it */
  spec: any;
  /** the last result's plot, for which shape is on screen */
  plot?: { shape: string; x: { kind: string }; y: { kind: string } };
  attrs: { attribute: string; kind: string }[]; profiles: string[]; loading?: boolean; busy: boolean;
  /** the cohorts that may be highlighted: every one but the plotted one and a split */
  highlightOptions: { name: string; label: string; depth: number }[];
  update: Update;
}) {
  const chosen: string[] = Array.isArray(spec.highlight) ? spec.highlight : [];
  // Every control here changes what is DRAWN and costs a query, so there is one zone and it says
  // so — the same toolbar the oncoprint uses.
  return (
    <div className="viewtb">
      <div className="tbz">
        <span className="tbl" title="these change what is drawn, and re-run the query">data</span>
        <AxisPicker side="x" axis={spec.x} attrs={attrs} profiles={profiles} loading={loading} busy={busy}
          onChange={(a) => update((vv) => ({ ...vv, x: a }))} />
        <LogToggle spec={spec} side="x" numeric={plot?.x.kind === "num"} busy={busy} update={update} />
      </div>
      <div className="tbz">
        <AxisPicker side="y" axis={spec.y} attrs={attrs} profiles={profiles} loading={loading} busy={busy}
          onChange={(a) => update((vv) => ({ ...vv, y: a }))} />
        <LogToggle spec={spec} side="y" numeric={plot?.y.kind === "num"} busy={busy} update={update} />
      </div>
      {/* colour/ring only affect a box plot's violin — a scatter's density and a contingency table
          have no per-case colour to split, so they are offered only once a box is on screen */}
      {plot?.shape === "box" && <div className="tbz">
        <span className="tbl" title="colours each group's violin by a category">colour</span>
        <AxisPicker side="fill" axis={spec.colorBy} allowNone categorical attrs={attrs} profiles={profiles} loading={loading} busy={busy}
          onChange={(a) => update((vv) => { const n = { ...vv }; if (a) n.colorBy = a; else delete n.colorBy; return n; })} />
        <AxisPicker side="ring" axis={spec.ringBy} allowNone categorical attrs={attrs} profiles={profiles} loading={loading} busy={busy}
          onChange={(a) => update((vv) => { const n = { ...vv }; if (a) n.ringBy = a; else delete n.ringBy; return n; })} />
      </div>}
      {plot?.shape !== "table" && (highlightOptions.length > 0 || chosen.length > 0) && <div className="tbz">
        <HighlightPicker chosen={chosen} options={highlightOptions} busy={busy}
          onChange={(next) => update((vv) => { const n = { ...vv }; if (next.length) n.highlight = next; else delete n.highlight; return n; })} />
      </div>}
      <div className="tbz">
        <label className="tbfield" title="what a point is; patient mode averages a patient's samples">unit <Choice size="ctl"
          value={spec.unit || "patient"} disabled={busy}
          onChange={(u) => update((vv) => ({ ...vv, unit: u }))}
          options={[["patient", "patients"], ["sample", "samples"]]} /></label>
        {/* a box plot is always drawn categories-on-x, values-on-y whichever axis is which in the
            document, so swapping would change nothing a reader can see */}
        <Button variant="outline" size="sm" className={TB} disabled={busy || plot?.shape === "box"}
          title={plot?.shape === "box" ? "a box plot is always drawn by category, whichever axis holds it — nothing to swap"
            : "put the x axis on y and the y axis on x"}
          onClick={() => update((vv) => ({ ...vv, x: vv.y, y: vv.x }))}><ArrowLeftRight />swap</Button>
      </div>
    </div>
  );
}
