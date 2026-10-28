// Overlap view: how the cohorts' samples, and their patients, intersect
import type { ViewResult } from "../../types.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, plural, refuse } from "../shared.ts";
import type { OverlapView } from "./types.ts";
import { overlapCountsSql } from "./sql.ts";
import { overlapMethod } from "./method.ts";

const OVERLAP_COHORT_LIMIT = 6;

export async function runOverlap(_view: OverlapView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length < 2) return refuse("overlap", ctx, "an overlap view needs at least two cohorts to intersect; this one draws " + vNames.length);
  { const e = overLimit("an overlap view", OVERLAP_COHORT_LIMIT, vNames.length); if (e) return refuse("overlap", ctx, e.replace("at most " + OVERLAP_COHORT_LIMIT, "at most " + OVERLAP_COHORT_LIMIT + " cohorts")); }
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("overlap", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // per study, only the cohorts that reach it can hold its samples; their bits are mapped back
  const byMask = new Map<number, number>(), samplesByMask = new Map<number, number>();
  const perSite: { study: string; cohorts: string[]; patients: number }[] = [];
  const sites = Object.keys(ok).map((st) => ({ st, here: vNames.filter((n) => cohorts[n].studies.includes(st)) })).filter((x) => x.here.length);
  const answers = await Promise.all(sites.map(({ st, here }) => ok[st].viewAggregateMany("overlap", here.map((n) => doc.cohorts[n]), overlapCountsSql)));
  sites.forEach(({ st, here }, si) => {
    let patients = 0;
    for (const r of answers[si]) {
      const local = Number(r.mask), n = Number(r.n);
      let global = 0;
      here.forEach((name, i) => { if (local & (1 << i)) global |= 1 << vNames.indexOf(name); });
      byMask.set(global, (byMask.get(global) || 0) + n);
      samplesByMask.set(global, (samplesByMask.get(global) || 0) + Number(r.samples || 0));
      patients += n;
    }
    perSite.push({ study: st, cohorts: here, patients });
  });
  const intersections = [...byMask].filter(([m]) => m > 0)
    .map(([m, n]) => ({ members: vNames.filter((_, i) => m & (1 << i)), n, samples: samplesByMask.get(m) || 0 }))
    .sort((a, b) => b.n - a.n || a.members.length - b.members.length);
  const union = intersections.reduce((a, x) => a + x.n, 0);
  const sets = vNames.map((n) => {
    const mine = intersections.filter((x) => x.members.includes(n));
    return { name: n, size: mine.reduce((a, x) => a + x.n, 0), samples: mine.reduce((a, x) => a + x.samples, 0) };
  });
  const mismatch = sets.filter((s) => s.size !== cohorts[s.name].count && !excluded.some((e) => cohorts[s.name].studies.includes(e.study)));
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "overlap", cohorts: vNames,
    overlap: { sets, intersections, union, ...(excluded.length ? { excluded } : {}) },
    method: overlapMethod({ cohorts: vNames, perSite, union, intersections: intersections.filter((x) => x.n > 0).length }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Patients in exactly the marked cohorts and none of the others, for every combination that has any — computed inside each study's database, which returns one count per combination. " +
      (vNames.length <= 3 ? "A cohort is a set of samples: the samples diagram places each sample by the cohorts that hold it, the patients diagram each patient by the cohorts that hold any of its samples, so a patient can be shared by cohorts that share none of its samples. " : "") +
      plural(union, "patient") + " are in at least one of the " + vNames.length + " cohorts. " +
      (multi ? "A patient in two studies is two patients here: ids are study-qualified, so overlap is only ever found within a study. " : "") +
      (mismatch.length ? "WARNING: " + mismatch.map((s) => s.name).join(", ") + " counted differently here than as a cohort — the definition was evaluated twice and gave two answers. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
