// Every view kind held to a browser check is drawn on the analysis page: its gallery snapshot example
// (`snapshot: "<kind>"`, lib/dsl-reference.ts) opened from a ?doc= link, each view's card drawn with
// a figure or table, no error in it and no JS error. The kinds whose own area already draws them
// (and does more) list themselves in that area's `covers`; test/e2e-coverage.test.ts holds the lists
// against lib/views/kinds.ts.

/** the kinds this area draws; a kind leaves this list only for an area that checks it more closely */
const covers = [
  "alterations", "assays", "cancertypes", "clinical", "coexpression", "compare", "cooccurrence",
  "correlates", "datafiles", "diffexpr", "enrichment", "hotspots", "mutations", "overlap", "pathways", "plot",
  "survival", "sv", "table", "timeline",
];

/** at most this many pages at once: each runs its example against the warehouse */
const AT_ONCE = 3;

async function drawKind({ ctx, ok, BASE, encodeUrlJson, EXAMPLES }, kind) {
  const ex = EXAMPLES.find((e) => e.snapshot === kind);
  if (!ex || ex.customData?.length) {
    ok("view kinds: " + kind + " has a snapshot example without custom data to draw", false, ex ? "its example needs custom data" : "no example marked snapshot: \"" + kind + "\"");
    return;
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push("http " + r.status() + " " + r.request().method() + " " + r.url()); });
  const t0 = Date.now();
  try {
    await page.goto(BASE + "/lab?tab=analysis&doc=" + encodeUrlJson(ex.doc), { waitUntil: "domcontentloaded" });
    const n = ex.doc.views.length;
    // every card is in, none waiting for its first result and none covered by "updating…"
    await page.waitForFunction((n) => document.querySelectorAll(".viewcard").length >= n &&
      !document.querySelector(".viewcard.viewloading, .view-updating"), n, { timeout: 240000 });
    const cards = await page.locator(".viewcard").evaluateAll((cs) => cs.map((c) => {
      const drawn = [...c.querySelectorAll("svg, canvas, table")].some((el) => { const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 40; });
      const err = c.querySelector("[role=alert].error");
      return { drawn, error: err ? err.textContent.trim().slice(0, 160) : null };
    }));
    const bad = cards.map((c, i) => c.error ? "card " + (i + 1) + ": " + c.error : c.drawn ? null : "card " + (i + 1) + ": nothing drawn").filter(Boolean);
    ok("view kinds: " + kind + " draws its example (" + ex.doc.views.map((v) => v.kind).join(" + ") + ")",
      cards.length === n && bad.length === 0, cards.length + " of " + n + " cards, " + (Date.now() - t0) + " ms" + (bad.length ? " · " + bad.join(" | ") : ""));
  } catch (e) {
    ok("view kinds: " + kind + " draws its example", false, String(e.message).split("\n")[0].slice(0, 200));
  }
  ok("view kinds: " + kind + " no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

async function viewKinds(t) {
  const { encodeUrlJson } = await import("../../lib/url-json.ts");
  const { EXAMPLES } = await import("../../lib/dsl-reference.ts");
  const ctx = await t.browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const queue = [...covers];
  const worker = async () => { for (let k; (k = queue.shift());) await drawKind({ ...t, ctx, encodeUrlJson, EXAMPLES }, k); };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  await ctx.close();
}

module.exports = { viewKinds, covers };
