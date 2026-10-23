// The cooccurrence view's figure.
import { type HRow, UP,DOWN, hbars, sentence } from "../../figures/bars.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts } from "../../svg-kit.ts";
import type { CooccurRow } from "./types.ts";
import { OTHER, fmtNum, fmtQ, fmtInt } from "../../svg-kit.ts";

export function cooccurrenceSvg(v: DrawnResultOf<"cooccurrence">, o: SvgOpts): string {
  const pairs = (v.pairs || []) as CooccurRow[];
  let anyInf = false;
  const rows = pairs.map((r): HRow => {
    const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : r.log2Odds;
    if (lor != null && !Number.isFinite(lor)) anyInf = true;
    const p = r.pStratified ?? r.p;
    const sig = r.q < 0.05 && lor != null && lor !== 0;
    return {
      label: r.a + " / " + r.b, v: lor, fill: sig ? (lor! > 0 ? UP : DOWN) : OTHER,
      text: (lor == null ? "–" : fmtNum(lor)) + " · " + fmtQ(r.q),
      tip: r.a + " / " + r.b + ": both " + fmtInt(r.both) + ", " + r.a + " only " + fmtInt(r.onlyA) + ", " + r.b + " only " + fmtInt(r.onlyB) +
        ", neither " + fmtInt(r.neither) + " · " + (r.pStratified != null ? "stratified " : "") + "p " + fmtQ(p).slice(2)
    };
  });
  return hbars("Co-occurrence — log₂ odds ratio", rows, o, {
    signed: true, axisTitle: "log₂ odds ratio — left: mutually exclusive, right: co-occurring",
    legend: [{ label: "co-occur, q < 0.05", color: UP }, { label: "mutually exclusive, q < 0.05", color: DOWN }, { label: "not significant", color: OTHER }],
    note: sentence(v.note || "") + (anyInf ? " An odds ratio of 0 or ∞ (a pair never or always seen together) is drawn to the edge of the axis." : "")
  });
}
