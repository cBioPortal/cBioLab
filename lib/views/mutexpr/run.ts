// Mutation-expression view: one gene's expression per sample, grouped by a gene's protein changes or
// codons, "Not mutated" and "Not profiled" apart, optionally within strata, small groups withheld.
import type { ViewResult } from "../../types.ts";
import { benjaminiHochberg, varianceFromMoments, welchT } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { answering, refuse, askEachSite, PROFILE_NAME, plural } from "../shared.ts";
import type { MutexprView, MutexprScale, MutexprResolution, MutexprStratum, MutexprGroup, MutexprStratumResult, MutexprResult } from "./types.ts";
import { mutexprRangeSql, mutexprGroupsSql, GROUP_MULTIPLE, GROUP_NOT_MUTATED, GROUP_NOT_PROFILED } from "./sql.ts";
import { mutexprMethod, type MutexprTraceGroup } from "./method.ts";

/** bins each group's values are counted in; the quantiles are read off them */
export const MUTEXPR_BINS = 60;
/** the most strata drawn; more is refused, naming the limit */
export const MUTEXPR_STRATA_CAP = 24;
/** the most protein changes (or codons) drawn per stratum; the rest are pooled into one group, and counted */
export const MUTEXPR_GROUP_CAP = 30;
export const MUTEXPR_MIN_COUNT = 5;
const MIN_COUNT_MAX = 1000;
/** the quantiles a box is drawn from */
export const QUANTILES = { p5: 0.05, q1: 0.25, median: 0.5, q3: 0.75, p95: 0.95 } as const;

const GENE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const RESOLUTIONS: MutexprResolution[] = ["protein", "codon"];
const SCALES: MutexprScale[] = ["linear", "log2", "zscore"];
const STRATA: MutexprStratum[] = ["cancerType", "fusion"];
/** the profile types the view reads: expression, mRNA or protein */
const EXPRESSION_TYPES = ["MRNA_EXPRESSION", "PROTEIN_LEVEL"];
const NUMERIC_DATATYPES = ["CONTINUOUS", "Z-SCORE", "LOG2-VALUE", "LOG-VALUE"];

/**
 * The value at probability `prob` of the values counted in `bins` (bin b spans x0 + b·w to
 * x0 + (b + 1)·w), the values of a bin taken as spread evenly across it: the first bin whose running
 * count reaches prob·n, interpolated within it. Exact to one bin's width.
 */
export function binQuantile(bins: number[], x0: number, w: number, prob: number): number {
  const n = bins.reduce((a, b) => a + b, 0);
  const target = prob * n;
  let cum = 0;
  for (let b = 0; b < bins.length; b++) {
    const c = bins[b];
    if (c > 0 && cum + c >= target) return x0 + (b + (target - cum) / c) * w;
    cum += c;
  }
  return x0 + bins.length * w;
}

interface Acc { n: number; sx: number; sxx: number; bins: number[] }
const acc = (B: number): Acc => ({ n: 0, sx: 0, sxx: 0, bins: new Array(B).fill(0) });
function addInto(a: Acc, b: Acc): void {
  a.n += b.n; a.sx += b.sx; a.sxx += b.sxx;
  for (let i = 0; i < a.bins.length; i++) a.bins[i] += b.bins[i];
}

