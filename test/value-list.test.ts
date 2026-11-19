// Explore's value lists as the portal's study-view tables behave (lib/value-list.ts): the search
// (STS-TBL-3), applied rows pinned first (STS-TBL-2), and Select all / Deselect all over the rows
// the search shows (STS-TBL-5). Cases from the spec, docs/legacy-spec/30-study-summary.md §4.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LIST_SEARCH_FROM, listBulk, listRowMatches, listRows, type ListRow } from "../lib/value-list.ts";

const rows: ListRow[] = [
  { key: "White", name: "White", n: 372, share: "65.5%" },
  { key: "Black", name: "Black or African American", n: 52, share: "9.2%" },
  { key: "Asian", name: "Asian", n: 9, share: "1.6%", on: true },
  { key: "NA", name: "NA", n: 135, share: "23.8%" },
];
const keys = (rs: ListRow[]) => rs.map((r) => r.key);

describe("the search (STS-TBL-3)", () => {
  const all: ListRow[] = [...rows, { key: "Big", name: "Big", n: 1084, share: "80.0%" }];
  const cases: [string, string, string[]][] = [
    ["the value, by case-insensitive substring", "afric", ["Black"]],
    ["the count as written", "372", ["White"]],
    ["a count of thousands as written, with its separator", "1,084", ["Big"]],
    ["… or without it", "1084", ["Big"]],
    ["the share as written", "9.2", ["Black"]],
    ["the share with its %", "1.6%", ["Asian"]],
    ["nothing typed shows every row", "  ", ["White", "Black", "Asian", "NA", "Big"]],
    ["no match", "zzz", []],
  ];
  for (const [name, q, want] of cases)
    test(name, () => assert.deepEqual(keys(all.filter((r) => listRowMatches(r, q))), want));
});

describe("the order shown (STS-TBL-2)", () => {
  test("the rows the filter holds come first, the rest in the list's own order", () => {
    assert.deepEqual(keys(listRows(rows, "")), ["Asian", "White", "Black", "NA"]);
  });
  test("a search keeps the pinning among the rows it shows", () => {
    assert.deepEqual(keys(listRows(rows, "a")), ["Asian", "Black", "NA"], "White has no a");
    assert.deepEqual(keys(listRows(rows, "an")), ["Asian", "Black"]);
  });
});

describe("Select all / Deselect all (STS-TBL-5)", () => {
  test("Select all adds every row shown that can be checked, keeping earlier ones; applied rows are not added", () => {
    assert.deepEqual(listBulk(listRows(rows, ""), ["Other"]).selectAll, ["Other", "White", "Black", "NA"]);
  });
  test("Select all over a search adds only the rows it shows", () => {
    assert.deepEqual(listBulk(listRows(rows, "afric"), ["NA"]).selectAll, ["NA", "Black"]);
  });
  test("Select all is hidden when every row shown is checked", () => {
    assert.equal(listBulk(listRows(rows, ""), ["White", "Black", "NA"]).selectAll, null);
  });
  test("Deselect all takes the rows shown out and keeps the others", () => {
    assert.deepEqual(listBulk(listRows(rows, "afric"), ["NA", "Black"]).deselectAll, ["NA"]);
    assert.deepEqual(listBulk(listRows(rows, ""), ["NA", "Black"]).deselectAll, []);
  });
  test("Deselect all is hidden when no row shown is checked", () => {
    assert.equal(listBulk(listRows(rows, "afric"), ["NA"]).deselectAll, null);
  });
  test("a row that cannot join others (NA) is left out of Select all", () => {
    assert.deepEqual(listBulk([{ key: "A", name: "A", n: 3 }, { key: "NA", name: "NA", n: 5, solo: true }], []).selectAll, ["A"]);
  });
  test("a row that cannot be checked is never added", () => {
    assert.equal(listBulk([{ key: "x", name: "x", n: 1, disabled: true }], []).selectAll, null);
  });
});

test("a list gets its search box from 10 rows, where it scrolls", () => assert.equal(LIST_SEARCH_FROM, 10));
