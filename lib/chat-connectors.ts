// External MCP servers the chat sidebar can use ("connectors", issue #128): the registry, and how a
// connector's tools are named and described to the model. Pure and browser-safe.
//
// A connector is a remote server the READER switches on (off by default). It reaches only what the
// model puts in a call the reader approves — never the app's data, the engine or the page. The
// browser names connectors by id; the URL always comes from this registry, never from a request.

export interface Connector {
  id: string;
  name: string;
  /** the server's MCP endpoint, https only */
  url: string;
  /**
   * "oauth": the reader signs in to the server (lib/chat-connector-oauth.ts);
   * "token": the reader pastes an API token, which goes in the header named by `tokenHeader`;
   * "none": the server is open
   */
  auth: "none" | "oauth" | "token";
  /** with auth "token": the header the server reads the token from (a bearer token is `Authorization`) */
  tokenHeader?: string;
  /** what it is for, in a line — shown to the reader and told to the model */
  what: string;
  /** takes free text from the model (a question), so a patient fact can leave in it */
  sendsFreeText: boolean;
  /** only these of the server's tools are offered; absent means all, up to MAX_TOOLS */
  tools?: string[];
}
/** what the browser may know of a connector: no more than it needs to show and to name it */
export type PublicConnector = Pick<Connector, "id" | "name" | "auth" | "what" | "sendsFreeText"> & { host: string };

/** the header and value that carry a reader's token to a connector */
export const tokenHeader = (c: Pick<Connector, "auth" | "tokenHeader">, token: string): Record<string, string> =>
  c.auth === "oauth" || (c.auth === "token" && (c.tokenHeader ?? "Authorization").toLowerCase() === "authorization")
    ? { Authorization: "Bearer " + token } : c.auth === "token" ? { [c.tokenHeader!]: token } : {};

export const MAX_TOOLS = 40;

export const DEFAULT_CONNECTORS: Connector[] = [
  { id: "openevidence", name: "OpenEvidence", url: "https://oe-playground-723124486874.us-central1.run.app/mcp", auth: "token", tokenHeader: "x-api-token", sendsFreeText: true,
    what: "clinical questions answered with citations from peer-reviewed literature (PubMed, FDA, CDC)" },
  { id: "cbioportal", name: "cBioPortal MCP", url: "https://mcp.cbioportal.org/db/mcp", auth: "oauth", sendsFreeText: false,
    what: "cBioPortal's public data: its ClickHouse tables, study guides and OncoTree search" }
];

const ID = /^[a-z0-9-]{1,24}$/;

/**
 * The deployment's connectors: the defaults, or what CHAT_CONNECTORS (a JSON array) says. A
 * malformed entry is an error naming it — never skipped, so a typo does not quietly remove one.
 */
export function parseConnectors(raw: string | undefined): Connector[] {
  if (!raw?.trim()) return DEFAULT_CONNECTORS;
  let list: unknown;
  try { list = JSON.parse(raw); } catch (e) { throw new Error("CHAT_CONNECTORS is not JSON: " + (e as Error).message, { cause: e }); }
  if (!Array.isArray(list)) throw new Error("CHAT_CONNECTORS must be a JSON array of connectors");
  const seen = new Set<string>();
  return list.map((x, i) => {
    const c = x as Partial<Connector> | null;
    const at = `CHAT_CONNECTORS[${i}]${c && typeof c.id === "string" ? " (" + c.id + ")" : ""}`;
    if (!c || typeof c !== "object") throw new Error(at + " is not an object");
    if (typeof c.id !== "string" || !ID.test(c.id)) throw new Error(at + ": id is 1–24 lowercase letters, digits or -");
    if (seen.has(c.id)) throw new Error(at + ": id is used twice");
    seen.add(c.id);
    if (typeof c.name !== "string" || !c.name.trim()) throw new Error(at + ": name is required");
    if (typeof c.what !== "string" || !c.what.trim()) throw new Error(at + ": what is required (a line saying what it is for)");
    let url: URL;
    try { url = new URL(String(c.url)); } catch { throw new Error(at + ": url is not a URL"); }
    if (url.protocol !== "https:") throw new Error(at + ": url must be https");
    if (c.auth !== "none" && c.auth !== "oauth" && c.auth !== "token") throw new Error(at + ': auth is "none", "oauth" or "token"');
    if (c.auth === "token" && !(typeof c.tokenHeader === "string" && /^[A-Za-z0-9-]{1,64}$/.test(c.tokenHeader))) throw new Error(at + ": a token connector names the header its token goes in (tokenHeader)");
    if (typeof c.sendsFreeText !== "boolean") throw new Error(at + ": sendsFreeText is true or false");
    if (c.tools !== undefined && (!Array.isArray(c.tools) || c.tools.some((t) => typeof t !== "string"))) throw new Error(at + ": tools is a list of tool names");
    return { id: c.id, name: c.name.trim(), url: url.toString(), auth: c.auth, what: c.what.trim(), sendsFreeText: c.sendsFreeText, ...(c.auth === "token" ? { tokenHeader: c.tokenHeader } : {}), ...(c.tools ? { tools: c.tools } : {}) };
  });
}

export const publicConnector = (c: Connector): PublicConnector =>
  ({ id: c.id, name: c.name, auth: c.auth, what: c.what, sendsFreeText: c.sendsFreeText, host: new URL(c.url).host });

const SEP = "__";
/** a connector tool's name as the model sees it, which cannot shadow a page tool */
export const toolName = (id: string, tool: string): string => id + SEP + tool;
/** the connector and tool a model's tool name stands for, or null for a page tool */
export function fromToolName(name: string): { id: string; tool: string } | null {
  const i = name.indexOf(SEP);
  return i > 0 ? { id: name.slice(0, i), tool: name.slice(i + SEP.length) } : null;
}
/** a name the model API accepts (1–64 of letters, digits, _ -) */
export const validToolName = (name: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(name);

export interface ConnectorStatus { id: string; ok: boolean; tools: number; reason?: string; signIn?: boolean }

/** The paragraph of the model's instructions about the connectors that are on, and those that could not be reached. */
export function connectorInstructions(on: Connector[], status: ConnectorStatus[]): string {
  if (!on.length) return "";
  const live = on.filter((c) => status.find((s) => s.id === c.id)?.ok);
  const down = status.filter((s) => !s.ok);
  return [
    "",
    "The researcher has switched on external connectors: remote servers outside this app. " + (live.length ? "Their tools are named <connector>__<tool>: " +
      live.map((c) => `${c.id} (${c.name}: ${c.what})`).join("; ") + "." : "None of them could be reached this turn."),
    "Every call to one is shown to the researcher, who approves or denies it first. What you put in a call leaves this app for a third party: never include a patient or sample identifier, a name, a date of birth, or any detail that could identify one person, and ask a general question instead. If a call is denied, do not repeat it with the same arguments; say what you could not do and why.",
    ...(down.length ? ["Not available this turn: " + down.map((s) => `${on.find((c) => c.id === s.id)?.name ?? s.id} (${s.reason})`).join("; ") + ". Tell the researcher if they asked for it."] : [])
  ].join("\n");
}
