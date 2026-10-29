// The risk model's volcano and its Table 1.
const { misalignedControls } = require("./helpers.cjs");

async function riskmodel({ decodeUrlJson, browser, ok, BASE }) {
  // The risk model (lib/views/riskmodel/run.ts): the volcano's label threshold is applied in the browser
  // (no request), and a cut is one request answered from the cached fit (lib/next-cache.ts
  // cachedRiskFit), not a refit; the caveat then says the cuts were chosen.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const doc = { study: "msk_chord_2024", cohorts: { NSCLC: { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } },
      views: [{ kind: "riskmodel", cohorts: ["NSCLC"], runs: 2 }] };
    const b64 = Buffer.from(JSON.stringify(doc)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fig = page.locator("svg[aria-label^='Risk model']");
    const text = async () => (await fig.evaluate((s) => [...s.querySelectorAll("text")].map((t) => t.textContent).join(" "))).replace(/\s+/g, " ");
    try {
      await page.goto(BASE + "/lab?tab=analysis&doc=" + b64, { waitUntil: "domcontentloaded" });
      await fig.waitFor({ timeout: 240000 });
      ok("risk model: draws the 0–10 score and the volcano", /score \(0–10\)/.test(await text()) && /Selection frequency against mean hazard ratio/.test(await text()));
      const askew = await misalignedControls(page, ".riskmodel-tb");
      ok("risk model: its controls share one height and centre line", askew.length === 0, askew.join(" | "));
      // the fitting settings sit in the view's settings menu; a value the menu does not offer still shows
      await page.locator(".risksettingsbtn").click();
      const settings = page.locator("[data-slot=popover-content]");
      await settings.waitFor({ timeout: 10000 });
      const runsShown = (await settings.locator(".setrow", { hasText: "runs" }).locator("[role=combobox]").innerText()).trim();
      const settingsText = (await settings.innerText()).replace(/\s+/g, " ");
      await page.keyboard.press("Escape");
      ok("risk model: penalty, runs and validation are in the settings menu, showing the document's runs",
        runsShown === "2" && /penalty/.test(settingsText) && /validate on held-out half/.test(settingsText), "runs " + JSON.stringify(runsShown));
      let requests = 0;
      page.on("request", (r) => { if (r.url().includes("/api/analysis")) requests++; });
      await page.locator(".riskmodel-tb label.tbfield", { hasText: "label genes" }).locator("[role=combobox]").click();
      await page.locator("[role=option]", { hasText: "90%" }).click();
      await page.waitForFunction(() => /kept in ≥ 90% of runs/.test(document.querySelector("svg[aria-label^='Risk model']")?.textContent || ""), null, { timeout: 10000 });
      ok("risk model: the label threshold redraws the volcano without a request", requests === 0, requests + " requests");
      // the risk-groups dialog: its handles move and its preview updates with no request; Apply is one
      await page.locator(".riskgroupsbtn").click();
      const dlg = page.locator("[role=dialog].riskgroupsdialog");
      await dlg.locator("[data-slot=slider-thumb]").nth(1).waitFor({ timeout: 10000 });
      // measured once the dialog has finished zooming in: mid-animation it is scaled, and so is every control in it
      await dlg.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const dlgAskew = await misalignedControls(page, ".riskgroupsdialog");
      const onLines = await dlg.evaluate((d) => {
        const lines = [...d.querySelectorAll("svg line[stroke-dasharray='3 2']")].map((l) => l.getBoundingClientRect().left);
        return [...d.querySelectorAll("[data-slot=slider-thumb]")].every((t, i) => { const r = t.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - lines[i]) < 1; });
      });
      ok("risk model: the dialog's handles sit on the histogram's cut lines, and its controls align", onLines && dlgAskew.length === 0, dlgAskew.join(" | "));
      const shares = async () => (await dlg.locator("[aria-live=polite]").innerText()).replace(/\s+/g, " ");
      await dlg.locator("[data-slot=slider-thumb]").nth(1).focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      const moved = await dlg.locator("input[type=number]").evaluateAll((els) => els.map((e) => e.value));
      await dlg.getByRole("button", { name: "+ add cut" }).click();
      const added = await dlg.locator("input[type=number]").count();
      ok("risk model: the dialog's handles step by a percentile and a cut can be added, with no request",
        // three steps from 67 reach at least 70: a step is at least one whole percentile, more where tied scores share one
        moved[0] === "33" && Number.isInteger(Number(moved[1])) && Number(moved[1]) >= 70 && added === 3 && requests === 0 && /Risk group 4 of 4/.test(await shares()), JSON.stringify(moved) + ", " + added + " cuts, " + requests + " requests");
      await dlg.getByRole("button", { name: "Top 20%" }).click();
      ok("risk model: a preset previews its shares", /Low risk 80%.*High risk 20%/.test(await shares()), await shares());
      const t0 = Date.now();
      await dlg.locator(".riskgroupsapply").click();
      await page.waitForFunction(() => { const l = document.querySelector("svg[aria-label^='Risk model']")?.getAttribute("aria-label") || ""; return /Low risk, High risk$/.test(l); }, null, { timeout: 120000 });
      const ms = Date.now() - t0;
      ok("risk model: Apply is one request, and the button's title then names the cut", requests === 1 && /cut at the 80th percentile/.test(await page.locator(".riskgroupsbtn").getAttribute("data-tip")), requests + " requests, " + ms + " ms");
      ok("risk model: the caveat says the cuts were chosen", /The cuts were chosen in the view, at the 80th percentile/.test(await text()));
      // the same model regrouped is the cached fit: a seed nothing else here fits, then the same with a cut
      const post = async (view) => (await (await ctx.request.post(BASE + "/api/analysis", { data: { ...doc, views: [{ ...doc.views[0], runs: 5, seed: 7, ...view }] } })).json()).views[0];
      const cold = await post({}), recut = await post({ cuts: [0.8] });
      ok("risk model: regrouping reuses the fit — the same model, without the fit's time", !cold.error && !recut.error &&
        JSON.stringify(cold.riskmodel.cIndex) === JSON.stringify(recut.riskmodel.cIndex) && JSON.stringify(cold.riskmodel.features) === JSON.stringify(recut.riskmodel.features) &&
        cold.ms > 2000 && recut.ms * 3 < cold.ms, "fit + groups " + cold.ms + " ms, regrouped " + recut.ms + " ms");
    } catch (e) {
      ok("risk model: the card's controls", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("risk model: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The risk model's Table 1 (app/lab/risk-table1-dialog.tsx on lib/views/riskmodel/table1.ts): the toolbar's
  // button opens every group side by side, a header click marks a group's column; the model's own genes are marked and get
  // no q; a gene added in the dialog re-runs only the dialog's request, which covers the table while its
  // controls stay usable, and is counted over the patients whose panels cover it; "Add to document" writes
  // `describe` into the view, so the link and the figure's caption carry Table 1.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const doc = { study: "msk_chord_2024", cohorts: { NSCLC: { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } },
      views: [{ kind: "riskmodel", cohorts: ["NSCLC"], runs: 2 }] };
    const b64 = Buffer.from(JSON.stringify(doc)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fig = page.locator("svg[aria-label^='Risk model']");
    const urlDoc = () => decodeUrlJson(new URL(page.url()).searchParams.get("doc") || "");
    try {
      await page.goto(BASE + "/lab?tab=analysis&doc=" + b64, { waitUntil: "domcontentloaded" });
      await fig.waitFor({ timeout: 240000 });
      const askew = await misalignedControls(page, ".riskmodel-tb");
      ok("risk model Table 1: one button, aligned with the toolbar", (await page.locator(".risktable1btn").count()) === 1 && askew.length === 0, askew.join(" | "));
      await page.locator(".risktable1btn").click();
      const dlg = page.locator("[role=dialog].risktable1dialog");
      await dlg.locator("table.risktable1").waitFor({ timeout: 120000 });
      await dlg.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const dlgAskew = await misalignedControls(page, ".risktable1dialog");
      const heads = await dlg.locator("thead th").allInnerTexts();
      const markedBefore = await dlg.locator("thead th.bg-accent\\/60").count();
      await dlg.locator("thead th").nth(3).getByRole("button").click();
      const marked = await dlg.locator("thead th").nth(3).evaluate((th) => th.className.includes("bg-accent"));
      ok("risk model Table 1: every group side by side, a header click marks its column, controls aligned",
        /Low risk/.test(heads[1]) && /High risk/.test(heads[3]) && markedBefore === 0 && marked && dlgAskew.length === 0, heads.slice(1, 4).join(" | ").replace(/\s+/g, " ") + " " + dlgAskew.join(" | "));
      const modelRows = dlg.locator("tbody tr", { has: page.locator("i", { hasText: "in the model" }) });
      const modelQs = await modelRows.evaluateAll((trs) => trs.map((tr) => tr.children[tr.children.length - 2].textContent.trim()));
      ok("risk model Table 1: the model's genes are marked “in the model” with no q-value", modelQs.length >= 5 && modelQs.every((q) => q === "—"), modelQs.length + " rows, q " + [...new Set(modelQs)].join(","));
      // add a gene not every panel covers, holding the request: the table is covered, the controls stay usable
      let release, open = false;
      const gate = new Promise((r) => (release = r)); gate.then(() => (open = true));
      let requests = 0;
      await page.route("**/api/analysis**", async (route) => { requests++; if (!open) await gate; try { await route.continue(); } catch {} });
      await dlg.getByLabel("add genes").fill("SMARCA2");
      await dlg.getByLabel("add genes").press("Enter");
      await page.waitForTimeout(800);
      const w = { cover: await dlg.locator(".risktable1-wait").isVisible(), input: await dlg.getByLabel("add genes").isEnabled(), chip: await dlg.getByLabel("remove SMARCA2").isVisible(),
        cardCover: await page.locator(".view-updating").count() };
      release(); await page.unroute("**/api/analysis**");
      ok("risk model Table 1: while a gene is added, the table is covered and its controls stay usable", w.cover && w.input && w.chip && w.cardCover === 0, JSON.stringify(w));
      await page.waitForFunction(() => !document.querySelector(".risktable1-wait"), null, { timeout: 120000 });
      const smarca2 = await dlg.locator("tbody tr", { hasText: "SMARCA2 mutated" }).innerText();
      ok("risk model Table 1: an added gene is one request, counted over the patients whose panels cover it", requests === 1 && /n\.p\./.test(smarca2), requests + " requests · " + smarca2.replace(/\s+/g, " "));
      await dlg.locator(".risktable1add").click();
      // the caption wraps: its lines are separate <text>s, joined with a space, as a reader reads them
      await page.waitForFunction(() => /Table 1 \(not drawn; in the result\)/.test([...document.querySelectorAll("svg[aria-label^='Risk model'] text")].map((t) => t.textContent).join(" ").replace(/\s+/g, " ")),
        null, { timeout: 120000 });
      const saved = urlDoc().views[0].describe;
      ok("risk model Table 1: “Add to document” writes describe into the view, and the caption states it",
        !!saved && saved.genes.includes("SMARCA2") && saved.attributes.length > 0 && /in the document/.test(await page.locator(".riskmodel-tb").innerText()), JSON.stringify(saved).slice(0, 160));
      await page.keyboard.press("Escape");
      requests = 0;
      page.on("request", (r) => { if (r.url().includes("/api/analysis")) requests++; });
      await page.locator(".risktable1btn").click();
      await dlg.locator("table.risktable1").waitFor({ timeout: 10000 });
      ok("risk model Table 1: reopened, the document's table shows from the view's result", requests === 0 && (await dlg.locator(".risktable1add").innerText()) === "In the document",
        requests + " requests · " + (await dlg.locator(".risktable1add").innerText()));
    } catch (e) {
      ok("risk model Table 1: the dialog", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("risk model Table 1: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

module.exports = { riskmodel };
