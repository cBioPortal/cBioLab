// Generic assays as plot axes, oncoprint heatmap tracks and Explore charts.
async function assays({ browser, ok, BASE }) {
  // Generic assays (lib/generic-assay.ts): a plot axis reads one entity of a profile, found by search;
  // the oncoprint's Tracks menu adds a profile's entities as heatmap rows; Explore charts an entity and
  // a click on it is a genericAssay clause.
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const STUDY = "brca_tcga_pan_can_atlas_2018";
    const enc = (d) => Buffer.from(JSON.stringify(d)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const pick = async (field, q, option) => {
      await page.getByRole("button", { name: field }).click();
      await page.getByLabel("search entities").fill(q);
      await page.waitForSelector("[aria-label=entities][aria-busy=false]", { timeout: 30000 });
      await page.getByRole("option", { name: option }).first().click();
    };
    const docNow = async () => JSON.parse(await page.locator("#docjson").inputValue());
    try {
      await page.goto(BASE + "/lab?tab=analysis&doc=" + enc({ study: STUDY, cohorts: { all: { all: [] } }, views: [{ kind: "plot", cohorts: ["all"],
        x: { source: "profile", profile: "armlevel_cna", entity: "1p_status" }, y: { source: "profile", profile: "rna_seq_v2_mrna_median_Zscores", gene: "MYC" } }] }), { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "x entity" }).waitFor({ timeout: 120000 });
      await pick("x entity", "8q", /^8q/);
      await page.waitForFunction(() => /8q: Putative arm-level/.test(document.body.innerText), null, { timeout: 120000 });
      const x = (await docNow()).views[0].x;
      ok("generic assays: a plot axis's entity is found by search, and the box is drawn by its values", x.entity === "8q_status" && /Gain \(\d+\)/.test(await page.locator("body").innerText()), JSON.stringify(x));

      await page.goto(BASE + "/lab?tab=analysis&doc=" + enc({ study: STUDY, cohorts: { all: { all: [] } }, views: [{ kind: "oncoprint", cohorts: ["all"], genes: ["TP53"] }] }), { waitUntil: "domcontentloaded" });
      await page.locator("canvas").first().waitFor({ timeout: 120000 });
      await page.getByRole("button", { name: /tracks/ }).first().click();
      await page.getByRole("tab", { name: /Heatmap/ }).click();
      await page.getByText("Genetic Ancestry (generic assay)").click();
      await page.waitForFunction(() => /"entities"/.test(document.querySelector("#docjson")?.value || ""), null, { timeout: 60000 });
      await pick("genetic_ancestry entity", "EUR", /EUR/);
      await page.waitForFunction(() => /"EUR"/.test(document.querySelector("#docjson")?.value || ""), null, { timeout: 60000 });
      await page.keyboard.press("Escape");
      const hm = (await docNow()).views[0].heatmap;
      ok("generic assays: the oncoprint's Tracks menu adds a profile's entities as heatmap rows", hm.length === 1 && JSON.stringify(hm[0].entities) === JSON.stringify(["AFR", "EUR"]), JSON.stringify(hm));

      await page.goto(BASE + "/lab?tab=explore&study=" + STUDY, { waitUntil: "domcontentloaded" });
      await page.locator(".facettitle").first().waitFor({ timeout: 120000 });   // the dialog lists what Explore's answer holds
      await page.getByRole("button", { name: /add chart/i }).first().click();
      await page.getByRole("tab", { name: "Generic assays" }).click();
      await page.locator(".addchart [role=combobox]").first().click();
      await page.getByRole("option", { name: /arm-level/i }).click();
      await pick("chart entity", "8q", /^8q/);
      for (let i = 0; i < 3 && await page.locator(".addchart").count(); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
      const facet = page.locator("[data-assayfacet='armlevel_cna|8q_status']");
      await facet.locator(".valrow").first().waitFor({ timeout: 120000 });
      const gain = Number(((await facet.locator(".valrow", { hasText: "Gain" }).locator(".vn").innerText()) || "").replace(/,/g, ""));
      await facet.locator(".valrow", { hasText: "Gain" }).click();
      await facet.getByRole("button", { name: "Apply filter" }).click();
      await page.waitForFunction((n) => new RegExp("\\b" + n.toLocaleString("en-US") + " patients match").test(document.body.innerText), gain, { timeout: 120000 });
      ok("generic assays: Explore charts an entity, and a click filters to exactly the patients its bar counts", gain > 0, gain + " patients with 8q gained");

      // a split on an entity: its arms and a "No … measured" child add up to the cohort
      const base = { study: STUDY, cohorts: { all: { all: [] } }, views: [] };
      const prop = await (await ctx.request.post(BASE + "/api/partition", { data: { doc: base, cohort: "all", assay: { profileType: "armlevel_cna", entity: "8q_status" } } })).json();
      const split = await (await ctx.request.post(BASE + "/api/analysis", { data: { ...base, cohorts: { all: { all: [], splits: { [prop.name]: { arms: prop.def.arms } } } } } })).json();
      const kids = Object.entries(split.cohorts || {}).filter(([n]) => n.startsWith("all / "));
      const sum = kids.reduce((n, [, c]) => n + c.count, 0);
      ok("generic assays: a split on an entity gives each value an arm and unmeasured patients their own, adding up to the cohort",
        sum === split.cohorts.all.count && kids.some(([n]) => /No 8q_status measured/.test(n)) && kids.some(([n]) => /8q_status Gain/.test(n)), kids.map(([n, c]) => n.slice(6) + " " + c.count).join(", "));

      // correlates against a generic assay: ESR1's mRNA against every phosphosite finds ESR1's own first
      const co = (await (await ctx.request.post(BASE + "/api/analysis", { data: { ...base, views: [{ kind: "correlates", cohorts: ["all"], gene: "ESR1",
        profileType: "rna_seq_v2_mrna_median_Zscores", otherProfile: "phosphoprotein_quantification", show: 5 }] } })).json()).views[0];
      ok("generic assays: correlates reads every entity of a generic assay, ESR1's mRNA ranking its own phosphosite first",
        !co.error && co.correlates.otherIsAssay && co.correlates.positive[0].gene === "ESR1_pS294", co.error || co.correlates.positive.map((g) => g.gene).join(", "));

      // the results page compares Altered with Unaltered on each kind of generic assay
      await page.goto(BASE + "/portal/results?study=" + STUDY + "&genes=MYC", { waitUntil: "domcontentloaded" });
      await page.locator("button, [role=tab]").filter({ hasText: /^Comparison\/Survival$/ }).first().click({ timeout: 120000 });
      await page.locator("button, [role=tab]").filter({ hasText: /^Arm-level copy number$/ }).first().click({ timeout: 60000 });
      await page.waitForFunction(() => /entities tested/.test(document.body.innerText), null, { timeout: 180000 });
      ok("generic assays: the results page's Comparison/Survival has a tab per kind of generic assay", true);
    } catch (e) {
      ok("generic assays: axis, oncoprint and Explore", false, String(e.message).replace(/\s+/g, " ").slice(0, 400));
    }
    ok("generic assays: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { assays };
