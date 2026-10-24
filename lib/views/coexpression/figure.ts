// The coexpression view's figure.
import { hbars, type HRow, UP,DOWN } from "../../figures/bars.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts } from "../../svg-kit.ts";
import type { CoexprRow } from "./types.ts";
import { OTHER, fmtNum, fmtInt, fmtQ } from "../../svg-kit.ts";

export function coexpressionSvg(v: DrawnResultOf<"coexpression">, o: SvgOpts): string {
  const rows = (v.coexpression || []) as CoexprRow[];
  return hbars("Co-expression — Pearson r", rows.map((r): HRow => {
    const rr = r.rMeta ?? r.r;
    const sig = r.q < 0.05 && rr != null && rr !== 0;
    return {
      label: r.a + " / " + r.b, v: rr, fill: sig ? (rr! > 0 ? UP : DOWN) : OTHER,
      text: (rr == null ? "r –" : "r = " + fmtNum(rr, 2)) + " · n = " + fmtInt(r.n) + " · " + fmtQ(r.q),
      tip: r.a + " / " + r.b + (r.rMeta != null ? ": r combined across " + (r.sites ?? 0) + " sites" : "") +
        (r.perStudy && r.perStudy.length > 1 ? "\n" + r.perStudy.map((s) => s.study + ": r " + (s.r == null ? "–" : fmtNum(s.r, 2)) + ", n " + fmtInt(s.n)).join("\n") : "")
    };
  }), o, {
    signed: true, axisTitle: "Pearson r — left: anti-correlated, right: correlated",
    legend: [{ label: "positive, q < 0.05", color: UP }, { label: "negative, q < 0.05", color: DOWN }, { label: "not significant", color: OTHER }],
    note: v.note || ""
  });
}
