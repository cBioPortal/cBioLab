// The lollipop's alteration grid.
async function lollipop({ browser, ok, BASE }) {
  // The lollipop's alteration grid (app/_lollipop/HotspotsBody.tsx): a control beside the plot, not part of
  // the figure. Hiding a class redraws the plot in the browser; on the Results page the mutation table follows
  // through its Alteration filter, and the selection is the document's, so it survives a reload.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/portal/results?study=coadread_tcga_pub&genes=TP53,APC", { waitUntil: "domcontentloaded" });
      await page.locator("button, [role=tab]").filter({ hasText: /^Mutations$/ }).first().click({ timeout: 120000 });
      await page.locator(".lp-grid").first().waitFor({ timeout: 240000 });
      await page.locator(".dt-title").first().waitFor({ timeout: 240000 });
      const settle = async () => {
        await page.waitForTimeout(300);
        await page.waitForFunction(() => !document.querySelector(".dt-wait") && !document.querySelector(".dt-bar .waiting"), null, { timeout: 120000 });
        await page.waitForTimeout(200);
      };
      await settle();
      const heads = () => page.locator(".lp-plot circle[r='2.8']").count();
      const tableCount = async () => { const m = /(?:([\d,]+) of )?([\d,]+) TP53 mutations/.exec(await page.locator(".dt-title").innerText()); return m ? { kept: Number((m[1] || m[2]).replace(/,/g, "")), all: Number(m[2].replace(/,/g, "")) } : null; };
      const svg = await page.locator(".lp-plot svg").first().innerHTML();
      ok("lollipop: the figure is the plot alone; the summary and the grid are controls beside it",
        !/Somatic Mutation Frequency|>Driver<|>VUS</.test(svg) && await page.locator(".lp-summary").count() > 0 && await page.locator(".lp-grid .lp-badge").count() >= 10);
      const h0 = await heads(), t0 = await tableCount();
      await page.locator(".lp-rowname", { hasText: "Missense" }).first().click();
      await page.waitForTimeout(300);
      const h1 = await heads(), banner = await page.locator(".lp-banner").innerText().catch(() => "");
      ok("lollipop: hiding Missense redraws the plot at once, and says what it shows", h1 > 0 && h1 < h0 && /Showing [\d,]+ of [\d,]+ mutations/.test(banner.replace(/\s+/g, " ")), h0 + " heads -> " + h1 + "; " + banner.replace(/\s+/g, " "));
      await settle();
      const t1 = await tableCount(), chip = await page.locator(".dt-chips").innerText().catch(() => "");
      ok("lollipop: on the Results page the table follows, through its Alteration filter", !!t1 && t1.kept < t0.kept && t1.all === t0.all && /Alteration/.test(chip), JSON.stringify(t0) + " -> " + JSON.stringify(t1));
      // the link carries how the views differ from the page's defaults, not the page's whole document
      const linkQ = new URL(page.url()).searchParams, linkChanges = linkQ.get("changes") || "";
      ok("Results page: a changed setting travels as ?changes= alone", !linkQ.has("doc") && /^1\./.test(linkChanges) && linkChanges.length < 400,
        "doc: " + linkQ.has("doc") + ", changes: " + linkChanges.length + " chars");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".lp-grid").first().waitFor({ timeout: 240000 });
      await settle();
      ok("lollipop: the selection survives a reload", await heads() === h1 && /Showing/.test(await page.locator(".lp-banner").innerText().catch(() => "")));
      await page.getByRole("button", { name: "remove the filter on alteration" }).click();
      await settle();
      ok("lollipop: clearing the table's Alteration filter clears the grid", await heads() === h0 && await page.locator(".lp-banner").count() === 0 && (await tableCount()).kept === t0.kept);
    } catch (e) {
      ok("lollipop: the alteration grid", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("lollipop: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { lollipop };
