// The portal pages: Explore's View patients, the Results page over a selection.
async function portal({ browser, ok, BASE }) {
  // Explore's "View patients": the Patient page stepping through the explored cohort, as the portal's
  // patient view steps through a study view's selection — the link carries the cohort's definition,
  // and the pager asks the server where the shown patient falls.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const at = async (n) => page.waitForFunction((n) => document.querySelector(".cohort-nav input")?.value === n, n, { timeout: 120000 });
    const of = async () => Number(((await page.locator(".cohort-nav").innerText()).match(/([\d,]+) patients/) || [])[1]?.replace(/,/g, ""));
    try {
      await page.goto(BASE + "/lab?tab=explore", { waitUntil: "domcontentloaded" });
      await page.locator(".study-row:not(.study-head)").first().waitFor({ timeout: 120000 });
      await page.getByLabel("search studies").fill("coadread_tcga_pub");
      await page.getByRole("button", { name: "explore coadread_tcga_pub", exact: true }).click();
      await page.waitForFunction(() => { const b = document.querySelector("button.viewpatients"); return b && !b.disabled; }, null, { timeout: 120000 });
      await page.locator("button.viewpatients").click();
      await page.waitForURL(/\/portal\/patient\?.*patient=/, { timeout: 120000 });
      await at("1");
      const first = new URL(page.url()).searchParams, total = await of();
      await page.getByRole("link", { name: "next patient" }).click();
      await at("2");
      const second = new URL(page.url()).searchParams;
      await page.getByRole("button", { name: "last patient" }).click();
      await at(String(total));
      const last = new URL(page.url()).searchParams;
      ok("explore: View patients opens the cohort's first patient, and steps to the next and the last",
        first.get("cohort") && first.get("study") === "coadread_tcga_pub" && total === 276 && second.get("patient") !== first.get("patient") && last.get("cohort") === first.get("cohort"),
        first.get("patient") + " → " + second.get("patient") + " → " + last.get("patient") + " of " + total);
    } catch (e) {
      ok("explore: View patients opens the cohort's first patient, and steps to the next and the last", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("explore view patients: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The Results page over a selection: Comparison's Altered against the PROFILED unaltered, the rest named; several
  // studies pooled with Explore's filters; cBioPortal's cross-study expression rule; the study cap.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
    const settle = async () => {
      await page.locator(".viewcard").first().waitFor({ timeout: 240000 });
      await page.waitForFunction(() => !document.querySelector(".viewcard[aria-busy]"), null, { timeout: 240000 });
    };
    const tabs = async () => page.locator("[aria-label='results tabs'] [role=tab]").allInnerTexts();
    try {
      await page.goto(BASE + "/portal/results?study=brca_tcga&genes=" + encodeURIComponent("KRAS\nTP53: MUT"), { waitUntil: "domcontentloaded" });
      await settle();
      const num = (re, t) => Number((re.exec(t) || [])[1]?.replace(/,/g, ""));
      // the header's totals come with Explore's facets, after the first tabs
      await page.waitForFunction(() => /\d[\d,]* samples · \d[\d,]* patients/.test(document.querySelector("section[data-tw]")?.textContent || ""), null, { timeout: 240000 });
      const queried = num(/([\d,]+) patients/, await page.locator("section[data-tw]").first().innerText());
      await page.getByRole("tab", { name: "Comparison/Survival" }).click();
      await page.locator(".viewcard svg").first().waitFor({ timeout: 240000 });
      await settle();
      const overlap = (await page.locator(".viewcard").first().innerText()).replace(/\s+/g, " ");
      const g = { Altered: num(/Altered\s*([\d,]+) patients/, overlap), Unaltered: num(/Unaltered\s*([\d,]+) patients/, overlap) };
      ok("results: Comparison's Unaltered is the profiled patients the query misses, so the unprofiled are in neither group",
        g.Altered > 0 && g.Unaltered > 0 && g.Altered + g.Unaltered < queried,
        JSON.stringify(g) + " · queried " + queried);
      // a link that opens on a tab only the whole page has, with a setting for it and one for a view the page lacks:
      // the tab is waited for, never swapped for the first, and only the setting that names no view is reported
      // and asks only for what that tab draws: no other view, and no oncoprint, is requested on the way
      const asked = [];
      const onAsk = (r) => {
        if (r.url().includes("/api/oncoprint")) asked.push("oncoprint");
        else if (r.url().includes("/api/analysis")) try { asked.push(...(JSON.parse(r.postData() || "{}").views || []).map((x) => x.kind)); } catch { asked.push("?"); }
      };
      page.on("request", onAsk);
      await page.goto(BASE + "/portal/results?study=brca_tcga&genes=KRAS%0ATP53&tab=Plots&changes=" +
        enc({ "Plots › Plot": [{ points: [] }], "Gone › Nothing": [{ x: 1 }] }), { waitUntil: "domcontentloaded" });
      const active = new Set();
      for (let i = 0; i < 480 && !(await page.locator(".viewcard svg").count()); i++) {
        active.add(await page.evaluate(() => document.querySelector("[aria-label='results tabs'] [role=tab][data-state=active]")?.textContent || ""));
        await page.waitForTimeout(250);
      }
      await settle();
      active.add(await page.locator("[aria-label='results tabs'] [role=tab][data-state=active]").innerText());
      const linkNote = await page.locator("p.note").first().innerText().catch(() => "");
      const layers = await page.locator(".plot-solo button").allInnerTexts();
      page.off("request", onAsk);
      ok("results: a link to a tab the page lays out last waits for it, and applies its setting by the view's name",
        !active.has("Oncoprint") && active.has("Plots") && /Gone › Nothing/.test(linkNote) && !/Plots › Plot/.test(linkNote) && layers.length === 0 &&
          asked.length > 0 && asked.every((k) => k === "plot"),
        [...active].join(" → ") + " · layers " + JSON.stringify(layers) + " · asked " + JSON.stringify(asked) + " · " + linkNote);
      await page.goto(BASE + "/portal/results?studies=brca_tcga_pan_can_atlas_2018,coadread_tcga_pan_can_atlas_2018&filters=" +
        enc([{ kind: "clinical", attribute: "SEX", values: ["Female"] }]) + "&genes=KRAS", { waitUntil: "domcontentloaded" });
      await settle();
      await page.getByRole("tab", { name: "Plots" }).waitFor({ timeout: 240000 });
      const t2 = await tabs(), s2 = await page.locator("section[data-tw]").first().innerText();
      // what the page leaves out is behind the header's info button
      await page.locator("button.leftout").click();
      const leftOut = await page.getByRole("dialog").innerText();
      await page.keyboard.press("Escape");
      ok("results: several studies pooled under Explore's filters; co-expression is for one study, and says so",
        /2 studies/.test(s2) && /patients after filters/.test(s2) && /SEX/.test(s2) && t2.includes("Plots") && !t2.includes("Co-expression") &&
          !/one study at a time/.test(s2) && /Co-expression \(one study at a time\)/.test(leftOut),
        t2.join(", ") + " · " + s2.replace(/\s+/g, " ").slice(0, 160) + " · " + leftOut.replace(/\s+/g, " "));
      await page.goto(BASE + "/portal/results?studies=coadread_tcga_pub,luad_tcga_pan_can_atlas_2018&genes=KRAS", { waitUntil: "domcontentloaded" });
      await settle();
      await page.getByRole("tab", { name: "Plots" }).click();
      await page.locator(".viewcard svg").first().waitFor({ timeout: 120000 });
      // the plot's axis sidebar: the vertical axis falls back to a clinical attribute, and no expression is on offer
      const bar = (await page.locator(".viewcard").first().innerText()).replace(/\s+/g, " ");
      await page.locator("button.leftout").click();
      const said = await page.getByRole("dialog").innerText();
      await page.keyboard.press("Escape");
      ok("results: expression is not compared across studies outside the PanCancer Atlas (cBioPortal's rule)",
        /Vertical axis Data Clinical attribute/.test(bar) && !/mrna|expression/i.test(bar) && /cannot be compared across the selected studies/.test(said), bar.slice(0, 200));
      await page.goto(BASE + "/portal/results?studies=" + Array.from({ length: 51 }, (_, i) => "s" + i).join(",") + "&genes=KRAS", { waitUntil: "domcontentloaded" });
      const capped = await page.locator(".error").first().innerText({ timeout: 60000 }).catch(() => "");
      ok("results: past the study cap the query is refused, naming the limit", /at most 50 studies; 51 are selected/.test(capped), capped);
    } catch (e) {
      ok("results: the selection, profiled groups and cross-study rule", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("results selection: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { portal };
