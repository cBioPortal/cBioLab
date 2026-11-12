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
        /^\/lab\?tab=explore&study=/.test(explore || "") && /^Query Breast/.test(rowTitle) && rowTicked === 0 &&
        /^Query Colorectal/.test(title) && q.get("study") === "coadread_tcga_pub" && q.get("genes") === "KRAS: MUT\nBRAF" && again === "KRAS: MUT\nBRAF" &&
        modifyExplore === 0 && pencilGenes === "KRAS: MUT\nBRAF" && pencilTitle === "Edit genes",
        JSON.stringify({ status: res.status(), landed, empty, rows: [all, byType, byData], picked, explore, rowTitle, rowTicked, title, results: [q.get("study"), q.get("genes")], again, modifyExplore, pencilGenes, pencilTitle }));
    } catch (e) {
      ok(name, false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("homepage: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The query dialog's profiles and case set, as cBioPortal's query page has them: the portal's
  // default profiles and the case set that follows them, mRNA's radios and z-score threshold, a
  // user-defined list whose unknown ids are refused in the portal's words, and the Results page
  // naming what was chosen — its Modify query starting from the same choice.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const name = "query dialog: genomic profiles and case set change what the Results page asks for";
    try {
      await page.goto(BASE + "/?studies=brca_tcga", { waitUntil: "domcontentloaded" });
      await page.locator("button.querybygene:not([disabled])").waitFor({ timeout: 120000 });
      await page.locator("button.querybygene").click();
      const dlg = page.locator("[role=dialog].gene-query-dialog");
      const panel = dlg.locator("[data-test=queryOptions]");
      const caseSet = panel.locator("[data-test=caseSetSelector]");
      await caseSet.filter({ hasText: /\(\d+\)/ }).waitFor({ timeout: 60000 });
      const start = { mut: await panel.getByRole("checkbox", { name: "Mutations" }).isChecked(), cna: await panel.getByRole("checkbox", { name: /GISTIC/ }).isChecked(), set: await caseSet.innerText() };
      await panel.getByRole("checkbox", { name: /GISTIC/ }).click();
      const mutOnly = await caseSet.innerText();
      await panel.getByRole("checkbox", { name: "mRNA Expression" }).click();
      await panel.getByRole("radio", { name: /relative to diploid samples \(RNA Seq V2 RSEM\)/ }).click();
      const z = await panel.getByLabel("mRNA z-score threshold").inputValue();
      await panel.getByRole("checkbox", { name: "mRNA Expression" }).click();
      await caseSet.click();
      await page.getByLabel("filter case sets").fill("user");
      await page.getByRole("option", { name: "User-defined Case List" }).click();
      await panel.getByLabel("Enter case IDs").fill("TCGA-A1-A0SB-01 TCGA-A1-A0SD-01 NOT-A-SAMPLE");
      await dlg.locator("textarea[aria-label='OQL query']").fill("TP53");
      const submit = dlg.getByRole("button", { name: "Submit query" });
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Submit query"); return b && !b.disabled; }, null, { timeout: 60000 });
      await submit.click();
      const alert = dlg.locator("[role=alert]");
      await alert.waitFor({ timeout: 60000 });
      const refused = await alert.innerText();
      await panel.getByLabel("Enter case IDs").fill("TCGA-A1-A0SB-01 TCGA-A1-A0SD-01");
      await submit.click();
      await page.waitForURL(/\/portal\/results\?/, { timeout: 60000 });
      const q = new URL(page.url()).searchParams;
      const summary = page.locator("[data-test=queryOptionsSummary]");
      await summary.waitFor({ timeout: 120000 });
      await page.waitForFunction(() => /of 2 queried patients altered/.test(document.querySelector("main")?.innerText || ""), null, { timeout: 180000 });
      const said = await summary.innerText();
      await page.getByRole("button", { name: "Modify query" }).click();
      await page.locator("[role=dialog].modifyquerydialog button.querybygene").click();
      await page.waitForFunction(() => (document.querySelector("[data-test=CustomCaseSetInput]")?.value || "").includes("TCGA-A1-A0SD-01"), null, { timeout: 60000 });
      const back = { set: await dlg.locator("[data-test=caseSetSelector]").innerText(), cna: await dlg.getByRole("checkbox", { name: /GISTIC/ }).isChecked() };
      ok(name, start.mut && start.cna && /^Samples with mutation and CNA data \(963\)$/.test(start.set) && /^Samples with mutation data \(982\)$/.test(mutOnly) && z === "2.0" &&
        refused === "Invalid sample for the selected cancer study: NOT-A-SAMPLE" &&
        q.get("mut") === "mutations" && !q.has("cna") && q.get("case_set") === "-1" && q.get("cases_n") === "2" &&
        /User-defined Case List \(2 samples\)/.test(said) && /Mutations/.test(said) && back.set === "User-defined Case List" && !back.cna,
        JSON.stringify({ start, mutOnly, z, refused, link: q.toString(), said, back }));
    } catch (e) {
      ok(name, false, String(e.message).split("\n")[0].slice(0, 200));
    }
    // several PanCancer Atlas studies: mRNA is offered (CROSS_STUDY_EXPRESSION's default), each study reading the chosen
    // profile where it holds it; an EXP typed into the genes is refused in the portal's words. 49 of 128 is cbioportal.org's
    // count for this query (acc holds no ref_normal profile, so only chol's expression counts)
    const across = "query dialog: mRNA across PanCancer studies, read where each study holds the profile; a typed EXP refused";
    try {
      await page.goto(BASE + "/?studies=acc_tcga_pan_can_atlas_2018,chol_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
      await page.locator("button.querybygene:not([disabled])").waitFor({ timeout: 120000 });
      const dlg = page.locator("[role=dialog].gene-query-dialog");
      // a click before the page answers clicks opens nothing: ask again until the dialog is up
      for (let i = 0; i < 10 && !(await dlg.count()); i++) { await page.locator("button.querybygene").click(); await page.waitForTimeout(1000); }
      const panel = dlg.locator("[data-test=queryOptions]");
      await panel.getByRole("checkbox", { name: "mRNA Expression" }).waitFor({ timeout: 60000 });
      await panel.getByRole("radio", { name: /relative to normal samples/ }).click();
      const submit = dlg.getByRole("button", { name: "Submit query" });
      const ready = () => page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Submit query"); return b && !b.disabled; }, null, { timeout: 60000 });
      await dlg.locator("textarea[aria-label='OQL query']").fill("TP53: EXP>2");
      await ready();
      await submit.click();
      const alert = dlg.locator("[role=alert]");
      await alert.waitFor({ timeout: 60000 });
      const refused = await alert.innerText();
      await dlg.locator("textarea[aria-label='OQL query']").fill("TP53");
      await ready();
      await submit.click();
      await page.waitForURL(/\/portal\/results\?/, { timeout: 60000 });
      const q = new URL(page.url()).searchParams;
      await page.waitForFunction(() => /of 128 queried patients altered/.test(document.querySelector("main")?.innerText || ""), null, { timeout: 180000 });
      const main = await page.locator("main").innerText();
      const count = (main.match(/(\d+) \([\d.]+%\)\s*of 128 queried patients altered/) || [])[1];
      ok(across, refused === "Expression filtering in the gene list (the EXP command) is not supported when doing cross cancer queries." &&
        q.get("mrna") === "rna_seq_v2_mrna_median_all_sample_ref_normal_Zscores" && q.get("case_set") === "all" && count === "49",
        JSON.stringify({ refused, link: q.toString(), count }));
    } catch (e) {
      ok(across, false, String(e.message).split("\n")[0].slice(0, 200));
    }
    // The dialog's layout: three numbered steps in the portal's order, each in a well of its own (a
    // tone apart from the dialog's, none overlapping the next), the profile rows close together. And
    // studies of different reference genomes (brca_tcga hg19 + aml_target_gdc hg38, neither PanCancer):
    // the portal's warning word for word in the dialog and on the Results page, and no mRNA or protein
    const layout = "query dialog: three steps in wells; hg19 + hg38 studies are warned of, and offer no mRNA";
    try {
      await page.goto(BASE + "/?studies=brca_tcga,aml_target_gdc", { waitUntil: "domcontentloaded" });
      await page.locator("button.querybygene:not([disabled])").waitFor({ timeout: 120000 });
      const dlg = page.locator("[role=dialog].gene-query-dialog");
      for (let i = 0; i < 10 && !(await dlg.count()); i++) { await page.locator("button.querybygene").click(); await page.waitForTimeout(1000); }
      const panel = dlg.locator("[data-test=queryOptions]");
      await panel.locator("[data-test=caseSetSelector]").filter({ hasText: /\(\d+\)/ }).waitFor({ timeout: 60000 });
      const shape = await dlg.evaluate((d) => {
        const steps = [...d.querySelectorAll("[data-test^=queryStep]")];
        const wells = steps.map((s) => s.closest("section"));
        const tone = (e) => getComputedStyle(e).backgroundColor;
        const boxes = wells.map((w) => w && w.getBoundingClientRect());
        const rows = [...d.querySelectorAll("[data-test=molecularProfileSelector] label")].map((l) => l.getBoundingClientRect().top);
        return {
          labels: steps.map((s) => s.querySelector("h3")?.textContent),
          numbers: steps.map((s) => s.firstElementChild?.textContent),
          walled: wells.every((w) => w && tone(w) !== tone(d)),
          apart: boxes.every((b, i) => b && (i === 0 || boxes[i - 1].bottom <= b.top)),
          pitch: Math.max(0, ...rows.slice(1).map((t, i) => t - rows[i])),
          kinds: [...d.querySelectorAll("[data-test=molecularProfileSelector] [data-test]")].map((x) => x.getAttribute("data-test")),
        };
      });
      const notes = await panel.locator(":scope > p").allInnerTexts();
      const WARN = "You are combining studies with molecular data based on both GRCh37/hg19 and GRCh38/hg38. This is not fully supported yet. Please double check your findings";
      await dlg.locator("textarea[aria-label='OQL query']").fill("TP53");
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Submit query"); return b && !b.disabled; }, null, { timeout: 60000 });
      await dlg.getByRole("button", { name: "Submit query" }).click();
      await page.waitForURL(/\/portal\/results\?/, { timeout: 60000 });
      await page.locator("[data-test=queryOptionsSummary]").waitFor({ timeout: 120000 });
      const results = await page.locator("main").innerText();
      ok(layout, JSON.stringify(shape.labels) === JSON.stringify(["Select Genomic Profiles:", "Select Patient/Case Set:", "Enter Genes:"]) &&
        shape.numbers.join("") === "123" && shape.walled && shape.apart && shape.pitch > 0 && shape.pitch <= 30 &&
        !shape.kinds.includes("MRNA_EXPRESSION") && !shape.kinds.includes("PROTEIN_LEVEL") && notes.includes(WARN) && results.includes(WARN),
        JSON.stringify({ ...shape, notes, results: results.includes(WARN) }));
    } catch (e) {
      ok(layout, false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("query dialog options: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
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
