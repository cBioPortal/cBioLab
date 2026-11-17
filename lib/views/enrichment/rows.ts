// One enrichment row from its counts, and the compact columns every listed gene travels in — the one
// rule the runner and the page both use, so a row the page rebuilds is the row the runner made.
import type { EnrichmentGene, EnrichmentColumns } from "./types.ts";
import { roundSig } from "../../chart/format.ts";

/** a gene's row: each cohort's altered share, the log2 ratio of two cohorts' shares (null when either is
 *  zero), and the cohort it is enriched in — of two, the first when its share is higher, else the second
 *  (the portal's log ratio > 0, EnrichmentsUtil); of more, the highest share, the first on a tie */
export function enrichmentRow(gene: string, groups: string[], altered: number[], profiled: number[], p: number, q: number, cytoband?: string): EnrichmentGene {
  const cells = groups.map((cohort, i) => ({ cohort, altered: altered[i], profiled: profiled[i],
    pct: profiled[i] ? Math.round(1000 * altered[i] / profiled[i]) / 10 : null }));
  const shares = cells.map((c) => c.profiled ? c.altered / c.profiled : 0);
  const best = groups.length === 2 ? (shares[0] > shares[1] ? 0 : 1) : shares.indexOf(Math.max(...shares));
  return { gene, ...(cytoband ? { cytoband } : {}), cells,
    ...(groups.length === 2 ? { log2Ratio: shares[0] > 0 && shares[1] > 0 ? Math.log2(shares[0] / shares[1]) : null } : {}),
    p, q, enrichedIn: groups[best] };
}

/** rows as columns, in their order; p and q to 4 digits, one more than the page writes */
export function toColumns(rows: EnrichmentGene[]): EnrichmentColumns {
  return {
    gene: rows.map((g) => g.gene), cytoband: rows.map((g) => g.cytoband || ""),
    altered: rows.map((g) => g.cells.map((c) => c.altered)), profiled: rows.map((g) => g.cells.map((c) => c.profiled)),
    p: rows.map((g) => roundSig(g.p, 4)), q: rows.map((g) => roundSig(g.q, 4)),
  };
}

/** the rows back from their columns */
export function fromColumns(c: EnrichmentColumns, groups: string[]): EnrichmentGene[] {
  return c.gene.map((gene, i) => enrichmentRow(gene, groups, c.altered[i], c.profiled[i], c.p[i], c.q[i], c.cytoband[i] || undefined));
}
