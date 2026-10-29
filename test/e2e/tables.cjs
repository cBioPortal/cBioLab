// Table views (app/_table/DataTable.tsx on lib/table-query.ts).
async function tables({ browser, ok, BASE }) {
  // Table views (app/_table/DataTable.tsx on lib/table-query.ts): search, a column's value
  // filter, a header sort and the CSV download, on the Results page's mutation table. Each one
  // re-runs the view in the database, so a check is a count the server agreed to, not a DOM trick.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/portal/results?study=coadread_tcga_pub&genes=KRAS,NRAS,BRAF", { waitUntil: "domcontentloaded" });
      await page.locator("button, [role=tab]").filter({ hasText: /^Mutations$/ }).first().click({ timeout: 120000 });
      const title = page.locator(".dt-title").first();
      await title.waitFor({ timeout: 240000 });
      // a change re-runs the view: the table covers its rows until the answer lands (its controls stay enabled)
      const settle = async () => {
        await page.waitForTimeout(300);
        await page.waitForFunction(() => !document.querySelector(".dt-wait") && !document.querySelector(".dt-bar .waiting"), null, { timeout: 120000 });
        await page.waitForTimeout(200);
      };
      const count = async () => { const m = /(?:([\d,]+) of )?([\d,]+) KRAS mutations/.exec(await title.innerText()); return m ? { kept: Number((m[1] || m[2]).replace(/,/g, "")), all: Number(m[2].replace(/,/g, "")) } : null; };
      const all = await count();
      ok("table: the mutation table lists KRAS's mutations", !!all && all.all > 50, JSON.stringify(all));
      await page.locator(".dt-search input").fill("G13");
      await page.locator(".dt-search input").press("Enter");
      await settle();
      const searched = await count();
      ok("table: search keeps only matching rows", !!searched && searched.kept > 0 && searched.kept < all.all && searched.all === all.all, JSON.stringify(searched));
      await page.getByRole("button", { name: "clear search" }).click();
      await settle();
      // waiting states, checked by holding the request (docs/UI.md, "Verify waiting states by holding the request")
      {
        let release, open = false;
        const gate = new Promise((r) => (release = r)); gate.then(() => (open = true));
        await page.route("**/api/analysis**", async (route) => { if (!open) await gate; try { await route.continue(); } catch {} });
        await page.locator(".dt-search input").fill("G12"); await page.locator(".dt-search input").press("Enter");
        await page.waitForTimeout(800);
        const card = page.locator(".viewcard", { has: page.locator(".dt") });
        const w = { cover: await page.locator(".dt-wait").isVisible().catch(() => false), search: await page.locator(".dt-search input").isEnabled(),
          sort: await page.locator(".dt-sort").first().isEnabled(), cardCover: await card.locator(".view-updating").count() };
        release(); await page.unroute("**/api/analysis**");
        ok("table: while a query change runs, its rows are covered and its controls stay usable", w.cover && w.search && w.sort && w.cardCover === 0, JSON.stringify(w));
        await page.waitForFunction(() => !document.querySelector(".dt-wait"), null, { timeout: 120000 });
        await page.getByRole("button", { name: "clear search" }).click();
        await settle();
        await page.waitForFunction(() => !document.querySelector(".dt-wait"), null, { timeout: 120000 });
      }
      {
        let release, open = false;
        const gate = new Promise((r) => (release = r)); gate.then(() => (open = true));
        await page.route("**/api/view-page", async (route) => { if (!open && /"values"/.test(route.request().postData() || "")) await gate; try { await route.continue(); } catch {} });
        await page.getByRole("button", { name: "filter Mutation Type" }).click();
        await page.waitForTimeout(600);
        const w = { loader: await page.locator(".dt-pop .dt-loading .waiting").isVisible().catch(() => false), condition: await page.locator(".dt-pop [role=combobox]").isEnabled().catch(() => false) };
        release(); await page.unroute("**/api/view-page");
        await page.locator(".dt-values label").first().waitFor({ timeout: 60000 });
        ok("table: a filter whose values are loading shows a loader, not an empty list", w.loader && w.condition, JSON.stringify(w));
        await page.keyboard.press("Escape");
      }
      await page.getByRole("button", { name: "filter Protein Change" }).click();
      await page.locator(".dt-values label").first().waitFor({ timeout: 60000 });
      const top = await page.locator(".dt-values label").first().innerText();
      const [value, n] = top.trim().split(/\s+/);
      await page.locator(".dt-pop").getByRole("button", { name: "none" }).click();
      await page.locator(".dt-values label").first().locator("[role=checkbox]").check();
      await page.locator(".dt-pop").getByRole("button", { name: "apply" }).click();
      await settle();
      const picked = await count();
      ok("table: a value filter keeps exactly that value's rows", !!picked && picked.kept === Number(n), value + " listed " + n + ", table kept " + JSON.stringify(picked));
      await page.locator(".dt-sort", { hasText: "# Mut in Sample" }).click();
      await settle();
      const nums = (await page.locator(".dt-table tbody tr td:last-child").allInnerTexts()).map((x) => Number(x.replace(/,/g, ""))).filter((x) => !Number.isNaN(x));
      ok("table: a header click sorts the whole table, highest first", nums.length > 2 && nums.every((x, i) => i === 0 || nums[i - 1] >= x), nums.slice(0, 5).join(" "));
      // the download: every kept row, every column, as CSV, from the same document
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }).catch(() => null), page.locator("form[action='/api/table'] button").first().click()]);
      const csv = dl ? require("fs").readFileSync(await dl.path(), "utf8") : "";
      const lines = csv.trim().split(/\r?\n/);
      ok("table: the CSV holds every kept row with every column", lines[0].startsWith("cohort,study,sample,cancerType,proteinChange") && lines.length - 1 === picked.kept,
        (dl ? dl.suggestedFilename() : "no download") + " · " + (lines.length - 1) + " rows, header " + lines[0].slice(0, 60));
    } catch (e) {
      ok("table: the mutation table's controls", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("table: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { tables };
