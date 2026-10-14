import { test } from "node:test";
import assert from "node:assert/strict";
import { sameJson } from "../lib/same-json.ts";

test("equal regardless of key order, at any depth", () => {
  assert.ok(sameJson({ study: "s", all: [{ kind: "oql", q: "KRAS: MUT" }] }, { all: [{ q: "KRAS: MUT", kind: "oql" }], study: "s" }));
});
test("array order, values and missing keys still count", () => {
  assert.ok(!sameJson({ a: [1, 2] }, { a: [2, 1] }));
  assert.ok(!sameJson({ a: 1 }, { a: "1" }));
  assert.ok(!sameJson({ a: 1 }, { a: 1, b: null }));
  assert.ok(sameJson({ a: 1, b: undefined }, { a: 1 }), "undefined is what JSON drops");
});
