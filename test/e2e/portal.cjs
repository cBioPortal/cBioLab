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

  // The Comparison page's Genomic Alterations tab counts every alteration, or only OncoKB drivers: the
  // choice travels as ?drivers=1, reaches every enrichment view as `measure`, and is disabled, saying
  // why, for a study with no OncoKB calls here.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const link = (study, extra = "") => BASE + "/portal/comparison?doc=" + Buffer.from(JSON.stringify({ study, views: [], cohorts: {
      Male: { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] }, Female: { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] } } })).toString("base64url") +
      "&tab=" + encodeURIComponent("Genomic Alterations") + extra;
    const measures = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/analysis")) try { measures.push(...(JSON.parse(r.postData() || "{}").views || []).filter((x) => x.kind === "enrichment").map((x) => x.measure)); } catch { /* not a document */ }
    });
    const settle = async () => {
      await page.locator(".viewcard").first().waitFor({ timeout: 240000 });
      await page.waitForFunction(() => !document.querySelector(".viewcard[aria-busy]"), null, { timeout: 240000 });
    };
    try {
      await page.goto(link("luad_tcga_pan_can_atlas_2018"), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => { const c = document.querySelector(".driverchoice"); return c && !c.disabled; }, null, { timeout: 120000 });
      await settle();
      const before = measures.splice(0);
      await page.locator(".driverchoice").click();
      await page.getByRole("option", { name: "Alterations: OncoKB drivers only" }).click();
      for (let i = 0; i < 480 && !measures.includes("driver"); i++) await page.waitForTimeout(250);
      await settle();
      const after = measures.splice(0), url = new URL(page.url()).searchParams.get("drivers");
      await page.goto(link("luad_tcga_pan_can_atlas_2018", "&drivers=1"), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => /OncoKB drivers only/.test(document.querySelector(".driverchoice")?.textContent || ""), null, { timeout: 120000 });
      ok("comparison: drivers only reaches every enrichment view, and the link keeps it",
        before.length > 0 && before.every((m) => m === "any") && after.length > 0 && after.every((m) => m === "driver") && url === "1",
        JSON.stringify({ before, after, url }));
      await page.goto(link("prad_mskcc_2017", "&drivers=1"), { waitUntil: "domcontentloaded" });
      await page.locator(".driverchoice[data-tip*='does not have']").waitFor({ timeout: 120000 });
      const off = await page.locator(".driverchoice").isDisabled(), note = await page.locator("p.note").first().innerText().catch(() => "");
      ok("comparison: drivers only is disabled, saying why, for a study with no OncoKB calls, and a link asking for it says it was not applied",
        off && /prad_mskcc_2017 has no OncoKB driver calls/.test(note), note);
    } catch (e) {
      ok("comparison: drivers only", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("comparison: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
  // The Comparison page's expression tabs, as the portal's: mRNA, Protein and DNA methylation, each a
  // diffexpr view on the profile the portal picks, for two groups; with three, none, and the page says why.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const er = (v) => ({ all: [{ kind: "clinical", attribute: "ER_STATUS_BY_IHC", values: [v] }] });
    const link = (cohorts, tab) => BASE + "/portal/comparison?doc=" + Buffer.from(JSON.stringify({ study: "brca_tcga", views: [], cohorts })).toString("base64url") +
      (tab ? "&tab=" + encodeURIComponent(tab) : "");
    const settled = async () => {
      await page.locator(".viewcard").first().waitFor({ timeout: 240000 });
      await page.waitForFunction(() => !document.querySelector(".viewcard[aria-busy]"), null, { timeout: 240000 });
      return page.locator(".viewcard").first().innerText();
    };
    try {
      await page.goto(link({ "ER+": er("Positive"), "ER-": er("Negative") }, "Protein"), { waitUntil: "domcontentloaded" });
      const protein = await settled();
      // as the portal's tab: the table of every listed gene under the volcano, and a gene's values per group on a click
      const body = page.locator("[data-test=diffexpr-body]");
      const heads = await body.locator(".pb-table thead th").allInnerTexts();
      const first = await body.locator(".pb-table tbody tr").first().innerText();
      const placeholder = await body.locator("[data-test=diffexpr-box] .pb-placeholder").innerText();
      await body.locator(".pb-table tbody tr").first().click();
      await body.locator("[data-test=diffexpr-box] svg").waitFor({ timeout: 120000 });
      const box = await body.locator("[data-test=diffexpr-box]").innerText();
      ok("comparison: an expression tab lists its genes in a table, and a gene clicked there draws its values per group",
        ["Gene", "Cytoband", "μ in ER+", "μ in ER-", "σ in ER+", "σ in ER-", "Log2 Ratio", "p-Value", "q-Value", "Higher expression in"].every((h) => heads.some((x) => x.startsWith(h))) &&
          /^AGR3\t7p21\.1/.test(first) && /AGR3 · p-Value/.test(box) && /ER\+ \(\d+\)/.test(box) && /ER- \(\d+\)/.test(box) && /Click on a gene/.test(placeholder),
        heads.join(" | ") + " — " + first.replace(/\s+/g, " ") + " — " + box.replace(/\s+/g, " ").slice(0, 160));
      // the picked gene is the view's: the link carries it, so opening it draws the same box plot
      const again = await browser.newPage();
      try {
        await again.goto(page.url(), { waitUntil: "domcontentloaded" });
        await again.locator("[data-test=diffexpr-box] svg").waitFor({ timeout: 240000 });
        const meta = await again.locator("[data-test=diffexpr-box] .meta").innerText();
        ok("comparison: the gene picked on an expression tab is kept in the link", /^AGR3 · p-Value/.test(meta), meta);
      } finally { await again.close(); }
      await page.evaluate(() => window.scrollTo(0, 0));
      const vb = await body.locator("[data-test=diffexpr-volcano]").boundingBox();
      await page.mouse.move(vb.x + vb.width * 0.7, vb.y + vb.height * 0.15);
      await page.mouse.down(); await page.mouse.move(vb.x + vb.width * 0.98, vb.y + vb.height * 0.75, { steps: 6 }); await page.mouse.up();
      const pager = await body.locator(".pb-pager").innerText();
      ok("comparison: a box dragged over the volcano lists only the genes inside it", /selected on the volcano/.test(await body.innerText()) && !/of 1,500/.test(pager),
        pager.replace(/\s+/g, " "));
      const titles = await page.getByRole("tab").allInnerTexts();
      await page.getByRole("tab", { name: "DNA methylation" }).click();
      await page.waitForFunction(() => /methylation_hm450/.test(document.querySelector(".viewcard")?.innerText || ""), null, { timeout: 240000 });
      const methylation = await settled();
      ok("comparison: Protein and DNA methylation tabs compare two groups on the portal's profiles",
        ["mRNA", "Protein", "DNA methylation"].every((t) => titles.includes(t)) &&
          /protein_quantification/.test(protein) && /10,509 genes/.test(protein) && /16,133 genes/.test(methylation),
        titles.join(" | ") + " — " + (protein.match(/[\d,]+ genes[^\n]*/) || [""])[0] + " / " + (methylation.match(/[\d,]+ genes[^\n]*/) || [""])[0]);
      // three groups: no volcano, a mean and SD per group, p from one-way ANOVA, as the portal's, the group with the highest mean
      const sub = (v) => ({ all: [{ kind: "clinical", attribute: "SUBTYPE", values: [v] }] });
      await page.goto(BASE + "/portal/comparison?doc=" + Buffer.from(JSON.stringify({ study: "brca_tcga_pan_can_atlas_2018", views: [],
        cohorts: { LumA: sub("BRCA_LumA"), LumB: sub("BRCA_LumB"), Basal: sub("BRCA_Basal") } })).toString("base64url") + "&tab=Protein", { waitUntil: "domcontentloaded" });
      const body3 = page.locator("[data-test=diffexpr-body]");
      await body3.locator(".pb-table tbody tr").first().waitFor({ timeout: 240000 });
      const heads3 = await body3.locator(".pb-table thead th").allInnerTexts();
      const pTip = await body3.locator(".pb-table thead th", { hasText: "p-Value" }).first().evaluate((el) => (el.closest("[data-tip]") || el.querySelector("[data-tip]"))?.getAttribute("data-tip") || "");
      const first3 = await body3.locator(".pb-table tbody tr").first().innerText();
      const tabs3 = await page.getByRole("tab").allInnerTexts();
      ok("comparison: with three groups the expression tabs test by ANOVA, a mean and SD per group and no volcano",
        ["mRNA", "Protein"].every((t) => tabs3.includes(t)) && await body3.locator("[data-test=diffexpr-volcano]").count() === 0 &&
          ["μ in LumA", "μ in LumB", "μ in Basal", "σ in LumA", "σ in LumB", "σ in Basal", "p-Value", "q-Value", "Higher expression in"].every((h) => heads3.some((x) => x.startsWith(h))) &&
          !heads3.some((x) => /Log2 Ratio|Mean Difference/.test(x)) && /ANOVA/.test(pTip) && /\t(LumA|LumB|Basal)$/.test(first3.trim()),
        tabs3.join(" | ") + " — " + heads3.join(" | ") + " — " + pTip + " — " + first3.replace(/\s+/g, " "));
    } catch (e) {
      ok("comparison: expression tabs", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("comparison expression tabs: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
  // "Open in cBioPortal": the same page and tab on the legacy portal, following the open tab; on the
  // Comparison page, which needs a portal session, disabled and saying why.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const legacy = async () => page.locator(".legacylink").evaluate((e) => ({ href: e.getAttribute("href"), target: e.getAttribute("target"), tip: e.getAttribute("data-tip"), off: e.getAttribute("aria-disabled") }));
    const until = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".legacylink")?.getAttribute("href") || ""), re.source, { timeout: 240000 });
    try {
      await page.goto(BASE + "/portal/results?study=brca_tcga&genes=" + encodeURIComponent("KRAS\nTP53: MUT") + "&tab=Mutations", { waitUntil: "domcontentloaded" });
      await until(/\/results\/mutations\?/);
      const first = await legacy();
      const q = new URL(first.href).searchParams;
      await page.getByRole("tab", { name: "Comparison/Survival" }).click();
      await page.getByRole("tab", { name: "Survival", exact: true }).click();
      await until(/\/results\/comparison\/survival\?/);
      const second = await legacy();
      ok("portal: Open in cBioPortal links the same query and tab, in a new tab, and follows the open tab",
        first.target === "_blank" && q.get("cancer_study_list") === "brca_tcga" && q.get("case_set_id") === "brca_tcga_all" && q.get("gene_list") === "KRAS\nTP53: MUT" &&
          /^https?:\/\/[^/]+\/results\/comparison\/survival\?/.test(second.href || ""), first.href + " → " + second.href);
      await page.goto(BASE + "/portal/comparison?doc=" + Buffer.from(JSON.stringify({ study: "brca_tcga", views: [], cohorts: {
        Male: { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }] }, Female: { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] } } })).toString("base64url"), { waitUntil: "domcontentloaded" });
      await page.locator(".legacylink[data-tip*='session']").waitFor({ timeout: 240000 });
      const cmp = await legacy();
      ok("portal: on the Comparison page Open in cBioPortal is disabled, saying why", cmp.off === "true" && !cmp.href, cmp.tip);
    } catch (e) {
      ok("portal: Open in cBioPortal", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("portal open in cBioPortal: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { portal };
