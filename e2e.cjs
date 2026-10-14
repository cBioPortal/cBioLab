const { launch } = require("./e2e-browser.cjs");

const BASE = "http://localhost:" + (process.env.E2E_PORT || 3100);

// Explore starts with no studies selected; the checks that browse facets pick the two studies they
// were written against, through the page's own tool (what a reader's ticking does).
async function pickExploreStudies(p) {
  await p.waitForFunction(() => window.cohortLab && window.cohortLab.selectStudies, null, { timeout: 120000 });
  await p.evaluate(() => window.cohortLab.selectStudies(["msk_chord_2024", "genie_public"]));
}

/**
 * Controls that sit side by side must line up: in every toolbar zone (.tbz) under `scope`, each
 * control (a button, checkbox label or select) is one control height (--ctl-h) tall and every child shares one
 * centre line. A control placed outside the toolbar idiom takes the global input/button padding
 * and fails this. Returns the misaligned rows, described; empty when all line up.
 */
async function misalignedControls(p, scope) {
  return p.evaluate((scope) => {
    const ctl = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ctl-h")) * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const bad = [];
    for (const z of document.querySelectorAll(scope + " .tbz")) {
      const kids = [...z.children].filter((c) => !c.classList.contains("tbl") && c.getBoundingClientRect().height > 0);
      const mids = kids.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
      const off = kids.filter((c) => c.matches(".tbbtn, .chk, select, [data-slot=button], [data-slot=select-trigger]") && Math.abs(c.getBoundingClientRect().height - ctl) > 0.5);
      if (Math.max(...mids) - Math.min(...mids) > 1 || off.length)
        bad.push(kids.map((c, i) => (c.textContent || c.tagName).trim().slice(0, 14) + "@" + mids[i].toFixed(1) + "/h" + c.getBoundingClientRect().height.toFixed(1)).join(", "));
    }
    return bad;
  }, scope);
}

