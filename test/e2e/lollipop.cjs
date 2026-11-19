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
      // as on the portal's table, a sample id is a link to that sample's page, opened in a new tab
      const sampleLink = await page.locator(".dt-table tbody a.mono").first().evaluate(a => ({ text: a.textContent, href: a.getAttribute("href"), target: a.target }));
      ok("mutation table: a sample id links to its sample page, in a new tab",
        sampleLink.href === "/portal/patient?study=coadread_tcga_pub&sample=" + encodeURIComponent(sampleLink.text) && sampleLink.target === "_blank", JSON.stringify(sampleLink));
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

      // Clicking stems (app/_lollipop/use-stem-clicks.ts): a click selects one codon, shift-click adds
      // another, and the table follows through its Protein Position filter; a click on the plot away
      // from any stem clears it, as on the portal's mutation mapper.
      const stems = await page.locator(".lp-plot g[data-codon]").evaluateAll((gs) => gs.map((g) => ({
        codon: Number(g.getAttribute("data-codon")), n: Number(/^([\d,]+) mutat/.exec(g.querySelector("title").textContent)[1].replace(/,/g, "")) })));
      const [a, b] = [...stems].sort((x, y) => y.n - x.n);
      const clickStem = async (codon, shift) => {
        const box = await page.locator(`.lp-plot g[data-codon="${codon}"] circle`).first().boundingBox();
        if (shift) await page.keyboard.down("Shift");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        if (shift) await page.keyboard.up("Shift");
        await settle();
      };
      const selected = () => page.locator(".lp-plot g[data-selected] circle[r='5']").count();
      await clickStem(a.codon, false);
      const s1 = await tableCount();
      ok("lollipop: clicking a stem selects it and filters the table to that codon", await selected() === 1 && s1.kept === a.n && /Protein Position/.test(await page.locator(".dt-chips").innerText().catch(() => "")),
        "codon " + a.codon + " (" + a.n + "): " + JSON.stringify(s1));
      await clickStem(b.codon, true);
      const s2 = await tableCount();
      ok("lollipop: shift-click adds a second stem to the selection", await selected() === 2 && s2.kept === a.n + b.n, "codons " + a.codon + "+" + b.codon + ": " + JSON.stringify(s2));
      // the figure: the svg that draws the stems (the plot area also holds icons, which are svgs too)
      const figure = page.locator(".lp-plot svg:has(g[data-codon])").first();
      await figure.scrollIntoViewIfNeeded();
      const plot = await figure.boundingBox();
      const away = { x: plot.x + plot.width - 30, y: plot.y + 40 };
      const under = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? e.tagName.toLowerCase() + "." + (e.getAttribute("class") || "") + " in svg: " + !!e.closest("svg") : "none"; }, away);
      await page.mouse.click(away.x, away.y);
      await settle();
      const s3 = await selected(), t3 = await tableCount();
      ok("lollipop: a click on the plot away from any stem clears the selection", s3 === 0 && t3.kept === t0.kept,
        "selected " + s3 + ", table " + JSON.stringify(t3) + " (all " + t0.kept + "), under the click: " + under + ", plot " + JSON.stringify(plot));
    } catch (e) {
      ok("lollipop: the alteration grid", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("lollipop: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The Somatic / Germline badges (MUT-HD-3, MUT-FM-2; spec E1): with germline mutations in the gene the
  // two rates are buttons that filter the table on its status column, as legacy's MutationStatusBadgeSelector.
  // cbioportal.org's API gives ov_tcga_pub 37 BRCA1 mutations, 26 Germline and 11 Somatic. The rates are
  // computed before any of the tab's filters, so their text never changes with the badges.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/portal/results?study=ov_tcga_pub&genes=BRCA1&tab=Mutations", { waitUntil: "domcontentloaded" });
      await page.locator(".lp-status").first().waitFor({ timeout: 240000 });
      await page.locator(".dt-title").first().waitFor({ timeout: 240000 });
      const settle = async () => {
        await page.waitForTimeout(300);
        await page.waitForFunction(() => !document.querySelector(".dt-wait") && !document.querySelector(".dt-bar .waiting"), null, { timeout: 120000 });
        await page.waitForTimeout(200);
      };
      await settle();
      const title = async () => (await page.locator(".dt-title").first().innerText()).replace(/\s+/g, " ");
      const badge = (name) => page.locator(".lp-status").filter({ hasText: name }).first();
      const rates = () => page.locator(".lp-status").evaluateAll((bs) => bs.map((b) => b.textContent.replace(/\s+/g, " ").trim()));
      const pressed = () => page.locator(".lp-status").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-pressed")).join(","));
      const r0 = await rates();
      ok("E1 badges: two .lp-status buttons, Somatic and Germline, both pressed",
        r0.length === 2 && /Somatic/.test(r0[0]) && /Germline/.test(r0[1]) && await pressed() === "true,true", JSON.stringify(r0) + " " + await pressed());
      const steps = [
        ["Somatic off: the table keeps the 26 germline mutations", "Somatic", /^26 of 37 BRCA1 mutations/, "false,true"],
        ["Germline off too: no mutation kept", "Germline", /^0 of 37 BRCA1 mutations/, "false,false"],
        ["Somatic on: the 11 somatic mutations", "Somatic", /^11 of 37 BRCA1 mutations/, "true,false"],
        ["both on: every mutation, no filter", "Germline", /^37 BRCA1 mutations/, "true,true"],
      ];
      for (const [label, name, want, press] of steps) {
        await badge(name).click();
        await settle();
        const t = await title(), p = await pressed(), r = await rates();
        ok("E1 badges: " + label + ", the rates' text unchanged", want.test(t) && p === press && JSON.stringify(r) === JSON.stringify(r0),
          JSON.stringify(t) + " pressed " + p + " rates " + JSON.stringify(r));
      }
    } catch (e) {
      ok("E1 badges: the Somatic / Germline badges", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("E1 badges: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { lollipop };
