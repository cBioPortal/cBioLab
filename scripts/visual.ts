// Visual regression check: screenshots every page, every Analysis tab state and every gallery
// example (light and dark), and compares them pixel by pixel with a saved baseline.
//
//   node scripts/visual.ts --update              record the baseline from the running app
//   node scripts/visual.ts                       compare the running app against it
//   node scripts/visual.ts --only=example-03     a subset (substring of the shot name)
//
// VISUAL_BASE picks the server (default http://127.0.0.1:3109, this session's next dev).
// Baselines, current shots and diffs go to .visual/ (ignored by git: they depend on the live
// warehouse and this machine's fonts, so they are a local before/after tool, not a CI fixture).
//
// The harness finds nothing by CSS class, so restyling the app cannot break it. A page is
// settled when no element is aria-busy, no infinite animation runs (a spinner or a skeleton is
// one, and document.getAnimations() names them without knowing their classes), the network has
// gone quiet, and screenshots taken a moment apart are identical. Text that changes from run to
// run (query timings, the build stamp) is replaced before the shot.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { EXAMPLES } from "../lib/dsl-reference.ts";

const require = createRequire(import.meta.url);
const { launch } = require("../e2e-browser.cjs");

const BASE = process.env.VISUAL_BASE || "http://127.0.0.1:3109";
const DIR = new URL("../.visual/", import.meta.url).pathname;
const UPDATE = process.argv.includes("--update");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const CONCURRENCY = Number(process.env.VISUAL_CONCURRENCY || 2);
/** a pixel counts as changed past this colour distance (pixelmatch's 0..1 threshold) */
const PIXEL_THRESHOLD = 0.1;
/**
 * At most this many changed pixels, scattered, is reported as NOISE rather than a failure: the
 * oncoprint canvas's anti-aliasing varies by a few dozen pixels between identical renders. A real
 * change (a 1px border moving along one card) is hundreds.
 */
const NOISE_PX = Number(process.env.VISUAL_NOISE_PX || 50);

interface Shot { name: string; path: string; setup?: (page: any) => Promise<void> }

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const pad = (i: number) => String(i + 1).padStart(2, "0");

function shots(): Shot[] {
  const list: Shot[] = [
    { name: "lab-explore-empty", path: "/lab?tab=explore" },
    {
      name: "lab-explore-studies", path: "/lab?tab=explore",
      setup: async (p) => {
        await p.waitForFunction(() => (window as any).cohortLab?.selectStudies, null, { timeout: 120000 });
        await p.evaluate(() => (window as any).cohortLab.selectStudies(["msk_chord_2024", "genie_public"]));
      },
    },
    { name: "lab-saved", path: "/lab?tab=cohorts" },
    { name: "lab-analysis-empty", path: "/lab?tab=analysis" },
    { name: "lab-examples", path: "/lab?tab=examples" },
    { name: "rationale", path: "/rationale" },
    { name: "verification", path: "/verification" },
    { name: "reproductions", path: "/reproductions" },
    { name: "datasets", path: "/datasets" },
    { name: "campaign-index", path: "/campaign" },
    { name: "oncoprint-lab-chord", path: "/oncoprint-lab?preset=chord" },
    { name: "portal-results", path: "/portal/results?study=msk_chord_2024&genes=KRAS,NRAS" },
  ];
  EXAMPLES.forEach((ex, i) => {
    // an example that runs on uploads needs them imported first; the gallery does that, a link cannot
    if (ex.customData?.length) return;
    list.push({ name: "example-" + pad(i), path: "/lab?tab=analysis&doc=" + b64url(JSON.stringify(ex.doc)) });
  });
  return list.filter((s) => !ONLY || s.name.includes(ONLY));
}

/** run-to-run noise, replaced in the DOM before each shot */
async function normalize(page: any) {
  await page.evaluate(() => {
    // a timing is rendered as "<number>ms" or "<number> + <number> draw", often split across text
    // nodes ({ms.toLocaleString()}ms), so numbers are matched by the text that follows them too
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const unit = /^\s?(ms|s|draw\))\b/;
    nodes.forEach((n, i) => {
      let t = n.nodeValue || "";
      t = t.replace(/\d[\d,.]*(\s?)(ms|s)\b/g, "0$1$2");
      const after = nodes[i + 1]?.nodeValue || "";
      if (unit.test(after) || /^\s?\+\s?$/.test(after)) t = t.replace(/\d[\d,.]*(\s?)$/, "0$1");
      if (/^\s?\+\s?$/.test(nodes[i - 1]?.nodeValue || "") && /^\s?draw/.test(after)) t = t.replace(/\d[\d,.]*/, "0");
      if (t !== n.nodeValue) n.nodeValue = t;
    });
    for (const a of document.querySelectorAll("footer a[href*='/commit/']")) a.textContent = "build";
    // next dev's own overlay is not part of the app
    for (const el of document.querySelectorAll("nextjs-portal")) (el as HTMLElement).style.display = "none";
  });
}

