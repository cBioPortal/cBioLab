// Every view kind's runner, by kind.
import { plainResult, type ViewResult, type ViewKind } from "../types.ts";
import type { DocView, ViewRun, ViewRunner } from "./run.ts";
import { runCompare } from "./compare.ts";
import { runSurvival } from "./survival.ts";
import { runCox } from "./cox.ts";
import { runLogistic } from "./logistic.ts";
import { runCourse } from "./course.ts";
import { runSequence } from "./sequence.ts";
import { runHotspots } from "./hotspots.ts";
import { runPlot } from "./plot.ts";
import { runCoexpression } from "./coexpression.ts";
import { runClinical } from "./clinical.ts";
import { runCooccurrence } from "./cooccurrence.ts";
import { runOncoprint } from "./oncoprint.ts";
import { runAttrition } from "./attrition.ts";
import { runGenome } from "./genome.ts";
import { runPathways } from "./pathways.ts";
import { runDiffexpr } from "./diffexpr.ts";
import { runPaired } from "./paired.ts";
import { runClonality } from "./clonality.ts";
import { runIncidence } from "./incidence.ts";
import { runLabs } from "./labs.ts";
import { runRiskmodel } from "./riskmodel.ts";
import { runCancertypes } from "./cancertypes.ts";
import { runOverlap } from "./overlap.ts";
import { runEnrichment } from "./enrichment.ts";
import { runAssays } from "./assays.ts";
import { runComposition } from "./composition.ts";
import { runCorrelates } from "./correlates.ts";
import { runTable } from "./table.ts";
import { runMutations } from "./mutations.ts";
import { runAlterations } from "./alterations.ts";
import { runTimeline } from "./timeline.ts";
import { runAcquired } from "./acquired.ts";
import { runCtdna } from "./ctdna.ts";
import { runExclusivity } from "./exclusivity.ts";
import { runTxendpoints } from "./txendpoints.ts";
import { runMultistate } from "./multistate.ts";
import { runRmst } from "./rmst.ts";
import { runPredictive } from "./predictive.ts";
import { runCutpoint } from "./cutpoint.ts";
import { runHla } from "./hla.ts";
import { runForest } from "./forest.ts";
import { runAdjusted } from "./adjusted.ts";
import { runInstability } from "./instability.ts";
import { runActionability } from "./actionability.ts";
import { runDrivernegative } from "./drivernegative.ts";

/**
 * A runner that lets a throw stand for its error: an error is reported as the view's, with its
 * cohorts. Its figure is drawn from the result where it is shown (lib/view-svg.ts).
 */
function drawn<V>(run: (view: V, c: ViewRun) => Promise<ViewResult>): ViewRunner {
  return async (view: DocView, c: ViewRun) => {
    let r: ViewResult;
    try { r = await run(view as V, c); }
    catch (e) { r = plainResult(view.kind, { cohorts: c.vNames, error: (e as Error).message }); }
    return r;
  };
}

/** one runner per kind: a kind added to the View union without a runner is a type error here */
const RUNNERS: Record<ViewKind, ViewRunner> = {
  compare: runCompare,
  survival: runSurvival,
  cox: runCox,
  logistic: runLogistic,
  course: runCourse,
  sequence: runSequence,
  hotspots: runHotspots,
  plot: runPlot,
  coexpression: runCoexpression,
  clinical: runClinical,
  cooccurrence: runCooccurrence,
  oncoprint: runOncoprint,
  attrition: drawn(runAttrition),
  genome: drawn(runGenome),
  pathways: drawn(runPathways),
  diffexpr: drawn(runDiffexpr),
  paired: drawn(runPaired),
  clonality: drawn(runClonality),
  incidence: drawn(runIncidence),
  labs: drawn(runLabs),
  riskmodel: drawn(runRiskmodel),
  cancertypes: drawn(runCancertypes),
  overlap: drawn(runOverlap),
  enrichment: drawn(runEnrichment),
  assays: drawn(runAssays),
  composition: drawn(runComposition),
  correlates: drawn(runCorrelates),
  table: drawn(runTable),
  mutations: drawn(runMutations),
  alterations: drawn(runAlterations),
  timeline: drawn(runTimeline),
  acquired: drawn(runAcquired),
  ctdna: drawn(runCtdna),
  exclusivity: drawn(runExclusivity),
  txendpoints: drawn(runTxendpoints),
  multistate: drawn(runMultistate),
  rmst: drawn(runRmst),
  predictive: drawn(runPredictive),
  cutpoint: drawn(runCutpoint),
  hla: drawn(runHla),
  forest: drawn(runForest),
  adjusted: drawn(runAdjusted),
  instability: drawn(runInstability),
  actionability: drawn(runActionability),
  drivernegative: drawn(runDrivernegative),
};

/** the runner for a view kind, or undefined for a kind runAnalysis does not know */
export function viewRunner(kind: unknown): ViewRunner | undefined {
  const k = String(kind);
  return Object.hasOwn(RUNNERS, k) ? RUNNERS[k as ViewKind] : undefined;
}
