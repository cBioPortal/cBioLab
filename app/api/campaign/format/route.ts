// What an agent needs to write hypotheses: the hypothesis format and the Analysis-document
// grammar, from the same modules the MCP tools and the in-app generator read.
import { HYPOTHESIS_GRAMMAR } from "../../../../lib/hypothesis.ts";
import { CHAT_GRAMMAR } from "../../../../lib/dsl-reference.ts";

export async function GET() {
  return new Response(HYPOTHESIS_GRAMMAR + "\n\n---\nTHE ANALYSIS DOCUMENT GRAMMAR\n\n" + CHAT_GRAMMAR,
    { headers: { "content-type": "text/plain; charset=utf-8" } });
}
