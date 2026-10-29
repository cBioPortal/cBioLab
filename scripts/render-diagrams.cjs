// Renders each docs/diagrams/*.html to a PNG beside it, for docs/ARCHITECTURE.md.
// Edit the HTML, then `node scripts/render-diagrams.cjs` and commit both.
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { launch } = require("../e2e-browser.cjs");

const dir = join(__dirname, "..", "docs", "diagrams");

void (async () => {
  const browser = await launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1244, height: 800 }, deviceScaleFactor: 2 });
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    await page.goto("file://" + join(dir, f));
    await page.locator(".wrap").screenshot({ path: join(dir, f.replace(/\.html$/, ".png")) });
    console.log("rendered " + f.replace(/\.html$/, ".png"));
  }
  await browser.close();
})();
