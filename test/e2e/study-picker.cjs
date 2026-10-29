// The study picker stages: ticking boxes does not query until applied.
const { pickExploreStudies } = require("./helpers.cjs");

async function studyPicker({ browser, ok, BASE }) {
  // The study picker STAGES. Ticking boxes must not query: assembling a
  // selection used to fire one facet request per click, 350ms apart, each one
  // seconds of ClickHouse work for a selection the reader had not finished
  // describing. This asserts the REQUEST COUNT, because the feature is
  // invisible when it works and silent when it breaks.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    try {
      await sp.goto(BASE + "/lab?tab=explore", { waitUntil: "domcontentloaded" });
      await pickExploreStudies(sp);
      await sp.waitForSelector("[data-attr]", { timeout: 300000 });
      await sp.waitForTimeout(2000);
      let apiCalls = 0;
      sp.on("request", (r) => { if (/\/api\/(explore|cohort)/.test(r.url())) apiCalls++; });
      await sp.getByRole("button", { name: "Add / change studies" }).click();
      await sp.waitForSelector(".applybar", { timeout: 60000 });
      // "select all" over every study is refused, naming the limit: each study adds dozens of
      // facet queries, and nothing here needs more than a handful
      const addAll = sp.getByRole("checkbox", { name: /^Select all/ });
      const refused = await addAll.isDisabled();
      const refusedWhy = (await addAll.getAttribute("data-tip")) || "";
      ok("select all is refused past 30 studies, saying so", refused && /at most 30 studies/.test(refusedWhy), refusedWhy.slice(0, 90));
      // a narrow search: two ticks, then select all picks up the rest of it
      await sp.locator('input[placeholder^="search name"]').fill("thymoma");
      await sp.waitForTimeout(300);
      const boxes = sp.locator('.study-row [role=checkbox]');
      for (let i = 0; i < 2; i++) { await boxes.nth(i).click(); await sp.waitForTimeout(250); }
      await addAll.click();
      await sp.waitForTimeout(2500);                  // well past the 350ms fetch debounce
      ok("staging studies queries nothing", apiCalls === 0,
        apiCalls === 0 ? "0 requests over 2 ticks + select all" : apiCalls + " request(s) fired before submit");
      const bar = (await sp.locator(".applybar").innerText()).replace(/\s+/g, " ");
      ok("the staged bar distinguishes staged from applied", /not queried yet/.test(bar), bar.slice(0, 80));
      // and submit must actually apply it
      const staged = Number((/^([\d,]+)/.exec(bar.trim()) || [])[1]?.replace(/,/g, "") || 0);
      await sp.locator(".applybar").getByRole("button", { name: "Submit" }).click();
      await sp.waitForFunction(() => !document.querySelector(".applybar"), null, { timeout: 60000 });
      await sp.waitForTimeout(8000);
      const hdr = await sp.evaluate(() => {
        const el = [...document.querySelectorAll("h2")].find((e) => /Exploring/.test(e.textContent || ""));
        return el ? el.textContent.replace(/\s+/g, " ") : "";
      });
      ok("submit applies the staged selection", staged > 0 && hdr.includes(staged.toLocaleString() + " studies"),
        "staged " + staged + " -> " + hdr.slice(0, 70));
    } catch (e) {
      ok("study staging check ran", false, String(e.message).split("\n")[0].slice(0, 110));
    }
    await ctx.close();
  }
}

module.exports = { studyPicker };
