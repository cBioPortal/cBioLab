// The Mutations table's Show more pager and its "(page x of y)" title (lib/table-pager.ts), as legacy's
// PaginationControls with MutationTable's itemsPerPageOptions [25, 50, 100].
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOW_MORE_SIZES, PAGE_ROWS_MAX, showMoreSize, showMoreDisabled, resetOffered, pagerHidden, pageOfText } from "../lib/table-pager.ts";

test("M1: Show more steps through the options, then adds the last option", () => {
  assert.deepEqual([...SHOW_MORE_SIZES], [25, 50, 100]);
  assert.deepEqual([25, 50, 100, 200, 300].map((s) => showMoreSize(s)), [50, 100, 200, 300, 400]);
});

test("M2: a size not among the options grows by the last option", () => {
  assert.equal(showMoreSize(30), 130);
});

test("M3: Show more is disabled once the page holds every row, or there are none", () => {
  assert.deepEqual([[25, 223], [200, 223], [250, 223], [25, 25], [25, 0]].map(([s, t]) => showMoreDisabled(s, t)), [false, false, true, true, true]);
});

test("M4: Reset is offered only above the first option", () => {
  assert.equal(resetOffered(25), false);
  assert.equal(resetOffered(50), true);
});

test("M5: the pager hides when the first option already covers every row", () => {
  assert.deepEqual([25, 26, 0].map((t) => pagerHidden(t, 25)), [true, false, true]);
});

test("M6: the title's page part, only past one page", () => {
  assert.equal(pageOfText(0, 9), "(page 1 of 9)");
  assert.equal(pageOfText(1, 9), "(page 2 of 9)");
  assert.equal(pageOfText(0, 1), "");
});

// the Reviewer's cases (#409)
test("M7: a view asking fewer rows a page than the first option keeps its pager while rows lie past its page", () => {
  assert.equal(pagerHidden(20, 10), false, "rows: 10 with 20 mutations");
  assert.equal(pagerHidden(10, 10), true, "every row on the one page");
});

test("M8: Show more stops at the largest page one request may ask for (/api/view-page's limit)", () => {
  assert.equal(PAGE_ROWS_MAX, 1000);
  assert.equal(showMoreSize(900), 1000, "900 + 100");
  assert.equal(showMoreSize(950), 1000, "past the limit: the limit");
  assert.equal(showMoreDisabled(1000, 5000), true, "at the limit with rows left: next reaches them");
  assert.equal(showMoreDisabled(900, 5000), false);
});
