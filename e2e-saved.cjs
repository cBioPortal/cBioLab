// The Saved tab's lists (app/lab/use-saved.ts): loading, failed and empty are three states, each
// said in words (CLAUDE.md, "waiting, and never hiding what isn't shown"), and saving under a name
// that exists updates it. Each waiting state is checked by holding the request.
//
// Run by e2e.cjs when it has the login; on its own against a running server with LOGIN_PASSWORD set:
//   E2E_PORT=3109 E2E_LOGIN_PASSWORD=… node e2e-saved.cjs

const LIST = /\/api\/artifacts\?kind=cohort/;

async function savedLists(browser, ok, BASE, LOGIN) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const savedCount = async (name) => ((await (await ctx.request.get(BASE + "/api/artifacts?kind=cohort")).json()).artifacts || [])
    .filter((a) => a.name === name).length;
  try {
    // logged out, before the server has said whether there is a login: waiting, not "no login"
    {
      let release; const gate = new Promise((r) => (release = r));
      await page.route("**/api/login", async (route) => { await gate; await route.continue().catch(() => {}); });
      await page.goto(BASE + "/lab?tab=cohorts", { waitUntil: "domcontentloaded" });
      await page.getByText("loading your login").waitFor({ timeout: 120000 });
      ok("Saved tab waits for the login rather than claiming there is none",
        (await page.getByText("This deployment has no login").count()) === 0);
      release(); await page.unroute("**/api/login");
    }

    await ctx.request.post(BASE + "/api/login", { data: { code: LOGIN } });

    // the list held: a loader, the rest of the tab usable, never "Nothing saved yet"
    {
      let release; const gate = new Promise((r) => (release = r));
      await page.route(LIST, async (route) => { await gate; await route.continue().catch(() => {}); });
      await page.goto(BASE + "/lab?tab=cohorts", { waitUntil: "domcontentloaded" });
      await page.getByText("loading saved cohorts").waitFor({ timeout: 120000 });
      const claimsEmpty = await page.getByText("Nothing saved yet").count();
      const usable = await page.getByRole("button", { name: "preview" }).first().isEnabled();
      release(); await page.unroute(LIST);
      await page.getByText("loading saved cohorts").waitFor({ state: "detached", timeout: 60000 });
      ok("a saved list that is loading says so, and the tab stays usable", claimsEmpty === 0 && usable,
        "claims empty: " + !!claimsEmpty + ", usable: " + usable);
    }

    // the list failing: the error named, a retry that recovers
    {
      let failed = false;
      await page.route(LIST, async (route) => {
        if (!failed) { failed = true; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "e2e refusal" }) }); }
        return route.continue();
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("could not load saved cohorts: e2e refusal").waitFor({ timeout: 120000 });
      const claimsEmpty = await page.getByText("Nothing saved yet").count();
      await page.getByRole("button", { name: "retry" }).click();
      await page.getByText("could not load saved cohorts").waitFor({ state: "detached", timeout: 60000 });
      await page.unroute(LIST);
      ok("a saved list that failed names the error and retries", claimsEmpty === 0, "claims empty: " + !!claimsEmpty);
    }

    // saving an example twice under its name: one stored cohort, listed once
    {
      const first = page.locator("label.pick").first();
      const name = (await first.innerText()).trim();
      const row = first.locator("xpath=../..");
      await row.getByRole("button", { name: "save" }).click();
      await page.locator("label.pick", { hasText: name }).nth(1).waitFor({ timeout: 120000 });
      await row.getByRole("button", { name: "save" }).click();
      await page.waitForTimeout(2500);
      const stored = await savedCount(name), listed = await page.locator("label.pick", { hasText: name }).count() - 1;
      ok("saving a cohort under a name it has updates it", stored === 1 && listed === 1, "stored " + stored + ", listed " + listed);
    }

    ok("Saved tab: no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
  } catch (e) {
    ok("Saved tab checks ran", false, String(e.message).split("\n")[0].slice(0, 160));
  }
  await ctx.close();
}

module.exports = { savedLists };

if (require.main === module) {
  const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");
  (async () => {
    const browser = await chromium.launch({ executablePath: process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome" });
    const results = [];
    await savedLists(browser, (n, c, x) => results.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : "")),
      "http://localhost:" + (process.env.E2E_PORT || 3100), process.env.E2E_LOGIN_PASSWORD || "");
    await browser.close();
    console.log(results.join("\n"));
    process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
  })();
}
