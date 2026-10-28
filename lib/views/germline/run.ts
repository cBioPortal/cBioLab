// Germline view: per gene, the patients carrying a germline variant, the share of the patients
// sequenced for the gene they make up, and how often their tumour has a somatic second hit in the
// same gene (another mutation, or a deep deletion) against the somatic rate in non-carriers.
import type { ViewResult } from "../../types.ts";
import { ascnStudiesSql } from "../../federation-views.ts";
import { fisherExact, benjaminiHochberg, kaplanMeier, logRankK, type SurvRecord } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, plural } from "../shared.ts";
import type { GermlineView, GermlineGene, GermlineCounts } from "./types.ts";
import { germCarriersSql, germCountsSql, germSurvivalSql } from "./sql.ts";

const GERM_MAX_GENES = 60, GERM_COHORT_LIMIT = 4, KM_MIN = 5;

const blank = (): GermlineCounts => ({ sequenced: 0, carriers: 0, outsidePanel: 0, carrierSomatic: 0, carrierCnaProfiled: 0, carrierDeletion: 0, carrierEither: 0,
  noncarriers: 0, noncarrierSomatic: 0, noncarrierCnaProfiled: 0, noncarrierDeletion: 0, noncarrierEither: 0 });

/** One row of germCountsSql added to a gene's counts. Pure. */
export function germAdd(c: GermlineCounts, r: { mp: number; carrier: number; som: number; cp: number; del: number; n: number }) {
  const { n } = r;
  if (!r.mp) { if (r.carrier) c.outsidePanel += n; return; }
  c.sequenced += n;
  const hit = r.som || r.del;
  if (r.carrier) {
    c.carriers += n;
    if (r.som) c.carrierSomatic += n;
    if (r.cp) { c.carrierCnaProfiled += n; if (r.del) c.carrierDeletion += n; }
    if (hit) c.carrierEither += n;
  } else {
    c.noncarriers += n;
    if (r.som) c.noncarrierSomatic += n;
    if (r.cp) { c.noncarrierCnaProfiled += n; if (r.del) c.noncarrierDeletion += n; }
    if (hit) c.noncarrierEither += n;
  }
}

