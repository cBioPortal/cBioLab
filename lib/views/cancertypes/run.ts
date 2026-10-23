// Cancer types view: a gene list's alteration frequency per cancer type
import type { ViewResult } from "../../types.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, ATTR_NAME, answering, askEachSite, plural, refuse } from "../shared.ts";
import type { CancertypesView, CancertypesGroup, CancertypesPanel } from "./types.ts";
import { cancerTypesSql, cancerTypeSamplesSql } from "./sql.ts";
import { cancertypesMethod } from "./method.ts";

const zeroGroup = (key: string, label: string): CancertypesGroup =>
  ({ key, label, samples: 0, profiled: 0, altered: 0, mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0 });

export async function runCancertypes(view: CancertypesView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, vNames, pin } = ctx;
  { const e = overLimit("a cancertypes view", 2, vNames.length); if (e) return refuse("cancertypes", ctx, e.replace("at most 2", "at most 2 cohorts")); }
  let genes: string[];
  try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("cancertypes", ctx, (e as Error).message); }
  if (!genes.length) return refuse("cancertypes", ctx, "a cancertypes view needs genes");
  { const e = overLimit("a cancertypes view", 30, genes.length); if (e) return refuse("cancertypes", ctx, e.replace("at most 30", "at most 30 genes")); }
  const groupBy = String(view.groupBy || "CANCER_TYPE").trim();
  if (groupBy !== "study" && !ATTR_NAME.test(groupBy)) return refuse("cancertypes", ctx, "groupBy is a sample attribute name or \"study\"; got " + JSON.stringify(groupBy).slice(0, 40));
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin) return refuse("cancertypes", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const minSamples = view.minSamples == null ? 10 : Math.floor(Number(view.minSamples));
  if (!(minSamples >= 1 && minSamples <= 1000)) return refuse("cancertypes", ctx, "minSamples is 1 to 1000");
  const show: "frequency" | "count" = view.show === "count" ? "count" : "frequency";
  const unit: "patient" | "sample" = view.unit === "sample" ? "sample" : "patient";
  const attribute = groupBy === "study" ? null : groupBy;

  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("cancertypes", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const perSite: { cohort: string; study: string; groups: number; profiled: number }[] = [];
  const panels: CancertypesPanel[] = [];
  const COUNTS = ["samples", "profiled", "altered", "mutation", "amp", "homdel", "sv", "multiple"] as const;
  const ALL_KEY = "\x01all";
  const cohortTotal = new Map<string, { profiled: number; altered: number; samples: number }>();
  // groups at or over the floor, most altered first; the rest pooled into one, counted
  const arrange = (all: CancertypesGroup[]) => {
    const named = all.map((g) => ({ ...g, label: g.key === "" ? "(no " + (attribute || "study") + " value)" : g.label }));
    const keep = named.filter((g) => g.profiled >= minSamples).sort((a, b) => b.altered / b.profiled - a.altered / a.profiled || b.profiled - a.profiled);
    const small = named.filter((g) => g.profiled < minSamples);
    let pooled: CancertypesPanel["pooled"];
    if (small.length) {
      const p = zeroGroup("__pooled__", small.length + " smaller group" + (small.length === 1 ? "" : "s"));
      p.profiledFor = { mutation: 0, cna: 0, sv: 0 };
      for (const g of small) {
        for (const k of COUNTS) p[k] += g[k];
        for (const k of ["mutation", "cna", "sv"] as const) p.profiledFor[k] += g.profiledFor?.[k] || 0;
      }
      pooled = { ...p, count: small.length };
    }
    return { groups: keep, ...(pooled ? { pooled } : {}) };
  };
  const answers = await askEachSite(ctx, ok, (n, _st, r) => Promise.all([
    r.viewAggregate("cancertypes:" + n, doc.cohorts[n], (c, s, d) => cancerTypesSql(c, s, d, genes, attribute, pin, measure, unit)),
    r.viewAggregate("cancertypes:samples:" + n, doc.cohorts[n], (c, s, d) => cancerTypeSamplesSql(c, s, d, attribute, unit))
  ]));
  for (const n of vNames) {
    // gene "*" is the genes together; every other key one gene
    const byGene = new Map<string, Map<string, CancertypesGroup>>();
    const totals = new Map<string, { samples: number; profiledFor: { mutation: number; cna: number; sv: number }; label: string }>();
    const get = (gene: string, k: string, label: string) => {
      let m = byGene.get(gene); if (!m) { m = new Map(); byGene.set(gene, m); }
      let g = m.get(k); if (!g) { g = zeroGroup(k, label); m.set(k, g); } else if (!g.label && label) g.label = label;
      return g;
    };
    for (const { study: st, answer: [rows, tot] } of answers.filter((a) => a.cohort === n)) {
      let profiled = 0;
      for (const r of rows) {
        if (r.grp === ALL_KEY) {
          if (r.gene === "*") { const t = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 }; t.profiled += Number(r.profiled); t.altered += Number(r.altered); cohortTotal.set(n, t); }
          continue;
        }
        const g = get(String(r.gene), String(r.grp), String(r.label || r.grp));
        g.profiled += Number(r.profiled); g.altered += Number(r.altered); if (r.gene === "*") profiled += Number(r.profiled);
        g.mutation += Number(r.mutation); g.amp += Number(r.amp); g.homdel += Number(r.homdel); g.sv += Number(r.sv); g.multiple += Number(r.multiple);
      }
      for (const r of tot) {
        if (r.grp === ALL_KEY) { const t = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 }; t.samples += Number(r.samples); cohortTotal.set(n, t); continue; }
        const t = totals.get(String(r.grp)) || { samples: 0, profiledFor: { mutation: 0, cna: 0, sv: 0 }, label: String(r.grp) };
        t.samples += Number(r.samples); t.profiledFor.mutation += Number(r.mut); t.profiledFor.cna += Number(r.cna); t.profiledFor.sv += Number(r.sv);
        totals.set(String(r.grp), t);
      }
      perSite.push({ cohort: n, study: st, groups: rows.filter((r) => r.gene === "*").length, profiled });
    }
    // every group with units appears, profiled or not; each carries its totals
    for (const [k, t] of totals) get("*", k, t.label);
    for (const m of byGene.values()) for (const g of m.values()) {
      const t = totals.get(g.key);
      if (t) { g.samples = t.samples; g.profiledFor = { ...t.profiledFor }; }
    }
    const all = [...(byGene.get("*") || new Map()).values()];
    // the cohort's own totals count each unit once, though a patient can sit in two groups
    const ct = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 };
    panels.push({ cohort: n, samples: ct.samples, profiled: ct.profiled, altered: ct.altered, ...arrange(all),
      ...(genes.length > 1 ? { perGene: genes.map((gene) => ({ gene, ...arrange([...(byGene.get(gene) || new Map()).values()]) })) } : {}) });
  }
  if (!panels.some((p) => p.profiled)) return refuse("cancertypes", ctx, "no " + unit + " in " + (vNames.length === 1 ? "this cohort" : "these cohorts") +
    " was profiled for " + (genes.length === 1 ? genes[0] : "any of " + genes.join(", ")));
  const multi = ctx.vStudies.length > 1;
  const groupWord = attribute ? attribute : "study";
  return {
    kind: "cancertypes", cohorts: vNames,
    cancertypes: { groupBy: groupWord, measure, genes, minSamples, show, unit, panels, ...(excluded.length ? { excluded } : {}) },
    method: cancertypesMethod({ genes, groupBy: groupWord, measure, oncokbPin: pin, minSamples, unit, perSite,
      panels: panels.map((p) => ({ cohort: p.cohort, groups: p.groups.length, pooled: p.pooled ? p.pooled.count : 0, profiled: p.profiled, altered: p.altered })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: (unit === "patient" ? "Patients" : "Samples") + " altered in at least one of " + (genes.length === 1 ? genes[0] : genes.length + " genes") + " per " + groupWord + " group, over the " + unit + "s profiled for at least one of them" +
      " (the union of their panels, as an oncoprint's merged row counts it). " +
      (measure === "driver" ? "Only OncoKB drivers (" + pin + ") count. " : "Any mutation, high-level copy-number change (amplification, deep deletion) or structural variant counts; low-level gains and losses do not. ") +
      "A " + unit + " with more than one kind of alteration across the genes counts once, under \"multiple\". " +
      (unit === "patient" ? "A patient counts in every group one of their samples falls in, profiled if any of those samples is, altered if any is. " : "Samples are counted, not patients: a patient with two samples counts twice. ") +
      (attribute ? attribute + " is read per sample and folded on case and whitespace; samples with no value form their own group. " : "") +
      "Groups with fewer than " + plural(minSamples, "profiled " + unit) + " are pooled into one bar rather than dropped. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; values are matched by name, not harmonized. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
