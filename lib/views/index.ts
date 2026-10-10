// Every view kind with its own runner, by kind.
import type { ViewRunner } from "./run.ts";
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

const RUNNERS: Record<string, ViewRunner> = {
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
};

/** the runner for a view kind, or undefined for a kind runAnalysis hands elsewhere (or does not know) */
export function viewRunner(kind: unknown): ViewRunner | undefined {
  const k = String(kind);
  return Object.hasOwn(RUNNERS, k) ? RUNNERS[k] : undefined;
}
