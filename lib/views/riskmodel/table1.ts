// Table 1 for the risk model: each risk group's clinical and genomic makeup, tested across groups.
//
// Pure: lib/views/riskmodel/run.ts fetches the rows (the fit's own query, with Table 1's attributes
// added), matches them to the fit's patients and hands them here by position, without identifiers;
// only counts come out. Gene rates are panel-aware (docs/PERFORMANCE.md): a group's rate for a gene
// is over its patients whose panels cover that gene, and a patient whose panels do not is "not
// profiled", never unaltered. Rows the groups differ in by construction — the model's genes and
// covariates, its outcome — are marked and kept out of the q-value family.
import { benjaminiHochberg, chiSquareTest, kruskalWallis, quantilesFromHistogram, type Histogram } from "../../stats.ts";
import type { RiskTable1, RiskTable1Row, RiskTable1Role } from "./types.ts";

export const TABLE1_MAX_ATTRIBUTES = 20, TABLE1_MAX_GENES = 20;
/** the default attributes: at most this many, chosen from the first TABLE1_CONSIDERED in the study's priority order */
export const TABLE1_DEFAULT_ATTRIBUTES = 8;
export const TABLE1_CONSIDERED = 20;
/** a default attribute takes at most this many values among the patients (free text and ids take more) */
export const TABLE1_DEFAULT_MAX_VALUES = 12;
/** past this many values a categorical attribute's chi-squared table is too sparse to say anything */
export const TABLE1_MAX_VALUES = 100;
/** a survival endpoint's columns: never a default, since the groups are cut to differ in survival */
export const OUTCOME_COLUMN = /_(MONTHS|STATUS)$/;

/** A clinical attribute as the study's metadata describes it. */
export interface Table1AttrMeta { id: string; numeric: boolean; patient: boolean }

/** One modelled patient, by position in the fit: their mutation panels and mutated genes, and per Table 1 attribute its folded value, its spelling and how many values their samples hold. */
export interface Table1Patient { panels: string[]; genes: string[]; d: string[]; r: string[]; u: number[] }

export interface Table1Input {
  study: string;
  reportedOn: RiskTable1["reportedOn"]; measure: RiskTable1["measure"];
  /** each group's name and its patients, as positions in `patients` */
  groups: { name: string; members: number[] }[];
  /** every modelled patient, by the fit's position */
  patients: Table1Patient[];
  /** the attributes fetched, in the order of each patient's d/r/u; `meta` null when the study has no such attribute */
  attributes: { name: string; meta: Table1AttrMeta | null }[];
  /** the attributes came from the default rule (filtered and capped here), rather than being named */
  attributesDefault: boolean;
  genes: string[]; genesDefault: boolean;
  /** the genes each mutation panel covers (WES, which covers every gene, is not listed) */
  panelGenes: Map<string, Set<string>>;
  model: { genes: string[]; covariates: string[]; strata: string | null; outcome: string[] };
}

/** A numeric row's value distribution in one group, for the method record's script. */
export interface Table1Histogram { row: string; group: string; value: number; n: number }

const roleOfAttribute = (name: string, m: Table1Input["model"]): RiskTable1Role =>
  m.covariates.includes(name) ? "in the model" : m.outcome.includes(name) ? "outcome" : name === m.strata ? "stratum" : null;

/** The row's key in the method record's checks. */
export const table1RowKey = (row: { kind: string; name: string }) => (row.kind === "gene" ? "gene:" : "attribute:") + row.name;

const untested = (why: string) => ({ test: null, statistic: null, df: null, p: null, q: null, untested: why });

