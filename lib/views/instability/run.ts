// Instability view: fraction of the genome altered, arm-level calls and the aneuploidy score, from segments
import type { ViewResult } from "../../types.ts";
import { genomeCoverageSql, studyGenomeSql } from "../../federation-views.ts";
import { kruskalWallis, mannWhitneyU, quantilesFromHistogram, type Histogram } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, plural, refuse } from "../shared.ts";
import type { InstabilityView, InstabilityPanel, InstabilitySpread } from "./types.ts";
import { instabilityScoresSql, instabilityArmsSql, instabilityArms } from "./sql.ts";

const COHORT_LIMIT = 6;

function spread(counts: number[]): InstabilitySpread {
  const hist: Histogram[] = counts.map((n, v) => ({ v, n })).filter((h) => h.n > 0);
  const N = hist.reduce((s, h) => s + h.n, 0);
  const [p5, q1, median, q3, p95] = quantilesFromHistogram(hist, [0.05, 0.25, 0.5, 0.75, 0.95]);
  return { p5, q1, median, q3, p95, mean: N ? Math.round(1000 * hist.reduce((s, h) => s + h.v * h.n, 0) / N) / 1000 : null };
}

export async function runInstability(view: InstabilityView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  { const e = overLimit("an instability view", COHORT_LIMIT, vNames.length); if (e) return refuse("instability", ctx, e.replace("at most " + COHORT_LIMIT, "at most " + COHORT_LIMIT + " cohorts")); }
  const threshold = view.threshold == null ? 0.2 : Number(view.threshold);
  if (!(Number.isFinite(threshold) && threshold >= 0.05 && threshold <= 2)) return refuse("instability", ctx, "threshold is a |log2 segment mean| from 0.05 to 2; got " + String(view.threshold).slice(0, 20));
  const armShare = view.armShare == null ? 0.5 : Number(view.armShare);
  if (!(Number.isFinite(armShare) && armShare >= 0.25 && armShare <= 0.9)) return refuse("instability", ctx, "armShare is a share of the arm from 0.25 to 0.9; got " + String(view.armShare).slice(0, 20));
  const includeX = view.includeX === true;
  const o = { threshold, armShare, includeX };

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("instability", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // the arm boundaries are hg19 coordinates: another build's segments would be cut in the wrong places
  const builds: Record<string, string> = {};
  await Promise.all(Object.entries(ok).map(async ([st, r]) => {
    const rows = await r.viewMeta("instability:build", studyGenomeSql);
    builds[st] = String(rows[0]?.build || "unknown");
  }));
  const off = Object.entries(builds).filter(([, b]) => b !== "hg19");
  if (off.length)
    return refuse("instability", ctx, "the arm boundaries here are hg19's, so segments on another reference genome cannot be scored: " +
      Object.entries(builds).map(([st, b]) => st + " " + b).join(", ") + (Object.keys(builds).length > off.length ? " — draw the hg19 studies in their own view" : ""));

  const arms = instabilityArms(includeX);
  const nArms = arms.length;
  const panels: InstabilityPanel[] = [];
  const noSegments: string[] = [];
  for (const n of vNames) {
    const score = new Array(nArms + 1).fill(0), fga = new Array(101).fill(0);
    const byArm = new Map(arms.map((a) => [a, { arm: a, measured: 0, gain: 0, loss: 0 }]));
    let samples = 0, segmented = 0, allArms = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [cov, sc, ar] = await Promise.all([
        ok[st].viewAggregate("instability:coverage:" + n, def, genomeCoverageSql),
        ok[st].viewAggregate("instability:scores:" + n, def, (c, s, d) => instabilityScoresSql(c, s, d, o)),
        ok[st].viewAggregate("instability:arms:" + n, def, (c, s, d) => instabilityArmsSql(c, s, d, o))
      ]);
      samples += Number(cov[0]?.samples || 0);
      const segd = Number(cov[0]?.segmented || 0);
      segmented += segd;
      if (!segd && (cohorts[n].perStudy[st]?.count || 0) > 0) noSegments.push(st);
      for (const r of sc) {
        const k = Number(r.n), s = Math.min(nArms, Number(r.score)), f = Math.min(100, Math.max(0, Number(r.fga_bin)));
        score[s] += k; fga[f] += k;
        if (Number(r.measured) >= nArms) allArms += k;
      }
      for (const r of ar) {
        const a = byArm.get(String(r.arm));
        if (!a) continue;
        a.measured += Number(r.n_measured); a.gain += Number(r.n_gain); a.loss += Number(r.n_loss);
      }
    }));
    panels.push({ cohort: n, samples, segmented, allArms, score, fga, scoreSpread: spread(score), fgaSpread: spread(fga), arms: arms.map((a) => byArm.get(a)!) });
  }
  const scored = (pn: InstabilityPanel) => pn.score.reduce((s, x) => s + x, 0);
  if (!panels.some(scored))
    return refuse("instability", ctx, "no sample of " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has copy-number segments" +
      (noSegments.length ? " (" + [...new Set(noSegments)].join(", ") + " has none for these patients)" : ""));
  const drawn = panels.filter(scored);
  const hist = (xs: number[]) => xs.map((c, v) => ({ v, n: c })).filter((h) => h.n > 0);
  let test: { name: "Mann–Whitney U" | "Kruskal–Wallis"; scoreP: number; fgaP: number } | null = null;
  if (drawn.length === 2) test = { name: "Mann–Whitney U", scoreP: mannWhitneyU(hist(drawn[0].score), hist(drawn[1].score)).p, fgaP: mannWhitneyU(hist(drawn[0].fga), hist(drawn[1].fga)).p };
  else if (drawn.length > 2) test = { name: "Kruskal–Wallis", scoreP: kruskalWallis(drawn.map((pn) => hist(pn.score))).p, fgaP: kruskalWallis(drawn.map((pn) => hist(pn.fga))).p };
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "instability", cohorts: vNames,
    instability: { build: "hg19", threshold, armShare, includeX, arms, panels, test, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "From each sample's copy-number segments (hg19; " + (includeX ? "autosomes and X" : "autosomes only — X's log ratio mostly records sex") + "), computed per sample in the database: " +
      "FGA is the share of the sample's segmented length whose |segment mean| is at or past " + threshold + " (log2), counted in 1-point bins; " +
      "an arm (p and q split at hg19's centromeres, from UCSC's cytoBand; the acrocentric p arms of 13, 14, 15, 21 and 22 left out, as Taylor et al. 2018 did) is gained or lost when more than " +
      Math.round(armShare * 100) + "% of its length is past ±" + threshold + ", and the aneuploidy score is how many of the " + nArms + " arms are. " +
      panels.map((pn) => pn.cohort + ": " + plural(scored(pn), "sample") + " scored of " + pn.samples.toLocaleString("en-US") + " (" + pn.segmented.toLocaleString("en-US") + " with segments; " +
        pn.allArms.toLocaleString("en-US") + " with every arm covered)").join("; ") + "; an arm segments cover for less than " + Math.round(armShare * 100) + "% of its length is not called, which lowers that sample's score. " +
      "Boxes are the quartiles, whiskers the 5th and 95th percentiles, read from the histograms" +
      (test ? "; " + test.name + " compares the cohorts' distributions (normal approximation with ties)" : "") + ". " +
      "Every sample of each patient counts. Panel-derived segments are noisy and purity is not corrected — a low-purity tumour's changes sit near 0 and read as stable — so these are relative measures within one assay, not absolute ploidy." +
      (multi ? " Pooled across " + ctx.vStudies.length + " studies, whose segmentations may differ." : "") +
      (noSegments.length ? " No segments for these patients in: " + [...new Set(noSegments)].join(", ") + "." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
