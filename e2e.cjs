// The browser checks (Playwright) against a running server: `node e2e.cjs` (E2E_PORT, default 3100;
// E2E_LOGIN_EMAIL to sign in). The checks live by area in test/e2e/; this file runs them in order —
// the light and dark passes over one page first, then each area in a context of its own — and
// prints PASS/FAIL per check. A new check goes in its area's file, or a new area's file listed here.
// E2E_ONLY=view-kinds,riskmodel runs only the areas named (by file name in test/e2e/, plus lab-races
// and saved), for iterating on them; the gate runs them all.
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
const { drivers } = require("./test/e2e/drivers.cjs");
const { homepage } = require("./test/e2e/homepage.cjs");
const { portal } = require("./test/e2e/portal.cjs");
const { savedCohorts } = require("./test/e2e/saved-cohorts.cjs");
const { studyPicker } = require("./test/e2e/study-picker.cjs");
const { viewKinds } = require("./test/e2e/view-kinds.cjs");
const { links } = require("./test/e2e/links.cjs");

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
  const only = new Set((process.env.E2E_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean));
  const want = (area) => only.size === 0 || only.has(area);
  const LIGHT_AREAS = ["site", "explore", "analysis-controls", "analysis-page", "examples"];
  if (want("accounts")) await accounts(t);

  for (const scheme of ["light", "dark"]) {
    if (only.size && (scheme === "dark" || !LIGHT_AREAS.some(want))) continue;
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
      if (want("site")) await site({ ...t, ctx, page, errors, scheme });
      if (want("explore")) await explore({ ...t, ctx, page, errors, scheme });
      if (want("analysis-controls")) await analysisControls({ ...t, ctx, page, errors, scheme });
      if (want("analysis-page")) await analysisPage({ ...t, ctx, page, errors, scheme });
      if (want("examples")) await examples({ ...t, ctx, page, errors, scheme });
    } else {
      await page.screenshot({ path: "shot-next-dark.png", fullPage: false });
    }
    ok(scheme + ": no JS errors", errors.length === 0, errors.slice(0, 4).join(" | "));
    await ctx.close();
  }
  if (want("tables")) await tables(t);
  if (want("assays")) await assays(t);
  if (want("riskmodel")) await riskmodel(t);
  if (want("view-kinds")) await viewKinds(t);
  if (want("patient-views")) await patientViews(t);
  if (want("lollipop")) await lollipop(t);
  if (want("drivers")) await drivers(t);
  if (want("homepage")) await homepage(t);
  if (want("portal")) await portal(t);
  if (want("saved-cohorts")) await savedCohorts(t);
  if (want("study-picker")) await studyPicker(t);
  if (want("links")) await links(t);

  // the analysis page's requests finishing out of order (e2e-lab-races.cjs)
  if (want("lab-races")) await require("./e2e-lab-races.cjs").labRaces(browser, ok, BASE);
  // the Saved tab's lists: loading, failed and empty said apart; a re-save updates (e2e-saved.cjs)
  if (LOGIN && want("saved")) await require("./e2e-saved.cjs").savedLists(browser, ok, BASE, LOGIN);
  if (results.length === 0) results.push("FAIL E2E_ONLY named no area that ran  [" + [...only].join(",") + "]");

  await browser.close();

  console.log(results.join("\n"));
  process.exit(results.some(r => r.startsWith("FAIL")) ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(2); });