export async function runGermline(view: GermlineView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const no = (e: string) => refuse("germline", ctx, e);
  { const e = overLimit("a germline view", GERM_COHORT_LIMIT, vNames.length); if (e) return no(e.replace("at most " + GERM_COHORT_LIMIT, "at most " + GERM_COHORT_LIMIT + " cohorts")); }
  const minCarriers = view.minCarriers == null ? 3 : Math.floor(Number(view.minCarriers));
  if (!(minCarriers >= 1 && minCarriers <= 10000)) return no("minCarriers is 1 to 10000");
  const asked = Array.isArray(view.genes) && view.genes.length ? [...new Set(view.genes.map((g) => String(g).trim().toUpperCase()).filter(Boolean))] : null;
  if (asked) {
    const e = overLimit("a germline view", GERM_MAX_GENES, asked.length); if (e) return no(e.replace("at most " + GERM_MAX_GENES, "at most " + GERM_MAX_GENES + " genes"));
    const bad = asked.find((g) => !/^[A-Z0-9_.-]{1,40}$/.test(g)); if (bad) return no("'" + bad.slice(0, 40) + "' is not a gene symbol");
  }
  const survGene = view.survival?.gene ? String(view.survival.gene).trim().toUpperCase() : null;
  if (survGene && !/^[A-Z0-9_.-]{1,40}$/.test(survGene)) return no("survival.gene '" + survGene.slice(0, 40) + "' is not a gene symbol");
  if (!vNames.some((n) => cohorts[n].count)) return no("nothing to count: " + (vNames.length === 1 ? "the cohort is" : "every cohort is") + " empty");
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return no("no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));

  // the genes: as given, or every gene with enough carriers in some cohort
  const carriersBy = new Map<string, number>();
  for (const n of vNames) {
    const per = new Map<string, number>();
    for (const st of cohorts[n].studies.filter((s) => ok[s]))
      for (const r of await ok[st].viewAggregate("germline:carriers:" + n, doc.cohorts[n], (c, s, d) => germCarriersSql(c, s, d)))
        per.set(String(r.gene), (per.get(String(r.gene)) || 0) + Number(r.carriers));
    for (const [g, k] of per) carriersBy.set(g, Math.max(carriersBy.get(g) || 0, k));
  }
  if (!carriersBy.size) return no("no patient of " + (vNames.length === 1 ? "“" + vNames[0] + "”" : "these cohorts") + " has a germline call (a mutation with mutation status GERMLINE): the study reports none, or does not mark germline variants");
  let genes: string[];
  if (asked) genes = asked;
  else {
    genes = [...carriersBy].filter(([, k]) => k >= minCarriers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
    if (!genes.length) return no("no gene has " + minCarriers + " or more germline carriers in a cohort; the most are " +
      [...carriersBy].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g, k]) => g + " (" + k + ")").join(", "));
    const e = overLimit("a germline view", GERM_MAX_GENES, genes.length);
    if (e) return no(plural(genes.length, "gene") + " have " + minCarriers + " or more carriers; " + e.replace("at most " + GERM_MAX_GENES, "at most " + GERM_MAX_GENES + " genes") + " — raise minCarriers or name the genes");
  }
  if (survGene && !genes.includes(survGene)) genes = [...genes, survGene];

  const first = Object.values(ok)[0];
  const ascn = new Set((await first.viewMeta("germline:ascn", (s, d) => ascnStudiesSql(s, d)).catch(() => [])).map((r) => String(r.study)));
  const panels: { cohort: string; patients: number; genes: GermlineGene[] }[] = [];
  const survival: NonNullable<import("./types.ts").GermlineResult["survival"]> = [];
  for (const n of vNames) {
    const counts = new Map(genes.map((g) => [g, blank()]));
    const recs: [Map<string, SurvRecord[]>, Map<string, SurvRecord[]>] = [new Map(), new Map()];
    for (const st of cohorts[n].studies.filter((s) => ok[s])) {
      const [rows, surv] = await Promise.all([
        ok[st].viewAggregate("germline:counts:" + n, doc.cohorts[n], (c, s, d) => germCountsSql(c, s, d, genes)),
        survGene ? ok[st].viewAggregate("germline:survival:" + n, doc.cohorts[n], (c, s, d) => germSurvivalSql(c, s, d, survGene)) : Promise.resolve([])]);
      for (const r of rows) {
        const c = counts.get(String(r.gene)); if (!c) continue;
        germAdd(c, { mp: Number(r.mp), carrier: Number(r.carrier), som: Number(r.som), cp: Number(r.cp), del: Number(r.del), n: Number(r.n) });
      }
      for (const r of surv) {
        const side = recs[Number(r.carrier) ? 0 : 1];
        let a = side.get(st); if (!a) side.set(st, a = []);
        for (let j = 0; j < Number(r.n); j++) a.push({ t: Number(r.t), event: Number(r.dead) ? 1 : 0 });
      }
    }
    const rows: GermlineGene[] = genes.map((gene) => {
      const c = counts.get(gene)!;
      const tested = c.carriers > 0 && c.noncarriers > 0;
      return { gene, ...c, p: tested ? fisherExact(c.carrierEither, c.carriers - c.carrierEither, c.noncarrierEither, c.noncarriers - c.noncarrierEither) : null, q: null };
    });
    const t = rows.filter((g) => g.p != null);
    benjaminiHochberg(t.map((g) => g.p!)).forEach((q, i) => { t[i].q = q; });
    rows.sort((a, b) => b.carriers - a.carriers || a.gene.localeCompare(b.gene));
    panels.push({ cohort: n, patients: cohorts[n].count, genes: rows });
    if (survGene) {
      const car = [...recs[0].values()].flat(), non = [...recs[1].values()].flat();
      const curves = [{ group: survGene + " carriers", ...kaplanMeier(car) }, { group: "non-carriers", ...kaplanMeier(non) }];
      let logrank = null, noTest: string | undefined;
      if (car.length < KM_MIN || non.length < KM_MIN) noTest = "fewer than " + KM_MIN + " patients with OS in a group (" + car.length + " carriers, " + non.length + " non-carriers)";
      else {
        const studies = [...new Set([...recs[0].keys(), ...recs[1].keys()])].sort();
        logrank = logRankK(studies.map((st) => ({ groups: [recs[0].get(st) || [], recs[1].get(st) || []] })));
      }
      survival.push({ cohort: n, gene: survGene, curves, logrank, ...(noTest ? { noTest } : {}) });
    }
  }
  const multi = ctx.vStudies.length > 1;
  const withAscn = ctx.vStudies.filter((s) => ascn.has(s));
  const outside = panels.reduce((a, pn) => a + pn.genes.reduce((b, g) => b + g.outsidePanel, 0), 0);
  return {
    kind: "germline", cohorts: vNames,
    germline: { genes, minCarriers, ...(asked ? {} : { chosen: "every gene with ≥ " + minCarriers + " carriers" }), panels,
      ...(survGene ? { survival } : {}), loh: withAscn.length ? "not used; " + withAscn.join(", ") + " has allele-specific copy number (FACETS) the view does not read yet" : "not assessed",
      ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Carriers are patients with a mutation the study marks GERMLINE (mutation status, case-insensitive) in the gene, counted per patient over their samples in the cohort and only among the patients sequenced for the gene (a tumour mutation panel listing it, or whole-exome); " +
      (outside ? plural(outside, "carrier") + " whose tumour panel does not list the gene are left out and counted. " : "none fell outside a panel. ") +
      "A study reports germline variants only for the patients it analysed and consented for it, and the warehouse cannot tell a patient tested and negative from one never tested, so the carrier share is of patients sequenced, not of patients germline-tested: a lower bound where germline testing was partial. " +
      "A somatic second hit in a carrier is another mutation in the same gene that is not germline (any called status but GERMLINE; uncalled and off-panel calls excluded) or a deep deletion (copy number −2, among patients profiled for copy number). " +
      "Loss of heterozygosity — the commonest second hit — needs allele-specific copy number and is " + (withAscn.length ? "not used here (" + withAscn.join(", ") + " has FACETS calls the view does not read yet)" : "not assessed") +
      "; a deep deletion in a carrier is rare, since it removes the germline allele too. So the second-hit rate is a floor. " +
      "Non-carriers' rate is the same somatic definition among the sequenced patients without a germline call; Fisher's exact test of carriers' against non-carriers' rate per gene, Benjamini–Hochberg over the genes of each cohort. " +
      "Germline calls are not pathogenicity-filtered here: whatever the study deposited as germline is counted. " +
      (survGene ? "Overall survival of the patients sequenced for " + survGene + ", carriers against non-carriers, from OS_MONTHS / OS_STATUS (Kaplan–Meier, log-rank" + (multi ? " stratified by study" : "") + "); not corrected for left truncation or for cancer type and stage. " : "") +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
