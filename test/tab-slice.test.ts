// What opening a portal tab sends (tabSlice in app/portal/page-doc.ts): its views and the cohorts they use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tabSlice } from "../app/portal/page-doc.ts";
import type { AnalysisDoc } from "../lib/types.ts";

const def = (extra = {}) => ({ study: "s", all: [], ...extra });
const doc = {
  study: "s",
  cohorts: { Altered: def(), Unaltered: def(), Queried: def(), Base: def(), Child: def({ extends: "Base" }) },
  views: [
    { kind: "oncoprint", genes: ["KRAS"], cohorts: ["Queried"] },
    { kind: "plot", cohorts: ["Queried"], points: [{ cohort: "Altered" }] },
    { kind: "survival" },
    { kind: "overlap", cohorts: ["Child"] },
  ],
} as unknown as AnalysisDoc;

test("a tab sends only the cohorts its views draw", () => {
  const s = tabSlice(doc, [0]);
  assert.deepEqual(Object.keys(s.cohorts), ["Queried"]);
  assert.deepEqual(s.views, [doc.views![0]]);
});

test("a cohort a view names elsewhere comes along", () => {
  assert.deepEqual(Object.keys(tabSlice(doc, [1]).cohorts), ["Altered", "Queried"]);
});

test("a view without its own cohorts draws them all", () => {
  assert.deepEqual(Object.keys(tabSlice(doc, [0, 2]).cohorts), Object.keys(doc.cohorts));
});

test("a kept cohort's parent comes along", () => {
  assert.deepEqual(Object.keys(tabSlice(doc, [3]).cohorts), ["Base", "Child"]);
});
