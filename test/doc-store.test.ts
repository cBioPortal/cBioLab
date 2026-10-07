// The analysis page's view ids (app/lab/doc-store.ts): a card is keyed by its view's id, and a
// one-view re-run finds its slot by it, so the id must follow the view and nothing else.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { initialDocState, setDoc, replaceDoc, commitDoc } from "../app/lab/doc-store.ts";
import type { AnalysisDoc } from "../lib/types.ts";

const a = { kind: "compare", genes: ["TP53"] }, b = { kind: "survival" }, c = { kind: "oncoprint", genes: ["KRAS"] };
const doc = (views: object[]): AnalysisDoc => ({ study: "s", cohorts: {}, views } as unknown as AnalysisDoc);
const start = () => initialDocState(doc([a, b, c]));

describe("view ids", () => {
  test("an edited view keeps its id, and so does every other", () => {
    const s = start();
    const t = setDoc(s, doc([a, { ...b, endpoint: "PFS" }, c]));
    assert.deepEqual(t.ids, s.ids);
  });
  test("a view moved keeps its id at its new position", () => {
    const s = start();
    assert.deepEqual(setDoc(s, doc([c, b, a])).ids, [s.ids[2], s.ids[1], s.ids[0]]);
  });
  test("removing a view keeps the others' ids", () => {
    const s = start();
    assert.deepEqual(setDoc(s, doc([a, c])).ids, [s.ids[0], s.ids[2]]);
  });
  test("an added view gets a new id; the rest keep theirs", () => {
    const s = start();
    const t = setDoc(s, doc([{ kind: "plot" }, a, b, c]));
    assert.deepEqual(t.ids.slice(1), s.ids);
    assert.ok(!s.ids.includes(t.ids[0]));
  });
  test("a different document gets new ids, even with views at the same positions", () => {
    const s = start();
    const t = replaceDoc(s, doc([a, b, c]));
    assert.ok(t.ids.every((id) => !s.ids.includes(id)));
  });
  test("a validated document keeps ids for views whose JSON is unchanged", () => {
    const s = start();
    const t = commitDoc(s, doc([JSON.parse(JSON.stringify(c)), { kind: "survival", endpoint: "DFS" }, JSON.parse(JSON.stringify(a))]));
    assert.equal(t.ids[0], s.ids[2]);
    assert.equal(t.ids[2], s.ids[0]);
    assert.ok(!s.ids.includes(t.ids[1]));
  });
  test("ids are never reused, and the text follows the document", () => {
    let s = start();
    const seen = new Set(s.ids);
    for (let i = 0; i < 5; i++) {
      s = replaceDoc(s, doc([a, b]));
      for (const id of s.ids) { assert.ok(!seen.has(id)); seen.add(id); }
    }
    assert.equal(s.text, JSON.stringify(s.doc, null, 2));
  });
  test("the same object twice in a list gets two ids", () => {
    const s = initialDocState(doc([a, a]));
    const t = setDoc(s, doc([a, a, b]));
    assert.deepEqual(t.ids.slice(0, 2), s.ids);
  });
});
