"use client";
// The plot view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import type { KindUi } from "./kind-ui.ts";
import { PlotControls } from "../plot-controls.tsx";
import { ViewFigure } from "../figure.tsx";
import { ViewHead } from "../view-chrome.tsx";
import { placement } from "./parts.tsx";

/** a numeric plot axis on a log scale: log10(v + 1), so a zero stays on the axis (lib/plot.ts) */
function PlotCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, catalogAttrs, cohortChoice, docView, menuOpenRef, profileCatalog, updateView } = ctx;
  // every cohort the document evaluates, but the plotted one and a split (which stands for several groups, not one set of cases)
  const ch = cohortChoice(vi, docView(vi), 1);
  const cohortOptions = ch.nodes.filter((nd) => nd.kind !== "split" && nd.name !== ch.drawn[0])
    .map((nd) => ({ name: nd.name, label: nd.label, depth: nd.depth }));
  return <>
    {v.kind === "plot" && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Plot" cohorts={ch} {...placement(ctx, vi)}
        sub={v.plot ? <>{v.plot.shape === "scatter" ? "density" : v.plot.shape === "box" ? "box" : "contingency"} · {v.plot.n.toLocaleString()} {(docView(vi).unit || "sample")}s</> : "two axes over the same cases"} />
      <PlotControls spec={docView(vi)} plot={v.plot} attrs={catalogAttrs()} catalog={profileCatalog()} loading={attrsLoading()} busy={busy}
        cohortOptions={cohortOptions} update={(fn) => updateView(vi, fn)}>
        <ViewFigure v={v} empty={v.plot?.note || "nothing to draw"} />
      </PlotControls>
    </>}
  </>;
}

export const plotUi: KindUi<"plot"> = {
  kind: "plot",
  label: "Plot",
  title: "Plot",
  maxCohorts: 1,
  why: (_k, p) => p.viewAttrs().length ? null : "this study declares no clinical attributes to plot",
  loading: (_k, p) => p.attrsLoading(),
  defaults: (k, p) => {
    // start from two attributes this study actually declares, and fall back to an
    // alteration axis, which every study can answer
    const nums = p.numericAttrs();
    if (nums.length >= 2) return { kind: "plot", x: { source: "clinical", attribute: nums[0] }, y: { source: "clinical", attribute: nums[1] }, unit: "sample" };
    const cat = k.attrs.find((a) => a.kind !== "num");
    return { kind: "plot", unit: "sample",
      x: { source: "alteration", gene: k.genes[0] || "TP53", by: "mutationType" },
      y: cat ? { source: "clinical", attribute: cat.attribute } : { source: "alteration", gene: k.genes[1] || "KRAS", by: "mutated" } };
  },
  Card: PlotCard,
  drawsOwnHead: () => true,
};
