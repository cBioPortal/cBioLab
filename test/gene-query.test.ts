// The gene query dialog's checker (lib/gene-query.ts): an OQL query or a gene list read entry by
// entry, each with what it selects or what is wrong with it, and symbol replacement that touches
// only genes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkGeneQuery, replaceSymbol } from "../lib/gene-query.ts";
import { parseOql } from "../lib/oql.ts";
import { parseOql as parsePure } from "../lib/oql-parse.ts";

describe("gene query: OQL", () => {
  test("each line is an entry, described in words", () => {
    const c = checkGeneQuery("KRAS: G12C\nTP53\nERBB2: AMP; CDKN2A: HOMDEL", "oql");
    assert.deepEqual(c.genes, ["KRAS", "TP53", "ERBB2", "CDKN2A"]);
    assert.deepEqual(c.entries.map((e) => e.meaning), ["G12C mutations", "any alteration", "amplification", "deep deletion"]);
    assert.equal(c.error, undefined);
  });
  test("a bad entry is reported on its own line, and the rest still read", () => {
    const c = checkGeneQuery("TP53\nBRAF: GAIN", "oql");
    assert.equal(c.entries[0].error, undefined);
    assert.match(c.entries[1].error!, /GAIN is not supported/);
    assert.deepEqual(c.genes, ["TP53", "BRAF"]);
  });
  test("genes separated by spaces or commas are entries of their own, as on the portal", () => {
    assert.deepEqual(checkGeneQuery("KRAS,NRAS BRAF", "oql").entries.map((e) => e.text), ["KRAS", "NRAS", "BRAF"]);
    assert.deepEqual(checkGeneQuery("TP53 KRAS: MUT AMP", "oql").entries.map((e) => [e.text, e.meaning]),
      [["TP53", "any alteration"], ["KRAS: MUT AMP", "mutations or amplification"]]);
  });
  test("a gene named twice counts once", () => {
    assert.deepEqual(checkGeneQuery("KRAS: MUT\nKRAS: AMP", "oql").genes, ["KRAS"]);
  });
  test("past 30 entries the query is refused, with the limit named", () => {
    const c = checkGeneQuery(Array.from({ length: 31 }, (_, i) => "G" + i).join("\n"), "oql");
    assert.match(c.error!, /at most 30 entries; this has 31/);
  });
  test("the browser-safe parser is the one the engine uses", () => {
    assert.equal(parseOql, parsePure);
  });
  test("the engine reads a comma between statements as the dialog does: a cohort's or an axis's OQL alike", () => {
    assert.deepEqual(parseOql("KRAS: G12C, STK11: MUT;EGFR: AMP\nTP53").map((e) => e.gene), ["KRAS", "STK11", "EGFR", "TP53"]);
  });
});

describe("gene query: gene list", () => {
  test("merged rows are one entry", () => {
    const c = checkGeneQuery('TP53 ["RTK" EGFR ERBB2]', "genes");
    assert.deepEqual(c.entries.map((e) => e.meaning), ["its own row", "one merged row"]);
    assert.deepEqual(c.genes, ["TP53", "EGFR", "ERBB2"]);
    assert.equal(c.tracks!.length, 2);
  });
  test("per-gene OQL is refused in a gene list, saying why", () => {
    assert.match(checkGeneQuery("TP53: MUT", "genes").error!, /per-track OQL/);
  });
});

describe("gene query: replacing a symbol", () => {
  test("only where it stands as a gene, whatever its case", () => {
    assert.equal(replaceSymbol("p53: MUT\nKRAS: P53X", "P53", "TP53"), "TP53: MUT\nKRAS: P53X");
    assert.equal(replaceSymbol("TP53 her2 [HER2 EGFR]", "HER2", "ERBB2"), "TP53 ERBB2 [ERBB2 EGFR]");
  });
});
