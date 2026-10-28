// Driver-negative view: within one cohort, patients with no OncoKB driver in a canonical driver list
// against those with one, and every other gene's alteration frequency compared between the two.
import type { ViewResult } from "../../types.ts";
import { type EnrichAlteration } from "../../federation-views.ts";
import { fisherExact, benjaminiHochberg } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, plural, cytobands } from "../shared.ts";
import type { DrivernegativeView, DrivernegativeGene } from "./types.ts";
import { dnegGroupsSql, dnegAlteredSql, dnegProfiledSql } from "./sql.ts";

/** the canonical NSCLC drivers (targetable oncogenes) */
export const DNEG_DEFAULT_DRIVERS = ["EGFR", "KRAS", "ALK", "ROS1", "BRAF", "MET", "RET", "ERBB2", "NTRK1", "NTRK2", "NTRK3"];
export const DNEG_MAX_DRIVERS = 40;
const DNEG_ROWS = 300;
const WORD: Partial<Record<EnrichAlteration, string>> = { mutation: "mutation", sv: "structural variant (either partner)", cna: "amplification or deep deletion" };

/** per gene: the two groups' counts, Fisher, log2 of the negative share over the positive one; BH over all. Pure. */
export function dnegTest(altered: Map<string, [number, number]>, profiled: Map<string, [number, number]>, wes: [number, number], minAltered: number):
  { tested: DrivernegativeGene[]; untested: number } {
  const tested: DrivernegativeGene[] = [];
  let untested = 0;
  for (const [gene, alt] of altered) {
    const pr = profiled.get(gene) || [0, 0];
    const prof: [number, number] = [pr[0] + wes[0], pr[1] + wes[1]];
    if (alt[0] + alt[1] < minAltered || !prof[0] || !prof[1]) { untested++; continue; }
    const p = fisherExact(alt[0], prof[0] - alt[0], alt[1], prof[1] - alt[1]);
    const s0 = alt[0] / prof[0], s1 = alt[1] / prof[1];
    tested.push({ gene, altered: alt, profiled: prof, log2Ratio: s0 > 0 && s1 > 0 ? Math.log2(s0 / s1) : null, p, q: 1 });
  }
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => a.p - b.p || a.gene.localeCompare(b.gene));
  return { tested, untested };
}

