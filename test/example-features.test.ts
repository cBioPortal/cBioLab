// The Examples tab's pills and filters: what is read from a document stays out of its tags, so a
// tag can never claim a view or a study the document does not have.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "../lib/dsl-reference.ts";
import { exampleFeatures, matchesSearch, foldSearch, FEDERATION, CUSTOM_DATA } from "../lib/example-features.ts";
import { viewRunner } from "../lib/views/index.ts";

describe("gallery tags", () => {
  test("titles are unique (the tab keys cards by title)", () => {
    const seen = new Set<string>();
    for (const ex of EXAMPLES) { assert.ok(!seen.has(ex.title), "duplicate example: " + ex.title); seen.add(ex.title); }
  });

  test("no tag names a view kind — those are read from the document", () => {
    for (const ex of EXAMPLES) for (const t of ex.tags || [])
      assert.equal(viewRunner(t), undefined, `"${ex.title}" tags "${t}", a view kind`);
  });

  test("no tag is one the document decides", () => {
    for (const ex of EXAMPLES) for (const t of ex.tags || [])
      assert.ok(t !== FEDERATION && t !== CUSTOM_DATA, `"${ex.title}" tags "${t}" by hand`);
  });

  test("no two tags differ only by case, hyphens or spaces", () => {
    const byFold = new Map<string, string>();
    for (const ex of EXAMPLES) for (const t of exampleFeatures(ex).topics) {
      const prev = byFold.get(foldSearch(t));
      assert.ok(prev === undefined || prev === t, `"${prev}" and "${t}" are one tag spelled two ways`);
      byFold.set(foldSearch(t), t);
    }
  });
});

describe("derived features", () => {
  const byTitle = (s: string) => EXAMPLES.find(e => e.title.startsWith(s))!;
  test("views come from the document, in its order", () => {
    assert.deepEqual(exampleFeatures(byTitle("One cohort, five ways")).views,
      ["hotspots", "cooccurrence", "compare", "clinical", "survival"]);
  });
  test("federation means the cohorts span several studies", () => {
    assert.ok(exampleFeatures(byTitle("Study-stratified survival")).topics.includes(FEDERATION));
    assert.ok(!exampleFeatures(byTitle("Co-expression from sums")).topics.includes(FEDERATION));
  });
  test("custom-data means the example brings uploads", () => {
    for (const ex of EXAMPLES)
      assert.equal(exampleFeatures(ex).topics.includes(CUSTOM_DATA), !!ex.customData?.length, ex.title);
  });
});

describe("search", () => {
  const ex = EXAMPLES.find(e => e.title === "Co-expression from sums alone")!;
  test("every word must match, in any of the example's text", () => {
    assert.ok(matchesSearch(ex, "ERBB2 correlation"));
    assert.ok(!matchesSearch(ex, "ERBB2 lollipop"));
  });
  test("case, hyphens and spaces are ignored", () => {
    assert.ok(matchesSearch(ex, "CO-EXPRESSION"));
    assert.ok(matchesSearch(ex, "co expression"));
  });
  test("an empty query matches everything", () => assert.ok(EXAMPLES.every(e => matchesSearch(e, "  "))));
});
