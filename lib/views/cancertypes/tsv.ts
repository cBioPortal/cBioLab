// The cancertypes view's Data download: the portal's cancer_types_summary.tsv (CancerSummaryChart getData).
import { categoryLabel } from "./figure.ts";
import type { CancertypesGroup, CancertypesResult } from "./types.ts";

/** our counts under the portal's keys, in its stack order (CancerSummaryContent OrderedAlterationLabelMap) */
const PORTAL_KEYS: [keyof CancertypesGroup, string][] = [["multiple", "multiple"], ["protLow", "protExpressionLow"], ["protHigh", "protExpressionHigh"],
  ["mrnaLow", "mrnaExpressionLow"], ["mrnaHigh", "mrnaExpressionHigh"], ["homdel", "homdel"], ["amp", "amp"], ["sv", "structuralVariant"], ["mutation", "mutated"]];

/** a field as d3-dsv's tsvFormatRows writes it: quoted when it holds a tab, a line break or a double quote */
const field = (s: string) => /[\t\n\r"]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;

/**
 * One panel's (or one gene tab's) shown groups as the portal's Data file: per group in the drawn order,
 * a row per kind of alteration it has — the y value unrounded, as the chart draws it, the portal's key
 * for the kind, and the count.
 */
export function cancertypesTsv(r: CancertypesResult, panel: number, gene: string | null): string {
  const pn = r.panels[panel];
  const src = gene ? pn.perGene?.find((x) => x.gene === gene) ?? pn : pn;
  const freq = r.show === "frequency";
  const rows: string[][] = [[categoryLabel(r.groupBy), freq ? "Alteration Frequency" : "Absolute Counts", "Alteration Type", "Alteration Count"]];
  for (const g of src.groups)
    for (const [k, key] of PORTAL_KEYS) {
      const n = Number(g[k] ?? 0);
      if (n) rows.push([g.label, String(freq ? (n / g.profiled) * 100 : n), key, String(n)]);
    }
  return rows.map((row) => row.map(field).join("\t")).join("\n");
}
