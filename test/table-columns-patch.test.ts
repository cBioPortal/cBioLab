import { test } from "node:test";
import assert from "node:assert/strict";
import { columnsPatch } from "../lib/table-columns.ts";

const fb = { op: "contains", value: "x" } as any;
const fc = { min: 1 } as any;

test("C1: hiding a filtered column drops its filter, others stay", () => {
  const r = columnsPatch({ filters: { b: fb, c: fc } }, ["a", "c"], ["a", "b", "c"], ["a"]);
  assert.deepEqual(r, { columns: ["a", "c"], filters: { c: fc } });
});

test("C2: only adding columns leaves no filters key", () => {
  const r = columnsPatch({ filters: { a: fb } }, ["a", "b", "d"], ["a", "b"], ["a"]);
  assert.deepEqual(r, { columns: ["a", "b", "d"] });
  assert.ok(!("filters" in r));
});

test("C3: reset to defaults hides b and clears its filter", () => {
  const r = columnsPatch({ filters: { b: fb } }, undefined, ["a", "b"], ["a"]);
  assert.deepEqual(r, { columns: undefined, filters: {} });
});

test("C4: reset to defaults that keep b leaves no filters key", () => {
  const r = columnsPatch({ filters: { b: fb } }, undefined, ["a", "b"], ["a", "b"]);
  assert.deepEqual(r, { columns: undefined });
  assert.ok(!("filters" in r));
});

test("C5: a filter on a column not shown now is kept", () => {
  const r = columnsPatch({ filters: { z: fc } }, ["a"], ["a", "b"], ["a"]);
  assert.deepEqual(r, { columns: ["a"] });
  assert.ok(!("filters" in r));
});

test("C6: no filters in the query", () => {
  const r = columnsPatch({}, ["a"], ["a", "b"], ["a"]);
  assert.deepEqual(r, { columns: ["a"] });
});

test("C7: the input filters object is not mutated", () => {
  const filters = { b: fb, c: fc };
  columnsPatch({ filters }, ["a", "c"], ["a", "b", "c"], ["a"]);
  assert.deepEqual(filters, { b: fb, c: fc });
});
