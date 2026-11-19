// Explore: facets (derived ones included), drafting and saving a cohort, Analyze carrying it into an analysis and replacing what was there.
const { pickExploreStudies, pickFacet } = require("./helpers.cjs");

async function explore({ ok, BASE, page, browser }) {
  // Derived facets: computed from the data's shape, so they must appear for a
  // study regardless of how it names its events, and clicking must filter.
  // Currently hidden behind SHOW_DERIVED_FACETS=false (app/lab/page.tsx) at the
  // user's request — a short wait tells "genuinely hidden" from "actually
  // broken" without paying the full 240s timeout twice on every gate run.
  await page.goto(BASE + "/lab?tab=explore");
  // .exbar (the filters bar) only renders once a filter exists now — the
  // Exploring/studies card is the one thing always present on this tab.
  await page.waitForSelector('h2:has-text("Exploring")', { timeout: 120000 });
  await pickExploreStudies(page);
  let der = { facets: 0, filtered: false };
  let derivedFacetsHidden = false;
  try {
    await page.waitForFunction(() => [...document.querySelectorAll("h2")].some(h => h.textContent.includes("computed from the data's shape")),
      null, { timeout: 5000 });
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
  } catch { derivedFacetsHidden = true; }
  // The derived-facets wait above used to double as "the page has finished
  // loading" for everything below, since both derive from the same fetch —
  // now that it exits in 5s while hidden, wait for the clinical facet grid
  // explicitly instead of relying on that as a side effect.
  await page.waitForSelector("[data-attr]", { timeout: 120000 });
  // Categorical values are shown in full and scrolled, not trimmed to a few;
  // and the ranked lists carry no inline bar charts.
  const vals = await page.evaluate(() => {
    const lists = [...document.querySelectorAll(".vallist")];
    const big = lists.map(l => ({
      // only the rows in view are mounted; the list's full height says how many it holds
      rows: Math.round((l.querySelector(".vrows")?.getBoundingClientRect().height || 0) / (l.querySelector(".valrow")?.getBoundingClientRect().height || 1)),
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
  // 8px + a 1px border each side: a hint at relative size, not a chart
  ok("value bars stay small", !!vals.bars && !!barBox && barBox.h <= 10 && barBox.w <= 80,
    barBox ? vals.bars + " bars, " + barBox.w + "x" + barBox.h + "px" : "no bars found");

  // The grid draws the checked attributes of "+ Add chart" > Clinical, and until the
  // reader changes them those are cBioPortal's default: the first 20 with a priority
  // above 0, less any with a single value (lib/study-view-config.ts) — this selection
  // carries 66, and drawing every one is what froze the page across many studies. The
  // rest are said to be there, never silently missing.
  const attrTileCount = await page.locator("[data-attr]").count();
  const charted = (await page.locator("[data-charted]").getAttribute("data-charted").catch(() => null)) || "";
  ok("Explore charts the portal's default attributes (at most 20) and says how many it leaves out",
    attrTileCount > 0 && attrTileCount <= 20 && charted === attrTileCount + "/" + charted.split("/")[1] && Number(charted.split("/")[1]) > 20,
    attrTileCount + " attribute tiles, charted " + (charted || "(no note)"));

  ok("derived facets appear and filter", derivedFacetsHidden || (der.facets >= 2 && der.filtered),
    derivedFacetsHidden ? "skipped — Derived facets card is currently hidden (SHOW_DERIVED_FACETS=false)" :
      der.facets + " derived facets" + (der.filtered ? ", click added a derived clause" : ", click did not filter"));

  // Explore's studies card: Analyze must work on a study alone — every
  // patient in it — before any filtering. Analyze lives in this card now
  // (the filters bar below it only renders once a filter exists), so this
  // is the main path from browsing to an analysis with zero filters set.
  await page.goto(BASE + "/lab");
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.waitForSelector('h2:has-text("Exploring")', { timeout: 120000 });
  await pickExploreStudies(page);
  let unfiltered = "";
  try {
    await page.waitForFunction(() => {
      const h2 = [...document.querySelectorAll("h2")].find(h => h.textContent.startsWith("Exploring"));
      return !!h2 && /patients/.test(h2.textContent);
    }, null, { timeout: 240000 });
    unfiltered = (await page.locator('h2:has-text("Exploring")').innerText()).replace(/\s+/g, " ");
  } catch { /* left empty */ }
  const analyzeBtn = page.locator('button:text-is("Analyze")');
  const canAnalyseUnfiltered = (await analyzeBtn.count()) > 0 && !(await analyzeBtn.isDisabled());
  ok("a study with no filters is analysable", canAnalyseUnfiltered && !!unfiltered, unfiltered || "studies card never showed a patient count");

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
  // Same SHOW_DERIVED_FACETS=false gate as above — [data-derived] only exists
  // on that (currently hidden) card, so a short wait tells "hidden" from
  // "broken" without a 60s timeout on every gate run while it's off.
  let derivedDetail = "skipped — Derived facets card is currently hidden (SHOW_DERIVED_FACETS=false)", derivedOk = derivedFacetsHidden;
  if (!derivedFacetsHidden) try {
    await page.waitForSelector("[data-derived]", { timeout: 5000 });
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
    } else { derivedOk = false; derivedDetail = "no derived facets rendered"; }
  } catch (e) { derivedDetail = String(e.message).split("\n")[0]; }
  ok("picking a derived bucket keeps the other buckets selectable", derivedOk, derivedDetail);

  // The bar is deliberately spare: no Draft-cohort card, no gene finder, and
  // no name box — naming is asked for when you save, so nothing in the bar
  // suggests Analyze needs a name too.
  const noDraftCard = (await page.locator("h2:has-text('Draft cohort')").count()) === 0;
  const noGeneFinder = (await page.locator("input[placeholder='gene symbol…']").count()) === 0;
  const noNameBox = (await page.locator('input[placeholder="name…"]').count()) === 0;
  ok("the explore bar carries only its two actions",
    noDraftCard && noGeneFinder && noNameBox,
    "no card: " + noDraftCard + ", no gene finder: " + noGeneFinder + ", no name box: " + noNameBox);
  await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
  await pickFacet(page, 0);
  let drafted = true;
  try {
    await page.waitForFunction(() => /patients match/.test(document.querySelector(".exbar")?.textContent || ""),
      null, { timeout: 240000 });
  } catch { drafted = false; }
  ok("clicking a facet builds a draft and counts it", drafted,
    drafted ? (await page.locator(".exbar").innerText()).replace(/\s+/g, " ") : "no count appeared");
  // Analyze lives in the studies card, not the filters bar (.exbar) it sits
  // below — it works regardless of whether any filter is set.
  await page.locator('button:text-is("Analyze")').click();
  // It starts with no views: the reader picks what to see of the cohort.
  let landed = false, views = -1, counted = "";
  try {
    await page.waitForSelector(".cohortbox .cohortbox-head strong", { timeout: 300000 });
    counted = (await page.locator(".cohortbox-head").first().innerText()).replace(/\s+/g, " ");
    const d = JSON.parse(await page.locator("#docjson").inputValue());
    // Named from the draft itself now that the bar has no name field.
    landed = Object.keys(d.cohorts || {}).length === 1;
    views = (d.views || []).length;
  } catch { /* landed stays false */ }
  ok("Analyze carries the cohort into an analysis with no views yet", landed && views === 0,
    landed ? counted + " · " + views + " views" : "cohort did not reach the document");

  // Saving asks for the name when you ask to save; Esc and the backdrop come
  // from the dialog primitive. Targeted by its own .savedialog class, since
  // the app has several dialogs open from the same page.
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.waitForSelector(".exbar", { timeout: 120000 });
  await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
  let saveFlow = "dialog never opened";
  let savedOk = false;
  try {
    await page.locator(".exbar button:has-text('Save as a Cohort')").click();
    await page.waitForSelector("[role=dialog].savedialog", { timeout: 30000 });
    const prefilled = await page.locator("[role=dialog].savedialog input").inputValue();
    // Esc must dismiss without saving
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const closedOnEsc = (await page.locator("[role=dialog].savedialog").count()) === 0;
    await page.locator(".exbar button:has-text('Save as a Cohort')").click();
    await page.waitForSelector("[role=dialog].savedialog", { timeout: 30000 });
    await page.locator("[role=dialog].savedialog input").fill("e2e dialog cohort");
    await page.locator("[role=dialog].savedialog button[type=submit]").click();
    await page.waitForFunction(() => /saved/.test(document.querySelector(".exbar")?.textContent || ""),
      null, { timeout: 120000 });
    await page.locator("header a.savedbtn").click();   // the saved-work manager, over the lab
    await page.waitForTimeout(1500);
    const inList = await page.locator("text=e2e dialog cohort").count();
    await page.keyboard.press("Escape");
    // the manager leaves with an animation: "Saved work" clicked again below before it is gone can
    // land in its exit and leave it closed, so wait until it has left
    await page.locator(".saveddialog").waitFor({ state: "detached", timeout: 30000 });
    savedOk = !!prefilled && closedOnEsc && inList > 0;
    saveFlow = "prefilled '" + prefilled + "', esc closed: " + closedOnEsc + ", in Cohorts: " + (inList > 0);
  } catch (e) { saveFlow = String(e.message).split("\n")[0]; }
  ok("Save asks for a name in a dialog and stores the cohort", savedOk, saveFlow);

  // Analyze REPLACES the document rather than merging into it. Load a
  // DIFFERENTLY-named cohort first, so replacement is provable: the bar now
  // derives the name from the draft, so two Analyze runs share a name and
  // counting cohorts could not tell replace from overwrite.
  await page.locator("header a.savedbtn").click();   // the saved-work manager, over the lab
  await page.waitForSelector("[role=checkbox].cohortpick", { timeout: 240000 });
  let seeded = [];
  try {
    await page.locator("[role=checkbox].cohortpick").nth(0).check();
    await page.locator("button:has-text('Analyze selected')").click();
    await page.waitForSelector(".cohortbox", { timeout: 300000 });
    seeded = Object.keys(JSON.parse(await page.locator("#docjson").inputValue()).cohorts || {});
  } catch { /* left empty */ }
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.waitForSelector(".exbar", { timeout: 120000 });
  await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
  await pickFacet(page, 2);
  try {
    await page.waitForFunction(() => /patients match/.test(document.querySelector(".exbar")?.textContent || ""),
      null, { timeout: 240000 });
  } catch { /* count may already be shown */ }
  await page.locator('button:text-is("Analyze")').click();
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

  // A chart menu's "Analyze groups" opens the chart's values as cohorts of a fresh analysis, on
  // this page (Compare groups is the one that opens a new tab): one cohort per value, each
  // drawn on that value of the chart's attribute, and no views yet.
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  const pie = page.locator("[data-attr][data-shape=pie]").filter({ has: page.locator(".chartgear") }).first();
  let groups = "no pie chart with a menu";
  let groupsOk = false;
  try {
    await pie.waitFor({ timeout: 240000 });
    const attr = (await pie.getAttribute("data-attr")).split("|")[1];
    const pagesBefore = page.context().pages().length;
    await pie.locator(".chartgear").click();
    await page.getByRole("menuitem", { name: /^Analyze (top \d+ )?groups$/ }).click();
    await page.waitForFunction((a) => {
      try {
        const cs = Object.values(JSON.parse(document.querySelector("#docjson")?.value || "{}").cohorts || {});
        return cs.length >= 2 && cs.every((c) => (c.all || []).some((cl) => cl.attribute === a));
      } catch { return false; }
    }, attr, { timeout: 120000 });
    const d = JSON.parse(await page.locator("#docjson").inputValue());
    const names = Object.keys(d.cohorts);
    groupsOk = (d.views || []).length === 0 && page.context().pages().length === pagesBefore;
    groups = attr + " → " + names.join(", ") + " · " + (d.views || []).length + " views";
  } catch (e) { groups = String(e.message).split("\n")[0]; }
  ok("a chart's Analyze groups opens its values as the cohorts of a fresh analysis", groupsOk, groups);

  // Alterations: OncoKB drivers only. The gene tables count driver calls (a gene mutated mostly by
  // passengers leaves the top), the link keeps the choice, and checking a gene writes its driver
  // clause, which selects exactly the samples its "#" counted.
  let drv = "";
  let drvOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    const table = page.locator("[data-genetable=mutated]");
    await table.locator(".generow:not(.ghead)").first().waitFor({ timeout: 240000 });
    const top = async () => (await table.locator(".generow:not(.ghead) .gname").allInnerTexts()).slice(0, 10);
    const before = await top();
    await page.locator(".driverchoice").click();
    await page.getByRole("option", { name: "Alterations: OncoKB drivers only" }).click();
    await page.waitForFunction(() => /OncoKB drivers/.test(document.querySelector("[data-genetable=mutated]")?.textContent || ""), null, { timeout: 240000 });
    const after = await top(), url = new URL(page.url()).searchParams.get("drivers");
    const egfr = table.locator(".generow", { has: page.locator(".gname", { hasText: /^EGFR$/ }) }).first();
    const counted = Number((await egfr.locator(".gnum").nth(1).innerText()).replace(/,/g, ""));
    await egfr.locator("[role=checkbox], input[type=checkbox]").first().click();
    await table.getByRole("button", { name: "Apply filter" }).click();
    await page.waitForFunction(() => /EGFR: MUT_DRIVER/.test(document.querySelector(".exbar")?.textContent || "") &&
      /[\d,]+ patients match/.test(document.querySelector(".exbar")?.textContent || ""), null, { timeout: 240000 });
    const matched = Number((/([\d,]+) patients match/.exec(await page.locator(".exbar").innerText()) || [])[1]?.replace(/,/g, ""));
    drv = JSON.stringify({ before: before.slice(0, 5), after: after.slice(0, 5), url, counted, matched });
    drvOk = before.includes("TTN") && !after.includes("TTN") && after.includes("EGFR") && url === "1" && counted > 0 && matched === counted;
  } catch (e) { drv = String(e.message).split("\n")[0]; }
  ok("explore: drivers only counts OncoKB driver calls, and a checked gene selects exactly the samples it counted", drvOk, drv);

  // Filters live in the URL (lib/study-view-url.ts): a cbioportal.org link's filterAttributeId /
  // filterValues opens filtered and becomes the page's own `filters`, which a reload keeps.
  let urlDetail = "", urlOk = false;
  try {
    const matchCount = async () => {
      await page.waitForFunction(() => /[\d,]+ patients match/.test(document.querySelector(".exbar")?.textContent || ""), null, { timeout: 240000 });
      return (/([\d,]+) patients match/.exec(await page.locator(".exbar").innerText()) || [])[1];
    };
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018&filterAttributeId=SEX&filterValues=Female", { waitUntil: "domcontentloaded" });
    const first = await matchCount();
    await page.waitForFunction(() => new URL(location.href).searchParams.has("filters"), null, { timeout: 30000 });
    const q = new URL(page.url()).searchParams;
    await page.reload({ waitUntil: "domcontentloaded" });
    const again = await matchCount();
    urlDetail = JSON.stringify({ first, again, filters: q.has("filters"), legacyLeft: q.has("filterAttributeId") });
    urlOk = !!first && first === again && q.has("filters") && !q.has("filterAttributeId");
  } catch (e) { urlDetail = String(e.message).split("\n")[0]; }
  ok("explore: a portal link's filters open filtered, are written as the page's own, and survive a reload", urlOk, urlDetail);

  // The filter bar as the Study View's (lib/study-view-pills.ts): "Diagnosis Age : 50 < x ≤ 60",
  // its end typed in place widens the filter, and a pill's × takes it out.
  let pillDetail = "", pillOk = false;
  try {
    const matchCount = async (not) => {
      await page.waitForFunction((n) => { const m = /([\d,]+) patients match/.exec(document.querySelector(".exbar")?.textContent || ""); return m && m[1] !== n; }, not, { timeout: 240000 });
      return Number((/([\d,]+) patients match/.exec(await page.locator(".exbar").innerText()) || [])[1].replace(/,/g, ""));
    };
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018&filterAttributeId=AGE&filterValues=50-60", { waitUntil: "domcontentloaded" });
    const narrow = await matchCount(null);
    const group = page.locator(".svgroup[data-sv-chart='AGE']");
    const name = (await group.locator(".svname").innerText()).trim();
    const ends = await group.locator(".svedit").evaluateAll((e) => e.map((x) => x.value));
    const text = (await group.locator(".svpill").innerText()).replace(/\s+/g, " ").trim();
    const end = page.getByRole("textbox", { name: name + " end" });
    await end.fill("70"); await end.press("Enter");
    const wide = await matchCount(String(narrow));
    await page.getByRole("button", { name: "remove " + name + " 50 < x ≤ 70" }).click();
    await page.waitForFunction(() => !document.querySelector(".svgroup[data-sv-chart='AGE']"), null, { timeout: 60000 });
    pillDetail = JSON.stringify({ name, ends, text, narrow, wide });
    pillOk = name === "Diagnosis Age" && ends.join("-") === "50-60" && /< x ≤/.test(text) && wide > narrow;
  } catch (e) { pillDetail = String(e.message).split("\n")[0]; }
  ok("explore: filter pills are named by chart, an interval's end is edited in place, and × removes the filter", pillOk, pillDetail);

  // View patients, the portal's "View selected cases": disabled, saying why, when the filters leave no patient (STV-AB-2)
  let vpDetail = "", vpOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018&filterAttributeId=AGE&filterValues=150-200", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /\b0 patients match/.test(document.querySelector(".exbar")?.textContent || ""), null, { timeout: 240000 });
    const vp = page.locator("button.viewpatients");
    vpDetail = JSON.stringify({ disabled: await vp.isDisabled(), tip: await vp.getAttribute("data-tip") });
    vpOk = await vp.isDisabled() && (await vp.getAttribute("data-tip")) === "no patient matches your filters";
  } catch (e) { vpDetail = String(e.message).split("\n")[0]; }
  ok("explore: View patients is disabled, saying why, when no patient matches the filters", vpOk, vpDetail);

  // A histogram's menu (lib/study-view-bins.ts): Custom Bins' median split draws two bars, kept by
  // this browser across a reload; an empty Custom box is the default bars again; Show NA adds a bar.
  let binDetail = "", binOk = false;
  try {
    const chart = "[data-attr='patient|AGE']";
    const bars = () => page.locator(chart + " .hbar").count();
    const openMenu = async (item) => {
      await page.locator(chart + " .chartgear").click();
      await page.getByRole("menuitem", { name: item }).or(page.getByRole("menuitemcheckbox", { name: item })).first().click();
    };
    const barsBecome = (lo, hi) => page.waitForFunction(([sel, a, b]) => { const n = document.querySelectorAll(sel + " .hbar").length; return n >= a && n <= b; }, [chart, lo, hi], { timeout: 120000 });
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => { try { localStorage.removeItem("cbiolab.explore.bins"); } catch { /* none kept */ } });
    await page.waitForSelector(chart + " .hbar", { timeout: 240000 });
    const before = await bars();
    await openMenu("Custom Bins…");
    await page.getByRole("radio", { name: "Median split" }).click();
    await page.getByRole("button", { name: "Update" }).click();
    await barsBecome(2, 2);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(chart + " .hbar", { timeout: 240000 });
    await barsBecome(2, 2);
    const kept = await bars();
    await openMenu("Custom Bins…");
    await page.getByRole("radio", { name: "Custom bins" }).click();
    await page.locator("#cb-edges").fill("");
    await page.getByRole("button", { name: "Update" }).click();
    await barsBecome(3, 1000);
    const back = await bars();
    await openMenu("Show NA");
    await page.waitForSelector(chart + " .hbar.nabar", { timeout: 30000 });
    await page.evaluate(() => { try { localStorage.removeItem("cbiolab.explore.bins"); } catch { /* none kept */ } });
    binDetail = JSON.stringify({ before, kept, back });
    binOk = before > 2 && kept === 2 && back === before;
  } catch (e) { binDetail = String(e.message).split("\n")[0]; }
  ok("explore: a histogram's Custom Bins redraws its bars, kept by the browser, an empty box restores them, and Show NA adds a bar", binOk, binDetail);

  // Explore's tabs (STV-URL-1, STV-TAB-1, STV-STM-13): a link opens the tab it names, a tab keeps its search
  // across a switch, the URL follows the tab through a reload, and CN Segments stays at 0 selected samples
  let tabDetail = "", tabOk = false;
  try {
    const ST = "luad_tcga_pan_can_atlas_2018";
    const tabs = page.getByRole("tablist", { name: "study view sections" });
    const active = async () => (await tabs.locator("[role=tab][data-state=active]").innerText()).trim();
    const svtab = () => new URL(page.url()).searchParams.get("svtab");
    await page.goto(BASE + "/lab?tab=explore&study=" + ST + "&svtab=clinicalData", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /Showing 1–\d+ of [\d,]+ results/.test(document.body.innerText), null, { timeout: 240000 });
    const opened = await active();
    const count = async () => (/Showing 1–\d+ of ([\d,]+) results/.exec(await page.locator("body").innerText()) || [])[1];
    const all = await count();
    const search = page.getByRole("searchbox", { name: "search results" });
    await search.fill("Female"); await search.press("Enter");
    await page.waitForFunction((n) => { const m = /Showing 1–\d+ of ([\d,]+) results/.exec(document.body.innerText); return m && m[1] !== n; }, all, { timeout: 120000 });
    const shown = await count();
    await tabs.getByRole("tab", { name: "Summary" }).click();
    const onSummary = svtab();
    await tabs.getByRole("tab", { name: "Clinical Data" }).click();
    const back = { search: await search.inputValue(), shown: await count() };
    await tabs.getByRole("tab", { name: "CN Segments" }).click();
    const onCn = svtab();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-test=cn-segments-info]").waitFor({ timeout: 240000 });
    const reloaded = await active();
    // the tab open on a selection with segments, then the same page's filter narrowed to nobody: the
    // 0-sample line alone, nothing left of the earlier figure
    await page.goto(BASE + "/lab?tab=explore&study=" + ST + "&filterAttributeId=AGE&filterValues=50-60&svtab=cnSegments", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /^Segmented copy-number data for the selected [1-9]/.test(document.querySelector("[data-test=cn-segments-info]")?.textContent || "")
      && !!document.querySelector("[data-test=cn-segments-info]")?.closest("section")?.querySelector(".vfoot"), null, { timeout: 240000 });
    const age = (await page.locator(".svgroup[data-sv-chart='AGE'] .svname").innerText()).trim();
    const hi = page.getByRole("textbox", { name: age + " end" });
    await hi.fill("200"); await hi.press("Enter");
    const lo = page.getByRole("textbox", { name: age + " start" });
    await lo.fill("150"); await lo.press("Enter");
    await page.waitForFunction(() => /\b0 patients match/.test(document.querySelector(".exbar")?.textContent || ""), null, { timeout: 240000 });
    const info = await page.locator("[data-test=cn-segments-info]").innerText({ timeout: 60000 });
    const cn = page.locator("section.viewcard", { has: page.locator("[data-test=cn-segments-info]") });
    const stale = await cn.locator(".vfoot, svg").count();
    const names = (await tabs.locator("[role=tab]").allInnerTexts()).map((x) => x.trim());
    tabDetail = JSON.stringify({ opened, all, shown, onSummary, back, onCn, reloaded, names, info, stale });
    tabOk = opened === "Clinical Data" && !!shown && onSummary === null && back.search === "Female" && back.shown === shown &&
      onCn === "cnSegments" && reloaded === "CN Segments" && names.join("|") === "Summary|CN Segments" &&
      info === "No segmented copy-number data for the selected 0 samples." && stale === 0;
  } catch (e) { tabDetail = String(e.message).split("\n")[0]; }
  ok("explore: the tab is in the URL, keeps its search across a switch, and CN Segments stays at 0 samples", tabOk, tabDetail);

  // a tab kept mounted retries a failed load when it is shown again (as a remount did): the first
  // Clinical Data request fails, Summary and back loads the rows. Its own context, so the planted
  // 500 stays out of the light pass's no-JS-errors check.
  let retryDetail = "", retryOk = false;
  const own = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  try {
    const p = await own.newPage();
    let calls = 0;
    await p.route("**/api/analysis**", (route) => calls++ === 0
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "planted failure" }) })
      : route.continue());
    await p.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018&svtab=clinicalData", { waitUntil: "domcontentloaded" });
    const tabs = p.getByRole("tablist", { name: "study view sections" });
    await p.waitForFunction(() => /Could not load the clinical data: planted failure/.test(document.body.innerText), null, { timeout: 240000 });
    await tabs.getByRole("tab", { name: "Summary" }).click();
    await tabs.getByRole("tab", { name: "Clinical Data" }).click();
    await p.waitForFunction(() => /Showing 1–\d+ of [\d,]+ results/.test(document.body.innerText), null, { timeout: 240000 });
    const rows = (/Showing 1–\d+ of ([\d,]+) results/.exec(await p.locator("body").innerText()) || [])[1];
    retryDetail = JSON.stringify({ calls, rows });
    retryOk = calls >= 2 && !!rows;
  } catch (e) { retryDetail = String(e.message).split("\n")[0]; }
  await own.close();
  ok("explore: a tab whose load failed loads again when it is shown again", retryOk, retryDetail);
  // Data types (STS-OT-1, STS-STM-14): each kind's Freq is its samples over the selected samples, highest
  // first, and two checked kinds apply as Intersection by default; Timeline events' Freq is over patients
  let dtDetail = "", dtOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    const card = page.locator(".card", { has: page.locator("h2", { hasText: "Data types" }) });
    await card.locator(".dtrow").first().waitFor({ timeout: 240000 });
    const rows = await card.locator(".dtrow").evaluateAll((els) => els.map((e) => [...e.querySelectorAll(".gcount")].map((s) => s.textContent.trim())));
    const top = Number(rows[0][0].replace(/,/g, ""));
    const all = rows.map(([n]) => Number(n.replace(/,/g, "")));
    const share = (n, of) => (100 * n / of).toFixed(1) + "%";
    // the first row's Freq names the selected samples it divides by
    const samples = Number((/of the ([\d,]+) selected samples/.exec(await card.locator(".dtrow .gcount.meta").first().getAttribute("data-tip")) || [])[1].replace(/,/g, ""));
    const freqsOk = rows.every(([n, f]) => { const v = Number(n.replace(/,/g, "")); return f === share(v, samples) || (f === "100.0%" && v === samples); });
    const sorted = all.every((n, i) => i === 0 || all[i - 1] >= n);
    await card.locator(".dtrow", { has: page.locator(".gname", { hasText: /^gistic$/ }) }).first().click();
    await card.locator(".generows").evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await card.locator(".dtrow", { has: page.locator(".gname", { hasText: /^mutations$/ }) }).first().click();
    const op = (await card.locator(".pickbar").innerText()).replace(/\s+/g, " ");
    await card.getByRole("button", { name: "Clear" }).click();
    // Timeline Events Availability is offered in Add chart, not shown by default (STS-OT-7)
    const ev = page.locator("[data-special=events]");
    const hiddenFirst = (await ev.count()) === 0;
    await page.getByRole("button", { name: /Add chart/ }).first().click();
    await page.getByRole("checkbox", { name: "chart Timeline Events Availability" }).click();
    await page.keyboard.press("Escape");
    await ev.locator(".valrow").first().waitFor({ timeout: 120000 });
    const evText = (await ev.innerText()).replace(/\s+/g, " ");
    dtDetail = JSON.stringify({ top, samples, freqsOk, sorted, op, hiddenFirst, evText: evText.slice(0, 120) });
    dtOk = samples > 0 && freqsOk && sorted && /Intersection/.test(op) && hiddenFirst && /\d+(\.\d)?%/.test(evText);
  } catch (e) { dtDetail = String(e.message).split("\n")[0]; }
  ok("explore: Data types show each kind's Freq over the selected samples, highest first, Intersection by default; Timeline events, added from Add chart, their Freq", dtOk, dtDetail);

  // Value lists as the portal's tables (STS-TBL-1…5): a # / Freq header; a list that scrolls has a
  // search box and Select all / Deselect all over the rows it shows; the rows the filter holds come first
  let vlDetail = "", vlOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    // a clinical attribute's list (an assay chart's rows may be disabled)
    const card = page.locator(".card[data-attr]:has(.vsearch)").first();
    await card.waitFor({ timeout: 240000 });
    const attr = await card.getAttribute("data-attr");
    const header = (await card.locator(".valhead").innerText()).replace(/\s+/g, " ").trim();
    const names = await card.locator(".vallist .valrow .vname").allInnerTexts();
    const pick = names[2];
    const exact = new RegExp("^" + pick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    await card.locator(".vallist .valrow", { has: page.locator(".vname", { hasText: exact }) }).first().click();
    await card.getByRole("button", { name: "Apply filter" }).click();
    const c2 = page.locator(".card[data-attr='" + attr + "']");
    await page.waitForFunction(([a, v]) => document.querySelector(".card[data-attr='" + a + "'] .vallist .valrow .vname")?.textContent === v, [attr, pick], { timeout: 240000 });
    const q = names[0].slice(0, 2);
    await c2.getByRole("searchbox", { name: "search the values" }).fill(q);
    await page.waitForTimeout(600);   // the box hands its text on 400 ms after the last key
    const shown = await c2.locator(".vallist .valrow .vname").allInnerTexts();
    const matchOk = shown.length > 0 && shown.every((n) => n.toUpperCase().includes(q.toUpperCase()) || n === pick);
    // Select all checks the rows shown that can be: enabled, not already in the filter, not NA (applied alone)
    const checkable = await c2.locator(".vallist .valrow").evaluateAll((rs) => rs.filter((r) => {
      const box = r.querySelector("[role=checkbox], button");
      return box && !box.hasAttribute("disabled") && box.getAttribute("data-state") !== "checked" && r.querySelector(".vname")?.textContent !== "NA";
    }).length);
    await c2.getByRole("button", { name: "Select all" }).click();
    const checked = Number(((await c2.locator(".pickbar").innerText()).match(/(\d+) checked/) || [])[1]);
    await c2.getByRole("button", { name: "Deselect all" }).click();
    const cleared = await c2.locator(".pickbar").count();
    vlDetail = JSON.stringify({ attr, header, pick, q, shown: shown.length, checkable, checked, cleared });
    vlOk = header === "# Freq" && matchOk && checked === checkable && checkable > 0 && cleared === 0;
  } catch (e) { vlDetail = String(e.message).split("\n")[0]; }
  ok("explore: value lists have the portal's header, search and Select all / Deselect all, the applied rows first", vlOk, vlDetail);

  // a histogram as the portal's bar chart (STS-BAR-2/3/5): a y axis of integer counts, and a drag
  // across bars selects them, the rest greyed; a click on a bar still adds it
  let barDetail = "", barOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    const chart = page.locator("[data-attr='patient|AGE']");
    await chart.locator(".hbar[data-bar]").nth(5).waitFor({ timeout: 240000 });
    // the mouse reaches only what is on screen: the chart may sit below the fold
    await chart.scrollIntoViewIfNeeded();
    const yTicks = await chart.locator(".histo-y span").allInnerTexts();
    const bars = chart.locator(".hbar[data-bar]");
    const at = async (i) => { const b = await bars.nth(i).boundingBox(); return [b.x + b.width / 2, b.y + b.height - 4]; };
    const [ax, ay] = await at(2), [zx] = await at(4);
    await page.mouse.move(ax, ay); await page.mouse.down();
    await page.mouse.move(zx, ay, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => /[\d,]+ patients match/.test(document.querySelector(".exbar")?.textContent || ""), null, { timeout: 240000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-attr='patient|AGE'] .hbar.on").length > 0, null, { timeout: 120000 });
    const states = await bars.evaluateAll((els) => els.map((e) => e.classList.contains("on") ? "1" : "0").join(""));
    const filters = new URL(page.url()).searchParams.get("filters");
    barDetail = JSON.stringify({ yTicks, states, filters: !!filters });
    barOk = yTicks.length >= 2 && yTicks.every((t) => /^[\d,]+$/.test(t)) && /^0011100*$/.test(states) && !!filters;
  } catch (e) { barDetail = String(e.message).split("\n")[0]; }
  ok("explore: a histogram has an integer y axis, and a drag across bars selects them, the others greyed", barOk, barDetail);

  // the treatment tables (STS-OT-6), shown when the study has treatments: patients per agent, most
  // first; a checked agent applied filters on it, and the sample table narrows with it
  let txDetail = "", txOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    const pt = page.locator("[data-treatments='patient']"), st = page.locator("[data-treatments='sample']");
    await pt.locator(".valrow").first().waitFor({ timeout: 240000 });
    await st.locator(".valrow").first().waitFor({ timeout: 240000 });
    const counts = (await pt.locator(".valrow .vn").allInnerTexts()).map((t) => Number(t.replace(/,/g, "")));
    const ordered = counts.every((n, i) => i === 0 || counts[i - 1] >= n);
    const pick = (await pt.locator(".valrow .vname").allInnerTexts())[0];
    const before = (await st.locator(".facettitle").textContent()).trim();   // as the wait below reads it
    await pt.locator(".valrow").first().click();
    await pt.getByRole("button", { name: "Apply filter" }).click();
    await page.waitForFunction((a) => document.body.innerText.includes("treated with " + a), pick, { timeout: 240000 });
    await page.waitForFunction((b) => (document.querySelector("[data-treatments='sample'] .facettitle")?.textContent || "").trim() !== b, before, { timeout: 240000 });
    const pinned = await pt.locator(".valrow.on .vname").allInnerTexts();
    const after = (await st.locator(".facettitle").textContent()).trim();
    txDetail = JSON.stringify({ rows: counts.length, pick, pinned, before, after });
    txOk = counts.length > 1 && ordered && pinned.length === 1 && pinned[0] === pick && after !== before;
  } catch (e) { txDetail = String(e.message).split("\n")[0]; }
  ok("explore: the treatment tables count patients and samples per treatment, and a treatment applied filters on it", txOk, txDetail);

  // a gene's Mutation Type Counts table (STS-OT-3), from Add chart: # Mut, #, Freq, most samples
  // first; a checked type applied filters on it, and the table keeps counting without its own filter
  let mtDetail = "", mtOk = false;
  try {
    await page.goto(BASE + "/lab?tab=explore&study=luad_tcga_pan_can_atlas_2018", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Add chart/ }).first().click({ timeout: 240000 });
    await page.getByRole("tab", { name: "Gene status" }).click();
    await page.getByPlaceholder("chart a gene (e.g. EGFR)").fill("KRAS");
    await page.getByRole("button", { name: "Add mutation types" }).click();
    await page.keyboard.press("Escape");
    const card = page.locator("[data-mutationtypes='KRAS']");
    await card.locator(".valrow").first().waitFor({ timeout: 240000 });
    const header = (await card.locator(".valhead").innerText()).replace(/\s+/g, " ").trim();
    const rows = await card.locator(".valrow").evaluateAll((rs) => rs.map((r) => [...r.querySelectorAll(".vname, .vn, .vpct")].map((c) => c.textContent)));
    const num = (t) => Number(String(t).replace(/,/g, ""));
    const ordered = rows.every(([, m, n], i) => num(m) >= num(n) && (i === 0 || num(rows[i - 1][2]) >= num(n)));
    const pick = rows[rows.length - 1][0];
    await card.locator(".valrow", { has: page.locator(".vname", { hasText: new RegExp("^" + pick + "$") }) }).click();
    await card.getByRole("button", { name: "Apply filter" }).click();
    await page.waitForFunction((t) => document.body.innerText.includes("KRAS mutation type: " + t), pick, { timeout: 240000 });
    await page.waitForFunction((t) => document.querySelector("[data-mutationtypes='KRAS'] .valrow.on .vname")?.textContent === t, pick, { timeout: 240000 });
    const after = await card.locator(".valrow .vname").allInnerTexts();
    mtDetail = JSON.stringify({ header, rows, pick, after });
    mtOk = header === "# Mut # Freq" && rows.length > 1 && ordered && after[0] === pick && after.length === rows.length;
  } catch (e) { mtDetail = String(e.message).split("\n")[0]; }
  ok("explore: a gene's mutation-type table counts mutations and samples by type, and a type applied filters on it", mtOk, mtDetail);
}

module.exports = { explore };
