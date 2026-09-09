const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");
const OUT = "/tmp/claude-1000/-home-ubuntu-projects-cbio-next-oncoprint/27bd30cd-678e-4d89-9b2a-3132514f452e/scratchpad/";
const doc = { study: "msk_chord_2024",
  cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
  views: [{ kind: "oncoprint", genes: [{ label: "TP53 pathway", genes: ["TP53","MDM2","MDM4"] }, "KRAS", "SMAD4"], clinical: ["CANCER_TYPE"] },
          { kind: "compare", genes: ["TP53","KRAS"] }] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome", args: ["--no-sandbox"] });
  const tag = process.argv[2] || "x";
  for (const w of [1280]) {
    const page = await b.newPage({ viewport: { width: w, height: 1200 } });
    page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0,140)); });
    await page.goto("http://localhost:3107/analysis?tab=analysis&doc=" + Buffer.from(JSON.stringify(doc)).toString("base64url"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 300000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: OUT + "p-" + tag + "-" + w + ".png", fullPage: true });
    await page.close();
  }
  await b.close();
})();
