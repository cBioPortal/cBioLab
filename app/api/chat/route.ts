// In-app chat: a Claude tool-use loop over the Analysis document.
// The model reads the current document + result summary and may call
// update_document to modify it; the client applies the returned doc and re-runs.
import { cachedAnalysis } from "../../../lib/next-cache.ts";
import { connection } from "next/server";
import type { AnalysisDoc } from "../../../lib/types.ts";
import { catalogText } from "../../../lib/catalog-text.ts";
import { CHAT_GRAMMAR } from "../../../lib/dsl-reference.ts";
import { viewToSvg, viewTitle } from "../../../lib/view-svg.ts";
import type { AnalysisResult } from "../../../lib/types.ts";

export const maxDuration = 60;

const SYSTEM = `You are the analysis assistant inside cbio-lab, a cohort-analysis tool over
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
might look at next. If a request exceeds the DSL, say so plainly instead of approximating silently.

The views you add are RENDERED AS FIGURES and shown inline in your reply — the user sees the actual
chart, not a description of it. So: choose the views that answer the question asked (a question about
survival wants a survival view, one about which mutations occur wants hotspots), keep the document to
the few views that earn their place, and narrate what the figures show with real numbers rather than
offering to produce them. Each figure already carries its own caveat text, so do not repeat it
verbatim — say what it means for this result.`;

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
  await connection();
  return new Response(null, { status: process.env.ANTHROPIC_API_KEY ? 204 : 501 });
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "chat is not configured (ANTHROPIC_API_KEY missing)" }, { status: 501 });
  try {
    const { messages, doc, resultSummary } = await req.json() as { messages: { role: string; content: string }[]; doc: AnalysisDoc; resultSummary?: string };
    const convo = [
      ...messages.slice(-12).map((m: { role: string; content: unknown }) => ({ role: m.role, content: m.content })),
    ];
    convo[convo.length - 1] = {
      role: "user",
      content: convo[convo.length - 1].content +
        "\n\n<current_document>\n" + JSON.stringify(doc) + "\n</current_document>\n" +
        "<current_results>\n" + String(resultSummary || "").slice(0, 3000) + "\n</current_results>"
    };
    let newDoc: AnalysisDoc | null = null, reply = "";
    // The analysis is already run below to validate the document and feed real
    // numbers back to the model; keeping the result lets us return the FIGURES
    // from the same run, so a chat reply can carry its charts rather than
    // describing them.
    let lastResult: AnalysisResult | null = null;
    for (let round = 0; round < 8; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.CHAT_MODEL || "claude-sonnet-5", max_tokens: 1500, system: SYSTEM, tools: TOOLS, messages: convo })
      });
      const out = await res.json();
      if (out.error) throw new Error(out.error.message || JSON.stringify(out.error));
      const toolUse = (out.content || []).find((b: { type: string }) => b.type === "tool_use");
      reply = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n") || reply;
      if (!toolUse) break;
      let toolResult;
      if (toolUse.name === "get_catalog") {
        try { toolResult = await catalogText(toolUse.input.study || (doc && doc.study)); }
        catch (e) { toolResult = "catalog lookup failed: " + String((e as Error)?.message || e); }
      } else {
        newDoc = toolUse.input.document as AnalysisDoc;
        // validate by running; feed a compact result back so the model can narrate real numbers
        try {
          const r = await cachedAnalysis(newDoc);
          lastResult = r;
          // Feed back what each VIEW actually analysed, not just cohort sizes.
          // An anchored survival view drops patients without the anchor event, so
          // the cohort count is the wrong denominator to quote — and the model
          // will quote whatever it is given.
          const lines = ["applied. cohorts: " + Object.entries(r.cohorts).map(([n, c]) => `${n}=${c.count}`).join(", ")];
          for (const v of r.views) {
            if (v.error) { lines.push(`${v.kind}: REFUSED — ${v.error}`); continue; }
            if (v.kind === "survival" && v.curves)
              lines.push(`survival(${v.endpoint || "OS"}${v.anchoredTo ? " from " + v.anchoredTo : ""}): ` +
                v.curves.map((c) => `${c.cohort} median=${c.median == null ? "not reached" : c.median.toFixed(1) + "mo"} ANALYSED n=${c.n} events=${c.events}`).join("; ") +
                (v.logrank ? ` | log-rank p=${v.logrank.p.toExponential(2)}` : "") +
                (v.truncated ? " | left-truncated: n is patients with the anchor event, which is FEWER than the cohort — quote n, not the cohort size" : ""));
            else if (v.kind === "compare" && v.rows)
              lines.push("compare: " + v.rows.slice(0, 6).map((x) => `${x.gene} ` + x.cells.map((c) => `${c.anyPct}%`).join("/")).join(", "));
            else if (v.kind === "cooccurrence" && v.pairs)
              lines.push("cooccurrence: " + v.pairs.slice(0, 5).map((x) => `${x.a}/${x.b} ${x.tendency ?? "-"} q=${x.q.toExponential(1)}`).join(", "));
            else if (v.kind === "hotspots" && v.hotspots)
              lines.push("hotspots: " + v.hotspots.map((h) => `${h.gene} (${h.mutated} mutated) ` + h.topChanges.slice(0, 4).map((x) => `${x.change} ${x.pct}%`).join(" ")).join(" | "));
            else if (v.kind === "clinical" && v.clinical)
              lines.push("clinical: " + v.clinical.filter((x) => !x.skipped).slice(0, 5).map((x) => `${x.attribute} q=${x.q?.toExponential(1)}`).join(", "));
            else if (v.kind === "coexpression" && v.coexpression)
              lines.push("coexpression: " + v.coexpression.slice(0, 5).map((x) => `${x.a}/${x.b} r=${x.rMeta ?? x.r}`).join(", "));
          }
          toolResult = lines.join("\n");
        } catch (e) {
          toolResult = "REJECTED: " + String((e as Error)?.message || e);
          newDoc = null;
        }
      }
      convo.push({ role: "assistant", content: out.content });
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResult }] });
    }
    // The loop can end on its round budget mid-tool-use, leaving no narration at
    // all — the user would get figures with nothing said about them. One final
    // pass WITHOUT tools guarantees a reply.
    if (!reply.trim() && convo.length) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: process.env.CHAT_MODEL || "claude-sonnet-5", max_tokens: 800, system: SYSTEM,
            messages: [...convo, { role: "user", content: "Summarise what you found in two or three sentences, quoting the real numbers. The figures are already being shown to the user, so describe what they show rather than offering to make them." }] })
        });
        const out = await res.json();
        reply = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n") || reply;
      } catch { /* keep whatever we have */ }
    }

    // One figure per renderable view, each carrying its own caption — an image
    // separated from its caveat is worse than the number alone, because it looks
    // authoritative while hiding its method.
    const figures = (lastResult?.views || []).map((v) => {
      const svg = viewToSvg(v, { width: 720 });
      if (!svg) return null;
      return { kind: v.kind, title: viewTitle(v), svg, caption: v.caveat || v.note || "", ms: v.ms ?? null };
    }).filter(Boolean);
    return Response.json({ reply: reply || "(no reply)", doc: newDoc, figures });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
