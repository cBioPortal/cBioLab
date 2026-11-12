// The driver-annotation settings (app/_oncoprint/DriverSettingsMenu.tsx, lib/driver-settings.ts):
// the oncoprint's "mutations" menu, as cBioPortal's Results-page sliders menu. A germline mutation is
// striped and named in the legend; "Show only somatic" re-runs the figure without it, says how many
// went, and is written into the document, so the link reproduces it; the Plots tab follows.
async function drivers({ browser, ok, BASE }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  try {
    // FLG carries one germline call in coadread_tcga_pub, TP53 none
    await page.goto(BASE + "/portal/results?study=coadread_tcga_pub&genes=FLG,TP53", { waitUntil: "domcontentloaded" });
    await page.locator(".onco-legend").waitFor({ timeout: 240000 });
    const legend = () => page.locator(".onco-legend").innerText();
    ok("drivers: a germline mutation is drawn as one and named in the legend", /Germline Mutation/.test(await legend()));
    await page.locator("button.driversbtn").click();
    const menu = page.locator("[data-test=GlobalSettingsDropdown]");
    await menu.waitFor({ timeout: 30000 });
    const text = (await menu.innerText()).replace(/\s+/g, " ");
    ok("drivers: the menu has the portal's sections; a source this warehouse lacks is offered disabled with its reason",
      /Annotate Data/.test(text) && /Filter Data/.test(text) && /Show only drivers/.test(text) && /Show only somatic/.test(text) &&
      await page.locator("[data-test=annotateHotspots] button[role=checkbox]").isDisabled(), text);
    ok("drivers: custom driver calls are offered only where the data has them", await page.locator("[data-test=annotateCustomBinary]").count() === 0);
    await page.locator("[data-test=HideGermline] button[role=checkbox]").click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => /germline mutations? hidden/.test((document.querySelector(".onco-legend") || {}).innerText || ""), null, { timeout: 240000 });
    const after = await legend();
    ok("drivers: Show only somatic re-runs without the germline call and says so", /1 germline mutation hidden/.test(after) && !/Germline Mutation/.test(after), after.replace(/\s+/g, " ").slice(0, 300));
    const changes = new URL(page.url()).searchParams.get("changes") || "";
    ok("drivers: the setting is the document's, carried by the link", changes.length > 0);
    // a reload of that link draws the same
    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /germline mutations? hidden/.test((document.querySelector(".onco-legend") || {}).innerText || ""), null, { timeout: 240000 });
    ok("drivers: the link reproduces the setting", true);
  } catch (e) {
    ok("drivers: the settings menu", false, String(e.message).split("\n")[0].slice(0, 200));
  }
  ok("drivers: no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

module.exports = { drivers };
