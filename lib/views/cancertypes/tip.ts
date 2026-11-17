// The cancertypes view's bar popover, as the portal's (CancerSummaryChart, cd8c6df): what it says about one group.
import { portalRound2 } from "../../chart/format.ts";
import { compactDrivers } from "../../driver-settings.ts";
import { parseOql } from "../../oql-parse.ts";
import { defaultProfiles, EVERY_STUDY, type QueryOptions } from "../../query-options.ts";
import type { ProfileInfo } from "../../profile-catalog.ts";
import type { CancertypesGroup, CancertypesResult, CancertypesView } from "./types.ts";

/** one group's popover: its header, the study it links to (null when the portal shows no link), the altered line and the type table */
export interface CancertypesTip { header: string; study: string | null; altered: string; rows: [string, string][] }

/** the types the popover lists, in the portal's order (OrderedAlterationLabelMap reversed), with its names */
const TIP_KINDS: [keyof CancertypesGroup, string][] = [["mutation", "Mutation"], ["sv", "Structural Variant"], ["amp", "Amplification"],
  ["homdel", "Deep Deletion"], ["mrnaHigh", "mRNA High"], ["mrnaLow", "mRNA Low"], ["protHigh", "Protein High"], ["protLow", "Protein Low"],
  ["multiple", "Multiple Alterations"]];

/**
 * Group `key`'s popover in a panel (or one gene's tab), or null when that group is not drawn there: "Summary for
 * <group>" — or, grouped by study with more than one study drawn, the study's name to link (CTS-MD-2); "Gene altered
 * in P% of N patients" (formatGeneAlteredText); a row per type with a count, "p% (n patients)" (formatFrequencyText),
 * percentages as lodash's round to two places (percentageRounder).
 */
export function cancertypesTip(r: CancertypesResult, panel: number, gene: string | null, key: string): CancertypesTip | null {
  const pn = r.panels[panel];
  const src = gene ? pn.perGene?.find((x) => x.gene === gene) ?? pn : pn;
  const g = src.groups.find((x) => x.key === key);
  if (!g) return null;
  const links = r.groupBy === "study" && src.groups.length > 1;
  const pct = (n: number) => portalRound2(g.profiled ? (n / g.profiled) * 100 : 0) + "%";
  const unit = r.unit, units = unit + "s";
  return {
    header: links ? g.label : "Summary for " + g.label,
    study: links ? g.key : null,
    altered: "Gene altered in " + pct(g.altered) + " of " + g.profiled + " " + units,
    rows: TIP_KINDS.filter(([k]) => Number(g[k] ?? 0) > 0).map(([k, name]) => {
      const n = Number(g[k]);
      return [name, pct(n) + " (" + n + " " + (n === 1 ? unit : units) + ")"];
    }),
  };
}

/** what "Query this study" opens: the Results page's query and options, or why it cannot open what the bar counts */
export type CancertypesStudyQuery = { query: string; options: QueryOptions | null } | { why: string };

/**
 * "Query this study" (CancerSummaryContainer handleStudyLinkout): the page's query for one study, its gene
 * list this gene's on a gene tab. Here a gene tab keeps that gene's OQL lines, so the Results page counts
 * what the bar counts. A study grouped from several studies takes the page's options (`page`, null when the
 * card is not on a Results page) only as a one-study link can: the default profiles of every study and
 * "All" cases are the link's own default (no options); any other choice, and a count the link cannot carry
 * (drivers by measure or by the view's own driver settings, EXP / PROT profiles), is refused with its reason.
 */
export function cancertypesStudyQuery(view: Pick<CancertypesView, "oql" | "measure" | "drivers" | "exp" | "prot">, genes: string[],
  gene: string | null, page: QueryOptions | null, catalog: ProfileInfo[]): CancertypesStudyQuery {
  if (view.measure === "driver") return { why: "this chart counts OncoKB drivers only (measure \"driver\"), which a Results link cannot ask for" };
  const own = compactDrivers(view.drivers ?? {});
  if (own) return { why: "this chart reads DRIVER by its own driver settings, which a Results link cannot carry" };
  if (view.exp || view.prot) return { why: "this chart reads EXP / PROT in a chosen profile, which a link to one study cannot carry" };
  const lines = view.oql ? view.oql.filter((l) => !gene || parseOql(l)[0]?.gene === gene) : gene ? [gene] : genes;
  if (!lines.length) return { why: "no line of the query is for " + gene };
  if (page) {
    if (page.caseSet !== "all") return { why: "the page's case set is for the selected studies together; a link to one study opens all its cases" };
    const want = defaultProfiles(catalog, 2), chosen = page.profiles;
    const keys = new Set([...Object.keys(want), ...Object.keys(chosen)]) as Set<keyof QueryOptions["profiles"]>;
    if ([...keys].some((k) => chosen[k] !== want[k] || chosen[k] !== EVERY_STUDY))
      return { why: "the page's profile choice is not the default, which a link to one study cannot carry" };
  }
  return { query: lines.join("\n"), options: null };
}
