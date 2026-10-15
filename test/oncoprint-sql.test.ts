// The oncoprint's coverage and column-facts SQL: what counts as profiled, and which panels say so.
// The numbers these produce are checked against the warehouse by hand in the commit that set them;
// these pin the rules, so a later edit cannot quietly narrow them.
import test from "node:test";
import assert from "node:assert/strict";
import { columnFactsSql, coverageSql } from "../lib/oncoprint.ts";

test("a gene cell is profiled by a mutation, copy number or structural variant panel, as in the portal", () => {
  const sql = coverageSql(["TP53", "CDKN2A"], "s");
  assert.match(sql, /alteration_type IN \('MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT'\)/);
  assert.match(sql, /pg\.gene IN \('TP53','CDKN2A'\)/, "and only for the genes that panel covers");
});

test("column facts count every sample of a column, profiled or not, and type masks follow PROFILED_TYPES", () => {
  const sql = columnFactsSql("s");
  assert.match(sql, /FROM \S*\.sample_derived sd\nLEFT JOIN/, "a column profiled for nothing still has a row");
  assert.match(sql, /uniqExact\(sd\.sample_unique_id\) AS samples/);
  assert.match(sql, /indexOf\(\['MUTATION_EXTENDED','COPY_NUMBER_ALTERATION','STRUCTURAL_VARIANT','MRNA_EXPRESSION','PROTEIN_LEVEL'\]/);
});
