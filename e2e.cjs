const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");

const BASE = "http://localhost:3100";

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome"
  });
  const results = [];
  const ok = (name, cond, extra) =>
    results.push((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));

  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto(BASE + "/");
    await page.waitForSelector("#connPill.on", { timeout: 90000 });
    ok(scheme + ": auto-connected pill", true, await page.textContent("#connText"));

    const typeCount = await page.locator(".sel-card select option").count();
    ok(scheme + ": event types loaded", typeCount >= 5, typeCount + " options");

    if (scheme === "light") {
      const runDone = () => page.waitForFunction(
        () => document.getElementById("runBtn") && !document.getElementById("runBtn").disabled &&
              document.getElementById("rMatched"), null, { timeout: 120000 });

      // Recipe 1 auto-runs on click
      await page.click('#recipes button[data-i="0"]');
      await runDone();
      const m1 = (await page.textContent("#rMatched")).trim();
      const d1 = (await page.textContent("#rDenom")).trim();
      ok("recipe1 auto-ran, 2,024/3,341", m1 === "2,024" && d1 === "3,341", m1 + "/" + d1);
      ok("gap histogram", await page.locator("#histChart .bar-row").count() >= 5);
      const plinks = await page.locator("#rPatients a").count();
      const phref = plinks ? await page.locator("#rPatients a").first().getAttribute("href") : "";
      ok("patient links", plinks > 0 && phref.includes("/patient?studyId=msk_chord_2024"), plinks + " links");
      const sql = await page.textContent("#rSql");
      ok("SQL shown", sql.includes("uniqExact(sel_a.patient_id)"));

      // Recipe 5 (absence)
      await page.click('#recipes button[data-i="4"]');
      await page.waitForFunction(t => document.getElementById("rMatched") &&
        document.getElementById("rMatched").textContent.trim() !== t &&
        !document.getElementById("runBtn").disabled, m1, { timeout: 120000 });
      const m5 = (await page.textContent("#rMatched")).trim();
      const d5 = (await page.textContent("#rDenom")).trim();
      ok("recipe5 absence 7,028/17,010", m5 === "7,028" && d5 === "17,010", m5 + "/" + d5);
      ok("histogram absent for absence rel", (await page.locator("#histChart").count()) === 0);

      // Lines explorer with guard
      await page.check("#lineGuard");
      await page.click("#linesBtn");
      await page.waitForFunction(() => document.querySelectorAll("#lineHist .bar-row").length > 0, null, { timeout: 120000 });
      const l1 = await page.locator("#lineHist .bar-row .val").first().textContent();
      ok("lines hist first bucket 9,047", l1.trim() === "9,047", l1.trim());
      const t1 = await page.locator("#lineTrans .bar-row").first().getAttribute("title");
      ok("top transition Chemo→Chemo 922", t1.includes("Chemo → Chemo") && t1.includes("922"), t1);

      // Recipe 3 single-selector
      await page.click('#recipes button[data-i="2"]');
      await page.waitForFunction(t => document.getElementById("rMatched").textContent.trim() !== t &&
        !document.getElementById("runBtn").disabled, m5, { timeout: 120000 });
      const m3 = (await page.textContent("#rMatched")).trim();
      ok("recipe3 single-selector 5,076", m3 === "5,076", m3);

      // New guarded recipe: True 1L immuno, PFS 1y (guard auto-applied) — expect 417/2,392
      await page.click('#recipes button[data-i="11"]');
      await page.waitForFunction(t => document.getElementById("rMatched").textContent.trim() !== t &&
        !document.getElementById("runBtn").disabled, m3, { timeout: 120000 });
      const m11 = (await page.textContent("#rMatched")).trim();
      const d11 = (await page.textContent("#rDenom")).trim();
      ok("recipe12 guarded 417/2,392", m11 === "417" && d11 === "2,392", m11 + "/" + d11);
      ok("guard checkbox auto-set", await page.isChecked(".chk input[type=checkbox]"));

      // Derived-line recipe: Progression <=180d after starting 2L — expect 3,003/7,824
      await page.click('#recipes button[data-i="12"]');
      await page.waitForFunction(t => document.getElementById("rMatched").textContent.trim() !== t &&
        !document.getElementById("runBtn").disabled, m11, { timeout: 120000 });
      const m12 = (await page.textContent("#rMatched")).trim();
      const d12 = (await page.textContent("#rDenom")).trim();
      ok("line-event recipe 3,003/7,824", m12 === "3,003" && d12 === "7,824", m12 + "/" + d12);
      const selHtml = await page.locator(".sel-card select").first().innerHTML();
      ok("synthetic line type in dropdown", selHtml.includes("Treatment line (derived)"));

      // No credentials anywhere client-visible: check for env var names plus the
      // actual secrets read from .env.local at runtime (never hardcoded here)
      const pageContent = await page.content();
      const secretBits = ["CLICKHOUSE"];
      try {
        const env = require("fs").readFileSync(__dirname + "/.env.local", "utf8");
        for (const key of ["CLICKHOUSE_PASSWORD", "CLICKHOUSE_USER"]) {
          const m = env.match(new RegExp(key + "=(.+)"));
          if (m) secretBits.push(m[1].trim());
        }
      } catch (e) { /* no .env.local locally */ }
      const secretLeak = secretBits.some(b => pageContent.includes(b));
      ok("no credentials in served HTML/DOM", !secretLeak);

      await page.screenshot({ path: "shot-next-light.png", fullPage: true });

      // Oncoprint page: default two-group preset auto-renders
      await page.goto(BASE + "/oncoprint");
      await page.waitForSelector("#oncoCanvas", { timeout: 180000 });
      await page.waitForFunction(() => {
        const h = [...document.querySelectorAll(".card h2")].map(e => e.textContent).join(" ");
        return h.includes("patients");
      }, null, { timeout: 180000 });
      const oncoHeader = [...await page.locator(".card h2").allTextContents()].join(" ");
      ok("oncoprint contract built (2,946 patients)", oncoHeader.includes("2,946 patients"), oncoHeader.slice(0, 80));
      const canvasH = await page.locator("#oncoCanvas").evaluate(c => c.height);
      ok("oncoprint canvas painted", canvasH > 100, "canvas height " + canvasH);

      // Examples tab: the documented analysis documents, rendered as a gallery.
      // The docs gate already proves each one RUNS; this proves the app can
      // launch them and that the federated views actually paint something.
      await page.goto(BASE + "/analysis");
      await page.locator("button:has-text('Examples')").first().click();
      await page.waitForSelector(".excard", { timeout: 120000 });
      const nCards = await page.locator(".excard").count();
      const { EXAMPLES } = await import("./lib/dsl-reference.ts");
      ok("examples gallery lists every documented example",
        nCards === EXAMPLES.length, nCards + " cards vs " + EXAMPLES.length + " examples");

      // one launch per federated view kind, asserting the view's own markup appears
      const launches = [
        ["Co-occurrence and mutual exclusivity in NSCLC", ".tend", "cooccurrence"],
        ["Co-expression from sums alone", ".rbar", "coexpression"],
        ["Lollipop plot: recurrent protein changes", ".lolliplot .dot", "hotspots lollipop"],
        ["Study-stratified survival across two studies", ".logrank", "survival log-rank"],
        ["Clinical attributes compared between cohorts", "h2:has-text('Clinical comparison')", "clinical"]
      ];
      // a multi-view document must render EVERY one of its views, not just the first
      await page.goto(BASE + "/analysis");
      await page.locator("button:has-text('Examples')").first().click();
      await page.waitForSelector(".excard", { timeout: 120000 });
      await page.locator(".excard").filter({ hasText: "One cohort, five ways" }).first()
        .locator("button:has-text('Run')").click();
      const multiWanted = [
        [".lolliplot .dot", "hotspots"], [".tend", "cooccurrence"],
        [".logrank", "survival log-rank"], ["h2:has-text('Clinical comparison')", "clinical"],
        ["h2:has-text('Compare')", "compare"]
      ];
      const multiMissing = [];
      for (const [sel, label] of multiWanted) {
        try { await page.waitForSelector(sel, { timeout: 240000 }); }
        catch { multiMissing.push(label); }
      }
      ok("multi-view example renders all 5 views", multiMissing.length === 0,
        multiMissing.length ? "missing: " + multiMissing.join(", ") : "hotspots + cooccurrence + compare + clinical + survival");

      for (const [title, sel, label] of launches) {
        await page.goto(BASE + "/analysis");
        await page.locator("button:has-text('Examples')").first().click();
        await page.waitForSelector(".excard", { timeout: 120000 });
        const card = page.locator(".excard").filter({ hasText: title }).first();
        await card.locator("button:has-text('Run')").click();
        let shown = true;
        try { await page.waitForSelector(sel, { timeout: 240000 }); }
        catch { shown = false; }
        ok("example runs and renders: " + label, shown,
          shown ? "" : "no " + sel + " after running “" + title + "”");
      }
    } else {
      await page.screenshot({ path: "shot-next-dark.png", fullPage: false });
    }
    ok(scheme + ": no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
  await browser.close();
  // Patient-data boundary gate: aggregate-only participants must never emit or
  // receive patient identifiers. See docs/DATA-BOUNDARY.md.
  try {
    const { execSync } = require("child_process");
    const out = execSync("node --test test/boundary.test.ts", { cwd: __dirname, encoding: "utf8", timeout: 120000 });
    const pass = /^# pass (\d+)/m.exec(out), fail = /^# fail (\d+)/m.exec(out);
    ok("patient-data boundary (" + (pass ? pass[1] : "?") + " checks)", !!fail && fail[1] === "0",
      fail && fail[1] !== "0" ? "BOUNDARY VIOLATION — see npm run test:boundary" : "");
  } catch (e) {
    ok("patient-data boundary", false, "boundary suite failed: " + String(e.message).slice(0, 160));
  }

  // DSL doc sync gate: docs/dsl.md must match lib/dsl-reference.js, and every
  // documented example must run against the live compiler.
  try {
    const { execSync } = require("child_process");
    const out = execSync("npm run --silent docs:check", { cwd: __dirname, encoding: "utf8", timeout: 180000 });
    for (const line of out.trim().split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || "")).trim();
    for (const line of out.split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
    if (!/^FAIL /m.test(out)) results.push("FAIL docs:check crashed: " + String(e.message).slice(0, 120));
  }
  console.log(results.join("\n"));
  process.exit(results.some(r => r.startsWith("FAIL")) ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(2); });