async function settle(page: any): Promise<Buffer> {
  const deadline = Date.now() + 180000;
  let last: Buffer | null = null;
  while (Date.now() < deadline) {
    // still loading: something is aria-busy, or a spinner or skeleton (an infinite animation) runs
    await page.waitForFunction(() => !document.querySelector("[aria-busy='true']") &&
      !document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity),
      null, { timeout: Math.max(1000, deadline - Date.now()), polling: 250 });
    await page.waitForLoadState("networkidle", { timeout: Math.max(1000, deadline - Date.now()) }).catch(() => {});
    await page.waitForTimeout(600);
    await normalize(page);
    const buf: Buffer = await page.screenshot({ fullPage: true, caret: "hide" });
    if (last && buf.equals(last)) {
      // a quiet moment between two requests can pass all of the above; it must hold
      await page.waitForTimeout(1500);
      await normalize(page);
      const again: Buffer = await page.screenshot({ fullPage: true, caret: "hide" });
      if (again.equals(buf)) return buf;
      last = again;
      continue;
    }
    last = buf;
  }
  throw new Error("never settled (still changing after 3 minutes)");
}

function compare(a: Buffer, b: Buffer, diffPath: string): { changed: number; total: number; note?: string } {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
  const grow = (p: PNG) => {
    if (p.width === w && p.height === h) return p;
    const out = new PNG({ width: w, height: h, fill: true });
    out.data.fill(255);
    PNG.bitblt(p, out, 0, 0, p.width, p.height, 0, 0);
    return out;
  };
  const diff = new PNG({ width: w, height: h });
  const changed = pixelmatch(grow(A).data, grow(B).data, diff.data, w, h, { threshold: PIXEL_THRESHOLD });
  if (changed) writeFileSync(diffPath, PNG.sync.write(diff));
  const note = A.width !== B.width || A.height !== B.height ? `size ${A.width}x${A.height} → ${B.width}x${B.height}` : undefined;
  return { changed, total: w * h, note };
}

/** the dev server restarts itself when it dies (serve-<port>.sh); wait for it rather than failing */
async function serverUp(page: any) {
  for (let i = 0; i < 60; i++) {
    try { if ((await page.request.get(BASE + "/api/version", { timeout: 10000 })).ok()) return; } catch {}
    await page.waitForTimeout(5000);
  }
  throw new Error("server at " + BASE + " did not come back within 5 minutes");
}

async function main() {
  const list = shots();
  const out = UPDATE ? DIR + "baseline/" : DIR + "current/";
  if (!UPDATE) rmSync(DIR + "diff/", { recursive: true, force: true });
  for (const d of [out, DIR + "diff/"]) mkdirSync(d, { recursive: true });
  if (!UPDATE && !existsSync(DIR + "baseline/")) throw new Error("no baseline: run with --update first");

  const browser = await launch();
  const results: string[] = [];
  let failures = 0;
  const jobs = list.flatMap((s) => (["light", "dark"] as const).map((scheme) => ({ s, scheme })));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { s, scheme } = jobs[next++];
      const name = s.name + "-" + scheme;
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1360, height: 900 } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      try {
        for (let attempt = 0; ; attempt++) {
          try { await page.goto(BASE + s.path, { waitUntil: "domcontentloaded", timeout: 120000 }); break; }
          catch (e) {
            if (attempt >= 2 || !/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/.test(String(e))) throw e;
            await serverUp(page);
          }
        }
        if (s.setup) await s.setup(page);
        const buf = await settle(page);
        writeFileSync(out + name + ".png", buf);
        if (UPDATE) results.push("SAVED " + name);
        else {
          const base = DIR + "baseline/" + name + ".png";
          if (!existsSync(base)) { results.push("NEW   " + name + " (no baseline)"); continue; }
          const r = compare(readFileSync(base), buf, DIR + "diff/" + name + ".png");
          const pct = (100 * r.changed / r.total).toFixed(3);
          const noise = r.changed > 0 && r.changed <= NOISE_PX && !r.note;
          if (r.changed && !noise) failures++;
          results.push((noise ? "NOISE " : r.changed ? "DIFF  " : "SAME  ") + name + (r.changed ? `  ${r.changed} px (${pct}%)` : "") + (r.note ? "  " + r.note : ""));
        }
        if (errors.length) results.push("      " + name + " page errors: " + errors.join(" | "));
      } catch (e) {
        failures++;
        results.push("ERROR " + name + ": " + String((e as Error).message).split("\n")[0]);
      } finally {
        await ctx.close();
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();
  results.sort((a, b) => a.slice(6).localeCompare(b.slice(6)));
  console.log(results.join("\n"));
  console.log(`\n${jobs.length} shots, ${failures} ${UPDATE ? "errors" : "differ or failed"} — ${out}${!UPDATE && failures ? "  (diffs in " + DIR + "diff/)" : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
