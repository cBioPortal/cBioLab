// What several e2e areas do the same way: pick Explore's studies or a facet, add a view, measure a
// toolbar's alignment, save a cohort to the library.

// Explore starts with no studies selected; the checks that browse facets pick the two studies they
// were written against, through the page's own tool (what a reader's ticking does).
async function pickExploreStudies(p) {
  await p.waitForFunction(() => window.cohortLab && window.cohortLab.selectStudies, null, { timeout: 120000 });
  await p.evaluate(() => window.cohortLab.selectStudies(["msk_chord_2024", "genie_public"]));
}

/** filter Explore by the `nth` facet value: a pie slice filters on click, a list row once checked and applied */
async function pickFacet(p, nth) {
  const el = p.locator(".valrow, .slice").nth(nth);
  const isRow = await el.evaluate((e) => e.classList.contains("valrow"));
  await el.click();
  if (isRow) await el.locator("xpath=ancestor::div[contains(concat(' ', @class, ' '), ' card ')][1]").getByRole("button", { name: "Apply filter" }).click();
}

/** add a view of `kind` through the analysis page's "Add view" dialog */
async function addViewKind(p, kind) {
  await p.locator(".addview-open").click();
  await p.locator(`.addviewdialog [data-kind="${kind}"]`).click();
}

/**
 * Controls that sit side by side must line up: in every toolbar zone (.tbz) under `scope`, each
 * control (a button, checkbox label or select) is one control height (--ctl-h) tall and every child shares one
 * centre line. A control placed outside the toolbar idiom takes the global input/button padding
 * and fails this. Returns the misaligned rows, described; empty when all line up.
 */
async function misalignedControls(p, scope) {
  return p.evaluate((scope) => {
    const ctl = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ctl-h")) * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const bad = [];
    for (const z of document.querySelectorAll(scope + " .tbz")) {
      const kids = [...z.children].filter((c) => !c.classList.contains("tbl") && c.getBoundingClientRect().height > 0);
      const mids = kids.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
      const off = kids.filter((c) => c.matches(".tbbtn, .chk, select, [data-slot=button], [data-slot=select-trigger]") && Math.abs(c.getBoundingClientRect().height - ctl) > 0.5);
      if (Math.max(...mids) - Math.min(...mids) > 1 || off.length)
        bad.push(kids.map((c, i) => (c.textContent || c.tagName).trim().slice(0, 14) + "@" + mids[i].toFixed(1) + "/h" + c.getBoundingClientRect().height.toFixed(1)).join(", "));
    }
    return bad;
  }, scope);
}

/** a cohort card's "save to library…" dialog: optionally rename, then save; answers what it said saving does */
async function saveToLibraryDialog(p, as) {
  const dlg = p.locator("[role=dialog].savelibrarydialog");
  await dlg.waitFor({ timeout: 30000 });
  if (as != null) await dlg.locator("#savelibraryname").fill(as);
  const said = (await dlg.locator("p").last().innerText()).trim();
  await dlg.locator("button[type=submit]").click();
  await dlg.waitFor({ state: "detached", timeout: 60000 });
  return said;
}

module.exports = { pickExploreStudies, pickFacet, addViewKind, misalignedControls, saveToLibraryDialog };
