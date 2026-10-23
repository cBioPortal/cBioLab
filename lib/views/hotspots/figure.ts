// The hotspots view's figure: the lollipop of each gene, its selection applied.
import { filterHotspotGene } from "../../lollipop.ts";
import { lollipopPanelsSvg, lollipopSummaryText } from "../../lollipop-svg.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { HotspotGene } from "./types.ts";
import type { SvgOpts } from "../../svg-kit.ts";

/** The lollipop standing alone (an MCP client's image): the selection applied, the app's controls in words in the caption. */
export function hotspotsSvg(v: DrawnResultOf<"hotspots">, o: SvgOpts): string {
  const hide = (v.hide || []) as string[];
  const all = (v.hotspots || []) as HotspotGene[];
  return lollipopPanelsSvg(all.map((g) => filterHotspotGene(g, hide).gene), o,
    [v.note || "", lollipopSummaryText(all, hide)].filter(Boolean).join(" "));
}
