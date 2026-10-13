// Paired view: primary against metastasis (or any two kinds of sample), within patients
import type { ViewResult, PairedView, PairedPanel } from "../types.ts";
import { pairedCountsSql, pairedPatientsSql, sampleAttributeValuesSql } from "../federation-views.ts";
import { benjaminiHochberg, mcnemarExact } from "../stats.ts";
import { geneSymbols } from "../gene-tracks.ts";
import { pairedMethod, type PairedTrace } from "../method.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, ATTR_NAME, answering, plural, refuse } from "./shared.ts";

const PAIRED_TOP_DEFAULT = 20, PAIRED_TOP_MAX = 40;

type Sides = { attribute: string; a: string[]; b: string[] };

/** One side spec checked and normalized, or the reason it cannot be used. */
function pairSides(raw: { attribute?: string; a?: string | string[]; b?: string | string[] }, where: string): Sides | string {
  // `where` names the spec in a refusal: "pairBy" or "pairBy.studies.<study>"
  const list = (x: string | string[] | undefined) => (Array.isArray(x) ? x : x == null ? [] : [x]).map((v) => String(v).trim()).filter(Boolean);
  const by = { attribute: String(raw.attribute || "").trim(), a: list(raw.a), b: list(raw.b) };
  if (!ATTR_NAME.test(by.attribute)) return where + ".attribute must be a sample attribute name; got " + JSON.stringify(by.attribute).slice(0, 40);
  if (!by.a.length || !by.b.length) return where + " needs at least one value for each side, a and b";
  const fold = (v: string) => v.toLowerCase().trim();
  const overlap = by.a.filter((v) => by.b.map(fold).includes(fold(v)));
  if (overlap.length) return "a value cannot be on both sides of a pair: " + overlap.join(", ");
  return by;
}

/** The values a side names across every study, case-folded duplicates dropped, in first-seen order. */
function sideLabel(specs: Sides[], side: "a" | "b"): string {
  const seen = new Map<string, string>();
  for (const sp of specs) for (const v of sp[side]) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].join("/");
}

