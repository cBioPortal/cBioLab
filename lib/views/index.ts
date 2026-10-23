// Every view kind's runner, by kind.
import { plainResult, type ViewResult, type ViewKind } from "../types.ts";
import type { DocView, ViewRun, ViewRunner } from "./run.ts";
import { runCompare } from "./compare/run.ts";
import { runSurvival } from "./survival/run.ts";
import { runCox } from "./cox/run.ts";
import { runLogistic } from "./logistic/run.ts";
import { runCourse } from "./course/run.ts";
import { runSequence } from "./sequence/run.ts";
import { runHotspots } from "./hotspots/run.ts";
import { runPlot } from "./plot/run.ts";
import { runCoexpression } from "./coexpression/run.ts";
import { runClinical } from "./clinical/run.ts";
import { runCooccurrence } from "./cooccurrence/run.ts";
import { runOncoprint } from "./oncoprint/run.ts";
import { runAttrition } from "./attrition/run.ts";
import { runGenome } from "./genome/run.ts";
import { runPathways } from "./pathways/run.ts";
import { runDiffexpr } from "./diffexpr/run.ts";
import { runPaired } from "./paired/run.ts";
import { runClonality } from "./clonality/run.ts";
import { runIncidence } from "./incidence/run.ts";
import { runLabs } from "./labs/run.ts";
import { runRiskmodel } from "./riskmodel/run.ts";
import { runCancertypes } from "./cancertypes/run.ts";
import { runOverlap } from "./overlap/run.ts";
import { runEnrichment } from "./enrichment/run.ts";
import { runAssays } from "./assays/run.ts";
import { runComposition } from "./composition/run.ts";
import { runCorrelates } from "./correlates/run.ts";
import { runTable } from "./table/run.ts";
import { runMutations } from "./mutations/run.ts";
import { runAlterations } from "./alterations/run.ts";
import { runTimeline } from "./timeline/run.ts";
import { runAcquired } from "./acquired/run.ts";
import { runCtdna } from "./ctdna/run.ts";
import { runExclusivity } from "./exclusivity/run.ts";
import { runTxendpoints } from "./txendpoints/run.ts";
import { runMultistate } from "./multistate/run.ts";
import { runRmst } from "./rmst/run.ts";
import { runPredictive } from "./predictive/run.ts";
import { runCutpoint } from "./cutpoint/run.ts";
import { runHla } from "./hla/run.ts";
import { runForest } from "./forest/run.ts";
import { runAdjusted } from "./adjusted/run.ts";
import { runInstability } from "./instability/run.ts";
import { runActionability } from "./actionability/run.ts";
import { runDrivernegative } from "./drivernegative/run.ts";
import { runOrganotropism } from "./organotropism/run.ts";
import { runMolsubtype } from "./molsubtype/run.ts";
import { runGermline } from "./germline/run.ts";

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
  organotropism: drawn(runOrganotropism),
  molsubtype: drawn(runMolsubtype),
  germline: drawn(runGermline),
};

/** the runner for a view kind, or undefined for a kind runAnalysis does not know */
export function viewRunner(kind: unknown): ViewRunner | undefined {
  const k = String(kind);
  return Object.hasOwn(RUNNERS, k) ? RUNNERS[k as ViewKind] : undefined;
}
