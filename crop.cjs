const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");
const OUT = "/tmp/claude-1000/-home-ubuntu-projects-cbio-next-oncoprint/27bd30cd-678e-4d89-9b2a-3132514f452e/scratchpad/";
const doc = { study: "msk_chord_2024",
  cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
  views: [{ kind: "oncoprint", genes: [{ label: "TP53 pathway", genes: ["TP53","MDM2","MDM4"] }, "KRAS", "SMAD4"], clinical: ["CANCER_TYPE"] }] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome", args: ["--no-sandbox"] });
  for (const w of [1024, 1280, 1600]) {
    const page = await b.newPage({ viewport: { width: w, height: 1000 } });
    await page.goto("http://localhost:3107/analysis?tab=analysis&doc=" + Buffer.from(JSON.stringify(doc)).toString("base64url"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 300000 });
    await page.waitForTimeout(9000);
    const tb = await page.locator(".onco-tb").first().boundingBox();
    const card = await page.locator(".viewcard").first().boundingBox();
    // how many rows does the strip occupy, and does any zone wrap inside itself?
    const rows = await page.evaluate(() => {
      const tb = document.querySelector(".onco-tb");
      const tops = new Set([...tb.children].map((c) => Math.round(c.getBoundingClientRect().top)));
      // on one line every child shares a centre; a wrap moves some of them down
      const wrapped = [...tb.querySelectorAll(".tbz")].filter((z) => {
        const cs = [...z.children].filter((c) => !c.classList.contains('tbl')).map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
        return Math.max(...cs) - Math.min(...cs) > 3;
      }).length;
      const z0 = tb.querySelector(".tbz");
      const g = z0.querySelector("details");
      window.__dbg = { zoneAlign: getComputedStyle(z0).alignItems, zoneH: z0.getBoundingClientRect().height,
        gMargin: getComputedStyle(g).margin, gPos: getComputedStyle(g).position, gTop: getComputedStyle(g).top,
        gParent: g.parentElement.className, sumH: g.querySelector("summary").getBoundingClientRect().height };
      const detail = [...tb.querySelectorAll(".tbz")].map((z) => [...z.children]
        .filter((c) => !c.classList.contains("tbl"))
        .map((c) => { const r = c.getBoundingClientRect(); return (c.className || c.tagName).split(" ")[0] + " h=" + Math.round(r.height) + " top=" + Math.round(r.top) + " cs=" + getComputedStyle(c).display + "/" + getComputedStyle(c).alignSelf; }));
      return { strip: tops.size, wrappedZones: wrapped, height: Math.round(tb.getBoundingClientRect().height), detail };
    });
    console.log(w + "px: strip rows=" + rows.strip + "  zones that wrapped inside=" + rows.wrappedZones + "  strip height=" + rows.height + "px"); console.log("   ", JSON.stringify(rows.detail)); console.log("    dbg", JSON.stringify(await page.evaluate(() => window.__dbg)));
    await page.screenshot({ path: OUT + "tb-" + w + ".png", clip: { x: card.x, y: card.y, width: card.width, height: (tb.y - card.y) + tb.height + 16 } });
    await page.close();
  }
  await b.close();
})();
