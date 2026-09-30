// The site password gate (lib/site-auth.ts): who gets in, who is redirected,
// and that the gate fails closed on a deployment without a password.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decide, signSession, verifySession, checkPassword, safeNext, SESSION_TTL_SECONDS } from "../lib/site-auth.ts";

const NOW = 1_800_000_000;
const env = { SITE_PASSWORD: "hunter2", AUTH_SECRET: "s".repeat(32) };
const withToken = { ...env, SITE_API_TOKEN: "tok-123" };

describe("gate off", () => {
  test("no password locally → everything allowed", async () => {
    assert.equal((await decide({}, { path: "/lab" }, NOW)).action, "allow");
    assert.equal((await decide({}, { path: "/api/artifacts" }, NOW)).action, "allow");
  });
  test("no password on a Vercel deployment → fails closed", async () => {
    assert.equal((await decide({ VERCEL_ENV: "production" }, { path: "/" }, NOW)).action, "misconfigured");
    assert.equal((await decide({ VERCEL_ENV: "preview" }, { path: "/" }, NOW)).action, "misconfigured");
  });
  test("password without AUTH_SECRET → fails closed", async () => {
    assert.equal((await decide({ SITE_PASSWORD: "x" }, { path: "/" }, NOW)).action, "misconfigured");
  });
});

describe("gate on", () => {
  test("pages without a session redirect to login; APIs get 401", async () => {
    assert.equal((await decide(env, { path: "/lab" }, NOW)).action, "login");
    assert.equal((await decide(env, { path: "/api/artifacts" }, NOW)).action, "unauthorized");
  });
  test("the login flow itself is reachable", async () => {
    for (const path of ["/login", "/api/login", "/api/logout"])
      assert.equal((await decide(env, { path }, NOW)).action, "allow", path);
  });
  test("a valid session cookie admits pages and APIs", async () => {
    const cookie = await signSession(env, NOW);
    assert.equal((await decide(env, { path: "/lab", cookie }, NOW)).action, "allow");
    assert.equal((await decide(env, { path: "/api/artifacts", cookie }, NOW)).action, "allow");
  });
  test("expired, tampered, or foreign-key cookies are rejected", async () => {
    const cookie = await signSession(env, NOW);
    assert.equal(await verifySession(env, cookie, NOW + SESSION_TTL_SECONDS + 1), false);
    const [v, exp, sig] = cookie.split(".");
    assert.equal(await verifySession(env, [v, String(Number(exp) + 999999), sig].join("."), NOW), false);
    assert.equal(await verifySession({ ...env, AUTH_SECRET: "other" }, cookie, NOW), false);
    assert.equal(await verifySession(env, "garbage", NOW), false);
  });
  test("changing the password revokes existing sessions", async () => {
    const cookie = await signSession(env, NOW);
    assert.equal(await verifySession({ ...env, SITE_PASSWORD: "new" }, cookie, NOW), false);
  });
  test("bearer token admits APIs but not pages", async () => {
    const authorization = "Bearer tok-123";
    assert.equal((await decide(withToken, { path: "/api/oncoprint", authorization }, NOW)).action, "allow");
    assert.equal((await decide(withToken, { path: "/api/oncoprint", authorization: "Bearer wrong" }, NOW)).action, "unauthorized");
    assert.equal((await decide(withToken, { path: "/lab", authorization }, NOW)).action, "login");
  });
  test("/api/mcp is open without SITE_API_TOKEN, bearer-only with it", async () => {
    assert.equal((await decide(env, { path: "/api/mcp" }, NOW)).action, "allow");
    assert.equal((await decide(withToken, { path: "/api/mcp" }, NOW)).action, "unauthorized");
    assert.equal((await decide(withToken, { path: "/api/mcp", authorization: "Bearer tok-123" }, NOW)).action, "allow");
    const cookie = await signSession(withToken, NOW);
    assert.equal((await decide(withToken, { path: "/api/mcp", cookie }, NOW)).action, "unauthorized");
  });
  test("password check", async () => {
    assert.equal(await checkPassword(env, "hunter2"), true);
    assert.equal(await checkPassword(env, "hunter3"), false);
    assert.equal(await checkPassword(env, undefined), false);
  });
});

test("safeNext refuses off-site redirects", () => {
  assert.equal(safeNext("/lab?tab=explore"), "/lab?tab=explore");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "", undefined, 42])
    assert.equal(safeNext(bad), "/", String(bad));
});
