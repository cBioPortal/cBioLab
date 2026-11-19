// The DSL reference as MCP describe_dsl serves it to chat clients: the compact agent grammar and an
// index of the worked examples by default, one example's document on request, and the full
// reference (docs/dsl.md, ~250K characters) only when asked for by name. Everything here is
// assembled from lib/dsl-reference.ts, so it cannot drift from the docs or the in-app assistant.
import { AGENT_GRAMMAR, EXAMPLES, exampleBlock, renderDslMarkdown } from "./dsl-reference.ts";
import { exampleFeatures, matchesSearch, studiesOf } from "./example-features.ts";

export interface DslRequest {
  /** 1-based example number, as numbered in the index and in docs/dsl.md */
  example?: number | null;
  /** words every listed example must match (title, note, view kinds, topics, studies) */
  search?: string | null;
  /** the complete reference */
  full?: boolean | null;
}

function exampleIndex(search?: string | null): string {
  const rows = EXAMPLES
    .map((ex, i) => ({ ex, n: i + 1 }))
    .filter(({ ex }) => !search || matchesSearch(ex, search))
    .map(({ ex, n }) => {
      const f = exampleFeatures(ex);
      const custom = ex.customData?.length ? " — needs uploaded custom data, not runnable here" : "";
      return `${n}. ${ex.title} [views: ${f.views.join(", ")}; studies: ${studiesOf(ex).join(", ")}]${custom}`;
    });
  const head = search
    ? `Worked examples matching "${search}" (${rows.length} of ${EXAMPLES.length}):`
    : `Worked examples (${EXAMPLES.length}):`;
  return head + "\n" + (rows.length ? rows.join("\n") : "(none — call describe_dsl without `search` for the full list)");
}

export function dslForAgents(req: DslRequest = {}): string {
  if (req.full) return renderDslMarkdown();
  if (req.example != null) {
    const ex = EXAMPLES[req.example - 1];
    if (!ex) throw new Error(`no example ${req.example}; examples are numbered 1-${EXAMPLES.length}`);
    return exampleBlock(ex, req.example - 1) +
      "\nRun it with run_analysis as it stands, or adapt it: change the study, the cohorts' clauses, or the views.";
  }
  if (req.search) return exampleIndex(req.search) + "\n\nCall describe_dsl with `example: N` for one example's full document.";
  return AGENT_GRAMMAR + "\n\n---\n\n" + exampleIndex() +
    "\n\nCall describe_dsl with `example: N` for one example's full document (the quickest way to a correct one is " +
    "to adapt the nearest example), `search: \"<words>\"` to filter this list, or `full: true` for the complete " +
    "reference (about 250,000 characters — avoid it unless the grammar above leaves a question open).";
}
