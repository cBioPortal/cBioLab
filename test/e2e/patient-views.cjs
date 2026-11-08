// The patient views: timeline, alterations, genomic evolution and the genomic overview.
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

  // The evolution view (app/lab/evolution-body.tsx on lib/views/evolution/figure.ts), as the Patient page's Genomic
  // Evolution tab draws it: a mutation's line (or heatmap row) and its table row are linked — hovering either picks
  // out both, with the portal's tooltip, and a click keeps it picked until clicked again or cleared. Known values:
  // IM-GBM-28's 8 drawn mutations over 4 samples, and STAG2 N141I in Patient-28-T2 at 48 of 174 reads, as
  // cbioportal.org's Genomic Evolution tab shows it.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    try {
      await page.goto(BASE + "/portal/patient?study=glioma_msk_2018&patient=IM-GBM-28&tab=" + encodeURIComponent("Genomic Evolution"), { waitUntil: "domcontentloaded" });
      await page.locator(".evo-fig .evo-line").first().waitFor({ timeout: 240000 });
      const rows = page.locator("section.alt-table[aria-label='Mutations'] tbody tr");
      await rows.first().waitFor({ timeout: 120000 });
      const lines = page.locator(".evo-fig .evo-line");
      ok("evolution: draws a line per mutation the table keeps", (await lines.count()) === 8 && (await rows.count()) === 8, (await lines.count()) + " lines, " + (await rows.count()) + " rows");
      const titles = await page.evaluate(() => document.querySelectorAll(".evo-fig svg > title, .evo-fig [data-key] title").length);
      ok("evolution: the browser's own tooltips are not drawn over the page's", titles === 0, titles + " <title>s");
      const state = () => page.evaluate(() => ({
        dim: !!document.querySelector(".evo-fig.evo-hot"),
        marks: [...document.querySelectorAll(".evo-fig [data-key].hot")].map((g) => g.getAttribute("data-key")),
        hotRows: [...document.querySelectorAll("section.alt-table tr.dt-hot")].map((r) => r.textContent),
        picked: [...document.querySelectorAll("section.alt-table tr.sel")].map((r) => r.textContent),
      }));
      const away = async () => { await page.mouse.move(2, 2); await page.waitForTimeout(150); };
      const stag2 = page.locator('.evo-fig .evo-line[data-key^="STAG2|N141I|"]');
      // hover a point: its line and its row, and the portal's tooltip
      await stag2.locator('[data-s="2"]').hover();
      await page.waitForTimeout(150);
      let s = await state();
      const tip = (await page.locator(".evo-tip").innerText().catch(() => "")).split("\n").map((x) => x.trim()).filter(Boolean);
      ok("evolution: hovering a line picks out it and its table row, dimming the rest",
        s.dim && s.marks.length === 1 && s.marks[0].startsWith("STAG2|N141I|") && s.hotRows.length === 1 && /STAG2\s*N141I/.test(s.hotRows[0]), JSON.stringify(s).slice(0, 200));
      ok("evolution: a point's tooltip is the portal's — gene, protein change, sample, VAF with its reads",
        JSON.stringify(tip) === JSON.stringify(["Gene: STAG2", "Protein Change: N141I", "Sample ID: Patient-28-T2", "VAF: 0.28 (48 reads of 174 total)"]), tip.join(" | "));
      const inside = () => page.evaluate(() => {
        const t = document.querySelector(".evo-tip")?.getBoundingClientRect(), f = document.querySelector(".tl-fig")?.getBoundingClientRect();
        return !!t && !!f && t.left >= f.left - 1 && t.right <= f.right + 1 && t.top >= f.top - 1 && t.bottom <= f.bottom + 1;
      });
      ok("evolution: the tooltip stays inside the figure", await inside());
      await away();
      s = await state();
      ok("evolution: leaving the figure lets go", !s.dim && s.marks.length === 0 && s.hotRows.length === 0 && (await page.locator(".evo-tip").count()) === 0, JSON.stringify(s).slice(0, 160));
      // hover a table row: its line
      const row = rows.filter({ hasText: "R282G" });
      await row.hover();
      await page.waitForTimeout(150);
      s = await state();
      ok("evolution: hovering a table row picks out its line", s.dim && s.marks.length === 1 && s.marks[0].startsWith("TP53|R282G|") && s.hotRows.length === 1, s.marks.join(", "));
      // click: kept after the pointer leaves; a row click adds; a second click lets go; clear empties
      await stag2.locator('[data-s="0"]').click();
      await away();
      s = await state();
      ok("evolution: a clicked line stays picked out, with its table row", s.dim && s.marks.length === 1 && s.marks[0].startsWith("STAG2|N141I|") && s.picked.length === 1 && /STAG2/.test(s.picked[0]), JSON.stringify(s).slice(0, 200));
      await row.click();
      await away();
      s = await state();
      const note = await page.locator(".vfoot", { hasText: "picked" }).innerText().catch(() => "");
      ok("evolution: a clicked table row is picked too, and the note counts them", s.marks.length === 2 && s.picked.length === 2 && /2 picked/.test(note), s.marks.join(", ") + " · " + note.slice(-40));
      await stag2.locator('[data-s="0"]').click();
      await away();
      s = await state();
      ok("evolution: a second click lets a mutation go", s.marks.length === 1 && s.marks[0].startsWith("TP53|R282G|") && s.picked.length === 1, s.marks.join(", "));
      // the heatmap: the same linking by row, the pick kept across the switch, and the tooltip kept inside at the edge
      await page.getByRole("button", { name: "Heatmap" }).click();
      await page.locator(".evo-fig .evo-row").first().waitFor({ timeout: 120000 });
      await page.waitForFunction(() => !document.querySelector(".tl-fig.stale"), null, { timeout: 120000 });
      await page.waitForTimeout(150);
      s = await state();
      ok("evolution: a pick is kept when the chart switches to the heatmap", s.marks.length === 1 && s.marks[0].startsWith("TP53|R282G|"), s.marks.join(", "));
      await page.locator('.evo-fig .evo-row[data-key^="STAG2|N141I|"] [data-s="0"]').hover();
      await page.waitForTimeout(150);
      s = await state();
      const htip = await page.locator(".evo-tip").innerText().catch(() => "");
      ok("evolution: hovering a heatmap cell picks out its row and table row, with the cell's tooltip",
        s.marks.some((k) => k.startsWith("STAG2|N141I|")) && s.hotRows.length === 1 && /STAG2/.test(s.hotRows[0]) && /Sample ID: Patient-28-T1/.test(htip) && /VAF: 0\.81/.test(htip), htip.replace(/\n/g, " | "));
      ok("evolution: a tooltip at the figure's edge stays inside it", await inside());
      await away();
      await page.getByRole("button", { name: "clear selection" }).click();
      await page.waitForTimeout(150);
      s = await state();
      ok("evolution: clear selection lets every mutation go", !s.dim && s.marks.length === 0 && s.picked.length === 0, JSON.stringify(s).slice(0, 160));
    } catch (e) {
      ok("evolution: the genomic evolution view", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("evolution: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // The genomic overview (app/lab/genomic-overview.tsx), as the portal's patient view draws it in IGV: compact
  // (no navigation bar) with a MUT and a CNA track, each sample's marker, mutation count, altered-genome share and
  // gene panel beside its rows; a mutation row clicked in the alterations table zooms the full browser to its gene,
  // and Reset view goes back and lets the row go. Known values: IM-GBM-28's 17 called mutations (4/5/4/4 by
  // sample, all on IMPACT410), as cbioportal.org's API returns them.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    const settled = () => page.waitForFunction(() => { const el = document.querySelector(".segigv"); return el && el.getAttribute("aria-busy") === "false"; }, null, { timeout: 240000 });
    const state = () => page.evaluate(() => {
      const r = document.querySelector('[data-testid="segments-igv"]').shadowRoot;
      const nav = r && r.querySelector(".igv-navbar");
      return { navbar: !!nav && getComputedStyle(nav).display !== "none", locus: r ? (r.querySelector(".igv-search-container input") || {}).value || "" : "",
        canvases: r ? r.querySelectorAll("canvas").length : 0, cells: [...document.querySelectorAll(".segigv .absolute")].map((c) => c.textContent).join("|") };
    });
    try {
      await page.goto(BASE + "/portal/patient?study=glioma_msk_2018&patient=IM-GBM-28", { waitUntil: "domcontentloaded" });
      await page.locator(".segigv").first().waitFor({ state: "attached", timeout: 240000 });
      await settled(); await page.waitForTimeout(1500);
      let s = await state();
      ok("overview: compact IGV with the sample columns", !s.navbar && s.canvases > 3 && s.cells.startsWith("1|2|3|4|1|2|3|4|4|5|4|4|") && /P1\|P1\|P1\|P1/.test(s.cells), JSON.stringify(s));
      const row = page.locator("section.alt-table[aria-label='Mutations'] tbody tr", { hasText: "TP53" }).first();
      await row.click();
      await page.waitForTimeout(1000); await settled(); await page.waitForTimeout(1500);
      s = await state();
      ok("overview: a mutation row zooms the full browser to its gene", s.navbar && /^chr17:7,5/.test(s.locus) && (await row.getAttribute("aria-selected")) === "true", JSON.stringify(s));
      await page.locator(".segigv button", { hasText: "Reset view" }).click();
      await page.waitForTimeout(1000); await settled(); await page.waitForTimeout(1500);
      s = await state();
      ok("overview: Reset view goes back to compact and lets the row go", !s.navbar && (await row.getAttribute("aria-selected")) === "false", JSON.stringify(s));
    } catch (e) {
      ok("overview: the genomic overview", false, String(e.message).split("\n")[0].slice(0, 200));
    }
    ok("overview: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

const covers = ["evolution"];

module.exports = { patientViews, covers };
