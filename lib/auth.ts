// Who is asking: the signed-in user behind everything a reader stores — custom data
// (lib/custom-store.ts), saved cohorts and analyses (lib/artifacts.ts) and campaign changes.
// Exploring, running analyses, the examples, shared ?doc= links and MCP need no sign-in.
//
// A deployment signs people in through ONE of:
//   - an OpenID Connect provider (lib/oidc.ts): AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID and
//     AUTH_OIDC_CLIENT_SECRET — Google on Vercel, MSK's Keycloak on the private cluster;
//   - the development sign-in, AUTH_DEV_LOGIN=1: any email, no password, for local work and the
//     e2e gate. Refused on Vercel production whatever the setting.
// Either way the result is a session: an httpOnly cookie carrying the user's id, email and name,
// signed with AUTH_SESSION_SECRET (HMAC-SHA256). Requests are decided from the cookie alone, so a
// disabled user keeps their session until it expires (SESSION_DAYS); signing in again is refused.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "cl_session";
const SESSION_DAYS = 14;

export class AccessError extends Error {
  readonly status: 403 | 404 | 409 | 410;
  constructor(message: string, status: 403 | 404 | 409 | 410) { super(message); this.status = status; }
}

export interface SessionUser { id: string; email: string; name: string | null }

export const oidcConfigured = (): boolean =>
  !!(process.env.AUTH_OIDC_ISSUER && process.env.AUTH_OIDC_CLIENT_ID && process.env.AUTH_OIDC_CLIENT_SECRET);

export const devLoginAllowed = (): boolean =>
  process.env.AUTH_DEV_LOGIN === "1" && process.env.VERCEL_ENV !== "production";

export function loginEnabled(): boolean {
  return oidcConfigured() || devLoginAllowed();
}

/** What the sign-in button offers: the provider's name ("Google", "MSK"), and the development sign-in. */
export function loginOptions(): { oidc: string | null; dev: boolean } {
  const issuer = process.env.AUTH_OIDC_ISSUER || "";
  const label = process.env.AUTH_OIDC_LABEL || (/accounts\.google\.com/.test(issuer) ? "Google" : "single sign-on");
  return { oidc: oidcConfigured() ? label : null, dev: devLoginAllowed() };
}

// A development sign-in without a configured secret gets one per process: its sessions end on a
// restart, which is all local work needs. A provider sign-in must have a real one.
let processSecret: string | null = null;
function secret(): string {
  const s = process.env.AUTH_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (s) throw new Error("AUTH_SESSION_SECRET must be at least 32 characters");
  if (oidcConfigured()) throw new Error("AUTH_SESSION_SECRET is not set; it is required with AUTH_OIDC_ISSUER");
  return processSecret ??= randomBytes(32).toString("hex");
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret()).update("cohort-lab session\n" + body).digest("base64url");

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
export { cookieValue as readCookie };

const secure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

/** The Set-Cookie header that signs this user in. */
export function sessionCookie(req: Request, u: SessionUser): string {
  const body = b64(JSON.stringify({ u: u.id, e: u.email, n: u.name, x: Date.now() + SESSION_DAYS * 86400_000 }));
  return SESSION_COOKIE + "=" + body + "." + sign(body) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86400 + (secure(req) ? "; Secure" : "");
}

export function signOutCookie(): string {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

/** The signed-in user behind a request, or null. */
export function userFor(req: Request): SessionUser | null {
  if (!loginEnabled()) return null;
  const v = cookieValue(req, SESSION_COOKIE);
  const dot = v ? v.lastIndexOf(".") : -1;
  if (!v || dot < 1) return null;
  const body = v.slice(0, dot), mac = Buffer.from(v.slice(dot + 1)), want = Buffer.from(sign(body));
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.u !== "string" || typeof p.x !== "number" || p.x < Date.now()) return null;
    return { id: p.u, email: String(p.e || ""), name: p.n ?? null };
  } catch { return null; }
}

/** The id stores decide by, or null when nobody is signed in. */
export function principalFor(req: Request): string | null {
  return userFor(req)?.id ?? null;
}

export function requirePrincipal(req: Request, what = "use saved cohorts, analyses and custom data"): string {
  if (!loginEnabled())
    throw new AccessError("this deployment has no sign-in, so it cannot " + what, 404);
  const p = principalFor(req);
  if (!p) throw new AccessError("sign in to " + what, 403);
  return p;
}
