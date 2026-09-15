// The layout numbers the design audit set targets for, measured against a running server.
//
//   node scripts/layout-metrics.cjs [http://localhost:3107]
//
// Layout work drifts back unless the target is a number. This measures the ones that matter:
// how many rows the oncoprint's control strip takes at three widths, whether any zone of it
// wrapped inside itself (which is how a pair of controls gets split), how wide the plot is on
// a large monitor, and how many distinct font sizes and inline style objects the source still
// carries. Needs a dev server with credentials; it draws a real figure.
const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const BASE = process.argv[2] || "http://localhost:3107";
const CHROME = process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome";
const DOC = { study: "msk_chord_2024",
  cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
  views: [{ kind: "oncoprint", genes: [{ label: "TP53 pathway", genes: ["TP53", "MDM2", "MDM4"] }, "KRAS", "SMAD4"],
            clinical: ["CANCER_TYPE"] }] };

const measure = () => ({
  // one row per distinct top edge among the strip's zones
  rows: new Set([...document.querySelector(".viewtb").children]
    .map((x) => Math.round(x.getBoundingClientRect().top))).size,
  // on one line every control in a zone shares a centre; a wrap moves some of them down
  wrappedZones: [...document.querySelectorAll(".tbz")].filter((z) => {
    const cs = [...z.children].filter((c) => !c.classList.contains("tbl"))
      .map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
    return Math.max(...cs) - Math.min(...cs) > 3;
  }).length,
  stripHeight: Math.round(document.querySelector(".viewtb").getBoundingClientRect().height),
  plot: Math.round(document.querySelector("canvas").getBoundingClientRect().width - 168)
});

function sourceCounts() {
  const root = join(__dirname, "..");
  const css = readFileSync(join(root, "app/globals.css"), "utf8");
  const files = ["app/lab/page.tsx", "app/_oncoprint/OncoprintFigure.tsx"].map((f) => readFileSync(join(root, f), "utf8"));
  const sizes = new Set([...css.matchAll(/font-size: *([0-9.]+rem)/g)].map((m) => m[1]));
  for (const f of files) for (const m of f.matchAll(/fontSize: *"([0-9.]+rem)"/g)) sizes.add(m[1]);
  return { fontSizes: sizes.size, inlineStyles: files.reduce((n, f) => n + (f.match(/style=\{\{/g) || []).length, 0) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const url = BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify(DOC)).toString("base64url");
  const rows = [];
  for (const w of [1024, 1280, 1600, 2560]) {
    const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 300000 });
    await page.waitForTimeout(8000);
    rows.push([w + "px", await page.evaluate(measure)]);
    await page.close();
  }
  await browser.close();
  for (const [label, m] of rows)
    console.log(label.padEnd(24) + "strip rows " + m.rows + " · height " + String(m.stripHeight).padStart(3) + "px · " +
      "zones wrapped inside " + m.wrappedZones + " · plot " + m.plot + "px");
  const src = sourceCounts();
  console.log("source".padEnd(24) + "distinct font sizes " + src.fontSizes + " · inline style objects " + src.inlineStyles);
})();
