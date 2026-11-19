// MUT-STM-9: the Mutations table's Protein Change and Chromosome sort keys, as the portal computes them
// (cbioportal-utils ProteinChangeUtils calcProteinChangeSortValue; ChromosomeColumnFormatter
// getSortValue / extractSortValue). Each expected value is the legacy function's output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proteinChangeSortValue, proteinChangeSortSql, chromosomeSortValue, chromosomeSortSql } from "../lib/mutation-sort.ts";

/** the table's order: ascending by the sort value, nulls last */
const sortBy = (xs: (string | null | undefined)[], key: (x: string | null | undefined) => number | null) =>
  [...xs].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null || kb === null) return (ka === null ? 1 : 0) - (kb === null ? 1 : 0);
    return ka - kb;
  });

// ---- protein change ----------------------------------------------------------------------------

test("P1 V600E: 600.8669 (V=86, E=69)", () => {
  assert.equal(proteinChangeSortValue("V600E"), 600.8669);
});

test("P2 V600K: 600.8675, after V600E", () => {
  assert.equal(proteinChangeSortValue("V600K"), 600.8675);
  assert.ok(proteinChangeSortValue("V600K")! > proteinChangeSortValue("V600E")!);
});

test("P3 A600T: 600.6584, before V600E", () => {
  assert.equal(proteinChangeSortValue("A600T"), 600.6584);
  assert.ok(proteinChangeSortValue("A600T")! < proteinChangeSortValue("V600E")!);
});

test("P4 V601A: 601.8665, after every 600", () => {
  assert.equal(proteinChangeSortValue("V601A"), 601.8665);
  assert.ok(proteinChangeSortValue("V601A")! > proteinChangeSortValue("V600K")!);
});

test("P5 V600: 600.86 (the regex backtracks to 'V600'; the position is still 600)", () => {
  assert.equal(proteinChangeSortValue("V600"), 600.86);
});

test("P6 G12_G13insX: 12.7195 (match 'G12_')", () => {
  assert.equal(proteinChangeSortValue("G12_G13insX"), 12.7195);
});

test("P7 X37_splice: 37.8895", () => {
  assert.equal(proteinChangeSortValue("X37_splice"), 37.8895);
});

test("P8 *123: 123 (no letter before the digits: the first number)", () => {
  assert.equal(proteinChangeSortValue("*123"), 123);
});

test("P9 empty, null, undefined: null", () => {
  assert.equal(proteinChangeSortValue(""), null);
  assert.equal(proteinChangeSortValue(null), null);
  assert.equal(proteinChangeSortValue(undefined), null);
});

test("P10 Fusion: null (no digits)", () => {
  assert.equal(proteinChangeSortValue("Fusion"), null);
});

test("P11 TMPRSS2-ERG Fusion: 2.8345 (match 'S2-')", () => {
  assert.equal(proteinChangeSortValue("TMPRSS2-ERG Fusion"), 2.8345);
});

test("P12 EGFR-SEPT14 Fusion: 14.8432 (match 'T14 ', the space is 32)", () => {
  assert.equal(proteinChangeSortValue("EGFR-SEPT14 Fusion"), 14.8432);
});

test("P13 R130G / R130Q: 130.8271 / 130.8281, the same position ordered by letter", () => {
  assert.equal(proteinChangeSortValue("R130G"), 130.8271);
  assert.equal(proteinChangeSortValue("R130Q"), 130.8281);
});

test("P14 p.V600E: 600.8669 ('p.' has no digit after it)", () => {
  assert.equal(proteinChangeSortValue("p.V600E"), 600.8669);
});

test("P15 M1?: 1.7763", () => {
  assert.equal(proteinChangeSortValue("M1?"), 1.7763);
});

test("P16 E746_A750del: 746.6995", () => {
  assert.equal(proteinChangeSortValue("E746_A750del"), 746.6995);
});

test("P17 SP10fs: 10.80102 (match 'P10f')", () => {
  assert.equal(proteinChangeSortValue("SP10fs"), 10.80102);
});

test("P18 SP3: 3 (no character after the digit, so the first number)", () => {
  assert.equal(proteinChangeSortValue("SP3"), 3);
});

test("P19 1234: 1234", () => {
  assert.equal(proteinChangeSortValue("1234"), 1234);
});

test("P20 order: A600T < V600E < V600K < V601A; G12C < G12D < G12V < G13D < Q61H; nulls last", () => {
  assert.deepEqual(sortBy(["V601A", "V600K", null, "A600T", "V600E"], proteinChangeSortValue), ["A600T", "V600E", "V600K", "V601A", null]);
  assert.deepEqual(sortBy(["Q61H", "G13D", "Fusion", "G12V", "G12D", "G12C"], proteinChangeSortValue), ["G12C", "G12D", "G12V", "G13D", "Q61H", "Fusion"]);
});

test("proteinChangeSortSql is an expression over the one passed", () => {
  const sql = proteinChangeSortSql("x");
  assert.equal(typeof sql, "string");
  assert.ok(sql.includes("x"), sql);
  assert.ok(proteinChangeSortSql("proteinChange").includes("proteinChange"));
});

// ---- chromosome --------------------------------------------------------------------------------

test("C1 17: 17", () => {
  assert.equal(chromosomeSortValue("17"), 17);
});

test("C2 chr10: 10", () => {
  assert.equal(chromosomeSortValue("chr10"), 10);
});

test("C3 X / x / chrX: 23", () => {
  for (const c of ["X", "x", "chrX"]) assert.equal(chromosomeSortValue(c), 23, c);
});

test("C4 Y / chrY: 24", () => {
  for (const c of ["Y", "chrY"]) assert.equal(chromosomeSortValue(c), 24, c);
});

test("C5 XY: 23 (x is tested first)", () => {
  assert.equal(chromosomeSortValue("XY"), 23);
});

test("C6 MT / M / Un: -1", () => {
  for (const c of ["MT", "M", "Un"]) assert.equal(chromosomeSortValue(c), -1, c);
});

test("C7 empty / null / undefined: null", () => {
  assert.equal(chromosomeSortValue(""), null);
  assert.equal(chromosomeSortValue(null), null);
  assert.equal(chromosomeSortValue(undefined), null);
});

test("C8 1_KI270706v1_random: 1", () => {
  assert.equal(chromosomeSortValue("1_KI270706v1_random"), 1);
});

test("C9 23: 23", () => {
  assert.equal(chromosomeSortValue("23"), 23);
});

test("C10 order ascending: MT < 1 < 2 < 10 < 17 < X < Y, nulls last (not the text order 1 < 10 < 17 < 2)", () => {
  assert.deepEqual(sortBy(["Y", "17", null, "2", "X", "10", "", "1", "MT"], chromosomeSortValue).slice(0, 7), ["MT", "1", "2", "10", "17", "X", "Y"]);
  const tail = sortBy(["Y", "17", null, "2", "X", "10", "", "1", "MT"], chromosomeSortValue).slice(7);
  assert.equal(tail.length, 2);
  assert.ok(tail.every((x) => !x), JSON.stringify(tail));
});

test("chromosomeSortSql is an expression over the one passed", () => {
  const sql = chromosomeSortSql("x");
  assert.equal(typeof sql, "string");
  assert.ok(sql.includes("x"), sql);
  assert.ok(chromosomeSortSql("chr").includes("chr"));
});
