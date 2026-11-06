// Stored links and stored id lists in the browser (docs/LINKS.md): past the limit a page's address
// stops carrying its state and a bar says so; Copy link makes a short ?s=<id> link, which opens
// again — after a reload, in a fresh browser, signed out; an address copied from a page past the
// limit is said; a missing or slow link is said; a failed store is said; a withdrawn list is
// refused with its owner's note; the Id lists tab withdraws and restores.
//
// Everything here can be steered from a test without touching the server:
//   linkMax(ctx, n)    hold the state out of the address past n characters (window.__cbioLinkUrlMax)
//   holdLinks(page)    hold GET /api/links/<id> until the returned release() is called
//   failStore(page)    answer POST /api/links with a 500
// The server side is real: the e2e server runs lib/db.ts's in-memory Postgres, so a link stored by
// one test is there for the next and gone when the server stops.

/** hold the page's state out of its address past `n` characters, in every page of `ctx` */
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
const HELD = /[?&]long=[0-9a-z]+$/;
/** Copy link (in the bar, or the header's), then the link it made, read from the field that shows it:
 *  the bar's is shown in the bar that replaces it, the header's beside the button */
async function copyLinkFrom(page, scope) {
  await scope.getByRole("button", { name: /copy link/i }).first().click();
  const shown = page.locator("[data-link-copied] [data-copied-link], header [data-copied-link]").first();
  await shown.waitFor({ timeout: 60000 });
  return shown.getAttribute("data-copied-link");
}
/** text deflate cannot shrink, so the link it is in really is long */
const noise = (n) => require("node:crypto").randomBytes(n).toString("base64url").slice(0, n);

