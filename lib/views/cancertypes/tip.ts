// The cancertypes view's bar popover, as the portal's (CancerSummaryChart, cd8c6df): what it says about one group.
import { portalRound2 } from "../../chart/format.ts";
import type { CancertypesGroup, CancertypesResult } from "./types.ts";

/** one group's popover: its header, the study it links to (null when the portal shows no link), the altered line and the type table */
export interface CancertypesTip { header: string; study: string | null; altered: string; rows: [string, string][] }

/** the types the popover lists, top of the stack first (OrderedAlterationLabelMap reversed), with the portal's names */
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
  const pct = (n: number) => portalRound2((n / g.profiled) * 100) + "%";
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
