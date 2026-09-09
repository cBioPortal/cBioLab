const { chromium } = require("/home/ubuntu/cohort-lab/node_modules/playwright");
const OUT = "/tmp/claude-1000/-home-ubuntu-projects-cbio-next-oncoprint/27bd30cd-678e-4d89-9b2a-3132514f452e/scratchpad/";
const doc = { study: "msk_chord_2024",
  cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
  views: [{ kind: "oncoprint", genes: [{ label: "TP53 pathway", genes: ["TP53","MDM2","MDM4"] }, "KRAS", "SMAD4"], clinical: ["CANCER_TYPE"] }] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + "/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome", args: ["--no-sandbox"] });
  for (const w of [1600, 2560]) {
    const page = await b.newPage({ viewport: { width: w, height: 1000 } });
    await page.goto("http://localhost:3107/analysis?tab=analysis&doc=" + Buffer.from(JSON.stringify(doc)).toString("base64url"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 300000 });
    await page.waitForTimeout(8000);
    const meas = async () => page.evaluate(() => {
      const c = document.querySelector("canvas");
      const tb = document.querySelector(".onco-tb");
      const tops = new Set([...tb.children].map((x) => Math.round(x.getBoundingClientRect().top)));
      return { plot: Math.round(c.getBoundingClientRect().width - 168), rows: tops.size };
    });
    console.log(w + "px  with document: " + JSON.stringify(await meas()));
    await page.locator('button:has-text("hide document")').click();
    await page.waitForTimeout(1800);
    console.log(w + "px  document hidden: " + JSON.stringify(await meas()));
    if (w === 2560) await page.screenshot({ path: OUT + "wide.png", clip: { x: 0, y: 100, width: 2560, height: 640 } });
    await page.close();
  }
  await b.close();
})();
