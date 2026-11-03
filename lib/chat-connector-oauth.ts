// Signing a reader in to a connector that needs it (issue #128): the standard MCP OAuth flow —
// discovery, dynamic client registration, authorization code with PKCE — run by the SDK's own
// `auth()`, with NOTHING kept on the server. What the flow needs between its two requests (the PKCE
// verifier, the registered client, the state) rides in a short-lived httpOnly cookie; the token the
// server gives goes to the reader's browser (localStorage) on the callback page, and the server
// forgets it. Server only.
//
// The app registers itself with the server (dynamic client registration) on every sign-in, as the
// server advertises it accepts: a public client where the server allows one, otherwise a client
// with the secret the server hands back, which lives only in that cookie, for the ten minutes the
// sign-in may take.
import { auth, discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomBytes } from "node:crypto";
import { CONNECTORS_KEY, CONNECTOR_NOTE_KEY, CONNECT_PATH, type ConnectorToken } from "./chat-connector-state.ts";
import type { Connector } from "./chat-connectors.ts";

export const OAUTH_COOKIE = "cbiolab_connector_oauth";
export const START_PATH = CONNECT_PATH;
export const CALLBACK_PATH = "/api/chat/connectors/oauth/callback";
const COOKIE_PATH = "/api/chat/connectors/oauth";
/** a sign-in must be finished within this, or its cookie is gone */
export const FLOW_SECONDS = 600;

/** How this app registers itself with a server, from what the server says it supports. */
export interface Registration { grants: string[]; method: "none" | "client_secret_post" | "client_secret_basic" }
const GRANTS = ["authorization_code", "refresh_token"];
export function registrationFor(meta: { grant_types_supported?: string[]; token_endpoint_auth_methods_supported?: string[] } | undefined): Registration {
  const grants = meta?.grant_types_supported?.length ? GRANTS.filter((g) => meta.grant_types_supported!.includes(g)) : ["authorization_code"];
  const m = meta?.token_endpoint_auth_methods_supported;
  const method = !m?.length || m.includes("none") ? "none" : m.includes("client_secret_post") ? "client_secret_post" : "client_secret_basic";
  return { grants: grants.length ? grants : ["authorization_code"], method };
}
/** Ask the server what it supports: its protected-resource metadata names its authorization server, else the server itself is one. */
async function discoverRegistration(serverUrl: string): Promise<Registration> {
  let issuer: string | URL = new URL(serverUrl).origin;
  try { issuer = (await discoverOAuthProtectedResourceMetadata(serverUrl)).authorization_servers?.[0] ?? issuer; } catch { /* the server is its own authorization server */ }
  return registrationFor(await discoverAuthorizationServerMetadata(issuer).catch(() => undefined));
}

/** What a sign-in carries from its first request to its second. */
export interface Flow { id: string; state: string; verifier?: string; client?: OAuthClientInformationMixed; returnTo: string }

/** where to go back to: a path on this site, never another site */
export function safeReturnTo(x: string | null | undefined): string {
  return x && x.startsWith("/") && !x.startsWith("//") && !x.includes("\\") && !/[\r\n]/.test(x) ? x : "/";
}

/** this app's address as the reader's browser sees it, behind a proxy too */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = (req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "")).split(",")[0].trim();
  return proto + "://" + host;
}

class FlowProvider implements OAuthClientProvider {
  tokensGiven: OAuthTokens | undefined;
  authUrl: string | undefined;
  origin: string;
  flow: Flow;
  how: Registration;
  constructor(origin: string, flow: Flow, how: Registration) { this.origin = origin; this.flow = flow; this.how = how; }
  get redirectUrl() { return this.origin + CALLBACK_PATH; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "cbio-lab", redirect_uris: [this.redirectUrl], grant_types: this.how.grants, response_types: ["code"], token_endpoint_auth_method: this.how.method };
  }
  state() { return this.flow.state; }
  clientInformation() { return this.flow.client; }
  saveClientInformation(c: OAuthClientInformationMixed) { this.flow.client = c; }
  tokens() { return undefined; }   // never reuses one: every sign-in is a fresh one
  saveTokens(t: OAuthTokens) { this.tokensGiven = t; }
  redirectToAuthorization(u: URL) { this.authUrl = u.toString(); }
  saveCodeVerifier(v: string) { this.flow.verifier = v; }
  codeVerifier() { if (!this.flow.verifier) throw new Error("this sign-in has no code verifier"); return this.flow.verifier; }
}

