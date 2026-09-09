// Template parameters: the substitution rule, and the places it deliberately
// does nothing.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveParams, parameterize, paramRef } from "../lib/params.ts";

const base = { cohorts: { c: { all: [] } } };

describe("a $name value is replaced by its parameter", () => {
  test("substitutes whole values, preserving type", () => {
    const { doc } = resolveParams({ ...base, params: { genes: ["TP53", "KRAS"], study: "s1" },
      study: "$study", views: [{ kind: "compare", genes: "$genes" }] } as any);
    const v: any = (doc.views || [])[0];
    assert.equal(doc.study, "s1");
    assert.deepEqual(v.genes, ["TP53", "KRAS"], "an array parameter must arrive as an array, not a string");
  });

  test("does NOT interpolate inside a longer string", () => {
    // Keeping the rule to whole-value replacement is what makes it a
    // substitution rather than a template language.
    const { doc } = resolveParams({ ...base, params: { g: "TP53" },
      views: [{ kind: "compare", genes: ["$g mutations"] }] } as any);
    assert.deepEqual(((doc.views || [])[0] as any).genes, ["$g mutations"]);
  });

  test("does NOT touch object keys", () => {
    const { doc } = resolveParams({ params: { name: "renamed" },
      cohorts: { "$name": { all: [] } } } as any);
    assert.deepEqual(Object.keys(doc.cohorts), ["$name"]);
  });

  test("substitutes at any depth", () => {
    const { doc } = resolveParams({ params: { q: "TP53: MUT" },
      cohorts: { c: { all: [{ any: [{ kind: "oql", q: "$q" }] }] } } } as any);
    assert.equal((doc.cohorts.c as any).all[0].any[0].q, "TP53: MUT");
  });

  test("the parameters are not themselves substituted", () => {
    const { doc, params } = resolveParams({ ...base, params: { a: "$b", b: "x" }, study: "$a" } as any);
    assert.equal(doc.study, "$b", "one hop only — no chaining, so there is no cycle to detect");
    assert.equal(params.a, "$b");
  });
});

describe("it refuses what it cannot resolve", () => {
  test("an unknown parameter names the path and what IS declared", () => {
    assert.throws(() => resolveParams({ ...base, params: { genes: [] },
      views: [{ kind: "compare", genes: "$geens" }] } as any),
      /unknown parameter '\$geens' at views\[0\]\.genes.*\$genes/s);
  });

  test("a document with no params is passed through untouched", () => {
    // Nothing that worked before may start failing because a value begins "$".
    const doc = { ...base, study: "$notAParam" } as any;
    const r = resolveParams(doc);
    assert.equal(r.doc, doc, "the same object, not a copy");
    assert.deepEqual(r.params, {});
  });

  test("a declared-but-unreferenced parameter is reported, not fatal", () => {
    const r = resolveParams({ ...base, params: { used: "s", spare: 1 }, study: "$used" } as any);
    assert.deepEqual(r.unused, ["spare"]);
  });

  test("an unusable parameter name is refused", () => {
    assert.throws(() => resolveParams({ ...base, params: { "two words": 1 } } as any), /not usable/);
  });
});

describe("paramRef recognises exactly the reference form", () => {
  test("accepts and rejects the right shapes", () => {
    assert.equal(paramRef("$genes"), "genes");
    assert.equal(paramRef("$_a1"), "_a1");
    assert.equal(paramRef("$1bad"), null);
    assert.equal(paramRef("$a b"), null);
    assert.equal(paramRef("genes"), null);
    assert.equal(paramRef(42), null);
  });
});

describe("parameterize lifts what it can see, and nothing else", () => {
  test("lifts the study and a gene list every view agrees on", () => {
    const out: any = parameterize({ study: "s1", cohorts: { c: { all: [] } },
      views: [{ kind: "compare", genes: ["A", "B"] }, { kind: "oncoprint", genes: ["A", "B"] }] } as any);
    assert.deepEqual(out.params, { study: "s1", genes: ["A", "B"] });
    assert.equal(out.study, "$study");
    assert.equal(out.views[0].genes, "$genes");
    assert.equal(out.views[1].genes, "$genes");
  });

  test("leaves gene lists alone when the views disagree", () => {
    // Merging different lists would change the analysis, not describe it.
    const out: any = parameterize({ study: "s1", cohorts: { c: { all: [] } },
      views: [{ kind: "compare", genes: ["A"] }, { kind: "oncoprint", genes: ["B"] }] } as any);
    assert.deepEqual(out.params, { study: "s1" });
    assert.deepEqual(out.views[0].genes, ["A"]);
  });

  test("a document that already has params is left alone", () => {
    const doc: any = { params: { x: 1 }, study: "s", cohorts: {}, views: [] };
    assert.equal(parameterize(doc), doc);
  });

  test("round-trips: parameterizing then resolving gives the original back", () => {
    const original: any = { study: "s1", cohorts: { c: { all: [] } },
      views: [{ kind: "compare", genes: ["A", "B"] }, { kind: "oncoprint", genes: ["A", "B"] }] };
    const { doc } = resolveParams(parameterize(original));
    assert.deepEqual(doc, original);
  });
});

test("a merged gene list is lifted whole, and only when every view has the same one", () => {
  const merged = [{ label: "TP53 pathway", genes: ["TP53", "MDM2"] }, "KRAS"];
  const lifted = parameterize({ study: "s", cohorts: {}, views: [
    { kind: "oncoprint", genes: merged } as never, { kind: "compare", genes: merged } as never] });
  assert.deepEqual((lifted.params as Record<string, unknown>).genes, merged);
  assert.deepEqual((lifted.views || []).map((v) => (v as unknown as { genes: unknown }).genes), ["$genes", "$genes"]);
  // the same symbols, but one view merges them: different figures, so nothing is lifted
  const notLifted = parameterize({ study: "s", cohorts: {}, views: [
    { kind: "oncoprint", genes: [{ genes: ["TP53", "MDM2"] }] } as never,
    { kind: "compare", genes: ["TP53", "MDM2"] } as never] });
  assert.equal((notLifted.params as Record<string, unknown>).genes, undefined);
});
