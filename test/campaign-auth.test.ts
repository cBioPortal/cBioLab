// Changing a campaign (start, register, remove, lock, run) needs the login; reading it and
// checking a hypothesis's feasibility do not. Only the access decision is asserted here — what
// happens after it needs Postgres, which the unit suite does not have.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const ID = "00000000-0000-0000-0000-000000000000";
const post = (body: unknown, cookie?: string) => new Request("http://x/api/campaign/" + ID, {
  method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});

describe("campaign routes: changes need the login", () => {
  let saved: string | undefined, cookie = "";
  before(async () => {
    saved = process.env.LOGIN_PASSWORD;
    process.env.LOGIN_PASSWORD = "test-password";
    const { unlockCookie } = await import("../lib/auth.ts");
    cookie = unlockCookie("test-password", false)!.split(";")[0];
  });
  after(() => { if (saved === undefined) delete process.env.LOGIN_PASSWORD; else process.env.LOGIN_PASSWORD = saved; });

  test("starting a campaign is refused logged out, with what it needs", async () => {
    const { POST } = await import("../app/api/campaign/route.ts");
    const r = await POST(new Request("http://x/api/campaign", { method: "POST", body: JSON.stringify({ question: "q" }) }));
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /log in to start a campaign/);
  });
  for (const action of ["add", "remove", "lock", "run"]) {
    test(`${action}: refused logged out, let through logged in`, async () => {
      const { requireCampaignAccess } = await import("../lib/campaign.ts");
      const { AccessError } = await import("../lib/auth.ts");
      assert.throws(() => requireCampaignAccess(post({ action }), action), (e: unknown) => e instanceof AccessError && e.status === 403 && /^log in to /.test(e.message));
      assert.doesNotThrow(() => requireCampaignAccess(post({ action }, cookie), action));
    });
  }
  test("check, and anything that is not a change, is open", async () => {
    const { requireCampaignAccess } = await import("../lib/campaign.ts");
    for (const action of ["check", undefined, "nonsense"]) assert.doesNotThrow(() => requireCampaignAccess(post({ action }), action));
  });
  test("the [id] route calls it before acting", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../app/api/campaign/[id]/route.ts", import.meta.url), "utf8");
    assert.ok(src.indexOf("requireCampaignAccess(req, body.action)") < src.indexOf("getCampaign(id);\n    let note"), "access is checked first");
  });
});
