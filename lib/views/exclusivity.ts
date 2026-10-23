// Exclusivity view: mutual exclusivity and co-occurrence against each tumour's alteration burden
// (DISCOVER, Canisius, Martens & Wessels, Genome Biology 2016)
import type { ViewResult, ExclusivityView, ExclusivityPair, ExclusivityResult } from "../types.ts";
import { exclusivityGroupsSql, exclusivityColumnsSql, exclusivityCoverageSql } from "../federation-views.ts";
import { benjaminiHochberg, fisherExact, log2OddsRatio, poissonBinomialTails } from "../stats.ts";
import { geneSymbols } from "../gene-tracks.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, plural, refuse, ATTR_NAME } from "./shared.ts";

const GENES_MAX = 20;
const FIT_TOL = 1e-4, FIT_MAX_ITER = 300;

/** σ(a + b), where a row or gene that is never altered (−∞) wins over one always altered (+∞) */
const prob = (a: number, b: number) => a === -Infinity || b === -Infinity ? 0 : a === Infinity || b === Infinity ? 1 : 1 / (1 + Math.exp(-(a + b)));
const logit = (p: number) => Math.log(p / (1 - p));

/** one background row: the samples sharing a panel signature and a burden (they share one row parameter) */
export interface BgRow { sig: string; r: number; n: number }
export interface BgFit { a: number[]; b: Map<string, number>; iterations: number; converged: boolean; maxResidual: number }

/**
 * DISCOVER's background: p_ij = σ(a_i + b_j) over the genes each sample's panels cover, with a_i
 * and b_j chosen so that every sample's expected number of altered genes is its observed burden
 * and every gene's expected number of altered samples its observed count (the maximum-likelihood
 * logistic model with row and column effects). Fitted by alternating one-dimensional Newton
 * steps on rows and columns until the largest residual, relative to its target, is below FIT_TOL.
 * A row altered in none (or all) of its genes, or a gene altered in none (or all) of its samples,
 * sits at −∞ (+∞): its probabilities are exactly 0 (1).
 */
export function fitBackground(rows: BgRow[], cols: Map<string, number>, cover: Map<string, Set<string>>): BgFit {
  const genes = [...cols.keys()].filter((g) => (cols.get(g) || 0) > 0);
  const gi = new Map(genes.map((g, i) => [g, i]));
  const rowGenes = rows.map((r) => [...(cover.get(r.sig) || [])].map((g) => gi.get(g)).filter((x): x is number => x != null));
  const colRows: number[][] = genes.map(() => []);
  rowGenes.forEach((js, i) => { for (const j of js) colRows[j].push(i); });
  const c = genes.map((g) => cols.get(g) || 0);
  const N = colRows.map((is) => is.reduce((s, i) => s + rows[i].n, 0));
  const a = rows.map((r, i) => r.r <= 0 ? -Infinity : r.r >= rowGenes[i].length ? Infinity : logit(r.r / rowGenes[i].length));
  const b = genes.map((_, j) => c[j] >= N[j] ? Infinity : logit(Math.min(0.999, c[j] / Math.max(1, N[j]))));
  let iterations = 0, maxResidual = Infinity;
  const newton = (x: number, terms: (at: number) => [number, number], target: number) => {
    for (let k = 0; k < 4; k++) {
      const [f, d] = terms(x);
      if (!(d > 1e-12)) break;
      const step = Math.max(-5, Math.min(5, (f - target) / d));
      x -= step;
      if (Math.abs(step) < 1e-10) break;
    }
    return x;
  };
  while (iterations < FIT_MAX_ITER && maxResidual > FIT_TOL) {
    iterations++;
    for (let j = 0; j < genes.length; j++) {
      if (!Number.isFinite(b[j])) continue;
      b[j] = newton(b[j], (bj) => {
        let f = 0, d = 0;
        for (const i of colRows[j]) { const s = prob(a[i], bj); f += rows[i].n * s; d += rows[i].n * s * (1 - s); }
        return [f, d];
      }, c[j]);
    }
    for (let i = 0; i < rows.length; i++) {
      if (!Number.isFinite(a[i])) continue;
      a[i] = newton(a[i], (ai) => {
        let f = 0, d = 0;
        for (const j of rowGenes[i]) { const s = prob(ai, b[j]); f += s; d += s * (1 - s); }
        return [f, d];
      }, rows[i].r);
    }
    maxResidual = 0;
    for (let j = 0; j < genes.length; j++) {
      let f = 0;
      for (const i of colRows[j]) f += rows[i].n * prob(a[i], b[j]);
      maxResidual = Math.max(maxResidual, Math.abs(f - c[j]) / Math.max(1, c[j]));
    }
    for (let i = 0; i < rows.length; i++) {
      let f = 0;
      for (const j of rowGenes[i]) f += prob(a[i], b[j]);
      maxResidual = Math.max(maxResidual, Math.abs(f - rows[i].r) / Math.max(1, rows[i].r));
    }
  }
  return { a, b: new Map(genes.map((g, j) => [g, b[j]])), iterations, converged: maxResidual <= FIT_TOL, maxResidual };
}

