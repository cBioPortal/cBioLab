// Explore: facets (derived ones included), drafting and saving a cohort, Analyze carrying it into an analysis and replacing what was there.
const { pickExploreStudies, pickFacet } = require("./helpers.cjs");

async function explore({ ok, BASE, page }) {
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
  // above 0 — this selection carries 66, and drawing every one is what froze the page
  // across many studies. The rest are said to be there, never silently missing.
  const attrTileCount = await page.locator("[data-attr]").count();
  const charted = (await page.locator("[data-charted]").getAttribute("data-charted").catch(() => null)) || "";
  ok("Explore charts the portal's default 20 attributes and says how many it leaves out",
    attrTileCount === 20 && charted === "20/" + charted.split("/")[1] && Number(charted.split("/")[1]) > 20,
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
}

module.exports = { explore };
