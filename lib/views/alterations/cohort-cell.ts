// The Patient tables' Cohort cell as the portal draws it: the FrequencyBar (a grey bar, the gene's
// share over it, a mutation's keyword share darker still; red or blue for a copy-number call) with
// the percent beside it, and the tooltip of CohortColumnFormatter (mutations) or the CNA table's.
// Pure: the page draws it and a test reads it.
import { portalPercentage } from "../../chart/format.ts";
import { STYLE, type Style } from "../../oncoprint-style.ts";
import type { CohortCount } from "./types.ts";

export interface CohortBar {
  /** the svg's size, and the grey bar's (the portal's 30 × 8, 2 px down) */
  width: number; height: number; barWidth: number; barHeight: number; textX: number; text: string; background: string;
  /** the bars over the grey, in drawing order (the gene's share, then the keyword's) */
  bars: { width: number; color: string }[];
}

/** The cell's bar for a row's counts; `cna` is the row's call (AMP, HOMDEL) on the copy-number table. */
export function cohortBar(c: CohortCount, cna?: string, S: Style = STYLE): CohortBar {
  const b = S.cohortBar;
  const share = (n: number) => c.of > 0 ? n / c.of : 0;
  const colors = cna ? [cna === "AMP" ? b.amp : b.del] : [b.gene, b.keyword];
  const counts = cna || c.keyword == null ? [c.n] : [c.n, c.keywordN ?? 0];
  return {
    width: b.width + b.textMargin + b.textWidth, height: 12, barWidth: b.width, barHeight: b.height, textX: b.width + b.textMargin, text: portalPercentage(share(c.n)), background: b.background,
    bars: counts.map((n, i) => ({ width: share(n) * b.width, color: colors[i % colors.length] })),
  };
}

/**
 * The cell's tooltip: "387 samples (72%) in this study have mutated APC, out of which 376 (70%) have
 * APC truncating mutations." (CohortColumnFormatter); on a copy-number call "27 samples (5%) in this
 * study have amplified ANK1", "1 sample (<1%) in this study has deleted …" (the CNA table's).
 */
export function cohortTooltip(gene: string, c: CohortCount, cna?: string): string {
  const pct = (n: number) => portalPercentage(c.of > 0 ? n / c.of : 0);
  if (cna) return c.n + " " + (c.n === 1 ? "sample" : "samples") + " (" + pct(c.n) + ") in this study " + (c.n === 1 ? "has" : "have") + " " + (cna === "AMP" ? "amplified" : "deleted") + " " + gene;
  return c.n + " samples (" + pct(c.n) + ") in this study have mutated " + gene +
    (c.keyword != null ? ", out of which " + (c.keywordN ?? 0) + " (" + pct(c.keywordN ?? 0) + ") have " + c.keyword + " mutations" : "") + ".";
}
