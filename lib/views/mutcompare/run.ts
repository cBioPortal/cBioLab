// Mutcompare view: one gene's mutations in two cohorts, as cBioPortal's group-comparison Mutations tab
// shows them — a lollipop each, and every protein change tested between them.
import type { ViewResult } from "../../types.ts";
import { enrichAlteredSql, enrichPanelProfiledSql, enrichWesSql } from "../../federation-views.ts";
import { buildLollipopGene, fetchProteinInfo, checkHide } from "../../lollipop.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import { fisherExact, benjaminiHochberg } from "../../stats.ts";
import type { LollipopReport } from "../../federation.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { answering, refuse, askEachSite } from "../shared.ts";
import type { MutcompareView, MutcompareRow, MutcompareGroup } from "./types.ts";
import { mutcompareProfiledSql } from "./sql.ts";
import { mutcompareMethod } from "./method.ts";

/** the genes the picker lists before anything is typed, as the portal's (its first 200) */
const RANKED = 200;
/** the portal's own words for a comparison of other than two groups */
export const NOT_ENOUGH = "We need 2 groups to show mutations. Please select more groups from the Groups section above.";
export const TOO_MANY = "We can't show mutations for more than 2 groups. Please deselect groups in the Groups section.";

const share = (n: number, of: number) => of > 0 ? 100 * n / of : 0;

/** What is wrong with a view's `codons` (a list of protein positions), or null. */
export function checkCodonList(codons: unknown): string | null {
  if (codons == null) return null;
  if (!Array.isArray(codons) || codons.some((p) => typeof p !== "number" || !Number.isInteger(p) || p < 0)) return "positions is a list of protein positions, like [175, 248]";
  return codons.length > 500 ? "positions: at most 500" : null;
}

/**
 * The table's rows from each cohort's per-change patient counts: a row per protein change (the
 * portal merges by gene and change), both cohorts' shares of their profiled patients, the log2 ratio,
 * a two-sided Fisher test per change and Benjamini–Hochberg across the changes, most significant first.
 */
export function compareChanges(names: [string, string], changes: [Map<string, ChangeCount>, Map<string, ChangeCount>], profiled: [number, number]): MutcompareRow[] {
  const keys = [...new Set([...changes[0].keys(), ...changes[1].keys()])];
  const rows: MutcompareRow[] = keys.map((change) => {
    const a = changes[0].get(change), b = changes[1].get(change);
    const n: [number, number] = [a?.n || 0, b?.n || 0];
    const pct: [number, number] = [share(n[0], profiled[0]), share(n[1], profiled[1])];
    const p = fisherExact(n[0], Math.max(0, profiled[0] - n[0]), n[1], Math.max(0, profiled[1] - n[1]));
    const top = a && b ? (a.rows >= b.rows ? a : b) : (a || b)!;
    return { change, pos: top.pos, impact: top.impact || "other", driver: !!(a?.driver || b?.driver), n, pct,
      log2Ratio: pct[0] > 0 && pct[1] > 0 ? Math.log2(pct[0] / pct[1]) : null, p, q: 1,
      // the portal's: log ratio > 0 is the first group, anything else (a tie, 0/0) the second
      enrichedIn: pct[0] > pct[1] ? names[0] : names[1] };
  });
  rows.sort((x, y) => x.p - y.p || (x.change < y.change ? -1 : x.change > y.change ? 1 : 0));
  benjaminiHochberg(rows.map((r) => r.p)).forEach((q, i) => { rows[i].q = q; });
  return rows;
}
export interface ChangeCount { n: number; rows: number; pos: number | null; impact?: string; driver: boolean }

/** One cohort's changes in the gene, pooled across its studies (a patient in two studies is not deduplicated). */
function changesOf(gene: string, reports: LollipopReport[]): Map<string, ChangeCount> {
  const out = new Map<string, ChangeCount>();
  for (const r of reports) for (const c of r.changes) if (c.gene === gene) {
    const cur = out.get(c.change);
    if (cur) { cur.n += c.n; cur.rows += c.rows; cur.driver ||= c.driver; cur.impact ||= c.impact; if (cur.pos == null) cur.pos = c.pos; }
    else out.set(c.change, { n: c.n, rows: c.rows, pos: c.pos, driver: c.driver, ...(c.impact ? { impact: c.impact } : {}) });
  }
  return out;
}

