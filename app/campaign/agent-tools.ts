// The campaign page's steps as tools for an AI agent in the browser.
//
// Two ways in, one implementation:
//   - WebMCP: registered with document.modelContext (navigator.modelContext in Chromium
//     before 150) when the browser offers it, so an agent that supports WebMCP discovers them.
//   - window.cohortLab: the same functions as a page global, for an agent that can run
//     JavaScript in the page but does not discover WebMCP tools on its own.
// Both call /api/campaign/[id], so everything an agent submits is checked by the engine and
// frozen by the database exactly as it is for the MCP tools and the buttons on the page.

type Json = Record<string, unknown>;
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: any) => Promise<unknown>;
}

const HYPOTHESIS_SCHEMA = {
  type: "object", required: ["statement", "doc", "primary"],
  properties: {
    statement: { type: "string", description: "the claim in plain language" },
    rationale: { type: "string", description: "why it is plausible — prior literature or mechanism, never a result from this data" },
    doc: { type: "object", description: "an Analysis document {study, cohorts, views:[ONE view]} — grammar from campaign_format" },
    primary: { type: "object", description: "the single deciding result, e.g. {view:0, stat:'compare', gene:'STK11'}" },
    direction: { type: "string", enum: ["higher", "lower", "any"] }
  }
};

async function call(id: string, body: Json): Promise<Json> {
  const r = await fetch(`/api/campaign/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

function summary(v: any) {
  const c = v.campaign;
  return {
    id: c.id, question: c.question, study: c.study, status: c.status, plan: c.plan,
    lockedAt: c.lockedAt, receipt: c.ledgerHash, funnel: v.funnel,
    hypotheses: c.hypotheses.map((h: any) => ({
      position: h.position, statement: h.statement, source: h.source,
      testable: !!h.feasibility?.ok, untestableReason: h.feasibility?.ok ? undefined : h.feasibility?.reason,
      discoveryHalfGroupSizes: h.feasibility?.n, verdict: h.verdict ?? undefined,
      discoveryP: h.discovery?.p, q: h.q ?? undefined, validationP: h.validation?.p
    }))
  };
}

export function agentTools(id: string, study: string, refresh: () => void): AgentTool[] {
  const mutate = async (body: Json) => { const j = await call(id, body); refresh(); return j; };
  return [
    { name: "campaign_get", description: "The research question, study, status (draft/locked/running/complete), decision rules, and every registered hypothesis with its group sizes and results so far.",
      inputSchema: { type: "object", properties: {} },
      run: async () => summary(await (await fetch(`/api/campaign/${id}`, { cache: "no-store" })).json()) },
    { name: "campaign_format", description: "How to write a hypothesis: the hypothesis format (one declared primary result, a direction, one view) and the Analysis document grammar. Read this before writing hypotheses.",
      inputSchema: { type: "object", properties: {} },
      run: async () => (await fetch("/api/campaign/format")).text() },
    { name: "campaign_vocabulary", description: "The study's real vocabulary: clinical attributes and their values, timeline event types and attributes. Use only names that appear here.",
      inputSchema: { type: "object", properties: {} },
      run: async () => (await fetch(`/api/catalog?study=${encodeURIComponent(study)}`)).json() },
    { name: "campaign_check_hypothesis", description: "Check one hypothesis without registering it: is it well-formed, does the engine accept it, and how many patients fall in each group on the discovery half. Returns group sizes only, never an outcome.",
      inputSchema: { type: "object", required: ["hypothesis"], properties: { hypothesis: HYPOTHESIS_SCHEMA } },
      run: async ({ hypothesis }) => (await call(id, { action: "check", hypothesis })).note },
    { name: "campaign_register", description: "Register hypotheses on this draft campaign. Malformed ones are rejected with the engine's reason (fix and resubmit); groups too small to test register as untestable; duplicates are refused.",
      inputSchema: { type: "object", required: ["hypotheses"], properties: {
        hypotheses: { type: "array", items: HYPOTHESIS_SCHEMA, maxItems: 40 },
        source: { type: "string", enum: ["generator", "researcher"], description: "\"researcher\" when these write down the user's own idea; default \"generator\" (proposed by you)" } } },
      run: async ({ hypotheses, source }) => {
        const j: any = await mutate({ action: "add", source: source === "researcher" ? "researcher" : "generator", hypotheses });
        return { added: j.note.added.map((h: any) => ({ position: h.position, statement: h.statement, testable: !!h.feasibility?.ok, detail: h.feasibility?.ok ? h.feasibility.n : h.feasibility?.reason })), rejected: j.note.rejected };
      } },
    { name: "campaign_remove", description: "Remove a hypothesis from the draft by its number. Not possible after the campaign is locked.",
      inputSchema: { type: "object", required: ["position"], properties: { position: { type: "integer" } } },
      run: async ({ position }) => { await mutate({ action: "remove", position }); return `removed #${position}`; } },
    { name: "campaign_lock", description: "Pre-register: freeze and hash the hypothesis list before any result exists. IRREVERSIBLE — the database refuses any later change. Ask the user to confirm before calling.",
      inputSchema: { type: "object", properties: {} },
      run: async () => { const j: any = await mutate({ action: "lock" }); return { lockedAt: j.campaign.lockedAt, receipt: j.campaign.ledgerHash }; } },
    { name: "campaign_run", description: "Run the locked campaign: every testable hypothesis on the discovery half, one correction across all of them, survivors replicated on the held-out half. Takes about a minute. Returns the full report — report it as it is, failures included.",
      inputSchema: { type: "object", properties: {} },
      run: async () => { await mutate({ action: "run" }); return (await fetch(`/api/campaign/${id}?format=text`, { cache: "no-store" })).text(); } },
    { name: "campaign_report", description: "The campaign report as text: the funnel from registered to replicated, and every hypothesis with its result, nulls included.",
      inputSchema: { type: "object", properties: {} },
      run: async () => (await fetch(`/api/campaign/${id}?format=text`, { cache: "no-store" })).text() }
  ];
}

