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

    // "/" no longer serves the standalone query-builder UI — it redirects into
    // the Analysis app, which subsumes it. Verify the redirect itself once
    // (scheme-independent) and use /analysis as the base for both passes below.
    const rootResp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    ok(scheme + ": / redirects into the app", /\/analysis(\?|$)/.test(page.url()) && rootResp.ok(),
      page.url() + " status " + rootResp.status());
    await page.waitForSelector(".tabs button", { timeout: 90000 });
    ok(scheme + ": app shell loads", (await page.locator(".tabs button").count()) >= 4);

    if (scheme === "light") {
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

      // The old routes stay gone rather than silently reappearing. Hitting a
      // dead route deliberately logs its own 404 resource error — expected, not
      // a regression — so it is filtered out of the shared error tally rather
      // than polluting the "no JS errors" check below.
      const errsBefore404 = errors.length;
      const oldOnco = await page.goto(BASE + "/oncoprint", { waitUntil: "domcontentloaded" });
      ok("deleted /oncoprint route stays gone", oldOnco.status() === 404, "status " + oldOnco.status());
      errors.splice(errsBefore404, errors.length - errsBefore404,
        ...errors.slice(errsBefore404).filter(e => !/404/.test(e)));

      // /rationale renders RATIONALE.md, including its Mermaid architecture
      // diagram as real SVG (not a leftover code fence — that would mean the
      // client-side render failed and silently fell back). Console errors here
      // are still caught by the scheme-wide "no JS errors" check below.
      await page.goto(BASE + "/rationale");
      let rationaleOk = false, rationaleInfo = "";
      try {
        await page.waitForSelector(".rationale-doc h1", { timeout: 60000 });
        await page.waitForFunction(() => document.querySelector(".mermaid-diagram svg") !== null, null, { timeout: 30000 });
        const svgCount = await page.locator(".mermaid-diagram svg").count();
        const fallback = await page.locator(".mermaid-fallback").count();
        const backLink = await page.locator(".rationale-nav a").getAttribute("href");
        rationaleOk = svgCount > 0 && fallback === 0 && backLink === "/analysis";
        rationaleInfo = "svg=" + svgCount + " fallback=" + fallback + " backLink=" + backLink;
      } catch (e) { rationaleInfo = String(e.message || e).slice(0, 100); }
      ok("/rationale renders with a live Mermaid diagram", rationaleOk, rationaleInfo);
      await page.goto(BASE + "/analysis");
      await page.waitForSelector("header a", { timeout: 60000 });
      const headerLinks = await page.locator("header a").allTextContents();
      ok("header nav points only at /rationale (oncoprint/builder links removed)",
        headerLinks.some(t => /rationale/i.test(t)) && !headerLinks.some(t => /^oncoprint$|^builder$/i.test(t)),
        headerLinks.join(", "));

      // Derived facets: computed from the data's shape, so they must appear for a
      // study regardless of how it names its events, and clicking must filter.
      await page.goto(BASE + "/analysis?tab=explore");
      await page.waitForSelector(".exbar", { timeout: 120000 });
      let der = { facets: 0, filtered: false };
      try {
        await page.waitForFunction(() => [...document.querySelectorAll("h2")].some(h => h.textContent.startsWith("Derived")),
          null, { timeout: 240000 });
        der.facets = await page.locator(".derivedgrid > div").count();
        const before = (await page.locator(".exbar").innerText()).trim();
        await page.locator(".derivedgrid .valrow").first().click();
        await page.waitForFunction((b) => (document.querySelector(".exbar")?.textContent || "").trim() !== b,
          before, { timeout: 240000 });
        // the draft JSON lives on the Cohorts tab; here the observable effects are
        // the filter count in the action bar and the bucket showing as selected
        const barSaysFiltered = /\d+ filter/.test(await page.locator(".exbar").innerText());
        const bucketSelected = (await page.locator(".derivedgrid .valrow.on").count()) > 0;
        der.filtered = barSaysFiltered && bucketSelected;
      } catch { /* left as-is */ }
      // the attribute expander belongs to the Clinical card, not the gap between columns
      const expanderPlaced = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(b2 => /more attributes/.test(b2.textContent));
        if (!btn) return null;
        const card = btn.closest(".card");
        if (!card) return { inCard: false };
        const br = btn.getBoundingClientRect(), cr = card.getBoundingClientRect();
        return { inCard: true, clinical: /counted in each attribute/.test(card.textContent),
          within: br.left >= cr.left && br.right <= cr.right && br.bottom <= cr.bottom + 1 };
      });
      // Categorical values are shown in full and scrolled, not trimmed to a few;
      // and the ranked lists carry no inline bar charts.
      const vals = await page.evaluate(() => {
        const lists = [...document.querySelectorAll(".vallist")];
        const big = lists.map(l => ({
          rows: l.querySelectorAll(".valrow").length,
          scrolls: l.scrollHeight > l.clientHeight + 2,
          capped: [...l.querySelectorAll("span")].some(s2 => /showing .* of .* values/.test(s2.textContent || ""))
        })).sort((a, b) => b.rows - a.rows)[0];
        return { lists: lists.length, big, bars: document.querySelectorAll(".vbar").length };
      });
      ok("categorical values are shown in full, scrolled rather than trimmed",
        !!vals.big && vals.big.rows > 20 && vals.big.scrolls,
        vals.big ? vals.big.rows + " values in the largest list, scrolls=" + vals.big.scrolls +
          (vals.big.capped ? ", cap disclosed" : "") : "no value lists");
      // the proportion rules are a hint, not a chart — guard against them growing
      const barBox = await page.evaluate(() => {
        const b2 = document.querySelector(".valrow .vbar");
        if (!b2) return null;
        const r = b2.getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width) };
      });
      ok("value bars stay small", !!vals.bars && !!barBox && barBox.h <= 5 && barBox.w <= 80,
        barBox ? vals.bars + " bars, " + barBox.w + "x" + barBox.h + "px" : "no bars found");

      ok("the attribute expander sits inside the Clinical card",
        !expanderPlaced || (expanderPlaced.inCard && expanderPlaced.clinical && expanderPlaced.within),
        expanderPlaced ? JSON.stringify(expanderPlaced) : "no expander (all attributes shown)");

      ok("derived facets appear and filter", der.facets >= 2 && der.filtered,
        der.facets + " derived facets" + (der.filtered ? ", click added a derived clause" : ", click did not filter"));

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

      // A facet's SHAPE must not depend on the draft. Narrowing a cohort drops an
      // attribute's distinct-value count, so keying pie-vs-list off it made
      // attributes flip shape on an unrelated click and the page rearrange itself
      // while being read. The basis is now the cardinality over the SELECTED
      // studies with no draft applied, carried at the top level of the result
      // rather than per facet — a facet vanishes from the merge once the draft
      // empties its study, which made the per-facet value move too.
      const facetShapes = async () => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll("[data-attr]")].map(el =>
          [el.getAttribute("data-attr"), el.getAttribute("data-shape")])));
      let shapeChanges = -1, shapeDetail = "no facets rendered";
      try {
        await page.waitForSelector("[data-attr]", { timeout: 120000 });
        await page.waitForTimeout(1500);
        const before = await facetShapes();
        const key = page.locator(".pielegend .pikey").first();
        if (await key.count()) {
          await key.click();
          await page.waitForTimeout(6000);
          const after = await facetShapes();
          const common = Object.keys(before).filter(k => k in after);
          const moved = common.filter(k => before[k] !== after[k]);
          shapeChanges = moved.length;
          shapeDetail = common.length + " attributes compared" +
            (moved.length ? ", changed: " + moved.map(k => k + " " + before[k] + "->" + after[k]).join(", ") : "");
        }
      } catch (e) { shapeDetail = String(e.message).split("\n")[0]; }
      ok("clicking a facet value never changes another attribute's shape", shapeChanges === 0, shapeDetail);

      // Derived facets must stay fully selectable after a pick. A metric already
      // in the draft is counted WITHOUT its own clauses (disjunctive faceting, as
      // the clinical facets get); without that, choosing one bucket re-counted
      // every bucket under that very filter, the rest came back empty, and the
      // zero-count filter deleted them — so the options vanished and the choice
      // could not be widened or changed.
      let derivedDetail = "no derived facets rendered", derivedOk = false;
      try {
        await page.waitForSelector("[data-derived]", { timeout: 60000 });
        const snap = () => page.evaluate(() => [...document.querySelectorAll("[data-derived]")]
          .map(el => el.getAttribute("data-derived") + ":" + el.getAttribute("data-buckets")));
        const before = await snap();
        const row = page.locator("[data-derived] .valrow").first();
        if (await row.count()) {
          await row.click();
          await page.waitForTimeout(9000);
          const after = await snap();
          // ...and a SECOND bucket of the same metric must OR, not AND: two
          // mutually exclusive ranges ANDed give 0 patients, which empties every
          // other facet too.
          await page.locator("[data-derived] .valrow").nth(1).click();
          await page.waitForTimeout(9000);
          const after2 = await snap();
          const sel = await page.locator("[data-derived] .valrow.on").count();
          const kept = JSON.stringify(before) === JSON.stringify(after) &&
                       JSON.stringify(before) === JSON.stringify(after2);
          derivedOk = kept && sel === 2;
          derivedDetail = "buckets " + before.join(" ") + " -> " + after2.join(" ") + ", " + sel + " selected";
        }
      } catch (e) { derivedDetail = String(e.message).split("\n")[0]; }
      ok("picking a derived bucket keeps the other buckets selectable", derivedOk, derivedDetail);

      // The bar is deliberately spare: no Draft-cohort card, no gene finder, and
      // no name box — naming is asked for when you save, so nothing in the bar
      // suggests Analyze needs a name too.
      const noDraftCard = (await page.locator("h2:has-text('Draft cohort')").count()) === 0;
      const noGeneFinder = (await page.locator("input[placeholder='gene symbol…']").count()) === 0;
      const noNameBox = (await page.locator('.exbar input[placeholder="name…"]').count()) === 0;
      ok("the explore bar carries only its two actions",
        noDraftCard && noGeneFinder && noNameBox,
        "no card: " + noDraftCard + ", no gene finder: " + noGeneFinder + ", no name box: " + noNameBox);
      await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
      await page.locator(".valrow, .slice").first().click();
      let drafted = true;
      try {
        await page.waitForFunction(() => /patients match/.test(document.querySelector(".exbar")?.textContent || ""),
          null, { timeout: 240000 });
      } catch { drafted = false; }
      ok("clicking a facet builds a draft and counts it", drafted,
        drafted ? (await page.locator(".exbar").innerText()).replace(/\s+/g, " ").split(" Analyze")[0] : "no count appeared");
      await page.locator(".exbar button:has-text('Analyze')").click();
      let landed = false, views = [];
      try {
        await page.waitForFunction(() => document.querySelectorAll(".ana-grid .card h2").length > 1, null, { timeout: 300000 });
        views = (await page.locator(".ana-grid h2").allTextContents()).map(t => t.split("\u2014")[0].trim());
        const docText = await page.locator("#docjson").inputValue();
        // Named from the draft itself now that the bar has no name field.
        landed = Object.keys(JSON.parse(docText).cohorts || {}).length === 1;
      } catch { /* landed stays false */ }
      ok("Analyze carries the cohort into a running analysis", landed && views.length > 1,
        landed ? views.join(" + ") : "cohort did not reach the document");

      // Saving asks for the name when you ask to save. The dialog is native
      // <dialog>, so Esc and the backdrop come from the platform.
      await page.locator(".tabs button:has-text('Explore')").click();
      await page.waitForSelector(".exbar", { timeout: 120000 });
      await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
      let saveFlow = "dialog never opened";
      let savedOk = false;
      try {
        await page.locator(".exbar button:has-text('Save as a Cohort')").click();
        await page.waitForSelector("dialog.namedialog:not(.wsdialog)[open]", { timeout: 30000 });
        const prefilled = await page.locator("dialog.namedialog:not(.wsdialog) input").inputValue();
        // Esc must dismiss without saving
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        const closedOnEsc = (await page.locator("dialog.namedialog:not(.wsdialog)[open]").count()) === 0;
        await page.locator(".exbar button:has-text('Save as a Cohort')").click();
        await page.waitForSelector("dialog.namedialog:not(.wsdialog)[open]", { timeout: 30000 });
        await page.locator("dialog.namedialog:not(.wsdialog) input").fill("e2e dialog cohort");
        await page.locator("dialog.namedialog:not(.wsdialog) button:has-text('Save')").click();
        await page.waitForFunction(() => /saved/.test(document.querySelector(".exbar")?.textContent || ""),
          null, { timeout: 120000 });
        await page.locator(".tabs button:has-text('Cohorts')").click();
        await page.waitForTimeout(1500);
        const inList = await page.locator("text=e2e dialog cohort").count();
        savedOk = !!prefilled && closedOnEsc && inList > 0;
        saveFlow = "prefilled '" + prefilled + "', esc closed: " + closedOnEsc + ", in Cohorts: " + (inList > 0);
      } catch (e) { saveFlow = String(e.message).split("\n")[0]; }
      ok("Save asks for a name in a dialog and stores the cohort", savedOk, saveFlow);

      // Analyze REPLACES the document rather than merging into it. Load a
      // DIFFERENTLY-named cohort first, so replacement is provable: the bar now
      // derives the name from the draft, so two Analyze runs share a name and
      // counting cohorts could not tell replace from overwrite.
      await page.locator(".tabs button:has-text('Cohorts')").click();
      await page.waitForSelector(".pick input", { timeout: 240000 });
      let seeded = [];
      try {
        await page.locator(".pick input").nth(0).check();
        await page.locator("button:has-text('Analyze selected')").click();
        await page.waitForFunction(() => document.querySelectorAll(".ana-grid .card h2").length > 0, null, { timeout: 300000 });
        seeded = Object.keys(JSON.parse(await page.locator("#docjson").inputValue()).cohorts || {});
      } catch { /* left empty */ }
      await page.locator(".tabs button:has-text('Explore')").click();
      await page.waitForSelector(".exbar", { timeout: 120000 });
      await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
      await page.locator(".valrow, .slice").nth(2).click();
      try {
        await page.waitForFunction(() => /patients match/.test(document.querySelector(".exbar")?.textContent || ""),
          null, { timeout: 240000 });
      } catch { /* count may already be shown */ }
      await page.locator(".exbar button:has-text('Analyze')").click();
      let replaced = false, after = [];
      try {
        await page.waitForFunction((gone) => {
          const ta = document.querySelector("#docjson");
          if (!ta) return false;
          try {
            const names = Object.keys(JSON.parse(ta.value).cohorts || {});
            return names.length === 1 && !names.includes(gone);
          } catch { return false; }
        }, seeded[0] || "", { timeout: 300000 });
        after = Object.keys(JSON.parse(await page.locator("#docjson").inputValue()).cohorts || {});
        replaced = after.length === 1 && !after.includes(seeded[0]);
      } catch {
        try { after = Object.keys(JSON.parse(await page.locator("#docjson").inputValue()).cohorts || {}); } catch {}
      }
      ok("a second Analyze resets the analysis instead of accumulating", replaced && seeded.length === 1,
        replaced ? "replaced \u201c" + seeded[0] + "\u201d with \u201c" + after[0] + "\u201d"
                 : "seeded: " + (seeded.join(", ") || "?") + " -> document holds: " + (after.join(", ") || "?"));

      // A view's genes are editable in the app. They used to be settable only by
      // hand-editing the document JSON — addView seeded them and nothing could
      // change them afterwards — which made "pick genes on the Analysis page"
      // untrue for every gene-bearing view.
      let geneEdit = "no compare view rendered", geneOk = false;
      try {
        await page.goto(BASE + "/analysis?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
          views: [{ kind: "compare", genes: ["TP53", "KRAS", "EGFR"] }]
        })).toString("base64")));
        await page.waitForSelector("button.genesbtn", { timeout: 300000 });
        await page.locator("button.genesbtn").first().click();
        await page.waitForSelector("dialog.genedialog[open]", { timeout: 30000 });
        const panel = page.locator("dialog.genedialog");
        const before = await panel.locator(".pill").count();
        await panel.locator("input[list=view-genes]").fill("PIK3CA");
        await panel.locator('button:has-text("add")').click();
        const genesNow = async () => page.evaluate(() => {
          const v = (JSON.parse(document.querySelector("#docjson").value).views || [])
            .find((x) => x.kind === "compare");
          return (v && v.genes) || [];
        });
        await page.waitForFunction(() => {
          const ta = document.querySelector("#docjson"); if (!ta) return false;
          try { return (JSON.parse(ta.value).views || [])
            .some((v) => v.kind === "compare" && (v.genes || []).includes("PIK3CA")); }
          catch { return false; }
        }, null, { timeout: 300000 });
        const added = await genesNow();
        // appended, not replaced — reading the RESULT's `genes` field instead of
        // the document's once wiped the list down to the one just typed
        const appended = added.length === before + 1 && added.includes("TP53");
        await panel.locator(".pill", { hasText: "KRAS" }).first().click();
        await page.waitForFunction(() => {
          const ta = document.querySelector("#docjson"); if (!ta) return false;
          try { return !(JSON.parse(ta.value).views || [])
            .some((v) => v.kind === "compare" && (v.genes || []).includes("KRAS")); }
          catch { return false; }
        }, null, { timeout: 300000 });
        const afterRemove = await genesNow();
        geneOk = appended && !afterRemove.includes("KRAS") && afterRemove.includes("PIK3CA");
        geneEdit = before + " genes -> " + added.join(",") + " -> " + afterRemove.join(",");
      } catch (e) { geneEdit = String(e.message).split("\n")[0]; }
      ok("a view's genes can be changed without editing JSON", geneOk, geneEdit);

      // The oncoprint's gear keeps ONLY the link out to cBioPortal; genes moved
      // to a named button and a modal, so the gear is not where editing hides.
      let gearSplit = "no oncoprint rendered", gearOk = false;
      try {
        await page.goto(BASE + "/analysis?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
          views: [{ kind: "oncoprint", genes: ["TP53", "KRAS"] }]
        })).toString("base64")));
        await page.waitForSelector('summary[title="oncoprint options"]', { timeout: 300000 });
        const namedButton = await page.locator("button.genesbtn").first().innerText();
        await page.locator('summary[title="oncoprint options"]').click();
        const gear = page.locator('details:has(summary[title="oncoprint options"]) .gearmenu-items');
        const gearHasEditor = (await gear.locator(".pillwrap").count()) > 0;
        const gearHasLink = (await gear.locator('a:has-text("cBioPortal")').count()) > 0;
        gearOk = namedButton.trim() === "genes" && !gearHasEditor && gearHasLink;
        gearSplit = "button '" + namedButton.trim() + "', gear has editor: " + gearHasEditor +
          ", gear has portal link: " + gearHasLink;
      } catch (e) { gearSplit = String(e.message).split("\n")[0]; }
      ok("genes are a named button; the gear keeps only the cBioPortal link", gearOk, gearSplit);

      // A workspace is the whole document — figures, notes and parameters — saved
      // under a name and reopened after a full reload. And a template retargets
      // in ONE edit: change $genes and every view that refers to it follows.
      let wsFlow = "workspace bar never rendered", wsOk = false;
      try {
        await page.goto(BASE + "/analysis?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
          views: [{ kind: "compare", genes: ["TP53", "KRAS"], note: "Frequencies first." },
                  { kind: "cooccurrence", genes: ["TP53", "KRAS"] }]
        })).toString("base64")));
        await page.waitForSelector(".wsbar", { timeout: 300000 });
        await page.waitForSelector(".viewnote", { timeout: 300000 });
        const noteShown = (await page.locator(".viewnote").first().innerText()).includes("Frequencies first");

        // lift study + the shared gene list into parameters
        await page.locator('button:has-text("make a template")').click();
        await page.waitForSelector(".params", { timeout: 300000 });
        const readDoc = () => page.evaluate(() => JSON.parse(document.querySelector("#docjson").value));
        await page.waitForFunction(() => {
          const t = document.querySelector("#docjson"); if (!t) return false;
          try { const d = JSON.parse(t.value); return !!(d.params && d.params.genes); } catch { return false; }
        }, null, { timeout: 300000 });
        const templated = await readDoc();
        const lifted = templated.study === "$study" &&
          templated.views.every((v) => v.genes === "$genes");

        // retarget through the parameter control
        const genesRow = page.locator(".paramrow", { hasText: "$genes" });
        await genesRow.locator("input").fill("BRAF");
        await genesRow.locator("input").press("Enter");
        await page.waitForFunction(() => {
          const t = document.querySelector("#docjson"); if (!t) return false;
          try { return (JSON.parse(t.value).params.genes || []).includes("BRAF"); } catch { return false; }
        }, null, { timeout: 300000 });
        // every view followed the one edit
        await page.waitForFunction(() => {
          const tds = [...document.querySelectorAll(".ana-grid table tbody tr td:first-child")];
          return tds.some((td) => (td.textContent || "").trim() === "BRAF");
        }, null, { timeout: 300000 });

        // notes live in the workspace section, which appears once there is
        // something to manage (here: the parameters just lifted)
        await page.waitForSelector(".wscard", { timeout: 60000 });
        await page.locator(".wscard textarea").fill("e2e workspace notes");
        await page.locator('.wsbar button:has-text("Save workspace")').click();
        await page.waitForSelector("dialog.wsdialog[open]", { timeout: 30000 });
        await page.locator("dialog.wsdialog input").fill("e2e workspace");
        await page.locator('dialog.wsdialog button:has-text("Save")').click();
        await page.waitForTimeout(2000);

        // a FULL reload, then reopen it
        await page.goto(BASE + "/analysis?tab=analysis");
        await page.waitForSelector(".wsbar select", { timeout: 300000 });
        await page.locator(".wsbar select").selectOption("e2e workspace");
        await page.waitForFunction(() => {
          const t = document.querySelector("#docjson"); if (!t) return false;
          try { return JSON.parse(t.value).title === "e2e workspace"; } catch { return false; }
        }, null, { timeout: 300000 });
        const reopened = await readDoc();
        const restored = reopened.notes === "e2e workspace notes" &&
          (reopened.params.genes || []).includes("BRAF") &&
          reopened.views.length === 2;
        // the section is the FIRST thing in the column it describes, and says
        // when the document has moved on from what was stored
        const atTop = await page.evaluate(() => {
          const col = document.querySelectorAll(".ana-grid > div")[1];
          return !!(col && col.firstElementChild && col.firstElementChild.classList.contains("wscard"));
        });
        wsOk = noteShown && lifted && restored && atTop;
        wsFlow = "note: " + noteShown + ", lifted: " + lifted + ", restored after reload: " + restored +
          ", section at top: " + atTop;
      } catch (e) { wsFlow = String(e.message).split("\n")[0]; }
      ok("a workspace saves, retargets by one parameter, and survives a reload", wsOk, wsFlow);

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
        together = Object.keys(JSON.parse(await page.locator("#docjson").inputValue()).cohorts || {});
      } catch { /* left empty */ }
      ok("ticked cohorts are analysed together", together.length === 2, together.join(" + ") || "no document");

      // ...and a view can be added without editing the document JSON.
      let added = [], dots = 0;
      try {
        await page.waitForSelector(".addview", { timeout: 120000 });
        await page.locator(".addview button:has-text('Lollipop')").click();
        await page.waitForSelector(".lolliplot .dot", { timeout: 300000 });
        added = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).map(v => v.kind);
        dots = await page.locator(".lolliplot .dot").count();
      } catch { /* left empty */ }
      ok("a lollipop view can be added from the UI", added.includes("hotspots") && dots > 0,
        added.length ? added.join(", ") + " · " + dots + " dots" : "view was not added");

      // The oncoprint does not go through a resolver, so its provenance is a separate
      // code path — and the one most likely to be left behind. It is also the one view
      // the BROWSER draws, from the binary contract, so the card must hold a canvas and
      // the SQL that produced it. This document (default views) actually contains one.
      const onco = await page.evaluate(() => {
        for (const card of document.querySelectorAll(".ana-grid .card")) {
          const h = card.querySelector("h2");
          if (!h || !h.textContent.trim().startsWith("Oncoprint")) continue;
          const chip = card.querySelector(".lat");
          const cv = card.querySelector("canvas");
          return {
            found: true,
            queries: card.querySelectorAll(".provsql .provq").length,
            chip: chip ? chip.textContent.trim() : null,
            drawn: !!(cv && cv.width > 100 && cv.height > 20)
          };
        }
        return { found: false };
      });
      // Views can be removed one at a time, and the document follows.
      let beforeN = 0, afterKinds = [];
      try {
        beforeN = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).length;
        await page.locator(".viewcard").first().locator(".removeview").click();
        await page.waitForFunction((n) => {
          try { return (JSON.parse(document.querySelector("#docjson").value).views || []).length === n - 1; }
          catch { return false; }
        }, beforeN, { timeout: 300000 });
        afterKinds = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).map(v => v.kind);
      } catch { /* left empty */ }
      ok("a single view can be removed", beforeN > 0 && afterKinds.length === beforeN - 1,
        beforeN ? beforeN + " → " + afterKinds.length + " views (" + afterKinds.join(", ") + ")" : "no views to remove");

      ok("the oncoprint draws in the browser and reports the SQL behind it",
        onco.found && onco.queries > 0 && onco.drawn,
        onco.found ? onco.queries + " queries · " + onco.chip + " · canvas " + (onco.drawn ? "drawn" : "MISSING") : "no oncoprint view on the page");

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
        basis.anchor = JSON.parse(await page.locator("#docjson").inputValue()).views[0].anchor;
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
