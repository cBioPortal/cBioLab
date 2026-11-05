// Stored links and stored id lists in the browser (docs/LINKS.md): a long URL becomes ?s=<id> and
// opens again — after a reload, in a fresh browser, signed out; a missing or slow link is said; a
// failed store is said; a withdrawn list is refused with its owner's note; the Id lists tab
// withdraws and restores.
//
// Everything here can be steered from a test without touching the server:
//   linkMax(ctx, n)    shorten past n characters instead of LINK_URL_MAX (window.__cbioLinkUrlMax)
//   holdLinks(page)    hold GET /api/links/<id> until the returned release() is called
//   failStore(page)    answer POST /api/links with a 500
// The server side is real: the e2e server runs lib/db.ts's in-memory Postgres, so a link stored by
// one test is there for the next and gone when the server stops.

/** shorten past `n` characters in every page of `ctx` */
const linkMax = (ctx, n) => ctx.addInitScript((max) => { window.__cbioLinkUrlMax = max; }, n);

/** hold every read of a stored link until release() */
async function holdLinks(page) {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/api\/links\/[A-Za-z0-9_-]+$/, async (route) => { await held; await route.continue(); });
  return () => release();
}

/** refuse every store of a link, as a failing server would */
const failStore = (page) => page.route(/\/api\/links$/, (route) => route.request().method() === "POST"
  ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "the link store is down (e2e)" }) })
  : route.continue());

const SHORT = /[?&]s=[A-Za-z0-9_-]{22}(&|$)/;
/** text deflate cannot shrink, so the link it is in really is long */
const noise = (n) => require("node:crypto").randomBytes(n).toString("base64url").slice(0, n);

