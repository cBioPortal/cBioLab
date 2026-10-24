"use client";
// The hotspots view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Button } from "../../_ui/button";
import type { CardProps } from "../view-cards.tsx";
import { HotspotsBody } from "../../_lollipop/HotspotsBody.tsx";
import type { KindUi } from "./kind-ui.ts";
import { ViewHead } from "../view-chrome.tsx";
import { placement } from "./parts.tsx";

function HotspotsCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openGenes, updateViewLocal } = ctx;
  return <>
    {v.kind === "hotspots" && v.hotspots && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Mutations" cohorts={cohortChoice(vi, docView(vi), 1)} sub="lollipop by protein position, as the portal's mutation tab draws it" {...placement(ctx, vi)}
        actions={<Button variant="link" size="inline" className="genesbtn text-md" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</Button>} />
      {/* the plot from the same renderer MCP uses (lib/view-svg.ts), with the gene summary and the
          alteration grid beside it as controls; the grid's selection re-runs nothing */}
      <HotspotsBody v={v} hide={docView(vi).hide} onHide={(h) => updateViewLocal(vi, (vv: any) => {
        const nx = { ...vv }; if (h) nx.hide = h; else delete nx.hide; return nx;
      })} />
    </>}
  </>;
}

export const hotspotsUi: KindUi<"hotspots"> = {
  kind: "hotspots",
  label: "Lollipop (hotspots)",
  title: "Mutations",
  maxCohorts: 1,
  defaults: (k) => ({ kind: "hotspots", genes: k.genes.slice(0, 4), minCount: 1 }),
  Card: HotspotsCard,
  drawsOwnHead: (v) => !!v.hotspots,
};
