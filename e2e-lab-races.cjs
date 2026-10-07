// The analysis page's requests can finish in any order. Each request-order check holds a request
// with page.route() (CLAUDE.md, "Verify waiting states by holding the request"), lets a later one
// through, and then asserts that what the page shows is the newer answer. The rest check what the
// document store (app/lab/doc-store.ts) promises: cards keep their element, edits reach the URL.
//
// Run by e2e.cjs; on its own against a running server: E2E_PORT=3109 node e2e-lab-races.cjs

const CAP = "Lollipop plot: mutations by protein position, with a suppression floor";
const SURV = "Survival from first chemotherapy, left-truncated";
const OQL = "Genomic status via OQL, compared";

/** A gate for the first request that matches; later ones go straight through. */
function holdFirst() {
  let release, held = false, seen = false;
  const gate = new Promise((r) => (release = r));
  return {
    handler: async (route) => {
      if (!seen) { seen = true; held = true; await gate; }
      try { await route.continue(); } catch { /* the page moved on */ }
    },
    get held() { return held; },
    release: () => release(),
  };
}

const tool = (page, name, args = {}) => page.evaluate(([n, a]) => window.cohortLab.call(n, a), [name, args]);
const doc = async (page) => (await tool(page, "analysis_get_document")).document;
/** Poll `fn` (on the Node side — waitForFunction does not await an async predicate) until it returns a truthy value. */
async function until(fn, what, ms = 240000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const settled = (page) => until(async () =>
  !(await tool(page, "analysis_get_document")).running && !(await page.locator(".view-updating").count()), "the page to settle");

async function labRaces(browser, ok, BASE) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  try {
    await page.goto(BASE + "/lab?tab=analysis", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.cohortLab && window.cohortLab.call, null, { timeout: 120000 });

    // 1. Two full runs overlap: the first one's answer arrives last and must not replace the second's.
    {
      const h = holdFirst();
      await page.route("**/api/analysis?oncoprint=spec", h.handler);
      await tool(page, "analysis_load_example", { title: SURV });
      await page.waitForTimeout(500);
      await tool(page, "analysis_load_example", { title: OQL });
      const waited = await until(async () => {
        const r = await tool(page, "analysis_get_results");
        return typeof r === "string" && r.includes("STK11 driver") && !r.startsWith("(A run") && r;
      }, "the newer run's results");
      h.release();
      const trace = [];
      for (let i = 0; i < 8; i++) {   // the held (older) answer lands now
        await page.waitForTimeout(500);
        const g = await tool(page, "analysis_get_document");
        trace.push((g.running ? "R" : "-") + (String(await tool(page, "analysis_get_results")).includes("STK11") ? "S" : "x"));
      }
      await page.unroute("**/api/analysis?oncoprint=spec", h.handler);
      const shown = await tool(page, "analysis_get_results");
      const d = await doc(page);
      ok("lab: an older run that lands last does not replace the newer one",
        h.held && shown.includes("STK11 driver") && !shown.includes("TP53 mut") && Object.keys(d.cohorts).includes("STK11 driver"),
        "held=" + h.held + " · document " + Object.keys(d.cohorts).join(", ") + " · results mention TP53 mut: " + shown.includes("TP53 mut") +
        " · results: " + String(shown).slice(0, 60).replace(/\n/g, " ") + " · trace " + trace.join(" ") + " · when waited: " + String(waited).slice(0, 90).replace(/\n/g, " "));
    }

    // 2. A view edited in the browser alone (the lollipop's grid) and then re-run (its genes):
    //    the re-run's answer must reach the card.
    {
      await tool(page, "analysis_load_example", { title: CAP });
      // read from the card (analysis_get_view caps its JSON, which a lollipop exceeds)
      const genesOf = async () => (await page.locator(".lp-gene").allInnerTexts())
        .map((t) => (/\b(KRAS|BRAF|PIK3CA|TP53)\b/.exec(t) || [])[1]).filter(Boolean);
      await until(async () => (await genesOf()).length > 0, "the lollipop's genes");
      await settled(page);
      const before = await genesOf();
      await page.locator(".lp-colname").first().click();                    // hide a column: applied in the browser
      await page.waitForTimeout(300);
      const hidden = (await doc(page)).views[0].hide;
      await page.locator(".viewcard .genesbtn").first().click();
      await page.locator("dialog.genedialog .pill", { hasText: "TP53" }).click(); // re-runs this view
      await page.locator("dialog.genedialog button.primary").click();
      await until(async () => !(await genesOf()).includes("TP53"), "the re-run without TP53", 60000).catch(() => {});
      const after = await genesOf();
      ok("lab: a view changed in the browser, then re-run, shows the re-run's answer",
        before.includes("TP53") && Array.isArray(hidden) && hidden.length > 0 && !after.includes("TP53") && after.length === before.length - 1,
        "before " + before.join(",") + " · hide " + JSON.stringify(hidden) + " · after " + after.join(","));
    }

    // 4. What a reader is typing survives the page re-rendering around it: a control declared
    //    inside the page component would be a new component every render, and lose it.
    {
      await page.locator(".viewcard .genesbtn").first().click();
      const input = page.locator("dialog.genedialog input[placeholder='add a gene…']");
      await input.click();
      await input.type("BRC");
      await tool(page, "analysis_set_details", { notes: "re-render while typing" });
      await settled(page);
      // (focus is not asserted: the input is disabled while the edit runs, which blurs it)
      const kept = await input.inputValue().catch(() => null);
      await page.keyboard.press("Escape");
      ok("lab: text being typed in a dialog survives the page re-rendering", kept === "BRC", JSON.stringify(kept));
    }

    // 3. An edit the engine rejects leaves nothing waiting.
    {
      let rejected = "";
      try { await tool(page, "analysis_update_view", { index: 0, patch: { genes: ["NOT_A_GENE_XYZ"] } }); }
      catch (e) { rejected = String(e.message || e); }
      await page.waitForTimeout(500);
      const d = await tool(page, "analysis_get_document");
      const covered = await page.locator(".view-updating").count();
      ok("lab: an edit the engine rejects leaves the page usable, not stuck updating",
        /REJECTED/.test(rejected) && !d.running && covered === 0,
        "rejected: " + rejected.slice(0, 80) + " · running " + d.running + " · covers " + covered);
    }

    // 5. A card that was not touched is not remounted: not when another view moves, not when the
    //    AI tools edit another view. (Its DOM element carries a mark set here; a remount loses it.)
    {
      await tool(page, "analysis_load_example", { title: OQL });
      await until(async () => (await page.locator(".viewcard").count()) === 2 && !(await tool(page, "analysis_get_document")).running, "two cards");
      await settled(page);
      await page.locator(".viewcard").evaluateAll((els) => els.forEach((el, i) => { el.__mark = "card" + i; }));
      const marks = () => page.locator(".viewcard").evaluateAll((els) => els.map((el) => el.__mark || "new"));
      await page.locator(".viewcard").first().locator("summary[aria-label='reorder or remove this view']").click();
      await page.locator(".viewcard").first().getByRole("button", { name: "move down" }).click();
      await page.waitForTimeout(500);
      const moved = await marks();
      const kinds = (await doc(page)).views.map((v) => v.kind);
      await tool(page, "analysis_update_view", { index: 0, patch: { endpoint: "OS" } });
      await settled(page);
      const edited = await marks();
      ok("lab: untouched cards keep their element through a move and through another view's edit",
        moved.join() === "card1,card0" && kinds.join() === "survival,compare" && edited[1] === "card0",
        "after move " + moved.join() + " (" + kinds.join() + ") · after editing view 0 " + edited.join());
    }

    // 6. An edit applied in the browser alone still reaches the shareable link.
    {
      await tool(page, "analysis_load_example", { title: CAP });
      await until(async () => (await page.locator(".lp-colname").count()) > 0, "the lollipop's grid");
      await settled(page);
      await page.locator(".lp-colname").first().click();
      await page.waitForTimeout(300);
      const fromUrl = await page.evaluate(() => {
        const b64 = new URLSearchParams(location.search).get("doc") || "";
        const json = new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
        return JSON.parse(json).views[0].hide || null;
      }).catch((e) => "unreadable: " + e.message);
      const onPage = (await doc(page)).views[0].hide;
      ok("lab: a browser-only edit is in the URL at once", Array.isArray(fromUrl) && JSON.stringify(fromUrl) === JSON.stringify(onPage),
        "url " + JSON.stringify(fromUrl) + " · page " + JSON.stringify(onPage));
    }
  } catch (e) {
    ok("lab: request-order checks", false, String(e.message).split("\n")[0].slice(0, 200));
  }
  ok("lab races: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

module.exports = { labRaces };

if (require.main === module) {
  (async () => {
    const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");
    const browser = await chromium.launch({ executablePath: process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome" });
    const results = [];
    const ok = (name, cond, extra) => results.push((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));
    await labRaces(browser, ok, "http://localhost:" + (process.env.E2E_PORT || 3100));
    await browser.close();
    console.log(results.join("\n"));
    process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
  })();
}
