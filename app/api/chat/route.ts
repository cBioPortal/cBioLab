// In-app chat: a Claude tool-use loop over the Analysis document.
// The model reads the current document + result summary and may call
// update_document to modify it; the client applies the returned doc and re-runs.
import { runAnalysis } from "../../../lib/analysis.ts";
import { catalogText } from "../../../lib/catalog-text.ts";
import { CHAT_GRAMMAR } from "../../../lib/dsl-reference.ts";

export const maxDuration = 60;

const SYSTEM = `You are the analysis assistant inside Cohort Lab, a cohort-analysis tool over
cBioPortal studies. The current study is the "study" field of <current_document>; keep it in any
document you emit. Attribute/event vocabularies are per-study (the examples below are from MSK
studies; other studies differ — timeline events exist mainly in MSK studies).
You have intimate knowledge of its Analysis document DSL and you edit the SAME document the user
sees: when you call update_document, the UI applies it and re-runs immediately.

${CHAT_GRAMMAR}

Rules: when unsure of an attribute name, value spelling, or event type in the current study, call
get_catalog FIRST instead of guessing — vocabularies differ per study and a wrong value silently
matches nobody. Keep cohort names short and meaningful. Preserve parts of the document the user didn't ask to
change. Surface caveats (panel-aware denominators, VUS vs driver, left truncation in survival,
prior-treatment guard) when they matter. After updating, briefly say what changed and what the user
might look at next. If a request exceeds the DSL, say so plainly instead of approximating silently.`;

const TOOLS = [{
  name: "update_document",
  description: "Replace the Analysis document. The UI applies it and re-runs immediately. Send the COMPLETE document (cohorts + views), not a fragment.",
  input_schema: {
    type: "object", required: ["document"],
    properties: { document: { type: "object", description: "The full Analysis document" } }
  }
}, {
  name: "get_catalog",
  description: "Look up a study's real queryable vocabulary: clinical attributes with their actual values and patient counts, timeline event types, most-altered genes, case lists, and molecular profiles. Use this BEFORE composing clauses whenever you are not certain of an attribute name, value spelling, or event type in the current study — especially in non-MSK studies.",
  input_schema: {
    type: "object",
    properties: { study: { type: "string", description: "Study id; defaults to the current document's study" } }
  }
}];


export async function GET() {
  return new Response(null, { status: process.env.ANTHROPIC_API_KEY ? 204 : 501 });
}

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "chat is not configured (ANTHROPIC_API_KEY missing)" }, { status: 501 });
  try {
    const { messages, doc, resultSummary } = await req.json();
    const convo = [
      ...messages.slice(-12).map(m => ({ role: m.role, content: m.content })),
    ];
    convo[convo.length - 1] = {
      role: "user",
      content: convo[convo.length - 1].content +
        "\n\n<current_document>\n" + JSON.stringify(doc) + "\n</current_document>\n" +
        "<current_results>\n" + String(resultSummary || "").slice(0, 3000) + "\n</current_results>"
    };
    let newDoc = null, reply = "";
    for (let round = 0; round < 4; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.CHAT_MODEL || "claude-sonnet-5", max_tokens: 1500, system: SYSTEM, tools: TOOLS, messages: convo })
      });
      const out = await res.json();
      if (out.error) throw new Error(out.error.message || JSON.stringify(out.error));
      const toolUse = (out.content || []).find(b => b.type === "tool_use");
      reply = (out.content || []).filter(b => b.type === "text").map(b => b.text).join("\n") || reply;
      if (!toolUse) break;
      let toolResult;
      if (toolUse.name === "get_catalog") {
        try { toolResult = await catalogText(toolUse.input.study || (doc && doc.study)); }
        catch (e) { toolResult = "catalog lookup failed: " + String(e.message || e); }
      } else {
        newDoc = toolUse.input.document;
        // validate by running; feed a compact result back so the model can narrate real numbers
        try {
          const r = await runAnalysis(newDoc);
          toolResult = "applied. cohorts: " +
            Object.entries(r.cohorts).map(([n, c]) => `${n}=${c.count}`).join(", ") +
            (r.views.some(v => v.kind === "survival") ? " | medians: " + r.views.find(v => v.kind === "survival").curves.map(c => `${c.cohort}:${c.median ? c.median.toFixed(1) : ">obs"}mo`).join(", ") : "");
        } catch (e) {
          toolResult = "REJECTED: " + String(e.message || e);
          newDoc = null;
        }
      }
      convo.push({ role: "assistant", content: out.content });
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResult }] });
    }
    return Response.json({ reply: reply || "(no reply)", doc: newDoc });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
