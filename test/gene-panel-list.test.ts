// The Patient page's gene panel window (lib/gene-panel-list.ts): the portal's GenesList filter and its
// layout of the genes down columns (genesDividedToColumns / genesDividedToRows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPanelGenes, panelGeneRows, panelGenesTsv } from "../lib/gene-panel-list.ts";

const g = (n: number) => Array.from({ length: n }, (_, i) => "G" + (i + 1));

test("PAT-GP-3: the filter is a case-insensitive regular expression on the symbol; text that is not one is matched as text", () => {
  const genes = ["TP53", "TP53BP1", "ABL1", "CTR9"];
  assert.deepEqual(filterPanelGenes(genes, "^tp5"), ["TP53", "TP53BP1"]);
  assert.deepEqual(filterPanelGenes(genes, "1$"), ["TP53BP1", "ABL1"]);
  assert.deepEqual(filterPanelGenes(genes, ""), genes);
  assert.deepEqual(filterPanelGenes(genes, "["), [], "an unclosed bracket is text, found nowhere");
  assert.deepEqual(filterPanelGenes(["A[1"], "["), ["A[1"]);
});

test("PAT-GP-3: the genes go down 3 columns as the portal's: equal chunks when they make 3, else the first chunk a column and the rest cut again", () => {
  assert.deepEqual(panelGeneRows(g(10), 3), [["G1", "G5", "G9"], ["G2", "G6", "G10"], ["G3", "G7", ""], ["G4", "G8", ""]]);
  assert.deepEqual(panelGeneRows(g(9), 3), [["G1", "G4", "G7"], ["G2", "G5", "G8"], ["G3", "G6", "G9"]]);
  assert.deepEqual(panelGeneRows(g(4), 3), [["G1", "G3", "G4"], ["G2", "", ""]], "chunks of 2 make 2 columns: [G1 G2], then G3, G4 cut again");
  assert.deepEqual(panelGeneRows(g(5), 3), [["G1", "G3", "G5"], ["G2", "G4", ""]]);
  assert.deepEqual(panelGeneRows([], 3), []);
  assert.equal(panelGeneRows(g(469), 3).length, 157, "IMPACT468's 469 genes: 157 rows");
});

test("PAT-GP-3: the download is a Genes header and a symbol a line", () => {
  assert.equal(panelGenesTsv(["ABL1", "TP53"]), "Genes\nABL1\nTP53\n");
});
