// Every view kind is drawn by a browser check, unless it says why not: a `preview` kind, or a
// provisional one with `e2ePending` (lib/views/kind-def.ts). An e2e area lists the kinds it draws in
// its `covers` export (test/e2e/*.cjs; test/e2e/view-kinds.cjs draws each from its gallery example).
// Promoting a kind means removing its exemption and adding it to an area's `covers` in the same change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { KINDS } from "../lib/views/kinds.ts";
import { EXAMPLES } from "../lib/dsl-reference.ts";

const require = createRequire(import.meta.url);
const dir = join(import.meta.dirname, "e2e");
const coveredBy = new Map<string, string[]>();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".cjs"))) {
  for (const k of (require(join(dir, f)).covers ?? []) as string[]) coveredBy.set(k, [...(coveredBy.get(k) ?? []), f]);
}
const defs = Object.values(KINDS) as { kind: string; preview?: string; e2ePending?: string }[];
const exempt = (d: (typeof defs)[number]) => d.preview ? "preview" : d.e2ePending ? "e2ePending" : null;

test("every view kind not exempt is drawn by an e2e area", () => {
  const missing = defs.filter((d) => !exempt(d) && !coveredBy.has(d.kind)).map((d) => d.kind);
  assert.deepEqual(missing, [], "add these kinds to an area's `covers` (test/e2e/view-kinds.cjs draws a kind's snapshot example), " +
    "or, for a provisional kind, give its lib/views/<kind>/kind.ts an `e2ePending` reason");
});

test("an exempt kind is not also listed as covered, so the exemption stays true", () => {
  const both = defs.filter((d) => exempt(d) && coveredBy.has(d.kind)).map((d) => d.kind + " (" + exempt(d) + ", covered by " + coveredBy.get(d.kind)!.join(", ") + ")");
  assert.deepEqual(both, [], "a kind with a browser check drops its `e2ePending`");
});

test("every kind an area covers exists, and is covered by one area", () => {
  assert.deepEqual([...coveredBy.keys()].filter((k) => !Object.hasOwn(KINDS, k)), [], "unknown kinds in `covers`");
  assert.deepEqual([...coveredBy].filter(([, fs]) => fs.length > 1).map(([k, fs]) => k + ": " + fs.join(", ")), []);
});

test("every kind the view-kinds area draws has a snapshot example it can open without custom data", () => {
  const { covers } = require(join(dir, "view-kinds.cjs")) as { covers: string[] };
  const bad = covers.filter((k) => { const ex = EXAMPLES.find((e) => e.snapshot === k); return !ex || ex.customData?.length; });
  assert.deepEqual(bad, []);
});

test("an e2ePending reason says something", () => {
  assert.deepEqual(defs.filter((d) => d.e2ePending !== undefined && !d.e2ePending.trim()).map((d) => d.kind), []);
});
