import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestAt } from "../lib/dsl-completions.ts";

const labels = (r: ReturnType<typeof suggestAt>) => (r ? r.options.map((o) => o.label) : null);

describe("suggestAt: structural JSON completions", () => {
  test("a fresh '{' offers every leaf kind as a full snippet", () => {
    const text = '{"all": [{';
    const r = suggestAt(text, text.length);
    assert.ok(labels(r)!.includes("clinical"));
    assert.ok(labels(r)!.includes("oql"));
    assert.equal(r!.options.find((o) => o.label === "clinical")!.apply!.includes('"attribute"'), true);
  });

  test("typing a kind name right after '{' narrows the snippet list instead of losing it", () => {
    // CodeMirror closes the popup the moment the source stops matching, so
    // the fresh-'{' case must keep matching (and narrowing) as letters are
    // typed, not only at the exact instant right after the brace.
    const text = '{"all": [{oq';
    const r = suggestAt(text, text.length);
    assert.deepEqual(labels(r), ["oql"]);
    assert.equal(r!.from, text.length - 2); // replaces "oq", not just inserts after it
    assert.ok(r!.options[0].apply!.startsWith('"kind": "oql"'));
  });

  test('"kind": "cli<cursor> narrows to matching kinds, replacing only the partial word', () => {
    const text = '{"all": [{"kind": "cli';
    const r = suggestAt(text, text.length);
    assert.deepEqual(labels(r), ["clinical"]);
    assert.equal(r!.from, text.length - 3); // replaces "cli", not the whole string
  });

  test('"kind": "xyz<cursor> with no match returns null (no bogus suggestions)', () => {
    const text = '{"kind": "xyz';
    assert.equal(suggestAt(text, text.length), null);
  });

  test('"attribute" suggests real attribute names from context, not a fixed list', () => {
    const text = '{"kind": "clinical", "attribute": "SEX_';
    const r = suggestAt(text, text.length, { attributes: ["SEX", "SEX_AT_BIRTH", "SMOKING_HISTORY"] });
    assert.deepEqual(labels(r), ["SEX_AT_BIRTH"]);
  });

  test('"attribute" with no context data returns null rather than guessing', () => {
    const text = '{"kind": "clinical", "attribute": "SEX';
    assert.equal(suggestAt(text, text.length, {}), null);
  });

  test('"gene" field suggests from the gene list', () => {
    const text = '{"kind": "genomicData", "gene": "TP5';
    const r = suggestAt(text, text.length, { genes: ["TP53", "TP63", "KRAS"] });
    assert.deepEqual(labels(r), ["TP53"]);
  });

  test("fixed enums: op, per, type, metric", () => {
    assert.deepEqual(labels(suggestAt('{"op": ">', '{"op": ">'.length)), [">", ">="]);
    assert.deepEqual(labels(suggestAt('{"per": "pat', '{"per": "pat'.length)), ["patient"]);
    assert.deepEqual(labels(suggestAt('{"type": "MU', '{"type": "MU'.length)), ["MUTATION"]);
    assert.deepEqual(labels(suggestAt('{"metric": "lin', '{"metric": "lin'.length)), ["lines"]);
  });

  test("mid-document cursor only looks at text before the cursor", () => {
    // trailing content after the cursor must not confuse the match
    const text = '{"kind": "cl" , "ignored": "clinical-lookalike-tail"';
    const pos = '{"kind": "cl'.length;
    assert.deepEqual(labels(suggestAt(text, pos)), ["clinical"]);
  });
});

describe("suggestAt: OQL string completions", () => {
  const inQ = (partial: string) => `{"kind": "oql", "q": "${partial}`;

  test("no colon yet in the current entry: suggest genes", () => {
    const text = inQ("TP5");
    const r = suggestAt(text, text.length, { genes: ["TP53", "TP63", "KRAS"] });
    assert.deepEqual(labels(r), ["TP53"]);
  });

  test("after the colon: suggest OQL modifier tokens", () => {
    const text = inQ("TP53: MU");
    const r = suggestAt(text, text.length, {});
    assert.ok(labels(r)!.includes("MUT"));
    assert.ok(labels(r)!.includes("MUT="));
    assert.ok(!labels(r)!.includes("AMP"));
  });

  test("second entry after a ';' resets to gene position", () => {
    const text = inQ("TP53: MUT; KRA");
    const r = suggestAt(text, text.length, { genes: ["TP53", "KRAS"] });
    assert.deepEqual(labels(r), ["KRAS"]);
  });

  test("MUT= continues into protein-change class shorthand", () => {
    const text = inQ("TP53: MUT=TRU");
    const r = suggestAt(text, text.length, {});
    assert.deepEqual(labels(r), ["TRUNC"]);
  });

  test("DRIVER and other bare tokens still suggested case-insensitively", () => {
    const text = inQ("STK11: dri");
    const r = suggestAt(text, text.length, {});
    assert.ok(labels(r)!.includes("DRIVER"));
  });

  test("a string that isn't the 'q' key is not treated as OQL", () => {
    const text = '{"kind": "clinical", "attribute": "TP53: MU';
    // this matches the "attribute" pattern, not OQL — modifiers must not leak in
    const r = suggestAt(text, text.length, { attributes: [] });
    assert.equal(r, null);
  });

  test("cursor outside any string returns null", () => {
    const text = '{"kind": "oql", "q": "TP53: MUT"} ';
    assert.equal(suggestAt(text, text.length, { genes: ["TP53"] }), null);
  });
});
