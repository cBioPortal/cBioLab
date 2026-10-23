// Source tripwire: every view kind must have a plain-language explanation for the "?" button
// every view's header shows (ViewHead in app/lab/view-chrome.tsx, or the two view kinds — course,
// sequence — that build their own header and call ViewHelpButton directly). A kind with no
// entry would silently render no help button at all rather than an error, the same failure
// mode test/mcp-views.test.ts exists to catch for MCP's own per-kind formatting.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VIEW_HELP } from "../lib/view-help.ts";
import { viewKinds } from "./support/view-kinds.ts";

// the view cards (app/lab/view-cards.tsx) are where course and sequence draw their own headers
const cards = readFileSync(new URL("../app/lab/view-cards.tsx", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../app/lab/view-chrome.tsx", import.meta.url), "utf8");

/** every view kind the document language has (test/support/view-kinds.ts) */
const engineViewKinds = viewKinds;

describe("VIEW_HELP: every view kind has a plain-language explanation", () => {
  test("no view kind is missing an entry", () => {
    const engine = engineViewKinds();
    assert.ok(engine.length >= 9, "expected the full View union; found " + engine.join(", "));
    const missing = engine.filter((k) => !VIEW_HELP[k]);
    assert.deepEqual(missing, [],
      "these view kinds have no VIEW_HELP entry, so their header's \"?\" button silently shows " +
      "nothing — add one in lib/view-help.ts: " + missing.join(", "));
  });

  test("every entry is real prose, not a placeholder", () => {
    for (const [kind, help] of Object.entries(VIEW_HELP)) {
      assert.ok(help.title && help.title.length > 0, kind + ": missing title");
      assert.ok(help.text && help.text.length >= 60, kind + ": text too short to be a real explanation");
      // a jargon smell-test, not a hard rule: these words are exactly what "not a scientist"
      // means avoiding, so an entry that leans on them without ever explaining itself in plain
      // words alongside is worth a second look — not banned outright, since e.g. "gene" and
      // "mutation" are unavoidable and already familiar to a general reader.
      assert.ok(!/\bp-value\b|\bhazard\b(?!\s+ratio)|\bchi-squared\b|\bpartial likelihood\b/i.test(help.text),
        kind + ": leans on statistical jargon a non-scientist reader wouldn't know");
    }
  });

  test("every view kind that renders a header wires up the same help button", () => {
    // ViewHead (used by 10 of 12 kinds) renders ViewHelpButton itself, once, for all of them.
    // course/sequence build their own header and must call it directly — this guards against
    // either path silently regressing back to no button at all.
    assert.match(chrome, /<ViewHelpButton kind=\{v\.kind\}/, "ViewHead itself must render the help button");
    for (const kind of ["course", "sequence"]) {
      assert.match(cards, new RegExp('<ViewHelpButton kind="' + kind + '"'),
        kind + "'s own custom header must call ViewHelpButton directly, since it doesn't use ViewHead");
    }
  });
});
