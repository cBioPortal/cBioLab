import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges, pageChanges } from "../app/portal/page-changes.ts";
import { arrange } from "../app/portal/page-doc.ts";
import type { View } from "../lib/types.ts";

const v = (x: Record<string, unknown>) => x as unknown as View;
const FRESH = [v({ kind: "overlap", cohorts: ["A", "B"] }), v({ kind: "survival", cohorts: ["A", "B"], endpoint: "OS" }),
  v({ kind: "enrichment", cohorts: ["A", "B"], alteration: "mutation" })];
const NAMES = ["Overlap › Overlap", "Survival › Survival", "Genomic Alterations › Mutations"];

test("an unchanged page carries nothing", () => {
  assert.equal(pageChanges(NAMES, FRESH, FRESH.map((x) => ({ ...x }))), null);
});

test("a changed setting carries only itself, by its view's name, and applies back to the same view", () => {
  const now = FRESH.slice();
  now[1] = v({ ...FRESH[1], endpoint: "PFS", yMax: 0.5 });
  const c = pageChanges(NAMES, FRESH, now)!;
  assert.deepEqual(c, { "Survival › Survival": [{ endpoint: "PFS", yMax: 0.5 }] });
  assert.deepEqual(applyChanges(NAMES, FRESH, JSON.parse(JSON.stringify(c))), { views: now, missed: [] });
});

test("a default setting taken away is carried, and taken away again", () => {
  const now = FRESH.slice();
  const { alteration: _dropped, ...rest } = FRESH[2] as unknown as Record<string, unknown>;
  now[2] = v(rest);
  const c = pageChanges(NAMES, FRESH, now)!;
  assert.deepEqual(c, { "Genomic Alterations › Mutations": [{}, ["alteration"]] });
  assert.deepEqual(applyChanges(NAMES, FRESH, c).views, now);
});

test("a default that changed since is taken up", () => {
  const now = FRESH.slice();
  now[1] = v({ ...FRESH[1], yMax: 0.5 });
  const c = pageChanges(NAMES, FRESH, now)!;
  const newer = FRESH.slice();
  newer[1] = v({ ...FRESH[1], endpoint: "DSS" });
  assert.deepEqual(applyChanges(NAMES, newer, c).views[1], { kind: "survival", cohorts: ["A", "B"], endpoint: "DSS", yMax: 0.5 });
});

test("a change follows its view when the page's views move or others are added", () => {
  const now = FRESH.slice();
  now[1] = v({ ...FRESH[1], endpoint: "PFS" });
  const c = pageChanges(NAMES, FRESH, now)!;
  const moved = [v({ kind: "table" }), FRESH[1], FRESH[0], FRESH[2]];
  const out = applyChanges(["Clinical Data › Patients", NAMES[1], NAMES[0], NAMES[2]], moved, c);
  assert.deepEqual(out.missed, []);
  assert.equal((out.views[1] as unknown as { endpoint: string }).endpoint, "PFS");
});

test("each change that names no view, or would change a view's kind, is missed on its own", () => {
  const out = applyChanges(NAMES, FRESH, { "Plots › Plot": [{ x: 1 }], "Overlap › Overlap": [{ kind: "table" }], "Survival › Survival": [{ endpoint: "PFS" }] });
  assert.deepEqual(out.missed, ["Plots › Plot", "Overlap › Overlap"]);
  assert.equal((out.views[1] as unknown as { endpoint: string }).endpoint, "PFS");
  assert.deepEqual(out.views[0], FRESH[0]);
});

test("a link's changes that do not read as changes apply nothing", () => {
  for (const c of [null, [], "x", { "Survival › Survival": "PFS" }] as unknown[])
    assert.deepEqual(applyChanges(NAMES, FRESH, c as never).views, FRESH);
});

test("the page names each view by its tab, sub-tab and title", () => {
  const p = arrange({ study: "s", cohorts: {} }, [
    { title: "Oncoprint", views: [{ title: "Oncoprint", view: FRESH[0] }] },
    { title: "Comparison/Survival", sub: [{ title: "Genomic Alterations", views: [{ title: "Mutations", view: FRESH[2] }, { title: "Mutations", view: FRESH[2] }] }] },
  ], [], { partial: true });
  assert.deepEqual(p.names, ["Oncoprint › Oncoprint", "Comparison/Survival › Genomic Alterations › Mutations", "Comparison/Survival › Genomic Alterations › Mutations 2"]);
  assert.equal(p.partial, true);
});
