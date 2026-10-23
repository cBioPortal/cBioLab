// Acquired view: alterations present after a treatment start and absent before it, within patients
import type { ViewResult, AcquiredView, AcquiredPanel, AcquiredGene } from "../types.ts";
import { acquiredCountsSql, acquiredFunnelSql, type AcquiredSides } from "../federation-views.ts";
import { benjaminiHochberg, mcnemarExact } from "../stats.ts";
import { geneSymbols } from "../gene-tracks.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, plural, refuse } from "./shared.ts";

const TOP_DEFAULT = 20, TOP_MAX = 40, GENES_MAX = 30, MIN_POST_DEFAULT = 3, MIN_GAP_DEFAULT = 30;
const SAMPLE_EVENTS = ["Sample acquisition", "Sequencing", "Specimen"];
const EVENT_NAME = /^[A-Za-z0-9_ .\/()+-]{1,120}$/;

export async function runAcquired(view: AcquiredView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = overLimit("an acquired view", 3, vNames.length); if (e) return refuse("acquired", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("acquired", ctx, (e as Error).message); }
  const scan = !genes.length;
  { const e = overLimit("an acquired view", GENES_MAX, genes.length); if (e) return refuse("acquired", ctx, e.replace("at most " + GENES_MAX, "at most " + GENES_MAX + " genes")); }
  const top = view.top == null ? TOP_DEFAULT : Math.floor(Number(view.top));
  if (!(top >= 1 && top <= TOP_MAX)) return refuse("acquired", ctx, "top must be a whole number from 1 to " + TOP_MAX + "; got " + JSON.stringify(view.top));
  const minPost = view.minPost == null ? MIN_POST_DEFAULT : Math.floor(Number(view.minPost));
  if (!(minPost >= 1 && minPost <= 1000)) return refuse("acquired", ctx, "minPost must be a whole number from 1 to 1000; got " + JSON.stringify(view.minPost));
  const minGapDays = view.minGapDays == null ? MIN_GAP_DEFAULT : Number(view.minGapDays);
  if (!(Number.isInteger(minGapDays) && minGapDays >= 0 && minGapDays <= 3650)) return refuse("acquired", ctx, "minGapDays is a whole number of days from 0 to 3650");
  const preWindowDays = view.preWindowDays == null ? null : Number(view.preWindowDays);
  if (preWindowDays != null && !(Number.isInteger(preWindowDays) && preWindowDays >= 0 && preWindowDays <= 36500))
    return refuse("acquired", ctx, "preWindowDays is a whole number of days from 0 to 36500, or omitted for any time before");
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin)
    return refuse("acquired", ctx, "no OncoKB annotation pin is available here, so oncogenic alterations cannot be told apart — use measure: \"any\"");
  const a = view.anchor || { eventType: "Treatment" };
  const anchor = { eventType: String(a.eventType || "").trim(), ...(a.key ? { key: String(a.key).trim(), value: String(a.value ?? "").trim() } : {}) };
  const sampleEvents = (view.sampleEvents && view.sampleEvents.length ? view.sampleEvents : SAMPLE_EVENTS).map((x) => String(x).trim()).filter(Boolean);
  const sampleKey = String(view.sampleKey || "SAMPLE_ID").trim();
  for (const [k, x] of [["anchor.eventType", anchor.eventType], ["anchor.key", anchor.key], ["anchor.value", anchor.value], ["sampleKey", sampleKey],
    ...sampleEvents.map((e) => ["sampleEvents", e])] as [string, string | undefined][])
    if (x != null && !EVENT_NAME.test(x)) return refuse("acquired", ctx, k + " must be a timeline name of letters, digits, spaces and . _ / ( ) + -; got " + JSON.stringify(x).slice(0, 60));
  if (!sampleEvents.length || sampleEvents.length > 6) return refuse("acquired", ctx, "sampleEvents names 1 to 6 timeline event types");
  const sides: AcquiredSides = { anchor, sampleEvents, sampleKey, preWindowDays, minGapDays };

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("acquired", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const panels: AcquiredPanel[] = [];
  for (const n of vNames) {
    const panel: AcquiredPanel = { cohort: n, anchored: 0, dated: 0, withPre: 0, withPost: 0, patients: 0, preDays: null, postDays: null, gapDays: null, genes: [] };
    const tallies = new Map<string, { pairs: number; shared: number; lost: number; acquired: number }>();
    const spacing: { w: number; pre: number; post: number; q1: number; median: number; q3: number }[] = [];
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n];
      const [fn, rows] = await Promise.all([
        ok[st].viewAggregate("acquired:funnel:" + n, def, (c, s, d) => acquiredFunnelSql(c, s, d, sides)),
        ok[st].viewAggregate("acquired:genes:" + n, def, (c, s, d) => acquiredCountsSql(c, s, d, scan ? null : genes, sides, pin, measure))
      ]);
      const f = fn[0] || {};
      panel.anchored += Number(f.anchored || 0); panel.dated += Number(f.dated || 0);
      panel.withPre += Number(f.with_pre || 0); panel.withPost += Number(f.with_post || 0);
      const paired = Number(f.paired || 0);
      panel.patients += paired;
      if (paired) spacing.push({ w: paired, pre: Number(f.pre_median), post: Number(f.post_median), q1: Number(f.gap_q1), median: Number(f.gap_median), q3: Number(f.gap_q3) });
      for (const r of rows) {
        const g = String(r.gene), cur = tallies.get(g) || { pairs: 0, shared: 0, lost: 0, acquired: 0 };
        cur.pairs += Number(r.pairs); cur.shared += Number(r.both); cur.lost += Number(r.a_only); cur.acquired += Number(r.b_only);
        tallies.set(g, cur);
      }
    }));
    // one study: its own medians; several: the pair-weighted mean of each study's, said so in the caveat
    const wsum = spacing.reduce((s, x) => s + x.w, 0);
    const wmean = (k: "pre" | "post" | "q1" | "median" | "q3") => Math.round(spacing.reduce((s, x) => s + x.w * x[k], 0) / wsum);
    if (wsum) { panel.preDays = wmean("pre"); panel.postDays = wmean("post"); panel.gapDays = { q1: wmean("q1"), median: wmean("median"), q3: wmean("q3") }; }
    const all: AcquiredGene[] = (scan ? [...tallies.keys()].sort() : genes).map((g) => {
      const t = tallies.get(g) || { pairs: 0, shared: 0, lost: 0, acquired: 0 };
      return { gene: g, ...t, neither: t.pairs - t.shared - t.lost - t.acquired, p: mcnemarExact(t.lost, t.acquired), q: 1 };
    });
    const tested = scan ? all.filter((g) => g.acquired + g.shared >= minPost) : all.filter((g) => g.acquired + g.lost > 0);
    benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
    if (scan) {
      panel.genes = [...tested].sort((x, y) => x.p - y.p || (y.acquired - y.lost) - (x.acquired - x.lost) ||
        (y.acquired + y.shared) - (x.acquired + x.shared) || (x.gene < y.gene ? -1 : 1)).slice(0, top);
      panel.tested = tested.length;
    } else panel.genes = all;
    panels.push(panel);
  }
  const anchoredTo = anchor.eventType + (anchor.key ? " [" + anchor.key + "=" + anchor.value + "]" : "");
  if (!panels.some((pn) => pn.patients)) {
    const f = panels[0];
    return refuse("acquired", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has a dated sample on or before the first " + anchoredTo +
      " and another at least " + minGapDays + " days after it — " + panels.map((pn) => pn.cohort + ": " + plural(pn.anchored, "patient") + " with that event, " +
        plural(pn.dated, "patient") + " of them with a sample dated by " + sampleEvents.join("/") + " [" + sampleKey + "], " +
        pn.withPre.toLocaleString("en-US") + " with one before, " + pn.withPost.toLocaleString("en-US") + " with one after").join("; ") +
      (f.anchored ? "" : " (check anchor: the event type, key and value as the timeline records them)"));
  }
  const multi = ctx.vStudies.length > 1;
  const what = measure === "driver" ? "an OncoKB oncogenic alteration (" + pin + ")" : "any alteration (mutation, amplification or deep deletion, structural variant)";
  return {
    kind: "acquired", cohorts: vNames,
    acquired: { anchoredTo, preWindowDays, minGapDays, sampleEvents, sampleKey, measure, ...(scan ? { scan: { top, minPost } } : {}), panels,
      ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Patients with a sample dated on or before their first " + anchoredTo + (preWindowDays != null ? " (at most " + preWindowDays + " days before)" : "") +
      " and another at least " + minGapDays + " days after it; each side is one sample — the last before and the first after — dated by its first " +
      sampleEvents.join("/") + " timeline event (attribute " + sampleKey + "). Funnel: " + panels.map((pn) => pn.cohort + " — " + pn.anchored.toLocaleString("en-US") + " started, " +
        pn.withPre.toLocaleString("en-US") + " with a sample before, " + pn.withPost.toLocaleString("en-US") + " with one after, " + plural(pn.patients, "patient") + " with both" +
        (pn.gapDays ? " (median " + pn.preDays + " days before and " + pn.postDays + " after; samples a median " + pn.gapDays.median + " days apart, IQR " + pn.gapDays.q1 + "–" + pn.gapDays.q3 + ")" : "")).join("; ") + ". " +
      "Per gene, counting only patients whose before- AND after-sample panels both cover it: " + what + " after but not before (acquired), before but not after (lost), on both (shared). " +
      "The exact McNemar test asks whether acquired and lost differ; q is Benjamini–Hochberg across the genes tested in each cohort" +
      (scan ? " — every gene altered after treatment in at least " + minPost + " patients (" + panels.map((pn) => pn.cohort + ": " + plural(pn.tested || 0, "gene")).join("; ") + "), the " + top + " smallest p drawn" : "") + ". " +
      "These are few patients, and a second biopsy is clinically indicated — typically taken at progression — so they are a selected group, and \"acquired\" means seen after and not before, not caused by the treatment: " +
      "a subclone the first biopsy missed, a different lesion, or a lower-purity sample under-calling one side reads the same. Which treatment ran between the samples beyond the anchor is not considered." +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies" + (panels.some((pn) => pn.gapDays) ? "; the day medians are pair-weighted means of each study's" : "") + "." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
