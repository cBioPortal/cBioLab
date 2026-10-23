// ctDNA view: a patient's plasma (cfDNA) samples against their tissue, gene by gene, and survival by ctDNA detected
import type { ViewResult, CtdnaView, CtdnaPanel, CtdnaGene, LogRank } from "../types.ts";
import { ctdnaCountsSql, ctdnaFunnelSql, ctdnaSurvivalSql, sampleAttributeValuesSql, type CtdnaSides } from "../federation-views.ts";
import { kaplanMeier, logRank, wilsonInterval, type SurvRecord } from "../stats.ts";
import { geneSymbols } from "../gene-tracks.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, plural, refuse, ATTR_NAME } from "./shared.ts";

const TOP_DEFAULT = 15, TOP_MAX = 30, GENES_MAX = 30;
const SAMPLE_EVENTS = ["Sample acquisition", "Sequencing", "Specimen"];
const NAME = /^[A-Za-z0-9_ .\/()+-]{1,120}$/;
/** fewer patients than this in either group and the survival panel is not drawn */
const KM_MIN_GROUP = 5;

const pct = (x: number) => (100 * x).toFixed(1) + "%";

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

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("ctdna", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const panels: CtdnaPanel[] = [];
  for (const n of vNames) {
    const panel: CtdnaPanel = { cohort: n, plasmaPatients: 0, tissuePatients: 0, patients: 0, plasmaSamples: 0, tissueSamples: 0,
      detected: 0, detectedLow: null, detectedHigh: null, genes: [], survival: null };
    const undated = { plasmaPatients: 0, tissuePatients: 0, datedSamples: 0 };
    const tallies = new Map<string, { pairs: number; both: number; tissueOnly: number; plasmaOnly: number }>();
    const surv: { study: string; det: SurvRecord[]; not: SurvRecord[] }[] = [];
    let missingOs = 0;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [fn, rows, os] = await Promise.all([
        ok[st].viewAggregate("ctdna:funnel:" + n, def, (c, s, d) => ctdnaFunnelSql(c, s, d, sides, pin, measure)),
        ok[st].viewAggregate("ctdna:genes:" + n, def, (c, s, d) => ctdnaCountsSql(c, s, d, pick ? null : genes, sides, pin, measure)),
        ok[st].viewAggregate("ctdna:survival:" + n, def, (c, s, d) => ctdnaSurvivalSql(c, s, d, sides, pin, measure))
      ]);
      const f = fn[0] || {};
      panel.plasmaPatients += Number(f.plasma || 0); panel.tissuePatients += Number(f.tissue || 0); panel.patients += Number(f.both || 0);
      panel.plasmaSamples += Number(f.plasma_samples || 0); panel.tissueSamples += Number(f.tissue_samples || 0);
      panel.detected += Number(f.detected || 0);
      undated.plasmaPatients += Number(f.plasma_all || 0); undated.tissuePatients += Number(f.tissue_all || 0); undated.datedSamples += Number(f.dated_samples || 0);
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
    const all: CtdnaGene[] = (pick ? [...tallies.keys()] : genes).map((g) => {
      const t = tallies.get(g) || { pairs: 0, both: 0, tissueOnly: 0, plasmaOnly: 0 };
      const inTissue = t.both + t.tissueOnly, w = wilsonInterval(t.both, inTissue), neither = t.pairs - t.both - t.tissueOnly - t.plasmaOnly;
      return { gene: g, ...t, neither, ppa: inTissue ? t.both / inTissue : null, ppaLow: w ? w.low : null, ppaHigh: w ? w.high : null,
        concordance: t.pairs ? (t.both + neither) / t.pairs : null };
    });
    const altered = (g: CtdnaGene) => g.both + g.tissueOnly + g.plasmaOnly;
    panel.genes = pick ? all.filter((g) => altered(g) > 0).sort((x, y) => altered(y) - altered(x) || (x.gene < y.gene ? -1 : 1)).slice(0, top) : all;
    const det = surv.flatMap((s) => s.det), not = surv.flatMap((s) => s.not);
    if (!surv.length) panel.survivalWhy = "no plasma patient has OS_MONTHS";
    else if (det.length < KM_MIN_GROUP || not.length < KM_MIN_GROUP) panel.survivalWhy = "fewer than " + KM_MIN_GROUP + " patients with OS in a group (" + det.length + " detected, " + not.length + " not)";
    else {
      const lr: LogRank | null = det.length && not.length ? logRank(surv.map((s) => ({ a: s.det, b: s.not }))) : null;
      panel.survival = { curves: [{ label: "ctDNA detected", ...kaplanMeier(det) }, { label: "not detected", ...kaplanMeier(not) }], logrank: lr, missing: missingOs };
    }
    panels.push(panel);
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
    ctdna: { attribute, plasma, tissue, plasmaPanels, withinDays, measure, ...(pick ? { top } : {}), panels, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Plasma is " + plasmaText + ", tissue " + attribute + " = " + tissue.join("/") + ". " +
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
      "Plasma-only calls include clonal haematopoiesis (TP53, DNMT3A, TET2, PPM1D…) when the assay does not subtract white-cell DNA, and tissue-only calls a tumour shedding too little DNA — both are biology of the assay, not error. " +
      "ctDNA detected means " + what + " called in some plasma sample, over every gene the plasma panel covers. " +
      "Survival is OS_MONTHS / OS_STATUS as each study records them, from its own origin, which need not be the plasma draw; when the draw comes after that origin the comparison carries immortal-time bias. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; the log-rank test is stratified by study. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
