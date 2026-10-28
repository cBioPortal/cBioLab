// ctDNA view: a patient's plasma (cfDNA) samples against their tissue, gene by gene, and survival by ctDNA detected
import type { ViewResult, LogRank } from "../../types.ts";

type CtdnaChGene = CtdnaChPanel["genes"][number];
import { sampleAttributeValuesSql } from "../../federation-views.ts";
import { kaplanMeier, logRank, wilsonInterval, type SurvRecord } from "../../stats.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, plural, refuse, ATTR_NAME } from "../shared.ts";
import type { CtdnaView, CtdnaPanel, CtdnaGene, CtdnaChPanel } from "./types.ts";
import { ctdnaCountsSql, ctdnaFunnelSql, ctdnaSurvivalSql, ctdnaChRemovedSql } from "./sql.ts";
import type { CtdnaSides } from "./sql.ts";

const TOP_DEFAULT = 15, TOP_MAX = 30, GENES_MAX = 30;
const SAMPLE_EVENTS = ["Sample acquisition", "Sequencing", "Specimen"];
const NAME = /^[A-Za-z0-9_ .\/()+-]{1,120}$/;
/** fewer patients than this in either group and the survival panel is not drawn */
const KM_MIN_GROUP = 5;

const pct = (x: number) => (100 * x).toFixed(1) + "%";

/**
 * Genes whose plasma mutation calls the CH filter removes by default: the genes most often mutated
 * in clonal haematopoiesis among the white-cell-matched cfDNA variants of Razavi et al. (Nat Med
 * 2019) and the CH of Bolton et al. (Nat Genet 2020). TP53, ATM and CHEK2 are CH genes too, but
 * also tumour drivers whose plasma calls are often the tumour's own, so they are left in; the
 * matched-normal rule catches their CH calls where a study loads white-cell read counts.
 */
export const CH_GENES = ["DNMT3A", "TET2", "ASXL1", "PPM1D", "JAK2", "SF3B1", "SRSF2", "U2AF1", "CBL", "GNB1", "GNAS", "IDH2"];
/** the matched-normal rule: at least this many alternate reads, at an allele fraction at least this share of the plasma's (tumour DNA reaching the white-cell sample sits far below it) */
const CH_NORMAL_MIN_ALT = 2, CH_NORMAL_MIN_RATIO = 0.3;

