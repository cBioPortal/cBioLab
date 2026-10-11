// Genome view: genome-wide copy-number frequency from segments
import type { ViewResult, GenomeView, GenomeSeries } from "../types.ts";
import { genomeBinsSql, genomeCoverageSql, studyGenomeSql, CHROM_LENGTHS, GENOME_CHROMS } from "../federation-views.ts";
import { fisherExact, benjaminiHochberg } from "../stats.ts";
import { genomeMethod } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, plural, refuse } from "./shared.ts";

const GENOME_COHORT_LIMIT = 4;

export async function runGenome(view: GenomeView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const lim = overLimit("a genome view", GENOME_COHORT_LIMIT, vNames.length);
  if (lim) return refuse("genome", ctx, lim.replace("at most " + GENOME_COHORT_LIMIT, "at most " + GENOME_COHORT_LIMIT + " cohorts"));
  const binMb = view.binMb == null ? 2 : Number(view.binMb);
  if (!Number.isFinite(binMb) || binMb < 1 || binMb > 50)
    return refuse("genome", ctx, "binMb must be a number of megabases from 1 to 50; got " + String(view.binMb).slice(0, 20));
  const threshold = view.threshold == null ? 0.2 : Number(view.threshold);
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 2)
    return refuse("genome", ctx, "threshold is a |log2 segment mean| from 0.05 to 2; got " + String(view.threshold).slice(0, 20));
  const includeX = view.includeX === true;
  const binBp = Math.round(binMb * 1e6);

  const { ok, excluded } = answering(ctx);
  // Bins are genome coordinates, and hg19 and hg38 put the same base in different places, so
  // two builds cannot share one axis: refused, naming which study is on which.
  const builds: Record<string, string> = {};
  await Promise.all(Object.entries(ok).map(async ([st, r]) => {
    const rows = await r.viewMeta("genome:build", studyGenomeSql);
    builds[st] = String(rows[0]?.build || "unknown");
  }));
  const distinct = [...new Set(Object.values(builds))];
  if (distinct.some((b) => b !== "hg19" && b !== "hg38"))
    return refuse("genome", ctx, "no chromosome lengths for reference genome " +
      Object.entries(builds).filter(([, b]) => b !== "hg19" && b !== "hg38").map(([st, b]) => st + " (" + b + ")").join(", "));
  if (distinct.length > 1)
    return refuse("genome", ctx, "these studies are on different reference genomes, so their bins are not the same places: " +
      Object.entries(builds).map(([st, b]) => st + " " + b).join(", ") + " — draw each build in its own view");
  const build = (distinct[0] || "hg19") as "hg19" | "hg38";

  // the shared bin axis
  const chroms = GENOME_CHROMS.filter((c) => includeX || c !== "X");
  const bins: { chrom: string; start: number }[] = [];
  const offset: Record<string, number> = {}, nBins: Record<string, number> = {};
  for (const c of chroms) {
    offset[c] = bins.length;
    nBins[c] = Math.ceil(CHROM_LENGTHS[build][c] / binBp);
    for (let k = 0; k < nBins[c]; k++) bins.push({ chrom: c, start: k * binBp });
  }

  let pastEnd = 0;
  const series: GenomeSeries[] = [];
  const noSegments: string[] = [];
  for (const name of vNames) {
    const ser: GenomeSeries = { cohort: name, samples: 0, segmented: 0,
      profiled: new Array(bins.length).fill(0), gain: new Array(bins.length).fill(0), loss: new Array(bins.length).fill(0) };
    await Promise.all(cohorts[name].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[name];
      const [cov, rows] = await Promise.all([
        ok[st].viewAggregate("genome:coverage:" + name, def, genomeCoverageSql),
        ok[st].viewAggregate("genome:bins:" + name, def, (c, s, d) => genomeBinsSql(c, s, d, { binBp, threshold, includeX }))
      ]);
      ser.samples += Number(cov[0]?.samples || 0);
      const segd = Number(cov[0]?.segmented || 0);
      ser.segmented += segd;
      if (!segd && (cohorts[name].perStudy[st]?.count || 0) > 0) noSegments.push(st);
      for (const row of rows) {
        const c = String(row.chrom), k = Number(row.bin);
        if (!(c in offset)) continue;
        if (k >= nBins[c]) { pastEnd++; continue; }
        const i = offset[c] + k;
        ser.profiled[i] += Number(row.profiled); ser.gain[i] += Number(row.gain); ser.loss[i] += Number(row.loss);
      }
    }));
    series.push(ser);
  }
  for (const st of [...new Set(noSegments)]) excluded.push({ study: st, reason: "no copy-number segments" });
  if (!series.some((s) => s.segmented))
    return refuse("genome", ctx, "no sample in " + (vNames.length === 1 ? "this cohort" : "these cohorts") +
      " has copy-number segments" + (excluded.length ? " (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")" : "") +
      " — segments exist for 311 of the warehouse's studies, not every one");

  let test: { gainQ: (number | null)[]; lossQ: (number | null)[]; significantGain: number; significantLoss: number } | undefined;
  if (series.length === 2) {
    const [A, B] = series;
    const qFor = (which: "gain" | "loss"): (number | null)[] => {
      const idx: number[] = [], ps: number[] = [];
      for (let i = 0; i < bins.length; i++) {
        if (!A.profiled[i] || !B.profiled[i]) continue;
        const a = A[which][i], c = B[which][i];
        idx.push(i); ps.push(fisherExact(a, A.profiled[i] - a, c, B.profiled[i] - c));
      }
      const q: (number | null)[] = new Array(bins.length).fill(null);
      benjaminiHochberg(ps).forEach((v, j) => { q[idx[j]] = v; });
      return q;
    };
    const gainQ = qFor("gain"), lossQ = qFor("loss");
    test = { gainQ, lossQ,
      significantGain: gainQ.filter((q) => q != null && q < 0.05).length,
      significantLoss: lossQ.filter((q) => q != null && q < 0.05).length };
  }

  const segmented = series.reduce((n, s) => n + s.segmented, 0), samples = series.reduce((n, s) => n + s.samples, 0);
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "genome", cohorts: vNames,
    method: genomeMethod({ build, binMb, threshold, includeX, bins: bins.length, pastEnd,
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      cohorts: series.map((x) => ({ name: x.cohort, samples: x.samples, segmented: x.segmented })),
      counts: series.flatMap((x) => bins.flatMap((b, i) => x.profiled[i]
        ? [{ cohort: x.cohort, chrom: b.chrom, bin: i - offset[b.chrom], profiled: x.profiled[i], gain: x.gain[i], loss: x.loss[i] }] : [])),
      results: test ? bins.flatMap((b, i) => test!.gainQ[i] != null ? [{ chrom: b.chrom, bin: i - offset[b.chrom], gainQ: test!.gainQ[i], lossQ: test!.lossQ[i] }] : []) : [] }),
    genome: { build, binMb, threshold, includeX, bins, series, ...(test ? { test } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Share of each cohort's segmented SAMPLES (not patients: a patient with two segmented samples counts twice) " +
      "gained (log2 segment mean ≥ " + threshold + ") or lost (≤ −" + threshold + ") in each " + binMb + " Mb bin, " + build + ". " +
      "Each bin's denominator is the samples whose segmentation covers it; a bin takes the value of the segment over its " +
      "midpoint, so an event narrower than " + binMb + " Mb can be missed — use a smaller binMb to find it. " +
      segmented.toLocaleString("en-US") + " of " + plural(samples, "sample") + " have segments." +
      " Thresholds on a log ratio are not purity- or ploidy-corrected: a low-purity tumour's real loss can sit inside ±" + threshold + "." +
      (includeX ? " Chromosome X is drawn, and in male patients its log ratio can read as a loss against a female reference." : " Chromosome X is not drawn (includeX: true adds it).") +
      (test ? " Per-bin two-sided Fisher tests, Benjamini–Hochberg across bins separately for gains and losses; adjacent bins are not independent, so read a run of significant bins as one region, not many findings." : "") +
      (pastEnd ? " " + plural(pastEnd, "segment bin") + " lay past a chromosome's end and were not drawn." : "") +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
