// copyTableKey: two table answers that would copy the same text share a key.
//
//   C1 two distinct but deep-equal answers get the same key
//   C2 a page turn (rows, offset, pageSize differ) keeps the key
//   C3 a changed sort changes the key
//   C4 one more column changes the key
//   C5 one study's `all` changing (totals unchanged) changes the key
//   C6 a changed total changes the key
//   C7 a list entry's cohort changing (counts the same) changes the key

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyTableKey } from "../lib/table-tsv.ts";

const answer = (over: Record<string, unknown> = {}) => ({
  query: { table: "mutations", sort: [{ id: "gene", dir: "asc" }], filters: [] },
  columns: [{ id: "gene" }, { id: "protein" }],
  lists: [
    { cohort: "c1", study: "s1", total: 10, all: 12 },
    { cohort: "c1", study: "s2", total: 5, all: 7 },
  ],
  total: 15,
  all: 19,
  rows: [{ gene: "TP53" }],
  offset: 0,
  pageSize: 50,
  ...over,
});

test("C1 deep-equal answers share a key", () => {
  assert.equal(copyTableKey(answer()), copyTableKey(answer()));
});

test("C2 a page turn keeps the key", () => {
  assert.equal(copyTableKey(answer()), copyTableKey(answer({ rows: [{ gene: "KRAS" }, { gene: "EGFR" }], offset: 50, pageSize: 100 })));
});

test("C3 a changed sort changes the key", () => {
  const q = { table: "mutations", sort: [{ id: "gene", dir: "desc" }], filters: [] };
  assert.notEqual(copyTableKey(answer()), copyTableKey(answer({ query: q })));
});

test("C4 one more column changes the key", () => {
  assert.notEqual(copyTableKey(answer()), copyTableKey(answer({ columns: [{ id: "gene" }, { id: "protein" }, { id: "vaf" }] })));
});

test("C5 one study's all changing changes the key", () => {
  const lists = [
    { cohort: "c1", study: "s1", total: 10, all: 13 },
    { cohort: "c1", study: "s2", total: 5, all: 6 },
  ];
  assert.notEqual(copyTableKey(answer()), copyTableKey(answer({ lists })));
});

test("C6 a changed total changes the key", () => {
  assert.notEqual(copyTableKey(answer()), copyTableKey(answer({ total: 16 })));
});

test("C7 a list entry's cohort changing changes the key", () => {
  const lists = [
    { cohort: "c2", study: "s1", total: 10, all: 12 },
    { cohort: "c1", study: "s2", total: 5, all: 7 },
  ];
  assert.notEqual(copyTableKey(answer()), copyTableKey(answer({ lists })));
});