const asText = (x: unknown) => typeof x === "string" ? x : JSON.stringify(x, null, 2);

/**
 * Expose tools as WebMCP (when the browser offers it) and as window.cohortLab — `api` adds
 * named shortcuts next to the generic `call(name, args)`. Returns how they were exposed and a
 * cleanup for unmount.
 */
function exposeTools(tools: AgentTool[], api: Record<string, unknown>): { webmcp: boolean; cleanup: () => void } {
  const w = window as any;
  const global = {
    ...api,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input: t.inputSchema })),
    call: (name: string, args: Json = {}) => {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new Error(`no tool ${name}; have ${tools.map((x) => x.name).join(", ")}`);
      return t.run(args);
    }
  };
  w.cohortLab = global;
  const mc = (document as any).modelContext ?? (navigator as any).modelContext;
  const registered: string[] = [];
  if (mc && typeof mc.registerTool === "function") {
    for (const t of tools) {
      try {
        mc.registerTool({
          name: t.name, description: t.description, inputSchema: t.inputSchema,
          execute: async (args: any) => {
            try { return { content: [{ type: "text", text: asText(await t.run(args || {})) }] }; }
            catch (e) { return { content: [{ type: "text", text: "REJECTED: " + String((e as Error)?.message || e) }], isError: true }; }
          }
        });
        registered.push(t.name);
      } catch { /* already registered (a remount) — the existing registration serves */ }
    }
  }
  return {
    webmcp: !!mc && typeof mc.registerTool === "function",
    cleanup: () => {
      for (const n of registered) try { mc.unregisterTool(n); } catch { /* gone already */ }
      if (w.cohortLab === global) delete w.cohortLab;
    }
  };
}

/** The campaign page: every step of one campaign. */
export function installAgentTools(id: string, study: string, refresh: () => void): { webmcp: boolean; cleanup: () => void } {
  const tools = agentTools(id, study, refresh);
  const run = (i: number) => (args: Json = {}) => tools[i].run(args);
  return exposeTools(tools, {
    campaignId: id,
    getCampaign: run(0), getFormat: run(1), getVocabulary: run(2),
    checkHypothesis: (hypothesis: Json) => tools[3].run({ hypothesis }),
    registerHypotheses: (hypotheses: Json[], source?: "generator" | "researcher") => tools[4].run({ hypotheses, source }),
    removeHypothesis: (position: number) => tools[5].run({ position }),
    lock: run(6), run: run(7), report: run(8)
  });
}

/** The start page: list campaigns, and start one — which then opens its own page and tools. */
export function installIndexTools(): { webmcp: boolean; cleanup: () => void } {
  const tools: AgentTool[] = [
    { name: "campaign_list", description: "Existing hypothesis campaigns: id, research question, study, status (draft/locked/running/complete) and page URL.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const j = await (await fetch("/api/campaign", { cache: "no-store" })).json();
        if (j.error) throw new Error(j.error);
        return j.campaigns.map((c: any) => ({ id: c.id, question: c.question, study: c.study, status: c.status, url: `${location.origin}/campaign/${c.id}` }));
      } },
    { name: "campaign_create", description: "Start a hypothesis campaign for the user's research question (in their words). Its decision rules are fixed now. The browser then opens the campaign's page, which exposes the tools for writing, checking, registering, locking and running hypotheses — continue there with window.cohortLab.",
      inputSchema: { type: "object", required: ["question"], properties: {
        question: { type: "string", description: "the research question, as the user put it" },
        study: { type: "string", description: "cBioPortal study id; default msk_chord_2024" } } },
      run: async ({ question, study }) => {
        const r = await fetch("/api/campaign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, study: study || "msk_chord_2024" }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        const url = `${location.origin}/campaign/${j.campaign.id}`;
        setTimeout(() => location.assign(url), 400);
        return { id: j.campaign.id, url, plan: j.campaign.plan, next: "Opening the campaign page. Once it loads, read its \"For AI agents\" section and use window.cohortLab there (getFormat, getVocabulary, checkHypothesis, registerHypotheses)." };
      } }
  ];
  return exposeTools(tools, {
    listCampaigns: () => tools[0].run({}),
    createCampaign: (question: string, study?: string) => tools[1].run({ question, study })
  });
}