async function links({ browser, ok, BASE, LOGIN, signIn }) {
  const { encodeUrlJson } = await import("../../lib/url-json.ts");
  const docOf = async (p) => JSON.parse(await p.locator("#docjson").inputValue());
  // a document whose link is long: a cohort's notes change nothing it selects, so nothing is counted differently
  const notes = noise(1500);
  const longDoc = { dsl: "2.9", study: "msk_chord_2024", cohorts: { "Long notes": { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }], notes } }, views: [] };
  const longUrl = BASE + "/lab?tab=analysis&doc=" + encodeUrlJson(longDoc);
  let shortUrl = null;

  // A long ?doc= link becomes ?s=<id> once the page has stored it, and the short link opens the same
  // document again: after a reload, and in a fresh browser that has never seen it.
  {
    const steps = {};
    const ctx = await browser.newContext();
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    try {
      await p.goto(longUrl, { waitUntil: "domcontentloaded" });
      await p.waitForFunction((re) => new RegExp(re).test(location.search), SHORT.source, { timeout: 60000 });
      shortUrl = p.url();
      steps.short = shortUrl.length < 200 && !shortUrl.includes("doc=");
      // the document editor fills as the page loads the document; wait for it rather than read it early
      await p.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.same = (await docOf(p)).cohorts["Long notes"]?.notes === notes;
      await p.reload({ waitUntil: "domcontentloaded" });
      await p.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.reloaded = (await docOf(p)).cohorts["Long notes"]?.notes === notes;
      const fresh = await browser.newContext();
      const q = await fresh.newPage();
      await q.goto(shortUrl, { waitUntil: "domcontentloaded" });
      await q.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.elsewhere = (await docOf(q)).cohorts["Long notes"]?.notes === notes;
      await fresh.close();
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("a long link becomes ?s=<id>, and opens the same document after a reload and in a fresh, signed-out browser",
      steps.short && steps.same && steps.reloaded && steps.elsewhere, JSON.stringify(steps));
    await ctx.close();
  }

  // While a stored link is read the page says so, and renders nothing that would read it half-known;
  // a link this deployment does not hold is said instead of a page opened without it.
  {
    const steps = {};
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      if (!shortUrl) throw new Error("no short link from the check above");
      const release = await holdLinks(p);
      await p.goto(shortUrl, { waitUntil: "domcontentloaded" });
      await p.getByText("loading this link…").waitFor({ timeout: 30000 });
      steps.waiting = (await p.locator("#docjson").count()) === 0;
      release();
      await p.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.opened = (await docOf(p)).cohorts["Long notes"]?.notes === notes;
      await p.unrouteAll({ behavior: "ignoreErrors" });
      await p.goto(BASE + "/lab?s=" + "A".repeat(22), { waitUntil: "domcontentloaded" });
      const alert = p.getByRole("alert").filter({ hasText: "This link could not be opened" });
      await alert.waitFor({ timeout: 30000 });
      steps.missing = /no stored link .* on this deployment/.test(await alert.innerText());
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("a stored link being read is said as loading; one the deployment does not hold is said, not opened empty",
      steps.waiting && steps.opened && steps.missing, JSON.stringify(steps));
    await ctx.close();
  }

  // A store that fails keeps the long URL (the page still works) and says why it could not be shortened.
  {
    const steps = {};
    const ctx = await browser.newContext();
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    try {
      await failStore(p);
      await p.goto(longUrl, { waitUntil: "domcontentloaded" });
      const said = p.locator("[data-link-problem]");
      await said.waitFor({ timeout: 60000 });
      steps.said = /too long to reload or share .* the link store is down \(e2e\)/.test((await said.innerText()).replace(/\s+/g, " "));
      steps.kept = new URL(p.url()).searchParams.has("doc");
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("a link that could not be stored stays long, and the page says why", steps.said && steps.kept, JSON.stringify(steps));
    await ctx.close();
  }

  // The portal's comparison page opens from a stored link as from its ?doc=.
  {
    const steps = {};
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      const doc = { dsl: "2.9", study: "msk_chord_2024", views: [], cohorts: {
        "Female e2e": { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] },
        "Male e2e": { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] } } };
      const r = await ctx.request.post(BASE + "/api/links", { data: { params: { doc: encodeUrlJson(doc) } } });
      const { id } = await r.json();
      steps.stored = r.status() === 201 && /^[A-Za-z0-9_-]{22}$/.test(id || "");
      await p.goto(BASE + "/portal/comparison?s=" + id, { waitUntil: "domcontentloaded" });
      await p.getByText("Female e2e").first().waitFor({ timeout: 120000 });
      steps.groups = (await p.getByText("Male e2e").count()) > 0;
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("the comparison page opens from a stored link", steps.stored && steps.groups, JSON.stringify(steps));
    await ctx.close();
  }

  if (!LOGIN) return;

  // Id lists: its owner withdraws one from the Id lists tab — told what uses it — and everyone opening
  // a link that names it is refused with the note; restoring puts it back. The same ids saved again
  // as another list are not affected.
  {
    const steps = {};
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const p = await ctx.newPage();
    const anon = await browser.newContext();
    try {
      await signIn(ctx, "links." + LOGIN);
      const ex = await (await ctx.request.get(BASE + "/api/custom-data/example?study=msk_chord_2024")).json();
      const ids = (ex.patients || []).slice(0, 20);
      const make = async (name) => (await (await ctx.request.post(BASE + "/api/id-sets", { data: { name, level: "patient", studies: ["msk_chord_2024"], ids } })).json()).set;
      const name = "e2e withdraw " + Date.now();
      const set = await make(name), twin = await make(name + " twin");
      const docNaming = (s) => ({ dsl: "2.9", study: "msk_chord_2024", cohorts: { L: { all: [{ kind: "patientList", set: s.id }] } }, views: [] });
      const run = async (s) => anon.request.post(BASE + "/api/analysis", { data: docNaming(s) });
      await ctx.request.post(BASE + "/api/links", { data: { params: { doc: encodeUrlJson(docNaming(set)) } } });
      steps.readable = (await run(set)).ok();

      await p.goto(BASE + "/saved?tab=lists", { waitUntil: "domcontentloaded" });
      const row = p.locator("tr[data-set='" + set.id + "']");
      await row.waitFor({ timeout: 60000 });
      await row.getByRole("button", { name: "Withdraw…" }).click();
      const dlg = p.locator("[data-withdraw-dialog]");
      await dlg.locator("[data-usage]").filter({ hasText: "stored link" }).waitFor({ timeout: 30000 });
      steps.usage = /1 stored link/.test(await dlg.locator("[data-usage]").innerText());
      await dlg.locator("textarea").fill("pilot patients were included (e2e)");
      await dlg.getByRole("button", { name: "Withdraw", exact: true }).click();
      await row.locator("[data-status=withdrawn]").waitFor({ timeout: 30000 });
      steps.listed = /pilot patients were included \(e2e\)/.test(await row.innerText());

      const refused = await run(set);
      steps.refused = refused.status() >= 400 && /withdrawn by its owner .*: pilot patients were included \(e2e\)/.test((await refused.json()).error || "");
      steps.twin = (await run(twin)).ok();

      await row.getByRole("button", { name: "Restore" }).click();
      await row.locator("[data-status='in use']").waitFor({ timeout: 30000 });
      steps.restored = (await run(set)).ok();
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("an owner withdraws a stored id list (told what uses it) and restores it; readers are given the note; its twin is unaffected",
      steps.readable && steps.usage && steps.listed && steps.refused && steps.twin && steps.restored, JSON.stringify(steps));
    await anon.close();
    await ctx.close();
  }
}

module.exports = { links, linkMax, holdLinks, failStore };
