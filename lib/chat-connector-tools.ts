// The chat route's side of the connectors (issue #128): for one request, connect to each connector
// the reader has on, and turn its tools into tools the model can call — every one waiting for the
// reader's approval before it runs. Server only.
//
// A request names connectors by id and may carry the reader's token for each; the URL always comes
// from the registry (lib/chat-connectors.ts), so a request cannot point this at an address of its
// own choosing. A token is put in the Authorization header of the call and nowhere else: it is not
// logged, not cached, not returned. A connector that cannot be reached, or refuses the token, is
// reported and left out for the turn; it never fails the chat.
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { jsonSchema, tool, type ToolSet } from "ai";
import { chatConfig } from "./chat-model.ts";
import { loginEnabled, requirePrincipal, AccessError } from "./auth.ts";
import { MAX_TOOLS, parseConnectors, toolName, tokenHeader, validToolName, type Connector, type ConnectorStatus } from "./chat-connectors.ts";

/** The deployment's connectors (CHAT_CONNECTORS or the defaults); a malformed setting is an error, not a quiet omission. */
export const registry = (): Connector[] => parseConnectors(process.env.CHAT_CONNECTORS);

/**
 * The secret that signs each approval request, so a browser cannot send an approval for a call the
 * model never made. A deployment with several instances sets CHAT_APPROVAL_SECRET (or
 * AUTH_SESSION_SECRET) so they agree; otherwise each instance has its own, and an approval that
 * reaches another one is refused and the call is asked for again.
 */
const own = randomBytes(32).toString("hex");
export const approvalSecret = (): string => process.env.CHAT_APPROVAL_SECRET || process.env.AUTH_SESSION_SECRET || own;

/** Where the chat is not on, or the reader must sign in first, the connector routes answer as /api/chat does; null when allowed. */
export function chatGuard(req: Request): Response | null {
  try {
    const c = chatConfig();
    if (!c || (c.signIn && !loginEnabled())) return Response.json({ error: "this deployment has no chat" }, { status: 404 });
    if (c.signIn) requirePrincipal(req, "use the assistant");
    return null;
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 500 });
  }
}

export const CONNECT_MS = 15_000;
export const CALL_MS = 120_000;
/** what a connector's answer may be, so one cannot fill the model's context */
export const MAX_RESULT_CHARS = 60_000;

export interface Requested { id: string; token?: string }
export interface Connected {
  tools: ToolSet;
  /** one entry per connector that was asked for, in the order asked */
  status: ConnectorStatus[];
  /** ends every connection; safe to call more than once */
  close: () => Promise<void>;
}

/**
 * A connector is used one request and one answer at a time, within a chat turn, so the stream a server
 * may open to push messages of its own is declined (a 405, which the MCP spec lets a client take as "not
 * offered"). Some servers hold that stream open and answer nothing else while it is: OpenEvidence's did.
 */
const noPushStream: typeof fetch = (input, init) =>
  (init?.method ?? "GET") === "GET" ? Promise.resolve(new Response(null, { status: 405 })) : fetch(input, init);

const text = (e: unknown) => String((e as Error)?.message || e);

/** Why a connection or a call failed, in words for the reader; `signIn` when a new sign-in would help. */
export function refusal(e: unknown, auth: Connector["auth"] = "oauth"): { reason: string; signIn: boolean } {
  const code = (e as StreamableHTTPError)?.code;
  if (e instanceof UnauthorizedError || code === 401 || code === 403 || /\b40[13]\b|invalid_token|unauthori[sz]ed/i.test(text(e)))
    return { reason: auth === "token" ? "it refused the API token (missing, expired or not accepted): check it" : "it refused the sign-in (missing, expired or not accepted): connect again", signIn: true };
  if (/abort|timeout|timed out|time out/i.test(text(e))) return { reason: "it did not answer in time", signIn: false };
  return { reason: "it could not be reached: " + text(e).slice(0, 200), signIn: false };
}

