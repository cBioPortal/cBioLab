// Figures for the view kinds drawn outside lib/view-svg.ts, one module each, by kind. Same contract
// and the same two rules as lib/view-svg.ts (every label escaped, uniform scaling), drawn through the
// same frame, palette and caption (lib/svg-kit.ts), so a figure here cannot drift from the others.
import type { ViewResult } from "../types.ts";
import type { SvgOpts } from "../svg-kit.ts";
import { attritionSvg } from "./attrition.ts";
import { genomeSvg } from "./genome.ts";
import { pathwaysSvg } from "./pathways.ts";
import { diffexprSvg } from "./diffexpr.ts";
import { pairedSvg } from "./paired.ts";
import { clonalitySvg } from "./clonality.ts";
import { incidenceSvg } from "./incidence.ts";
import { labsSvg } from "./labs.ts";
import { riskmodelSvg } from "./riskmodel.ts";
import { cancertypesSvg } from "./cancertypes.ts";
import { overlapSvg } from "./overlap.ts";
import { enrichmentSvg } from "./enrichment.ts";
import { assaysSvg } from "./assays.ts";
import { correlatesSvg } from "./correlates.ts";

/** a kind's figure, drawn only when its result has something to draw, and its one-line title */
interface Figure { draw(v: ViewResult, o: SvgOpts): string | null; title(v: ViewResult): string }

const FIGURES: Record<string, Figure> = {
  attrition: {
    draw: (v, o) => v.attrition && v.attrition.length ? attritionSvg(v, o) : null,
    title: () => "Cohort attrition"
  },
  genome: {
    draw: (v, o) => v.genome && v.genome.series.length ? genomeSvg(v, o) : null,
    title: () => "Genome-wide copy number"
  },
  pathways: {
    draw: (v, o) => v.pathways && v.pathways.rows.length ? pathwaysSvg(v, o) : null,
    title: () => "Oncogenic signalling pathways"
  },
  diffexpr: {
    draw: (v, o) => v.diffexpr && v.diffexpr.tested ? diffexprSvg(v, o) : null,
    title: (v) => "Differential expression" + (v.diffexpr ? " — " + v.diffexpr.profileType : "")
  },
  paired: {
    draw: (v, o) => v.paired && v.paired.panels.some((pn) => pn.patients) ? pairedSvg(v, o) : null,
    title: (v) => "Paired samples" + (v.paired ? " — " + v.paired.labels.a + " vs " + v.paired.labels.b : "")
  },
  clonality: {
    draw: (v, o) => v.clonality && v.clonality.panels.length ? clonalitySvg(v, o) : null,
    title: () => "Clonality (FACETS)"
  },
  incidence: {
    draw: (v, o) => v.incidence && v.incidence.curves.some((c) => c.n) ? incidenceSvg(v, o) : null,
    title: (v) => "Cumulative incidence" + (v.incidence ? " — " + v.incidence.eventLabel + (v.incidence.anchoredTo ? " from " + v.incidence.anchoredTo : "") : "")
  },
  labs: {
    draw: (v, o) => v.labs && v.labs.panels.some((pn) => pn.evaluable) ? labsSvg(v, o) : null,
    title: (v) => "Lab course" + (v.labs ? " — " + v.labs.test + " from " + v.labs.anchoredTo : "")
  },
  riskmodel: {
    draw: (v, o) => v.riskmodel ? riskmodelSvg(v, o) : null,
    title: (v) => "Risk model" + (v.riskmodel ? " — elastic-net Cox, " + v.riskmodel.runs + " runs" : "")
  },
  cancertypes: {
    draw: (v, o) => v.cancertypes && v.cancertypes.panels.some((pn) => pn.profiled) ? cancertypesSvg(v, o) : null,
    title: (v) => "Cancer types summary" + (v.cancertypes ? " — " + v.cancertypes.genes.join(", ") + " by " + v.cancertypes.groupBy : "")
  },
  overlap: {
    draw: (v, o) => v.overlap && v.overlap.union > 0 ? overlapSvg(v, o) : null,
    title: () => "Cohort overlap"
  },
  enrichment: {
    draw: (v, o) => v.enrichment && v.enrichment.tested > 0 ? enrichmentSvg(v, o) : null,
    title: (v) => "Alteration enrichment" + (v.enrichment ? " — " + v.enrichment.alteration : "")
  },
  assays: {
    draw: (v, o) => v.assays && v.assays.tested > 0 ? assaysSvg(v, o) : null,
    title: (v) => "Generic assays" + (v.assays ? " — " + v.assays.profileName : "")
  },
  correlates: {
    draw: (v, o) => v.correlates && v.correlates.tested > 0 ? correlatesSvg(v, o) : null,
    title: (v) => "Co-expression" + (v.correlates ? " — " + v.correlates.gene + " against every gene" : "")
  },
};

/** the figure for a view of one of these kinds, or null (another kind, or nothing to draw) */
export function kindFigure(v: ViewResult, o: SvgOpts): string | null {
  return Object.hasOwn(FIGURES, v.kind) ? FIGURES[v.kind].draw(v, o) : null;
}

/** the one-line title for a view of one of these kinds, or null */
export function kindTitle(v: ViewResult): string | null {
  return Object.hasOwn(FIGURES, v.kind) ? FIGURES[v.kind].title(v) : null;
}
