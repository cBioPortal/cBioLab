// In-app chat: a Claude tool-use loop over the Analysis document.
// The model reads the current document + result summary and may call
// update_document to modify it; the client applies the returned doc and re-runs.
import { runAnalysis } from "../../../lib/analysis.js";

export const maxDuration = 60;

const SYSTEM = `You are the analysis assistant inside Cohort Lab, a cohort-analysis tool over the
msk_chord_2024 study (24,950 patients; MSK-IMPACT panel sequencing + rich clinical timelines).
You have intimate knowledge of its Analysis document DSL and you edit the SAME document the user
sees: when you call update_document, the UI applies it and re-runs immediately.

Document shape:
{ "cohorts": { "<name>": <cohortDef>, ... (max 6) },
  "views": [ {"kind":"compare","genes":[...],"cohorts":[names?]},
             {"kind":"survival","cohorts":[names?]},
             {"kind":"oncoprint","genes":[...(max 12)],"cohorts":[names?]} ] }

cohortDef: { "all": [clause, ...] } — clauses ANDed. clause = leaf | {"any":[leaf,...]} | {"not":leaf}.
Leaf kinds:
- {"kind":"alteration","gene":"STK11","driver":"driverOnly"|"any","types":["MUT","CNA","SV"]?}
  driver calls come from a version-pinned OncoKB store; "driverOnly" excludes VUS.
- {"kind":"clinical","attribute":"GENDER","op":"=","value":"Male"} (ops = != > >= < <=; numeric values compare numerically).
  Useful attributes: OS_STATUS (0:LIVING/1:DECEASED), OS_MONTHS, GENDER, RACE, CURRENT_AGE_DEID,
  SMOKING_PREDICTIONS_3_CLASSES (Former/Current Smoker, Never, Unknown), CANCER_TYPE-site flags (LUNG, LIVER, BONE... values Yes/No).
- {"kind":"event", "a":{selector}, "b":{selector}?, "rel":{...}, "priorGuard":bool} — timeline DSL:
  selectors: eventType (Treatment, Diagnosis, Lab_Test, Surgery, Pathology, "Treatment line (derived)"),
  attrs [{key,value}] (Treatment SUBTYPE: Immuno/Chemo/Targeted/Hormone/Biologic/Radiation Therapy;
  Diagnosis PROGRESSION=Y; Lab_Test TEST: PSA/CEA/CA 15-3/CA 19-9 with numeric{key:"RESULT",op,value});
  occurrence ANY|FIRST|LAST. rel: {"type":"NONE"} | {"type":"BEFORE","minDays":0,"maxDays":N} |
  {"type":"DURING"} | {"type":"NOT_FOLLOWED_BY","withinDays":N,"observed":true}.
  For absence queries ALWAYS set observed:true (else "no event" conflates with lost-to-follow-up).
  priorGuard:true restricts to treatment-naive patients — REQUIRED for honest "first-line" claims
  (~20% of patients had prior treatment elsewhere, ~20% undetermined).
- {"kind":"patients","ids":[...]} — explicit list.
- {"kind":"oql","q":"KRAS: MUT=G12C; STK11: DRIVER"} — cBioPortal OQL (subset): per gene MUT,
  MUT=<pchange>, MISSENSE/NONSENSE/TRUNC/INFRAME/SPLICE, AMP, HOMDEL, FUSION, DRIVER and _DRIVER
  modifiers; entries separated by ';' are OR'd (portal "altered in query" semantics).
  GAIN/HETLOSS/EXP/PROT/GERMLINE are rejected — do not use them.

Rules: keep cohort names short and meaningful. Preserve parts of the document the user didn't ask to
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
    for (let round = 0; round < 3; round++) {
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
      newDoc = toolUse.input.document;
      // validate by running; feed a compact result back so the model can narrate real numbers
      let toolResult;
      try {
        const r = await runAnalysis(newDoc);
        toolResult = "applied. cohorts: " +
          Object.entries(r.cohorts).map(([n, c]) => `${n}=${c.count}`).join(", ") +
          (r.views.some(v => v.kind === "survival") ? " | medians: " + r.views.find(v => v.kind === "survival").curves.map(c => `${c.cohort}:${c.median ? c.median.toFixed(1) : ">obs"}mo`).join(", ") : "");
      } catch (e) {
        toolResult = "REJECTED: " + String(e.message || e);
        newDoc = null;
      }
      convo.push({ role: "assistant", content: out.content });
      convo.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResult }] });
    }
    return Response.json({ reply: reply || "(no reply)", doc: newDoc });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
