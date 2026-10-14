// Server-stored custom data and saved artifacts on the fallback a deployment without DATABASE_URL
// gets — lib/db.ts's own in-process Postgres, migrated on first use (the contracts in
// test/support/store-contracts.ts; test/postgres.db-test.ts runs the same ones on a Postgres the
// test hands the stores) — and the access code, which is the only way in.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

delete process.env.SUPABASE_DB_URL;
delete process.env.DATABASE_URL;
const { customStoreContract, artifactContract } = await import("./support/store-contracts.ts");
const access = await import("../lib/auth.ts");

customStoreContract("in-process fallback");
artifactContract("in-process fallback");

describe("custom data access code", () => {
  const req = (cookie?: string) => new Request("https://x.test/api", { headers: cookie ? { cookie } : {} });
  test("disabled where no code is configured", () => {
    delete process.env.LOGIN_PASSWORD;
    assert.equal(access.loginEnabled(), false);
    assert.throws(() => access.requirePrincipal(req()), /has no login/);
  });
  test("only the right code unlocks, and only its cookie is accepted", () => {
    process.env.LOGIN_PASSWORD = "correct horse";
    assert.equal(access.unlockCookie("wrong", true), null);
    const set = access.unlockCookie("correct horse", true)!;
    assert.match(set, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    assert.ok(!set.includes("correct horse"), "the cookie holds a hash, never the code");
    const cookie = set.split(";")[0];
    assert.equal(access.requirePrincipal(req(cookie)), "shared");
    assert.throws(() => access.requirePrincipal(req()), /log in to use saved cohorts, analyses and custom data/);
    assert.throws(() => access.requirePrincipal(req(access.ACCESS_COOKIE + "=deadbeef")), /log in/);
    process.env.LOGIN_PASSWORD = "rotated";
    assert.throws(() => access.requirePrincipal(req(cookie)), /log in/, "rotating the password logs every browser out");
    delete process.env.LOGIN_PASSWORD;
  });
});
