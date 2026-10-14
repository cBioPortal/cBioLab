// The Saved tab's lists (app/lab/use-saved.ts) and the analysis page's text dialogs. The lists: loading, failed and empty are three states, each
// said in words (CLAUDE.md, "waiting, and never hiding what isn't shown"), and saving under a name
// that exists updates it. Each waiting state is checked by holding the request.
//
// Run by e2e.cjs when it has a sign-in; on its own against a running server with AUTH_DEV_LOGIN=1:
//   E2E_PORT=3109 E2E_LOGIN_EMAIL=someone@example.org node e2e-saved.cjs

const LIST = /\/api\/artifacts\?kind=cohort/;

async function savedLists(browser, ok, BASE, LOGIN) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const savedCount = async (name) => ((await (await ctx.request.get(BASE + "/api/artifacts?kind=cohort")).json()).artifacts || [])
    .filter((a) => a.name === name).length;
  try {
    // signed out, before the server has said whether there is a sign-in: waiting, not "no sign-in"
    {
      let release; const gate = new Promise((r) => (release = r));
      await page.route("**/api/auth", async (route) => { await gate; await route.continue().catch(() => {}); });
      await page.goto(BASE + "/lab?tab=cohorts", { waitUntil: "domcontentloaded" });
      await page.getByText("loading your sign-in").waitFor({ timeout: 120000 });
      ok("Saved tab waits for the sign-in rather than claiming there is none",
        (await page.getByText("This deployment has no sign-in").count()) === 0);
      release(); await page.unroute("**/api/auth");
    }

    // signing in through the header's dialog: the development sign-in form, then who is signed in
    {
      await page.locator("header").getByRole("button", { name: "Sign in" }).click();
      const dlg = page.locator("[role=dialog].logindialog");
      await dlg.locator("input[type=email]").fill(LOGIN);
      await dlg.locator("button[type=submit]").click();
      const shown = await page.locator(".loginstate .meta").first().innerText({ timeout: 30000 }).catch(() => "");
      ok("signing in from the header names who is signed in", shown === LOGIN, shown);
    }

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

    // the analysis page's text dialogs (app/lab/dialogs.tsx): a workspace saved and reopened, a
    // cohort rename refused onto a taken name, a view note added and emptied
    {
      const tool = (n, a = {}) => page.evaluate(([n, a]) => window.cohortLab.call(n, a), [n, a]);
      const doc = async () => (await tool("analysis_get_document")).document;
      const open = (cls) => page.locator("[role=dialog]." + cls);
      /** poll the document until `pred` holds (an edit reaches it a render later), or give up after 15 s */
      const docUntil = async (pred) => {
        for (const t0 = Date.now(); Date.now() - t0 < 15000; await page.waitForTimeout(200)) if (pred(await doc())) return true;
        return false;
      };
      await page.goto(BASE + "/lab?tab=analysis", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.cohortLab && window.cohortLab.call, null, { timeout: 120000 });
      await tool("analysis_load_example", { title: "Genomic status via OQL, compared" });
      const wsBtn = page.locator("button[title*='save this analysis'], button[title*='” — ']").first();
      await wsBtn.waitFor({ timeout: 120000 });
      for (let i = 0; i < 400 && await wsBtn.isDisabled(); i++) await page.waitForTimeout(300);
      await wsBtn.click();
      await open("wsdialog").waitFor();
      const startsEmpty = (await open("wsdialog").locator("input").first().inputValue()) === "" && await open("wsdialog").locator("button[type=submit]").isDisabled();
      await open("wsdialog").locator("input").first().fill("e2e workspace");
      await open("wsdialog").locator("button[type=submit]").click();
      await page.waitForFunction(() => /saved \d{4}/.test(document.querySelector("button[title*='” — ']")?.title || ""), null, { timeout: 60000 }).catch(() => {});
      await wsBtn.click();
      await open("wsdialog").waitFor();
      const reopened = (await open("wsdialog").locator("input").first().inputValue()) === "e2e workspace" && /saved \d{4}/.test(await open("wsdialog").locator(".meta").first().innerText());
      await page.keyboard.press("Escape");
      ok("workspace dialog: starts unnamed, saves, reopens with its name and saved state", startsEmpty && reopened && (await doc()).title === "e2e workspace",
        "starts empty " + startsEmpty + ", reopened " + reopened);

      const names = Object.keys((await doc()).cohorts);
      const menu = page.locator("[data-slot=popover-content]");
      await page.locator(".cohortgear").first().click();
      await menu.getByRole("button", { name: "edit…" }).click();
      await open("cohortdialog").waitFor();
      await page.locator("#cename").fill(names[1]);
      await open("cohortdialog").locator("button[type=submit]").click();
      const refused = /already exists/.test(await open("cohortdialog").locator(".error").innerText({ timeout: 5000 }).catch(() => ""));
      await page.locator("#cename").fill("e2e renamed");
      await open("cohortdialog").locator("button[type=submit]").click();
      const renamed = await docUntil((d) => !!d.cohorts["e2e renamed"] && !d.cohorts[names[0]]);
      ok("cohort dialog: refuses a taken name, then renames", refused && renamed, "refused " + refused + ", renamed " + renamed);

      const vgear = page.locator(".viewcard .viewgear").first();
      await vgear.click();
      await menu.getByRole("button", { name: /add note…/ }).click();
      await page.locator("#vntext").fill("  e2e note  ");
      await open("cohortdialog").locator("button[type=submit]").click();
      const noted = await docUntil((d) => d.views[0].note === "e2e note");
      await vgear.click();
      await menu.getByRole("button", { name: /edit note…/ }).click();
      await page.locator("#vntext").fill("");
      await open("cohortdialog").locator("button[type=submit]").click();
      const cleared = await docUntil((d) => d.views[0].note === undefined);
      ok("view note dialog: saves the note trimmed, and emptying removes it", noted && cleared, "noted " + noted + ", cleared " + cleared);
    }

    // an upload's preview matches its ids against the explored study, saying what it drops
    {
      const tool = (n, a = {}) => page.evaluate(([n, a]) => window.cohortLab.call(n, a), [n, a]);
      await page.goto(BASE + "/lab?tab=explore", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.cohortLab && window.cohortLab.call, null, { timeout: 120000 });
      await tool("explore_select_studies", { studies: ["msk_chord_2024"] });
      await page.locator('button[title^="upload your own annotations"]').click();
      await page.locator("[role=dialog].customdatamanager [role=tab]", { hasText: "Add data" }).click();
      await page.locator("textarea.customdata-text").fill("PATIENT_ID\tGROUP\nP-0000012\tA\nP-0000015\tB\nNOT_A_PATIENT\tC\n");
      await page.locator("[role=dialog].customdatamanager button", { hasText: "Check ids" }).click();
      const said = await page.waitForFunction(() => {
        const t = (document.querySelector("[role=dialog].customdatamanager")?.innerText || "").replace(/\s+/g, " ");
        return /of 3 rows matched/.test(t) && t;
      }, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => "");
      ok("an upload's preview matches its ids and names what it drops",
        /2 of 3 rows matched a patient of msk_chord_2024/.test(said) && /NOT_A_PATIENT/.test(said),
        (said.match(/\d+ of 3 rows matched[^.]*/) || [said.slice(0, 120)])[0]);
      // the example is built from the explored study's own patients, so every row of it matches
      await page.locator("[role=dialog].customdatamanager button", { hasText: "start over" }).click();
      await page.locator("[role=dialog].customdatamanager button", { hasText: "Use example data for msk_chord_2024" }).click();
      const ex = await page.waitForFunction(() => {
        const t = (document.querySelector("[role=dialog].customdatamanager .cd-match")?.textContent || "").replace(/\s+/g, " ");
        return /rows matched/.test(t) && t;
      }, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => "");
      ok("the upload example matches the explored study in full", /(\d+) of \1 rows matched a patient of msk_chord_2024/.test(ex), ex.slice(0, 120));
      await page.keyboard.press("Escape");
    }

    ok("Saved tab: no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
  } catch (e) {
    ok("Saved tab checks ran", false, String(e.message).split("\n")[0].slice(0, 160));
  }
  await ctx.close();
}

module.exports = { savedLists };

if (require.main === module) {
  const { launch } = require("./e2e-browser.cjs");
  (async () => {
    const browser = await launch();
    const results = [];
    await savedLists(browser, (n, c, x) => results.push((c ? "PASS " : "FAIL ") + n + (x ? "  [" + x + "]" : "")),
      "http://localhost:" + (process.env.E2E_PORT || 3100), process.env.E2E_LOGIN_EMAIL || "");
    await browser.close();
    console.log(results.join("\n"));
    process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
  })();
}
