// The site: no credentials in the page, retired routes stay gone, /rationale and /verification render, the header's links.
async function site({ ok, BASE, page, errors }) {
  // No credentials anywhere client-visible: check for env var names plus the
  // actual secrets read from .env.local at runtime (never hardcoded here)
  const pageContent = await page.content();
  const secretBits = ["CLICKHOUSE"];
  try {
    const env = require("fs").readFileSync(__dirname + "/../../.env.local", "utf8");
    for (const key of ["CLICKHOUSE_PASSWORD", "CLICKHOUSE_USER"]) {
      const m = env.match(new RegExp(key + "=(.+)"));
      if (m) secretBits.push(m[1].trim());
    }
  } catch (e) { /* no .env.local locally */ }
  const secretLeak = secretBits.some(b => pageContent.includes(b));
  ok("no credentials in served HTML/DOM", !secretLeak);

  await page.screenshot({ path: "shot-next-light.png", fullPage: true });

  // The old routes stay gone rather than silently reappearing. Hitting a
  // dead route deliberately logs its own 404 resource error — expected, not
  // a regression — so it is filtered out of the shared error tally rather
  // than polluting the "no JS errors" check below.
  const errsBefore404 = errors.length;
  const oldOnco = await page.goto(BASE + "/oncoprint", { waitUntil: "domcontentloaded" });
  ok("deleted /oncoprint route stays gone", oldOnco.status() === 404, "status " + oldOnco.status());
  errors.splice(errsBefore404, errors.length - errsBefore404,
    ...errors.slice(errsBefore404).filter(e => !/404/.test(e)));

  // /rationale renders RATIONALE.md: its sections as HTML (not raw markdown),
  // under a header that marks the page. Console errors here are still caught
  // by the scheme-wide "no JS errors" check below.
  await page.goto(BASE + "/rationale");
  let rationaleOk = false, rationaleInfo = "";
  try {
    await page.waitForSelector(".rationale-doc h1", { timeout: 60000 });
    const sections = await page.locator(".rationale-doc h2").count();
    const rawHeadings = await page.locator(".rationale-doc p", { hasText: /^## / }).count();
    const here = await page.locator("header a.toplink[aria-current=page]").innerText();
    rationaleOk = sections > 3 && rawHeadings === 0 && here === "rationale";
    rationaleInfo = "h2=" + sections + " raw headings=" + rawHeadings + " header marks=" + here;
  } catch (e) { rationaleInfo = String(e.message || e).slice(0, 100); }
  ok("/rationale renders RATIONALE.md", rationaleOk, rationaleInfo);

  // /verification shows the recorded results of every check, and none of them failing.
  await page.goto(BASE + "/verification");
  let verifOk = false, verifInfo = "";
  try {
    await page.waitForSelector(".verif-page h1", { timeout: 60000 });
    const tiles = await page.locator(".repro-tile .n").allTextContents();
    const sections = await page.locator(".verif-sec").count();
    const failing = await page.locator(".verif-mark.err, .verif-pill.err").count();
    verifOk = tiles.length === 5 && sections >= 8 && failing === 0;
    verifInfo = "tiles=" + tiles.join(" ") + " sections=" + sections + " failing=" + failing;
  } catch (e) { verifInfo = String(e.message || e).slice(0, 100); }
  ok("/verification renders every check's recorded result, none failing", verifOk, verifInfo);
  await page.goto(BASE + "/lab");
  await page.waitForSelector("header a", { timeout: 60000 });
  const headerLinks = await page.locator("header a").allTextContents();
  ok("header nav points only at /rationale (oncoprint/builder links removed)",
    headerLinks.some(t => /rationale/i.test(t)) && !headerLinks.some(t => /^oncoprint$|^builder$/i.test(t)),
    headerLinks.join(", "));
}

module.exports = { site };
