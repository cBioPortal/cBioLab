// The Patient tables' Cohort cell as the portal draws it: the FrequencyBar (a grey bar, the gene's
// share over it, a mutation's keyword share darker still; red or blue for a copy-number call) with
// the percent beside it, and the tooltip of CohortColumnFormatter (mutations) or the CNA table's.
// Pure: the page draws it and a test reads it.
import { portalPercentage } from "../../chart/format.ts";
import { STYLE, type Style } from "../../oncoprint-style.ts";
import type { CohortCount } from "./types.ts";

export interface CohortBar {
  /** the svg's size, and the grey bar's (the portal's 30 × 8, `top` px down); the percent's position and size */
  width: number; height: number; barWidth: number; barHeight: number; top: number; textX: number; textY: number; fontSize: number; text: string; background: string;
  /** the bars over the grey, in drawing order (the gene's share, then the keyword's) */
  bars: { width: number; color: string }[];
}

/** `n` as a share of the row's denominator, 0 when there is none */
const share = (c: CohortCount, n: number) => c.of > 0 ? n / c.of : 0;

/**
 * The cell's bar for a row's counts; `cna` is the row's call (AMP, HOMDEL) on the copy-number table.
 * A bar never runs past the grey (a count above the denominator, a sample with the gene off its panel)
 * nor a keyword's past its gene's.
 */
export function cohortBar(c: CohortCount, cna?: string, S: Style = STYLE): CohortBar {
  const b = S.cohortBar;
  const colors = cna ? [cna === "AMP" ? b.amp : b.del] : [b.gene, b.keyword];
  const counts = cna || c.keyword == null ? [c.n] : [c.n, Math.min(c.keywordN ?? 0, c.n)];
  return {
    width: b.width + b.textMargin + b.textWidth, height: b.svgHeight, barWidth: b.width, barHeight: b.height, top: b.top,
    textX: b.width + b.textMargin, textY: b.textBaseline, fontSize: b.fontSize, text: portalPercentage(share(c, c.n)), background: b.background,
    bars: counts.map((n, i) => ({ width: Math.min(1, share(c, n)) * b.width, color: colors[i % colors.length] })),
  };
}

/**
 * The cell's tooltip: "387 samples (72%) in this study have mutated APC, out of which 376 (70%) have
 * APC truncating mutations." (CohortColumnFormatter); on a copy-number call "27 samples (5%) in this
 * study have amplified ANK1", "1 sample (<1%) in this study has deleted …" (the CNA table's).
 */
export function cohortTooltip(gene: string, c: CohortCount, cna?: string): string {
  const pct = (n: number) => portalPercentage(share(c, n));
  if (cna) return c.n + " " + (c.n === 1 ? "sample" : "samples") + " (" + pct(c.n) + ") in this study " + (c.n === 1 ? "has" : "have") + " " + (cna === "AMP" ? "amplified" : "deleted") + " " + gene;
  return c.n + " samples (" + pct(c.n) + ") in this study have mutated " + gene +
    (c.keyword != null ? ", out of which " + (c.keywordN ?? 0) + " (" + pct(c.keywordN ?? 0) + ") have " + c.keyword + " mutations" : "") + ".";
}