export async function runPaired(view: PairedView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  { const e = overLimit("a paired view", 3, vNames.length); if (e) return refuse("paired", ctx, e.replace("at most 3", "at most 3 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("paired", ctx, (e as Error).message); }
  const scan = !genes.length;
  { const e = overLimit("a paired view", 20, genes.length); if (e) return refuse("paired", ctx, e.replace("at most 20", "at most 20 genes")); }
  const top = view.top == null ? PAIRED_TOP_DEFAULT : Math.floor(Number(view.top));
  if (!(top >= 1 && top <= PAIRED_TOP_MAX)) return refuse("paired", ctx, "top must be a whole number from 1 to " + PAIRED_TOP_MAX + "; got " + JSON.stringify(view.top));
  const measure: "driver" | "any" = view.measure === "any" ? "any" : "driver";
  if (measure === "driver" && !pin)
    return refuse("paired", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");

  const raw = view.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
  const own = raw.studies || {};
  const strays = Object.keys(own).filter((st) => !ctx.vStudies.includes(st));
  if (strays.length) return refuse("paired", ctx, "pairBy.studies names " + strays.join(", ") + ", which no cohort of this view spans (it spans " + ctx.vStudies.join(", ") + ")");
  const fallback = raw.attribute != null || raw.a != null || raw.b != null ? pairSides(raw, "pairBy") : null;
  if (typeof fallback === "string") return refuse("paired", ctx, fallback);
  const sidesFor: Record<string, Sides> = {};
  for (const st of ctx.vStudies) {
    const sp = own[st] ? pairSides(own[st], "pairBy.studies." + st) : fallback;
    if (typeof sp === "string") return refuse("paired", ctx, sp);
    if (!sp) return refuse("paired", ctx, "pairBy gives no sides for " + st + " — list it under pairBy.studies, or give a default attribute, a and b");
    sidesFor[st] = sp;
  }

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("paired", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const used = ctx.vStudies.filter((st) => ok[st]).map((st) => sidesFor[st]);
  const labels = {
    a: String(raw.labels?.a || "").trim() || sideLabel(used, "a"),
    b: String(raw.labels?.b || "").trim() || sideLabel(used, "b")
  };
  if (labels.a.toLowerCase() === labels.b.toLowerCase()) return refuse("paired", ctx, "the two sides need different labels; both are " + JSON.stringify(labels.a));
  const perStudyDiffers = new Set(used.map((sp) => JSON.stringify(sp))).size > 1 || Object.keys(own).length > 0;

  const panels: PairedPanel[] = [];
  const tallies = new Map<string, { pairs: number; both: number; aOnly: number; bOnly: number }>();
  const pairedRows: PairedTrace["counts"] = [];
  for (const n of vNames) {
    const panel: PairedPanel = { cohort: n, patients: 0, aSamples: 0, bSamples: 0, genes: [] };
    const seen = new Set<string>();
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const def = doc.cohorts[n], by = sidesFor[st];
      const [pp, rows] = await Promise.all([
        ok[st].viewAggregate("paired:patients:" + n, def, (c, s, d) => pairedPatientsSql(c, s, d, by)),
        ok[st].viewAggregate("paired:genes:" + n, def, (c, s, d) => pairedCountsSql(c, s, d, scan ? null : genes, by, pin, measure))
      ]);
      panel.patients += Number(pp[0]?.patients || 0);
      panel.aSamples += Number(pp[0]?.a_samples || 0); panel.bSamples += Number(pp[0]?.b_samples || 0);
      for (const r of rows) {
        const g = String(r.gene), k = n + "|" + g, cur = tallies.get(k) || { pairs: 0, both: 0, aOnly: 0, bOnly: 0 };
        cur.pairs += Number(r.pairs); cur.both += Number(r.both); cur.aOnly += Number(r.a_only); cur.bOnly += Number(r.b_only);
        tallies.set(k, cur); seen.add(g);
        pairedRows.push({ cohort: n, study: st, gene: g, pairs: Number(r.pairs), both: Number(r.both), aOnly: Number(r.a_only), bOnly: Number(r.b_only) });
      }
    }));
    const all = (scan ? [...seen].sort() : genes).map((g) => {
      const t = tallies.get(n + "|" + g) || { pairs: 0, both: 0, aOnly: 0, bOnly: 0 };
      const anywhere = t.both + t.aOnly + t.bOnly;
      return { gene: g, ...t, neither: t.pairs - anywhere, concordance: anywhere ? Math.round(1000 * t.both / anywhere) / 1000 : null,
        p: mcnemarExact(t.aOnly, t.bOnly), q: 1 };
    });
    const tested = all.filter((g) => g.aOnly + g.bOnly > 0);
    benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
    if (scan) {
      // most one-sided first; among equal p, the larger imbalance, then more discordant patients
      panel.genes = [...tested].sort((x, y) => x.p - y.p || Math.abs(y.bOnly - y.aOnly) - Math.abs(x.bOnly - x.aOnly) ||
        (y.aOnly + y.bOnly) - (x.aOnly + x.bOnly) || (x.gene < y.gene ? -1 : 1)).slice(0, top);
      panel.tested = tested.length;
    } else panel.genes = all;
    panels.push(panel);
  }
  if (!panels.some((pn) => pn.patients)) {
    // say what the attribute actually holds here, so the fix is one edit away
    const st = Object.keys(ok)[0], by = sidesFor[st];
    const vals = await ok[st].viewAggregate("paired:values", doc.cohorts[vNames[0]], (c, s, d) => sampleAttributeValuesSql(c, s, d, by.attribute));
    return refuse("paired", ctx, "no patient in " + (vNames.length === 1 ? "this cohort" : "these cohorts") + " has both a " +
      by.attribute + " = " + by.a.join("/") + " sample and a " + by.b.join("/") + " sample" + (ctx.vStudies.length > 1 ? " in " + st : "") +
      (vals.length ? " — " + by.attribute + " here takes: " + vals.map((v) => String(v.value) + " (" + Number(v.samples).toLocaleString("en-US") + ")").join(", ")
        : " — " + st + " has no sample attribute " + by.attribute));
  }
  const multi = ctx.vStudies.length > 1;
  const aL = labels.a, bL = labels.b;
  const first = used[0];
  const perStudy = perStudyDiffers ? Object.fromEntries(ctx.vStudies.filter((st) => ok[st]).map((st) => [st, sidesFor[st]])) : undefined;
  const sidesText = perStudy
    ? Object.entries(perStudy).map(([st, sp]) => st + ": " + sp.attribute + " " + sp.a.join("/") + " vs " + sp.b.join("/")).join("; ")
    : first.attribute + " = " + first.a.join("/") + " vs " + first.b.join("/");
  const byLocation = used.every((sp) => /^(SAMPLE_TYPE|SAMPLE_SITE|TISSUE_SITE|SITE|METASTATIC_SITE|PRIMARY_SITE)$/i.test(sp.attribute));
  return {
    kind: "paired", cohorts: vNames,
    method: pairedMethod({ pairBy: first, labels, ...(perStudy ? { perStudy } : {}), measure, oncokbPin: pin, ...(scan ? { scan: { top } } : {}),
      perSite: vNames.flatMap((n) => [...cohorts[n].studies].filter((st) => ok[st]).sort()
        .map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      panels: panels.map((pn) => ({ cohort: pn.cohort, patients: pn.patients, ...(scan ? { tested: pn.tested } : {}) })),
      counts: pairedRows.sort((x, y) => vNames.indexOf(x.cohort) - vNames.indexOf(y.cohort) || (x.study < y.study ? -1 : x.study > y.study ? 1 : 0) ||
        (scan ? (x.gene < y.gene ? -1 : x.gene > y.gene ? 1 : 0) : genes.indexOf(x.gene) - genes.indexOf(y.gene))),
      results: panels.flatMap((pn) => pn.genes.map((g) => ({ cohort: pn.cohort, gene: g.gene, p: g.p, ...(g.aOnly + g.bOnly > 0 ? { q: g.q } : {}) }))) }),
    paired: { pairBy: first, ...(perStudy ? { perStudy } : {}), labels, ...(scan ? { scan: { top } } : {}), measure, panels, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Within patients with samples on both sides, " + aL + " and " + bL + " (" + sidesText + "; " +
      panels.map((pn) => pn.cohort + ": " + plural(pn.patients, "patient")).join("; ") + "), per gene, among those profiled for it on BOTH sides by each side's own panels: " +
      (measure === "driver" ? "an OncoKB driver (" + pin + ")" : "any alteration") + " on both sides, on the " + aL + " side only, or the " + bL + " side only; " +
      "a patient with several samples on a side counts as altered there if any is. " +
      "Concordance is both ÷ altered anywhere. The exact McNemar test asks whether discordance runs one way; q is Benjamini–Hochberg across the genes of each cohort. " +
      (scan ? "Genes were not chosen in advance: every gene " + (measure === "driver" ? "with a driver " : "altered ") + "in some paired patient was tested (" +
        panels.map((pn) => pn.cohort + ": " + plural(pn.tested || 0, "gene") + " with a discordant patient").join("; ") + "), q is taken across all of them, and the " +
        top + " most one-sided are drawn — at these sizes, read the counts, not only the q. " : "") +
      (byLocation
        ? "A sample's " + first.attribute + " records where the tissue came from, not when it was taken, so " + bL + "-only is not the same as \"acquired later\"; "
        : "Sides are as each study labels its samples; " + bL + "-only means seen on that side and not the other, which is not proof it arose or vanished in between — a subclone one biopsy missed, or a lower-purity sample (common after treatment) under-calling its side, reads the same; ") +
      "and patients sampled twice are a selected group, typically with longer or harder disease courses." +
      (multi ? " Counts are summed across " + ctx.vStudies.length + " studies." : "") +
      (excluded.length ? " Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
