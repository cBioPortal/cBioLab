// Every tested gene of a diffexpr result as compact columns, and back: what the page's table and
// volcano draw past the result's 1,500 points, as the portal's tab lists every gene.
import type { DiffexprGene, DiffexprColumns, DiffexprResult } from "./types.ts";
import { roundPlaces, roundSig } from "../../chart/format.ts";

/** genes as columns, in their order; means, SDs and differences to 3 places and p, q to 4 digits, one
 *  more than the page writes, so 20,000 genes stay a few MB */
export function toColumns(genes: DiffexprGene[], two: boolean): DiffexprColumns {
  const r3 = (xs: number[]) => xs.map((x) => roundPlaces(x, 3));
  return {
    gene: genes.map((g) => g.gene), cytoband: genes.map((g) => g.cytoband || ""),
    n: genes.map((g) => g.n), mean: genes.map((g) => r3(g.mean)), sd: genes.map((g) => r3(g.sd)),
    ...(two ? { effect: genes.map((g) => roundPlaces(g.effect ?? 0, 3)) } : {}),
    p: genes.map((g) => roundSig(g.p, 4)), q: genes.map((g) => roundSig(g.q, 4)),
  };
}

/** the genes back from their columns (without t and F, which the columns do not carry) */
export function fromColumns(c: DiffexprColumns): DiffexprGene[] {
  return c.gene.map((gene, i) => ({ gene, n: c.n[i], mean: c.mean[i], sd: c.sd[i], ...(c.effect ? { effect: c.effect[i] } : {}),
    p: c.p[i], q: c.q[i], ...(c.cytoband[i] ? { cytoband: c.cytoband[i] } : {}) }));
}

/** the result with every tested gene as its points, the volcano drawing each one: what the page draws */
export function withEveryGene(d: DiffexprResult): DiffexprResult {
  if (!d.all) return d;
  return { ...d, points: fromColumns(d.all), all: undefined, pooledSignificant: 0, ...(d.grid ? { grid: { ...d.grid, cells: [] } } : {}) };
}