export function buildTable1(t: Table1Input): { table: RiskTable1; histograms: Table1Histogram[] } {
  const reported = t.groups.flatMap((g) => g.members);
  const rows: RiskTable1Row[] = [];
  const omitted: RiskTable1["omitted"] = [];
  const histograms: Table1Histogram[] = [];
  let defaultsKept = 0;

  t.attributes.forEach(({ name, meta }, k) => {
    const isDefault = t.attributesDefault;
    if (isDefault && defaultsKept >= TABLE1_DEFAULT_ATTRIBUTES) return;
    const skip = (why: string) => { if (isDefault) omitted.push({ name, why }); else rows.push({ kind: "skipped", name, what: "attribute", skipped: why }); };
    if (!meta) { skip("not a clinical attribute of " + t.study); return; }
    const role = roleOfAttribute(name, t.model), per = meta.patient ? "patient" as const : "sample" as const;
    const multiValued = reported.filter((i) => t.patients[i].u[k] > 1).length;
    if (meta.numeric) {
      const hists = t.groups.map((g) => {
        const counts = new Map<number, number>();
        for (const i of g.members) {
          const d = t.patients[i].d[k];
          const v = d === "" ? NaN : Number(d);
          if (Number.isFinite(v)) counts.set(v, (counts.get(v) || 0) + 1);
        }
        return [...counts].map(([v, n]) => ({ v, n })).sort((a, b) => a.v - b.v) as Histogram[];
      });
      const distinct = new Set(hists.flatMap((h) => h.map((x) => x.v))).size;
      if (!distinct) { skip("no value recorded for these patients"); return; }
      if (isDefault && distinct < 2) { skip("takes one value among these patients"); return; }
      if (isDefault) defaultsKept++;
      const perGroup = t.groups.map((g, gi) => {
        const n = hists[gi].reduce((s, x) => s + x.n, 0);
        const [median, q1, q3] = quantilesFromHistogram(hists[gi], [0.5, 0.25, 0.75]);
        return { n, median, q1, q3, missing: g.members.length - n };
      });
      t.groups.forEach((g, gi) => { for (const h of hists[gi]) histograms.push({ row: table1RowKey({ kind: "num", name }), group: g.name, value: h.v, n: h.n }); });
      const filled = perGroup.filter((p) => p.n > 0).length;
      const test = distinct < 2 ? untested("takes one value among these patients")
        : filled < 2 ? untested("fewer than two groups have a value")
        : (() => { const kw = kruskalWallis(hists); return { test: "Kruskal-Wallis" as const, statistic: kw.h, df: kw.df, p: kw.p, q: null }; })();
      rows.push({ kind: "num", name, per, role, perGroup, multiValued, ...test });
      return;
    }
    // categories, by the folded value; each shown as its commonest spelling
    const spelled = new Map<string, Map<string, number>>();
    const byGroup = t.groups.map((g) => {
      const counts = new Map<string, number>();
      for (const i of g.members) {
        const p = t.patients[i], d = p.d[k];
        if (d === "") continue;
        counts.set(d, (counts.get(d) || 0) + 1);
        let sp = spelled.get(d); if (!sp) spelled.set(d, sp = new Map());
        sp.set(p.r[k], (sp.get(p.r[k]) || 0) + 1);
      }
      return counts;
    });
    const keys = [...spelled.keys()];
    if (!keys.length) { skip("no value recorded for these patients"); return; }
    if (isDefault && keys.length < 2) { skip("takes one value among these patients"); return; }
    const limit = isDefault ? TABLE1_DEFAULT_MAX_VALUES : TABLE1_MAX_VALUES;
    if (keys.length > limit) { skip("takes " + keys.length + " values here (" + (isDefault ? "a default takes at most " + limit : "Table 1 describes at most " + limit) + ")"); return; }
    if (isDefault) defaultsKept++;
    const label = (key: string) => [...spelled.get(key)!].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const levels = keys.map((key) => ({ value: label(key), counts: byGroup.map((c) => c.get(key) || 0) }))
      .sort((a, b) => b.counts.reduce((s, x) => s + x, 0) - a.counts.reduce((s, x) => s + x, 0) || a.value.localeCompare(b.value));
    const missing = t.groups.map((g, gi) => g.members.length - levels.reduce((s, l) => s + l.counts[gi], 0));
    const filled = byGroup.filter((c) => c.size > 0).length;
    let test, minExpected: number | null = null;
    if (keys.length < 2) test = untested("takes one value among these patients");
    else if (filled < 2) test = untested("fewer than two groups have a value");
    else {
      const x = chiSquareTest(t.groups.map((_, gi) => levels.map((l) => l.counts[gi])));
      test = { test: "chi-squared" as const, statistic: x.chi2, df: x.df, p: x.p, q: null };
      minExpected = x.minExpected;
    }
    rows.push({ kind: "cat", name, per, role, levels, missing, multiValued, minExpected, ...test });
  });

  // genes: a symbol resolves against the panels' genes and the genes mutated in these patients
  const known = new Set<string>();
  for (const s of t.panelGenes.values()) for (const g of s) known.add(g);
  for (const p of t.patients) for (const g of p.genes) known.add(g);
  const byUpper = new Map<string, string>();
  for (const g of known) if (!byUpper.has(g.toUpperCase())) byUpper.set(g.toUpperCase(), g);
  for (const asked of t.genes) {
    const gene = known.has(asked) ? asked : byUpper.get(asked.toUpperCase());
    if (!gene) { rows.push({ kind: "skipped", name: asked, what: "gene", skipped: "on none of the mutation panels these patients were sequenced on, and mutated in none of them" }); continue; }
    // two spellings of one gene ("keap1", "KEAP1") are one row
    if (rows.some((x) => x.kind === "gene" && x.name === gene)) continue;
    const covers = (p: Table1Patient) => p.panels.some((pn) => pn === "WES" || !!t.panelGenes.get(pn)?.has(gene));
    const perGroup = t.groups.map((g) => {
      let altered = 0, profiled = 0;
      for (const i of g.members) {
        const p = t.patients[i];
        if (!covers(p)) continue;
        profiled++;
        if (p.genes.includes(gene)) altered++;
      }
      return { altered, profiled, notProfiled: g.members.length - profiled };
    });
    const role: RiskTable1Role = t.model.genes.includes(gene) ? "in the model" : null;
    let test, minExpected: number | null = null;
    if (perGroup.filter((x) => x.profiled > 0).length < 2) test = untested("fewer than two groups have a patient sequenced on a panel covering it");
    else if (perGroup.every((x) => x.altered === 0) || perGroup.every((x) => x.altered === x.profiled)) test = untested(perGroup.every((x) => x.altered === 0) ? "mutated in none of these patients" : "mutated in every profiled patient");
    else {
      const x = chiSquareTest(perGroup.map((c) => [c.altered, c.profiled - c.altered]));
      test = { test: "chi-squared" as const, statistic: x.chi2, df: x.df, p: x.p, q: null };
      minExpected = x.minExpected;
    }
    rows.push({ kind: "gene", name: gene, role, perGroup, minExpected, ...test });
  }

  // Benjamini–Hochberg over the rows that are open questions; the model's own rows and its outcome differ by construction
  const family = rows.filter((r): r is Exclude<RiskTable1Row, { kind: "skipped" }> => r.kind !== "skipped" && r.p != null && r.role !== "in the model" && r.role !== "outcome");
  benjaminiHochberg(family.map((r) => r.p!)).forEach((q, i) => { family[i].q = q; });

  const named = (what: "attribute" | "gene") => rows.filter((r) => r.kind === "skipped" ? r.what === what : (r.kind === "gene") === (what === "gene")).map((r) => r.name);
  return {
    table: {
      reportedOn: t.reportedOn, measure: t.measure,
      groups: t.groups.map((g) => ({ name: g.name, n: g.members.length })),
      describe: { attributes: named("attribute"), genes: named("gene") },
      defaults: { attributes: t.attributesDefault, genes: t.genesDefault },
      rows, omitted, tested: family.length,
    },
    histograms,
  };
}

/**
 * The attributes the default rule considers, in order: the model's stratum and covariates, then the
 * study's attributes by priority, leaving out survival endpoints' columns — at most TABLE1_CONSIDERED.
 * buildTable1 then drops those that cannot describe these patients and keeps TABLE1_DEFAULT_ATTRIBUTES.
 */
export function table1DefaultCandidates(metaInOrder: string[], model: { covariates: string[]; strata: string | null }): string[] {
  const out: string[] = [];
  for (const a of [...(model.strata ? [model.strata] : []), ...model.covariates, ...metaInOrder]) {
    if (out.length >= TABLE1_CONSIDERED) break;
    if (!out.includes(a) && !OUTCOME_COLUMN.test(a)) out.push(a);
  }
  return out;
}
