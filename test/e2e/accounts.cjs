// Accounts: the build's commit, saved work refused signed out, two people's saved work kept apart, sharing through a group.
async function accounts({ browser, ok, LOGIN, signIn, BASE }) {
  {
    const anon = await browser.newContext();
    const r = await anon.request.get(BASE + "/api/artifacts?kind=cohort");
    ok("saved cohorts are refused without a sign-in", r.status() === 403 || r.status() === 404, "HTTP " + r.status());
    // a built server knows its commit (lib/build-info.ts), says it at /api/version, and every page's footer agrees
    const v = await (await anon.request.get(BASE + "/api/version")).json();
    ok("/api/version names the commit this build was made from", /^[0-9a-f]{40}(\+dirty)?$/.test(v.commit || "") && /\/commit\/[0-9a-f]{40}$/.test(v.url || ""), JSON.stringify(v));
    const vp = await anon.newPage();
    await vp.goto(BASE + "/lab", { waitUntil: "domcontentloaded" });
    const stamp = await vp.locator("footer.build-stamp a").first();
    const [text, href] = [await stamp.textContent(), await stamp.getAttribute("href")];
    ok("the page footer shows the same commit, linked", text === v.label && href === v.url, text + " → " + href);
    await anon.close();
  }

  // Two people: what one saves, the other can neither list, open, change nor delete.
  if (LOGIN) {
    const a = await browser.newContext(), b = await browser.newContext();
    const steps = {};
    try {
      await signIn(a, "owner." + LOGIN); await signIn(b, "other." + LOGIN);
      const made = (await (await a.request.post(BASE + "/api/artifacts", { data: { kind: "cohort", name: "e2e private", definition: { all: [] } } })).json()).artifact;
      steps.listed = ((await (await b.request.get(BASE + "/api/artifacts?kind=cohort")).json()).artifacts || []).some((x) => x.id === made.id);
      steps.open = (await b.request.get(BASE + "/api/artifacts/" + made.id)).status();
      steps.patch = (await b.request.patch(BASE + "/api/artifacts/" + made.id, { data: { name: "taken" } })).status();
      steps.del = (await b.request.delete(BASE + "/api/artifacts/" + made.id)).status();
      steps.ownerStill = (await (await a.request.get(BASE + "/api/artifacts/" + made.id)).json()).artifact?.name;
      await a.request.delete(BASE + "/api/artifacts/" + made.id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("one person's saved cohort is invisible and untouchable to another",
      steps.listed === false && steps.open === 404 && steps.patch === 404 && steps.del === 404 && steps.ownerStill === "e2e private", JSON.stringify(steps));
    await a.close(); await b.close();
  }

  // Sharing through the page: an owner makes a group in their saved work (Groups), finds someone by
  // the start of their email and adds them, shares a cohort with it and an analysis the group may
  // edit; the member sees both under "Shared with you", opens the analysis (a link into the lab) and
  // saves back to it, after which the owner's save from the version they had is refused rather than
  // overwriting.
  if (LOGIN) {
    const T = Date.now().toString(36), A = "ada." + T + "." + LOGIN, B = "bob." + T + "." + LOGIN;
    const ca = await browser.newContext({ viewport: { width: 1400, height: 900 } }), cb = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const steps = {}, errs = [];
    try {
      await signIn(ca, A); await signIn(cb, B);
      const a = await ca.newPage();
      a.on("pageerror", (e) => errs.push(e.message));
      await a.goto(BASE + "/groups", { waitUntil: "domcontentloaded" });   // the old link: the manager's Groups tab
      await a.locator("input[aria-label='new group name']").fill("e2e lab " + T);
      await a.locator("button", { hasText: "Make group" }).click();
      await a.locator(".groupcard h2", { hasText: "e2e lab " + T }).waitFor({ timeout: 120000 });
      await a.locator("input[aria-label='person to add']").fill("bob." + T);
      await a.locator("[role=listbox] [role=option]", { hasText: B }).click({ timeout: 30000 });
      steps.found = await a.locator("input[aria-label='person to add']").inputValue();
      await a.locator(".groupcard button", { hasText: "Add" }).click();
      steps.member = await a.locator(".membertable td", { hasText: B }).waitFor({ timeout: 30000 }).then(() => true, () => false);
      const mk = async (kind, name, definition) => (await (await ca.request.post(BASE + "/api/artifacts", { data: { kind, name, definition } })).json()).artifact;
      await mk("cohort", "e2e shared cohort " + T, { all: [{ kind: "oql", q: "KRAS: MUT" }] });
      const ws = await mk("workspace", "e2e shared analysis " + T, { study: "msk_chord_2024", title: "e2e shared analysis " + T,
        cohorts: { "KRAS mutant": { all: [{ kind: "oql", q: "KRAS: MUT" }] } }, views: [] });
      await a.goto(BASE + "/saved?tab=cohorts", { waitUntil: "domcontentloaded" });
      const dlg = a.locator("[role=dialog].sharedialog");
      const shareFrom = async (row, edit) => {
        await row.locator("button.sharebadge").click({ timeout: 120000 });
        await dlg.locator("label", { hasText: "A group" }).click();
        await dlg.locator("[role=combobox][data-tip=group]").click();
        await a.locator("[role=option]").first().click();
        if (edit) await dlg.locator("label", { hasText: "can edit it too" }).click();
        await dlg.locator("button[type=submit]").click();
        return row.locator("button.sharebadge", { hasText: "shared:" }).innerText({ timeout: 30000 }).catch(() => "");
      };
      steps.cohort = await shareFrom(a.locator(".listrow", { hasText: "e2e shared cohort " + T }), false);
      await a.getByRole("tab", { name: "Analyses" }).click();
      steps.analysis = await shareFrom(a.locator(".listrow", { hasText: "e2e shared analysis " + T }), true);
      const b = await cb.newPage();
      b.on("pageerror", (e) => errs.push(e.message));
      await b.goto(BASE + "/saved?tab=cohorts", { waitUntil: "domcontentloaded" });
      steps.bobSees = (await b.locator(".listrow", { hasText: "e2e shared cohort " + T }).innerText({ timeout: 120000 }).catch(() => "")).includes("from " + A);
      await b.getByRole("tab", { name: "Analyses" }).click();
      await b.locator(".listrow", { hasText: "e2e shared analysis " + T }).locator("button", { hasText: "open" }).click();
      await b.locator("button[data-tip*='” — ']").first().click({ timeout: 120000 });
      await b.locator("[role=dialog].wsdialog button", { hasText: "Save to theirs" }).click();
      for (let i = 0; i < 40 && (await (await ca.request.get(BASE + "/api/artifacts/" + ws.id)).json()).artifact.version < 2; i++) await b.waitForTimeout(250);
      steps.savedBack = (await (await ca.request.get(BASE + "/api/artifacts/" + ws.id)).json()).artifact.version;
      steps.stale = (await ca.request.patch(BASE + "/api/artifacts/" + ws.id, { data: { name: "x", definition: { views: [] }, version: 1 } })).status();
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("sharing from the page: a group, a shared cohort and an editable analysis, saved back by the member, a stale save refused",
      steps.found === B && steps.member && /^shared: “e2e lab/.test(steps.cohort) && /who can edit$/.test(steps.analysis) && steps.bobSees &&
      steps.savedBack === 2 && steps.stale === 409 && !errs.length, JSON.stringify({ ...steps, errs }));
    await ca.close(); await cb.close();
  }
}

module.exports = { accounts };