interface Group { stratum: string; sig: string; r: number; amask: number; n: number }

export async function runExclusivity(view: ExclusivityView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("exclusivity", ctx, (e as Error).message); }
  { const e = overLimit("an exclusivity view", GENES_MAX, genes.length); if (e) return refuse("exclusivity", ctx, e.replace("at most " + GENES_MAX, "at most " + GENES_MAX + " genes")); }
  if (genes.length < 2) return refuse("exclusivity", ctx, "an exclusivity view needs at least 2 distinct genes");
  if (!vNames.length) return refuse("exclusivity", ctx, "an exclusivity view needs one cohort");
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin)
    return refuse("exclusivity", ctx, "no OncoKB annotation pin is available here, so oncogenic alterations cannot be told apart — use measure: \"any\"");
  const stratifyBy = view.stratifyBy ? String(view.stratifyBy).trim() : null;
  if (stratifyBy && !ATTR_NAME.test(stratifyBy)) return refuse("exclusivity", ctx, "stratifyBy must be a sample attribute name; got " + JSON.stringify(stratifyBy).slice(0, 40));
  const cn = vNames[0];
  const { ok, excluded } = answering(ctx);
  const studies = cohorts[cn].studies.filter((st) => ok[st]);
  if (!studies.length) return refuse("exclusivity", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));

  // each study is its own background: its own panels, its own column sums
  const groups: Group[] = [];
  const colSums = new Map<string, Map<string, number>>();
  const cover = new Map<string, Set<string>>();
  await Promise.all(studies.map(async (st) => {
    const def = doc.cohorts[cn];
    const [g, c, v] = await Promise.all([
      ok[st].viewAggregate("exclusivity:groups:" + cn, def, (s, x, d) => exclusivityGroupsSql(s, x, d, genes, stratifyBy, pin, measure)),
      ok[st].viewAggregate("exclusivity:columns:" + cn, def, (s, x, d) => exclusivityColumnsSql(s, x, d, stratifyBy, pin, measure)),
      ok[st].viewAggregate("exclusivity:coverage:" + cn, def, (s, x, d) => exclusivityCoverageSql(s, x, d))
    ]);
    const key = (stratum: unknown) => st + "\u0000" + String(stratum ?? "");
    for (const r of g) groups.push({ stratum: key(r.stratum), sig: st + "\u0000" + String(r.sig), r: Number(r.r), amask: Number(r.amask), n: Number(r.n) });
    for (const r of c) {
      const m = colSums.get(key(r.stratum)) || new Map<string, number>();
      m.set(String(r.gene), Number(r.n)); colSums.set(key(r.stratum), m);
    }
    for (const r of v) {
      const k = st + "\u0000" + String(r.sig), s = cover.get(k) || new Set<string>();
      s.add(String(r.gene)); cover.set(k, s);
    }
  }));
  const samples = groups.reduce((s, g) => s + g.n, 0);
  if (!samples) return refuse("exclusivity", ctx, "no sample of “" + cn + "” has a gene panel recorded, so nothing is known to be profiled");

  // the background, stratum by stratum; then each group's probability per listed gene
  const strata = [...new Set(groups.map((g) => g.stratum))].sort();
  const probs = new Map<Group, Map<string, number>>();
  let iterations = 0, converged = true, maxResidual = 0;
  const matrixGenes = new Set<string>();
  for (const s of strata) {
    const gs = groups.filter((g) => g.stratum === s);
    const rowsByKey = new Map<string, BgRow>();
    for (const g of gs) {
      const k = g.sig + "\u0000" + g.r, row = rowsByKey.get(k) || { sig: g.sig, r: g.r, n: 0 };
      row.n += g.n; rowsByKey.set(k, row);
    }
    const rows = [...rowsByKey.values()];
    const cols = colSums.get(s) || new Map<string, number>();
    for (const [g, n] of cols) if (n > 0) matrixGenes.add(g);
    const fit = fitBackground(rows, cols, cover);
    iterations = Math.max(iterations, fit.iterations); converged = converged && fit.converged; maxResidual = Math.max(maxResidual, fit.maxResidual);
    const rowIndex = new Map(rows.map((r, i) => [r.sig + "\u0000" + r.r, i]));
    for (const g of gs) {
      const ai = fit.a[rowIndex.get(g.sig + "\u0000" + g.r)!], cov = cover.get(g.sig);
      probs.set(g, new Map(genes.map((x) => [x, cov && cov.has(x) ? prob(ai, fit.b.get(x) ?? -Infinity) : NaN])));
    }
  }

  const pairs: ExclusivityPair[] = [];
  const unassessable: string[] = [];
  let approximated = 0;
  for (let i = 0; i < genes.length; i++) for (let j = i + 1; j < genes.length; j++) {
    const A = genes[i], B = genes[j], bitA = 2 ** i, bitB = 2 ** j;
    let both = 0, onlyA = 0, onlyB = 0, neither = 0;
    const tri = new Map<number, number>();
    for (const g of groups) {
      const pr = probs.get(g)!, pa = pr.get(A)!, pb = pr.get(B)!;
      if (Number.isNaN(pa) || Number.isNaN(pb)) continue;
      const hasA = (g.amask & bitA) !== 0, hasB = (g.amask & bitB) !== 0;
      if (hasA && hasB) both += g.n; else if (hasA) onlyA += g.n; else if (hasB) onlyB += g.n; else neither += g.n;
      const q = pa * pb;
      tri.set(q, (tri.get(q) || 0) + g.n);
    }
    const profiled = both + onlyA + onlyB + neither;
    if (!profiled) { unassessable.push(A + "/" + B); continue; }
    const t = poissonBinomialTails([...tri].map(([p, n]) => ({ n, p })), both);
    if (!t.exact) approximated++;
    pairs.push({ a: A, b: B, profiled, both, expected: Math.round(t.mean * 100) / 100, pExclusive: t.lower, qExclusive: 1, pCooccur: t.upper, qCooccur: 1, exact: t.exact,
      onlyA, onlyB, neither, fisherP: fisherExact(both, onlyA, onlyB, neither), fisherQ: 1, log2Odds: log2OddsRatio(both, onlyA, onlyB, neither) });
  }
  if (!pairs.length) return refuse("exclusivity", ctx, "no pair of these genes was profiled together in any sample of “" + cn + "”");
  benjaminiHochberg(pairs.map((x) => x.pExclusive)).forEach((q, k) => { pairs[k].qExclusive = q; });
  benjaminiHochberg(pairs.map((x) => x.pCooccur)).forEach((q, k) => { pairs[k].qCooccur = q; });
  benjaminiHochberg(pairs.map((x) => x.fisherP)).forEach((q, k) => { pairs[k].fisherQ = q; });
  pairs.sort((x, y) => Math.min(x.qExclusive, x.qCooccur) - Math.min(y.qExclusive, y.qCooccur) || (x.a + x.b < y.a + y.b ? -1 : 1));

  const stratumList = strata.map((s) => ({ name: s.split("\u0000").filter(Boolean).join(" · ") || "all", samples: groups.filter((g) => g.stratum === s).reduce((t, g) => t + g.n, 0) }));
  const multi = studies.length > 1;
  const result: ExclusivityResult = { cohort: cn, genes, stratifyBy, strata: stratumList, measure, samples, matrixGenes: matrixGenes.size, iterations, converged,
    maxResidual, pairs, unassessable, ...(excluded.length ? { excluded } : {}) };
  const what = measure === "driver" ? "OncoKB oncogenic alterations (" + pin + ")" : "any alteration (mutation, amplification or deep deletion, structural variant)";
  const sigExcl = pairs.filter((x) => x.qExclusive < 0.05).length, sigFisherExcl = pairs.filter((x) => x.fisherQ < 0.05 && (x.log2Odds ?? 0) < 0).length;
  return {
    kind: "exclusivity", cohorts: [cn], exclusivity: result,
    participation: ctx.participationFor(studies, false),
    ...(multi ? { studies } : {}),
    caveat: "Within “" + cn + "”" + (vNames.length > 1 ? " (the first cohort in this view: exclusivity describes one cohort)" : "") + ", over its " + plural(samples, "sample") +
      " with a gene panel (every sample of each patient; a sample without a panel record is left out, never read as wild-type), counting " + what + ". " +
      "DISCOVER's background gives each sample and gene a probability of alteration, σ(a_sample + b_gene), fitted so that every sample's expected number of altered genes is its observed burden and every gene's expected number of altered samples its observed count — over the whole altered-gene matrix (" +
      plural(matrixGenes.size, "gene") + ", each sample's own panels: a gene off a sample's panel has no probability there)" +
      (stratifyBy ? ", separately within each " + stratifyBy + " (" + stratumList.length + " strata" + (multi ? ", and each study" : "") + ")" : multi ? ", separately in each of the " + studies.length + " studies" : "") + "; " +
      (converged ? "the fit matched every margin to within " + (FIT_TOL * 100) + "% in " + iterations + " rounds. " : "the fit did NOT converge in " + FIT_MAX_ITER + " rounds (largest margin residual " + (maxResidual * 100).toFixed(2) + "%) — read the p-values with care. ") +
      "For a pair, the number of samples altered in both under independence given those probabilities is Poisson-binomial with p_i = p_iA·p_iB, over the samples profiled for both; exclusivity is its lower tail at the observed count, co-occurrence its upper tail, each Benjamini–Hochberg across the " +
      plural(pairs.length, "pair") + (approximated ? " (" + plural(approximated, "pair") + "' tails from the refined normal approximation, the exact sum being too large)" : ", all exact") + ". " +
      "Beside it, the plain two-sided Fisher test on the same samples, which assumes every tumour is equally likely to carry each alteration — heavily altered tumours then manufacture co-occurrence and lightly altered ones exclusivity: here " +
      sigExcl + " pairs are exclusive at DISCOVER q < 0.05 against " + sigFisherExcl + " by Fisher. " +
      "Exclusivity is a pattern, not a mechanism: synthetic lethality, redundant pathway hits, and subtypes with different drivers (the confounder stratifying removes, when the strata are the right ones) all produce it." +
      (unassessable.length ? " Not assessable (no sample profiled for both): " + unassessable.join(", ") + "." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