export async function runDrivernegative(view: DrivernegativeView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const no = (e: string) => refuse("drivernegative", ctx, e);
  if (vNames.length !== 1) return no("a driver-negative view splits one cohort; this one draws " + vNames.length);
  if (!pin) return no("no OncoKB annotation pin is available here, so drivers cannot be called");
  const drivers = [...new Set((Array.isArray(view.drivers) && view.drivers.length ? view.drivers : DNEG_DEFAULT_DRIVERS).map((g) => String(g).trim().toUpperCase()).filter(Boolean))];
  { const e = overLimit("a driver-negative view", DNEG_MAX_DRIVERS, drivers.length); if (e) return no(e.replace("at most " + DNEG_MAX_DRIVERS, "at most " + DNEG_MAX_DRIVERS + " driver genes")); }
  const badGene = drivers.find((g) => !/^[A-Z0-9_.-]{1,40}$/.test(g));
  if (badGene) return no("'" + badGene.slice(0, 40) + "' is not a gene symbol");
  const alteration = (view.alteration || "mutation") as EnrichAlteration;
  if (!WORD[alteration]) return no("alteration is mutation, sv or cna; got " + JSON.stringify(view.alteration).slice(0, 30));
  const measure: "any" | "driver" = view.measure === "driver" ? "driver" : "any";
  const minAltered = view.minAltered == null ? 5 : Math.floor(Number(view.minAltered));
  if (!(minAltered >= 1 && minAltered <= 10000)) return no("minAltered is 1 to 10000");
  const labelN = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(labelN >= 0 && labelN <= 40)) return no("label is 0 to 40 genes");
  const n = vNames[0];
  if (!cohorts[n].count) return no("nothing to split: cohort “" + n + "” is empty");
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return no("no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));

  const def = doc.cohorts[n];
  const groups = { positive: 0, negative: 0, unprofiled: 0 };
  const altered = new Map<string, [number, number]>(), profiled = new Map<string, [number, number]>();
  const wes: [number, number] = [0, 0];
  const idx = (g: unknown) => String(g) === "negative" ? 0 : 1;
  for (const st of cohorts[n].studies.filter((s) => ok[s])) {
    const [gr, al, pr] = await Promise.all([
      ok[st].viewAggregate("drivernegative:groups", def, (c, s, d) => dnegGroupsSql(c, s, d, pin, drivers)),
      ok[st].viewAggregate("drivernegative:altered", def, (c, s, d) => dnegAlteredSql(c, s, d, pin, drivers, alteration, measure === "driver")),
      ok[st].viewAggregate("drivernegative:profiled", def, (c, s, d) => dnegProfiledSql(c, s, d, pin, drivers, alteration))]);
    for (const r of gr) { const k = String(r.grp) as keyof typeof groups; if (k in groups) groups[k] += Number(r.n); }
    for (const r of al) { const g = String(r.gene); let x = altered.get(g); if (!x) altered.set(g, x = [0, 0]); x[idx(r.grp)] += Number(r.altered); }
    for (const r of pr) {
      if (String(r.gene) === "") { wes[idx(r.grp)] += Number(r.profiled); continue; }
      const g = String(r.gene); let x = profiled.get(g); if (!x) profiled.set(g, x = [0, 0]); x[idx(r.grp)] += Number(r.profiled);
    }
  }
  const sequenced = groups.positive + groups.negative + groups.unprofiled;
  if (!sequenced) return no("no patient of “" + n + "” has a sample sequenced for mutations");
  if (!groups.negative || !groups.positive) return no("every fully profiled patient of “" + n + "” is driver-" + (groups.negative ? "negative" : "positive") + " for " + drivers.join(", ") + ", so there is nothing to compare (" +
    plural(groups.positive, "driver-positive patient") + ", " + plural(groups.negative, "driver-negative") + ", " + plural(groups.unprofiled, "not fully profiled") + ")");
  const { tested, untested } = dnegTest(altered, profiled, wes, minAltered);
  const rows = tested.slice(0, DNEG_ROWS);
  const bands = await cytobands(ok, rows.map((g) => g.gene));
  for (const g of rows) { const b = bands.get(g.gene); if (b) g.cytoband = b; }
  const significant = tested.filter((g) => g.q < 0.05).length;
  const labels = tested.filter((g) => g.q < 0.05).slice(0, labelN).map((g) => g.gene);
  const pct = (k: number, d: number) => d ? (100 * k / d).toFixed(1) + "%" : "–";
  const word = WORD[alteration]!;
  const multi = ctx.vStudies.length > 1;
  return {
    kind: "drivernegative", cohorts: vNames,
    drivernegative: { drivers, alteration: word, measure, minAltered, patients: cohorts[n].count, sequenced, ...groups,
      tested: tested.length, untested, significant, rows, labels, ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: "Of the " + plural(sequenced, "patient") + " of “" + n + "” sequenced for mutations, " + groups.positive.toLocaleString("en-US") + " (" + pct(groups.positive, sequenced) + ") carry an OncoKB driver (" + pin + ") — a called mutation, a high-level copy-number call or a structural variant the store calls oncogenic or likely oncogenic — in " + drivers.join(", ") +
      "; " + groups.negative.toLocaleString("en-US") + " (" + pct(groups.negative, sequenced) + ") carry none and were sequenced on a panel covering every one of those genes (or whole-exome): the driver-negative group. " +
      groups.unprofiled.toLocaleString("en-US") + " (" + pct(groups.unprofiled, sequenced) + ") carry none but were not profiled for every listed gene, so are neither — kept out of both sides, never counted as driver-negative. " +
      "Coverage is read from the mutation panels and calls from the cohort's own samples only; a fusion driver is called only where the study reports structural variants. " +
      "Then every other gene's " + word + (measure === "driver" ? " (OncoKB drivers only)" : "") + " frequency is compared between driver-negative and driver-positive patients, in PATIENTS over the patients profiled for that gene (a panel that lists it, or whole-exome; an off-panel call is left out), two-sided Fisher's exact test, Benjamini–Hochberg q over the " + plural(tested.length, "gene") + " tested; " +
      untested.toLocaleString("en-US") + " altered genes were not tested (fewer than " + minAltered + " altered patients, or not profiled in a group). The log ratio is log2 of the driver-negative share over the driver-positive one. " +
      "Driver-positive tumours are often mutually exclusive with other drivers by biology, so a gene enriched in the driver-negative group is a candidate alternative driver, not a proven one; smoking history and tumour mutation burden also differ between the groups and are not adjusted for. " +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
