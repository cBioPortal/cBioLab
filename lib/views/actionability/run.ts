// Actionability view: each sequenced patient's highest OncoKB therapeutic level, per cohort (and per
// group of an attribute), and its concordance between a patient's primary and metastatic samples.
import type { ViewResult } from "../../types.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, plural, ATTR_NAME } from "../shared.ts";
import type { ActionabilityView, ActionabilityPanel, ActionLevels } from "./types.ts";
import { actionLevelsSql, actionConcordanceSql, actionStoreTypesSql } from "./sql.ts";

export const ACTION_LEVELS = ["Level 1", "Level 2", "Level 3A", "Level 3B", "Level 4", "No level"];
export const ACTION_RESISTANCE = ["R1", "R2"];
/** an SQL rank (1–5 sensitive, 9 none; 1–2 resistance, 9 none) to its index in ACTION_LEVELS / ACTION_RESISTANCE */
const levelIdx = (rank: number) => rank >= 1 && rank <= 5 ? rank - 1 : 5;
const NO_VALUE = "No value recorded", MULTIPLE_LABEL = "Multiple (samples disagree)";

const blank = (): ActionLevels => ({ sequenced: 0, levels: [0, 0, 0, 0, 0, 0], resistance: [0, 0] });
function add(to: ActionLevels, level: number, resistance: number, n: number) {
  to.sequenced += n; to.levels[levelIdx(level)] += n;
  if (resistance === 1 || resistance === 2) to.resistance[resistance - 1] += n;
}

/** groups by size, the largest `top` kept and the rest pooled into one "Other", named. Pure. */
export function topGroups(groups: Map<string, ActionLevels>, top: number): { groups: (ActionLevels & { label: string })[]; pooled?: string[] } {
  const sorted = [...groups].sort((a, b) => b[1].sequenced - a[1].sequenced || a[0].localeCompare(b[0]));
  const kept = sorted.slice(0, top).map(([label, g]) => ({ label, ...g }));
  const rest = sorted.slice(top);
  if (!rest.length) return { groups: kept };
  const other = blank();
  for (const [, g] of rest) {
    other.sequenced += g.sequenced;
    g.levels.forEach((n, i) => { other.levels[i] += n; });
    g.resistance.forEach((n, i) => { other.resistance[i] += n; });
  }
  return { groups: [...kept, { label: "Other (" + rest.length + ")", ...other }], pooled: rest.map(([l]) => l) };
}

