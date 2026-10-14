// The chat sidebar's model (app/_agent/ChatSidebar.tsx) — the one place this app calls a model.
//
// The model reaches the app only through the page's WebMCP tools, exactly as an outside assistant
// does (Claude in Chrome, Claude Desktop): the browser sends the tools the page it is on exposes
// (window.cohortLab.tools), they are declared here WITHOUT an implementation, and each call the
// model makes streams back to the browser, which runs it through window.cohortLab.call and sends
// the result with the next request. This route never touches the database, the engine or the
// document; it holds no tool of its own.
//
// GET says whether this deployment has chat (lib/chat-model.ts: a dev server, or a deployment that
// opts in off Vercel) and whether this browser must sign in first, as a deployment requires.
import { convertToModelMessages, jsonSchema, streamText, tool, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { connection } from "next/server";
import { chatConfig, chatModel, chatProviderOptions, type ChatConfig } from "../../../lib/chat-model.ts";
import { AccessError, loginEnabled, requirePrincipal, userFor } from "../../../lib/auth.ts";

export const maxDuration = 300;

const PageTool = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "a tool name is 1–64 letters, digits, _ or -"),
  description: z.string().max(4000),
  input: z.record(z.string(), z.unknown())
});
const ChatRequest = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(400),
  page: z.string().max(100).default("unknown"),
  tools: z.array(PageTool).max(64).default([])
});

const instructions = (page: string, names: string[]) => `You are the research assistant in the chat sidebar of cbio-lab, a cohort-analysis tool built on cBioPortal data.

You act on the site only through the tools the current page exposes: the same WebMCP tools any researcher's assistant uses from outside the page. You cannot see the page except through them. Each page has its own tools; site_pages lists the pages and site_open moves to another one. After site_open the browser loads that page and this conversation continues there with its tools, so carry on with the task once they appear.

Edits are run by the engine before they reach the page. A tool result that is an error means nothing changed: tell the researcher the engine's reason, and do not describe the edit as made. Report counts, percentages and statistics only as a tool returned them, never estimated or remembered. When something cannot be done with the tools here, say so.

Be brief: the sidebar is narrow. Use short paragraphs and lists; use a table only for a few rows.

Current page: ${page}. Its tools: ${names.length ? names.join(", ") : "none"}.`;

/** This deployment's chat, or null: one that needs a sign-in but signs nobody in has none. */
function config(): ChatConfig | null {
  const c = chatConfig();
  return c && (!c.signIn || loginEnabled()) ? c : null;
}

export async function GET(req: Request) {
  await connection();
  let c = null;
  try { c = config(); } catch { /* reported by POST */ }
  return Response.json({ enabled: !!c, provider: c?.provider ?? null, model: c?.model ?? null,
    signInRequired: !!c?.signIn && !userFor(req) });
}

export async function POST(req: Request) {
  let c;
  try {
    c = config();
    if (!c) return Response.json({ error: "this deployment has no chat" }, { status: 404 });
    if (c.signIn) requirePrincipal(req, "use the assistant");
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 500 });
  }

  let body;
  try {
    const r = ChatRequest.safeParse(await req.json());
    if (!r.success) throw new Error("request body: " + r.error.issues.map((i) => (i.path.length ? i.path.join(".") + ": " : "") + i.message).join("; "));
    body = r.data;
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }

  // declared, not implemented: the browser runs each call (onToolCall in the sidebar)
  const tools: ToolSet = {};
  for (const t of body.tools) tools[t.name] = tool({ description: t.description, inputSchema: jsonSchema(t.input) });

  const result = streamText({
    model: chatModel(c),
    system: instructions(body.page, body.tools.map((t) => t.name)),
    messages: await convertToModelMessages(body.messages as unknown as UIMessage[], { ignoreIncompleteToolCalls: true }),
    tools,
    maxOutputTokens: 64000,
    providerOptions: chatProviderOptions(c),
    abortSignal: req.signal
  });
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onError: (e) => String((e as Error)?.message || e)
  });
}
