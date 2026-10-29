// Saved cohorts in analyses: copies that remember their source, stored id sets, locking, save prompts.
const { addViewKind, saveToLibraryDialog } = require("./helpers.cjs");

async function savedCohorts({ browser, ok, LOGIN, signIn, BASE }) {
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
      await addViewKind(sp, "survival");
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
  // A pasted list of ids becomes a stored id set: matched to the study's cases (what matched nothing
  // is said), saved on the server, and named by the cohort — the document carries the set's id,
  // never the ids. Reading the set needs its reader to be signed in and allowed.
  if (LOGIN) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    let steps = {};
    try {
      await signIn(ctx);
      const ex = await (await ctx.request.get(BASE + "/api/custom-data/example?study=msk_chord_2024")).json();
      const patients = ex.patients || [];
      const docOf = async () => JSON.parse(await sp.locator("#docjson").inputValue());
      await sp.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify({ dsl: "2.7", study: "msk_chord_2024", cohorts: {}, views: [] })).toString("base64url"), { waitUntil: "domcontentloaded" });
      await addViewKind(sp, "survival");
      await sp.locator(".emptyview .emptyview-body button").first().click();
      await sp.getByRole("tab", { name: "From a list of ids" }).click();
      await sp.locator(".addcohortdialog").getByRole("tab", { name: "patients" }).click();
      await sp.locator(".addcohortdialog textarea").fill([...patients, "NOT-A-PATIENT-1"].join("\n"));
      await sp.locator(".addcohortdialog input[aria-label='set name']").fill("e2e list");
      await sp.locator(".addcohortdialog .idsetsave").click();
      await sp.waitForSelector(".addcohortdialog .idsetresult", { timeout: 60000 });
      const said = (await sp.locator(".addcohortdialog .idsetresult").innerText()).replace(/\s+/g, " ");
      steps.matched = patients.length > 0 && said.includes(patients.length + " patient") && /1 matched no patient/.test(said);
      await sp.locator(".addcohortdialog").getByRole("button", { name: /Add|Use/ }).last().click();
      await sp.waitForSelector(".cohortbox .cohortbox-head strong", { timeout: 120000 });
      const def = (await docOf()).cohorts["e2e list"];
      const leaf = def?.all?.[0] || {};
      steps.named = leaf.kind === "patientList" && /^[0-9a-f-]{36}$/.test(leaf.set || "") && !leaf.ids && leaf.n === patients.length;
      steps.counted = (await sp.locator(".cohortbox-head").first().innerText()).replace(/\s+/g, "").includes(String(patients.length));
      steps.noIds = !(await sp.locator("#docjson").inputValue()).includes(patients[0]);
      const doc = { dsl: "2.7", study: "msk_chord_2024", cohorts: { L: def }, views: [] };
      const anon = await browser.newContext();
      const r1 = await anon.request.post(BASE + "/api/analysis", { data: doc });
      steps.signedOut = r1.status() >= 400 && /sign in/i.test((await r1.json()).error || "");
      const other = await browser.newContext();
      await signIn(other, "other." + LOGIN);
      const r2 = await other.request.post(BASE + "/api/analysis", { data: doc });
      steps.otherUser = r2.status() >= 400 && /no stored id set/.test((await r2.json()).error || "");
      await anon.close(); await other.close();
      await ctx.request.delete(BASE + "/api/id-sets/" + leaf.set);
      const r3 = await ctx.request.post(BASE + "/api/analysis", { data: doc });
      steps.deleted = r3.status() >= 400 && /was deleted on/.test((await r3.json()).error || "");
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("a pasted list of ids is matched, saved as a stored id set and named by the cohort; only its signed-in owner can read it",
      steps.matched && steps.named && steps.counted && steps.noIds && steps.signedOut && steps.otherUser && steps.deleted, JSON.stringify(steps));
    await ctx.close();
  }
  // A cohort from a list of ids can be made in the library (choosing its study) and from the
  // analysis's cohort panel (no view needed); example cohorts live only on the Examples page.
  if (LOGIN) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    let steps = {};
    try {
      await signIn(ctx, "lists2." + LOGIN);
      const ex = await (await ctx.request.get(BASE + "/api/custom-data/example?study=msk_chord_2024")).json();
      const patients = ex.patients || [];
      const fill = async (dlg, name) => {
        await dlg.getByRole("tab", { name: "patients" }).click();
        await dlg.locator("textarea").fill(patients.join("\n"));
        await dlg.locator("input[aria-label='set name']").fill(name);
        await dlg.locator(".idsetsave").click();
        await dlg.locator(".idsetresult").waitFor({ timeout: 60000 });
        await dlg.locator(".idsetdone").click();
        await dlg.waitFor({ state: "detached", timeout: 60000 });
      };
      // the library: no analysis around it, so the study is chosen
      await sp.goto(BASE + "/saved?tab=cohorts", { waitUntil: "domcontentloaded" });
      await sp.locator(".newlistcohort").click();
      const lib = sp.locator("[role=dialog].listcohortdialog");
      await lib.waitFor({ timeout: 30000 });
      steps.needsStudy = await lib.locator(".idsetsave").isDisabled();
      await lib.getByRole("combobox").click();
      await sp.getByRole("option", { name: /\(msk_chord_2024\)/ }).click();
      const libName = "e2e library list " + Date.now();
      await fill(lib, libName);
      const art = ((await (await ctx.request.get(BASE + "/api/artifacts?kind=cohort")).json()).artifacts || []).find((a) => a.name === libName);
      const leaf = art?.definition?.all?.[0] || {};
      steps.inLibrary = !!art && leaf.kind === "patientList" && /^[0-9a-f-]{36}$/.test(leaf.set || "") && art.definition.study === "msk_chord_2024";
      steps.noExamplesInSaved = (await sp.locator("h2", { hasText: /^Examples/ }).count()) === 0;
      // the analysis's cohort panel, with no view yet
      await sp.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify({ dsl: "2.8", study: "msk_chord_2024", cohorts: {}, views: [] })).toString("base64url"), { waitUntil: "domcontentloaded" });
      await sp.locator(".fromlist").click();
      const pane = sp.locator("[role=dialog].listcohortdialog");
      await pane.waitFor({ timeout: 30000 });
      await fill(pane, "e2e panel list");
      await sp.waitForSelector(".cohortbox .cohortbox-head strong", { timeout: 120000 });
      const d = JSON.parse(await sp.locator("#docjson").inputValue());
      steps.inAnalysis = d.cohorts["e2e panel list"]?.all?.[0]?.kind === "patientList" && (d.views || []).length === 0
        && (await sp.locator(".cohortbox-head").first().innerText()).replace(/\s+/g, "").includes(String(patients.length));
      // example cohorts: on the Examples page's Cohorts tab, and not in "+ Add cohort"'s library
      // (an analysis with no cohorts, so a new view waits for one)
      await sp.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify({ dsl: "2.8", study: "msk_chord_2024", cohorts: {}, views: [] })).toString("base64url"), { waitUntil: "domcontentloaded" });
      await addViewKind(sp, "survival");
      await sp.locator(".emptyview .emptyview-body button").first().click();
      await sp.getByRole("tab", { name: "Library" }).click();
      steps.noExamplesInDialog = (await sp.locator(".addcohortdialog .acd-row", { hasText: "STK11-driver" }).count()) === 0;
      await sp.keyboard.press("Escape");
      await sp.goto(BASE + "/lab?tab=examples", { waitUntil: "domcontentloaded" });
      await sp.getByRole("tab", { name: "Cohorts", exact: true }).click();
      steps.examplesTab = (await sp.locator(".excohorts .listrow", { hasText: "STK11-driver" }).count()) > 0;
      if (art) await ctx.request.delete(BASE + "/api/artifacts/" + art.id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("a cohort from a list of ids can be made in the library (study chosen) and from the cohort panel; example cohorts are only on the Examples page",
      steps.needsStudy && steps.inLibrary && steps.noExamplesInSaved && steps.inAnalysis && steps.noExamplesInDialog && steps.examplesTab, JSON.stringify(steps));
    await ctx.close();
  }
  // Nothing is saved with an inline id list: saving a cohort that carries one stores the list as an
  // id set first, the analysis's copy takes the same set, and saving again stores nothing new.
  if (LOGIN) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    let steps = {};
    try {
      await signIn(ctx, "lists." + LOGIN);
      const ex = await (await ctx.request.get(BASE + "/api/custom-data/example?study=msk_chord_2024")).json();
      const ids = (ex.patients || []).map((p) => "msk_chord_2024:" + p);
      const name = "e2e inline " + Date.now();
      const docOf = async () => JSON.parse(await sp.locator("#docjson").inputValue());
      const sets = async () => ((await (await ctx.request.get(BASE + "/api/id-sets")).json()).sets || []).length;
      const doc = { dsl: "2.7", study: "msk_chord_2024", cohorts: { [name]: { all: [{ kind: "patientList", ids }] } }, views: [{ kind: "survival", cohorts: [name] }] };
      await sp.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify(doc)).toString("base64url"), { waitUntil: "domcontentloaded" });
      await sp.waitForSelector(".cohortbox .cohortbox-head strong", { timeout: 120000 });
      const before = await sets();
      const save = async (label) => {
        const gear = sp.locator(".cohortbox", { hasText: name }).locator(".cohortgear");
        if ((await gear.getAttribute("data-state")) !== "open") await gear.click();
        await sp.locator("[data-slot=popover-content]").getByRole("button", { name: label, exact: true }).click();
      };
      await save("save to library…");
      await saveToLibraryDialog(sp);
      await sp.waitForFunction((n) => { try { return !!JSON.parse(document.querySelector("#docjson").value).cohorts[n].from; } catch { return false; } }, name, { timeout: 60000 });
      const art = ((await (await ctx.request.get(BASE + "/api/artifacts?kind=cohort")).json()).artifacts || []).find((a) => a.name === name);
      const savedLeaf = art?.definition?.all?.[0] || {};
      const copyLeaf = (await docOf()).cohorts[name].all[0];
      steps.saved = /^[0-9a-f-]{36}$/.test(savedLeaf.set || "") && !savedLeaf.ids && savedLeaf.n === ids.length;
      steps.copy = copyLeaf.set === savedLeaf.set && !copyLeaf.ids;
      steps.oneSet = (await sets()) === before + 1;
      // the copy now matches what was saved, so there is nothing left to save
      const gear = sp.locator(".cohortbox", { hasText: name }).locator(".cohortgear");
      if ((await gear.getAttribute("data-state")) !== "open") await gear.click();
      const items = await sp.locator("[data-slot=popover-content]").getByRole("button").allInnerTexts();
      steps.nothingToSave = !items.some((t) => /^save/.test(t.trim()));
      steps.stillCounted = (await sp.locator(".cohortbox-head").first().innerText()).replace(/\s+/g, "").includes(String(ids.length));
      await ctx.request.delete(BASE + "/api/artifacts/" + art.id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("saving a cohort stores its inline id list as an id set, which the analysis's copy then names; nothing is stored twice",
      steps.saved && steps.copy && steps.oneSet && steps.nothingToSave && steps.stillCounted, JSON.stringify(steps));
    await ctx.close();
  }
  // Locking: "Lock all cohorts" freezes every cohort and its split arms at one moment; the counts
  // do not change, each cohort says it is locked and that nothing has moved since, the document
  // names the frozen sets and when; a cohort unlocks on its own, and the analysis is then no
  // longer locked as a whole.
  if (LOGIN) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const sp = await ctx.newPage();
    let steps = {};
    try {
      await signIn(ctx, "locks." + LOGIN);
      const docOf = async () => JSON.parse(await sp.locator("#docjson").inputValue());
      const counts = async () => sp.$$eval(".cohortbox-head", (hs) => hs.map((h) => h.innerText.replace(/\s+/g, " ")));
      const doc = { dsl: "2.8", study: "msk_chord_2024", cohorts: {
        "KRAS NSCLC": { all: [{ kind: "oql", q: "KRAS: MUT" }, { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }],
          splits: { g12c: { arms: [{ name: "G12C", where: { kind: "oql", q: "KRAS: G12C" } }] } } },
        "EGFR": { all: [{ kind: "oql", q: "EGFR: MUT" }] } },
        views: [{ kind: "survival", cohorts: ["KRAS NSCLC", "EGFR"] }] };
      await sp.goto(BASE + "/lab?tab=analysis&doc=" + Buffer.from(JSON.stringify(doc)).toString("base64url"), { waitUntil: "domcontentloaded" });
      await sp.waitForFunction(() => document.querySelectorAll(".cohortbox-head strong").length === 2, null, { timeout: 180000 });
      const before = await counts();
      const setsBefore = ((await (await ctx.request.get(BASE + "/api/id-sets")).json()).sets || []).length;
      await sp.locator(".lockall").click();
      await sp.waitForSelector(".lockdrift", { timeout: 180000 });
      await sp.waitForFunction(() => document.querySelectorAll(".lockdrift").length === 2, null, { timeout: 180000 });
      const d = await docOf();
      const k = d.cohorts["KRAS NSCLC"].lock || {};
      steps.locked = !!d.locked?.at && /^[0-9a-f-]{36}$/.test(k.set || "") && k.n > 0 && k.nPatients > 0 && k.n >= k.nPatients && k.at === d.locked.at && d.cohorts.EGFR.lock?.at === d.locked.at;
      // its arms are parts of its one set, not sets of their own: one row per locked cohort
      steps.arms = Object.entries(k.children || {}).some(([c, m]) => c.startsWith("g12c / ") && m.set === k.set && m.part === "arm:" + c);
      steps.oneRowEach = ((await (await ctx.request.get(BASE + "/api/id-sets")).json()).sets || []).length === setsBefore + 2;
      steps.sameCounts = JSON.stringify(await counts()) === JSON.stringify(before);
      const lines = await sp.$$eval(".lockline", (ls) => ls.map((l) => l.innerText.replace(/\s+/g, " ")));
      steps.unchanged = lines.length === 2 && lines.every((l) => /locked \d+ \w+ \d{4}/.test(l) && /unchanged since/.test(l));
      steps.header = /locked \d+ \w+ \d{4}/.test(await sp.locator(".analysislock").innerText());
      const gear = sp.locator(".cohortbox", { hasText: "EGFR" }).locator(".cohortgear");
      await gear.click();
      await sp.locator("[data-slot=popover-content]").getByRole("button", { name: "unlock", exact: true }).click();
      await sp.waitForFunction(() => document.querySelectorAll(".lockline").length === 1, null, { timeout: 60000 });
      const d2 = await docOf();
      steps.unlockedOne = !d2.cohorts.EGFR.lock && !!d2.cohorts["KRAS NSCLC"].lock && !d2.locked;
      steps.lockAllBack = await sp.locator(".lockall").isVisible();
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("locking all cohorts freezes them and their arms at one moment, keeps the counts, says nothing moved since; one cohort unlocks on its own",
      steps.locked && steps.arms && steps.oneRowEach && steps.sameCounts && steps.unchanged && steps.header && steps.unlockedOne && steps.lockAllBack, JSON.stringify(steps));
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
        return (j.artifacts || []).find((a) => a.name === libName);
      };
      // saved under a name of the reader's choosing, not necessarily the analysis's
      const libName = name + " (library)";
      await open({ dsl: "2.5", study: "msk_chord_2024", cohorts: { [name]: { all: [{ kind: "oql", q: "KRAS: MUT" }] } }, views: [{ kind: "survival", cohorts: [name] }] });
      let m = await menuItems();
      steps.offered = m.items.some((t) => t.trim() === "save to library…");
      await sp.locator("[data-slot=popover-content]").getByRole("button", { name: "save to library…", exact: true }).click();
      steps.said = /Saves a new cohort/.test(await saveToLibraryDialog(sp, libName));
      // saved under another name, the cohort takes it in the analysis too, its view following
      await sp.waitForFunction((n) => { try { return !!JSON.parse(document.querySelector("#docjson").value).cohorts[n].from; } catch { return false; } }, libName, { timeout: 60000 });
      const a1 = await savedDef();
      const afterSave = await docOf();
      steps.saved = !!a1 && afterSave.cohorts[libName].from.saved === a1.id && afterSave.cohorts[libName].from.name === libName;
      // it named no study (it ran in the analysis's): saved, it names that one, and so does the analysis's copy
      steps.studyPinned = a1?.definition?.study === "msk_chord_2024" && afterSave.cohorts[libName].study === "msk_chord_2024";
      steps.renamed = !afterSave.cohorts[name] && afterSave.views[0].cohorts.includes(libName);
      steps.badge = (await sp.locator(".cohortbox", { hasText: libName }).locator(".srcbadge").innerText()).trim() === "in library";
      m = await menuItems();
      steps.goneAfter = !m.items.some((t) => /^save/.test(t.trim()));
      const d = await docOf();
      d.cohorts[libName].splits = { sex: { arms: [{ name: "Female", where: { kind: "clinical", attribute: "SEX", values: ["Female"] } }] } };
      await open(d);
      m = await menuItems();
      steps.offeredAfterSplit = m.items.some((t) => t.trim() === "save changes to library…");
      await sp.locator("[data-slot=popover-content]").getByRole("button", { name: "save changes to library…", exact: true }).click();
      steps.saidUpdate = /Updates your saved cohort/.test(await saveToLibraryDialog(sp));
      for (let i = 0; i < 60 && !(await savedDef())?.definition?.splits; i++) await sp.waitForTimeout(1000);
      const a2 = await savedDef();
      steps.splitSaved = !!a2 && a2.id === a1.id && !!a2.definition.splits?.sex && !a2.definition.from;
      // a different cohort that only shares the saved one's name is not its earlier version: it is
      // offered as a new save, and the dialog warns that saving under that name replaces the other
      await open({ dsl: "2.8", study: "msk_chord_2024", cohorts: { [libName]: { all: [{ kind: "oql", q: "EGFR: MUT" }] } }, views: [{ kind: "survival", cohorts: [libName] }] });
      const gear2 = sp.locator(".cohortbox", { hasText: libName }).locator(".cohortgear");
      await gear2.click();
      const items2 = await sp.locator("[data-slot=popover-content]").getByRole("button").allInnerTexts();
      steps.sameNameIsNew = items2.some((t) => t.trim() === "save to library…") && !items2.some((t) => /save changes/.test(t));
      await sp.locator("[data-slot=popover-content]").getByRole("button", { name: "save to library…", exact: true }).click();
      const dlg = sp.locator("[role=dialog].savelibrarydialog");
      await dlg.waitFor({ timeout: 30000 });
      steps.warnsReplace = /already have a saved cohort/.test(await dlg.locator("p").last().innerText()) && (await dlg.locator("button[type=submit]").innerText()).trim() === "Replace";
      await dlg.getByRole("button", { name: "Cancel" }).click();
      await ctx.request.delete(BASE + "/api/artifacts/" + a1.id);
    } catch (e) { steps.error = String(e.message || e).slice(0, 160); }
    ok("a cohort that is unsaved, or re-split since saving, offers save in its menu; saving asks for its library name, takes that name in the analysis and records it as the source",
      steps.offered && steps.said && steps.saved && steps.studyPinned && steps.renamed && steps.badge && steps.goneAfter && steps.offeredAfterSplit && steps.saidUpdate && steps.splitSaved
        && steps.sameNameIsNew && steps.warnsReplace, JSON.stringify(steps));
    await ctx.close();
  }
}

module.exports = { savedCohorts };
