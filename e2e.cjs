// The browser checks (Playwright) against a running server: `node e2e.cjs` (E2E_PORT, default 3100;
// E2E_LOGIN_EMAIL to sign in). The checks live by area in test/e2e/; this file runs them in order —
// the light and dark passes over one page first, then each area in a context of its own — and
// prints PASS/FAIL per check. A new check goes in its area's file, or a new area's file listed here.
const { launch } = require("./e2e-browser.cjs");
const { accounts } = require("./test/e2e/accounts.cjs");
const { site } = require("./test/e2e/site.cjs");
const { explore } = require("./test/e2e/explore.cjs");
const { analysisControls } = require("./test/e2e/analysis-controls.cjs");
const { analysisPage } = require("./test/e2e/analysis-page.cjs");
const { examples } = require("./test/e2e/examples.cjs");
const { tables } = require("./test/e2e/tables.cjs");
const { assays } = require("./test/e2e/assays.cjs");
const { riskmodel } = require("./test/e2e/riskmodel.cjs");
const { patientViews } = require("./test/e2e/patient-views.cjs");
const { lollipop } = require("./test/e2e/lollipop.cjs");
const { homepage } = require("./test/e2e/homepage.cjs");
const { portal } = require("./test/e2e/portal.cjs");
const { savedCohorts } = require("./test/e2e/saved-cohorts.cjs");
const { studyPicker } = require("./test/e2e/study-picker.cjs");

const BASE = "http://localhost:" + (process.env.E2E_PORT || 3100);

async function main() {
  const { decodeUrlJson } = await import("./lib/url-json.ts");
  const browser = await launch();
  const results = [];
  const ok = (name, cond, extra) =>
    results.push((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));

  // Saved cohorts and analyses need a sign-in (lib/auth.ts). scripts/gate.sh turns on its server's
  // development sign-in and passes the email to sign in as here; signed out, the store must refuse.
  const LOGIN = process.env.E2E_LOGIN_EMAIL || "";
  const signIn = (ctx, email = LOGIN) => ctx.request.post(BASE + "/api/auth/dev", { data: { email } });
  /** what every area's checks are given; the light pass adds its context, page, errors and scheme */
  const t = { browser, ok, BASE, LOGIN, signIn, decodeUrlJson };
  await accounts(t);

  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
    if (LOGIN) {
      const r = await signIn(ctx);
      ok("signs in (" + scheme + ")", r.ok(), "HTTP " + r.status());
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    // A console message about a failed resource does not say WHICH resource, which makes a
    // transient server error impossible to chase. Record the method, url and status too.
    page.on("response", r => {
      if (r.status() >= 500) errors.push("http " + r.status() + " " + r.request().method() + " " + r.url());
    });
    // net::ERR_ABORTED is the page cancelling a request it no longer needs (an analysis query
    // superseded by a later edit, use-analysis.ts), not a failure
    page.on("requestfailed", r => ((r.failure() || {}).errorText === "net::ERR_ABORTED") || errors.push("requestfailed " + r.method() + " " + r.url() +
      " (" + ((r.failure() || {}).errorText || "?") + ")"));

    // "/" is the homepage (choose studies, then explore or query them); the app's
    // shell is /lab, the base for both passes below.
    const rootResp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    ok(scheme + ": / is the homepage", new URL(page.url()).pathname === "/" && rootResp.ok() &&
      (await page.locator("section[aria-label='choose studies']").count()) === 1,
      page.url() + " status " + rootResp.status());
    await page.goto(BASE + "/lab", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[aria-label='lab sections'] [role=tab]", { timeout: 90000 });
    ok(scheme + ": app shell loads", (await page.getByRole("tab").count()) >= 2);

    if (scheme === "light") {
      await site({ ...t, ctx, page, errors, scheme });
      await explore({ ...t, ctx, page, errors, scheme });
      await analysisControls({ ...t, ctx, page, errors, scheme });
      await analysisPage({ ...t, ctx, page, errors, scheme });
      await examples({ ...t, ctx, page, errors, scheme });
    } else {
      await page.screenshot({ path: "shot-next-dark.png", fullPage: false });
    }
    ok(scheme + ": no JS errors", errors.length === 0, errors.slice(0, 4).join(" | "));
    await ctx.close();
  }
  await tables(t);
  await assays(t);
  await riskmodel(t);
  await patientViews(t);
  await lollipop(t);
  await homepage(t);
  await portal(t);
  await savedCohorts(t);
  await studyPicker(t);

  // the analysis page's requests finishing out of order (e2e-lab-races.cjs)
  await require("./e2e-lab-races.cjs").labRaces(browser, ok, BASE);
  // the Saved tab's lists: loading, failed and empty said apart; a re-save updates (e2e-saved.cjs)
  if (LOGIN) await require("./e2e-saved.cjs").savedLists(browser, ok, BASE, LOGIN);

  await browser.close();

  console.log(results.join("\n"));
  process.exit(results.some(r => r.startsWith("FAIL")) ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(2); });
