// The homepage: choosing studies, its loading state, a study row's query icon.
async function homepage({ browser, ok, BASE }) {
  // The homepage, as cBioPortal's: choose studies (cancer types, filters, select all), then explore
  // them or query them by gene in a modal whose Submit opens the Results page; a row's icons act on
  // that study alone. On the Results page, "Modify query" opens the flow in a dialog, without Explore,
  // whose gene query starts from the page's genes, and the pencil by the genes opens that query directly.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const name = "the homepage: choose studies, then explore them or query them by gene";
    try {
      const res = await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      const landed = new URL(page.url()).pathname;     // the homepage itself, no longer a redirect to /lab
      await page.locator(".study-row:not(.study-head)").first().waitFor({ timeout: 120000 });
      const query = page.locator("button.querybygene");
      const empty = { disabled: await query.isDisabled(), why: await query.getAttribute("data-tip") };
      // the list's own count of matches ("84 of 565"): it draws at most 200 rows, so counting rows would cap there
      const rows = async () => Number((/([\d,]+) of [\d,]+/.exec(await page.locator("section[aria-label='choose studies']").innerText()) || [])[1]?.replace(/,/g, ""));
      const all = await rows();
      await page.locator("nav[aria-label='cancer types'] button").nth(1).click();
      const byType = await rows();
      await page.locator("nav[aria-label='cancer types'] button").first().click();
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("menuitemcheckbox", { name: "mRNA" }).click();
      await page.keyboard.press("Escape");
      const byData = await rows();
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("menuitemcheckbox", { name: "mRNA" }).click();
      await page.keyboard.press("Escape");
      await page.getByLabel("search studies").fill("coadread_tcga_pub");
      await page.getByRole("checkbox", { name: /^Select all/ }).click();
      const picked = await page.locator("label.study-row.sel").count();
      const explore = await page.locator("a", { hasText: "Explore selected studies" }).getAttribute("href");
      // a row's icon asks for that study alone, and does not tick it
      await page.getByLabel("search studies").fill("brca_tcga");
      await page.getByRole("button", { name: "query genes in brca_tcga", exact: true }).click();
      const dlg = page.locator("[role=dialog].gene-query-dialog");
      const rowTitle = await dlg.getByRole("heading").first().innerText();
      const rowTicked = await page.locator("label.study-row.sel", { hasText: "Firehose Legacy" }).count();
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached" });
      await query.click();
      const title = await dlg.getByRole("heading").first().innerText();
      await dlg.locator("textarea").fill("KRAS: MUT\nBRAF");
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Submit query"); return b && !b.disabled; }, null, { timeout: 60000 });
      await dlg.getByRole("button", { name: "Submit query" }).click();
      await page.waitForURL(/\/portal\/results\?/, { timeout: 60000 });
      const q = new URL(page.url()).searchParams;
      await page.waitForFunction(() => document.querySelector(".viewcard") && !document.querySelector(".viewcard[aria-busy]"), null, { timeout: 240000 });
      await page.getByRole("button", { name: "Modify query" }).click();
      const modify = page.locator("[role=dialog].modifyquerydialog");
      await modify.locator("button.querybygene").click();
      const again = await dlg.locator("textarea").inputValue();
      const modifyExplore = await modify.locator(".exploreselected").count();
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await modify.waitFor({ state: "detached" });
      await page.locator("button.editgenes").click();
      const pencilGenes = await dlg.locator("textarea").inputValue(), pencilTitle = await dlg.getByRole("heading").first().innerText();
      ok(name, res.status() === 200 && landed === "/" &&
        empty.disabled && /select at least one study/.test(empty.why || "") && byType < all && byData < all && picked >= 1 &&
        /^\/lab\?tab=explore&study=/.test(explore || "") && /^Query genes in /.test(rowTitle) && rowTicked === 0 &&
        title === "Select genes to query:" && q.get("study") === "coadread_tcga_pub" && q.get("genes") === "KRAS: MUT\nBRAF" && again === "KRAS: MUT\nBRAF" &&
        modifyExplore === 0 && pencilGenes === "KRAS: MUT\nBRAF" && pencilTitle === "Edit genes",
        JSON.stringify({ status: res.status(), landed, empty, rows: [all, byType, byData], picked, explore, rowTitle, rowTicked, title, results: [q.get("study"), q.get("genes")], again, modifyExplore, pencilGenes, pencilTitle }));
    } catch (e) {
      ok(name, false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("homepage: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The homepage while its study list loads, checked by holding the request: a skeleton shaped like
  // the chooser, never "0 studies"; and a failed list says so and asks again.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const name = "homepage: a skeleton while the study list loads, and a failed list offers to try again";
    try {
      let release; const gate = new Promise((r) => (release = r));
      await page.route("**/api/studies", async (route) => { await gate; try { await route.continue(); } catch {} });
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.locator("[aria-label='loading the study list']").waitFor({ timeout: 60000 });
      await page.waitForTimeout(500);
      const held = { zero: /\b0 studies\b/.test(await page.locator("main").innerText()), rows: await page.locator(".study-row").count(),
        query: await page.locator("button.querybygene").isDisabled() };
      release(); await page.unroute("**/api/studies");
      await page.locator(".study-row:not(.study-head)").first().waitFor({ timeout: 120000 });
      const gone = await page.locator("[aria-label='loading the study list']").count();
      await page.route("**/api/studies", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "warehouse unreachable" }) }));
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      const failed = await page.locator("[role=alert][data-tw]").innerText({ timeout: 120000 });
      await page.unroute("**/api/studies");
      await page.getByRole("button", { name: "try again" }).click();
      await page.locator(".study-row:not(.study-head)").first().waitFor({ timeout: 120000 });
      ok(name, !held.zero && held.rows === 0 && held.query && gone === 0 && /could not be loaded: warehouse unreachable/.test(failed),
        JSON.stringify({ held, gone, failed: failed.replace(/\s+/g, " ").slice(0, 80) }));
    } catch (e) {
      ok(name, false, String(e.message).split("\n")[0].slice(0, 200));
    }
    await ctx.close();
  }

  // From the study list to a gene query's results: a study row's query icon opens the gene query
  // dialog for that study, and its Submit opens the Results page with the study and the query.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/lab?tab=explore", { waitUntil: "domcontentloaded" });
      await page.locator(".study-row:not(.study-head)").first().waitFor({ timeout: 120000 });
      const header = page.locator("button.querygenes");
      const none = { disabled: await header.isDisabled(), why: await header.getAttribute("data-tip") };
      await page.getByLabel("search studies").fill("coadread_tcga_pub");
      await page.getByRole("button", { name: "query genes in coadread_tcga_pub", exact: true }).click();
      const dlg = page.locator("[role=dialog].gene-query-dialog");
      await dlg.locator("textarea").fill("KRAS: MUT\nBRAF");
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Submit query"); return b && !b.disabled; }, null, { timeout: 60000 });
      await dlg.getByRole("button", { name: "Submit query" }).click();
      await page.waitForURL(/\/portal\/results\?/, { timeout: 60000 });
      const q = new URL(page.url()).searchParams;
      await page.locator("[role=tab]").filter({ hasText: /^Oncoprint$/ }).first().waitFor({ timeout: 120000 });
      ok("study list: a study's query icon opens the gene dialog, and Submit opens its Results page",
        none.disabled && /select a study/.test(none.why || "") && q.get("study") === "coadread_tcga_pub" && q.get("genes") === "KRAS: MUT\nBRAF",
        "header with no study: " + JSON.stringify(none) + " · results " + q.get("study") + " / " + JSON.stringify(q.get("genes")));
    } catch (e) {
      ok("study list: a study's query icon opens the gene dialog, and Submit opens its Results page", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("study list query: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { homepage };
