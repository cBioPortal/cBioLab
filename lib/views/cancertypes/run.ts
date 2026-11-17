// Cancer types view: a gene list's alteration frequency per cancer type
import type { ViewResult } from "../../types.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, ATTR_NAME, answering, askEachSite, plural, refuse } from "../shared.ts";
import type { CancertypesView, CancertypesGroup, CancertypesPanel } from "./types.ts";
import { cancerTypesSql, cancerTypeSamplesSql } from "./sql.ts";
import { cancertypesMethod } from "./method.ts";
import { parseOql } from "../../oql-parse.ts";
import { resolveDrivers } from "../../driver-settings.ts";
import { variantPins } from "../../variant-annotation.ts";

/** a study's name as the portal labels its group: cut to 49 characters before a "(" that starts past 50 (FormatUtils shortenStudyName) */
export function shortStudyName(name: string): string {
  const paren = name.indexOf("(");
  return paren > 50 ? name.substring(0, 49) + "..." + name.substring(paren) : name;
}

const zeroGroup = (key: string, label: string): CancertypesGroup =>
  ({ key, label, samples: 0, profiled: 0, altered: 0, mutation: 0, amp: 0, homdel: 0, sv: 0, multiple: 0, mrnaHigh: 0, mrnaLow: 0, protHigh: 0, protLow: 0 });

