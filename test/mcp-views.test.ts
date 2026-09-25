// Source tripwire: every view kind the engine can produce must be described by
// the MCP run_analysis tool.
//
// The failure this exists to prevent is silent. run_analysis formats results in
// an if/else chain over `v.kind`; a kind with no branch used to append NOTHING,
// so the view ran, the numbers existed, and the model was simply never told.
// That is worse than an error — a model writes about figures it cannot see, and
// nothing in the response signals the omission. Six of nine kinds were in that
// state (cooccurrence, clinical, coexpression, hotspots, course, sequence)
// before this test existed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = readFileSync(new URL("../mcp/tools.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const reference = readFileSync(new URL("../lib/dsl-reference.ts", import.meta.url), "utf8");

/** every kind in the View union, e.g. CompareView -> "compare" */
function engineViewKinds(): string[] {
  const m = /export type View = ([^;]+);/.exec(types);
  assert.ok(m, "could not find the View union in lib/types.ts — did it move?");
  return [...new Set([...m![1].matchAll(/(\w+)View/g)].map((x) => x[1].toLowerCase()))].sort();
}

/** the kinds run_analysis has a formatter branch for */
function describedKinds(): string[] {
  const start = tools.indexOf("for (const v of r.views)");
  assert.ok(start > 0, "could not find the view loop in mcp/tools.ts");
  const end = tools.indexOf("Interactive editor", start);
  const body = tools.slice(start, end);
  return [...new Set([...body.matchAll(/v\.kind === "(\w+)"/g)].map((x) => x[1]))].sort();
}

describe("MCP run_analysis describes every view the engine can produce", () => {
  test("no view kind is silently omitted", () => {
    const engine = engineViewKinds();
    const described = describedKinds();
    assert.ok(engine.length >= 9, "expected the full View union; found " + engine.join(", "));
    const missing = engine.filter((k) => !described.includes(k));
    assert.deepEqual(missing, [],
      "these view kinds run but say nothing back to the model — add a branch in " +
      "mcp/tools.ts run_analysis: " + missing.join(", "));
  });

  test("the tool description and describe_dsl's views table name every kind", () => {
    // A client reads the tool description before anything else; a kind missing from it
    // is one the model will not think to ask for.
    const desc = /"run_analysis",\s*"([^"]+)"/.exec(tools);
    assert.ok(desc, "could not find the run_analysis description in mcp/tools.ts");
    const ref = reference.replace(/\\`/g, "`");
    const table = ref.slice(ref.indexOf("\n## Views"), ref.indexOf("\n### Plot axes"));
    assert.ok(table.length > 100, "could not find the views table in lib/dsl-reference.ts");
    for (const k of engineViewKinds()) {
      assert.match(desc![1], new RegExp("\\b" + k + "\\b"), "run_analysis's description never mentions the " + k + " view");
      assert.match(table, new RegExp("\\n\\| `" + k + "` \\|"), "describe_dsl's views table has no " + k + " row");
    }
  });

  test("and an unknown kind still says so rather than vanishing", () => {
    // Belt and braces: even if someone adds a view and forgets the branch, the
    // response must admit it rather than quietly drop the figure.
    const start = tools.indexOf("for (const v of r.views)");
    const body = tools.slice(start, tools.indexOf("Interactive editor", start));
    assert.match(body, /\}\s*else\s*\{/,
      "the if/else chain needs a final else, or an unhandled kind appends nothing");
    assert.match(body, /has no text rendering for it yet/);
  });

  test("the author's note is read from annotationNote, not the engine's note", () => {
    // lib/analysis.ts writes the AUTHOR's per-view note to `annotationNote`;
    // `note` is the engine's own (federation caveats and the like). Reading the
    // wrong one meant notes written through MCP never came back.
    assert.match(tools, /annotationNote/,
      "run_analysis must surface the author's note field");
  });

  test("engine caveats reach the model for every described view", () => {
    // Methodology the engine attaches (left truncation, panel-aware
    // denominators, non-harmonised vocabularies) is what stops a model
    // overstating a result, so it must not be dropped in formatting.
    const start = tools.indexOf("for (const v of r.views)");
    const body = tools.slice(start, tools.indexOf("Interactive editor", start));
    const branches = (body.match(/v\.kind === "\w+"/g) || []).length;
    const caveats = (body.match(/caveatOf\(v\)|v\.caveat/g) || []).length;
    assert.ok(caveats >= branches - 2,
      `${branches} view branches but only ${caveats} surface a caveat`);
  });
});

describe("MCP run_analysis attaches the figures themselves", () => {
  test("figures come from the SAME renderer the web app uses", () => {
    // Not a second drawing path: lib/view-svg.ts is the one renderer, so a
    // figure in a chat transcript and a figure in the app cannot diverge.
    assert.match(tools, /import \{ viewToSvg, viewTitle \} from "\.\.\/lib\/view-svg\.ts"/);
    assert.match(tools, /v\.svg \|\| viewToSvg\(v, \{ theme: "light" \}\)/,
      "the oncoprint carries its own svg; every other kind is rendered on demand");
  });

  test("rasterised at a fixed light theme, not the page theme", () => {
    // The SVGs colour themselves from CSS custom properties so they follow the
    // app's theme. Outside the app those variables do not exist, so a figure
    // rasterised without a fixed theme would fall back unpredictably.
    assert.match(tools, /theme: "light"/);
  });

  test("the figure count is capped and what is dropped is named", () => {
    assert.match(tools, /MAX_FIGURES/);
    assert.match(tools, /further figure/,
      "a figure that does not fit must be reported, not silently omitted");
    assert.match(tools, /Figures attached, in order/,
      "images arrive without captions, so the model needs a manifest to tell them apart");
  });
});

describe("every view kind is DOCUMENTED, not just implemented", () => {
  // Two hand-maintained lists describe the DSL to a reader and to a model. Both
  // drift the same way the MCP formatter did: a view is added, the list is not,
  // and the capability exists but is undiscoverable. `plot` shipped missing from
  // the chat grammar, which is what prompted this test.
  test("the markdown reference has a row for every view kind", () => {
    const kinds = engineViewKinds();
    const missing = kinds.filter((k) => !new RegExp("\\|\\s*\\\\`" + k + "\\\\`\\s*\\|").test(reference));
    assert.deepEqual(missing, [],
      "no row in the view table of lib/dsl-reference.ts for: " + missing.join(", "));
  });

  test("the compact grammar names every view kind", () => {
    const m = /CHAT_GRAMMAR = `([\s\S]*?)`;/.exec(reference);
    assert.ok(m, "could not find CHAT_GRAMMAR");
    const named = new Set([...m![1].matchAll(/"kind":"(\w+)"/g)].map((x) => x[1]));
    const missing = engineViewKinds().filter((k) => !named.has(k));
    assert.deepEqual(missing, [],
      "CHAT_GRAMMAR does not mention: " + missing.join(", ") +
      " — a model given only this grammar cannot use them");
  });
});