async function main() {
  const browser = await launch();
  const results = [];
  const ok = (name, cond, extra) =>
    results.push((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));

  // Saved cohorts and analyses need a sign-in (lib/auth.ts). scripts/gate.sh turns on its server's
  // development sign-in and passes the email to sign in as here; signed out, the store must refuse.
  const LOGIN = process.env.E2E_LOGIN_EMAIL || "";
  const signIn = (ctx, email = LOGIN) => ctx.request.post(BASE + "/api/auth/dev", { data: { email } });
  {
    const anon = await browser.newContext();
    const r = await anon.request.get(BASE + "/api/artifacts?kind=cohort");
    ok("saved cohorts are refused without a sign-in", r.status() === 403 || r.status() === 404, "HTTP " + r.status());
    // a built server knows its commit (lib/build-info.ts), says it at /api/version, and every page's footer agrees
    const v = await (await anon.request.get(BASE + "/api/version")).json();
    ok("/api/version names the commit this build was made from", /^[0-9a-f]{40}(\+dirty)?$/.test(v.commit || "") && /\/commit\/[0-9a-f]{40}$/.test(v.url || ""), JSON.stringify(v));
    const vp = await anon.newPage();
    await vp.goto(BASE + "/lab", { waitUntil: "domcontentloaded" });
    const stamp = await vp.locator("footer.build-stamp a").first();
    const [text, href] = [await stamp.textContent(), await stamp.getAttribute("href")];
    ok("the page footer shows the same commit, linked", text === v.label && href === v.url, text + " → " + href);
    await anon.close();
  }

  // Two people: what one saves, the other can neither list, open, change nor delete.
  if (LOGIN) {
    const a = await browser.newContext(), b = await browser.newContext();
    const steps = {};
    try {
      await signIn(a, "owner." + LOGIN); await signIn(b, "other." + LOGIN);
      const made = (await (await a.request.post(BASE + "/api/artifacts", { data: { kind: "cohort", name: "e2e private", definition: { all: [] } } })).json()).artifact;
      steps.listed = ((await (await b.request.get(BASE + "/api/artifacts?kind=cohort")).json()).artifacts || []).some((x) => x.id === made.id);
      steps.open = (await b.request.get(BASE + "/api/artifacts/" + made.id)).status();
      steps.patch = (await b.request.patch(BASE + "/api/artifacts/" + made.id, { data: { name: "taken" } })).status();
      steps.del = (await b.request.delete(BASE + "/api/artifacts/" + made.id)).status();
      steps.ownerStill = (await (await a.request.get(BASE + "/api/artifacts/" + made.id)).json()).artifact?.name;
      await a.request.delete(BASE + "/api/artifacts/" + made.id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("one person's saved cohort is invisible and untouchable to another",
      steps.listed === false && steps.open === 404 && steps.patch === 404 && steps.del === 404 && steps.ownerStill === "e2e private", JSON.stringify(steps));
    await a.close(); await b.close();
  }

  // Sharing through the page: an owner makes a group on the Groups page, adds someone by email,
  // shares a cohort with it from the Saved tab's dialog and an analysis the group may edit; the
  // member sees both under "Shared with you", opens the analysis and saves back to it, after which
  // the owner's save from the version they had is refused rather than overwriting.
  if (LOGIN) {
    const T = Date.now().toString(36), A = "ada." + T + "." + LOGIN, B = "bob." + T + "." + LOGIN;
    const ca = await browser.newContext({ viewport: { width: 1400, height: 900 } }), cb = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const steps = {}, errs = [];
    try {
      await signIn(ca, A); await signIn(cb, B);
      const a = await ca.newPage();
      a.on("pageerror", (e) => errs.push(e.message));
      await a.goto(BASE + "/groups", { waitUntil: "domcontentloaded" });
      await a.locator("input[aria-label='new group name']").fill("e2e lab " + T);
      await a.locator("button", { hasText: "Make group" }).click();
      await a.locator(".groupcard h2", { hasText: "e2e lab " + T }).waitFor({ timeout: 120000 });
      await a.locator("input[aria-label='email to add']").fill(B);
      await a.locator(".groupcard button", { hasText: "Add" }).click();
      steps.member = await a.locator(".membertable td", { hasText: B }).waitFor({ timeout: 30000 }).then(() => true, () => false);
      const mk = async (kind, name, definition) => (await (await ca.request.post(BASE + "/api/artifacts", { data: { kind, name, definition } })).json()).artifact;
      await mk("cohort", "e2e shared cohort " + T, { all: [{ kind: "oql", q: "KRAS: MUT" }] });
      const ws = await mk("workspace", "e2e shared analysis " + T, { study: "msk_chord_2024", title: "e2e shared analysis " + T,
        cohorts: { "KRAS mutant": { all: [{ kind: "oql", q: "KRAS: MUT" }] } }, views: [] });
      await a.goto(BASE + "/lab?tab=cohorts", { waitUntil: "domcontentloaded" });
      const dlg = a.locator("[role=dialog].sharedialog");
      const shareFrom = async (row, edit) => {
        await row.locator("button.sharebadge").click({ timeout: 120000 });
        await dlg.locator("label", { hasText: "A group" }).click();
        await dlg.locator("[role=combobox][title=group]").click();
        await a.locator("[role=option]").first().click();
        if (edit) await dlg.locator("label", { hasText: "can edit it too" }).click();
        await dlg.locator("button[type=submit]").click();
        return row.locator("button.sharebadge", { hasText: "shared:" }).innerText({ timeout: 30000 }).catch(() => "");
      };
      steps.cohort = await shareFrom(a.locator(".listrow", { hasText: "e2e shared cohort " + T }), false);
      await a.getByRole("tab", { name: "Analyses" }).click();
      steps.analysis = await shareFrom(a.locator(".listrow", { hasText: "e2e shared analysis " + T }), true);
      const b = await cb.newPage();
      b.on("pageerror", (e) => errs.push(e.message));
      await b.goto(BASE + "/lab?tab=cohorts", { waitUntil: "domcontentloaded" });
      steps.bobSees = (await b.locator(".listrow", { hasText: "e2e shared cohort " + T }).innerText({ timeout: 120000 }).catch(() => "")).includes("from " + A);
      await b.getByRole("tab", { name: "Analyses" }).click();
      await b.locator(".listrow", { hasText: "e2e shared analysis " + T }).locator("button", { hasText: "open" }).click();
      await b.locator("button[title*='” — ']").first().click({ timeout: 120000 });
      await b.locator("[role=dialog].wsdialog button", { hasText: "Save to theirs" }).click();
      for (let i = 0; i < 40 && (await (await ca.request.get(BASE + "/api/artifacts/" + ws.id)).json()).artifact.version < 2; i++) await b.waitForTimeout(250);
      steps.savedBack = (await (await ca.request.get(BASE + "/api/artifacts/" + ws.id)).json()).artifact.version;
      steps.stale = (await ca.request.patch(BASE + "/api/artifacts/" + ws.id, { data: { name: "x", definition: { views: [] }, version: 1 } })).status();
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("sharing from the page: a group, a shared cohort and an editable analysis, saved back by the member, a stale save refused",
      steps.member && /^shared: “e2e lab/.test(steps.cohort) && /who can edit$/.test(steps.analysis) && steps.bobSees &&
      steps.savedBack === 2 && steps.stale === 409 && !errs.length, JSON.stringify({ ...steps, errs }));
    await ca.close(); await cb.close();
  }

  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
    if (LOGIN) {
      const r = await signIn(ctx);
      ok("signs in (" + scheme + ")", r.ok(), "HTTP " + r.status());
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    // A console message about a failed resource does not say WHICH resource, which makes a
    // transient server error impossible to chase. Record the method, url and status too.
    page.on("response", r => {
      if (r.status() >= 500) errors.push("http " + r.status() + " " + r.request().method() + " " + r.url());
    });
    // net::ERR_ABORTED is the page cancelling a request it no longer needs (an analysis query
    // superseded by a later edit, use-analysis.ts), not a failure
    page.on("requestfailed", r => ((r.failure() || {}).errorText === "net::ERR_ABORTED") || errors.push("requestfailed " + r.method() + " " + r.url() +
      " (" + ((r.failure() || {}).errorText || "?") + ")"));

    // "/" no longer serves the standalone query-builder UI — it redirects into
    // the Analysis app, which subsumes it. Verify the redirect itself once
    // (scheme-independent) and use /lab as the base for both passes below.
    const rootResp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    ok(scheme + ": / redirects into the app", /\/lab(\?|$)/.test(page.url()) && rootResp.ok(),
      page.url() + " status " + rootResp.status());
    await page.waitForSelector("[aria-label='lab sections'] [role=tab]", { timeout: 90000 });
    ok(scheme + ": app shell loads", (await page.getByRole("tab").count()) >= 4);

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
        rationaleOk = svgCount > 0 && fallback === 0 && backLink === "/lab";
        rationaleInfo = "svg=" + svgCount + " fallback=" + fallback + " backLink=" + backLink;
      } catch (e) { rationaleInfo = String(e.message || e).slice(0, 100); }
      ok("/rationale renders with a live Mermaid diagram", rationaleOk, rationaleInfo);

      // /verification shows the recorded results of every check, and none of them failing.
      await page.goto(BASE + "/verification");
      let verifOk = false, verifInfo = "";
      try {
        await page.waitForSelector(".verif-page h1", { timeout: 60000 });
        const tiles = await page.locator(".repro-tile .n").allTextContents();
        const sections = await page.locator(".verif-sec").count();
        const failing = await page.locator(".verif-mark.err, .verif-pill.err").count();
        verifOk = tiles.length === 5 && sections >= 8 && failing === 0;
        verifInfo = "tiles=" + tiles.join(" ") + " sections=" + sections + " failing=" + failing;
      } catch (e) { verifInfo = String(e.message || e).slice(0, 100); }
      ok("/verification renders every check's recorded result, none failing", verifOk, verifInfo);
      await page.goto(BASE + "/lab");
      await page.waitForSelector("header a", { timeout: 60000 });
      const headerLinks = await page.locator("header a").allTextContents();
      ok("header nav points only at /rationale (oncoprint/builder links removed)",
        headerLinks.some(t => /rationale/i.test(t)) && !headerLinks.some(t => /^oncoprint$|^builder$/i.test(t)),
        headerLinks.join(", "));

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
      // 8px + a 1px border each side, matching .gsplit's frame — a deliberate
      // widening from the original 3px hint so clinical, genomic and the
      // alteration-split bar all read as one family of bar (see globals.css).
      ok("value bars stay small", !!vals.bars && !!barBox && barBox.h <= 10 && barBox.w <= 80,
        barBox ? vals.bars + " bars, " + barBox.w + "x" + barBox.h + "px" : "no bars found");

      // Every clinical attribute shows by default now (checked/unchecked from
      // "+ Add chart" > Clinical, not a positional "show N more" cutoff) — this
      // selection carries 66 attributes, well past the old default cap of 20.
      const attrTileCount = await page.locator("[data-attr]").count();
      ok("every clinical attribute shows by default, no positional cutoff",
        attrTileCount > 20, attrTileCount + " attribute tiles");

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
      await page.locator(".valrow, .slice").first().click();
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
        await page.getByRole("tab", { name: "Saved", exact: true }).click();
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
      await page.getByRole("tab", { name: "Saved", exact: true }).click();
      await page.waitForSelector(".pick [role=checkbox]", { timeout: 240000 });
      let seeded = [];
      try {
        await page.locator(".pick [role=checkbox]").nth(0).check();
        await page.locator("button:has-text('Analyze selected')").click();
        await page.waitForSelector(".cohortbox", { timeout: 300000 });
        seeded = Object.keys(JSON.parse(await page.locator("#docjson").inputValue()).cohorts || {});
      } catch { /* left empty */ }
      await page.getByRole("tab", { name: "Explore", exact: true }).click();
      await page.waitForSelector(".exbar", { timeout: 120000 });
      await page.waitForSelector(".pie, .vallist", { timeout: 240000 });
      await page.locator(".valrow, .slice").nth(2).click();
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

      // A view's genes are editable in the app. They used to be settable only by
      // hand-editing the document JSON — addView seeded them and nothing could
      // change them afterwards — which made "pick genes on the Analysis page"
      // untrue for every gene-bearing view.
      let geneEdit = "no compare view rendered", geneOk = false;
      try {
        await page.goto(BASE + "/lab?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
          views: [{ kind: "compare", genes: ["TP53", "KRAS", "EGFR"] }]
        })).toString("base64")));
        await page.waitForSelector("button.genesbtn", { timeout: 300000 });
        await page.locator("button.genesbtn").first().click();
        await page.waitForSelector("[role=dialog].genedialog", { timeout: 30000 });
        const panel = page.locator("[role=dialog].genedialog");
        const before = await panel.locator("[data-slot=badge]").count();
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
        await panel.locator("[data-slot=badge]", { hasText: "KRAS" }).first().click();
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
        await page.goto(BASE + "/lab?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
          views: [{ kind: "oncoprint", genes: ["TP53", "KRAS"] }]
        })).toString("base64")));
        await page.waitForSelector('button[title="download or open this figure elsewhere"]', { timeout: 300000 });
        const namedButton = await page.locator("button.genesbtn").first().innerText();
        await page.locator('button[title="download or open this figure elsewhere"]').click();
        const gear = page.locator("[data-slot=popover-content]");
        const gearHasEditor = (await gear.locator("[data-slot=badge]").count()) > 0;
        const gearHasCbioportal = (await gear.locator('a:has-text("cBioPortal")').count()) > 0;
        const gearHasDownloads = (await gear.locator("text=download figures").count()) > 0;
        // the button says how many rows it edits; the overflow menu is downloads/exports only —
        // no gene editor, and no cBioPortal escape hatch (removed: the portal can't express
        // cbio-lab cohorts or tracks, so the link only ever pointed at a different figure)
        gearOk = /^genes \(\d+\)$/.test(namedButton.trim()) && !gearHasEditor && !gearHasCbioportal && gearHasDownloads;
        gearSplit = "button '" + namedButton.trim() + "', menu has editor: " + gearHasEditor +
          ", menu has cBioPortal link: " + gearHasCbioportal + ", menu has downloads: " + gearHasDownloads;
      } catch (e) { gearSplit = String(e.message).split("\n")[0]; }
      ok("genes are a named button; the overflow menu holds downloads, not a cBioPortal link", gearOk, gearSplit);

      // Dragging across the plot picks columns and offers to make them a cohort. The count in
      // the dialog and the length of the id list must be the same number, and the cohort the
      // compiler evaluates must come back the same size — a selection that quietly grows or
      // shrinks on the way into the document would be worse than no selection at all.
      let dragWhat = "no oncoprint rendered", dragOk = false;
      try {
        await page.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
          views: [{ kind: "oncoprint", genes: ["TP53", "KRAS"] }]
        })).toString("base64url"));
        await page.waitForSelector("canvas", { timeout: 300000 });
        await page.waitForTimeout(1500);
        const box = await page.locator("canvas").first().boundingBox();
        const y = box.y + 40;
        await page.mouse.move(box.x + 400, y);
        await page.mouse.down();
        await page.mouse.move(box.x + 700, y, { steps: 10 });
        await page.mouse.up();
        await page.waitForSelector(".onco-select", { timeout: 60000 });
        const said = (await page.locator(".onco-select strong").innerText()).trim();
        const claimed = Number(said.replace(/[^0-9]/g, ""));
        await page.locator(".onco-select input").fill("dragged");
        await page.locator('.onco-select button:has-text("New cohort")').click();
        await page.waitForFunction(() => {
          try { return !!JSON.parse(document.querySelector("#docjson").value).cohorts["dragged"]; }
          catch { return false; }
        }, null, { timeout: 300000 });
        const leaf = (await page.evaluate(() => JSON.parse(document.querySelector("#docjson").value).cohorts["dragged"].all[0]));
        // the cohort summary shows what the compiler counted for that cohort, once it has counted it
        await page.waitForFunction(() => /dragged\s+[\d,]+\s+patients/.test(document.body.innerText), null, { timeout: 300000 });
        const counted = await page.evaluate(() => {
          const m = document.body.innerText.match(/dragged\s+([\d,]+)\s+patients/);
          return m ? Number(m[1].replace(/,/g, "")) : null;
        });
        dragOk = claimed > 0 && leaf.kind === "patientList" && leaf.ids.length === claimed && counted === claimed
          && leaf.ids.every((id) => id.startsWith("msk_chord_2024:"));
        dragWhat = said + " -> " + leaf.ids.length + " ids -> compiler counted " + counted;
      } catch (e) { dragWhat = String(e.message).split("\n")[0]; }
      ok("a drag across the oncoprint becomes a cohort of exactly those patients", dragOk, dragWhat);

      // A merged row pools several genes into one. It must be recognisable as one — the gutter
      // cannot say much in 168px, so the label is bracketed and hovering it names the members
      // and says what the percentage is over.
      let mergedWhat = "no oncoprint rendered", mergedOk = false;
      try {
        await page.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify({
          study: "msk_chord_2024",
          cohorts: { "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"], per: "sample" }] } },
          views: [{ kind: "oncoprint", genes: [{ label: "TP53 pathway", genes: ["TP53", "MDM2", "MDM4"] }, "TP53"] }]
        })).toString("base64url"));
        await page.waitForSelector("canvas", { timeout: 300000 });
        await page.waitForTimeout(2500);
        const box = await page.locator("canvas").first().boundingBox();
        await page.mouse.move(box.x + 40, box.y + 32);          // the merged row's gutter label
        await page.waitForTimeout(600);
        const tip = await page.evaluate(() => {
          const d = document.querySelector(".onco-tip");
          return d ? d.innerText.replace(/\n/g, " | ") : null;
        });
        mergedOk = !!tip && /TP53 pathway/.test(tip) && /MDM2/.test(tip) && /MDM4/.test(tip) && /profiled/.test(tip);
        mergedWhat = tip || "no tooltip on the track label";
      } catch (e) { mergedWhat = String(e.message).split("\n")[0]; }
      ok("a merged gene row names the genes it pools when its label is hovered", mergedOk, mergedWhat);

      // The toolbar separates what is drawn from how it is drawn, and a zone never wraps
      // inside itself — which is what stops a pair like the zoom controls being split by a
      // line break, the failure that started this work.
      let tbWhat = "no toolbar", tbOk = false;
      try {
        await page.setViewportSize({ width: 1024, height: 900 });
        await page.waitForTimeout(1200);
        const m = await page.evaluate(() => {
          const tb = document.querySelector(".viewtb");
          if (!tb) return null;
          const zones = [...tb.querySelectorAll(".tbz")];
          const wrapped = zones.filter((z) => {
            const cs = [...z.children].filter((c) => !c.classList.contains("tbl"))
              .map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
            return Math.max(...cs) - Math.min(...cs) > 3;
          }).length;
          return { zones: zones.length, wrapped, labels: [...tb.querySelectorAll(".tbl")].map((l) => l.textContent) };
        });
        tbOk = !!m && m.zones === 3 && m.wrapped === 0 && m.labels.join(",") === "data,view";
        tbWhat = m ? m.zones + " zones (" + m.labels.join(", ") + "), " + m.wrapped + " wrapped inside at 1024px" : "no toolbar";
        await page.setViewportSize({ width: 1400, height: 1000 });
      } catch (e) { tbWhat = String(e.message).split("\n")[0]; }
      ok("the oncoprint toolbar keeps its zones intact when it wraps", tbOk, tbWhat);

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
        (await page.locator("[aria-label='lab sections'] [role=tab][aria-selected=true]").innerText()).trim() === "Examples");

      // Cohorts tab: tick cohorts, submit them together. No per-row "add" links.
      await page.goto(BASE + "/lab");
      await page.getByRole("tab", { name: "Saved", exact: true }).click();
      await page.waitForSelector(".pick [role=checkbox]", { timeout: 240000 });
      ok("cohort rows use checkboxes, not per-row add links",
        (await page.locator("button:has-text('add to analysis')").count()) === 0,
        (await page.locator(".pick [role=checkbox]").count()) + " selectable cohorts");
      ok("submit is refused with nothing ticked",
        await page.locator("button:has-text('Analyze selected')").isDisabled());
      await page.locator(".pick [role=checkbox]").nth(0).check();
      await page.locator(".pick [role=checkbox]").nth(1).check();
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
      for (const label of ["Survival", "Oncoprint"]) {
        try {
          await page.locator(".addview button", { hasText: new RegExp("^" + label + "$") }).click();
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
        await page.locator(".addview button:has-text('Lollipop')").click();
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
        return el ? { text: el.textContent.trim(), title: el.title } : null;
      }));
      ok("each cohort in the summary says which studies it queried",
        studyLines.length > 0 && studyLines.every(s => s && s.text && s.title),
        studyLines.map(s => s ? s.text : "missing").join(" | "));

      // A kind already in the document shows as a selected pill, and clicking it removes the view.
      let pillOn = false, pillOff = false, left = [];
      try {
        const pill = page.locator(".addview button:has-text('Lollipop')");
        pillOn = (await pill.getAttribute("aria-pressed")) === "true";
        await pill.click();
        await page.waitForFunction(() => !document.querySelector(".lp-plot circle.lollipop-head"), null, { timeout: 30000 });
        left = (JSON.parse(await page.locator("#docjson").inputValue()).views || []).map(v => v.kind);
        pillOff = (await pill.getAttribute("aria-pressed")) === "false";
      } catch { /* left as failed */ }
      ok("a selected view pill removes its view when clicked", pillOn && pillOff && !left.includes("hotspots") && left.length > 0,
        "selected " + pillOn + " · deselected " + pillOff + " · views now " + (left.join(", ") || "none"));

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
        const before = await page.locator(".logrank").innerText();
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

      // Examples tab: the documented analysis documents, rendered as a gallery.
      // The docs gate already proves each one RUNS; this proves the app can
      // launch them and that the federated views actually paint something.
      await page.goto(BASE + "/lab");
      await page.getByRole("tab", { name: "Examples", exact: true }).click();
      await page.waitForSelector(".excard", { timeout: 120000 });
      const nCards = await page.locator(".excard").count();
      const { EXAMPLES } = await import("./lib/dsl-reference.ts");
      ok("examples gallery lists every documented example",
        nCards === EXAMPLES.length, nCards + " cards vs " + EXAMPLES.length + " examples");

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
      await page.getByRole("tab", { name: "Examples", exact: true }).click();
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
          if (!b || !b.getAttribute("title")) missing.push(name);
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
        await page.getByRole("tab", { name: "Examples", exact: true }).click();
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
    ok(scheme + ": no JS errors", errors.length === 0, errors.slice(0, 4).join(" | "));
    await ctx.close();
  }
  // Table views (app/_table/DataTable.tsx on lib/table-query.ts): search, a column's value
  // filter, a header sort and the CSV download, on the Results page's mutation table. Each one
  // re-runs the view in the database, so a check is a count the server agreed to, not a DOM trick.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/portal/results?study=coadread_tcga_pub&genes=KRAS,NRAS,BRAF", { waitUntil: "domcontentloaded" });
      await page.locator("button, [role=tab]").filter({ hasText: /^Mutations$/ }).first().click({ timeout: 120000 });
      const title = page.locator(".dt-title").first();
      await title.waitFor({ timeout: 240000 });
      // a change re-runs the view: the table covers its rows until the answer lands (its controls stay enabled)
      const settle = async () => {
        await page.waitForTimeout(300);
        await page.waitForFunction(() => !document.querySelector(".dt-wait") && !document.querySelector(".dt-bar .waiting"), null, { timeout: 120000 });
        await page.waitForTimeout(200);
      };
      const count = async () => { const m = /(?:([\d,]+) of )?([\d,]+) KRAS mutations/.exec(await title.innerText()); return m ? { kept: Number((m[1] || m[2]).replace(/,/g, "")), all: Number(m[2].replace(/,/g, "")) } : null; };
      const all = await count();
      ok("table: the mutation table lists KRAS's mutations", !!all && all.all > 50, JSON.stringify(all));
      await page.locator(".dt-search input").fill("G13");
      await page.locator(".dt-search input").press("Enter");
      await settle();
      const searched = await count();
      ok("table: search keeps only matching rows", !!searched && searched.kept > 0 && searched.kept < all.all && searched.all === all.all, JSON.stringify(searched));
      await page.getByRole("button", { name: "clear search" }).click();
      await settle();
      // waiting states, checked by holding the request (CLAUDE.md, "Verify waiting states by holding the request")
      {
        let release, open = false;
        const gate = new Promise((r) => (release = r)); gate.then(() => (open = true));
        await page.route("**/api/analysis**", async (route) => { if (!open) await gate; try { await route.continue(); } catch {} });
        await page.locator(".dt-search input").fill("G12"); await page.locator(".dt-search input").press("Enter");
        await page.waitForTimeout(800);
        const card = page.locator(".viewcard", { has: page.locator(".dt") });
        const w = { cover: await page.locator(".dt-wait").isVisible().catch(() => false), search: await page.locator(".dt-search input").isEnabled(),
          sort: await page.locator(".dt-sort").first().isEnabled(), cardCover: await card.locator(".view-updating").count() };
        release(); await page.unroute("**/api/analysis**");
        ok("table: while a query change runs, its rows are covered and its controls stay usable", w.cover && w.search && w.sort && w.cardCover === 0, JSON.stringify(w));
        await page.waitForFunction(() => !document.querySelector(".dt-wait"), null, { timeout: 120000 });
        await page.getByRole("button", { name: "clear search" }).click();
        await settle();
        await page.waitForFunction(() => !document.querySelector(".dt-wait"), null, { timeout: 120000 });
      }
      {
        let release, open = false;
        const gate = new Promise((r) => (release = r)); gate.then(() => (open = true));
        await page.route("**/api/view-page", async (route) => { if (!open && /"values"/.test(route.request().postData() || "")) await gate; try { await route.continue(); } catch {} });
        await page.getByRole("button", { name: "filter Mutation Type" }).click();
        await page.waitForTimeout(600);
        const w = { loader: await page.locator(".dt-pop .dt-loading .waiting").isVisible().catch(() => false), condition: await page.locator(".dt-pop [role=combobox]").isEnabled().catch(() => false) };
        release(); await page.unroute("**/api/view-page");
        await page.locator(".dt-values label").first().waitFor({ timeout: 60000 });
        ok("table: a filter whose values are loading shows a loader, not an empty list", w.loader && w.condition, JSON.stringify(w));
        await page.keyboard.press("Escape");
      }
      await page.getByRole("button", { name: "filter Protein Change" }).click();
      await page.locator(".dt-values label").first().waitFor({ timeout: 60000 });
      const top = await page.locator(".dt-values label").first().innerText();
      const [value, n] = top.trim().split(/\s+/);
      await page.locator(".dt-pop").getByRole("button", { name: "none" }).click();
      await page.locator(".dt-values label").first().locator("[role=checkbox]").check();
      await page.locator(".dt-pop").getByRole("button", { name: "apply" }).click();
      await settle();
      const picked = await count();
      ok("table: a value filter keeps exactly that value's rows", !!picked && picked.kept === Number(n), value + " listed " + n + ", table kept " + JSON.stringify(picked));
      await page.locator(".dt-sort", { hasText: "# Mut in Sample" }).click();
      await settle();
      const nums = (await page.locator(".dt-table tbody tr td:last-child").allInnerTexts()).map((x) => Number(x.replace(/,/g, ""))).filter((x) => !Number.isNaN(x));
      ok("table: a header click sorts the whole table, highest first", nums.length > 2 && nums.every((x, i) => i === 0 || nums[i - 1] >= x), nums.slice(0, 5).join(" "));
      // the download: every kept row, every column, as CSV, from the same document
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }).catch(() => null), page.locator("form[action='/api/table'] button").first().click()]);
      const csv = dl ? require("fs").readFileSync(await dl.path(), "utf8") : "";
      const lines = csv.trim().split(/\r?\n/);
      ok("table: the CSV holds every kept row with every column", lines[0].startsWith("cohort,study,sample,cancerType,proteinChange") && lines.length - 1 === picked.kept,
        (dl ? dl.suggestedFilename() : "no download") + " · " + (lines.length - 1) + " rows, header " + lines[0].slice(0, 60));
    } catch (e) {
      ok("table: the mutation table's controls", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("table: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The timeline view (app/lab/timeline-body.tsx on lib/timeline-svg.ts): the chosen patient's tracks with a
  // tooltip per event, a track that folds without a re-run, and the patient list (a dialog the navigator
  // opens) whose row click redraws another patient — a choice the document keeps, so a reload shows the same patient.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const doc = { study: "msk_chord_2024", cohorts: { "All patients": { all: [] } }, views: [{ kind: "timeline", patient: { study: "msk_chord_2024", id: "P-0000012" } }] };
    const b64 = Buffer.from(JSON.stringify(doc)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try {
      await page.goto(BASE + "/lab?tab=analysis&doc=" + b64, { waitUntil: "domcontentloaded" });
      await page.locator(".tl-fig svg").waitFor({ timeout: 240000 });
      const who = async () => (await page.locator(".tl-who").innerText()).trim();
      const marks = await page.locator(".tl-fig .tl-m").count();
      ok("timeline: draws the named patient's events", (await who()) === "P-0000012" && marks > 100, (await who()) + " · " + marks + " marks");
      const head = await page.locator(".vtitle", { hasText: /patient timeline/i }).innerText();
      const card = page.locator(".tl-view").locator("xpath=ancestor::*[contains(@class,'card')][1]");
      ok("timeline: the header names the cohort (no Showing line) and not the patient", /All patients/.test(head) && !/P-0000012/.test(head) && (await card.locator(".viewcohorts").count()) === 0, head);
      const askew = await misalignedControls(page, ".tl-view");
      ok("timeline: its controls share one height and centre line (navigator, settings)", askew.length === 0 && (await page.locator(".tl-view .tbz").count()) === 2, askew.join(" | "));
      const foot = await page.locator(".tl-view .vfoot").innerText();
      ok("timeline: the caption says what the axis cut and which samples are which", /cut from the axis/.test(foot) && /1 P-0000012-T02-IM3 \(Primary\)/.test(foot), foot.slice(0, 160));
      await page.locator(".tl-fig .tl-m").nth(20).hover();
      ok("timeline: an event's tooltip lists its attributes and day", /day -?\d+/.test(await page.locator(".tl-tip").innerText().catch(() => "")));
      let requests = 0;
      page.on("request", (r) => { if (r.url().includes("/api/analysis") || r.url().includes("/api/view")) requests++; });
      const agents = async () => page.locator(".tl-fig svg text", { hasText: "CISPLATIN" }).count();
      const before = await agents();
      await page.locator('.tl-h[data-uid="treatment"]').click();
      await page.waitForTimeout(400);
      ok("timeline: folding a track hides its sub-tracks, in the browser", before === 1 && (await agents()) === 0 && requests === 0, before + " → " + (await agents()) + ", " + requests + " requests");
      await page.getByRole("button", { name: "List/Search" }).click();
      await page.locator("[role=dialog].tl-patients tr.dt-pick").first().waitFor({ timeout: 120000 });
      ok("timeline: the patient list opens in a dialog from the navigator", (await page.evaluate(() => [...document.querySelectorAll("tr.dt-pick")].every((r) => r.closest("[role=dialog].tl-patients")))) && (await page.locator("[role=dialog].tl-patients").isVisible()));
      await page.locator("[role=dialog].tl-patients tr.dt-pick").nth(1).click();
      await page.waitForFunction(() => document.querySelector(".tl-who")?.textContent !== "P-0000012", null, { timeout: 120000 });
      const second = await who();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".tl-fig svg").waitFor({ timeout: 240000 });
      ok("timeline: a picked patient is the document's, so a reload keeps it", (await who()) === second && second !== "P-0000012", second + " → " + (await who()));
      // the navigator steps through the list in its order: the second row is patient 2, prev is the first row
      const pos = async () => (await page.locator(".tl-pos").innerText()).trim();
      await page.getByRole("button", { name: "List/Search" }).click();
      const firstRow = (await page.locator("[role=dialog].tl-patients tr.dt-pick").first().locator("td").first().innerText()).trim();
      await page.keyboard.press("Escape");
      await page.locator("[role=dialog].tl-patients").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      ok("timeline: Esc closes the patient list", (await page.locator("[role=dialog].tl-patients").count()) === 0);
      const at2 = await pos();
      await page.getByRole("button", { name: "prev", exact: true }).click();
      await page.waitForFunction((s) => document.querySelector(".tl-who")?.textContent !== s && !document.querySelector(".tl-fig.stale"), second, { timeout: 120000 });
      const back = await who(), at1 = await pos();
      await page.locator(".tl-fig").click({ position: { x: 4, y: 4 } });
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction((s) => document.querySelector(".tl-who")?.textContent !== s && !document.querySelector(".tl-fig.stale"), back, { timeout: 120000 });
      ok("timeline: prev / next (and →) step through the list in its order", /^patient 2 of /.test(at2) && back === firstRow && /^patient 1 of /.test(at1) && (await who()) === second,
        at2 + " · prev → " + back + " (" + at1 + ") · → " + (await who()));
    } catch (e) {
      ok("timeline: the patient timeline view", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("timeline: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The alterations view (app/lab/alterations-body.tsx on lib/patient-alterations.ts): one patient's three tables in
  // one card, each a table view with its own query — sorted, filtered and downloaded on its own — under the navigator
  // the timeline uses.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const doc = { study: "msk_chord_2024", cohorts: { Prostate: { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Prostate Cancer"], per: "sample" }] } },
      views: [{ kind: "alterations", patient: { study: "msk_chord_2024", id: "P-0024249" } }] };
    const b64 = Buffer.from(JSON.stringify(doc)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try {
      await page.goto(BASE + "/lab?tab=analysis&doc=" + b64, { waitUntil: "domcontentloaded" });
      await page.locator(".alt-table .dt-table").first().waitFor({ timeout: 240000 });
      const sec = (name) => page.locator("section.alt-table[aria-label='" + name + "']");
      const titles = await page.locator(".alt-table .dt-title").allInnerTexts();
      ok("alterations: the patient's three tables, in the portal's order", /^7 Mutations/.test(titles[0]) && /^3 Copy Number Alterations/.test(titles[1]) && /^3 Structural Variants/.test(titles[2]), titles.join(" | "));
      const muts = await sec("Mutations").locator("tbody tr").allInnerTexts();
      ok("alterations: mutations carry OncoKB's call and the cohort frequency", muts.some((r) => /KRAS\s+G12V\s+Oncogenic · Level 1/.test(r) && /\d+\.\d%/.test(r)), muts[0]);
      ok("alterations: a fusion lists both genes", (await sec("Structural Variants").locator("tbody tr").allInnerTexts()).some((r) => /TMPRSS2\s+ERG/.test(r)));
      const head = await page.locator(".vtitle", { hasText: /patient alterations/i }).innerText();
      ok("alterations: the header names the cohort and not the patient", /Prostate/.test(head) && !/P-0024249/.test(head), head);
      const askew = await misalignedControls(page, ".tl-view");
      ok("alterations: its controls share one height and centre line (navigator, pagers)", askew.length === 0 && (await page.locator(".tl-view .tbz").count()) === 4, askew.join(" | "));
      // a header click sorts that table alone
      const settle = () => page.waitForFunction(() => !document.querySelector(".dt-wait"), null, { timeout: 120000 });
      const cnaBefore = await sec("Copy Number Alterations").locator("tbody tr").allInnerTexts();
      await sec("Mutations").locator(".dt-sort", { hasText: "Allele Freq" }).click();
      await page.waitForFunction(() => /TP53/.test(document.querySelector("section.alt-table[aria-label='Mutations'] tbody tr")?.textContent || ""), null, { timeout: 120000 });
      await settle();
      const vafs = (await sec("Mutations").locator("tbody tr td:last-child").allInnerTexts()).map(Number);
      ok("alterations: a header click sorts its own table, highest first, and no other", vafs.length === 7 && vafs.every((x, i) => i === 0 || vafs[i - 1] >= x) &&
        JSON.stringify(await sec("Copy Number Alterations").locator("tbody tr").allInnerTexts()) === JSON.stringify(cnaBefore), vafs.join(" "));
      // a filter's values come from that table
      await sec("Copy Number Alterations").getByRole("button", { name: "filter Gene" }).click();
      await page.locator(".dt-values label").first().waitFor({ timeout: 60000 });
      const genes = await page.locator(".dt-values label").allInnerTexts();
      ok("alterations: a filter lists the values of its own table", genes.length === 3 && genes.some((g) => /MAP3K1/.test(g)), genes.join(" | "));
      await page.keyboard.press("Escape");
      // the download is the table's own
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }).catch(() => null), sec("Structural Variants").locator("form[action='/api/table'] button").click()]);
      const lines = (dl ? require("fs").readFileSync(await dl.path(), "utf8") : "").trim().split(/\r?\n/);
      ok("alterations: a table's CSV holds its rows with every column", lines[0].startsWith("cohort,study,samples,gene1,gene2") && lines.length === 4,
        (dl ? dl.suggestedFilename() : "no download") + " · " + lines.length + " lines");
      // the navigator steps to the next patient, and every table follows
      const pos = await page.locator(".tl-pos").innerText();
      await page.getByRole("button", { name: "next", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".tl-who")?.textContent !== "P-0024249", null, { timeout: 120000 });
      await settle();
      const titles2 = await page.locator(".alt-table .dt-title").allInnerTexts();
      ok("alterations: next › lists the next patient's tables", /^patient [\d,]+ of /.test(pos) && titles2.length === 3 && JSON.stringify(titles2) !== JSON.stringify(titles), pos + " → " + (await page.locator(".tl-who").innerText()) + " · " + titles2.join(" | "));
    } catch (e) {
      ok("alterations: the patient alterations view", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("alterations: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The lollipop's alteration grid (app/_lollipop/HotspotsBody.tsx): a control beside the plot, not part of
  // the figure. Hiding a class redraws the plot in the browser; on the Results page the mutation table follows
  // through its Alteration filter, and the selection is the document's, so it survives a reload.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/portal/results?study=coadread_tcga_pub&genes=TP53,APC", { waitUntil: "domcontentloaded" });
      await page.locator("button, [role=tab]").filter({ hasText: /^Mutations$/ }).first().click({ timeout: 120000 });
      await page.locator(".lp-grid").first().waitFor({ timeout: 240000 });
      await page.locator(".dt-title").first().waitFor({ timeout: 240000 });
      const settle = async () => {
        await page.waitForTimeout(300);
        await page.waitForFunction(() => !document.querySelector(".dt-wait") && !document.querySelector(".dt-bar .waiting"), null, { timeout: 120000 });
        await page.waitForTimeout(200);
      };
      await settle();
      const heads = () => page.locator(".lp-plot circle[r='2.8']").count();
      const tableCount = async () => { const m = /(?:([\d,]+) of )?([\d,]+) TP53 mutations/.exec(await page.locator(".dt-title").innerText()); return m ? { kept: Number((m[1] || m[2]).replace(/,/g, "")), all: Number(m[2].replace(/,/g, "")) } : null; };
      const svg = await page.locator(".lp-plot svg").first().innerHTML();
      ok("lollipop: the figure is the plot alone; the summary and the grid are controls beside it",
        !/Somatic Mutation Frequency|>Driver<|>VUS</.test(svg) && await page.locator(".lp-summary").count() > 0 && await page.locator(".lp-grid .lp-badge").count() >= 10);
      const h0 = await heads(), t0 = await tableCount();
      await page.locator(".lp-rowname", { hasText: "Missense" }).first().click();
      await page.waitForTimeout(300);
      const h1 = await heads(), banner = await page.locator(".lp-banner").innerText().catch(() => "");
      ok("lollipop: hiding Missense redraws the plot at once, and says what it shows", h1 > 0 && h1 < h0 && /Showing [\d,]+ of [\d,]+ mutations/.test(banner.replace(/\s+/g, " ")), h0 + " heads -> " + h1 + "; " + banner.replace(/\s+/g, " "));
      await settle();
      const t1 = await tableCount(), chip = await page.locator(".dt-chips").innerText().catch(() => "");
      ok("lollipop: on the Results page the table follows, through its Alteration filter", !!t1 && t1.kept < t0.kept && t1.all === t0.all && /Alteration/.test(chip), JSON.stringify(t0) + " -> " + JSON.stringify(t1));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".lp-grid").first().waitFor({ timeout: 240000 });
      await settle();
      ok("lollipop: the selection survives a reload", await heads() === h1 && /Showing/.test(await page.locator(".lp-banner").innerText().catch(() => "")));
      await page.getByRole("button", { name: "remove the filter on alteration" }).click();
      await settle();
      ok("lollipop: clearing the table's Alteration filter clears the grid", await heads() === h0 && await page.locator(".lp-banner").count() === 0 && (await tableCount()).kept === t0.kept);
    } catch (e) {
      ok("lollipop: the alteration grid", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("lollipop: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

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
    // Runs every gallery example against the live database, ~210s for 58 examples on a loaded
    // box; the limit bounds a hang, not the check.
    const out = execSync("npm run --silent docs:check", { cwd: __dirname, encoding: "utf8", timeout: 420000 });
    for (const line of out.trim().split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || "")).trim();
    for (const line of out.split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
    if (!/^FAIL /m.test(out)) results.push("FAIL docs:check crashed: " + String(e.message).slice(0, 120));
  }
  // A saved cohort added to a view is a COPY that remembers its source: the saved cohort's id and
  // the hash of what was copied. Editing the saved cohort changes nothing in the analysis until the
  // reader asks; the summary says the saved version changed and "Update" brings it in.
  if (LOGIN) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    let steps = {};
    try {
      await signIn(ctx);
      const name = "e2e source " + Date.now();
      const v1 = { study: "msk_chord_2024", all: [{ kind: "oql", q: "KRAS: MUT" }] };
      const v2 = { study: "msk_chord_2024", all: [{ kind: "oql", q: "KRAS: MUT" }, { kind: "clinical", attribute: "SEX", values: ["Female"] }] };
      const made = await (await ctx.request.post(BASE + "/api/artifacts", { data: { kind: "cohort", name, definition: v1 } })).json();
      const id = made.artifact.id;
      const docOf = async () => JSON.parse(await sp.locator("#docjson").inputValue());
      // the store is jsonb, which does not keep key order: compare values, not text
      const keyed = (x) => JSON.stringify(x, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v);
      await sp.goto(BASE + "/lab?tab=analysis", { waitUntil: "domcontentloaded" });
      await sp.locator(".addview button:has-text('Survival')").click();
      await sp.locator(".emptyview .emptyview-body button").first().click();
      await sp.getByRole("tab", { name: "Library" }).click();
      await sp.locator(".addcohortdialog .acd-row", { hasText: name }).getByRole("button").click();
      await sp.waitForSelector(".cohortbox", { timeout: 120000 });
      const copied = (await docOf()).cohorts[name];
      steps.copied = !!copied && copied.from?.saved === id && /^[0-9a-f]{64}$/.test(copied.from?.hash || "");
      await ctx.request.patch(BASE + "/api/artifacts/" + id, { data: { name, definition: v2 } });
      await sp.reload({ waitUntil: "domcontentloaded" });
      await sp.waitForSelector(".srcbadge.changed", { timeout: 120000 });
      steps.untouched = keyed((await docOf()).cohorts[name].all) === keyed(v1.all);
      await sp.locator(".srcbadge.changed").click();
      await sp.getByRole("button", { name: "Update to the saved version" }).click();
      await sp.waitForFunction(() => !document.querySelector(".srcbadge.changed"), null, { timeout: 60000 });
      const after = (await docOf()).cohorts[name];
      steps.updated = keyed(after.all) === keyed(v2.all) && after.from.hash !== copied.from.hash;
      await ctx.request.delete(BASE + "/api/artifacts/" + id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("a saved cohort is copied with its source, left alone when the saved one changes, and updated on request",
      steps.copied && steps.untouched && steps.updated, JSON.stringify(steps));
    await ctx.close();
  }
  // A cohort with something to save — never saved, or re-split since — offers "save" in its gear
  // menu; saving makes the analysis's copy name the saved cohort as its source, and the item goes.
  if (LOGIN) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    let steps = {};
    try {
      await signIn(ctx);
      const name = "e2e save " + Date.now();
      const docOf = async () => JSON.parse(await sp.locator("#docjson").inputValue());
      const open = async (doc) => {
        const b64 = Buffer.from(JSON.stringify(doc)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        await sp.goto(BASE + "/lab?tab=analysis&doc=" + b64, { waitUntil: "domcontentloaded" });
        await sp.waitForSelector(".cohortbox", { timeout: 120000 });
      };
      const menuItems = async () => {
        const box = sp.locator(".cohortbox", { hasText: name });
        const gear = box.locator(".cohortgear");
        if ((await gear.getAttribute("data-state")) !== "open") await gear.click();
        const items = await sp.locator("[data-slot=popover-content]").getByRole("button").allInnerTexts();
        return { box, items };
      };
      const savedDef = async () => {
        const j = await (await ctx.request.get(BASE + "/api/artifacts?kind=cohort")).json();
        return (j.artifacts || []).find((a) => a.name === name);
      };
      await open({ dsl: "2.5", study: "msk_chord_2024", cohorts: { [name]: { all: [{ kind: "oql", q: "KRAS: MUT" }] } }, views: [{ kind: "survival", cohorts: [name] }] });
      let m = await menuItems();
      steps.offered = m.items.some((t) => t.trim() === "save to library");
      await sp.locator("[data-slot=popover-content]").getByRole("button", { name: "save to library", exact: true }).click();
      await sp.waitForFunction((n) => { try { return !!JSON.parse(document.querySelector("#docjson").value).cohorts[n].from; } catch { return false; } }, name, { timeout: 60000 });
      const a1 = await savedDef();
      steps.saved = !!a1 && (await docOf()).cohorts[name].from.saved === a1.id;
      m = await menuItems();
      steps.goneAfter = !m.items.some((t) => /^save/.test(t.trim()));
      const d = await docOf();
      d.cohorts[name].splits = { sex: { arms: [{ name: "Female", where: { kind: "clinical", attribute: "SEX", values: ["Female"] } }] } };
      await open(d);
      m = await menuItems();
      steps.offeredAfterSplit = m.items.some((t) => t.trim() === "save changes to library");
      await sp.locator("[data-slot=popover-content]").getByRole("button", { name: "save changes to library", exact: true }).click();
      for (let i = 0; i < 60 && !(await savedDef())?.definition?.splits; i++) await sp.waitForTimeout(1000);
      const a2 = await savedDef();
      steps.splitSaved = !!a2 && a2.id === a1.id && !!a2.definition.splits?.sex && !a2.definition.from;
      await ctx.request.delete(BASE + "/api/artifacts/" + a1.id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("a cohort that is unsaved, or re-split since saving, offers save in its menu, and saving records it as the source",
      steps.offered && steps.saved && steps.goneAfter && steps.offeredAfterSplit && steps.splitSaved, JSON.stringify(steps));
    await ctx.close();
  }
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
      // "add all" over every study is refused, naming the limit: each study adds dozens of
      // facet queries, and nothing here needs more than a handful
      const addAll = sp.getByRole("button", { name: /^add all/ });
      const refused = await addAll.isDisabled();
      const refusedWhy = (await addAll.getAttribute("title")) || "";
      ok("add all is refused past 30 studies, saying so", refused && /at most 30 studies/.test(refusedWhy), refusedWhy.slice(0, 90));
      // a narrow search: two ticks, then add all picks up the rest of it
      await sp.locator('input[placeholder^="search name"]').fill("thymoma");
      await sp.waitForTimeout(300);
      const boxes = sp.locator('.study-row [role=checkbox]');
      for (let i = 0; i < 2; i++) { await boxes.nth(i).click(); await sp.waitForTimeout(250); }
      await addAll.click();
      await sp.waitForTimeout(2500);                  // well past the 350ms fetch debounce
      ok("staging studies queries nothing", apiCalls === 0,
        apiCalls === 0 ? "0 requests over 2 ticks + add-all" : apiCalls + " request(s) fired before submit");
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

  // the analysis page's requests finishing out of order (e2e-lab-races.cjs)
  await require("./e2e-lab-races.cjs").labRaces(browser, ok, BASE);
  // the Saved tab's lists: loading, failed and empty said apart; a re-save updates (e2e-saved.cjs)
  if (LOGIN) await require("./e2e-saved.cjs").savedLists(browser, ok, BASE, LOGIN);

  await browser.close();

  // Panel-aware denominator gate. A gene's frequency is altered / profiled-for-
  // that-gene, resolved through the panel tables — and the wrong version, a
  // study-or-cohort total, produces plausible percentages rather than an error.
  // Runs against the live database over studies whose panels genuinely differ.
  try {
    const { execSync } = require("child_process");
    const out = execSync("npm run --silent check:denominators", { cwd: __dirname, encoding: "utf8", timeout: 300000 });
    for (const line of out.trim().split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || "")).trim();
    for (const line of out.split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
    if (!/^FAIL /m.test(out)) results.push("FAIL check:denominators crashed: " + String(e.message).slice(0, 120));
  }

  // Gene-status facet gate. A filterable facet's count comes from one query and
  // its cohort from a compiled clause; nothing forces them to agree, and both
  // ways this broke during development were invisible in the output's shape.
  try {
    const { execSync } = require("child_process");
    const out = execSync("npm run --silent check:genefacets", { cwd: __dirname, encoding: "utf8", timeout: 300000 });
    for (const line of out.trim().split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || "")).trim();
    for (const line of out.split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
    if (!/^FAIL /m.test(out)) results.push("FAIL check:genefacets crashed: " + String(e.message).slice(0, 120));
  }

  // Value-folding gate. A facet click compiles to an equality on the value, so
  // while `Female` and `FEMALE` were separate literals the click selected one of
  // them and the cohort was silently short — 35.6% short in breast_msk_2025.
  // The source tripwire can only see that both sides share one fold expression;
  // this confirms the resulting cohort is actually the whole group.
  try {
    const { execSync } = require("child_process");
    const out = execSync("npm run --silent check:values", { cwd: __dirname, encoding: "utf8", timeout: 300000 });
    for (const line of out.trim().split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || "")).trim();
    for (const line of out.split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
    if (!/^FAIL /m.test(out)) results.push("FAIL check:values crashed: " + String(e.message).slice(0, 120));
  }

  // splitBy performance gate — the first of its kind (see docs/PERFORMANCE.md: everything
  // else there is a manual snapshot, not a gate). splitBy can turn one cohort into up to
  // SPLIT_BY_MAX_ARMS_CEILING of them for a single view with one click; this asserts query
  // count scales with arm count, not worse, and that a near-ceiling split stays well under a
  // generous wall-clock budget.
  try {
    const { execSync } = require("child_process");
    const out = execSync("npm run --silent check:splitby-perf", { cwd: __dirname, encoding: "utf8", timeout: 300000 });
    for (const line of out.trim().split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || "")).trim();
    for (const line of out.split("\n")) if (/^(PASS|FAIL) /.test(line)) results.push(line);
    if (!/^FAIL /m.test(out)) results.push("FAIL check:splitby-perf crashed: " + String(e.message).slice(0, 120));
  }

  console.log(results.join("\n"));
  process.exit(results.some(r => r.startsWith("FAIL")) ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(2); });
