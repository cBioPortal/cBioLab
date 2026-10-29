// Each view kind's part of the DSL reference (lib/views/<kind>/doc.ts) is its own: its Views-table row,
// its agent-grammar entry and its examples describe that kind, so lib/dsl-reference.ts can assemble
// them without listing a kind itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND_DOCS } from "../lib/views/docs.ts";
import { AGENT_GRAMMAR, renderDslMarkdown } from "../lib/dsl-reference.ts";

for (const [kind, d] of Object.entries(KIND_DOCS)) {
  test(kind + ": its doc.ts describes " + kind, () => {
    assert.ok(d.grammar.startsWith('{"kind":"' + kind + '"'), "grammar starts with its own view object");
    assert.ok(!/,\s*$/.test(d.grammar.split("\n").filter((l) => !l.trimStart().startsWith("//")).at(-1)!),
      "the list's punctuation is added by the assembler, not the entry");
    assert.ok(d.reference.trim() && !d.reference.startsWith("|") && !d.reference.endsWith("|"),
      "reference is the row after the kind's own cell, without the outer pipes");
    for (const ex of d.examples ?? [])
      assert.ok(ex.doc.views?.some((v) => v.kind === kind), ex.title + " draws a " + kind + " view");
  });
}

test("the assembled reference holds every kind once, in the registry's order", () => {
  const md = renderDslMarkdown();
  const table = md.slice(md.indexOf("| kind | fields | semantics |")).split("\n\n")[0];
  assert.deepEqual([...table.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]), Object.keys(KIND_DOCS));
  const list = AGENT_GRAMMAR.slice(AGENT_GRAMMAR.indexOf('"views": [ '), AGENT_GRAMMAR.indexOf(" ] }"));
  assert.deepEqual([...list.matchAll(/(?:^ {13}|"views": \[ )\{"kind":"(\w+)"/gm)].map((m) => m[1]), Object.keys(KIND_DOCS));
});
