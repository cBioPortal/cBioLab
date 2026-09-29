// The hypothesis GENERATOR: Claude, asked to turn a research question into testable
// hypotheses written as Analysis documents. It is deliberately on the other side of a
// narrow interface from everything that judges them — it sees the study's vocabulary and
// the DSL grammar, and gets the engine's rejections back so it can repair a malformed
// document, but it never sees an outcome. Feasibility (arm sizes) is the only number it
// is shown, and that is computed from cohort definitions, not results.
//
// Any other generator — a co-scientist system, a person — can do the same job through the
// MCP tools; this one exists so the web page can demonstrate the loop end to end.
import { catalogText } from "./catalog-text.ts";
import { CHAT_GRAMMAR } from "./dsl-reference.ts";
import { checkFeasibility, type Run } from "./campaign.ts";
import { DEFAULT_PLAN, type Hypothesis } from "./hypothesis.ts";

export const HYPOTHESIS_GRAMMAR = `A HYPOTHESIS is one testable claim:
{ "statement": "<the claim in plain language a non-scientist can follow>",
  "rationale": "<why it is plausible: prior literature, mechanism, clinical experience — NEVER a result from this data, which you have not seen>",
  "doc": <an Analysis document: {study, cohorts: {name: cohortDef, ...}, views: [ONE view]}>,
  "primary": <the single result that decides it — see below>,
  "direction": "higher" | "lower" | "any" }

primary, by view kind (the view must have exactly two cohorts unless it is cox):
- {"view":0,"stat":"compare","gene":"STK11","measure":"any"|"driver"}  — that gene's alteration frequency, FIRST cohort vs SECOND
- {"view":0,"stat":"survival"}                                        — log-rank; "higher" = the FIRST cohort has the higher hazard (worse survival)
- {"view":0,"stat":"clinical","attribute":"TMB_NONSYNONYMOUS"}         — that attribute's test; for numeric, "higher" = FIRST cohort's mean is higher
- {"view":0,"stat":"cox","term":"<coefficient label>"}                — one coefficient; "higher" = hazard ratio > 1

Rules:
- ONE view per document, holding only what the primary needs (a compare view lists just the one gene).
  Every extra gene or attribute would be an extra test nobody counted.
- Cohort order matters: "direction" reads FIRST cohort relative to SECOND. Name cohorts so a reader can follow.
- Declare a direction whenever the rationale predicts one. A result in the other direction will count as NOT supported.
- Do NOT add {"kind":"split"} clauses. The campaign owns the held-out split and adds it itself.
- When several hypotheses compare the same two groups, define those groups IDENTICALLY in each (same clauses)
  so the results are comparable.
- Timeline hypotheses are welcome — progression, lines of therapy, what follows what — and are where this tool is
  strongest. For "no event within N days" always set "observed": true so patients lost to follow-up are not counted.
- Each arm needs at least ${DEFAULT_PLAN.minArm} patients in each half of the study; very narrow cohorts will be marked untestable.`;

const SYSTEM = (study: string, catalog: string) => `You are a hypothesis generator for cancer research, working with cbio-lab, a
cohort-analysis engine over cBioPortal data. A researcher gives you a question. You propose hypotheses that could
answer it, each written as a machine-checkable document. A separate referee will pre-register them, test each on
half of the patients, correct for how many were tested, and replicate survivors on the other half. You will not
see any results — so be bold and diverse, but every hypothesis must be well-formed and grounded in real prior
knowledge. Prefer hypotheses a clinician would find interesting over trivial ones.

The study is ${study}. Use ONLY attributes, values and event types that exist in it:

${catalog}

The DSL:
${CHAT_GRAMMAR}

${HYPOTHESIS_GRAMMAR}`;

const TOOL = {
  name: "submit_hypotheses",
  description: "Submit hypotheses for pre-registration. Each is checked by the engine; you will be told which were rejected and why.",
  input_schema: {
    type: "object", required: ["hypotheses"],
    properties: { hypotheses: { type: "array", items: { type: "object", required: ["statement", "doc", "primary"],
      properties: {
        statement: { type: "string" }, rationale: { type: "string" }, doc: { type: "object" },
        primary: { type: "object" }, direction: { type: "string", enum: ["higher", "lower", "any"] }
      } } } }
  }
};

type Msg = { role: "user" | "assistant"; content: unknown };

async function call(messages: Msg[], system: string, key: string): Promise<{ content: any[] }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.GENERATOR_MODEL || "claude-opus-5-5", max_tokens: 16000, system,
      tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages
    })
  });
  const out = await res.json();
  if (out.error) throw new Error("the AI generator is unavailable (" + (out.error.message || JSON.stringify(out.error)) + ") — hypotheses can still be registered from any agent over MCP, or added here as your own ideas once it is");
  return out;
}

export interface Proposal { hypotheses: Hypothesis[]; unresolved: { statement: string; reason: string }[] }

/**
 * Ask Claude for hypotheses. With `idea`, formalize one researcher's idea instead of
 * brainstorming. One repair round: documents the engine rejects go back with the reason.
 */
export async function proposeHypotheses(opts: { question: string; study: string; count?: number; idea?: string; existing?: string[]; run: Run }): Promise<Proposal> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("the generator is not configured (ANTHROPIC_API_KEY missing) — use the MCP tools to register hypotheses from any agent");
  const system = SYSTEM(opts.study, await catalogText(opts.study));
  const ask = opts.idea
    ? `Research question: ${opts.question}\n\nA researcher wants this specific idea tested: "${opts.idea}"\n` +
      `Write it as exactly ONE hypothesis, faithful to what they meant. If it cannot be expressed with this study's data, ` +
      `write the closest honest version and say in the rationale what had to change.`
    : `Research question: ${opts.question}\n\nPropose ${opts.count ?? 12} diverse hypotheses.` +
      (opts.existing?.length ? `\nAlready registered (do not repeat):\n- ${opts.existing.join("\n- ")}` : "");
  const messages: Msg[] = [{ role: "user", content: ask }];
  const good: Hypothesis[] = [];
  let bad: { h: Hypothesis; reason: string }[] = [];
  for (let round = 0; round < 2; round++) {
    const out = await call(messages, system, key);
    const use = out.content.find((b) => b.type === "tool_use");
    const hyps: Hypothesis[] = (use?.input?.hypotheses || []).map((h: Hypothesis) => ({ ...h, doc: { ...h.doc, study: opts.study } }));
    const checked = await Promise.all(hyps.map(async (h) => ({ h, f: await checkFeasibility(h, opts.run) })));
    // a small arm is a fact about the data, not a malformed document: keep it, it registers as untestable
    good.push(...checked.filter((x) => x.f.ok || /patients in the discovery half/.test(x.f.reason || "")).map((x) => x.h));
    bad = checked.filter((x) => !x.f.ok && !/patients in the discovery half/.test(x.f.reason || "")).map((x) => ({ h: x.h, reason: x.f.reason! }));
    if (!bad.length || round === 1) break;
    messages.push({ role: "assistant", content: out.content });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content:
      `${checked.length - bad.length} accepted. These were REJECTED by the engine — resubmit corrected versions of only these ` +
      `(or drop one that cannot be expressed):\n` + bad.map((b) => `- "${b.h.statement}": ${b.reason}`).join("\n") }] });
  }
  return { hypotheses: good, unresolved: bad.map((b) => ({ statement: b.h.statement, reason: b.reason })) };
}
