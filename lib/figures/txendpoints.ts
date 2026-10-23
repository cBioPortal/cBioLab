// Treatment endpoints figure: Kaplan–Meier curves of the endpoint per cohort from the treatment
// anchor, the number at risk, each cohort's median with its interval, and the log-rank test.
import type { DrawnResultOf, TxendpointsCurve } from "../types.ts";
import { palette, frame, caption, label, fmtNum, fmtP, fmtInt, FS, type SvgOpts } from "../svg-kit.ts";
import { kmPanel } from "./km.ts";

const fmtMo = (m: number | null) => m == null ? "not reached" : fmtNum(Math.round(m * 10) / 10) + " mo";

/** a curve's median and interval in words, for the figure and the text summary */
export const txMedianText = (c: Pick<TxendpointsCurve, "median" | "medianLo" | "medianHi">) =>
  "median " + fmtMo(c.median) + (c.median != null ? " (95% CI " + fmtMo(c.medianLo) + "–" + (c.medianHi == null ? "NR" : fmtMo(c.medianHi)) + ")" : "");

export function txendpointsSvg(v: DrawnResultOf<"txendpoints">, o: SvgOpts): string {
  const t = v.txendpoints, p = palette(o.theme), W = Math.max(360, o.width || 720);
  const curves = t.curves.filter((c) => c.n > 0);
  const out: string[] = [];
  const km = kmPanel(curves.map((c) => ({ name: c.cohort, points: c.points, atRisk: c.atRisk,
    detail: txMedianText(c) + " · n = " + fmtInt(c.n) + " · " + fmtInt(c.events) + " events" })),
  { y0: 0, W, p, xTitle: "Months from " + t.anchoredTo, yTitle: "Probability free of the event", ...(t.cutoffMonths != null ? { tMax: t.cutoffMonths } : {}) });
  out.push(km.svg);
  let y = km.height + 4;
  const line = t.logrank
    ? (t.logrank.groups + "-group log-rank χ² = " + fmtNum(t.logrank.chi2) + " (" + t.logrank.df + " df) · " + fmtP(t.logrank.p) + (t.logrank.strata > 1 ? " · stratified by study, " + t.logrank.strata + " strata" : ""))
    : (t.noTest || "");
  if (line) { out.push(label(8, y + FS.body, line, { size: FS.body, fill: p.ink, maxW: W - 16, extra: 'class="logrank"' })); y += Math.round(FS.body * 1.6); }
  const left = t.curves.filter((c) => !c.n).map((c) => c.cohort);
  const cap = caption((left.length ? "Not drawn (no patient entered the risk set): " + left.join(", ") + ". " : "") + (v.caveat || ""), W, y, p.muted);
  out.push(cap.svg);
  return frame(W, y + cap.height + 8, out.join(""), p.bg, false, "Treatment endpoints — " + t.endpointLabel + " from " + t.anchoredTo);
}
