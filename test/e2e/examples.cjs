// The Examples tab: every documented example listed and launchable, multi-view documents drawing every view, each view's participation marker, SQL and latency.
async function examples({ ok, BASE, page }) {
  // Examples tab: the documented analysis documents, rendered as a gallery.
  // The docs gate already proves each one RUNS; this proves the app can
  // launch them and that the federated views actually paint something.
  await page.goto(BASE + "/lab");
  await page.locator("header a.toplink", { hasText: /^examples$/ }).click();
  await page.waitForSelector(".excard", { timeout: 120000 });
  const nCards = await page.locator(".excard").count();
  const { EXAMPLES } = await import("../../lib/dsl-reference.ts");
  ok("examples gallery lists every documented example",
    nCards === EXAMPLES.length, nCards + " cards vs " + EXAMPLES.length + " examples");

  // a view-kind chip keeps every example that draws that view; the search narrows it further
  {
    const { exampleFeatures, matchesSearch } = await import("../../lib/example-features.ts");
    const wantKind = EXAMPLES.filter(e => exampleFeatures(e).views.includes("survival"));
    const wantBoth = wantKind.filter(e => matchesSearch(e, "TP53 stratified"));
    await page.locator(".exfacet button", { hasText: /^survival \d/ }).click();
    const nKind = await page.locator(".excard").count();
    await page.locator(".exsearch").fill("TP53 stratified");
    await page.waitForFunction((n) => document.querySelectorAll(".excard").length === n, wantBoth.length, { timeout: 5000 }).catch(() => {});
    const nBoth = await page.locator(".excard").count();
    ok("examples filter by view kind and search their text",
      nKind === wantKind.length && nBoth === wantBoth.length && nBoth > 0 && nBoth < nKind,
      `survival: ${nKind} of ${wantKind.length}; + "TP53 stratified": ${nBoth} of ${wantBoth.length}`);
    await page.locator(".exsearch").fill("");
    await page.getByRole("button", { name: /^all \d+$/ }).click();
  }

  // one launch per federated view kind, asserting the view's own markup appears
  const launches = [
    ["Co-occurrence and mutual exclusivity in NSCLC", ".tend", "cooccurrence"],
    ["Co-expression from sums alone", ".rbar", "coexpression"],
    ["Lollipop plot: mutations by protein position", ".lp-plot circle.lollipop-head", "hotspots lollipop"],
    ["Study-stratified survival across two studies", ".logrank", "survival log-rank"],
    ["Clinical attributes compared between cohorts", ".viewcard:not(.viewloading) h2:has-text('Clinical comparison')", "clinical"]
  ];
  // a multi-view document must render EVERY one of its views, not just the first
  await page.goto(BASE + "/lab");
  await page.locator("header a.toplink", { hasText: /^examples$/ }).click();
  await page.waitForSelector(".excard", { timeout: 120000 });
  await page.locator(".excard").filter({ hasText: "One cohort, five ways" }).first()
    .locator("button:has-text('Run')").click();
  const multiWanted = [
    [".lp-plot circle.lollipop-head", "hotspots"], [".tend", "cooccurrence"],
    [".logrank", "survival log-rank"], [".viewcard:not(.viewloading) h2:has-text('Clinical comparison')", "clinical"],
    [".viewcard:not(.viewloading) h2:has-text('Compare')", "compare"]
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
    const KNOWN = ["Compare", "Survival", "Co-occurrence", "Clinical comparison", "Co-expression", "Mutations", "Oncoprint"];
    const missing = [], seen = [];
    for (const card of document.querySelectorAll(".ana-grid .card")) {
      const h = card.querySelector("h2");
      if (!h) continue;
      const name = KNOWN.find(k => h.textContent.trim().startsWith(k));
      if (!name) continue;                       // "The document" and other non-view cards
      seen.push(name);
      const b = card.querySelector(".partbadge");
      if (!b || !b.getAttribute("data-tip")) missing.push(name);
    }
    return { seen, missing };
  });
  // and each must show the aggregate SQL that produced its numbers
  const prov = await page.evaluate(() => {
    const KNOWN = ["Compare", "Survival", "Co-occurrence", "Clinical comparison", "Co-expression", "Mutations", "Oncoprint"];
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
    const KNOWN = ["Compare", "Survival", "Co-occurrence", "Clinical comparison", "Co-expression", "Mutations", "Oncoprint"];
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
    // the run's total sits in the document dialog, which stays in the page while closed
    const totalEl = ((document.querySelector("dialog.docdialog")?.textContent || "").match(/[\d,]+ms · OncoKB/) || [])[0];
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
    await page.goto(BASE + "/lab");
    await page.locator("header a.toplink", { hasText: /^examples$/ }).click();
    await page.waitForSelector(".excard", { timeout: 120000 });
    const card = page.locator(".excard").filter({ hasText: title }).first();
    await card.locator("button:has-text('Run')").click();
    let shown = true;
    try { await page.waitForSelector(sel, { timeout: 240000 }); }
    catch { shown = false; }
    ok("example runs and renders: " + label, shown,
      shown ? "" : "no " + sel + " after running “" + title + "”");
  }
}

module.exports = { examples };
