// The Mutations tab's greyed gene chip (MUT-GT-2). Legacy (cbioportal-frontend at cd8c6df):
//   M    = src/pages/resultsView/mutation/Mutations.tsx — 129-160 generateTabs: every gene a tab, greyed (#bbb)
//          when its mutationsByGene list is empty, still a tab
//   RVPS = src/pages/resultsView/ResultsViewPageStore.ts — 3629-3768 mutationsByGene: mutations plus structural
//          variants as fusion rows, the query's OQL when the tab follows it, and the tab's filtering settings
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutationsChipEmpties, resultsLayout } from "../app/portal/results-layout.ts";
import type { View } from "../lib/types.ts";

type Tally = Record<"missense" | "truncating" | "inframe" | "splice" | "fusion" | "other", { driver: number; vus: number }>;
const zero = (): Tally => ({ missense: { driver: 0, vus: 0 }, truncating: { driver: 0, vus: 0 }, inframe: { driver: 0, vus: 0 },
  splice: { driver: 0, vus: 0 }, fusion: { driver: 0, vus: 0 }, other: { driver: 0, vus: 0 } });
const gene = (g: string, mutated: number, tally: Tally) => ({ gene: g, mutated, mutations: mutated, positions: [], domains: [], proteinLength: 100,
  lengthSource: "observed", unpositioned: 0, withheld: 0, topChanges: [], somaticSamples: mutated, cohortSamples: 200, tally });

test("G1: .view is the lollipop view over every chip gene, without codons, table, yMax and hide", () => {
  const lolli = { kind: "hotspots", genes: ["KRAS"], cohorts: ["Queried"], oql: ["KRAS: MUT=G12D"], useOql: true, drivers: {},
    codons: { KRAS: [12] }, table: { gene: "KRAS", search: "x" }, yMax: { KRAS: 9 }, hide: ["missense:vus"] };
  const tableView = { kind: "mutations", gene: "KRAS", cohorts: ["Queried"] };
  const v = mutationsChipEmpties(["KRAS", "MYC"]).view([lolli, tableView] as unknown as View[]) as unknown as Record<string, unknown>;
  assert.equal(v.kind, "hotspots");
  assert.deepEqual(v.genes, ["KRAS", "MYC"]);
  assert.deepEqual(v.cohorts, ["Queried"]);
  assert.deepEqual(v.oql, ["KRAS: MUT=G12D"]);
  assert.equal(v.useOql, true);
  assert.deepEqual(v.drivers, {});
  const sent = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  for (const k of ["codons", "table", "yMax", "hide"]) assert.ok(!(k in sent), k + " absent from the request");
});

test("G2: .empty lists the genes with no mutated sample and an all-zero tally; fusion rows alone keep a gene ungreyed", () => {
  const kras = zero(); kras.missense.driver = 80; kras.truncating.vus = 14;
  const erbb2 = zero(); erbb2.fusion.vus = 3;
  const result = { hotspots: [gene("KRAS", 94, kras), gene("MYC", 0, zero()), gene("ERBB2", 0, erbb2)] };
  assert.deepEqual(mutationsChipEmpties(["KRAS", "MYC", "ERBB2"]).empty(result), ["MYC"]);
});

test("G3: .empty of an error result, null or {} greys nothing", () => {
  const e = mutationsChipEmpties(["KRAS", "MYC"]);
  assert.deepEqual(e.empty({ error: "boom" }), []);
  assert.deepEqual(e.empty(null), []);
  assert.deepEqual(e.empty({}), []);
});

test("G4: resultsLayout's Mutations tab chooser has empties, over the query's genes", () => {
  const rq = { studies: ["a"], filters: [], entries: ["KRAS", "MYC", "CDKN2A"], genes: ["KRAS", "MYC", "CDKN2A"] };
  const rdata = { expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true,
    held: { every: ["MUTATION", "CNA"], some: ["SV"] } } as unknown as Parameters<typeof resultsLayout>[1];
  const l = resultsLayout(rq as never, rdata);
  const tab = l.tabs.find((t) => t.title === "Mutations")!;
  const empties = tab.chooser?.empties;
  assert.ok(empties, "the chooser has empties");
  const views = tab.views!.map((i) => l.doc.views![i]);
  const v = empties.view(views) as unknown as { kind: string; genes: string[] };
  assert.equal(v.kind, "hotspots");
  assert.deepEqual(v.genes, ["KRAS", "MYC", "CDKN2A"]);
  assert.deepEqual(tab.chooser!.options, ["KRAS", "MYC", "CDKN2A"]);
});
