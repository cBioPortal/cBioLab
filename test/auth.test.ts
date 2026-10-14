// The session (lib/auth.ts): which sign-ins a deployment offers, and that only a cookie this server
// signed, unexpired and unaltered, names a user. The development sign-in route end to end, on
// lib/db.ts's in-process database.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.SUPABASE_DB_URL;
delete process.env.DATABASE_URL;
const env = { ...process.env };
const auth = await import("../lib/auth.ts");
const req = (cookie?: string, url = "https://x.test/api") => new Request(url, { headers: cookie ? { cookie } : {} });
const U = { id: "00000000-0000-0000-0000-000000000001", email: "ada@example.org", name: "Ada" };
const reset = () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("AUTH_") || k === "VERCEL_ENV") delete process.env[k];
};

describe("which sign-ins a deployment offers", () => {
  beforeEach(reset);
  after(() => { process.env = { ...env }; });
  test("none configured: no sign-in, and stores say so", () => {
    assert.equal(auth.loginEnabled(), false);
    assert.deepEqual(auth.loginOptions(), { oidc: null, dev: false });
    assert.throws(() => auth.requirePrincipal(req()), /has no sign-in/);
  });
  test("the development sign-in is refused on Vercel production whatever the setting", () => {
    process.env.AUTH_DEV_LOGIN = "1";
    assert.equal(auth.devLoginAllowed(), true);
    process.env.VERCEL_ENV = "production";
    assert.equal(auth.devLoginAllowed(), false);
    assert.equal(auth.loginEnabled(), false);
  });
  test("a provider is named from its issuer, or by AUTH_OIDC_LABEL", () => {
    Object.assign(process.env, { AUTH_OIDC_ISSUER: "https://accounts.google.com", AUTH_OIDC_CLIENT_ID: "c", AUTH_OIDC_CLIENT_SECRET: "s" });
    assert.deepEqual(auth.loginOptions(), { oidc: "Google", dev: false });
    process.env.AUTH_OIDC_LABEL = "MSK";
    assert.equal(auth.loginOptions().oidc, "MSK");
  });
  test("a provider without a session secret is refused rather than signing with a guessable one", () => {
    Object.assign(process.env, { AUTH_OIDC_ISSUER: "https://accounts.google.com", AUTH_OIDC_CLIENT_ID: "c", AUTH_OIDC_CLIENT_SECRET: "s" });
    assert.throws(() => auth.sessionCookie(req(), U), /AUTH_SESSION_SECRET is not set/);
    process.env.AUTH_SESSION_SECRET = "short";
    assert.throws(() => auth.sessionCookie(req(), U), /at least 32 characters/);
  });
});

describe("the session cookie", () => {
  beforeEach(() => { reset(); process.env.AUTH_DEV_LOGIN = "1"; process.env.AUTH_SESSION_SECRET = "a".repeat(40); });
  after(() => { process.env = { ...env }; });
  const cookieOf = (set: string) => set.split(";")[0];

  test("names the user it was made for, httpOnly, Secure over https", () => {
    const set = auth.sessionCookie(req(), U);
    assert.match(set, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    assert.doesNotMatch(auth.sessionCookie(req(undefined, "http://x.test/"), U), /Secure/);
    assert.deepEqual(auth.userFor(req(cookieOf(set))), U);
    assert.equal(auth.requirePrincipal(req(cookieOf(set))), U.id);
    assert.throws(() => auth.requirePrincipal(req()), /sign in to use saved cohorts, analyses and custom data/);
  });
  test("an altered body or signature names nobody", () => {
    const c = cookieOf(auth.sessionCookie(req(), U));
    const [name, value] = c.split("="), [body, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "someone-else" })).toString("base64url");
    assert.equal(auth.userFor(req(name + "=" + forged + "." + mac)), null);
    assert.equal(auth.userFor(req(name + "=" + body + "." + mac.slice(0, -2) + "xx")), null);
    assert.equal(auth.userFor(req(name + "=" + body)), null);
    assert.equal(auth.userFor(req(name + "=garbage")), null);
  });
  test("an expired session names nobody", (t) => {
    const c = cookieOf(auth.sessionCookie(req(), U));
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 15 * 86400_000 });
    assert.equal(auth.userFor(req(c)), null);
  });
  test("changing the secret signs every browser out; so does switching sign-in off", () => {
    const c = cookieOf(auth.sessionCookie(req(), U));
    process.env.AUTH_SESSION_SECRET = "b".repeat(40);
    assert.equal(auth.userFor(req(c)), null);
    process.env.AUTH_SESSION_SECRET = "a".repeat(40);
    assert.ok(auth.userFor(req(c)));
    delete process.env.AUTH_DEV_LOGIN;
    assert.equal(auth.userFor(req(c)), null);
  });
  test("signing out clears the cookie", () => {
    assert.match(auth.signOutCookie(), /^cl_session=; .*Max-Age=0/);
  });
});

describe("POST /api/auth/dev", () => {
  beforeEach(reset);
  after(() => { process.env = { ...env }; });
  const post = (body: unknown) => new Request("http://x.test/api/auth/dev", { method: "POST", body: JSON.stringify(body) });

  test("absent unless enabled", async () => {
    const { POST } = await import("../app/api/auth/dev/route.ts");
    assert.equal((await POST(post({ email: "a@example.org" }))).status, 404);
  });
  test("signs in as the email given, the same user each time, and the session works", async () => {
    process.env.AUTH_DEV_LOGIN = "1";
    const { POST } = await import("../app/api/auth/dev/route.ts");
    const r1 = await POST(post({ email: " Dev@Example.org " }));
    assert.equal(r1.status, 200);
    const { user } = await r1.json();
    assert.equal(user.email, "dev@example.org");
    const cookie = r1.headers.get("set-cookie")!.split(";")[0];
    assert.equal(auth.principalFor(req(cookie)), user.id);
    const again = await (await POST(post({ email: "dev@example.org" }))).json();
    assert.equal(again.user.id, user.id);
    assert.equal((await POST(post({ email: "not an email" }))).status, 400);
  });
  test("what GET /api/auth reports: the options, and who this browser is", () => {
    process.env.AUTH_DEV_LOGIN = "1";
    assert.deepEqual(auth.loginOptions(), { oidc: null, dev: true });
    assert.equal(auth.userFor(req()), null);
    assert.deepEqual(auth.userFor(req(auth.sessionCookie(req(), U).split(";")[0])), U);
  });
});