export async function runMutcompare(view: DocView, ctx: ViewRun): Promise<ViewResult | Untimed> {
  const mv = view as MutcompareView;
  const { doc, cohorts, vNames, pin } = ctx;
  if (vNames.length < 2) return untimed(refuse("mutcompare", ctx, NOT_ENOUGH + " (a mutcompare view compares exactly 2 cohorts; this one draws " + vNames.length + ")"));
  if (vNames.length > 2) return untimed(refuse("mutcompare", ctx, TOO_MANY + " (a mutcompare view compares exactly 2 cohorts; this one draws " + vNames.length + ")"));
  const axis = mv.axis ?? "percent";
  if (axis !== "percent" && axis !== "count") return untimed(refuse("mutcompare", ctx, "axis is \"percent\" or \"count\"; got " + JSON.stringify(mv.axis).slice(0, 30)));
  { const e = checkHide(mv.hide) || checkCodonList(mv.positions); if (e) return untimed(refuse("mutcompare", ctx, e)); }
  let asked: string | null = null;
  if (mv.gene != null) {
    asked = geneSymbols([mv.gene])[0] || null;
    if (!asked) return untimed(refuse("mutcompare", ctx, "gene is one gene symbol, like TP53; got " + JSON.stringify(mv.gene).slice(0, 30)));
  }
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return untimed(refuse("mutcompare", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty"));
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return untimed(refuse("mutcompare", ctx, "no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; ")));
  const names = vNames as [string, string];

  // the picker's ranking: each gene's mutated samples over the samples profiled for it, in each cohort,
  // ordered by the higher of the two shares — the portal's genesSortedByMutationFrequency
  const ranked = await askEachSite(ctx, ok, (n, _st, r) => Promise.all([
    r.viewAggregate("mutcompare:mutated:" + n, doc.cohorts[n], (c, s, d) => enrichAlteredSql(c, s, d, "mutation", pin, false)),
    r.viewAggregate("mutcompare:panels:" + n, doc.cohorts[n], (c, s, d) => enrichPanelProfiledSql(c, s, d, "mutation")),
    r.viewAggregate("mutcompare:wes:" + n, doc.cohorts[n], (c, s, d) => enrichWesSql(c, s, d, "mutation"))
  ]));
  const altered = new Map<string, number>(), panel = new Map<string, number>(), wes = new Map<string, number>();
  for (const { cohort: n, answer: [a, pr, w] } of ranked) {
    for (const r of a) altered.set(n + "\t" + r.gene, (altered.get(n + "\t" + r.gene) || 0) + Number(r.altered));
    for (const r of pr) panel.set(n + "\t" + r.gene, (panel.get(n + "\t" + r.gene) || 0) + Number(r.profiled));
    wes.set(n, (wes.get(n) || 0) + Number(w[0]?.n || 0));
  }
  const genes = new Set([...altered.keys()].map((k) => k.split("\t")[1]));
  const ranking = [...genes].map((g) => ({ gene: g, pct: Math.max(...names.map((n) => {
    const prof = (panel.get(n + "\t" + g) || 0) + (wes.get(n) || 0);
    return prof ? share(altered.get(n + "\t" + g) || 0, prof) : 0;
  })) })).filter((r) => r.pct > 0).sort((a, b) => b.pct - a.pct || (a.gene < b.gene ? -1 : 1)).slice(0, RANKED);
  const gene = asked || ranking[0]?.gene;
  if (!gene) return untimed(refuse("mutcompare", ctx, "There are no mutations available. (No gene has a mutation in a profiled sample of either cohort.)"));

  const [counts, profiledAnswers, protein] = await Promise.all([
    askEachSite(ctx, ok, (n, _st, r) => r.lollipopCounts(doc.cohorts[n], [gene], 1)),
    askEachSite(ctx, ok, (n, _st, r) => r.viewAggregate("mutcompare:profiled:" + n, doc.cohorts[n], (c, s, d) => mutcompareProfiledSql(c, s, d, gene))),
    fetchProteinInfo(gene)
  ]);
  const reportsOf = (n: string) => counts.filter((x) => x.cohort === n).map((x) => x.answer);
  const profiledOf = (n: string) => profiledAnswers.filter((x) => x.cohort === n).reduce((a, x) => a + Number(x.answer[0]?.n || 0), 0);
  const groups = names.map((n): MutcompareGroup => {
    const lollipop = buildLollipopGene(gene, reportsOf(n), protein);
    return { name: n, profiled: profiledOf(n), mutated: lollipop.mutated, lollipop };
  }) as [MutcompareGroup, MutcompareGroup];
  // both plots on one protein axis: the longer of the two when Genome Nexus could not say
  const len = Math.max(groups[0].lollipop.proteinLength, groups[1].lollipop.proteinLength);
  for (const g of groups) g.lollipop.proteinLength = len;
  const profiled: [number, number] = [groups[0].profiled, groups[1].profiled];
  const rows = compareChanges(names, [changesOf(gene, reportsOf(names[0])), changesOf(gene, reportsOf(names[1]))], profiled);
  const geneP = fisherExact(groups[0].mutated, Math.max(0, profiled[0] - groups[0].mutated), groups[1].mutated, Math.max(0, profiled[1] - groups[1].mutated));
  const annotated = counts.every((x) => x.answer.annotated);
  const none = !groups[0].mutated && !groups[1].mutated;
  const hide = [...new Set(mv.hide || [])].sort();
  const codons = [...new Set(mv.positions || [])].sort((a, b) => a - b);
  const multi = ctx.vStudies.length > 1;
  const f = (n: number) => n.toLocaleString("en-US");
  const unpositioned = groups.reduce((n, g) => n + g.lollipop.unpositioned, 0);
  return {
    kind: "mutcompare", cohorts: vNames,
    mutcompare: { gene, ranking, groups, rows, geneP, axis, annotated,
      ...(none ? { empty: profiled[0] + profiled[1] ? "Selected gene has no mutations for profiled samples." : "Selected gene has no mutations due to no profiled samples." } : {}) },
    ...(hide.length ? { hide } : {}), ...(codons.length ? { positions: codons } : {}),
    method: mutcompareMethod({ gene, cohorts: names, profiled, rows, geneP, mutated: [groups[0].mutated, groups[1].mutated] }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Every share is of the cohort's patients with a sample profiled for " + gene + " (a panel listing it, or whole-exome): " +
      f(profiled[0]) + " in “" + names[0] + "”, " + f(profiled[1]) + " in “" + names[1] + "”. " +
      "Each protein change counts the patients carrying it in one of the cohort's samples; uncalled mutations are left out, VUS and germline mutations kept, as on the portal. " +
      "p is a two-sided Fisher's exact test of carriers against the rest of the profiled patients, per change; q is Benjamini–Hochberg across the " + f(rows.length) + " changes listed. " +
      "A stem's height is the distinct patient + protein change pairs at that codon" + (axis === "percent" ? ", as a share of the profiled patients" : "") + ", as the portal draws it. " +
      "The gene picker ranks genes by their higher share of mutated samples over profiled samples in the two cohorts, as the portal's does. " +
      (annotated ? "Driver = OncoKB oncogenic (" + pin + "). " : "No OncoKB pin, so every mutation is coloured as a driver, as the portal does with annotation off. ") +
      (unpositioned ? f(unpositioned) + " mutation" + (unpositioned === 1 ? " has" : "s have") + " no protein position and " + (unpositioned === 1 ? "is" : "are") + " in the table but not drawn. " : "") +
      (protein ? "" : "Genome Nexus could not be reached for " + gene + ", so the axis runs to the highest codon seen and no domains are drawn. ") +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; a patient in more than one is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
