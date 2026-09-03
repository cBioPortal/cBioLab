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

      // Explore's top action bar: build a draft by clicking a facet, then Analyze.
      // This is the main path from browsing to an analysis, so it is gated.
      await page.goto(BASE + "/analysis");
      await page.locator("button:has-text('Explore')").first().click();
      await page.waitForSelector(".exbar", { timeout: 120000 });
      // A study alone is a cohort — every patient in it — so Analyze must work
      // before any filtering, and the bar must say what it would analyse.
      let unfiltered = "";
      try {
        await page.waitForFunction(() => /every patient in/.test(document.querySelector(".exbar")?.textContent || ""),
          null, { timeout: 240000 });
        unfiltered = (await page.locator(".exbar").innerText()).replace(/\s+/g, " ").split(" Analyze")[0];
      } catch { /* left empty */ }
      const canAnalyseUnfiltered = !(await page.locator(".exbar button:has-text('Analyze')").isDisabled());
      ok("a study with no filters is analysable", canAnalyseUnfiltered && !!unfiltered, unfiltered || "bar never offered the unfiltered cohort");
      await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
      await page.locator(".valrow, .slice").first().click();
      let drafted = true;
      try {
        await page.waitForFunction(() => /patients match/.test(document.querySelector(".exbar")?.textContent || ""),
          null, { timeout: 240000 });
      } catch { drafted = false; }
      ok("clicking a facet builds a draft and counts it", drafted,
        drafted ? (await page.locator(".exbar").innerText()).replace(/\s+/g, " ").split(" Analyze")[0] : "no count appeared");
      await page.locator(".exbar input").fill("e2e explored cohort");
      await page.locator(".exbar button:has-text('Analyze')").click();
      let landed = false, views = [];
      try {
        await page.waitForFunction(() => document.querySelectorAll(".ana-grid .card h2").length > 1, null, { timeout: 300000 });
        views = (await page.locator(".ana-grid h2").allTextContents()).map(t => t.split("\u2014")[0].trim());
        const docText = await page.locator("textarea").first().inputValue();
        landed = Object.keys(JSON.parse(docText).cohorts || {}).includes("e2e explored cohort");
      } catch { /* landed stays false */ }
      ok("Analyze carries the cohort into a running analysis", landed && views.length > 1,
        landed ? views.join(" + ") : "cohort did not reach the document");

      // Analyze REPLACES the document rather than merging into it — a second
      // Analyze must not leave the first cohort behind.
      await page.locator(".tabs button:has-text('Explore')").click();
      await page.waitForSelector(".exbar", { timeout: 120000 });
      await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
      await page.locator(".valrow, .slice").nth(2).click();
      try {
        await page.waitForFunction(() => /patients match/.test(document.querySelector(".exbar")?.textContent || ""),
          null, { timeout: 240000 });
      } catch { /* count may already be shown */ }
      await page.locator(".exbar input").fill("e2e second cohort");
      await page.locator(".exbar button:has-text('Analyze')").click();
      let replaced = false, after = [];
      try {
        await page.waitForFunction(() => {
          const ta = document.querySelector("textarea");
          if (!ta) return false;
          try { return Object.keys(JSON.parse(ta.value).cohorts || {}).join() === "e2e second cohort"; }
          catch { return false; }
        }, null, { timeout: 300000 });
        after = Object.keys(JSON.parse(await page.locator("textarea").first().inputValue()).cohorts || {});
        replaced = after.length === 1 && after[0] === "e2e second cohort";
      } catch {
        try { after = Object.keys(JSON.parse(await page.locator("textarea").first().inputValue()).cohorts || {}); } catch {}
      }
      ok("a second Analyze resets the analysis instead of accumulating", replaced,
        replaced ? "document holds only the new cohort" : "document holds: " + (after.join(", ") || "?"));

      // Tabs are deep-linked: a refresh must land you where you were.
      await page.goto(BASE + "/analysis");
      await page.waitForSelector(".tabs button", { timeout: 120000 });
      await page.locator(".tabs button:has-text('Explore')").click();
      await page.waitForTimeout(400);
      const urlHasTab = /tab=explore/.test(await page.evaluate(() => location.search));
      await page.reload();
      await page.waitForSelector(".tabs button.active", { timeout: 120000 });
      const stayed = (await page.locator(".tabs button.active").innerText()).trim();
      ok("tabs survive a refresh", urlHasTab && stayed === "Explore", "?tab written: " + urlHasTab + ", after reload: " + stayed);

      // A ?doc= link still implies the analysis, but an explicit ?tab= wins.
      const linkDoc = { study: "msk_chord_2024", cohorts: { X: { all: [{ kind: "oql", q: "TP53: MUT" }] } }, views: [{ kind: "survival" }] };
      const enc = Buffer.from(JSON.stringify(linkDoc)).toString("base64url");
      await page.goto(BASE + "/analysis?tab=examples&doc=" + enc);
      await page.waitForTimeout(1800);
      ok("an explicit ?tab= beats the document's default tab",
        (await page.locator(".tabs button.active").innerText()).trim() === "Examples");

      // Cohorts tab: tick cohorts, submit them together. No per-row "add" links.
      await page.goto(BASE + "/analysis");
      await page.waitForSelector(".pick input", { timeout: 240000 });
      ok("cohort rows use checkboxes, not per-row add links",
        (await page.locator("button:has-text('add to analysis')").count()) === 0,
        (await page.locator(".pick input").count()) + " selectable cohorts");
      ok("submit is refused with nothing ticked",
        await page.locator("button:has-text('Analyze selected')").isDisabled());
      await page.locator(".pick input").nth(0).check();
      await page.locator(".pick input").nth(1).check();
      await page.locator("button:has-text('Analyze selected')").click();
      let together = [];
      try {
        await page.waitForFunction(() => document.querySelectorAll(".ana-grid .card h2").length > 1, null, { timeout: 300000 });
        together = Object.keys(JSON.parse(await page.locator("textarea").first().inputValue()).cohorts || {});
      } catch { /* left empty */ }
      ok("ticked cohorts are analysed together", together.length === 2, together.join(" + ") || "no document");

      // ...and a view can be added without editing the document JSON.
      let added = [], dots = 0;
      try {
        await page.waitForSelector(".addview", { timeout: 120000 });
        await page.locator(".addview button:has-text('Lollipop')").click();
        await page.waitForSelector(".lolliplot .dot", { timeout: 300000 });
        added = (JSON.parse(await page.locator("textarea").first().inputValue()).views || []).map(v => v.kind);
        dots = await page.locator(".lolliplot .dot").count();
      } catch { /* left empty */ }
      ok("a lollipop view can be added from the UI", added.includes("hotspots") && dots > 0,
        added.length ? added.join(", ") + " · " + dots + " dots" : "view was not added");

      // The oncoprint does not go through a resolver, so its provenance and its
      // query/render split are a separate code path — and the one most likely to
      // be left behind. This document (default views) actually contains one.
      const onco = await page.evaluate(() => {
        for (const card of document.querySelectorAll(".ana-grid .card")) {
          const h = card.querySelector("h2");
          if (!h || !h.textContent.trim().startsWith("Oncoprint")) continue;
          const chip = card.querySelector(".lat");
          return {
            found: true,
            queries: card.querySelectorAll(".provsql .provq").length,
            chip: chip ? chip.textContent.trim() : null,
            split: !!(chip && /draw\)/.test(chip.textContent))
          };
        }
        return { found: false };
      });
      // Views can be removed one at a time, and the document follows.
      let beforeN = 0, afterKinds = [];
      try {
        beforeN = (JSON.parse(await page.locator("textarea").first().inputValue()).views || []).length;
        await page.locator(".viewcard").first().locator(".removeview").click();
        await page.waitForFunction((n) => {
          try { return (JSON.parse(document.querySelector("textarea").value).views || []).length === n - 1; }
          catch { return false; }
        }, beforeN, { timeout: 300000 });
        afterKinds = (JSON.parse(await page.locator("textarea").first().inputValue()).views || []).map(v => v.kind);
      } catch { /* left empty */ }
      ok("a single view can be removed", beforeN > 0 && afterKinds.length === beforeN - 1,
        beforeN ? beforeN + " → " + afterKinds.length + " views (" + afterKinds.join(", ") + ")" : "no views to remove");

      ok("the oncoprint reports its own queries and separates draw time",
        onco.found && onco.queries > 0 && onco.split,
        onco.found ? onco.queries + " queries · " + onco.chip : "no oncoprint view on the page");

      // The survival basis (endpoint + what the clock starts from) is a control,
      // not a JSON edit — and changing it must actually change the analysis.
      const survDoc = { study: "msk_chord_2024",
        cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
                   "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] } },
        views: [{ kind: "survival" }] };
      await page.goto(BASE + "/analysis?tab=analysis&doc=" + Buffer.from(JSON.stringify(survDoc)).toString("base64url"));
      let basis = { types: 0, changed: false, truncated: false, anchor: null };
      try {
        await page.waitForSelector(".basis", { timeout: 300000 });
        await page.waitForFunction(() => document.querySelectorAll(".basis select")[1]?.options.length > 2, null, { timeout: 180000 });
        basis.types = await page.locator(".basis select").nth(1).locator("option").count();
        const before = await page.locator(".logrank").innerText();
        await page.locator(".basis select").nth(1).selectOption("Treatment");
        await page.waitForFunction(() => document.querySelector(".trunc") !== null, null, { timeout: 300000 });
        await page.waitForFunction((b) => {
          const el = document.querySelector(".logrank");
          return el && el.textContent.trim() !== b;
        }, before.trim(), { timeout: 300000 });
        basis.truncated = (await page.locator(".trunc").count()) > 0;
        basis.anchor = JSON.parse(await page.locator("textarea").first().inputValue()).views[0].anchor;
        basis.changed = true;
      } catch { /* left as-is */ }
      ok("survival basis is changeable from a control", basis.changed && basis.truncated && !!basis.anchor,
        basis.changed ? basis.types + " anchor options · became " + JSON.stringify(basis.anchor) + " · left-truncated"
                      : "control did not drive a re-run");

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

      // Every visualization must say whether patient-level data was involved.
      // A new view kind that forgets the marker fails here rather than shipping
      // a chart whose provenance the reader has to guess at.
      const marker = await page.evaluate(() => {
        const KNOWN = ["Compare", "Survival", "Co-occurrence", "Clinical comparison", "Co-expression", "Hotspots", "Oncoprint"];
        const missing = [], seen = [];
        for (const card of document.querySelectorAll(".ana-grid .card")) {
          const h = card.querySelector("h2");
          if (!h) continue;
          const name = KNOWN.find(k => h.textContent.trim().startsWith(k));
          if (!name) continue;                       // "The document" and other non-view cards
          seen.push(name);
          const b = card.querySelector(".partbadge");
          if (!b || !b.getAttribute("title")) missing.push(name);
        }
        return { seen, missing };
      });
      // and each must show the aggregate SQL that produced its numbers
      const prov = await page.evaluate(() => {
        const KNOWN = ["Compare", "Survival", "Co-occurrence", "Clinical comparison", "Co-expression", "Hotspots", "Oncoprint"];
        const missing = [], counts = [];
        for (const card of document.querySelectorAll(".ana-grid .card")) {
          const h = card.querySelector("h2");
          if (!h) continue;
          const name = KNOWN.find(k => h.textContent.trim().startsWith(k));
          if (!name) continue;
          const n = card.querySelectorAll(".provsql .provq").length;
          if (!n) missing.push(name); else counts.push(name + ":" + n);
        }
        return { missing, counts };
      });
      // ...and what it cost, at every level: per view, per query, and in total
      const lat = await page.evaluate(() => {
        const KNOWN = ["Compare", "Survival", "Co-occurrence", "Clinical comparison", "Co-expression", "Hotspots", "Oncoprint"];
        const per = [], missing = [];
        for (const card of document.querySelectorAll(".ana-grid .card")) {
          const h = card.querySelector("h2");
          if (!h) continue;
          const name = KNOWN.find(k => h.textContent.trim().startsWith(k));
          if (!name) continue;
          const chip = card.querySelector(".lat");
          if (!chip || !/^\d[\d,]*ms$/.test(chip.textContent.trim())) missing.push(name);
          else per.push(name + " " + chip.textContent.trim());
        }
        const totalEl = [...document.querySelectorAll(".meta")].map(e => e.textContent).find(t => /ms · OncoKB/.test(t));
        return { per, missing, total: totalEl || null };
      });
      ok("every view reports its own latency, and the run reports a total",
        lat.missing.length === 0 && lat.per.length >= 5 && !!lat.total,
        lat.missing.length ? "no latency on: " + lat.missing.join(", ") : lat.per.join(" · ") + " | total " + lat.total);

      ok("every view shows the SQL that produced its numbers", prov.missing.length === 0,
        prov.missing.length ? "no query provenance on: " + prov.missing.join(", ") : prov.counts.join(" "));

      ok("every visualization carries a participation marker",
        marker.seen.length >= 5 && marker.missing.length === 0,
        marker.missing.length ? "missing on: " + marker.missing.join(", ") : marker.seen.length + " views marked");

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
