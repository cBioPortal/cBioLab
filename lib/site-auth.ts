// Site-wide password gate. One shared password, one shared artifact store —
// there are no per-user accounts; the gate only decides whether a request may
// reach the app at all. proxy.ts calls decide() on every request; /api/login
// issues the cookie.
//
// Configuration (all server-side env vars):
//   SITE_PASSWORD   the password. Unset → the gate is off (local dev, the e2e
//                   gate, the tailnet servers), except on a Vercel deployment,
//                   where a missing password fails closed with a 503.
//   AUTH_SECRET     HMAC key for the session cookie; required with SITE_PASSWORD.
//                   Changing it, or SITE_PASSWORD, signs everyone out.
//   SITE_API_TOKEN  optional bearer token for non-browser clients (the Python
//                   client, scripts). Accepted on /api/*. When set, it is also
//                   *required* on /api/mcp; when unset, /api/mcp stays open so
//                   MCP connectors that cannot log in keep working.
//
// Web Crypto only, no node: imports, so this runs unchanged in the proxy and
// under node --test.

export const SESSION_COOKIE = "cl_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

export interface AuthEnv {
  [name: string]: string | undefined;
  SITE_PASSWORD?: string;
  AUTH_SECRET?: string;
  SITE_API_TOKEN?: string;
  VERCEL_ENV?: string;
}

export type Decision =
  | { action: "allow" }
  | { action: "login" }          // page request without a session → redirect to /login
  | { action: "unauthorized" }   // API request without a session or token → 401
  | { action: "misconfigured" }; // deployed without a password → 503

/** Paths reachable without a session: the login flow itself. */
export function isPublicPath(path: string): boolean {
  return path === "/login" || path === "/api/login" || path === "/api/logout";
}

export function gateEnabled(env: AuthEnv): boolean {
  return !!env.SITE_PASSWORD;
}

const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  let hex = "";
  for (const b of sig) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Length-independent constant-time string comparison (compares HMACs of both sides). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac("cmp", a), hmac("cmp", b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// The signing key folds in the password, so rotating the password revokes
// every outstanding session without a separate step.
function signingKey(env: AuthEnv): string {
  return (env.AUTH_SECRET || "") + "\0" + (env.SITE_PASSWORD || "");
}

/** Cookie value: "v1.<expiry epoch seconds>.<hmac>". */
export async function signSession(env: AuthEnv, nowSeconds: number): Promise<string> {
  const exp = String(Math.floor(nowSeconds) + SESSION_TTL_SECONDS);
  return "v1." + exp + "." + (await hmac(signingKey(env), "v1." + exp));
}

export async function verifySession(env: AuthEnv, token: string | undefined, nowSeconds: number): Promise<boolean> {
  if (!token || !env.AUTH_SECRET) return false;
  const m = /^v1\.(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  if (Number(m[1]) <= nowSeconds) return false;
  return safeEqual(m[2], await hmac(signingKey(env), "v1." + m[1]));
}

export async function checkPassword(env: AuthEnv, attempt: unknown): Promise<boolean> {
  if (!env.SITE_PASSWORD || !env.AUTH_SECRET || typeof attempt !== "string") return false;
  return safeEqual(attempt, env.SITE_PASSWORD);
}

async function bearerOk(env: AuthEnv, authorization: string | null | undefined): Promise<boolean> {
  if (!env.SITE_API_TOKEN || !authorization) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return !!m && safeEqual(m[1], env.SITE_API_TOKEN);
}

/**
 * Only same-site relative paths are honoured as a post-login destination —
 * never "//host" or an absolute URL, which would make /login an open redirect.
 */
export function safeNext(next: unknown): string {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

export async function decide(
  env: AuthEnv,
  req: { path: string; cookie?: string; authorization?: string | null },
  nowSeconds: number
): Promise<Decision> {
  if (!gateEnabled(env)) return { action: env.VERCEL_ENV ? "misconfigured" : "allow" };
  if (!env.AUTH_SECRET) return { action: "misconfigured" };
  if (isPublicPath(req.path)) return { action: "allow" };

  const isApi = req.path === "/api" || req.path.startsWith("/api/");
  if (req.path === "/api/mcp" || req.path.startsWith("/api/mcp/")) {
    if (!env.SITE_API_TOKEN) return { action: "allow" };
    return (await bearerOk(env, req.authorization)) ? { action: "allow" } : { action: "unauthorized" };
  }
  if (await verifySession(env, req.cookie, nowSeconds)) return { action: "allow" };
  if (isApi && (await bearerOk(env, req.authorization))) return { action: "allow" };
  return { action: isApi ? "unauthorized" : "login" };
}