/** A tool result as text: its text parts, and a note for anything else; a server's own error becomes a thrown one. */
export function resultText(r: { content?: unknown; isError?: boolean; structuredContent?: unknown }): string {
  const parts = Array.isArray(r.content) ? r.content as { type?: string; text?: string }[] : [];
  let out = parts.map((p) => p.type === "text" ? String(p.text ?? "") : `[${p.type ?? "unknown"} content not shown]`).join("\n");
  if (!out && r.structuredContent !== undefined) out = JSON.stringify(r.structuredContent, null, 2);
  if (out.length > MAX_RESULT_CHARS) out = out.slice(0, MAX_RESULT_CHARS) + `\n… [${(out.length - MAX_RESULT_CHARS).toLocaleString()} more characters not shown]`;
  if (r.isError) throw new Error(out || "the connector reported an error");
  return out;
}

export async function connectConnectors(asked: Requested[], registry: Connector[], opts: { connectMs?: number; callMs?: number } = {}): Promise<Connected> {
  const tools: ToolSet = {};
  const status: ConnectorStatus[] = [];
  const clients: Client[] = [];
  const connectMs = opts.connectMs ?? CONNECT_MS, callMs = opts.callMs ?? CALL_MS;
  const seen = new Set<string>();
  const results = await Promise.all(asked.filter((a) => !seen.has(a.id) && !!seen.add(a.id)).map(async (a) => {
    const c = registry.find((x) => x.id === a.id);
    if (!c) return { status: { id: a.id, ok: false, tools: 0, reason: "this deployment has no such connector" } as ConnectorStatus, made: {} as ToolSet };
    if (c.auth !== "none" && !a.token) return { status: { id: c.id, ok: false, tools: 0, reason: c.auth === "token" ? "no API token: add yours in the Connectors menu" : "not signed in: connect it first", signIn: true } as ConnectorStatus, made: {} as ToolSet };
    const client = new Client({ name: "cbio-lab", version: "1" });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(c.url), { fetch: noPushStream, requestInit: a.token ? { headers: tokenHeader(c, a.token) } : {} });
      await client.connect(transport, { timeout: connectMs });
      clients.push(client);
      const listed = (await client.listTools(undefined, { timeout: connectMs })).tools;
      const offered = c.tools ? listed.filter((t) => c.tools!.includes(t.name)) : listed;
      if (offered.length > MAX_TOOLS) throw new Error(`it has ${offered.length} tools, over the ${MAX_TOOLS} one request may carry; list the ones to offer in the connector's "tools"`);
      const made: ToolSet = {};
      for (const t of offered) {
        const name = toolName(c.id, t.name);
        if (!validToolName(name)) continue;   // a name the model API refuses is left out, not renamed
        made[name] = tool({
          description: `[${c.name}, an external server (${new URL(c.url).host}) — what you send leaves this app] ${t.description ?? t.name}`,
          inputSchema: jsonSchema((t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>),
          needsApproval: true,
          execute: async (args: unknown) => resultText(await client.callTool({ name: t.name, arguments: (args ?? {}) as Record<string, unknown> }, undefined, { timeout: callMs }) as Parameters<typeof resultText>[0])
        });
      }
      return { status: { id: c.id, ok: true, tools: Object.keys(made).length } as ConnectorStatus, made };
    } catch (e) {
      await client.close().catch(() => {});
      const { reason, signIn } = refusal(e, c.auth);
      return { status: { id: c.id, ok: false, tools: 0, reason, ...(signIn ? { signIn } : {}) } as ConnectorStatus, made: {} as ToolSet };
    }
  }));
  for (const r of results) { status.push(r.status); Object.assign(tools, r.made); }
  let closed = false;
  return { tools, status, close: async () => { if (closed) return; closed = true; await Promise.all(clients.map((c) => c.close().catch(() => {}))); } };
}
