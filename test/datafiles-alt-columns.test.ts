// The Download tab case table's per-alteration columns (lib/views/datafiles/tables.ts alterationColumns), as the
// portal's (cbioportal-frontend cd8c6df src/pages/resultsView/download/CaseAlterationTable.tsx 445-517, DownloadTab.tsx
// 572-627 geneAlterationMap, src/shared/lib/oql/oqlfilter.ts 308 parsedOQLAlterationToSourceOQL):
//
// | ID | rule                                                                                                          |
// |----|---------------------------------------------------------------------------------------------------------------|
// | A1 | a bare line's commands are the query's default OQL, "<gene>: <command>" (its parsed line is the default's)      |
// | A2 | a line's commands as written back: MUT=G12D, MUT_DRIVER, AMP, HOMDEL, FUSION, EXP>=2                            |
// | A3 | a gene's lines together, a later line's commands first (_.union(this line's, the earlier)), each name once     |
// | A4 | genes in query order (uniqGenes), a gene's columns together though its lines are apart                          |
// | A5 | the kind a column reads: MUT mutations, AMP and HOMDEL copy number (both), FUSION structural variants, EXP, PROT|
// | A6 | hidden at first: the runner's defaults leave them out (test/view-datafiles.test.ts)                            |
import { test } from "node:test";
import assert from "node:assert/strict";
import { alterationColumns } from "../lib/views/datafiles/tables.ts";
import { parseOql } from "../lib/oql-parse.ts";

const cols = (lines: string[], defaults = ["AMP", "HOMDEL", "MUT", "FUSION"]) =>
  alterationColumns(lines.map((l) => ({ gene: parseOql(l)[0].gene, specs: parseOql(l)[0].specs })), defaults);
const names = (lines: string[], defaults?: string[]) => cols(lines, defaults).map((c) => c.name);

test("A1: a bare gene's columns are the default OQL's commands", () => {
  assert.deepEqual(names(["KRAS"]), ["KRAS: AMP", "KRAS: HOMDEL", "KRAS: MUT", "KRAS: FUSION"]);
  assert.deepEqual(names(["KRAS"], ["MUT"]), ["KRAS: MUT"], "a study with mutations only");
});

test("A2: commands as written back", () => {
  assert.deepEqual(names(["KRAS: MUT=G12D MUT_DRIVER AMP HOMDEL FUSION EXP>=2 PROT<=-2"]),
    ["KRAS: MUT=G12D", "KRAS: MUT_DRIVER", "KRAS: AMP", "KRAS: HOMDEL", "KRAS: FUSION", "KRAS: EXP>=2", "KRAS: PROT<=-2"]);
});

test("A3: a gene's lines together, the later line's commands first, each once", () => {
  assert.deepEqual(names(["KRAS: MUT", "KRAS: AMP MUT"]), ["KRAS: AMP", "KRAS: MUT"]);
  assert.deepEqual(names(["KRAS: MUT=G12D", "KRAS"]), ["KRAS: AMP", "KRAS: HOMDEL", "KRAS: MUT", "KRAS: FUSION", "KRAS: MUT=G12D"]);
});

test("A4: genes in query order, a gene's columns together", () => {
  assert.deepEqual(names(["TP53: MUT", "KRAS: AMP", "TP53: HOMDEL"]), ["TP53: HOMDEL", "TP53: MUT", "KRAS: AMP"]);
});

test("A5: each column's kind of call", () => {
  assert.deepEqual(cols(["KRAS: MUT AMP HOMDEL FUSION EXP>=2 PROT>=2"]).map((c) => [c.name, c.gene, c.kind]),
    [["KRAS: MUT", "KRAS", "mut"], ["KRAS: AMP", "KRAS", "cna"], ["KRAS: HOMDEL", "KRAS", "cna"], ["KRAS: FUSION", "KRAS", "sv"],
      ["KRAS: EXP>=2", "KRAS", "exp"], ["KRAS: PROT>=2", "KRAS", "prot"]]);
  assert.deepEqual(cols(["KRAS", "TP53"]).map((c) => c.id), ["alt_0", "alt_1", "alt_2", "alt_3", "alt_4", "alt_5", "alt_6", "alt_7"], "ids by position");
});