async function links({ browser, ok, BASE, LOGIN, signIn }) {
  const { encodeUrlJson, decodeUrlJson } = await import("../../lib/url-json.ts");
  const docOf = async (p) => JSON.parse(await p.locator("#docjson").inputValue());
  // a document whose link is long: a cohort's notes change nothing it selects, so nothing is counted differently
  const notes = noise(1500);
  const longDoc = { dsl: "2.9", study: "msk_chord_2024", cohorts: { "Long notes": { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }], notes } }, views: [] };
  const longUrl = BASE + "/lab?tab=analysis&doc=" + encodeUrlJson(longDoc);
  let shortUrl = null;

  // Past the limit the address stops carrying the document: it says long=, a bar says why, and a
  // reload keeps the page. Copy link in the bar makes ?s=<id>, which the address becomes and which
  // opens the same document in a fresh, signed-out browser. The held address, opened there, is said.
  {
    const steps = {};
    const ctx = await browser.newContext();
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    try {
      await p.goto(longUrl, { waitUntil: "domcontentloaded" });
      const bar = p.locator("[data-link-held]");
      await bar.waitFor({ timeout: 60000 });
      const heldUrl = p.url();
      steps.held = HELD.test(heldUrl) && !heldUrl.includes("doc=") && /too long to keep in its address/.test(await bar.innerText());
      // the document editor fills as the page loads the document; wait for it rather than read it early
      await p.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.same = (await docOf(p)).cohorts["Long notes"]?.notes === notes;
      await p.reload({ waitUntil: "domcontentloaded" });
      await p.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.reloaded = (await docOf(p)).cohorts["Long notes"]?.notes === notes && (await bar.count()) === 1;
      shortUrl = await copyLinkFrom(p, bar);
      steps.short = SHORT.test(shortUrl) && !shortUrl.includes("doc=");
      await p.waitForFunction((u) => location.href === u, shortUrl, { timeout: 10000 });
      steps.addressIsLink = (await p.locator("[data-link-held]").count()) === 0 && (await p.locator("[data-link-copied]").count()) === 1;
      const fresh = await browser.newContext();
      const q = await fresh.newPage();
      await q.goto(shortUrl, { waitUntil: "domcontentloaded" });
      await q.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.elsewhere = (await docOf(q)).cohorts["Long notes"]?.notes === notes;
      await q.goto(heldUrl, { waitUntil: "domcontentloaded" });
      const told = q.locator("[data-link-elsewhere]");
      await told.waitFor({ timeout: 30000 });
      steps.heldElsewhere = /copied from a page whose state was too long/.test(await told.innerText());
      await fresh.close();
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("past the limit the address says so with a bar; Copy link makes ?s=<id>, which opens the same document after a reload and in a fresh, signed-out browser",
      steps.held && steps.same && steps.reloaded && steps.short && steps.addressIsLink && steps.elsewhere && steps.heldElsewhere, JSON.stringify(steps));
    await ctx.close();
  }

  // Working on a page past the limit: each edit changes the address's mark (the bar stays, nothing is
  // stored), Back and Forward step through the held edits, and once a link is copied the next edit
  // holds the page again.
  {
    const steps = {};
    const ctx = await browser.newContext();
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    let posts = 0;
    p.on("request", (r) => { if (r.method() === "POST" && /\/api\/links$/.test(r.url())) posts++; });
    try {
      await p.goto(longUrl, { waitUntil: "domcontentloaded" });
      await p.locator("[data-link-held]").waitFor({ timeout: 60000 });
      await p.waitForFunction(() => window.cohortLab && window.cohortLab.call, null, { timeout: 120000 });
      const before = p.url();
      await p.evaluate(() => window.cohortLab.call("analysis_set_details", { title: "held edit (e2e)" }));
      await p.waitForFunction((u) => location.href !== u, before, { timeout: 30000 });
      const edited = p.url();
      steps.marked = HELD.test(edited) && (await p.locator("[data-link-held]").count()) === 1 && posts === 0;
      const titled = async () => (await docOf(p)).title === "held edit (e2e)";
      await p.waitForFunction(() => /held edit \(e2e\)/.test(document.querySelector("#docjson")?.value || ""), null, { timeout: 30000 });
      await p.goBack();
      await p.waitForFunction(() => !/held edit \(e2e\)/.test(document.querySelector("#docjson")?.value || ""), null, { timeout: 30000 });
      steps.back = p.url() === before && (await docOf(p)).cohorts["Long notes"]?.notes === notes;
      await p.goForward();
      await p.waitForFunction(() => /held edit \(e2e\)/.test(document.querySelector("#docjson")?.value || ""), null, { timeout: 30000 });
      steps.forward = p.url() === edited && await titled();
      await copyLinkFrom(p, p.locator("[data-link-held]"));
      steps.copiedOnce = posts === 1;
      await p.evaluate(() => window.cohortLab.call("analysis_set_details", { title: "after the copy (e2e)" }));
      await p.locator("[data-link-held]").waitFor({ timeout: 30000 });
      steps.heldAgain = HELD.test(p.url()) && (await p.locator("[data-link-copied]").count()) === 0 && posts === 1;
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("a page past the limit is edited with nothing stored, Back and Forward step through its held edits, and an edit after Copy link holds it again",
      steps.marked && steps.back && steps.forward && steps.copiedOnce && steps.heldAgain, JSON.stringify(steps));
    await ctx.close();
  }

  // A portal page past the limit is held and says so like the lab, and still draws from what it holds.
  {
    const steps = {};
    const ctx = await browser.newContext();
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    try {
      const doc = { dsl: "2.9", study: "msk_chord_2024", views: [], cohorts: {
        "Female held": { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }], notes },
        "Male held": { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] } } };
      await p.goto(BASE + "/portal/comparison?doc=" + encodeUrlJson(doc), { waitUntil: "domcontentloaded" });
      await p.getByText("Male held").first().waitFor({ timeout: 120000 });
      steps.drawn = true;
      steps.copy = (await p.locator("header [data-copy-link]").count()) === 1;
      // opening the page writes nothing; switching its tab writes its URL, which is past the limit
      const tabs = p.locator("[role=tablist]").first().locator("[role=tab]");
      await tabs.nth(1).click();
      await p.locator("[data-link-held]").waitFor({ timeout: 30000 });
      steps.held = HELD.test(p.url()) && !p.url().includes("doc=");
      steps.stillDrawn = (await p.getByText("Male held").count()) > 0;
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("a portal page past the limit draws from what it holds, holds its state out of the address once it writes it, and offers Copy link",
      steps.drawn && steps.copy && steps.held && steps.stillDrawn, JSON.stringify(steps));
    await ctx.close();
  }

  // Copy link is in the header of every page that keeps its state in its URL, and shortens a link
  // well under the limit too: anything long in it is stored.
  {
    const steps = {};
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      await p.goto(longUrl, { waitUntil: "domcontentloaded" });
      await p.waitForFunction((n) => (document.querySelector("#docjson")?.value || "").includes(n), notes, { timeout: 60000 });
      steps.full = new URL(p.url()).searchParams.has("doc") && (await p.locator("[data-link-held]").count()) === 0;
      const url = await copyLinkFrom(p, p.locator("header"));
      steps.short = SHORT.test(url) && url.length < 200;
      await p.goto(BASE + "/portal/comparison", { waitUntil: "domcontentloaded" });
      await p.locator("header [data-copy-link]").waitFor({ timeout: 60000 });
      steps.portal = true;
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("Copy link is in the header, and shortens a link under the limit that carries a long parameter", steps.full && steps.short && steps.portal, JSON.stringify(steps));
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

  // Copy link whose store fails says why, and leaves the page and its address as they were.
  {
    const steps = {};
    const ctx = await browser.newContext();
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    try {
      await failStore(p);
      await p.goto(longUrl, { waitUntil: "domcontentloaded" });
      const bar = p.locator("[data-link-held]");
      await bar.waitFor({ timeout: 60000 });
      await bar.getByRole("button", { name: /copy link/i }).click();
      const said = bar.locator("[data-copy-link-error]");
      await said.waitFor({ timeout: 30000 });
      steps.said = /could not make a link: the link store is down \(e2e\)/.test(await said.innerText());
      steps.kept = HELD.test(p.url());
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("Copy link that could not store the link says why, and leaves the page as it was", steps.said && steps.kept, JSON.stringify(steps));
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

  // A reader who is not signed in edits a long document holding an inline id list: the list is
  // stored once as an unowned set, so the stored link names it instead of carrying it; storing the
  // same list again answers the same set, and nobody can withdraw it.
  {
    const steps = {};
    const owner = await browser.newContext();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await linkMax(ctx, 400);
    const p = await ctx.newPage();
    try {
      await signIn(owner, "links.unowned." + LOGIN);
      const ex = await (await owner.request.get(BASE + "/api/custom-data/example?study=msk_chord_2024")).json();
      const ids = (ex.patients || []).slice(0, 20);
      const doc = { dsl: "2.9", study: "msk_chord_2024", views: [],
        cohorts: { "Pasted e2e": { all: [{ kind: "patientList", ids: ids.map((x) => "msk_chord_2024:" + x) }], notes: noise(1500) } } };
      const start = { dsl: "2.9", study: "msk_chord_2024", views: [], cohorts: { Female: { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] } } };
      await p.goto(BASE + "/lab?tab=analysis&doc=" + encodeUrlJson(start), { waitUntil: "domcontentloaded" });
      // the button is drawn before the page answers clicks: try until the editor opens
      for (let i = 0; i < 30 && !(await p.locator("dialog[open] #docjson").count()); i++) {
        await p.getByRole("button", { name: /show document json/i }).click({ timeout: 60000 });
        await p.waitForTimeout(1000);
      }
      await p.locator("#docjson").fill(JSON.stringify(doc));
      await p.locator("dialog[open]").getByRole("button", { name: /^run document/i }).click();
      await p.waitForFunction(() => /"set":/.test(document.querySelector("#docjson")?.value || ""), null, { timeout: 60000 });
      const clause = (await docOf(p)).cohorts["Pasted e2e"].all[0];
      steps.named = typeof clause.set === "string" && !clause.ids && clause.n === ids.length;
      // the document editor is a modal dialog: close it, or nothing behind it can be clicked
      await p.keyboard.press("Escape");
      await p.locator("dialog[open]").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
      await p.locator("[data-link-held]").waitFor({ timeout: 60000 });
      const linkId = new URL(await copyLinkFrom(p, p.locator("[data-link-held]"))).searchParams.get("s");
      const stored = await (await ctx.request.get(BASE + "/api/links/" + linkId)).json();
      const storedClause = decodeUrlJson(stored.params.doc).cohorts["Pasted e2e"].all[0];
      steps.linkNamesSet = storedClause.set === clause.set && !storedClause.ids;
      const again = await (await ctx.request.post(BASE + "/api/id-sets", { data: { name: "again", level: "patient", studies: ["msk_chord_2024"], ids } })).json();
      steps.once = again.set?.id === clause.set && again.set?.owner === "";
      const w = await owner.request.put(BASE + "/api/id-sets/" + clause.set + "/withdrawal", { data: { note: "mine now?" } });
      steps.unmanaged = w.status() === 403 && /no owner/.test((await w.json()).error || "");
    } catch (e) { steps.error = String(e.message || e).split("\n")[0].slice(0, 160); }
    ok("a signed-out reader's long document stores its id list once, as an unowned set its stored link names, which nobody can withdraw",
      steps.named && steps.linkNamesSet && steps.once && steps.unmanaged, JSON.stringify(steps));
    await ctx.close();
    await owner.close();
  }

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
