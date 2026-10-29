// The patient views: timeline and alterations.
const { misalignedControls } = require("./helpers.cjs");

async function patientViews({ browser, ok, BASE }) {
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
    const doc = { study: "msk_chord_2024", cohorts: { Prostate: { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Prostate Cancer"] }] } },
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
}

module.exports = { patientViews };
