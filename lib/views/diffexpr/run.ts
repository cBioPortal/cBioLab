// Differential expression view: every gene tested between cohorts — two as a volcano with preranked
// GSEA of the same ranking, more by Welch's ANOVA
import type { ViewResult, ViewResultOf } from "../../types.ts";
import { benjaminiHochberg, varianceFromMoments, welchT, welchAnovaTest, preRankedGsea } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, niceCeil, askEachSite, cytobands } from "../shared.ts";
import type { DiffexprView, DiffexprGene } from "./types.ts";
import { profileMomentsAllSql, genesetMembersSql } from "./sql.ts";
import { diffexprMethod } from "./method.ts";

const DE_MIN_N = 3, DE_POINT_CAP = 1500, DE_PERMUTATIONS = 1000, DE_MAX_COHORTS = 10;
const SET_NAME = /^[A-Z0-9_]{3,120}$/;
const GENE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,39}$/;

/** RNA-seq counts/RSEM/TPM are compared on log2(v + 1); z-scores, protein and methylation as stored. */
export function defaultLog2(profileType: string): boolean {
  return /rna_seq|rnaseq|tpm|fpkm|rsem/i.test(profileType) && !/zscore|log/i.test(profileType);
}

export async function runDiffexpr(view: DiffexprView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length < 2 || vNames.length > DE_MAX_COHORTS)
    return refuse("diffexpr", ctx, "a diffexpr view compares 2 to " + DE_MAX_COHORTS + " cohorts; this one draws " + vNames.length +
      (vNames.length > DE_MAX_COHORTS ? " — name at most " + DE_MAX_COHORTS + " in its cohorts" : " — add a second cohort to compare against"));
  const two = vNames.length === 2;
  const profileType = String(view.profileType || "").trim();
  if (!profileType) return refuse("diffexpr", ctx, "a diffexpr view needs profileType, the molecular profile to compare on");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("diffexpr", ctx, "label is 0 to 40 genes; got " + String(view.label).slice(0, 20));
  const setNames = view.geneSets == null ? null : view.geneSets.map((x) => String(x).trim().toUpperCase());
  if (setNames && setNames.length && !two)
    return refuse("diffexpr", ctx, "gene-set enrichment ranks genes by Welch's t between two cohorts, and this view compares " + vNames.length + " — set geneSets to [] or compare two");
  if (setNames) {
    const e = overLimit("a diffexpr view", 12, setNames.length);
    if (e) return refuse("diffexpr", ctx, e.replace("at most 12", "at most 12 gene sets"));
    const bad = setNames.filter((x) => !SET_NAME.test(x));
    if (bad.length) return refuse("diffexpr", ctx, "not an MSigDB set name: " + bad.slice(0, 3).join(", "));
  }
  const gene = view.gene == null ? null : String(view.gene).trim();
  if (gene != null && !GENE.test(gene)) return refuse("diffexpr", ctx, "gene is one gene symbol, like \"ESR1\"; got " + JSON.stringify(String(view.gene).slice(0, 40)));
  const log2 = view.log2 == null ? defaultLog2(profileType) : view.log2 === true;
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("diffexpr", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") +
    (empty.length === 1 ? " is" : " are") + " empty — check its definition; the profile is not the problem");

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("diffexpr", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  // the profile must exist wherever a cohort has patients — named, with what IS there, if not
  const missing: string[] = [];
  const offered = new Set<string>();
  let info: { name: string; type: string } | undefined;
  for (const st of Object.keys(ok)) {
    if (!vNames.some((n) => (cohorts[n].perStudy[st]?.count || 0) > 0)) continue;
    const { profiles, catalog } = await ctx.studyProfiles(st);
    profiles.forEach((x) => offered.add(x));
    info = info || catalog?.find((x) => x.profile === profileType);
    if (!profiles.includes(profileType)) missing.push(st);
  }
  if (missing.length)
    return refuse("diffexpr", ctx, (missing.length === 1 ? missing[0] + " has" : missing.join(", ") + " have") + " no " + profileType +
      " profile — available: " + ([...offered].sort().join(", ") || "none"));

  const moments = new Map<string, { n: number; sx: number; sxx: number }>(); // cohort|gene
  const answers = await askEachSite(ctx, ok, (n, _st, r) => r.viewAggregate("diffexpr:moments:" + n, doc.cohorts[n],
    (c, s, d) => profileMomentsAllSql(c, s, d, profileType, log2)));
  for (const { cohort: n, answer: rows } of answers) {
    for (const r of rows) {
      const k = n + "|" + String(r.gene), cur = moments.get(k) || { n: 0, sx: 0, sxx: 0 };
      cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx);
      moments.set(k, cur);
    }
  }
  const [A, B] = vNames;
  const genes = [...new Set([...moments.keys()].map((k) => k.slice(k.indexOf("|") + 1)))];
  const tested: DiffexprGene[] = [];
  let skipped = 0;
  for (const g of genes) {
    const ms = vNames.map((n) => moments.get(n + "|" + g));
    if (ms.some((m) => !m || m.n < DE_MIN_N)) { skipped++; continue; }
    const cs = ms.map((m) => ({ n: m!.n, mean: m!.sx / m!.n, v: varianceFromMoments(m!.n, m!.sx, m!.sxx) }));
    // a constant gene's variance from Σv² − (Σv)²/n is rounding noise, whose sign depends on the
    // order the database happened to sum in — so "no variance" is judged to a relative tolerance,
    // or the same document would test a different number of genes on different runs
    if (!(cs.reduce((a, c) => a + c.v, 0) > 1e-9 * (1 + cs.reduce((a, c) => a + c.mean * c.mean, 0)))) { skipped++; continue; }
    const base = { gene: g, n: cs.map((c) => c.n), mean: cs.map((c) => c.mean), sd: cs.map((c) => Math.sqrt(Math.max(0, c.v))), q: 1 };
    if (two) {
      const [a, b] = cs;
      const w = welchT(a.n, a.mean, a.v, b.n, b.mean, b.v);
      // the ranking uses the unrounded statistic; welchT's rounded one is for display
      const t = (a.mean - b.mean) / Math.sqrt(a.v / a.n + b.v / b.n);
      tested.push({ ...base, effect: a.mean - b.mean, t, p: w.p });
    } else {
      const w = welchAnovaTest(cs.map((c) => ({ n: c.n, mean: c.mean, variance: Math.max(0, c.v) })));
      tested.push({ ...base, f: w.f, p: w.p });
    }
  }
  if (!tested.length)
    return refuse("diffexpr", ctx, "no gene had at least " + DE_MIN_N + " samples with a " + profileType + " value in " + (two ? "both cohorts" : "every cohort") +
      " (cohort sizes " + vNames.map((n) => n + " " + cohorts[n].count).join(", ") + ")");
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  const sig = tested.filter((g) => g.q < 0.05);
  const eff = (g: DiffexprGene) => g.effect ?? 0;
  const up = sig.filter((g) => eff(g) > 0).length, down = sig.length - up;
  const byP = [...tested].sort((x, y) => x.p - y.p || (two ? Math.abs(eff(y)) - Math.abs(eff(x)) : (y.f ?? 0) - (x.f ?? 0)) || (x.gene < y.gene ? -1 : 1));
  // two cohorts: half the labels to each direction, so a lopsided comparison still names both sides
  const upFirst = byP.filter((g) => eff(g) > 0), downFirst = byP.filter((g) => eff(g) <= 0);
  const half = Math.ceil(label / 2);
  const labels = (two ? [...upFirst.slice(0, Math.max(half, label - downFirst.length)), ...downFirst.slice(0, Math.max(label - half, label - upFirst.length))] : byP)
    .slice(0, label).map((g) => g.gene);
  // the most significant genes, whether or not they reach q < 0.05: the volcano's points and the table's rows
  const pointSet = new Set([...labels, ...byP.slice(0, DE_POINT_CAP).map((g) => g.gene)]);
  const points = byP.filter((g) => pointSet.has(g.gene));
  const bands = await cytobands(ok, points.map((g) => g.gene));
  for (const g of points) { const b = bands.get(g.gene); if (b) g.cytoband = b; }
  let grid: NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>["grid"];
  if (two) {
    const yOf = (p: number) => -Math.log10(Math.max(1e-300, p));
    const xMax = niceCeil(Math.max(1e-9, ...tested.map((g) => Math.abs(eff(g)))));
    const yMax = niceCeil(Math.max(1, ...tested.map((g) => yOf(g.p))));
    const nx = 90, ny = 60, cellMap = new Map<string, number>();
    for (const g of tested) {
      if (pointSet.has(g.gene)) continue;
      const bx = Math.min(nx - 1, Math.floor((eff(g) + xMax) / (2 * xMax) * nx));
      const by = Math.min(ny - 1, Math.floor(yOf(g.p) / yMax * ny));
      const cls = g.q < 0.05 ? (eff(g) > 0 ? 1 : 2) : 0;
      const k = bx + "," + by + "," + cls;
      cellMap.set(k, (cellMap.get(k) || 0) + 1);
    }
    grid = { xMax, yMax, nx, ny, cells: [...cellMap].map(([k, c]) => {
      const [x, y, cls] = k.split(",").map(Number);
      return [x, y, c, cls as 0 | 1 | 2] as [number, number, number, 0 | 1 | 2];
    }) };
  }

  // enrichment: rank by t, best (higher in the first cohort) first
  let gsea: NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>["gsea"];
  let gseaSets: { name: string; genes: string[] }[] | undefined;
  if (two && (!setNames || setNames.length)) {
    const meta = ok[Object.keys(ok)[0]];
    const rows = await meta.viewMeta("diffexpr:genesets", (_s, d) => genesetMembersSql(setNames || [], setNames ? null : "HALLMARK_", d));
    const found = rows.map((r) => ({ name: String(r.set_name), genes: (r.genes as unknown as string[]).map(String) }));
    gseaSets = found;
    const absent = (setNames || []).filter((x) => !found.some((f) => f.name === x));
    if (absent.length) return refuse("diffexpr", ctx, "no MSigDB set named " + absent.slice(0, 3).join(", ") + " in this warehouse" +
      " (it holds the collections as named in MSigDB, e.g. HALLMARK_E2F_TARGETS, KEGG_…, REACTOME_…)");
    const ranked = [...tested].sort((x, y) => y.t! - x.t!).map((g) => ({ gene: g.gene, score: g.t! }));
    const res = preRankedGsea(ranked, found, { permutations: DE_PERMUTATIONS });
    const qs = benjaminiHochberg(res.map((r) => r.p));
    // many sets reach the permutation floor together, so p alone cannot order them: q, then |NES|
    const sets = res.map((r, i) => ({ ...r, q: qs[i] })).sort((x, y) => x.q - y.q || Math.abs(y.nes) - Math.abs(x.nes));
    gsea = { ranking: "Welch t, " + A + " over " + B, permutations: DE_PERMUTATIONS, sets,
      skipped: found.filter((f) => !res.some((r) => r.name === f.name)).map((f) => f.name) };
  }
  const effectLabel = log2 ? "log2 fold change (difference of mean log2(v+1))"
    : /zscore/i.test(profileType) ? "difference in mean z-score" : "difference in mean value";
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "diffexpr", cohorts: vNames,
    method: diffexprMethod({
      profileType, log2, groups: vNames, minN: DE_MIN_N, tested: tested.length, skipped,
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortSamples: cohorts[n].perStudy[st]?.samples || 0 }))),
      moments: [...moments].map(([k, m]) => ({ cohort: k.slice(0, k.indexOf("|")), gene: k.slice(k.indexOf("|") + 1), n: m.n, sx: m.sx, sxx: m.sxx }))
        .sort((x, y) => vNames.indexOf(x.cohort) - vNames.indexOf(y.cohort) || (x.gene < y.gene ? -1 : x.gene > y.gene ? 1 : 0)),
      ...(gsea && gseaSets ? { gsea: { sets: gseaSets, tested: gsea.sets.length, skipped: gsea.skipped, permutations: DE_PERMUTATIONS, minSize: 10 } } : {}),
      results: { genes: points.map((g) => ({ gene: g.gene, p: g.p, q: g.q })),
        sets: (gsea?.sets || []).map((x) => ({ name: x.name, es: x.es, nes: x.nes, p: x.p })) },
    }),
    diffexpr: { profileType, ...(gene ? { gene } : {}), ...(info ? { profileName: info.name, profileKind: info.type } : {}), log2, effectLabel, groups: vNames,
      test: two ? "Welch's t-test" : "Welch's ANOVA", tested: tested.length, skipped, significant: sig.length, ...(two ? { up, down } : {}),
      points, ...(grid ? { grid } : {}), pooledSignificant: sig.length - points.filter((g) => g.q < 0.05).length,
      labels, ...(gsea ? { gsea } : {}), ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: (two ? "Welch's t-test per gene on " + profileType + (log2 ? " as log2(v + 1)" : " as stored") + ", " + A + " minus " + B +
      ", each sample in the cohort one observation, as the portal's group comparison tests expression"
      : "Welch's ANOVA per gene across the " + vNames.length + " cohorts on " + profileType + (log2 ? " as log2(v + 1)" : " as stored") +
        ", each sample in a cohort one observation; cBioPortal's group comparison uses the classic one-way ANOVA, which assumes every cohort's variance is the same") +
      "; computed from three running totals per gene and cohort, so it is exact across sites. " +
      tested.length.toLocaleString("en-US") + " genes tested" + (skipped ? ", " + skipped.toLocaleString("en-US") + " left out (fewer than " + DE_MIN_N + " samples with a value in a cohort, or no variance)" : "") +
      "; q is Benjamini–Hochberg across every gene tested. " +
      (tested.length > points.length ? "The " + DE_POINT_CAP.toLocaleString("en-US") + " most significant genes are " + (two ? "drawn as points and listed in the table, the rest drawn as density. " : "listed in the table. ") : "") +
      (/zscore/i.test(profileType) ? "Z-scores are standardised within each study, so a difference is in study-specific units. " : "") +
      "A test on thousands of samples finds tiny differences significant — read the " + (two ? "effect" : "means") + ", not only the q. " +
      (gsea ? "Enrichment is preranked GSEA on the unrounded t (Subramanian et al. 2005, weight 1), significance from " + DE_PERMUTATIONS +
        " random sets of the same size drawn from the same ranking, seeded by the set's name so a shared link reproduces it; p = (b+1)/(m+1) over the same-sign nulls, q is Benjamini–Hochberg across the sets tested (not GSEA's own NES-based FDR). " +
        "Gene-set permutation ignores gene–gene correlation, so it is anti-conservative next to phenotype permutation, which needs patient-level values. " : "") +
      (multi ? "Values are pooled across " + ctx.vStudies.length + " studies with no batch correction. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
