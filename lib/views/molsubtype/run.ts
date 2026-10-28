// Molecular-subtype view: a published molecular classifier applied to each patient, as derived
// subtypes — their shares per cohort, by an attribute, and overall survival by subtype. One
// classifier so far (endometrial); another is a new CLASSIFIERS entry with its own SQL.
import type { ViewResult } from "../../types.ts";
import { chiSquareTest, kaplanMeier, logRankK, type SurvRecord } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, plural, ATTR_NAME } from "../shared.ts";
import type { MolsubtypeView, MolsubtypePanel, MolsubtypeCounts } from "./types.ts";
import { molCountsSql, molSurvivalSql, molMsiAttributesSql } from "./sql.ts";
import type { MolEndometrialOpts, MolMsiRule } from "./sql.ts";

/**
 * Pathogenic POLE exonuclease-domain hotspots: the eleven of León-Castillo et al., "Interpretation of
 * somatic POLE mutations in endometrial carcinoma", J Pathol 2020;250:323–335 (PMID 31829442) —
 * P286R, S297F, F367S, V411L, L424I, P436R, M444K, A456P, S459F, M295R, D368Y — with the
 * second substitutions at F367 and L424 that the same codons carry (F367V, L424V).
 */
export const POLE_HOTSPOTS = ["P286R", "S297F", "F367S", "F367V", "V411L", "L424I", "L424V", "P436R", "M444K", "A456P", "S459F", "M295R", "D368Y"];

interface Classifier { label: string; subtypes: string[]; citation: string }
const CLASSIFIERS: Record<string, Classifier> = {
  endometrial: {
    label: "Endometrial carcinoma molecular classification (TCGA 2013 / ProMisE / WHO 2020)",
    subtypes: ["POLEmut", "MMRd", "p53abn", "NSMP"],
    citation: "TCGA, Nature 2013; Talhouk et al., ProMisE, Br J Cancer 2015; WHO Classification of Female Genital Tumours, 5th ed. 2020",
  },
};

/** the MSI rule when none is given: a categorical call if the cohort has one, else a score */
const MSI_DEFAULTS: (MolMsiRule & { label: string })[] = [
  { attribute: "MSI_TYPE", high: ["Instable"], stable: ["Stable"], label: "MSI_TYPE (Instable = MSI-high, Stable = stable)" },
  { attribute: "MSI_SCORE", threshold: 10, stableBelow: 3, label: "MSI_SCORE (MSIsensor; ≥ 10 MSI-high, < 3 stable)" },
  { attribute: "MSI_SENSOR_SCORE", threshold: 10, stableBelow: 3, label: "MSI_SENSOR_SCORE (MSIsensor; ≥ 10 MSI-high, < 3 stable)" },
];
const MOL_COHORT_LIMIT = 6, MOL_SURVIVAL_COHORTS = 3, KM_MIN = 10;

const blank = (k: number): MolsubtypeCounts => ({ counts: new Array(k).fill(0), classified: 0, notClassifiable: 0, why: {} });
function add(to: MolsubtypeCounts, subtypes: string[], cls: string, why: string, n: number) {
  const i = subtypes.indexOf(cls);
  if (i >= 0) { to.counts[i] += n; to.classified += n; return; }
  to.notClassifiable += n;
  to.why[why || "not classifiable"] = (to.why[why || "not classifiable"] || 0) + n;
}

/** groups by size, the largest `top` kept and the rest pooled into one named Other. Pure. */
export function molTopGroups(groups: Map<string, MolsubtypeCounts>, top: number, k: number): { groups: (MolsubtypeCounts & { label: string })[]; pooled?: string[] } {
  const size = (g: MolsubtypeCounts) => g.classified + g.notClassifiable;
  const sorted = [...groups].sort((a, b) => size(b[1]) - size(a[1]) || a[0].localeCompare(b[0]));
  const kept = sorted.slice(0, top).map(([label, g]) => ({ label, ...g }));
  const rest = sorted.slice(top);
  if (!rest.length) return { groups: kept };
  const other = blank(k);
  for (const [, g] of rest) {
    g.counts.forEach((n, i) => { other.counts[i] += n; });
    other.classified += g.classified; other.notClassifiable += g.notClassifiable;
    for (const [w, n] of Object.entries(g.why)) other.why[w] = (other.why[w] || 0) + n;
  }
  return { groups: [...kept, { label: "Other (" + rest.length + ")", ...other }], pooled: rest.map(([l]) => l) };
}

