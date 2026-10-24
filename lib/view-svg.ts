// One ViewResult -> one SVG figure: the dispatcher over every view kind's renderer.
//
// The engine produces data; a renderer is pure and knows nothing about where the picture is going.
// That is what lets one figure appear identically in the web UI (drawn in the browser at its
// card's width, app/lab/figure.tsx), in a chat transcript and in an MCP client: there is only
// ever one renderer per kind, its descriptor's figure (lib/views/<kind>/kind.ts), laid out with lib/chart/ (via
// lib/svg-kit.ts).
//
// Every renderer obeys three rules:
//
//  1. Every label is escaped. Cohort names and attribute values are user input
//     and land in <text>; the web UI injects these with dangerouslySetInnerHTML.
//  2. Scaling is uniform. An SVG scaled with preserveAspectRatio="none" shears
//     circles into ellipses and slants text — the bug that forced the lollipop
//     out of SVG once already.
//  3. Layout is measured, never guessed: margins from the widest label (lib/chart/text.ts),
//     ticks from lib/chart/scale.ts, axes and legends from lib/chart/, sizes from FS / SW.
//
// Colours come from CSS custom properties with literal fallbacks, so an SVG
// inlined in the app follows the page theme while the same string rasterised
// for a chat gets a fixed light figure.
import { lollipopSummaryText } from "./lollipop-svg.ts";
export { lollipopSummaryText };
import { isDrawn, type ViewResult } from "./types.ts";
import { kindOf } from "./views/kinds.ts";
import { RISK_FLOOR } from "./views/course/figure.ts";
export { RISK_FLOOR };
import { esc, SERIES, type SvgOpts } from "./svg-kit.ts";
export { esc, SERIES, type SvgOpts };

export function viewToSvg(v: ViewResult, o: SvgOpts = {}): string | null {
  if (!v || !isDrawn(v)) return null;
  return kindOf(v.kind)?.figure?.(v, o) ?? null;
}

/** A one-line title for a figure, for alt text and chat captions. */
export function viewTitle(v: ViewResult): string {
  const c = (v.cohorts || []).join(" vs ");
  const base = kindOf(v.kind)?.title?.(v) || v.kind;
  return c ? base + " — " + c : base;
}