export async function runMutexpr(view: MutexprView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const no = (e: string) => refuse("mutexpr", ctx, e);
  if (vNames.length !== 1) return no("a mutexpr view draws one cohort; this one names " + vNames.length + " — keep one, or add a view per cohort");
  const cn = vNames[0];
  const gene = String(view.gene || "").toUpperCase().trim();
  if (!GENE.test(gene)) return no("a mutexpr view needs `gene`, the gene whose mutations make the groups" + (view.gene ? "; '" + String(view.gene).slice(0, 30) + "' is not a gene symbol" : ""));
  const expressionGene = String(view.expressionGene || gene).toUpperCase().trim();
  if (!GENE.test(expressionGene)) return no("expressionGene: '" + String(view.expressionGene).slice(0, 30) + "' is not a gene symbol");
  const profileType = String(view.profileType || "").trim();
  if (!profileType) return no("a mutexpr view needs `profileType`, the expression profile to read (e.g. rna_seq_v2_mrna or mrna_seq_tpm)");
  if (!PROFILE_NAME.test(profileType)) return no("profileType: '" + profileType.slice(0, 40) + "' is not a profile name");
  const resolution = (view.resolution ?? "protein") as MutexprResolution;
  if (!RESOLUTIONS.includes(resolution)) return no("resolution is \"protein\" or \"codon\"; got " + JSON.stringify(view.resolution).slice(0, 30));
  const stratifyIn = view.stratify ?? [];
  if (!Array.isArray(stratifyIn)) return no("stratify is a list: [], [\"cancerType\"], [\"fusion\"] or both");
  const badStratum = stratifyIn.find((s) => !STRATA.includes(s));
  if (badStratum !== undefined) return no("stratify takes \"cancerType\" and \"fusion\"; got " + JSON.stringify(badStratum).slice(0, 30));
  const stratify = STRATA.filter((s) => stratifyIn.includes(s));
  if (view.fusionGene != null && !stratify.includes("fusion")) return no("fusionGene is read only when stratify includes \"fusion\"");
  const fusionGene = String(view.fusionGene || gene).toUpperCase().trim();
  if (!GENE.test(fusionGene)) return no("fusionGene: '" + String(view.fusionGene).slice(0, 30) + "' is not a gene symbol");
  const minCount = view.minCount == null ? MUTEXPR_MIN_COUNT : Number(view.minCount);
  if (!(Number.isInteger(minCount) && minCount >= 1 && minCount <= MIN_COUNT_MAX)) return no("minCount is a whole number from 1 to " + MIN_COUNT_MAX + "; got " + String(view.minCount).slice(0, 20));
  if (!cohorts[cn].count) return no("cohort “" + cn + "” is empty — check its definition");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return no("no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));

  // the profile must be an expression profile in every study the cohort has samples in, with one datatype
  const studies = cohorts[cn].studies.filter((st) => ok[st] && (cohorts[cn].perStudy[st]?.count || 0) > 0);
  const datatypes = new Set<string>();
  const zOffered = new Set<string>();
  for (const st of studies) {
    const { profiles, catalog } = await ctx.studyProfiles(st);
    const info = (catalog || []).find((p) => p.profile === profileType);
    const offered = (catalog || []).filter((p) => EXPRESSION_TYPES.includes(p.type.toUpperCase()) && NUMERIC_DATATYPES.includes(p.datatype.toUpperCase())).map((p) => p.profile);
    if (!info || !profiles.includes(profileType))
      return no(st + " has no " + profileType + " profile — its expression profiles: " + (offered.sort().join(", ") || "none"));
    if (!EXPRESSION_TYPES.includes(info.type.toUpperCase()) || !NUMERIC_DATATYPES.includes(info.datatype.toUpperCase()))
      return no(profileType + " in " + st + " is " + info.type + " (" + info.datatype + "), not a numeric expression profile — its expression profiles: " + (offered.sort().join(", ") || "none"));
    datatypes.add(info.datatype.toUpperCase());
    for (const p of catalog || []) if (EXPRESSION_TYPES.includes(p.type.toUpperCase()) && p.datatype.toUpperCase() === "Z-SCORE") zOffered.add(p.profile);
  }
  if (datatypes.size > 1) return no(profileType + " is stored as " + [...datatypes].join(" in some studies and ") + " in others; read one kind at a time");
  const datatype = [...datatypes][0] || "CONTINUOUS";
  const zProfile = datatype === "Z-SCORE", logProfile = datatype.startsWith("LOG");
  const scale: MutexprScale = view.scale ?? (zProfile ? "zscore" : logProfile ? "linear" : "log2");
  if (!SCALES.includes(scale)) return no("scale is \"linear\", \"log2\" or \"zscore\"; got " + JSON.stringify(view.scale).slice(0, 30));
  if (scale === "zscore" && !zProfile) return no("scale \"zscore\" reads a z-score profile as stored; " + profileType + " is " + datatype +
    " — name a z-score profile (" + ([...zOffered].sort().join(", ") || "this cohort's studies have none") + "), or use scale \"log2\" or \"linear\"");
  if (zProfile && scale !== "zscore") return no(profileType + " is a z-score profile: its scale is \"zscore\" (a z-score has no log, and \"linear\" would name its unit wrongly)");
  if (logProfile && scale === "log2") return no(profileType + " is already " + datatype + ": take it as stored (scale \"linear\") rather than log it twice");
  const log2 = scale === "log2";
  const exprOpts = { expressionGene, profileType, log2 };

  // first pass: how many samples have a value, and the range every site's bins share
  const ranges = await askEachSite(ctx, ok, (n, st, r) => r.viewAggregate("mutexpr:range:" + n, doc.cohorts[n], (c, s, d) => mutexprRangeSql(c, s, d, exprOpts)));
  let cohortSamples = 0, withValue = 0, negativeDropped = 0, lo = Infinity, hi = -Infinity;
  const perSite: { study: string; cohortSamples: number; withValue: number; negative: number }[] = [];
  for (const { study, answer } of ranges) {
    const row = answer[0] || {};
    const cs = Number(row.cohort_samples || 0), wv = Number(row.with_value || 0), ng = Number(row.negative || 0);
    cohortSamples += cs; withValue += wv; negativeDropped += ng;
    perSite.push({ study, cohortSamples: cs, withValue: wv, negative: ng });
    if (wv > 0) { lo = Math.min(lo, Number(row.lo)); hi = Math.max(hi, Number(row.hi)); }
  }
  if (!withValue) return no("no sample of “" + cn + "” has a " + profileType + " value for " + expressionGene +
    (negativeDropped ? " (" + plural(negativeDropped, "sample") + " left out for a negative value, which has no log2)" : ""));
  if (!(hi > lo)) { lo -= 0.5; hi += 0.5; }
  const B = MUTEXPR_BINS, w = (hi - lo) / B;

  // second pass: per (stratum, group, bin), each site's count and sums
  const groupOpts = { ...exprOpts, gene, resolution, stratify, fusionGene, range: [lo, hi] as [number, number], bins: B };
  const answers = await askEachSite(ctx, ok, (n, st, r) => r.viewAggregate("mutexpr:groups:" + n, doc.cohorts[n], (c, s, d) => mutexprGroupsSql(c, s, d, groupOpts)));
  const strataMap = new Map<string, { label: string; groups: Map<string, Acc> }>();
  for (const { answer } of answers) for (const r of answer) {
    const key = String(r.stratum ?? ""), label = String(r.stratum_label ?? "");
    let s = strataMap.get(key);
    if (!s) strataMap.set(key, s = { label, groups: new Map() });
    else if (label && (!s.label || label < s.label)) s.label = label;
    const g = String(r.grp);
    let a = s.groups.get(g);
    if (!a) s.groups.set(g, a = acc(B));
    const n = Number(r.n), b = Number(r.bin);
    a.n += n; a.sx += Number(r.sx); a.sxx += Number(r.sxx); a.bins[b] += n;
  }

  const allStrata = [...strataMap].map(([key, s]) => ({ key, label: s.label || "All samples", groups: s.groups,
    n: [...s.groups.values()].reduce((t, a) => t + a.n, 0) }))
    .sort((x, y) => y.n - x.n || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
  const shownStrata = allStrata.filter((s) => s.n >= minCount);
  const withheldStrata = allStrata.length - shownStrata.length;
  if (shownStrata.length > MUTEXPR_STRATA_CAP)
    return no("this view would draw " + shownStrata.length + " strata, past the limit of " + MUTEXPR_STRATA_CAP +
      " — narrow the cohort (to fewer cancer types, say), raise minCount, or stratify by less");

  const changeNoun = resolution === "codon" ? "codon" : "protein change";
  const strata: MutexprStratumResult[] = [];
  const trace: MutexprTraceGroup[] = [];
  const tests: { g: MutexprGroup; ref: Acc; a: Acc }[] = [];
  for (const s of shownStrata) {
    const variants = [...s.groups].filter(([k]) => !k.startsWith("#")).map(([label, a]) => ({ label, a }))
      .sort((x, y) => y.a.n - x.a.n || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
    const big = variants.filter((v) => v.a.n >= minCount);
    const drawn = big.slice(0, MUTEXPR_GROUP_CAP);
    const pooledSmall = variants.length - big.length, pooledBeyond = big.length - drawn.length;
    const other = acc(B);
    for (const v of variants) if (!drawn.includes(v)) addInto(other, v.a);
    const all = acc(B);
    for (const v of variants) addInto(all, v.a);
    const multiple = s.groups.get(GROUP_MULTIPLE);
    if (multiple) addInto(all, multiple);
    const ref = s.groups.get(GROUP_NOT_MUTATED);

    const rows: { label: string; role: MutexprGroup["role"]; a: Acc | undefined; pooled?: { small: number; beyondCap: number } }[] = [
      { label: "All mutated", role: "allMutated", a: all },
      ...drawn.map((v) => ({ label: v.label, role: "variant" as const, a: v.a })),
      { label: "Several " + changeNoun + "s", role: "multiple", a: multiple },
      { label: "Other " + changeNoun + "s (" + (pooledSmall + pooledBeyond) + ")", role: "other", a: other, pooled: { small: pooledSmall, beyondCap: pooledBeyond } },
      { label: "Not mutated", role: "notMutated", a: ref },
      { label: "Not profiled", role: "notProfiled", a: s.groups.get(GROUP_NOT_PROFILED) },
    ];
    const groups: MutexprGroup[] = [];
    for (const r of rows) {
      if (!r.a || r.a.n === 0) continue;
      if (r.a.n < minCount) { groups.push({ label: r.label, role: r.role, n: null, ...(r.pooled ? { pooled: r.pooled } : {}) }); continue; }
      const a = r.a, mean = a.sx / a.n;
      const g: MutexprGroup = { label: r.label, role: r.role, n: a.n, ...(r.pooled ? { pooled: r.pooled } : {}), mean,
        ...(a.n >= 2 ? { sd: Math.sqrt(varianceFromMoments(a.n, a.sx, a.sxx)) } : {}),
        p5: binQuantile(a.bins, lo, w, QUANTILES.p5), q1: binQuantile(a.bins, lo, w, QUANTILES.q1), median: binQuantile(a.bins, lo, w, QUANTILES.median),
        q3: binQuantile(a.bins, lo, w, QUANTILES.q3), p95: binQuantile(a.bins, lo, w, QUANTILES.p95) };
      groups.push(g);
      trace.push({ stratum: s.label, group: r.label, role: r.role, n: a.n, sx: a.sx, sxx: a.sxx, bins: a.bins.slice() });
      if (r.role !== "notMutated" && r.role !== "notProfiled" && ref && ref.n >= minCount) tests.push({ g, ref, a });
    }
    const untested = !ref || ref.n === 0 ? "no sample here is profiled and not mutated, so nothing is compared"
      : ref.n < minCount ? "“Not mutated” has fewer than " + minCount + " samples here and is withheld, so nothing is compared" : undefined;
    strata.push({ key: s.key, label: s.label, n: s.n, groups, ...(untested ? { untested } : {}) });
  }

  // each group against "Not mutated" in its own stratum: Welch's t from the moments
  const tested: { g: MutexprGroup; p: number }[] = [];
  for (const { g, ref, a } of tests) {
    if (a.n < 2 || ref.n < 2) continue;
    const va = varianceFromMoments(a.n, a.sx, a.sxx), vr = varianceFromMoments(ref.n, ref.sx, ref.sxx);
    const ma = a.sx / a.n, mr = ref.sx / ref.n;
    if (!(va + vr > 1e-9 * (1 + ma * ma + mr * mr))) continue;
    const wt = welchT(a.n, ma, va, ref.n, mr, vr);
    g.diff = ma - mr; g.t = (ma - mr) / Math.sqrt(va / a.n + vr / ref.n); g.p = wt.p;
    tested.push({ g, p: wt.p });
  }
  benjaminiHochberg(tested.map((x) => x.p)).forEach((q, i) => { tested[i].g.q = q; });

  const valueLabel = expressionGene + " expression — " + (scale === "zscore" ? "z-score (" + profileType + ")"
    : scale === "log2" ? "log2(v + 1) of " + profileType : profileType + " as stored");
  const result: MutexprResult = {
    gene, expressionGene, profileType, scale, resolution, stratify, ...(stratify.includes("fusion") ? { fusionGene } : {}),
    minCount, valueLabel, range: [lo, hi], bins: B, strata, withheldStrata,
    samples: { cohort: cohortSamples, withValue, negativeDropped }, tested: tested.length,
    ...(excluded.length ? { excluded } : {}),
  };
  const withheldGroups = strata.reduce((t, s) => t + s.groups.filter((g) => g.n == null).length, 0);
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "mutexpr", cohorts: [cn], mutexpr: result,
    method: mutexprMethod({
      cohort: cn, gene, expressionGene, profileType, scale, resolution, stratify, fusionGene, minCount,
      range: [lo, hi], bins: B, perSite, groupCap: MUTEXPR_GROUP_CAP, withheldStrata, withheldGroups,
      groups: trace, tested: tested.length,
      results: strata.flatMap((s) => s.groups.filter((g) => g.n != null).map((g) => ({ stratum: s.label, group: g.label, mean: g.mean!, median: g.median!, ...(g.p != null ? { p: g.p, q: g.q! } : {}) }))),
    }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Each sample of “" + cn + "” with a " + profileType + " value for " + expressionGene + " is one observation (" +
      withValue.toLocaleString("en-US") + " of its " + plural(cohortSamples, "sample") + (negativeDropped ? "; " + plural(negativeDropped, "sample") + " left out for a negative value, which has no log2" : "") + "). " +
      "A sample's group is its one " + changeNoun + " of " + gene + (resolution === "codon" ? " (reference residue and first position as written: R175H and R175C are R175)" : "") +
      "; a sample with more than one is “Several”. “Not mutated” is a sample whose panel covers " + gene + " for mutations and has no call; “Not profiled” is one whose panel does not — never counted as wild type. A mutation is a call on the panel (not off-panel). " +
      (stratify.length ? "Groups are formed within each stratum: " + stratify.map((s) => s === "cancerType" ? "the sample's CANCER_TYPE (case and spacing folded; none recorded is its own stratum)" : "whether the sample carries a structural variant of " + fusionGene + " (a sample whose panel does not cover " + fusionGene + " for structural variants is its own “not profiled” stratum)").join(", crossed with ") + ". " : "") +
      "minCount " + minCount + ": a " + changeNoun + " with fewer samples is pooled into “Other”, beyond the " + MUTEXPR_GROUP_CAP + " largest too; any group or stratum still under " + minCount + " is withheld — its size is shown as “< " + minCount + "” and no statistic is reported" +
      (withheldGroups || withheldStrata ? " (" + [withheldGroups ? plural(withheldGroups, "group") : "", withheldStrata ? plural(withheldStrata, "stratum", "strata") : ""].filter(Boolean).join(" and ") + " here)" : "") +
      ". This is a display rule, not formal disclosure control: a withheld count can sometimes be recovered from the totals. " +
      "Means and SDs are exact; the box's quartiles and its 5th–95th percentile whiskers are read off " + B + " bins spanning the cohort's middle 99% of values (values beyond it count in the end bins): each lies within one bin (" + (+w.toPrecision(3)) + ") of the smallest value with that share of the group at or below it, which in a small group can differ from an averaged median. " +
      "Each group is compared with “Not mutated” in its stratum by Welch's t-test from per-group sums, exact across sites; q is Benjamini–Hochberg across the " + plural(tested.length, "comparison") + ". “All mutated” overlaps the groups below it. " +
      (scale === "zscore" ? "Z-scores are standardised within each study, so a difference is in study-specific units. " : "") +
      (multi ? "Values are pooled across " + ctx.vStudies.length + " studies with no batch correction. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : ""),
  };
}
