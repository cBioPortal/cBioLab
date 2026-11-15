// The analysis page's controls: a view's genes, the plot's sidebar (axes, point layers, OQL axis), the oncoprint's toolbar, drag-to-cohort and merged rows, undo from an error.
async function analysisControls({ decodeUrlJson, ok, BASE, page, errors }) {
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
    await page.waitForSelector("[role=dialog].gene-query-dialog", { timeout: 30000 });
    const panel = page.locator("[role=dialog].gene-query-dialog");
    // the dialog starts from the view's genes, as text, and applies the text as left
    const text = panel.locator("textarea");
    const startText = await text.inputValue();
    const before = startText.trim().split(/\s+/).length;
    await text.fill(startText.trim() + " PIK3CA");
    const apply = panel.getByRole("button", { name: "Apply" });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Apply"); return b && !b.disabled; }, null, { timeout: 60000 });
    await apply.click();
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
    await page.locator("button.genesbtn").first().click();
    await panel.locator("textarea").waitFor({ timeout: 30000 });
    await panel.locator("textarea").fill(added.filter((g) => g !== "KRAS").join(" "));
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("[role=dialog].gene-query-dialog button")].find((x) => x.textContent === "Apply"); return b && !b.disabled; }, null, { timeout: 60000 });
    await panel.getByRole("button", { name: "Apply" }).click();
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

  // A plot's axes are defined in a sidebar, as on cBioPortal's Plots tab: a horizontal block,
  // Swap axes, a vertical block, each field named, the figure beside them. Swap rewrites the
  // document's x and y; the fields stay on one control height, as a toolbar's do.
  let sideWhat = "no plot rendered", sideOk = false;
  try {
    await page.goto(BASE + "/lab?tab=analysis&doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
      study: "msk_chord_2024",
      cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
      views: [{ kind: "plot", cohorts: ["TP53 mut"], unit: "sample",
        x: { source: "clinical", attribute: "MUTATION_COUNT" }, y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } }]
    })).toString("base64")));
    await page.waitForSelector(".plot-side", { timeout: 300000 });
    await page.waitForSelector(".figwidth svg", { timeout: 300000 });
    const blocks = await page.locator(".plot-side .plot-axis h3").allInnerTexts();
    const names = await page.locator(".plot-side .plot-axis").first().locator(".axfield-name").allInnerTexts();
    const side = await page.locator(".plot-side").boundingBox(), fig = await page.locator(".figwidth").first().boundingBox();
    const beside = side && fig && fig.x >= side.x + side.width - 1;
    const heights = await page.locator(".plot-side [data-slot=select-trigger]").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
    await page.locator(".plot-side .plot-swap").click();
    await page.waitForFunction(() => {
      try { const v = JSON.parse(document.querySelector("#docjson").value).views[0];
        return v.x.attribute === "FRACTION_GENOME_ALTERED" && v.y.attribute === "MUTATION_COUNT"; } catch { return false; }
    }, null, { timeout: 30000 });
    sideOk = blocks.join(",") === "Horizontal axis,Vertical axis" && names.join(",") === "Data,Clinical attribute" && !!beside && heights.length === 1;
    sideWhat = "blocks " + blocks.join(",") + "; fields " + names.join(",") + "; figure beside: " + beside + "; select heights " + heights.join(",") + "; swap rewrote x/y";
  } catch (e) { sideWhat = String(e.message).split("\n")[0]; }
  ok("a plot's axes are defined in a sidebar beside the figure, and Swap axes swaps them", sideOk, sideWhat);

  // Point layers: the sidebar lists the view's layers (the outliers by default) and adds one to
  // the document; the figure's key then names it.
  let layerWhat = "no plot rendered", layerOk = false;
  try {
    const chips = async () => page.locator(".plot-side .plot-layer").allInnerTexts();
    const before = await chips();
    await page.locator(".plot-side .plot-layers [role=combobox]").click();
    await page.locator("[role=option]", { hasText: "furthest from the fit" }).click();
    await page.waitForFunction(() => {
      try { const v = JSON.parse(document.querySelector("#docjson").value).views[0];
        return Array.isArray(v.points) && v.points.some((l) => l.rule === "trend"); } catch { return false; }
    }, null, { timeout: 30000 });
    await page.waitForFunction(() => /furthest from the fit \(/.test(document.querySelector(".figwidth svg")?.textContent || ""), null, { timeout: 300000 });
    const after = await chips();
    layerOk = before.length === 1 && /outliers/.test(before[0]) && after.length === 2;
    layerWhat = "before " + JSON.stringify(before) + " -> after " + JSON.stringify(after) + "; the key names the new layer";
  } catch (e) { layerWhat = String(e.message).split("\n")[0]; }
  ok("a plot's point layers are listed in the sidebar, and adding one draws it with a key entry", layerOk, layerWhat);

  // Hiding the plotted cases or a layer is instant and the browser's own: its group steps back,
  // a case it drew reappears in the next layer holding it, Esc shows everything.
  let soloWhat = "no layer buttons", soloOk = false;
  try {
    const groups = () => page.evaluate(() => [...document.querySelectorAll(".plot-figure g[data-layer]")]
      .map((g) => [g.getAttribute("data-layer") + (g.hasAttribute("data-shared") ? "<" + g.getAttribute("data-owner") : ""), getComputedStyle(g).opacity, getComputedStyle(g).display]));
    const docBefore = await page.locator("#docjson").inputValue();
    const chips = page.locator(".plot-solo button");
    const names = await chips.allInnerTexts();
    await chips.nth(1).click();          // the first layer
    const hid = await groups();
    await chips.first().click();         // the plotted cases too
    const both = await groups();
    await page.keyboard.press("Escape");
    const back = await groups();
    const of = (gs, k) => gs.filter(([key]) => key === k);
    soloOk = /^all samples/.test(names[0]) && names.length >= 2 &&
      of(hid, "0").every(([, o]) => o !== "1") && of(hid, "base").every(([, o]) => o === "1") &&
      hid.filter(([k]) => /<0$/.test(k)).every(([, o, d]) => o === "1" && d !== "none") &&
      of(both, "base").every(([, o]) => o !== "1") &&
      back.filter(([k]) => !k.includes("<")).every(([, o]) => o === "1") &&
      (await page.locator("#docjson").inputValue()) === docBefore;
    soloWhat = "chips " + JSON.stringify(names) + "; first layer hidden " + JSON.stringify(hid) + "; after Esc " + JSON.stringify(back) + "; document unchanged";
  } catch (e) { soloWhat = String(e.message).split("\n")[0]; }
  ok("the plotted cases and each layer can be hidden from their chips, shared cases follow, Esc shows everything, and the document is untouched", soloOk, soloWhat);

  // An OQL axis is edited through the app's gene query dialog: it opens with one line per
  // statement, and what it applies is the axis's query.
  let oqlWhat = "no OQL axis", oqlOk = false;
  try {
    await page.goto(BASE + "/lab?tab=analysis&doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
      study: "msk_chord_2024", cohorts: { All: { all: [] } },
      views: [{ kind: "plot", cohorts: ["All"], x: { source: "alteration", oql: "KRAS: G12C, STK11: MUT", by: "statement" },
        y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" } }]
    })).toString("base64")));
    await page.waitForSelector(".plot-side", { timeout: 300000 });
    // genes and OQL are chosen in the dialog only: the axis holds no free-text field
    const freeText = await page.locator(".plot-side .plot-axis input").count();
    await page.getByRole("button", { name: "OQL for this axis" }).click();
    const dlg = page.locator("[role=dialog]");
    await dlg.waitFor({ timeout: 30000 });
    const opened = await dlg.locator("textarea").inputValue();
    await dlg.locator("textarea").fill("KRAS: G12C\nSTK11: MUT\nKEAP1: MUT");
    await dlg.getByRole("button", { name: /^Apply/ }).click({ timeout: 30000 });
    await page.waitForFunction(() => /KEAP1/.test(JSON.parse(document.querySelector("#docjson").value).views[0].x.oql), null, { timeout: 30000 });
    const x = await page.evaluate(() => JSON.parse(document.querySelector("#docjson").value).views[0].x);
    oqlOk = freeText === 0 && opened === "KRAS: G12C\nSTK11: MUT" && x.oql === "KRAS: G12C, STK11: MUT, KEAP1: MUT" && x.by === "statement";
    oqlWhat = "free-text fields " + freeText + "; opened " + JSON.stringify(opened) + " -> axis " + JSON.stringify(x);
  } catch (e) { oqlWhat = String(e.message).split("\n")[0]; }
  ok("a plot's OQL axis is edited in the gene query dialog, and its lines become the axis's statements", oqlOk, oqlWhat);

  // The oncoprint's gear keeps ONLY the link out to cBioPortal; genes moved
  // to a named button and a modal, so the gear is not where editing hides.
  let gearSplit = "no oncoprint rendered", gearOk = false;
  try {
    await page.goto(BASE + "/lab?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
      study: "msk_chord_2024",
      cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
      views: [{ kind: "oncoprint", genes: ["TP53", "KRAS"] }]
    })).toString("base64")));
    await page.waitForSelector('button[data-tip="download or open this figure elsewhere"]', { timeout: 300000 });
    const namedButton = await page.locator("button.genesbtn").first().innerText();
    await page.locator('button[data-tip="download or open this figure elsewhere"]').click();
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
    await page.locator("canvas").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
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
    // signed in, the selection is stored as an id set and the cohort names it (app/lab/id-sets-client.ts);
    // signed out, it stays an inline list
    const n = leaf.set ? leaf.n : leaf.ids?.length;
    dragOk = claimed > 0 && leaf.kind === "patientList" && n === claimed && counted === claimed
      && (leaf.set ? /^[0-9a-f-]{36}$/.test(leaf.set) && !leaf.ids : leaf.ids.every((id) => id.startsWith("msk_chord_2024:")));
    dragWhat = said + " -> " + (leaf.set ? "stored set of " + n : n + " inline ids") + " -> compiler counted " + counted;
  } catch (e) { dragWhat = String(e.message).split("\n")[0]; }
  ok("a drag across the oncoprint becomes a cohort of exactly those patients", dragOk, dragWhat);

  // A merged row pools several genes into one. It must be recognisable as one — the gutter
  // cannot say much in 168px, so the label is bracketed and hovering it names the members
  // and says what the percentage is over.
  let mergedWhat = "no oncoprint rendered", mergedOk = false;
  try {
    await page.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify({
      study: "msk_chord_2024",
      cohorts: { "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }] } },
      views: [{ kind: "oncoprint", genes: [{ label: "TP53 pathway", genes: ["TP53", "MDM2", "MDM4"] }, "TP53"] }]
    })).toString("base64url"));
    await page.waitForSelector("canvas", { timeout: 300000 });
    await page.waitForTimeout(2500);
    // the label gutter must be on screen for a hover to land: the add-view panel above it grows with every view kind
    await page.locator("canvas").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    const box = await page.locator("canvas").first().boundingBox();
    // clinical rows (# Samples per Patient, Profiled for ...) sit above the genes, as in the
    // portal, so walk the gutter labels down (header 22px, rows 20 + 3px) to the merged row's
    let tip = null;
    for (let row = 0; row < 8 && !(tip && /TP53 pathway/.test(tip)); row++) {
      await page.mouse.move(box.x + 40, box.y + 22 + row * 23 + 10);
      await page.waitForTimeout(400);
      tip = await page.evaluate(() => {
        const d = document.querySelector(".onco-tip");
        return d ? d.innerText.replace(/\n/g, " | ") : null;
      });
    }
    mergedOk = !!tip && /TP53 pathway/.test(tip) && /MDM2/.test(tip) && /MDM4/.test(tip) && /profiled/.test(tip);
    mergedWhat = tip || "no tooltip on the track label";
  } catch (e) { mergedWhat = String(e.message).split("\n")[0]; }
  ok("a merged gene row names the genes it pools when its label is hovered", mergedOk, mergedWhat);

  // An edit that breaks a view is one step from the analysis that worked: each change is a
  // history entry, and the broken oncoprint offers Undo beside its error.
  let undoWhat = "not reached", undoOk = false;
  // the broken edit is refused on purpose, and the browser logs that request's 400 — expected,
  // not a regression, so it is filtered out of the shared error tally as the dead route's 404 is
  const errsBeforeUndo = errors.length;
  try {
    const good = { study: "msk_chord_2024",
      cohorts: { "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }] } },
      views: [{ kind: "oncoprint", cohorts: ["Pancreatic"], genes: ["KRAS", "TP53"] }] };
    const bad = { ...good, views: [{ ...good.views[0], heatmap: [{ profileType: "NOT_A_PROFILE" }] }] };
    await page.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify(good)).toString("base64url"));
    await page.waitForSelector(".onco-legend", { timeout: 300000 });
    const before = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: /show document json/i }).click();
    await page.locator("#docjson").fill(JSON.stringify(bad));
    await page.locator("dialog[open]").getByRole("button", { name: /^run/i }).first().click();
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForSelector(".undo-error", { timeout: 120000 });
    const grew = (await page.evaluate(() => history.length)) - before;
    await page.locator(".undo-error").first().click();
    await page.waitForSelector(".onco-legend", { timeout: 120000 });
    const errLeft = await page.locator(".error").filter({ hasText: "NOT_A_PROFILE" }).count();
    const docBack = decodeUrlJson(new URL(page.url()).searchParams.get("doc") || "");
    undoOk = grew === 1 && errLeft === 0 && !JSON.stringify(docBack).includes("NOT_A_PROFILE");
    undoWhat = "history +" + grew + ", error after undo: " + errLeft + ", document back: " + !JSON.stringify(docBack).includes("NOT_A_PROFILE");
  } catch (e) { undoWhat = String(e.message).split("\n")[0]; }
  ok("an edit that breaks a view is undone from the error, and is a browser history step", undoOk, undoWhat);
  errors.splice(errsBeforeUndo, errors.length - errsBeforeUndo,
    ...errors.slice(errsBeforeUndo).filter(e => !/status of 400/.test(e)));

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

  // The oncoprint's PDF export (ONC-DL-2): the Export image dialog's PDF format draws the server
  // SVG the SVG export saves onto one page its size, as the portal's svgToPdfDownload does
  // (cbioportal-frontend-commons/src/lib/svgToPdfDownload.ts). Checked from the downloaded bytes,
  // with no PDF library: page count and MediaBox from the file, text decoded through the font's
  // ToUnicode map from the (Flate-compressed) streams.
  {
    const zlib = require("node:zlib");
    const errsBeforePdf = errors.length;
    /** every stream's bytes, inflated when they are Flate-compressed */
    const pdfStreams = (buf) => {
      const raw = buf.toString("latin1"), out = [];
      const re = /stream\r?\n/g;
      let m;
      while ((m = re.exec(raw))) {
        if (raw.slice(Math.max(0, m.index - 3), m.index) === "end") continue;
        const start = m.index + m[0].length, end = raw.indexOf("endstream", start);
        if (end < 0) break;
        const body = buf.subarray(start, end);
        let text;
        try { text = zlib.inflateSync(body).toString("latin1"); } catch { text = body.toString("latin1"); }
        out.push(text);
        re.lastIndex = end + 9;
      }
      return out;
    };
    /** the text a PDF shows, decoded through its ToUnicode maps (hex glyph codes) or read as literal strings */
    const pdfText = (streams) => {
      const map = new Map();
      let codeLen = 4;
      const hexU = (h) => String.fromCodePoint(...(h.match(/.{4}/g) || []).map((x) => parseInt(x, 16)));
      for (const s of streams.filter((x) => /begincmap/.test(x))) {
        for (const blk of s.match(/beginbfchar([\s\S]*?)endbfchar/g) || [])
          for (const [, c, u] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) { map.set(c.toUpperCase(), hexU(u)); codeLen = c.length; }
        for (const blk of s.match(/beginbfrange([\s\S]*?)endbfrange/g) || [])
          for (const [, a, b, u] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            codeLen = a.length;
            for (let i = parseInt(a, 16), k = 0; i <= parseInt(b, 16); i++, k++)
              map.set(i.toString(16).toUpperCase().padStart(a.length, "0"), String.fromCodePoint(parseInt(u, 16) + k));
          }
      }
      const shown = [];
      for (const s of streams.filter((x) => /\bT[jJ]\b/.test(x) && /\bBT\b/.test(x))) {
        for (const [, bt] of s.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
          let line = "";
          for (const [, hex, lit] of bt.matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\[\s\S]|[^\\)])*)\)/g)) {
            if (hex !== undefined) {
              const h = hex.replace(/\s/g, "").toUpperCase();
              line += map.size ? (h.match(new RegExp(".{" + codeLen + "}", "g")) || []).map((c) => map.get(c) ?? "�").join("")
                : Buffer.from(h, "hex").toString("latin1");
            } else line += lit.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[c] ?? c);
          }
          shown.push(line);
        }
      }
      return shown;
    };
    const unent = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const openExport = async () => {
      await page.locator('button[data-tip="download or open this figure elsewhere"]').click();
      await page.getByText("Export image (PNG, SVG or PDF)", { exact: false }).first().click();
      const dlg = page.locator("[role=dialog][data-slot=dialog-content]").filter({ hasText: "Export image" });
      await dlg.waitFor({ timeout: 30000 });
      return dlg;
    };
    const pickPdf = async (dlg) => {
      await dlg.locator(".setrow", { hasText: "format" }).getByRole("combobox").click();
      const formats = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim().split(/\s/)[0]);
      await page.getByRole("option", { name: /^PDF/ }).click();
      return formats;
    };
    const svgPost = (r) => r.request().method() === "POST" && /\/api\/oncoprint\?/.test(r.url()) && /[?&]format=svg\b/.test(r.url());

    let formats = [], name = "", bytes = Buffer.alloc(0), svgText = "", what = "no oncoprint rendered";
    try {
      await page.goto(BASE + "/lab?doc=" + encodeURIComponent(Buffer.from(JSON.stringify({
        study: "msk_chord_2024",
        cohorts: { "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] } },
        views: [{ kind: "oncoprint", genes: ["TP53", "KRAS"] }]
      })).toString("base64")));
      await page.waitForSelector('button[data-tip="download or open this figure elsewhere"]', { timeout: 300000 });
      const dlg = await openExport();
      formats = await pickPdf(dlg);
      const widthShown = await dlg.locator('input[type=number]').first().inputValue().catch(() => "?");
      const svgP = page.waitForResponse(svgPost, { timeout: 300000 }).catch(() => null);
      const dlP = page.waitForEvent("download", { timeout: 300000 }).catch(() => null);
      await dlg.getByRole("button", { name: "Export PDF" }).click();
      const [resp, dl] = await Promise.all([svgP, dlP]);
      svgText = resp && resp.ok() ? await resp.text() : "";
      if (dl) { name = dl.suggestedFilename(); bytes = require("fs").readFileSync(await dl.path()); }
      what = "page width field " + widthShown + "; " + (dl ? name + ", " + bytes.length + " bytes" : "no download") + "; server SVG " + svgText.length + " chars";
    } catch (e) { what = String(e.message).split("\n")[0]; }

    const raw = bytes.toString("latin1");
    const streams = bytes.length ? pdfStreams(bytes) : [];
    const shown = pdfText(streams);
    const text = norm(shown.join(" "));
    const svgRoot = (svgText.match(/<svg\b[^>]*>/) || [""])[0];
    const attr = (a) => (svgRoot.match(new RegExp("\\s" + a + "=\"([^\"]*)\"")) || [])[1] || "";
    const vb = attr("viewBox").split(/[\s,]+/).map(Number);
    const svgWIn = parseFloat(attr("width")), svgHIn = parseFloat(attr("height"));
    const svgInches = /in$/.test(attr("width")) && /in$/.test(attr("height"));
    const mb = raw.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
    const [mw, mh] = mb ? [mb[3] - mb[1], mb[4] - mb[2]] : [NaN, NaN];

    ok("oncoprint PDF: the export dialog offers PNG, SVG and PDF (ours: the portal puts PDF in its Download menu)",
      formats.join(",") === "PNG,SVG,PDF", formats.join(", ") + " · " + what);
    ok("oncoprint PDF: the download is a PDF file", bytes.length > 1000 && raw.startsWith("%PDF-"),
      bytes.length + " bytes, starts " + JSON.stringify(raw.slice(0, 8)));
    const pages = (raw.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
    ok("oncoprint PDF: one page", pages === 1, pages + " /Type /Page objects");
    // the page is the SVG's size in points: 8.5in = 612pt wide, and the SVG's own height (in, or 8.5 × h ÷ w of its viewBox)
    const wantH = svgInches ? svgHIn * 72 : vb.length === 4 && vb[2] > 0 ? 612 * vb[3] / vb[2] : NaN;
    ok("oncoprint PDF: the page is the SVG's size in points, 612 pt wide at 8.5 in",
      mb !== null && Math.abs(mw - 612) < 0.01 && mh > 0 && Math.abs(mh - wantH) < 1 && (!svgInches || Math.abs(svgWIn - 8.5) < 1e-6),
      "MediaBox " + (mb ? mb[0] : "none") + "; SVG width=" + attr("width") + " height=" + attr("height") + " viewBox=" + attr("viewBox") + " -> want 612 × " + wantH.toFixed(2));
    // landscape or portrait, the MediaBox stays width × height, never rotated
    const rotate = (raw.match(/\/Rotate\s+(-?\d+)/) || [])[1];
    ok("oncoprint PDF: wider than tall is landscape, and the MediaBox is still width × height (not rotated)",
      mb !== null && Number.isFinite(wantH) && (mw > mh) === (612 > wantH) && (!rotate || Number(rotate) % 360 === 0),
      "page " + mw + " × " + mh + (mw > mh ? " (landscape)" : " (portrait)") + ", /Rotate " + (rotate ?? "none"));
    const hasTextOp = streams.some((s) => /\bBT\b/.test(s) && /\bT[jJ]\b/.test(s));
    ok("oncoprint PDF: the gene labels are text (Tj/TJ), not paths", hasTextOp && /\bTP53\b/.test(text) && /\bKRAS\b/.test(text),
      (hasTextOp ? "text operators present" : "no Tj/TJ") + ", " + shown.length + " text objects: " + JSON.stringify(text.slice(0, 120)));
    const baseFonts = [...raw.matchAll(/\/(?:BaseFont|FontName)\s*\/([^\s/\[\]<>()]+)/g)]
      .map((m) => m[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/^[A-Z]{6}\+/, ""));
    ok("oncoprint PDF: IBM Plex Sans is embedded as TrueType (ours: our UI font; the portal fetches FreeSans)",
      /\/FontFile2\b/.test(raw) && baseFonts.some((f) => /^IBM ?Plex ?Sans/.test(f)),
      "FontFile2 " + /\/FontFile2\b/.test(raw) + ", fonts " + [...new Set(baseFonts)].join(", "));
    // the same figure as the SVG export: every piece of text the SVG writes, the gutter's % among them, and its cells
    const svgTexts = [...svgText.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
      .map((m) => norm(unent(m[1].replace(/<title\b[\s\S]*?<\/title>/g, "").replace(/<[^>]+>/g, "")))).filter(Boolean);
    const missing = svgTexts.filter((t) => !text.includes(t));
    const pcts = svgTexts.filter((t) => /\d%/.test(t));
    const rects = (svgText.match(/<rect\b/g) || []).length;
    const fills = streams.reduce((n, s) => n + (s.match(/(?:^|\s)(?:f\*?|F|B\*?|b\*?)(?=\s|$)/g) || []).length, 0);
    ok("oncoprint PDF: the same figure as the SVG export — its labels, gutter %, legend and cells",
      svgTexts.length > 4 && pcts.length > 0 && missing.length === 0 && rects > 0 && fills >= rects,
      svgTexts.length + " SVG texts (" + pcts.length + " with %), missing from the PDF: " + JSON.stringify(missing.slice(0, 6)) +
      "; " + rects + " SVG rects, " + fills + " PDF fills");
    ok("oncoprint PDF: the file is named oncoprint-<study>-<w>in.pdf (ours; the portal saves oncoprint.pdf)",
      /^oncoprint-msk_chord_2024-8\.5in\.pdf$/.test(name), name || "no download");
    const pdfErrors = errors.slice(errsBeforePdf);
    ok("oncoprint PDF: the export raises no page errors", bytes.length > 0 && pdfErrors.length === 0, pdfErrors.slice(0, 3).join(" | "));

    // a failed server SVG: the dialog says so, and nothing is saved
    let failWhat = "not reached", failOk = false;
    const errsBeforeFail = errors.length;
    const planted = "planted failure: oncoprint PDF test";
    const fail = (route) => svgPost({ request: () => route.request(), url: () => route.request().url() })
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: planted }) })
      : route.continue();
    try {
      await page.route("**/api/oncoprint?**", fail);
      let dlg = page.locator("[role=dialog][data-slot=dialog-content]").filter({ hasText: "Export image" });
      if (!(await dlg.isVisible().catch(() => false))) dlg = await openExport();
      const fmt = await dlg.locator(".setrow", { hasText: "format" }).getByRole("combobox").innerText();
      if (!/^PDF/.test(fmt.trim())) await pickPdf(dlg);
      const dlP = page.waitForEvent("download", { timeout: 15000 }).then((d) => d.suggestedFilename()).catch(() => null);
      await dlg.getByRole("button", { name: "Export PDF" }).click();
      await page.waitForFunction((t) => document.body.innerText.includes(t), planted, { timeout: 60000 });
      const dialogOpen = await dlg.isVisible().catch(() => false);
      const inDialog = (await dlg.getByText(planted, { exact: false }).count()) > 0;
      const where = await page.evaluate((t) => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) if (n.textContent.includes(t)) {
          const el = n.parentElement.closest("[role=dialog],[role=alert],.viewcard,section") || n.parentElement;
          return el.tagName.toLowerCase() + (el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : "") + "." + String(el.className).split(" ")[0];
        }
        return "nowhere";
      }, planted);
      const saved = await dlP;
      const figureKept = (await page.locator("canvas").count()) > 0;
      failOk = inDialog && saved === null;
      failWhat = "error " + (inDialog ? "shown in the dialog" : "shown outside the dialog, in " + where + "; dialog " + (dialogOpen ? "open" : "closed")) + "; download " + (saved ?? "none") + "; figure " + (figureKept ? "still drawn" : "gone");
    } catch (e) { failWhat = String(e.message).split("\n")[0]; }
    await page.unroute("**/api/oncoprint?**", fail).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    ok("oncoprint PDF: a failed server SVG shows the dialog's error and saves no file (ours)", failOk, failWhat);
    // the planted 500 is this check's own doing, not a page error
    errors.splice(errsBeforeFail, errors.length - errsBeforeFail,
      ...errors.slice(errsBeforeFail).filter((e) => !/status of 500|http 500 POST .*\/api\/oncoprint/.test(e)));
  }
}

module.exports = { analysisControls };
