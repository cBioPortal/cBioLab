// Signing in through an OpenID Connect provider (lib/oidc.ts), end to end against a stand-in
// provider on this machine: discovery, the redirect with PKCE, state and nonce, the code exchange,
// the signed ID token, and the user and session that result — plus each way it must refuse.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

delete process.env.SUPABASE_DB_URL;
delete process.env.DATABASE_URL;

const CLIENT = "cohort-lab-test", SECRET = "client-secret";
let issuer = "", server: Server;
/** who the provider says signs in next, and how it should misbehave */
let person: Record<string, unknown> = {};
let tamper: { nonce?: string; sub?: string } = {};
const codes = new Map<string, { challenge: string; nonce: string; redirect: string }>();

before(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- a stand-in server: a handler that throws fails the test's own request
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/.well-known/openid-configuration") return json(200, {
      issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", jwks_uri: issuer + "/jwks",
      response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    });
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      assert.equal(p.get("client_id"), CLIENT);
      assert.equal(p.get("code_challenge_method"), "S256");
      assert.match(p.get("scope")!, /openid/);
      const code = "code-" + codes.size;
      codes.set(code, { challenge: p.get("code_challenge")!, nonce: p.get("nonce")!, redirect: p.get("redirect_uri")! });
      res.writeHead(302, { location: p.get("redirect_uri") + "?code=" + code + "&state=" + p.get("state") });
      return res.end();
    }
    if (url.pathname === "/token") {
      let body = ""; for await (const c of req) body += c;
      const p = new URLSearchParams(body);
      // client_secret_basic or client_secret_post, as Google and Keycloak both accept
      const [id, sec] = req.headers.authorization
        ? Buffer.from(req.headers.authorization.replace(/^Basic /, ""), "base64").toString().split(":").map(decodeURIComponent)
        : [p.get("client_id"), p.get("client_secret")];
      if (id !== CLIENT || sec !== SECRET) return json(401, { error: "invalid_client" });
      const c = codes.get(p.get("code")!);
      if (!c || p.get("redirect_uri") !== c.redirect) return json(400, { error: "invalid_grant" });
      const challenge = createHash("sha256").update(p.get("code_verifier")!).digest("base64url");
      if (challenge !== c.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE" });
      codes.delete(p.get("code")!);
      const idToken = await new SignJWT({ nonce: tamper.nonce ?? c.nonce, ...person })
        .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(CLIENT)
        .setSubject(tamper.sub ?? String(person.sub)).setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return json(200, { access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  issuer = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  Object.assign(process.env, { AUTH_OIDC_ISSUER: issuer, AUTH_OIDC_CLIENT_ID: CLIENT, AUTH_OIDC_CLIENT_SECRET: SECRET, AUTH_SESSION_SECRET: "s".repeat(40) });
});
after(() => server.close());

const APP = "http://app.test";
const cookieFrom = (r: Response, name: string) =>
  r.headers.getSetCookie().find((c) => c.startsWith(name + "="))?.split(";")[0] ?? "";

/** Through the whole redirect dance; returns the callback's response. */
async function signInFlow(next = "/lab?tab=saved", opts: { swapCookie?: string } = {}) {
  const { start, finish } = await import("../lib/oidc.ts");
  const s = await start(new Request(APP + "/api/auth/login?next=" + encodeURIComponent(next)));
  assert.equal(s.status, 302);
  const flow = cookieFrom(s, "cl_oidc");
  assert.match(s.headers.getSetCookie()[0], /Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=600/);
  const at = await fetch(s.headers.get("location")!, { redirect: "manual" });
  const back = at.headers.get("location")!;
  assert.ok(back.startsWith(APP + "/api/auth/callback?"), back);
  return finish(new Request(back, { headers: { cookie: opts.swapCookie ?? flow } }));
}

describe("signing in through the provider", () => {
  test("a verified person comes back signed in, to where they started", async () => {
    person = { sub: "p-1", email: "Ada@Example.org", email_verified: true, name: "Ada Lovelace" }; tamper = {};
    const r = await signInFlow();
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), APP + "/lab?tab=saved");
    const { userFor } = await import("../lib/auth.ts");
    const u = userFor(new Request(APP, { headers: { cookie: cookieFrom(r, "cl_session") } }));
    assert.equal(u?.email, "ada@example.org");
    assert.equal(u?.name, "Ada Lovelace");
    assert.match(cookieFrom(r, "cl_oidc"), /^cl_oidc=$/, "the flow cookie is cleared");
    // signing in again is the same user
    const again = await signInFlow();
    assert.equal(userFor(new Request(APP, { headers: { cookie: cookieFrom(again, "cl_session") } }))?.id, u?.id);
  });

  test("after signing in, only a path on this site: never another origin", async () => {
    const { safeNext } = await import("../lib/oidc.ts");
    for (const bad of ["//evil.test/x", "https://evil.test", "/\\evil.test", "lab", "", null]) assert.equal(safeNext(bad), "/lab", String(bad));
    assert.equal(safeNext("/campaign/1?x=2"), "/campaign/1?x=2");
    person = { sub: "p-2", email: "b@example.org", email_verified: true }; tamper = {};
    assert.equal((await signInFlow("//evil.test")).headers.get("location"), APP + "/lab");
  });

  test("a token for another sign-in's nonce is refused", async () => {
    person = { sub: "p-3", email: "c@example.org", email_verified: true }; tamper = { nonce: "someone-elses" };
    await assert.rejects(signInFlow(), /nonce/);
  });

  test("a callback with another browser's flow is refused", async () => {
    person = { sub: "p-4", email: "d@example.org", email_verified: true }; tamper = {};
    const { start } = await import("../lib/oidc.ts");
    const other = cookieFrom(await start(new Request(APP + "/api/auth/login")), "cl_oidc");
    await assert.rejects(signInFlow("/lab", { swapCookie: other }), /state/);
    await assert.rejects(signInFlow("/lab", { swapCookie: "" }), /took too long or started in another browser/);
  });

  test("an unverified address cannot take over an existing account", async () => {
    const { userForEmail } = await import("../lib/users.ts");
    await userForEmail("added@example.org");
    person = { sub: "p-5", email: "added@example.org", email_verified: false }; tamper = {};
    await assert.rejects(signInFlow(), /has not verified that address/);
  });
});
