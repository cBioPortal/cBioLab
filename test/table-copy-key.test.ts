// copyTableKey: two table answers that would copy the same text share a key.
//
//   C1 two distinct but deep-equal answers get the same key
//   C2 a page turn (rows, offset, pageSize differ) keeps the key
//   C3 a changed sort changes the key
//   C4 one more column changes the key
//   C5 one study's `all` changing (totals unchanged) changes the key
//   C6 a changed total changes the key
//   C7 a list entry's cohort changing (counts the same) changes the key
//   C8 a changed document (counts equal) changes the key
//   C9 a different view index changes the key
//   C10 a different table of the view changes the key
//   C11 table absent on both sides, deep-equal but distinct from objects, keeps the key

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyTableKey } from "../lib/table-tsv.ts";

const from = { doc: '{"views":[]}', view: 0 };

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
  assert.equal(copyTableKey(answer(), from), copyTableKey(answer(), from));
});

test("C2 a page turn keeps the key", () => {
  assert.equal(copyTableKey(answer(), from), copyTableKey(answer({ rows: [{ gene: "KRAS" }, { gene: "EGFR" }], offset: 50, pageSize: 100 }), from));
});

test("C3 a changed sort changes the key", () => {
  const q = { table: "mutations", sort: [{ id: "gene", dir: "desc" }], filters: [] };
  assert.notEqual(copyTableKey(answer(), from), copyTableKey(answer({ query: q }), from));
});

test("C4 one more column changes the key", () => {
  assert.notEqual(copyTableKey(answer(), from), copyTableKey(answer({ columns: [{ id: "gene" }, { id: "protein" }, { id: "vaf" }] }), from));
});

test("C5 one study's all changing changes the key", () => {
  const lists = [
    { cohort: "c1", study: "s1", total: 10, all: 13 },
    { cohort: "c1", study: "s2", total: 5, all: 6 },
  ];
  assert.notEqual(copyTableKey(answer(), from), copyTableKey(answer({ lists }), from));
});

test("C6 a changed total changes the key", () => {
  assert.notEqual(copyTableKey(answer(), from), copyTableKey(answer({ total: 16 }), from));
});

test("C7 a list entry's cohort changing changes the key", () => {
  const lists = [
    { cohort: "c2", study: "s1", total: 10, all: 12 },
    { cohort: "c1", study: "s2", total: 5, all: 7 },
  ];
  assert.notEqual(copyTableKey(answer(), from), copyTableKey(answer({ lists }), from));
});

test("C8 a changed document changes the key", () => {
  const doc1 = '{"views":[{"driver":{"oncokb":true}}]}';
  const doc2 = '{"views":[{"driver":{"oncokb":false}}]}';
  assert.notEqual(copyTableKey(answer(), { doc: doc1, view: 0 }), copyTableKey(answer(), { doc: doc2, view: 0 }));
});

test("C9 a different view index changes the key", () => {
  assert.notEqual(copyTableKey(answer(), { ...from, view: 0 }), copyTableKey(answer(), { ...from, view: 1 }));
});

test("C10 a different table of the view changes the key", () => {
  assert.notEqual(copyTableKey(answer(), { ...from, table: "mutations" }), copyTableKey(answer(), { ...from, table: "sv" }));
});

test("C11 table absent on both sides keeps the key", () => {
  assert.equal(copyTableKey(answer(), { doc: '{"views":[]}', view: 0 }), copyTableKey(answer(), { doc: '{"views":[]}', view: 0 }));
});