export async function runCancertypes(view: CancertypesView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, vNames, pin } = ctx;
  { const e = overLimit("a cancertypes view", 2, vNames.length); if (e) return refuse("cancertypes", ctx, e.replace("at most 2", "at most 2 cohorts")); }
  let genes: string[];
  let lines: string[] | null = null;
  if (view.oql !== undefined) {
    if (!Array.isArray(view.oql) || !view.oql.length) return refuse("cancertypes", ctx, "oql is a list of OQL lines, one gene each");
    if (view.measure === "driver") return refuse("cancertypes", ctx, "with oql, DRIVER belongs in the OQL (\"KRAS: MUT_DRIVER\"), not in measure: \"driver\"");
    try {
      const parsed = view.oql.map((l) => { const e = parseOql(String(l)); if (e.length !== 1) throw new Error("'" + String(l).slice(0, 40) + "' names " + e.length + " genes; give each its own line"); return e[0]; });
      lines = view.oql.map(String);
      genes = [...new Set(parsed.map((e) => e.gene))];
      if (view.drivers !== undefined) resolveDrivers(view.drivers);
    } catch (e) { return refuse("cancertypes", ctx, "oql: " + (e as Error).message); }
  } else try { genes = geneSymbols(view.genes || []); } catch (e) { return refuse("cancertypes", ctx, (e as Error).message); }
  if (!genes.length) return refuse("cancertypes", ctx, "a cancertypes view needs genes");
  { const e = overLimit("a cancertypes view", 30, genes.length); if (e) return refuse("cancertypes", ctx, e.replace("at most 30", "at most 30 genes")); }
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return refuse("cancertypes", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const unit: "patient" | "sample" = view.unit === "sample" ? "sample" : "patient";
  const measure: "driver" | "any" = view.measure === "driver" ? "driver" : "any";
  if (measure === "driver" && !pin) return refuse("cancertypes", ctx, "no OncoKB annotation pin is available here, so drivers cannot be called — use measure: \"any\"");
  const minSamples = view.minSamples == null ? null : Number(view.minSamples);
  if (minSamples !== null && !(Number.isInteger(minSamples) && minSamples >= 0 && minSamples <= 1e9))
    return refuse("cancertypes", ctx, "minSamples (Min. # Total) is a whole number, 0 or more; got " + JSON.stringify(view.minSamples).slice(0, 20));
  const minAltered = view.minAltered == null ? 0 : Number(view.minAltered);
  if (!(Number.isFinite(minAltered) && minAltered >= 0))
    return refuse("cancertypes", ctx, "minAltered (Min. % or # Altered) is a number, 0 or more; got " + JSON.stringify(view.minAltered).slice(0, 20));
  const alphabetical = view.sort === "alphabetical";
  const show: "frequency" | "count" = view.show === "count" ? "count" : "frequency";
  if (view.alterationTypes !== undefined && typeof view.alterationTypes !== "boolean")
    return refuse("cancertypes", ctx, "alterationTypes (Show Genomic Alteration Types) is true or false; got " + JSON.stringify(view.alterationTypes).slice(0, 20));
  let groupBy = String(view.groupBy ?? "").trim();
  // what can be refused without asking anyone is refused before the default category's query
  if (groupBy && groupBy !== "study" && !ATTR_NAME.test(groupBy)) return refuse("cancertypes", ctx, "groupBy is a sample attribute name or \"study\"; got " + JSON.stringify(groupBy).slice(0, 40));
  // the portal's default (CancerSummaryContainer groupAlterationsBy), as the method record states it
  let byDefault: { studies: number; cancerTypes?: number } | undefined;
  // the per-group samples answers by CANCER_TYPE, kept when that is the category chosen
  const typeAnswers = new Map<string, Record<string, unknown>[]>();
  if (!groupBy && ctx.vStudies.length > 1) { groupBy = "study"; byDefault = { studies: ctx.vStudies.length }; }
  else if (!groupBy) {
    // one study: the detailed type when every sample has one cancer type
    const types = await askEachSite(ctx, ok, async (n, _st, r) =>
      r.viewAggregate("cancertypes:default:" + n, doc.cohorts[n], (c, s, d) => cancerTypeSamplesSql(c, s, d, "CANCER_TYPE", unit)));
    for (const a of types) typeAnswers.set(a.cohort + "\0" + a.study, a.answer);
    const distinct = new Set(types.flatMap((a) => a.answer.map((row) => String(row.grp)).filter((g) => g !== "\x01all")));
    groupBy = distinct.size === 1 ? "CANCER_TYPE_DETAILED" : "CANCER_TYPE";
    byDefault = { studies: 1, cancerTypes: distinct.size };
  }
  const attribute = groupBy === "study" ? null : groupBy;

  const perSite: { cohort: string; study: string; groups: number; profiled: number }[] = [];
  const panels: CancertypesPanel[] = [];
  const ALL_KEY = "\x01all";
  const cohortTotal = new Map<string, { profiled: number; altered: number; samples: number }>();
  // the portal's filters (CancerSummaryContent chartData): a group is drawn when it has profiled units, at
  // least the Min. # Total of them (unset: 10 when its largest group has more than 10, else 0) and at least
  // the Min. % / # Altered; drawn highest first by the y-axis value, or by name
  const share = (g: CancertypesGroup) => show === "count" ? g.altered : (g.altered / g.profiled) * 100;
  // alphabetically: by the value as written (the portal's group key), a study by its id; the folded key settles ties
  const byName = (g: CancertypesGroup) => attribute ? g.label : g.key;
  const order = (a: CancertypesGroup, b: CancertypesGroup) => byName(a) < byName(b) ? -1 : byName(a) > byName(b) ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const arrange = (all: CancertypesGroup[]) => {
    const named = all.map((g) => ({ ...g, label: g.key === "" ? "(no " + (attribute || "study") + " value)" : g.label }));
    const withData = named.filter((g) => g.profiled > 0);
    const floor = minSamples ?? (Math.max(0, ...withData.map((g) => g.profiled)) > 10 ? 10 : 0);
    const groups = withData.filter((g) => g.profiled >= floor && share(g) >= minAltered).sort(alphabetical
      ? order
      : (a, b) => share(b) - share(a) || b.profiled - a.profiled);
    const filtered = groups.length < named.length && (floor > 0 || minAltered > 0);
    return { groups, categories: named.length, minSamples: floor, ...(filtered ? { filtered: true as const } : {}) };
  };
  const levelPins = { ...(view.exp ? { EXP: view.exp } : {}), ...(view.prot ? { PROT: view.prot } : {}), ...(view.ifHeld ? { ifHeld: true } : {}) };
  const hotspotPins = lines && view.drivers !== undefined ? await variantPins() : undefined;
  const answers = await askEachSite(ctx, ok, async (n, st, r) => {
    const oql = lines ? { lines, profiles: (await ctx.studyProfiles(st)).profiles, pins: levelPins,
      ...(view.drivers !== undefined ? { drivers: view.drivers, hotspotPins } : {}) } : undefined;
    return Promise.all([
    r.viewAggregate("cancertypes:" + n, doc.cohorts[n], (c, s, d) => cancerTypesSql(c, s, d, genes, attribute, pin, measure, unit, oql)),
    attribute === "CANCER_TYPE" && typeAnswers.has(n + "\0" + st) ? typeAnswers.get(n + "\0" + st)!
      : r.viewAggregate("cancertypes:samples:" + n, doc.cohorts[n], (c, s, d) => cancerTypeSamplesSql(c, s, d, attribute, unit))
  ]); });
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
        const g = get(String(r.gene), String(r.grp), attribute ? String(r.label || r.grp) : shortStudyName(String(r.label || r.grp)));
        g.profiled += Number(r.profiled); g.altered += Number(r.altered); if (r.gene === "*") profiled += Number(r.profiled);
        g.mutation += Number(r.mutation); g.amp += Number(r.amp); g.homdel += Number(r.homdel); g.sv += Number(r.sv); g.multiple += Number(r.multiple);
        for (const k of ["mrnaHigh", "mrnaLow", "protHigh", "protLow"] as const) g[k] = (g[k] || 0) + Number(r[k] ?? 0);
      }
      for (const r of tot) {
        if (r.grp === ALL_KEY) { const t = cohortTotal.get(n) || { profiled: 0, altered: 0, samples: 0 }; t.samples += Number(r.samples); cohortTotal.set(n, t); continue; }
        const name = String(r.label || r.grp);
        const t = totals.get(String(r.grp)) || { samples: 0, profiledFor: { mutation: 0, cna: 0, sv: 0 }, label: attribute ? name : shortStudyName(name) };
        t.samples += Number(r.samples); t.profiledFor.mutation += Number(r.mut); t.profiledFor.cna += Number(r.cna); t.profiledFor.sv += Number(r.sv);
        totals.set(String(r.grp), t);
      }
      perSite.push({ cohort: n, study: st, groups: rows.filter((r) => r.gene === "*").length, profiled });
    }
    // every group with units appears, profiled or not; each carries its totals
    for (const [k, t] of totals) for (const gene of ["*", ...genes]) get(gene, k, t.label);
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
    cancertypes: { groupBy: groupWord, measure, genes, minSamples, minAltered, ...(alphabetical ? { sort: "alphabetical" as const } : {}), show,
      ...(view.alterationTypes === false ? { alterationTypes: false as const } : {}), unit, panels,
      ...(excluded.length ? { excluded } : {}) },
    method: cancertypesMethod({ genes, groupBy: groupWord, measure, oncokbPin: pin, minAltered, show, unit, ...(byDefault ? { byDefault } : {}), perSite, ...(lines ? { oql: lines } : {}),
      panels: panels.map((p) => ({ cohort: p.cohort, groups: p.groups.length, categories: p.categories, minSamples: p.minSamples, profiled: p.profiled, altered: p.altered })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: (unit === "patient" ? "Patients" : "Samples") + " altered in at least one of " + (genes.length === 1 ? genes[0] : genes.length + " genes") + " per " + groupWord + " group, over the " + unit + "s profiled for at least one of them" +
      " (the union of their panels, as an oncoprint's merged row counts it). " +
      (lines ? "What the query's OQL lines match counts, each line under its gene" + (view.drivers !== undefined ? ", DRIVER by the page's driver settings" : "") + ". "
        : measure === "driver" ? "Only OncoKB drivers (" + pin + ") count. " : "Any mutation, high-level copy-number change (amplification, deep deletion) or structural variant counts; low-level gains and losses do not. ") +
      "A " + unit + " with more than one kind of alteration across the genes counts once, under \"multiple\"; an amplification and a deep deletion are one kind (copy number), shown as the amplification. " +
      (unit === "patient" ? "A patient counts in every group one of their samples in the cohort falls in, profiled if any of those samples is, altered if any is. " : "Samples are counted, not patients: a patient with two samples counts twice. ") +
      (byDefault ? "Grouped by " + groupWord + ", the portal's default category for " + (groupBy === "study" ? "several studies" : groupBy === "CANCER_TYPE_DETAILED" ? "a cohort of one cancer type" : "a cohort of several cancer types") + ". " : "") +
      (attribute === "CANCER_TYPE" ? "CANCER_TYPE is read per sample and folded on case and whitespace; a sample without one takes its study's type of cancer, as the portal's. "
        : attribute === "CANCER_TYPE_DETAILED" ? "CANCER_TYPE_DETAILED is read per sample and folded on case and whitespace; a sample without one takes its CANCER_TYPE, else its study's type of cancer, as the portal's. "
        : attribute ? attribute + " is read per sample and folded on case and whitespace; samples with no value form their own group. " : "Each study is labelled by its name. ") +
      "A group is drawn when it has " + (minSamples === null ? "at least 10 profiled " + unit + "s, or any when no group has more than 10 (the portal's default Min. # Total)"
        : "at least " + plural(minSamples, "profiled " + unit)) +
      (minAltered > 0 ? " and " + (show === "count" ? "at least " + plural(minAltered, "altered " + unit) : "at least " + minAltered + "% of them altered") : "") +
      "; the rest are counted in \"N of M categories are shown\". " + (alphabetical ? "Groups are in alphabetical order. " : "") +
      (view.alterationTypes === false ? "Each bar is drawn whole, without its alteration types (the portal's Show Genomic Alteration Types unticked). " : "") +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; values are matched by name, not harmonized. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
