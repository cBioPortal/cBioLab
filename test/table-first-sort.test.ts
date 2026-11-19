// A header click's sort direction on the Mutations table: the sorted column flips, any other
// column starts in its own first direction (legacy LazyMobXTable getNextSortAscending).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { headerSort, type SortableColumn } from "../lib/table-sort.ts";
import { MUTATION_COLUMNS } from "../lib/mutation-table.ts";

const DESC = new Set(["gnomad", "clinvar", "dbsnp"]);
const col = (id: string): SortableColumn => {
  const c = MUTATION_COLUMNS.find((m) => m.id === id);
  assert.ok(c, `no mutation column ${id}`);
  return c;
};

describe("mutation table first sort", () => {
  test("F1: gnomad, clinvar and dbsnp start descending", () => {
    for (const id of DESC) assert.equal(col(id).firstSort, "desc", id);
  });

  test("F2: every other mutation column, numeric and annotation included, starts ascending", () => {
    const ids = MUTATION_COLUMNS.map((c) => c.id);
    for (const id of ["annotation", "vaf", "mutCount", "start", "altCount"]) assert.ok(ids.includes(id), id);
    for (const c of MUTATION_COLUMNS) {
      if (DESC.has(c.id)) continue;
      assert.equal(c.firstSort, "asc", c.id);
    }
  });

  test("F3: with no current sort, a click uses the column's first direction", () => {
    assert.deepEqual(headerSort(undefined, col("vaf")), { column: "vaf" });
    assert.deepEqual(headerSort(undefined, col("clinvar")), { column: "clinvar", desc: true });
  });

  test("F4: clicking the sorted column flips its direction", () => {
    assert.deepEqual(headerSort({ column: "vaf" }, col("vaf")), { column: "vaf", desc: true });
    assert.deepEqual(headerSort({ column: "vaf", desc: true }, col("vaf")), { column: "vaf" });
  });

  test("F5: another column's direction does not carry over", () => {
    assert.deepEqual(headerSort({ column: "annotation", desc: true }, col("mutCount")), { column: "mutCount" });
  });

  test("F6: without firstSort, numbers start descending and text ascending", () => {
    assert.deepEqual(headerSort(undefined, { id: "n", numeric: true }), { column: "n", desc: true });
    assert.deepEqual(headerSort(undefined, { id: "t", numeric: false }), { column: "t" });
  });

  test("F7: firstSort asc overrides the numeric default", () => {
    assert.deepEqual(headerSort(undefined, { id: "n", numeric: true, firstSort: "asc" }), { column: "n" });
  });
});
