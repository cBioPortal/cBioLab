// The analysis page: tabs and ?doc= links, saved cohorts analysed together, adding and removing views, the oncoprint's provenance, the survival basis control.
const { addViewKind } = require("./helpers.cjs");

async function analysisPage({ ok, BASE, page, scheme }) {
  // A workspace is the whole document — figures, notes and parameters — saved
  // under a name and reopened after a full reload. And a template retargets
  // in ONE edit: change $genes and every view that refers to it follows.
  //
  // DISABLED: the workspace controls (.wsbar — save/open/make-a-template) are
  // hidden in the UI for now (app/lab/page.tsx, `{false && (...)}`), so this
  // flow has no UI path to drive it. Re-enable once that section returns —
  // until then this would just hang on `.wsbar` for 5 minutes and fail.

  // Tabs are deep-linked: a refresh must land you where you were.
  await page.goto(BASE + "/lab");
  await page.waitForSelector("[aria-label='lab sections'] [role=tab]", { timeout: 120000 });
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.waitForTimeout(400);
  const urlHasTab = /tab=explore/.test(await page.evaluate(() => location.search));
  await page.reload();
  // scoped to the lab's own tab list: the "+ Add chart" dialog carries tabs of its own
  await page.waitForSelector("[aria-label='lab sections'] [role=tab][aria-selected=true]", { timeout: 120000 });
  const stayed = (await page.locator("[aria-label='lab sections'] [role=tab][aria-selected=true]").innerText()).trim();
  ok("tabs survive a refresh", urlHasTab && stayed === "Explore", "?tab written: " + urlHasTab + ", after reload: " + stayed);

  // A ?doc= link still implies the analysis, but an explicit ?tab= wins.
  const linkDoc = { study: "msk_chord_2024", cohorts: { X: { all: [{ kind: "oql", q: "TP53: MUT" }] } }, views: [{ kind: "survival" }] };
  const enc = Buffer.from(JSON.stringify(linkDoc)).toString("base64url");
  await page.goto(BASE + "/lab?tab=examples&doc=" + enc);
  await page.waitForTimeout(1800);
  ok("an explicit ?tab= beats the document's default tab",
    (await page.locator("header a.toplink[aria-current=page]").innerText()).trim() === "examples");

  // Cohorts tab: tick cohorts, submit them together. No per-row "add" links. The example
  // cohorts live on the Examples page, so two saved cohorts are what get ticked here.
  for (const [n, q] of [["e2e pick KRAS " + scheme, "KRAS: MUT"], ["e2e pick TP53 " + scheme, "TP53: MUT"]])
    await page.context().request.post(BASE + "/api/artifacts", { data: { kind: "cohort", name: n, definition: { study: "msk_chord_2024", all: [{ kind: "oql", q }] } } });
  await page.goto(BASE + "/lab");
  await page.locator("header a.savedbtn").click();   // the saved-work manager, over the lab
  await page.waitForSelector("[role=checkbox].cohortpick", { timeout: 240000 });
  ok("cohort rows use checkboxes, not per-row add links",
    (await page.locator("button:has-text('add to analysis')").count()) === 0,
    (await page.locator("[role=checkbox].cohortpick").count()) + " selectable cohorts");
  ok("submit is refused with nothing ticked",
    await page.locator("button:has-text('Analyze selected')").isDisabled());
  await page.locator("[role=checkbox].cohortpick").nth(0).check();
  await page.locator("[role=checkbox].cohortpick").nth(1).check();
  await page.locator("button:has-text('Analyze selected')").click();
  let together = [], startViews = -1;
  try {
    await page.waitForFunction(() => document.querySelectorAll(".cohortbox").length === 2, null, { timeout: 300000 });
    const d = JSON.parse(await page.locator("#docjson").inputValue());
    together = Object.keys(d.cohorts || {});
    startViews = (d.views || []).length;
  } catch { /* left empty */ }
  ok("ticked cohorts are analysed together, with no views until the reader adds one", together.length === 2 && startViews === 0,
    (together.join(" + ") || "no document") + " · " + startViews + " views");

  // Views come in from "Add a view", each then given a cohort from its "+ Add cohort".
  for (const kind of ["survival", "oncoprint"]) {
    try {
      await addViewKind(page, kind);
      await page.locator(".emptyview .emptyview-body button").first().click();
      await page.locator(".addcohortdialog .acd-row button").first().click();
      await page.waitForFunction(() => !document.querySelector(".emptyview"), null, { timeout: 60000 });
    } catch { /* the checks below report what is missing */ }
  }

  // ...and a view can be added without editing the document JSON. It arrives empty, saying so,
  // and draws once a cohort of the analysis is added to it from its "+ Add cohort".
  let added = [], dots = 0, emptyFirst = false, drew = [];
  try {
    await page.waitForSelector(".addview", { timeout: 120000 });
    await addViewKind(page, "hotspots");
    await page.waitForSelector(".emptyview .emptyview-body button", { timeout: 30000 });
    added = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).map(v => v.kind);
    emptyFirst = (await page.locator(".lp-plot circle.lollipop-head").count()) === 0;
    await page.locator(".emptyview .emptyview-body button").first().click();
    await page.locator(".addcohortdialog .acd-row button").first().click();
    await page.waitForSelector(".lp-plot circle.lollipop-head", { timeout: 300000 });
    dots = await page.locator(".lp-plot circle.lollipop-head").count();
    drew = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).find(v => v.kind === "hotspots")?.cohorts || [];
  } catch { /* left empty */ }
  ok("a lollipop view can be added from the UI, empty until a cohort is added to it",
    added.includes("hotspots") && emptyFirst && drew.length === 1 && dots > 0,
    added.length ? added.join(", ") + " · empty first: " + emptyFirst + " · draws " + (drew.join(", ") || "nothing") + " · " + dots + " dots" : "view was not added");

  // Each cohort card names the studies it was queried in, with all of them in its tooltip.
  const studyLines = await page.$$eval(".cohortbox", bs => bs.map(b => {
    const el = b.querySelector(".cohortbox-studies");
    return el ? { text: el.textContent.trim(), title: el.dataset.tip } : null;
  }));
  ok("each cohort in the summary says which studies it queried",
    studyLines.length > 0 && studyLines.every(s => s && s.text && s.title),
    studyLines.map(s => s ? s.text : "missing").join(" | "));

  // The view buttons only add: a second click on a kind already in the document adds another of
  // it (undone here, so the checks below see the document as it was).
  let kinds2 = [], undone = [];
  try {
    const kinds = () => page.locator("#docjson").inputValue().then((t) => (JSON.parse(t).views || []).map(v => v.kind));
    await addViewKind(page, "hotspots");
    await page.waitForFunction(() => (JSON.parse(document.querySelector("#docjson").value).views || []).filter(v => v.kind === "hotspots").length === 2, null, { timeout: 30000 });
    kinds2 = await kinds();
    await page.locator(".undo-doc").click();
    await page.waitForFunction(() => (JSON.parse(document.querySelector("#docjson").value).views || []).filter(v => v.kind === "hotspots").length === 1, null, { timeout: 30000 });
    undone = await kinds();
  } catch { /* left as failed */ }
  ok("a view button adds another view of a kind already in the document",
    kinds2.filter(k => k === "hotspots").length === 2 && undone.filter(k => k === "hotspots").length === 1,
    "after a second click: " + (kinds2.join(", ") || "none") + " · after undo: " + (undone.join(", ") || "none"));

  // The oncoprint does not go through a resolver, so its provenance is a separate
  // code path — and the one most likely to be left behind. It is also the one view
  // the BROWSER draws, from the binary contract, so the card must hold a canvas and
  // the SQL that produced it. This document has one, added above.
  // The oncoprint fetches its own contract after the document runs, so it can still be loading
  // here; wait for it to draw (or give up and report what is on screen).
  const oncoState = () => page.evaluate(() => {
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
  let onco = await oncoState();
  for (let t0 = Date.now(); !(onco.found && onco.queries > 0 && onco.drawn) && Date.now() - t0 < 120000; onco = await oncoState())
    await page.waitForTimeout(300);
  // Views can be removed one at a time, and the document follows.
  let beforeN = 0, afterKinds = [];
  try {
    beforeN = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).length;
    const firstCard = page.locator(".viewcard").first();
    await firstCard.getByRole("button", { name: "reorder or remove this view" }).click();
    await page.locator("[data-slot=popover-content]").getByRole("button", { name: "remove" }).click();
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
  await page.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify(survDoc)).toString("base64url"));
  let basis = { types: 0, changed: false, truncated: false, anchor: null };
  try {
    await page.waitForSelector(".basis", { timeout: 300000 });
    const before = (await page.locator(".logrank").first().textContent()) || "";
    // the second control is what the clock starts from; its options arrive with the study's catalog
    await page.locator(".basis [role=combobox]").nth(1).click();
    await page.waitForFunction(() => {
      const opts = [...document.querySelectorAll("[role=option]")];
      return opts.length > 2 && !opts.some((o) => /loading/.test(o.textContent || ""));
    }, null, { timeout: 180000 });
    basis.types = await page.getByRole("option").count();
    await page.getByRole("option", { name: "Treatment", exact: true }).click();
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
}

module.exports = { analysisPage };
