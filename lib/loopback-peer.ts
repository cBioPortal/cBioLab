// A simulated peer: one of this app's own database connections served to itself over MCP, so
// document-level federation can be run and tested without standing up a second instance.
//
// LOOPBACK_PEER=<connection id> (e.g. "b", the CLICKHOUSE2_* database) makes every study on that
// connection a peer-held study: the analysis side reaches it through RemoteAggregateResolver /
// RemotePatientResolver at this app's own /api/mcp, exactly as it would a peer at another address,
// and the MCP side answers those calls from that connection — and from no other. The patient-level
// rules apply as for any peer: MCP_DISCLOSE_PATIENTS (what the simulated peer sends) and
// PEER_MCP_PATIENT_LEVEL (what this app accepts).
//
// The two sides are told apart per request. A call this app makes to itself carries LOOPBACK_HEADER
// with a token only this app knows; the MCP route runs such a call as the peer (`asLoopbackPeer`),
// where nothing is routed to the simulated peer again — so it is answered from its database, and a
// loopback call can never make another. The token is LOOPBACK_PEER_TOKEN where several processes
// serve the app (Vercel: the call back lands on another function instance), else one generated per
// process. With LOOPBACK_PEER_URL naming the deployment's own /api/mcp, that is all a deployment
// needs to federate over MCP without a second instance.
//
// What it does not simulate: two processes with their own settings or credentials, or a peer on
// another build. The study list reads the connection directly.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, timingSafeEqual } from "node:crypto";

export const LOOPBACK_HEADER = "x-cbio-loopback-peer";

/** the connection served as a simulated peer, or null when there is none */
export const loopbackConnId = (): string | null => (process.env.LOOPBACK_PEER || "").trim() || null;

// one token and one context per process: Next may load this module once per route bundle
const g = globalThis as unknown as { __cbioLoopback?: { token: string; als: AsyncLocalStorage<true> } };
const state = g.__cbioLoopback ??= { token: randomUUID(), als: new AsyncLocalStorage<true>() };

/** Whether this request is the simulated peer answering a call this app made to itself. */
export const servingAsLoopbackPeer = (): boolean => state.als.getStore() === true;

/** Run `fn` as the simulated peer. */
export const asLoopbackPeer = <T>(fn: () => T): T => state.als.run(true, fn);

/** Whether `req` is a call this process made to itself — the only kind run as the peer. */
/** The token: LOOPBACK_PEER_TOKEN, shared by every process of the deployment, else this process's own. */
function token(): string {
  const shared = (process.env.LOOPBACK_PEER_TOKEN || "").trim();
  if (!shared) return state.token;
  if (shared.length < 32) throw new Error("LOOPBACK_PEER_TOKEN must be at least 32 characters: it is what tells this app's own calls from anyone else's");
  return shared;
}

export const isLoopbackRequest = (req: Request): boolean => {
  if (!loopbackConnId()) return false;
  const got = req.headers.get(LOOPBACK_HEADER), want = token();
  return !!got && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
};

/** This app's own MCP endpoint: LOOPBACK_PEER_URL, else 127.0.0.1 on PORT. */
export function loopbackUrl(): string {
  if (process.env.LOOPBACK_PEER_URL) return process.env.LOOPBACK_PEER_URL;
  if (!process.env.PORT) throw new Error("LOOPBACK_PEER needs this app's own MCP address: set PORT (the port it listens on) or LOOPBACK_PEER_URL");
  return "http://127.0.0.1:" + process.env.PORT + "/api/mcp";
}

/** The header a call to `url` carries: the token, when `url` is this app's own endpoint. */
export function loopbackHeaders(url: string): Record<string, string> {
  if (!loopbackConnId() || url !== loopbackUrl()) return {};
  if (servingAsLoopbackPeer()) throw new Error("the simulated peer cannot call itself: a loopback call never makes another");
  return { [LOOPBACK_HEADER]: token() };
}