export async function runActionability(view: ActionabilityView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const no = (e: string) => refuse("actionability", ctx, e);
  if (!pin) return no("no OncoKB annotation pin is available here, so therapeutic levels cannot be read");
  { const e = overLimit("an actionability view", 4, vNames.length); if (e) return no(e.replace("at most 4", "at most 4 cohorts")); }
  const groupBy = view.groupBy == null || view.groupBy === "" ? null : String(view.groupBy).trim();
  if (groupBy && !ATTR_NAME.test(groupBy)) return no("groupBy is a categorical attribute name; got " + JSON.stringify(view.groupBy).slice(0, 40));
  const top = view.top == null ? 8 : Math.floor(Number(view.top));
  if (!(top >= 1 && top <= 30)) return no("top is 1 to 30 groups");
  const vals = (x: unknown) => Array.isArray(x) ? x.map(String) : x == null ? [] : [String(x)];
  const pb = view.pairBy === null ? null : view.pairBy ?? { attribute: "SAMPLE_TYPE", a: ["Primary"], b: ["Metastasis"] };
  const pairBy = pb ? { attribute: String(pb.attribute), a: vals(pb.a), b: vals(pb.b) } : null;
  if (pairBy) {
    if (!ATTR_NAME.test(String(pairBy.attribute)) || !pairBy.a.length || !pairBy.b.length) return no("pairBy is {attribute, a:[values], b:[values]}, or null for no concordance");
    if (pairBy.a.some((x) => pairBy.b.map((y) => y.toLowerCase()).includes(x.toLowerCase()))) return no("pairBy's two sides share a value");
  }
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length === vNames.length) return no("nothing to count: " + (vNames.length === 1 ? "the cohort is" : "every cohort is") + " empty");
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return no("no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const first = Object.values(ok)[0];
  const storeRows = await first.viewMeta("actionability:store", (s, d) => actionStoreTypesSql(s, d, pin));
  const storeTypes = storeRows.filter((r) => Number(r.n) > 0).map((r) => String(r.type));

  const panels: ActionabilityPanel[] = [];
  for (const n of vNames) {
    const def = doc.cohorts[n];
    const total = blank(), groups = new Map<string, ActionLevels>();
    let table: number[][] | null = pairBy ? Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]) : null;
    await Promise.all(cohorts[n].studies.filter((st) => ok[st]).map(async (st) => {
      const [lv, cc] = await Promise.all([
        ok[st].viewAggregate("actionability:levels:" + n, def, (c, s, d) => actionLevelsSql(c, s, d, pin, groupBy)),
        pairBy ? ok[st].viewAggregate("actionability:concordance:" + n, def, (c, s, d) => actionConcordanceSql(c, s, d, pin, pairBy)) : Promise.resolve([])]);
      for (const r of lv) {
        const level = Number(r.level), res = Number(r.resistance), k = Number(r.n);
        add(total, level, res, k);
        if (groupBy) {
          const g = String(r.grp || "") === "" ? NO_VALUE : String(r.grp) === "Multiple" ? MULTIPLE_LABEL : String(r.grp);
          let x = groups.get(g); if (!x) groups.set(g, x = blank());
          add(x, level, res, k);
        }
      }
      for (const r of cc) table![levelIdx(Number(r.a))][levelIdx(Number(r.b))] += Number(r.n);
    }));
    const pairs = table ? table.flat().reduce((a, b) => a + b, 0) : 0;
    if (table && !pairs) table = null;
    panels.push({ cohort: n, patients: cohorts[n].count, ...total,
      ...(groupBy ? topGroups(groups, top) : {}),
      ...(table ? { concordance: { pairs, table, discordant: pairs - table.reduce((a, row, i) => a + row[i], 0) } } : {}) });
  }
  if (!panels.some((p) => p.sequenced)) return no("no patient of " + (vNames.length === 1 ? "the cohort" : "these cohorts") + " has a sample sequenced for mutations");
  const share = (k: number, d: number) => d ? (100 * k / d).toFixed(1) + "%" : "–";
  const pairNote = !pairBy ? "" : panels.some((p) => p.concordance)
    ? "Concordance: patients with a sequenced sample whose " + pairBy.attribute + " is " + pairBy.a.join("/") + " and one whose is " + pairBy.b.join("/") +
      " (matched case-insensitively), the highest level over each side's samples compared — " +
      panels.filter((p) => p.concordance).map((p) => "“" + p.cohort + "”: " + plural(p.concordance!.pairs, "patient") + ", " + share(p.concordance!.discordant, p.concordance!.pairs) + " discordant").join("; ") +
      ". A level present on one side only can be a real difference between the tumours, or a gene one side's panel did not cover. "
    : "No patient had a sequenced sample on both sides of " + pairBy.attribute + " (" + pairBy.a.join("/") + " against " + pairBy.b.join("/") + "), so no concordance is drawn. ";
  return {
    kind: "actionability", cohorts: vNames,
    actionability: { pin, levels: ACTION_LEVELS, groupBy, top, pairBy, panels, storeTypes, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Each patient's highest OncoKB therapeutic level (" + pin + ", the pinned store) over the alterations in any of their samples in the cohort sequenced for mutations — called mutations and high-level copy-number calls" +
      (storeTypes.includes("SV") ? ", and structural variants" : "; the store holds no level for structural variants at this pin, so a fusion is never counted") +
      " — and, separately, whether any alteration carries a resistance level (R1, R2). " +
      "The level is the store's highest for the alteration in ANY cancer type, not in the patient's own: an alteration actionable only elsewhere (PTEN or PIK3CA, level 1 with capivasertib in breast cancer, in any other cancer) counts here, so these shares are an upper bound on what is actionable for these patients. " +
      "Denominator: patients with at least one sample in the cohort sequenced for mutations — " + panels.map((p) => "“" + p.cohort + "”: " + p.sequenced.toLocaleString("en-US") + " of " + p.patients.toLocaleString("en-US")).join("; ") +
      ". Panel-aware in the only way a level can be: a gene their panel did not cover is unknown, not \"no actionable alteration\" — No level means none was found on the genes sequenced. " +
      (groupBy ? "Groups are " + groupBy + " per patient (" + MULTIPLE_LABEL + " when their samples disagree); the " + top + " largest are drawn and the rest pooled into Other" +
        (panels.some((p) => p.pooled) ? " (" + panels.filter((p) => p.pooled).map((p) => "“" + p.cohort + "”: " + p.pooled!.length + " groups").join("; ") + ")" : "") + ". " : "") +
      pairNote +
      (ctx.vStudies.length > 1 ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
