// Who is asking: the login behind everything a reader stores — custom data
// (lib/custom-store.ts) and saved cohorts and analyses (lib/artifacts.ts).
//
// Today there is one principal, "shared", and one shared login: the deployment's password,
// LOGIN_PASSWORD. Stored things exist only where it is set; logging in (the page's top-right
// button) sets an httpOnly cookie carrying a hash of it. Exploring, running analyses, the
// examples, shared ?doc= links and MCP need no login.
//
// This is the seam per-user access replaces: principalFor() becomes "the signed-in user", and
// both stores already decide by owner (and, for custom data, grant).
import { createHash, timingSafeEqual } from "node:crypto";

export const SHARED_PRINCIPAL = "shared";
export const ACCESS_COOKIE = "cl_login";
const COOKIE_DAYS = 30;

export class AccessError extends Error {
  readonly status: 403 | 404 | 410;
  constructor(message: string, status: 403 | 404 | 410) { super(message); this.status = status; }
}

export function loginEnabled(): boolean {
  return !!process.env.LOGIN_PASSWORD;
}

const tokenOf = (code: string) => createHash("sha256").update("cohort-lab custom data\n" + code).digest("hex");

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieValue(req: Request): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === ACCESS_COOKIE) return v.join("=");
  }
  return null;
}

/** The principal behind a request, or null when it has not been unlocked here. */
export function principalFor(req: Request): string | null {
  const code = process.env.LOGIN_PASSWORD;
  if (!code) return null;
  const v = cookieValue(req);
  return v && same(v, tokenOf(code)) ? SHARED_PRINCIPAL : null;
}

export function requirePrincipal(req: Request): string {
  if (!loginEnabled())
    throw new AccessError("this deployment has no login (LOGIN_PASSWORD is not set), so nothing can be saved on it", 404);
  const p = principalFor(req);
  if (!p) throw new AccessError("log in to use saved cohorts, analyses and custom data", 403);
  return p;
}

/** The Set-Cookie header for a correct code, or null for a wrong one. */
export function unlockCookie(code: unknown, secure: boolean): string | null {
  const want = process.env.LOGIN_PASSWORD;
  if (!want || typeof code !== "string" || !same(tokenOf(code), tokenOf(want))) return null;
  return ACCESS_COOKIE + "=" + tokenOf(want) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + COOKIE_DAYS * 86400 + (secure ? "; Secure" : "");
}

export function lockCookie(): string {
  return ACCESS_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
