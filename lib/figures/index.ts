// Figures for the view kinds drawn outside lib/view-svg.ts, one module each, by kind. Same contract
// and the same two rules as lib/view-svg.ts (every label escaped, uniform scaling), drawn through the
// same frame, palette and caption (lib/svg-kit.ts), so a figure here cannot drift from the others.
import { isDrawn, type ViewResult, type ViewResultOf, type DrawnResultOf, type ViewKind } from "../types.ts";
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
import { compositionSvg } from "./composition.ts";
import { correlatesSvg } from "./correlates.ts";
import { acquiredSvg } from "./acquired.ts";
import { ctdnaSvg } from "./ctdna.ts";
import { exclusivitySvg } from "./exclusivity.ts";
import { txendpointsSvg } from "./txendpoints.ts";
import { multistateSvg } from "./multistate.ts";
import { rmstSvg } from "./rmst.ts";
import { predictiveSvg } from "./predictive.ts";
import { cutpointSvg } from "./cutpoint.ts";
import { hlaSvg } from "./hla.ts";
import { metaForestSvg } from "./forest.ts";
import { adjustedSvg } from "./adjusted.ts";
import { instabilitySvg } from "./instability.ts";
import { actionabilitySvg } from "./actionability.ts";
import { drivernegativeSvg } from "./drivernegative.ts";
import { organotropismSvg } from "./organotropism.ts";
import { molsubtypeSvg } from "./molsubtype.ts";
import { germlineSvg } from "./germline.ts";

/** a kind's figure, drawn only when its result has something to draw, and its one-line title */
interface Figure<K extends ViewKind> { draw(v: DrawnResultOf<K>, o: SvgOpts): string | null; title(v: ViewResultOf<K>): string }

