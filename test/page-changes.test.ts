import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges, layoutKey, pageChanges } from "../app/portal/page-changes.ts";
import type { View } from "../lib/types.ts";

const v = (x: Record<string, unknown>) => x as unknown as View;
const FRESH = [v({ kind: "overlap", cohorts: ["A", "B"] }), v({ kind: "survival", cohorts: ["A", "B"], endpoint: "OS" }),
  v({ kind: "enrichment", cohorts: ["A", "B"], alteration: "mutation" })];

test("an unchanged page carries nothing", () => {
  assert.equal(pageChanges(FRESH, FRESH.map((x) => ({ ...x }))), null);
});

test("a changed setting carries only itself, and applies back to the same views", () => {
  const now = FRESH.slice();
  now[1] = v({ ...FRESH[1], endpoint: "PFS", yMax: 0.5 });
  const c = pageChanges(FRESH, now)!;
  assert.deepEqual(c.views, [[1, { endpoint: "PFS", yMax: 0.5 }]]);
  assert.deepEqual(applyChanges(FRESH, JSON.parse(JSON.stringify(c))), now);
});

test("a default setting taken away is carried, and taken away again", () => {
  const now = FRESH.slice();
  const { alteration: _dropped, ...rest } = FRESH[2] as unknown as Record<string, unknown>;
  now[2] = v(rest);
  const c = pageChanges(FRESH, now)!;
  assert.deepEqual(c.views, [[2, {}, ["alteration"]]]);
  assert.deepEqual(applyChanges(FRESH, c), now);
});

test("a default that changed under the same layout is taken up", () => {
  const now = FRESH.slice();
  now[1] = v({ ...FRESH[1], yMax: 0.5 });
  const c = pageChanges(FRESH, now)!;
  const newer = FRESH.slice();
  newer[1] = v({ ...FRESH[1], endpoint: "DSS" });
  assert.deepEqual(applyChanges(newer, c)![1], { kind: "survival", cohorts: ["A", "B"], endpoint: "DSS", yMax: 0.5 });
});

test("changes made on another layout are not applied", () => {
  const now = FRESH.slice();
  now[1] = v({ ...FRESH[1], endpoint: "PFS" });
  const c = pageChanges(FRESH, now)!;
  const moved = [FRESH[1], FRESH[0], FRESH[2]];
  assert.notEqual(layoutKey(moved), layoutKey(FRESH));
  assert.equal(applyChanges(moved, c), null);
  assert.equal(applyChanges(FRESH.concat(v({ kind: "table" })), c), null);
});

test("a change that names no view, or would change a view's kind, is refused", () => {
  const layout = layoutKey(FRESH);
  assert.equal(applyChanges(FRESH, { layout, views: [[7, { endpoint: "PFS" }]] }), null);
  assert.equal(applyChanges(FRESH, { layout, views: [[1, { kind: "table" }]] }), null);
});
