// The Download tab's gene alteration frequency table: sort, filter and the downloaded file (RDL-2.1, RDL-2.5, RDL-2.6).
// Written from the case table's rows (S*, F*, T*) before the code; legacy (cbioportal-frontend at cd8c6df):
//   GAT = src/pages/resultsView/download/GeneAlterationTable.tsx — columns, sort keys, filters, download cells
//   LMT = src/shared/components/lazyMobXTable/LazyMobXTable.tsx — lazyMobXTableSort (stable, null last), downloadData
//   Serializer.tsx serializeData — cells joined by "\t", every row ended by "\r\n", no quoting
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { LineFrequency } from "../lib/views/datafiles/types.ts";
import { frequencyFilter, frequencySort, frequencyTsv } from "../lib/views/datafiles/frequency.ts";

// the functions under the names the tests use
const sort = frequencySort, filter = frequencyFilter, tsv = frequencyTsv;

function row(gene: string, altered: number, profiled: number, line: string = gene): LineFrequency {
  return {
    line, gene, altered, profiled,
    percent: profiled === 0 ? null : Math.round((altered / profiled) * 1000) / 10,
    offPanel: 0,
  };
}
const lines = (rows: LineFrequency[]) => rows.map((r) => r.line);

describe("frequencySort", () => {
  test("S1: percent desc — ties keep the data's order", async () => {
    assert.deepEqual(lines(sort([row("A", 40, 100), row("B", 60, 100), row("C", 40, 100)], "percent", false)), ["B", "A", "C"]);
  });
  test("S2: percent asc — ties keep the data's order", async () => {
    assert.deepEqual(lines(sort([row("A", 40, 100), row("B", 60, 100), row("C", 40, 100)], "percent", true)), ["A", "C", "B"]);
  });
  test("S3: gene asc by localeCompare", async () => {
    assert.deepEqual(sort([row("b", 1, 10), row("A", 1, 10), row("c", 1, 10)], "gene", true).map((r) => r.gene), ["A", "b", "c"]);
  });
  test("S4: altered desc — equal counts keep their order", async () => {
    const rows = [row("FIRST5", 5, 100), row("NINE", 9, 100), row("SECOND5", 5, 100)];
    assert.deepEqual(lines(sort(rows, "altered", false)), ["NINE", "FIRST5", "SECOND5"]);
  });
  test("S5: an unprofiled row sorts last, desc and asc", async () => {
    const rows = [row("A", 10, 100), row("X", 0, 0), row("B", 50, 100)];
    assert.deepEqual(lines(sort(rows, "percent", false)), ["B", "A", "X"]);
    assert.deepEqual(lines(sort(rows, "percent", true)), ["A", "B", "X"]);
  });
  test("S6: line asc by the line text, localeCompare", async () => {
    const rows = [row("TP53", 1, 10, "TP53"), row("KRAS", 1, 10, "KRAS: MUT"), row("KRAS", 1, 10, "KRAS: AMP"), row("BRAF", 1, 10, "braf")];
    assert.deepEqual(lines(sort(rows, "line", true)), ["braf", "KRAS: AMP", "KRAS: MUT", "TP53"]);
  });
});

describe("frequencyFilter", () => {
  test("F1: \"kr\" keeps KRAS only", async () => {
    assert.deepEqual(lines(filter([row("KRAS", 1, 10), row("TP53", 1, 10)], "kr", false)), ["KRAS"]);
  });
  test("F2: \"MUT\" keeps a row whose line matches only while the OQL Line column is shown (LMT visibleColumns)", async () => {
    assert.deepEqual(lines(filter([row("KRAS", 1, 10, "KRAS: MUT=G12D")], "MUT", true)), ["KRAS: MUT=G12D"]);
    assert.deepEqual(lines(filter([row("KRAS", 1, 10, "KRAS: MUT=G12D")], "MUT", false)), []);
  });
  test("F3: \"\" keeps all", async () => {
    assert.deepEqual(lines(filter([row("KRAS", 1, 10), row("TP53", 1, 10)], "", false)), ["KRAS", "TP53"]);
  });
});

describe("frequencyTsv", () => {
  const HEADER = "Gene Symbol\tOQL Line\tNum Samples Altered\tPercent Samples Altered\r\n";
  test("T1: header first", async () => {
    assert.ok(tsv([row("KRAS", 222, 594)]).startsWith(HEADER));
  });
  test("T2: KRAS 222 of 594", async () => {
    assert.equal(tsv([row("KRAS", 222, 594)]), HEADER + "KRAS\tKRAS\t222\t37%\r\n");
  });
  test("T3: unprofiled row is N/P", async () => {
    assert.equal(tsv([row("X", 0, 0)]), HEADER + "X\tX\tN/P\tN/P\r\n");
  });
  test("T4: 1 of 40 is 2.5%", async () => {
    assert.equal(tsv([row("G", 1, 40)]), HEADER + "G\tG\t1\t2.5%\r\n");
  });
  test("T5: header and two lines, each ended by \\r\\n, nothing else", async () => {
    assert.equal(tsv([row("KRAS", 222, 594), row("G", 1, 40)]), HEADER + "KRAS\tKRAS\t222\t37%\r\n" + "G\tG\t1\t2.5%\r\n");
  });
  test("T6: rows written in the order given", async () => {
    assert.equal(tsv([row("G", 1, 40), row("KRAS", 222, 594)]), HEADER + "G\tG\t1\t2.5%\r\n" + "KRAS\tKRAS\t222\t37%\r\n");
  });
});
