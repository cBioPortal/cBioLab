// One ViewResult -> one SVG figure: the dispatcher over every view kind's renderer.
//
// The engine produces data; a renderer is pure and knows nothing about where the picture is going.
// That is what lets one figure appear identically in the web UI (drawn in the browser at its
// card's width, app/lab/figure.tsx), in a chat transcript and in an MCP client: there is only
// ever one renderer per kind, in lib/figures/<kind>.ts, laid out with lib/chart/ (via
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
import { filterHotspotGene } from "./lollipop.ts";
import { lollipopPanelsSvg, lollipopSummaryText } from "./lollipop-svg.ts";
export { lollipopSummaryText };
import { isDrawn, type ViewResult, type DrawnResultOf } from "./types.ts";
import { kindFigure, kindTitle } from "./figures/index.ts";
import { survivalSvg } from "./views/survival/figure.ts";
import { coxSvg, logisticSvg } from "./figures/forest.ts";
import { cooccurrenceSvg, compareSvg, coexpressionSvg, clinicalSvg } from "./figures/bars.ts";
import { courseSvg, RISK_FLOOR } from "./views/course/figure.ts";
import { sequenceSvg } from "./views/sequence/figure.ts";
import { plotSvg } from "./views/plot/figure.ts";
export { RISK_FLOOR };
import { esc, SERIES, type SvgOpts } from "./svg-kit.ts";
import type { HotspotGene } from "./views/hotspots/types.ts";
export { esc, SERIES, type SvgOpts };

/** The lollipop standing alone (an MCP client's image): the selection applied, the app's controls in words in the caption. */
function hotspotsSvg(v: DrawnResultOf<"hotspots">, o: SvgOpts): string {
  const hide = (v.hide || []) as string[];
  const all = (v.hotspots || []) as HotspotGene[];
  return lollipopPanelsSvg(all.map((g) => filterHotspotGene(g, hide).gene), o,
    [v.note || "", lollipopSummaryText(all, hide)].filter(Boolean).join(" "));
}

export function viewToSvg(v: ViewResult, o: SvgOpts = {}): string | null {
  if (!v || !isDrawn(v)) return null;
  if (v.kind === "oncoprint") return v.svg || null;   // already rendered by the contract
  if (v.kind === "plot" && v.plot) return plotSvg(v, o) || null;
  if (v.kind === "course" && v.course && v.course.length) return courseSvg(v, o);
  if (v.kind === "sequence" && v.sequence && v.sequence.panels.some((z) => z.flows.length)) return sequenceSvg(v, o);
  if (v.kind === "survival" && v.curves && v.curves.length) return survivalSvg(v, o);
  if (v.kind === "cox" && v.cox && (v.cox.coefficients.length || (v.cox.byCohort || []).some((c) => c.coefficients.length))) return coxSvg(v, o);
  if (v.kind === "logistic" && v.logistic && v.logistic.coefficients.length) return logisticSvg(v, o);
  if (v.kind === "hotspots" && v.hotspots && v.hotspots.length) return hotspotsSvg(v, o);
  if (v.kind === "cooccurrence" && v.pairs && v.pairs.length) return cooccurrenceSvg(v, o);
  if (v.kind === "compare" && v.rows && v.rows.length) return compareSvg(v, o);
  if (v.kind === "coexpression" && v.coexpression && v.coexpression.length) return coexpressionSvg(v, o);
  if (v.kind === "clinical" && v.clinical && v.clinical.some((r) => !r.skipped)) return clinicalSvg(v, o);
  return kindFigure(v, o);
}

/** A one-line title for a figure, for alt text and chat captions. */
export function viewTitle(v: ViewResult): string {
  const c = (v.cohorts || []).join(" vs ");
  const base = v.kind === "survival" ? (v.endpoint || "OS") + " survival" + (v.anchoredTo ? " from " + v.anchoredTo : "")
    : v.kind === "cox" ? "Cox regression — " + (v.endpoint || "OS")
    : v.kind === "logistic" ? "Logistic regression"
    : v.kind === "hotspots" ? "Recurrent protein changes"
    : v.kind === "cooccurrence" ? "Co-occurrence and mutual exclusivity"
    : v.kind === "coexpression" ? "Co-expression"
    : v.kind === "clinical" ? "Clinical comparison"
    : v.kind === "sequence" ? "Treatment sequence" +
        (v.sequence ? " by " + v.sequence.labelKey : "")
    : v.kind === "course" ? "Clinical course" +
        (v.course && v.course.length ? " — " + [...new Set(v.course.map((z) => z.eventType))].join(", ") : "")
    : v.kind === "compare" ? "Alteration frequencies"
    : v.kind === "oncoprint" ? "Oncoprint"
    : v.kind === "timeline" ? "Patient timeline" + (v.timeline?.patient ? " — " + v.timeline.patient.patient : "")
    : v.kind === "alterations" ? "Patient alterations" + (v.alterations?.patient ? " — " + v.alterations.patient.id : "")
    : kindTitle(v) || v.kind;
  return c ? base + " — " + c : base;
}