/** chi-squared over rows × subtypes of classified counts, leaving out empty rows and subtypes; null below two of either */
function tableTest(rows: number[][]) {
  const r = rows.filter((x) => x.some((n) => n > 0));
  const cols = r.length ? r[0].map((_, j) => j).filter((j) => r.some((x) => x[j] > 0)) : [];
  return r.length >= 2 && cols.length >= 2 ? chiSquareTest(r.map((x) => cols.map((j) => x[j]))) : undefined;
}

export async function runMolsubtype(view: MolsubtypeView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const no = (e: string) => refuse("molsubtype", ctx, e);
  const classifier = view.classifier == null ? "endometrial" : String(view.classifier);
  const cl = CLASSIFIERS[classifier];
  if (!cl) return no("no classifier “" + classifier.slice(0, 40) + "”; the classifiers are " + Object.keys(CLASSIFIERS).map((k) => k + " (" + CLASSIFIERS[k].label + ")").join(", "));
  { const e = overLimit("a molecular-subtype view", MOL_COHORT_LIMIT, vNames.length); if (e) return no(e.replace("at most " + MOL_COHORT_LIMIT, "at most " + MOL_COHORT_LIMIT + " cohorts")); }
  const p53 = view.p53 === "nonsynonymous" ? "nonsynonymous" : "driver";
  if (p53 === "driver" && !pin) return no("no OncoKB annotation pin is available here to call an abnormal TP53 mutation; set p53 \"nonsynonymous\"");
  const by = view.by == null || view.by === "" ? null : String(view.by).trim();
  if (by && !ATTR_NAME.test(by)) return no("by is a clinical attribute name; got " + JSON.stringify(view.by).slice(0, 40));
  const top = view.top == null ? 8 : Math.floor(Number(view.top));
  if (!(top >= 1 && top <= 20)) return no("top is 1 to 20 groups");
  const m = view.msi;
  if (m && m.attribute != null && !ATTR_NAME.test(String(m.attribute))) return no("msi.attribute is a clinical attribute name");
  if (m && m.threshold != null && !(Number.isFinite(Number(m.threshold)))) return no("msi.threshold is a number");
  if (m && m.stableBelow != null && !(Number(m.stableBelow) <= Number(m.threshold ?? Infinity))) return no("msi.stableBelow is a number at or below msi.threshold");
  if (!vNames.some((n) => cohorts[n].count)) return no("nothing to classify: " + (vNames.length === 1 ? "the cohort is" : "every cohort is") + " empty");
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return no("no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));

  // the MSI rule: as given, else the first default the cohorts carry; refused naming what they have
  const msiAttrs = new Map<string, { patients: number; nvalues: number; examples: string[] }>();
  for (const st of ctx.vStudies.filter((s) => ok[s]))
    for (const n of vNames.filter((x) => cohorts[x].studies.includes(st))) {
      for (const r of await ok[st].viewAggregate("molsubtype:msi-attributes", doc.cohorts[n], (c, s, d) => molMsiAttributesSql(c, s, d))) {
        const a = String(r.attribute), x = msiAttrs.get(a) || { patients: 0, nvalues: 0, examples: [] };
        x.patients += Number(r.patients); x.nvalues = Math.max(x.nvalues, Number(r.nvalues));
        x.examples = [...new Set([...x.examples, ...((r.examples as unknown as unknown[]) || []).map(String)])].slice(0, 8);
        msiAttrs.set(a, x);
      }
    }
  const have = [...msiAttrs].map(([a, x]) => a + " (" + plural(x.patients, "patient") + ": " + x.examples.slice(0, 5).join(", ") + (x.nvalues > 5 ? ", …" : "") + ")").join("; ") || "none";
  let msi: MolMsiRule & { label: string };
  if (m && (m.attribute || m.high || m.threshold != null)) {
    const attribute = String(m.attribute || "MSI_TYPE");
    if (!msiAttrs.has(attribute)) return no("the cohorts have no " + attribute + "; their MSI attributes are " + have);
    if (m.threshold != null) msi = { attribute, threshold: Number(m.threshold), stableBelow: m.stableBelow == null ? Number(m.threshold) : Number(m.stableBelow),
      label: attribute + " (≥ " + Number(m.threshold) + " MSI-high, < " + (m.stableBelow == null ? Number(m.threshold) : Number(m.stableBelow)) + " stable)" };
    else {
      const high = (m.high || ["Instable"]).map(String), stable = (m.stable || ["Stable"]).map(String);
      msi = { attribute, high, stable, label: attribute + " (" + high.join(" / ") + " = MSI-high, " + stable.join(" / ") + " = stable)" };
    }
  } else {
    const d = MSI_DEFAULTS.find((x) => msiAttrs.has(x.attribute));
    if (!d) return no("the classifier needs an MSI call and the cohorts have none of " + MSI_DEFAULTS.map((x) => x.attribute).join(", ") + "; their MSI attributes are " + have + " — name one with msi");
    msi = d;
  }
  const opts: MolEndometrialOpts = { poleHotspots: POLE_HOTSPOTS, msi, p53Pin: p53 === "driver" ? pin : null, by };

  const k = cl.subtypes.length;
  const panels: MolsubtypePanel[] = [];
  const survival: NonNullable<import("./types.ts").MolsubtypeResult["survival"]> = [];
  const wantSurvival = view.survival !== false;
  let noSurvival: string | undefined;
  for (const [ci, n] of vNames.entries()) {
    const panel: MolsubtypePanel = { cohort: n, patients: cohorts[n].count, ...blank(k) };
    const groups = new Map<string, MolsubtypeCounts>();
    const recs = cl.subtypes.map(() => new Map<string, SurvRecord[]>());
    for (const st of cohorts[n].studies.filter((s) => ok[s])) {
      const [rows, surv] = await Promise.all([
        ok[st].viewAggregate("molsubtype:counts:" + n, doc.cohorts[n], (c, s, d) => molCountsSql(c, s, d, opts)),
        wantSurvival && ci < MOL_SURVIVAL_COHORTS ? ok[st].viewAggregate("molsubtype:survival:" + n, doc.cohorts[n], (c, s, d) => molSurvivalSql(c, s, d, opts)) : Promise.resolve([])]);
      for (const r of rows) {
        const cls = String(r.cls), why = String(r.why), cnt = Number(r.n);
        add(panel, cl.subtypes, cls, why, cnt);
        if (by) {
          const g = String(r.grp || "") || "No value recorded";
          let x = groups.get(g); if (!x) groups.set(g, x = blank(k));
          add(x, cl.subtypes, cls, why, cnt);
        }
      }
      for (const r of surv) {
        const i = cl.subtypes.indexOf(String(r.cls)); if (i < 0) continue;
        const t = Number(r.t), event = Number(r.dead) ? 1 : 0, cnt = Number(r.n);
        let a = recs[i].get(st); if (!a) recs[i].set(st, a = []);
        for (let j = 0; j < cnt; j++) a.push({ t, event });
      }
    }
    if (by) {
      const tg = molTopGroups(groups, top, k);
      panel.groups = tg.groups;
      if (tg.pooled) panel.pooled = tg.pooled;
      const t = tableTest(tg.groups.filter((g) => g.label !== "No value recorded").map((g) => g.counts));
      if (t) panel.byTest = t;
    }
    panels.push(panel);
    if (wantSurvival && ci < MOL_SURVIVAL_COHORTS) {
      const all = recs.map((byStudy) => [...byStudy.values()].flat());
      if (!all.some((a) => a.length)) { noSurvival = "no classified patient has OS_MONTHS"; continue; }
      const curves = cl.subtypes.map((subtype, i) => ({ subtype, ...kaplanMeier(all[i]) })).filter((c) => c.n > 0);
      const thin = curves.filter((c) => c.n < KM_MIN);
      let logrank = null, noTest: string | undefined;
      if (curves.length < 2) noTest = "a log-rank test needs two subtypes with patients";
      else if (thin.length) noTest = "log-rank refused: " + thin.map((c) => c.subtype + " (n=" + c.n + ")").join(", ") + (thin.length === 1 ? " has" : " have") + " fewer than " + KM_MIN + " patients";
      else {
        const studies = [...new Set(recs.flatMap((b) => [...b.keys()]))].sort();
        const keepIdx = cl.subtypes.map((_, i) => i).filter((i) => all[i].length > 0);
        logrank = logRankK(studies.map((st) => ({ groups: keepIdx.map((i) => recs[i].get(st) || []) })));
      }
      survival.push({ cohort: n, curves, logrank, ...(noTest ? { noTest } : {}) });
    }
  }
  const cohortTest = panels.length >= 2 ? tableTest(panels.map((pn) => pn.counts)) : undefined;
  const multi = ctx.vStudies.length > 1;
  const nc = panels.reduce((a, pn) => a + pn.notClassifiable, 0), ncWhy: Record<string, number> = {};
  for (const pn of panels) for (const [w, c] of Object.entries(pn.why)) ncWhy[w] = (ncWhy[w] || 0) + c;
  const p53Word = p53 === "driver" ? "a TP53 mutation the OncoKB store (" + pin + ") calls oncogenic or likely oncogenic" : "any protein-changing TP53 mutation (missense, truncating, splice, in-frame indel)";
  return {
    kind: "molsubtype", cohorts: vNames,
    molsubtype: { classifier, classifierLabel: cl.label, subtypes: cl.subtypes, msi: msi.label, p53: p53Word, poleHotspots: POLE_HOTSPOTS, by, panels,
      ...(cohortTest ? { cohortTest } : {}), ...(wantSurvival ? { survival } : {}), ...(noSurvival && !survival.length ? { noSurvival } : {}),
      ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: cl.label + " (" + cl.citation + "), applied per patient over their samples in the cohort, in this order, first match wins: " +
      "POLE-ultramutated — a somatic POLE exonuclease-domain hotspot called in any of those samples (" + POLE_HOTSPOTS.join(", ") + "; León-Castillo et al. 2020); " +
      "else MMR-deficient — MSI-high in any of those samples by " + msi.label + " (from the MSI call, not mismatch-repair immunohistochemistry, which the warehouse does not hold); " +
      "else p53-abnormal — " + p53Word + " (a sequencing proxy for p53 immunohistochemistry); else NSMP. " +
      "A patient is “not classifiable”, never put in a subtype by guess, when an input the hierarchy needs before reaching their subtype is missing: not sequenced, not profiled for POLE or TP53 (panel-aware), or no MSI-high or stable call (an indeterminate or unreported MSI result counts as none) — " +
      (nc ? plural(nc, "patient") + " here (" + Object.entries(ncWhy).map(([w, c]) => w + " " + c.toLocaleString("en-US")).join(", ") + "), kept out of the shares, tests and curves. " : "none here. ") +
      "Shares are of classified patients. " +
      (by ? "By " + by + " per patient (“Multiple” when samples disagree; the " + top + " largest groups drawn, the rest pooled into a named Other), chi-squared over group × subtype per cohort, patients without a value left out of the test. " : "") +
      (cohortTest ? "Between cohorts: chi-squared over cohort × subtype (" + cohortTest.df + " df). " : "") +
      (wantSurvival ? "Overall survival by subtype from OS_MONTHS / OS_STATUS as the study records them (for " + (vNames.length > MOL_SURVIVAL_COHORTS ? "the first " + MOL_SURVIVAL_COHORTS + " cohorts" : "each cohort") +
        "), Kaplan–Meier with a k-group log-rank" + (multi ? " stratified by study" : "") + "; OS is not corrected for left truncation (a patient sequenced years after diagnosis entered the study alive), and the subtypes differ in stage, histology and treatment, none adjusted for. " : "") +
      "A panel-based call is not the clinical assay: POLE variants outside the hotspot list, MSI by IHC, and p53 IHC patterns are not seen. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