export async function runCtdna(view: CtdnaView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = overLimit("a ctdna view", 3, vNames.length); if (e) return refuse("ctdna", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("ctdna", ctx, (e as Error).message); }
  { const e = overLimit("a ctdna view", GENES_MAX, genes.length); if (e) return refuse("ctdna", ctx, e.replace("at most " + GENES_MAX, "at most " + GENES_MAX + " genes")); }
  const pick = !genes.length;
  const top = view.top == null ? TOP_DEFAULT : Math.floor(Number(view.top));
  if (!(top >= 1 && top <= TOP_MAX)) return refuse("ctdna", ctx, "top must be a whole number from 1 to " + TOP_MAX + "; got " + JSON.stringify(view.top));
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin)
    return refuse("ctdna", ctx, "no OncoKB annotation pin is available here, so oncogenic alterations cannot be told apart — use measure: \"any\"");
  const list = (x: string[] | undefined, d: string[]) => (x && x.length ? x : d).map((v) => String(v).trim()).filter(Boolean);
  const attribute = String(view.attribute || "SAMPLE_CLASS").trim();
  if (!ATTR_NAME.test(attribute)) return refuse("ctdna", ctx, "attribute must be a sample attribute name; got " + JSON.stringify(attribute).slice(0, 40));
  const plasma = list(view.plasma, ["cfDNA", "ctDNA"]), tissue = list(view.tissue, ["Tumor"]);
  const plasmaPanels = list(view.plasmaPanels, []);
  const both = plasma.filter((v) => tissue.some((t) => t.toLowerCase() === v.toLowerCase()));
  if (both.length) return refuse("ctdna", ctx, "a value cannot be both plasma and tissue: " + both.join(", "));
  if (plasma.length > 10 || tissue.length > 10 || plasmaPanels.length > 10) return refuse("ctdna", ctx, "plasma, tissue and plasmaPanels take at most 10 values each");
  const withinDays = view.withinDays == null ? null : Number(view.withinDays);
  if (withinDays != null && !(Number.isInteger(withinDays) && withinDays >= 0 && withinDays <= 3650)) return refuse("ctdna", ctx, "withinDays is a whole number of days from 0 to 3650");
  const sampleEvents = list(view.sampleEvents, SAMPLE_EVENTS), sampleKey = String(view.sampleKey || "SAMPLE_ID").trim();
  for (const x of [...plasma, ...tissue, ...plasmaPanels, ...sampleEvents, sampleKey])
    if (!NAME.test(x)) return refuse("ctdna", ctx, "a value, panel or event name has characters it cannot: " + JSON.stringify(x).slice(0, 60));
  const sides: CtdnaSides = { attribute, plasma, tissue, plasmaPanels, withinDays, sampleEvents, sampleKey };
  let ch: NonNullable<CtdnaSides["ch"]> | null = null;
  if (view.chFilter != null && view.chFilter !== false) {
    const f = view.chFilter === true ? {} : view.chFilter;
    if (typeof f !== "object" || Array.isArray(f)) return refuse("ctdna", ctx, "chFilter is true, or {genes?, normal?, normalMinAlt?, normalMinRatio?}");
    let chGenes: string[];
    try { chGenes = f.genes == null ? CH_GENES : geneSymbols(f.genes); } catch (e) { return refuse("ctdna", ctx, "chFilter.genes: " + (e as Error).message); }
    if (chGenes.length > 40) return refuse("ctdna", ctx, "chFilter.genes takes at most 40 genes");
    const minAlt = f.normalMinAlt == null ? CH_NORMAL_MIN_ALT : Number(f.normalMinAlt);
    if (!(Number.isInteger(minAlt) && minAlt >= 1 && minAlt <= 1000)) return refuse("ctdna", ctx, "chFilter.normalMinAlt is a whole number of reads from 1 to 1000");
    const normalMinAlt = f.normal === false ? null : minAlt;
    const normalMinRatio = f.normalMinRatio == null ? CH_NORMAL_MIN_RATIO : Number(f.normalMinRatio);
    if (!(Number.isFinite(normalMinRatio) && normalMinRatio >= 0 && normalMinRatio <= 10)) return refuse("ctdna", ctx, "chFilter.normalMinRatio is a number from 0 to 10");
    if (!chGenes.length && normalMinAlt == null) return refuse("ctdna", ctx, "chFilter with no genes and normal: false removes nothing — give it genes, or the matched-normal rule");
    ch = { genes: chGenes, normalMinAlt, normalMinRatio };
  }

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("ctdna", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  /** each cohort's panel from the sides `sd`; `chosen` fixes the genes in place of the view's own choice */
  const measurePanels = async (sd: CtdnaSides, tag: string, chosen: string[] | null): Promise<CtdnaPanel[]> => {
    const panels: CtdnaPanel[] = [];
    for (const n of vNames) {
      const panel: CtdnaPanel = { cohort: n, plasmaPatients: 0, tissuePatients: 0, patients: 0, plasmaSamples: 0, tissueSamples: 0,
        detected: 0, detectedLow: null, detectedHigh: null, genes: [], survival: null };
      const undated = { plasmaPatients: 0, tissuePatients: 0, datedSamples: 0 };
      const tallies = new Map<string, { pairs: number; both: number; tissueOnly: number; plasmaOnly: number }>();
      const surv: { study: string; det: SurvRecord[]; not: SurvRecord[] }[] = [];
      let missingOs = 0;
      const chc = { calls: 0, withNormal: 0, byGene: 0, byNormal: 0, removed: 0, patients: 0 };
      await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
        const def = doc.cohorts[n];
        const [fn, rows, os] = await Promise.all([
          ok[st].viewAggregate(tag + "funnel:" + n, def, (c, s, d) => ctdnaFunnelSql(c, s, d, sd, pin, measure)),
          ok[st].viewAggregate(tag + "genes:" + n, def, (c, s, d) => ctdnaCountsSql(c, s, d, chosen || (pick ? null : genes), sd, pin, measure)),
          ok[st].viewAggregate(tag + "survival:" + n, def, (c, s, d) => ctdnaSurvivalSql(c, s, d, sd, pin, measure))
        ]);
        const f = fn[0] || {};
        panel.plasmaPatients += Number(f.plasma || 0); panel.tissuePatients += Number(f.tissue || 0); panel.patients += Number(f.both || 0);
        panel.plasmaSamples += Number(f.plasma_samples || 0); panel.tissueSamples += Number(f.tissue_samples || 0);
        panel.detected += Number(f.detected || 0);
        undated.plasmaPatients += Number(f.plasma_all || 0); undated.tissuePatients += Number(f.tissue_all || 0); undated.datedSamples += Number(f.dated_samples || 0);
        if (sd.ch) {
          chc.calls += Number(f.ch_calls || 0); chc.withNormal += Number(f.ch_with_normal || 0); chc.byGene += Number(f.ch_by_gene || 0);
          chc.byNormal += Number(f.ch_by_normal || 0); chc.removed += Number(f.ch_removed || 0); chc.patients += Number(f.ch_patients || 0);
        }
        for (const r of rows) {
          const g = String(r.gene), cur = tallies.get(g) || { pairs: 0, both: 0, tissueOnly: 0, plasmaOnly: 0 };
          cur.pairs += Number(r.pairs); cur.both += Number(r.both); cur.tissueOnly += Number(r.a_only); cur.plasmaOnly += Number(r.b_only);
          tallies.set(g, cur);
        }
        const s = { study: st, det: [] as SurvRecord[], not: [] as SurvRecord[] };
        let withOs = 0;
        for (const r of os) {
          const k = Number(r.n), rec = { t: Number(r.t), event: Number(r.dead) ? 1 : 0 };
          withOs += k;
          for (let i = 0; i < k; i++) (Number(r.detected) ? s.det : s.not).push(rec);
        }
        missingOs += Math.max(0, Number(f.plasma || 0) - withOs);
        if (withOs) surv.push(s);
      }));
      if (withinDays != null) panel.undated = undated;
      const ci = wilsonInterval(panel.detected, panel.plasmaPatients);
      if (ci) { panel.detectedLow = ci.low; panel.detectedHigh = ci.high; }
      const all: CtdnaGene[] = (chosen || (pick ? [...tallies.keys()] : genes)).map((g) => {
        const t = tallies.get(g) || { pairs: 0, both: 0, tissueOnly: 0, plasmaOnly: 0 };
        const inTissue = t.both + t.tissueOnly, w = wilsonInterval(t.both, inTissue), neither = t.pairs - t.both - t.tissueOnly - t.plasmaOnly;
        return { gene: g, ...t, neither, ppa: inTissue ? t.both / inTissue : null, ppaLow: w ? w.low : null, ppaHigh: w ? w.high : null,
          concordance: t.pairs ? (t.both + neither) / t.pairs : null };
      });
      const altered = (g: CtdnaGene) => g.both + g.tissueOnly + g.plasmaOnly;
      panel.genes = pick && !chosen ? all.filter((g) => altered(g) > 0).sort((x, y) => altered(y) - altered(x) || (x.gene < y.gene ? -1 : 1)).slice(0, top) : all;
      const det = surv.flatMap((s) => s.det), not = surv.flatMap((s) => s.not);
      if (!surv.length) panel.survivalWhy = "no plasma patient has OS_MONTHS";
      else if (det.length < KM_MIN_GROUP || not.length < KM_MIN_GROUP) panel.survivalWhy = "fewer than " + KM_MIN_GROUP + " patients with OS in a group (" + det.length + " detected, " + not.length + " not)";
      else {
        const lr: LogRank | null = det.length && not.length ? logRank(surv.map((s) => ({ a: s.det, b: s.not }))) : null;
        panel.survival = { curves: [{ label: "ctDNA detected", ...kaplanMeier(det) }, { label: "not detected", ...kaplanMeier(not) }], logrank: lr, missing: missingOs };
      }
      if (sd.ch) panel.ch = { ...chc, genes: [], before: { detected: 0, detectedLow: null, detectedHigh: null, genes: [], survival: null } };
      panels.push(panel);
    }
    return panels;
  };
  const panels = await measurePanels(ch ? { ...sides, ch } : sides, "ctdna:", null);
  if (ch) {
    const chSides = { ...sides, ch };
    const before = await measurePanels(sides, "ctdna:unfiltered:", [...new Set(panels.flatMap((pn) => pn.genes.map((g) => g.gene)))]);
    for (const [i, pn] of panels.entries()) {
      const b = before[i], c = pn.ch!;
      const removed = new Map<string, CtdnaChGene>();
      await Promise.all(cohorts[pn.cohort].studies.filter((st) => ok[st]).map(async (st) => {
        for (const r of await ok[st].viewAggregate("ctdna:ch-removed:" + pn.cohort, doc.cohorts[pn.cohort], (cs, s, d) => ctdnaChRemovedSql(cs, s, d, chSides))) {
          const g = String(r.gene), cur = removed.get(g) || { gene: g, calls: 0, patients: 0, byGene: 0, byNormal: 0 };
          cur.calls += Number(r.calls); cur.patients += Number(r.patients); cur.byGene += Number(r.gene_calls); cur.byNormal += Number(r.normal_calls);
          removed.set(g, cur);
        }
      }));
      c.genes = [...removed.values()].sort((x, y) => y.calls - x.calls || (x.gene < y.gene ? -1 : 1));
      c.before = {
        detected: b.detected, detectedLow: b.detectedLow, detectedHigh: b.detectedHigh,
        genes: b.genes.map((g) => ({ gene: g.gene, both: g.both, plasmaOnly: g.plasmaOnly, ppa: g.ppa })),
        survival: b.survival ? { curves: b.survival.curves.map((cv) => ({ label: cv.label, n: cv.n, events: cv.events, median: cv.median })), p: b.survival.logrank ? b.survival.logrank.p : null } : null,
      };
    }
  }
  if (!panels.some((pn) => pn.patients)) {
    const st = Object.keys(ok)[0];
    const vals = await ok[st].viewAggregate("ctdna:values", doc.cohorts[vNames[0]], (c, s, d) => sampleAttributeValuesSql(c, s, d, attribute));
    return refuse("ctdna", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has both a plasma sample (" + attribute + " = " + plasma.join("/") +
      (plasmaPanels.length ? ", or panel " + plasmaPanels.join("/") : "") + ") and a tissue sample (" + tissue.join("/") + ")" +
      (withinDays != null ? " dated within " + withinDays + " days of each other — " + panels.map((pn) => pn.cohort + ": " + plural(pn.undated?.plasmaPatients || 0, "patient") +
        " with plasma, " + plural(pn.undated?.tissuePatients || 0, "patient") + " with tissue, " + plural(pn.undated?.datedSamples || 0, "sample") + " dated by " + sampleEvents.join("/")).join("; ") : "") +
      (vals.length ? " — " + attribute + " here takes: " + vals.map((v) => String(v.value) + " (" + Number(v.samples).toLocaleString("en-US") + ")").join(", ")
        : " — " + st + " has no sample attribute " + attribute));
  }
  const multi = ctx.vStudies.length > 1;
  const what = measure === "driver" ? "an OncoKB oncogenic alteration (" + pin + ")" : "any alteration (mutation, amplification or deep deletion, structural variant)";
  const plasmaText = attribute + " = " + plasma.join("/") + (plasmaPanels.length ? " or a sample on " + plasmaPanels.join("/") : "");
  return {
    kind: "ctdna", cohorts: vNames,
    ctdna: { attribute, plasma, tissue, plasmaPanels, withinDays, measure, ...(pick ? { top } : {}), panels, ...(excluded.length ? { excluded } : {}), ...(ch ? { chFilter: ch } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Plasma is " + plasmaText + ", tissue " + attribute + " = " + tissue.join("/") + "; only the cohort's own samples are classed, so a cohort that selects one kind of sample has none of the other to pair. " +
      panels.map((pn) => pn.cohort + ": " + plural(pn.plasmaPatients, "patient") + " with plasma, " + plural(pn.tissuePatients, "patient") + " with tissue, " +
        plural(pn.patients, "patient") + " with both (" + pn.plasmaSamples.toLocaleString("en-US") + " plasma and " + pn.tissueSamples.toLocaleString("en-US") + " tissue samples); ctDNA detected in " +
        pn.detected.toLocaleString("en-US") + " of the plasma patients (" + (pn.plasmaPatients ? pct(pn.detected / pn.plasmaPatients) : "—") + ")").join("; ") + ". " +
      (withinDays != null ? "Only samples the timeline dates (first " + sampleEvents.join("/") + " event naming them in " + sampleKey + ") within " + withinDays + " days of a sample of the other kind are used: " +
        panels.map((pn) => pn.cohort + " — " + plural(pn.undated?.datedSamples || 0, "classed sample") + " dated, of " + plural(pn.undated?.plasmaPatients || 0, "plasma patient") +
          " and " + plural(pn.undated?.tissuePatients || 0, "tissue patient") + " before the rule").join("; ") + ". "
        : "Plasma and tissue are paired by patient whenever they were drawn, not by date — the tumour may have changed between them. ") +
      "Per gene, counting only patients whose plasma AND tissue panels both cover it, " + what + " in both, tissue only, plasma only, or neither; a patient with several samples of a kind is altered there if any is. " +
      "Positive percent agreement is both ÷ altered in tissue (tissue the reference), with a 95% Wilson interval; overall concordance is (both + neither) ÷ pairs. " +
      (pick ? "The genes are the " + top + " most altered in the paired patients, not chosen in advance. " : "") +
      (ch ? chCaveat(ch, panels)
        : "Plasma-only calls include clonal haematopoiesis (TP53, DNMT3A, TET2, PPM1D…) when the assay does not subtract white-cell DNA, and tissue-only calls a tumour shedding too little DNA — both are biology of the assay, not error. ") +
      "ctDNA detected means " + what + " called in some plasma sample, over every gene the plasma panel covers. " +
      "Survival is OS_MONTHS / OS_STATUS as each study records them, from its own origin, which need not be the plasma draw; when the draw comes after that origin the comparison carries immortal-time bias. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; the log-rank test is stratified by study. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}

/** what the CH filter did, cohort by cohort, with the headline numbers before it */
function chCaveat(ch: NonNullable<CtdnaSides["ch"]>, panels: CtdnaPanel[]): string {
  const rule = (ch.genes.length ? "in " + ch.genes.join(", ") : "") + (ch.genes.length && ch.normalMinAlt != null ? ", or " : "") +
    (ch.normalMinAlt != null ? "seen in the matched normal (white-cell) sample — at least " + ch.normalMinAlt + " alternate reads there, at an allele fraction at least " + ch.normalMinRatio + " × the plasma's" : "");
  return "Clonal-haematopoiesis filter: plasma mutation calls " + rule + " are left out of every count below (copy-number and structural calls are kept; tissue calls are never filtered). " +
    panels.map((pn) => {
      const c = pn.ch!;
      return pn.cohort + " — " + plural(c.removed, "plasma mutation call") + " of " + c.calls.toLocaleString("en-US") + " removed (" + c.byGene.toLocaleString("en-US") + " by gene, " +
        c.byNormal.toLocaleString("en-US") + " by the normal), in " + plural(c.patients, "patient") + "; " +
        (ch.normalMinAlt != null ? (c.withNormal < c.calls ? (c.calls - c.withNormal).toLocaleString("en-US") + " calls have no matched-normal counts loaded, so only the gene rule could apply to them; " : "") : "") +
        "ctDNA detected " + pn.detected.toLocaleString("en-US") + " (" + (pn.plasmaPatients ? pct(pn.detected / pn.plasmaPatients) : "—") + ") against " + c.before.detected.toLocaleString("en-US") +
        " (" + (pn.plasmaPatients ? pct(c.before.detected / pn.plasmaPatients) : "—") + ") unfiltered";
    }).join("; ") + ". " +
    "The gene rule also removes a tumour's own calls in those genes (GNAS, IDH2, SF3B1 and others can be tumour drivers); the allele-fraction ratio keeps calls whose normal reads are tumour DNA in the white-cell sample (far below the plasma's fraction), and a CH clone at very low fraction in blood can still pass; TP53, ATM and CHEK2 are not on the default list because they are tumour drivers as often as CH genes (Razavi et al. 2019; Bolton et al. 2020). " +
    "Tissue-only calls remain those of a tumour shedding too little DNA. ";
}