/** each entry is given only its own kind's result */
const FIGURES: { [K in ViewKind]?: Figure<K> } = {
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
  composition: {
    draw: (v, o) => v.composition && v.composition.groups.some((g) => g.n > 0) ? compositionSvg(v, o) : null,
    title: (v) => "Composition" + (v.composition ? " — " + v.composition.sourceName : "")
  },
  forest: {
    draw: (v, o) => v.forest.rows.length ? metaForestSvg(v, o) : null,
    title: (v) => "Forest plot" + (v.forest ? " — " + v.forest.exposedLabel + " by " + v.forest.strata + ", " + v.forest.endpoint : "")
  },
  adjusted: {
    draw: (v, o) => v.adjusted.rows.length ? adjustedSvg(v, o) : null,
    title: (v) => "Adjusted enrichment" + (v.adjusted ? " — " + v.adjusted.groups.join(" vs ") + (v.adjusted.covariates.length ? ", adjusted for " + v.adjusted.covariates.join(", ") : "") : "")
  },
  actionability: {
    draw: (v, o) => v.actionability.panels.some((pn) => pn.sequenced) ? actionabilitySvg(v, o) : null,
    title: (v) => "Clinical actionability" + (v.actionability ? " — OncoKB " + v.actionability.pin + (v.actionability.groupBy ? " by " + v.actionability.groupBy : "") : "")
  },
  drivernegative: {
    draw: (v, o) => v.drivernegative.sequenced ? drivernegativeSvg(v, o) : null,
    title: (v) => "Driver-negative analysis" + (v.drivernegative ? " — " + v.drivernegative.alteration + ", driver-negative vs driver-positive" : "")
  },
  organotropism: {
    draw: (v, o) => v.organotropism.sites.length && v.organotropism.genes.length ? organotropismSvg(v, o) : null,
    title: (v) => "Organotropism" + (v.organotropism ? " — " + v.organotropism.genes.length + " genes × " + v.organotropism.sites.length + " sites, " + v.organotropism.source : "")
  },
  molsubtype: {
    draw: (v, o) => v.molsubtype.panels.some((pn) => pn.classified) ? molsubtypeSvg(v, o) : null,
    title: (v) => "Molecular subtypes" + (v.molsubtype ? " — " + v.molsubtype.classifier + (v.molsubtype.by ? " by " + v.molsubtype.by : "") : "")
  },
  germline: {
    draw: (v, o) => v.germline.panels.some((pn) => pn.genes.some((g) => g.sequenced)) ? germlineSvg(v, o) : null,
    title: (v) => "Germline carriers and second hits" + (v.germline ? " — " + v.germline.genes.length + " genes" : "")
  },
  correlates: {
    draw: (v, o) => v.correlates && v.correlates.tested > 0 ? correlatesSvg(v, o) : null,
    title: (v) => "Co-expression" + (v.correlates ? " — " + v.correlates.gene + " against every gene" : "")
  },
  acquired: {
    draw: (v, o) => v.acquired && v.acquired.panels.some((pn) => pn.patients && pn.genes.length) ? acquiredSvg(v, o) : null,
    title: (v) => "Acquired under therapy" + (v.acquired ? " — samples before and after " + v.acquired.anchoredTo : "")
  },
  ctdna: {
    draw: (v, o) => v.ctdna && v.ctdna.panels.some((pn) => pn.patients) ? ctdnaSvg(v, o) : null,
    title: () => "ctDNA vs tissue"
  },
  exclusivity: {
    draw: (v, o) => v.exclusivity && v.exclusivity.pairs.length ? exclusivitySvg(v, o) : null,
    title: (v) => "Mutual exclusivity (DISCOVER)" + (v.exclusivity ? " — " + v.exclusivity.cohort : "")
  },
  hla: {
    draw: (v, o) => v.hla.panels.some((pn) => pn.typed || pn.lohEvaluated) ? hlaSvg(v, o) : null,
    title: (v) => "HLA class I genotype and " + (v.hla ? v.hla.endpoint : "OS")
  },
  cutpoint: {
    draw: (v, o) => v.cutpoint.candidates.length ? cutpointSvg(v, o) : null,
    title: (v) => "Cut-point" + (v.cutpoint ? " — " + v.cutpoint.attribute + " on " + v.cutpoint.endpoint : "")
  },
  predictive: {
    draw: (v, o) => v.predictive.genes.length ? predictiveSvg(v, o) : null,
    title: (v) => "Predictive biomarkers" + (v.predictive ? " — gene × " + v.predictive.exposure : "")
  },
  rmst: {
    draw: (v, o) => v.rmst.panels.some((pn) => pn.curves.some((c) => c.n)) ? rmstSvg(v, o) : null,
    title: (v) => "Restricted mean survival time" + (v.rmst ? " — " + v.rmst.endpointLabel : "")
  },
  multistate: {
    draw: (v, o) => v.multistate.cohorts.some((c) => c.n) ? multistateSvg(v, o) : null,
    title: () => "Multistate model — progression and death"
  },
  txendpoints: {
    draw: (v, o) => v.txendpoints.curves.some((c) => c.n) ? txendpointsSvg(v, o) : null,
    title: (v) => "Treatment endpoints" + (v.txendpoints ? " — " + v.txendpoints.endpointLabel + " from " + v.txendpoints.anchoredTo : "")
  },
  instability: {
    draw: (v, o) => v.instability && v.instability.panels.some((pn) => pn.score.some((n) => n > 0)) ? instabilitySvg(v, o) : null,
    title: () => "Genomic instability — aneuploidy score and FGA"
  },
};

/** the figure for a view of one of these kinds, or null (another kind, or nothing to draw) */
export function kindFigure(v: ViewResult, o: SvgOpts): string | null {
  return isDrawn(v) ? figureOf(v)?.draw(v, o) ?? null : null;
}

/** the one-line title for a view of one of these kinds, or null */
export function kindTitle(v: ViewResult): string | null {
  return figureOf(v)?.title(v) ?? null;
}

/** FIGURES' entry for v's kind: keyed by that kind, so it takes v (TypeScript cannot follow the key) */
function figureOf(v: ViewResult): { draw(v: ViewResult, o: SvgOpts): string | null; title(v: ViewResult): string } | undefined {
  return Object.hasOwn(FIGURES, v.kind) ? FIGURES[v.kind] as unknown as ReturnType<typeof figureOf> : undefined;
}
