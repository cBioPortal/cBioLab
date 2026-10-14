// Signing in through the deployment's OpenID Connect provider (AUTH_OIDC_*; see lib/auth.ts): the
// authorization-code flow with PKCE, a nonce and a state, via openid-client. Nothing here is
// provider-specific — Google and MSK's Keycloak differ only in their settings.
//
//   GET /api/auth/login?next=/lab  →  start(): remember the flow in a short-lived cookie, redirect
//   GET /api/auth/callback         →  finish(): check it, exchange the code, verify the ID token,
//                                     find or create the user (lib/users.ts), start a session
//
// The redirect URI is AUTH_URL + /api/auth/callback when AUTH_URL is set (it must be, behind a
// proxy that rewrites the host), else the request's own origin. It must be registered with the
// provider exactly.
import * as client from "openid-client";
import { AccessError, readCookie, sessionCookie } from "./auth.ts";
import { signIn } from "./users.ts";

const FLOW_COOKIE = "cl_oidc";

let config: Promise<client.Configuration> | null = null;
function provider(): Promise<client.Configuration> {
  return config ??= (async () => {
    const issuer = new URL(process.env.AUTH_OIDC_ISSUER!);
    // plain http only for a provider on this machine (the tests' stand-in)
    const local = issuer.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(issuer.hostname);
    return client.discovery(issuer, process.env.AUTH_OIDC_CLIENT_ID!, process.env.AUTH_OIDC_CLIENT_SECRET!, undefined,
      local ? { execute: [client.allowInsecureRequests] } : undefined);
  })().catch((e) => { config = null; throw e; });   // the next sign-in tries again
}

function origin(req: Request): string {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/+$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return proto + "://" + host;
}
const redirectUri = (req: Request) => origin(req) + "/api/auth/callback";

/** Only a path on this site: never send someone to another origin after signing in. */
export const safeNext = (n: unknown): string =>
  typeof n === "string" && /^\/(?![/\\])/.test(n) ? n : "/lab";

const secure = (req: Request) => origin(req).startsWith("https:");

export async function start(req: Request): Promise<Response> {
  const cfg = await provider();
  const verifier = client.randomPKCECodeVerifier(), state = client.randomState(), nonce = client.randomNonce();
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: redirectUri(req), scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce,
  });
  const flow = Buffer.from(JSON.stringify({ verifier, state, nonce, next })).toString("base64url");
  return new Response(null, { status: 302, headers: {
    Location: url.href,
    "Set-Cookie": FLOW_COOKIE + "=" + flow + "; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600" + (secure(req) ? "; Secure" : ""),
  } });
}

export async function finish(req: Request): Promise<Response> {
  const raw = readCookie(req, FLOW_COOKIE);
  if (!raw) throw new AccessError("the sign-in took too long or started in another browser; please sign in again", 403);
  const flow = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { verifier: string; state: string; nonce: string; next: string };
  const cfg = await provider();
  // the provider redirected to the registered URI; check the response against that, not the
  // address the request reached this server by (which a proxy may have rewritten)
  const current = new URL(redirectUri(req));
  current.search = new URL(req.url).search;
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(cfg, current, {
      pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
    });
  } catch (e) {
    // openid-client's own message is generic; the check that failed is in its cause
    const why = (e as { cause?: { message?: string } })?.cause?.message || (e as Error)?.message || String(e);
    throw new AccessError("the sign-in could not be completed (" + why + "); please sign in again", 403);
  }
  const claims = tokens.claims()!;
  const user = await signIn({
    provider: claims.iss, subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : null,
  });
  const headers = new Headers({ Location: origin(req) + safeNext(flow.next) });
  headers.append("Set-Cookie", sessionCookie(req, user));
  headers.append("Set-Cookie", FLOW_COOKIE + "=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0");
  return new Response(null, { status: 302, headers });
}
