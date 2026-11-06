// What the browser remembers about connectors (issue #128): which the reader has switched on, and the
// token each one's sign-in gave. Kept in localStorage; nothing is stored on the server. Pure — the
// storage is passed in — so it runs under test. The OAuth callback page (lib/chat-connector-oauth.ts)
// writes the same shape.
import type { Connector } from "./chat-connectors.ts";

/** where a reader's sign-in to a connector starts (app/api/chat/connectors/oauth/start) */
export const CONNECT_PATH = "/api/chat/connectors/oauth/start";
export const connectUrl = (id: string, returnTo: string): string => CONNECT_PATH + "?id=" + encodeURIComponent(id) + "&returnTo=" + encodeURIComponent(returnTo);
export const CONNECTORS_KEY = "cohortlab.chat.connectors";
/** a message the sign-in left for the sidebar to show once (sessionStorage) */
export const CONNECTOR_NOTE_KEY = "cohortlab.chat.connectors.note";

export interface ConnectorToken { token: string; /** epoch ms; absent when the server gave none */ expiresAt?: number }
export interface ConnectorState { on: string[]; tokens: Record<string, ConnectorToken> }
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

const EMPTY = (): ConnectorState => ({ on: [], tokens: {} });

/** The stored state; nothing on, nobody signed in, when there is none or it cannot be read. */
export function loadState(store: Store | null): ConnectorState {
  try {
    const v = JSON.parse(store?.getItem(CONNECTORS_KEY) || "null");
    if (!v || typeof v !== "object") return EMPTY();
    const tokens: Record<string, ConnectorToken> = {};
    for (const [id, t] of Object.entries((v.tokens || {}) as Record<string, ConnectorToken>))
      if (t && typeof t.token === "string" && t.token) tokens[id] = { token: t.token, ...(typeof t.expiresAt === "number" ? { expiresAt: t.expiresAt } : {}) };
    return { on: Array.isArray(v.on) ? v.on.filter((x: unknown): x is string => typeof x === "string") : [], tokens };
  } catch { return EMPTY(); }
}
/** false when the store is full or blocked */
export function saveState(store: Store | null, s: ConnectorState): boolean {
  try { if (!store) return false; store.setItem(CONNECTORS_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export const signedIn = (s: ConnectorState, id: string, now: number): boolean => {
  const t = s.tokens[id];
  return !!t && !(t.expiresAt !== undefined && t.expiresAt <= now);
};
/** Whether a connector may be on: one that needs a sign-in or a token needs one that has not run out. */
export function canSwitchOn(s: ConnectorState, c: Pick<Connector, "id" | "auth">, now: number): { ok: true } | { ok: false; why: string } {
  if (c.auth === "none" || signedIn(s, c.id, now)) return { ok: true };
  return { ok: false, why: c.auth === "token" ? "add your API token first" : s.tokens[c.id] ? "the sign-in has expired: connect again" : "connect (sign in) first" };
}
export function withOn(s: ConnectorState, id: string, on: boolean): ConnectorState {
  return { ...s, on: on ? [...new Set([...s.on, id])] : s.on.filter((x) => x !== id) };
}
export function withToken(s: ConnectorState, id: string, t: ConnectorToken | null): ConnectorState {
  const tokens = { ...s.tokens };
  if (t) tokens[id] = t; else delete tokens[id];
  return { on: t ? s.on : s.on.filter((x) => x !== id), tokens };
}
/**
 * What a chat request names: each connector that is on AND may be (an OAuth or token one has a good
 * credential), with its token. One stored as on that has lost its credential is left out, as the panel
 * shows it off, so the model is not told about a connector that cannot answer.
 */
export function requestEntries(s: ConnectorState, known: Pick<Connector, "id" | "auth">[], now: number): { id: string; token?: string }[] {
  return known.filter((c) => s.on.includes(c.id) && canSwitchOn(s, c, now).ok).map((c) => ({ id: c.id, ...(signedIn(s, c.id, now) ? { token: s.tokens[c.id].token } : {}) }));
}