/** First request: where to send the reader to sign in, and the flow to remember until they return. */
export async function begin(c: Connector, origin: string, returnTo: string): Promise<{ authUrl: string; flow: Flow }> {
  const flow: Flow = { id: c.id, state: randomBytes(16).toString("base64url"), returnTo: safeReturnTo(returnTo) };
  const p = new FlowProvider(origin, flow, await discoverRegistration(c.url));
  const r = await auth(p, { serverUrl: c.url });
  if (r !== "REDIRECT" || !p.authUrl) throw new Error(`${c.name} did not ask for a sign-in`);
  return { authUrl: p.authUrl, flow: p.flow };
}

/** Second request: trade the code for a token. */
export async function finish(c: Connector, origin: string, flow: Flow, code: string): Promise<ConnectorToken> {
  const p = new FlowProvider(origin, flow, registrationFor(undefined));   // registration is over: only the code is traded
  const r = await auth(p, { serverUrl: c.url, authorizationCode: code });
  if (r !== "AUTHORIZED" || !p.tokensGiven?.access_token) throw new Error(`${c.name} gave no token`);
  const t = p.tokensGiven;
  return { token: t.access_token, ...(typeof t.expires_in === "number" ? { expiresAt: Date.now() + t.expires_in * 1000 } : {}) };
}

const b64 = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
export function flowCookie(flow: Flow, secure: boolean): string {
  return `${OAUTH_COOKIE}=${b64(flow)}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${FLOW_SECONDS}${secure ? "; Secure" : ""}`;
}
export const clearedCookie = (secure: boolean): string => `${OAUTH_COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
export function readFlow(cookieHeader: string | null): Flow | null {
  const m = cookieHeader?.split(/;\s*/).find((x) => x.startsWith(OAUTH_COOKIE + "="));
  if (!m) return null;
  try {
    const f = JSON.parse(Buffer.from(m.slice(OAUTH_COOKIE.length + 1), "base64url").toString());
    return f && typeof f.id === "string" && typeof f.state === "string" && typeof f.returnTo === "string" ? { ...f, returnTo: safeReturnTo(f.returnTo) } : null;
  } catch { return null; }
}

/** a value as JavaScript inside a <script>, which cannot end the script early */
const js = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\u2028").replace(new RegExp("\\u2029", "g"), "\\u2029");
const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Connecting</title></head><body style="font:16px system-ui;margin:2rem">${body}</body></html>`;

/**
 * The callback's answer: it writes the token into this browser's connector state and returns to the
 * page the reader came from, with a note for the sidebar to show once. The server keeps nothing.
 */
export function doneHtml(c: Pick<Connector, "id" | "name">, t: ConnectorToken, returnTo: string): string {
  const code = `try{var k=${js(CONNECTORS_KEY)},s=JSON.parse(localStorage.getItem(k)||"null")||{};s.on=s.on||[];s.tokens=s.tokens||{};s.tokens[${js(c.id)}]=${js(t)};localStorage.setItem(k,JSON.stringify(s));` +
    `try{sessionStorage.setItem(${js(CONNECTOR_NOTE_KEY)},${js("Connected to " + c.name + ". Switch it on in the Connectors menu to use it.")})}catch(e){}` +
    `location.replace(${js(safeReturnTo(returnTo))})}catch(e){document.getElementById("m").textContent="Signed in, but this browser would not keep the sign-in (its storage is blocked or full), so it cannot be used."}`;
  return page(`<p id="m">Connected to ${c.name.replace(/[<>&"]/g, "")}. Returning…</p><script>${code}</script><noscript><p>This page needs JavaScript to finish connecting.</p></noscript>`);
}
/** The callback's answer when the sign-in did not complete: back to the page, with the reason as a note. */
export function failedHtml(message: string, returnTo: string): string {
  const code = `try{sessionStorage.setItem(${js(CONNECTOR_NOTE_KEY)},${js(message)})}catch(e){}location.replace(${js(safeReturnTo(returnTo))})`;
  return page(`<p>${message.replace(/[<>&"]/g, "")}</p><script>${code}</script>`);
}
