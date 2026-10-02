// Who is asking, for server-stored custom data (lib/custom-store.ts).
//
// Today there is one principal, "shared", and a deployment's access code stands in for signing
// in: server-stored custom data is enabled only where CUSTOM_DATA_ACCESS_CODE is set, and a
// browser holds it once entered, as an httpOnly cookie carrying a hash of the code. Everything
// else on the site, including the public demo and MCP, is unaffected.
//
// This is the seam per-user access replaces: principalFor() becomes "the signed-in user", and
// lib/custom-store.ts's canRead/canWrite already decide by owner and grant.
import { createHash, timingSafeEqual } from "node:crypto";

export const SHARED_PRINCIPAL = "shared";
export const ACCESS_COOKIE = "cl_custom_access";
const COOKIE_DAYS = 30;

export class AccessError extends Error {
  readonly status: 403 | 404 | 410;
  constructor(message: string, status: 403 | 404 | 410) { super(message); this.status = status; }
}

export function serverDataEnabled(): boolean {
  return !!process.env.CUSTOM_DATA_ACCESS_CODE;
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
  const code = process.env.CUSTOM_DATA_ACCESS_CODE;
  if (!code) return null;
  const v = cookieValue(req);
  return v && same(v, tokenOf(code)) ? SHARED_PRINCIPAL : null;
}

export function requirePrincipal(req: Request): string {
  if (!serverDataEnabled())
    throw new AccessError("server-stored custom data is not enabled on this deployment (CUSTOM_DATA_ACCESS_CODE is not set)", 404);
  const p = principalFor(req);
  if (!p) throw new AccessError("server-stored custom data is locked: enter this deployment's access code", 403);
  return p;
}

/** The Set-Cookie header for a correct code, or null for a wrong one. */
export function unlockCookie(code: unknown, secure: boolean): string | null {
  const want = process.env.CUSTOM_DATA_ACCESS_CODE;
  if (!want || typeof code !== "string" || !same(tokenOf(code), tokenOf(want))) return null;
  return ACCESS_COOKIE + "=" + tokenOf(want) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + COOKIE_DAYS * 86400 + (secure ? "; Secure" : "");
}

export function lockCookie(): string {
  return ACCESS_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
