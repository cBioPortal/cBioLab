// The clinical view's figure.
import { type HRow, hbars } from "../../figures/bars.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts } from "../../svg-kit.ts";
import type { ClinicalRow } from "./types.ts";
import { OTHER, SERIES, fmtQ } from "../../svg-kit.ts";

/** −log₁₀ q past this runs off the axis as an arrow: q < 1e-50 is beyond any reading difference */
const Q_CAP = 50;

export function clinicalSvg(v: DrawnResultOf<"clinical">, o: SvgOpts): string {
  const all = (v.clinical || []) as ClinicalRow[];
  const rows = all.map((r): HRow => {
    if (r.skipped) return { label: r.attribute, v: null, fill: OTHER, text: "not tested: " + r.skipped, muted: true };
    const q = r.q;
    return {
      label: r.attribute, v: q == null ? null : q > 0 ? -Math.log10(q) : Infinity,
      fill: q != null && q < 0.05 ? SERIES[0] : OTHER,
      text: (r.test || "") + " · " + (q == null ? "q –" : fmtQ(q))
    };
  });
  return hbars("Clinical comparison — −log₁₀ q", rows, o, {
    signed: false, axisTitle: "−log₁₀ q (Benjamini–Hochberg) — longer is stronger evidence of a difference", cap: Q_CAP,
    ref: { at: -Math.log10(0.05), text: "q = 0.05" },
    legend: [{ label: "q < 0.05", color: SERIES[0] }, { label: "not significant", color: OTHER }],
    note: v.note || ""
  });
}
