// ClickHouse cost of one user action, legacy cBioPortal vs cBioLab, measured on the dedicated
// benchmark service. Runs are strictly sequential: each run's window is bounded by the
// database's own clock, and its cost is every query that user finished inside the window.
// Only one app's server is up at a time: each block starts one app, runs every scenario on it,
// and stops it before the other app starts.
//
//   node --env-file=.env.local scripts/portal-bench/measure.cjs [reps] [scenario...]
//   BENCH_CACHE=on ...   both apps' result caches on; each scenario gets a fresh server (empty
//                        cache) and is measured twice: "first" load, then "repeat" load
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execSync } = require("node:child_process");
const { launch } = require(path.join(__dirname, "../../e2e-browser.cjs"));

const PORTAL = process.env.PORTAL_BASE || "http://127.0.0.1:8155";
const LAB = process.env.LAB_BASE || "http://127.0.0.1:4156";
const CH = process.env.CLICKHOUSE_BENCH_URL.replace(/\/+$/, "") + "/";
const AUTH = "Basic " + Buffer.from(process.env.CLICKHOUSE_BENCH_USER + ":" + process.env.CLICKHOUSE_BENCH_PASSWORD).toString("base64");
const USER = { portal: "bench_portal", lab: process.env.LAB_CH_USER || "cohort_lab_ro" };

const portalResults = (tab, study, genes, profiles) => `${PORTAL}/results/${tab}?` + new URLSearchParams({
  cancer_study_list: study, case_set_id: study + "_all", gene_list: genes.join(" "), geneset_list: " ",
  profileFilter: profiles, Z_SCORE_THRESHOLD: "2.0", RPPA_SCORE_THRESHOLD: "2.0", tab_index: "tab_visualize", Action: "Submit"
});
const labResults = (tab, study, genes) => `${LAB}/portal/results?` + new URLSearchParams({ study, genes: genes.join(" "), tab });

const ONCO_GENES = ["TP53", "KRAS", "EGFR", "STK11", "KEAP1"];
const MSK = "msk_chord_2024", MSK_PROFILES = "mutations,structural_variants,cna";
const portalComparison = (sub) => portalResults("comparison", MSK, ONCO_GENES, MSK_PROFILES) + "&comparison_subtab=" + sub;
const labComparison = (sub) => labResults("Comparison/Survival \u203a " + sub, MSK, ONCO_GENES);
const SCENARIOS = {
  studyview: {
    desc: "Study view / Explore, msk_chord_2024, no filters",
    portal: `${PORTAL}/study/summary?id=${MSK}`,
    lab: `${LAB}/lab?` + new URLSearchParams({ tab: "explore", study: MSK }),
  },
  oncoprint: {
    desc: "Results › OncoPrint, msk_chord_2024, " + ONCO_GENES.join(" "),
    portal: portalResults("oncoprint", MSK, ONCO_GENES, MSK_PROFILES),
    lab: labResults("Oncoprint", MSK, ONCO_GENES),
  },
  plots: {
    desc: "Results › Plots, brca_tcga_pan_can_atlas_2018, ERBB2 (default axes: CNA vs mRNA)",
    portal: portalResults("plots", "brca_tcga_pan_can_atlas_2018", ["ERBB2"], "mutations,structural_variants,gistic,rna_seq_v2_mrna_median_Zscores"),
    lab: labResults("Plots", "brca_tcga_pan_can_atlas_2018", ["ERBB2"]),
  },
  survival: {
    desc: "Results › Comparison/Survival › Survival, msk_chord_2024, altered vs unaltered",
    portal: portalComparison("survival"), lab: labComparison("Survival"),
  },
  cmp_clinical: {
    desc: "Results › Comparison/Survival › Clinical, msk_chord_2024",
    portal: portalComparison("clinical"), lab: labComparison("Clinical"),
  },
  cmp_alterations: {
    desc: "Results › Comparison/Survival › Genomic Alterations, msk_chord_2024",
    portal: portalComparison("alterations"), lab: labComparison("Genomic Alterations"),
  },
};

async function ch(sql) {
  // a replica restarting or rescaling drops connections now and then: retry before giving up
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(CH, { method: "POST", headers: { Authorization: AUTH }, body: sql + " FORMAT JSON" });
      const t = await r.text();
      if (!r.ok) throw new Error("ClickHouse: " + t.slice(0, 300));
      return JSON.parse(t).data;
    } catch (e) {
      if (attempt >= 5 || /SYNTAX_ERROR|ACCESS_DENIED|UNKNOWN_/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}
const dbNow = async () => (await ch("SELECT toString(now64(3)) t"))[0].t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Done = the page has had no API request in flight for QUIET_MS, after at least one was made.
const CACHED = process.env.BENCH_CACHE === "on";
const QUIET_MS = 5000, MAX_MS = 300000;
async function drive(page, url) {
  let inflight = 0, last = Date.now(), seen = 0;
  const api = (r) => ["fetch", "xhr"].includes(r.resourceType());
  page.on("request", (r) => { if (api(r)) { inflight++; seen++; last = Date.now(); } });
  const done = (r) => { if (api(r)) { inflight = Math.max(0, inflight - 1); last = Date.now(); } };
  page.on("requestfinished", done); page.on("requestfailed", done);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: MAX_MS });
  const quiet = async () => {
    while (Date.now() - t0 < MAX_MS) {
      if (seen && inflight === 0 && Date.now() - last >= QUIET_MS) return;
      await sleep(250);
    }
  };
  await quiet();
  // a page still drawing can ask for more once it finishes: wait until no loading indicator is
  // showing (the portal's "Querying …" box, cBioLab's "updating…"/"loading…"), then for quiet again
  await page.waitForFunction(() => !/Querying \d+ genes?|updating…|loading…/.test(document.body.innerText),
    null, { timeout: Math.max(1000, MAX_MS - (Date.now() - t0)), polling: 500 }).catch(() => {});
  last = Math.max(last, Date.now());
  await quiet();
  return { requests: seen, wallMs: Date.now() - t0 - QUIET_MS, timedOut: Date.now() - t0 >= MAX_MS, errors };
}

const WHERE = (user, a, b) => `FROM clusterAllReplicas(default, system.query_log)
  WHERE event_date >= yesterday() AND type IN ('QueryFinish','ExceptionWhileProcessing') AND user = '${user}'
    AND query_kind = 'Select' AND event_time_microseconds BETWEEN '${a}' AND '${b}'`;

async function collect(user, a, b) {
  // each replica flushes its log on its own schedule, sometimes 10s+ late: wait until every
  // replica's log has entries past the end of the window (ClickHouse's own monitoring queries
  // keep every log moving), so nothing the run caused can still be unwritten
  for (let i = 0; i < 60; i++) {
    const [{ caught }] = await ch(`SELECT min(mx) > toDateTime64('${b}', 6) + 2 AS caught FROM (
        SELECT hostname() h, max(event_time_microseconds) mx FROM clusterAllReplicas(default, system.query_log)
        WHERE event_date >= yesterday() GROUP BY h)`);
    if (+caught) break;
    await sleep(2000);
  }
  const [tot] = await ch(`SELECT count() queries, countIf(type != 'QueryFinish') failed,
      round(sum(ProfileEvents['OSCPUVirtualTimeMicroseconds'])/1e6, 2) cpu_s,
      sum(read_bytes) read_bytes, sum(read_rows) read_rows,
      max(memory_usage) peak_mem, sum(memory_usage) sum_mem,
      round(sum(query_duration_ms)/1000, 2) db_s ${WHERE(user, a, b)}`);
  const top = await ch(`SELECT normalized_query_hash h, count() n,
      round(sum(ProfileEvents['OSCPUVirtualTimeMicroseconds'])/1e6, 2) cpu_s, sum(read_bytes) read_bytes,
      substring(replaceRegexpAll(any(query), '\\s+', ' '), 1, 160) sql_sample ${WHERE(user, a, b)}
      GROUP BY h ORDER BY cpu_s DESC LIMIT 8`);
  return { ...tot, top };
}

const LAB_DIR = path.join(__dirname, "../..");

// Server usage from the kernel's cgroup counters: the portal's containers (portal, plus Redis when
// the cache is on) and cBioLab's `next start` tree, which runs in its own systemd user scope.
// CPU is usage_usec over the run; memory is the cgroups' anonymous memory (the processes' own,
// not file cache), sampled every 200ms for its peak.
const LAB_SCOPE = "cbio-bench-lab";
const UID = process.getuid();
function cgroups(app) {
  if (app === "lab") return [`/sys/fs/cgroup/user.slice/user-${UID}.slice/user@${UID}.service/app.slice/${LAB_SCOPE}.scope`];
  const names = ["cbio-bench-portal", "cbio-bench-redis", "cbio-bench-redis-follower"];
  return names.map((n) => { try { return "/sys/fs/cgroup/system.slice/docker-" + execSync(`docker inspect -f '{{.Id}}' ${n}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() + ".scope"; } catch { return null; } }).filter(Boolean);
}
const readCg = (dirs) => dirs.reduce((t, d) => {
  try {
    t.cpu += +/usage_usec (\d+)/.exec(fs.readFileSync(d + "/cpu.stat", "utf8"))[1];
    t.anon += +/^anon (\d+)/m.exec(fs.readFileSync(d + "/memory.stat", "utf8"))[1];
  } catch { /* a container that is not there */ }
  return t;
}, { cpu: 0, anon: 0 });
function sampleServer(app) {
  const dirs = cgroups(app);
  if (!dirs.length) throw new Error("no cgroup found for " + app);
  const base = readCg(dirs);
  let peak = base.anon;
  const timer = setInterval(() => { peak = Math.max(peak, readCg(dirs).anon); }, 200);
  return () => {
    clearInterval(timer);
    const end = readCg(dirs);
    peak = Math.max(peak, end.anon);
    return { srv_cpu_s: +((end.cpu - base.cpu) / 1e6).toFixed(2), srv_mem_base_mib: Math.round(base.anon / 2 ** 20),
      srv_mem_peak_mib: Math.round(peak / 2 ** 20), srv_mem_growth_mib: Math.round((peak - base.anon) / 2 ** 20) };
  };
}
const portPort = (u) => new URL(u).port;
const listening = (port) => { try { return execSync("ss -ltnH 'sport = :" + port + "'").toString().trim() !== ""; } catch { return false; } };
async function waitUp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return; } catch { /* not yet */ }
    await sleep(1000);
  }
  throw new Error("server did not come up: " + url);
}
const SERVERS = {
  portal: {
    async start() {
      spawn(path.join(__dirname, "run.sh"), { detached: true, stdio: ["ignore", fs.openSync(path.join(__dirname, "portal.log"), "w"), fs.openSync(path.join(__dirname, "portal.log"), "a")] }).unref();
      await waitUp(PORTAL + "/api/info", 180000);
    },
    stop() { try { execSync("docker rm -f cbio-bench-portal cbio-bench-redis cbio-bench-redis-follower", { stdio: "ignore" }); } catch { /* already gone */ } },
  },
  lab: {
    async start() {
      const log = fs.openSync(path.join(__dirname, "lab-server.log"), "w");
      spawn("systemd-run", ["--user", "--scope", "--quiet", "--unit=" + LAB_SCOPE, "npx", "next", "start", "-p", portPort(LAB), "-H", "0.0.0.0"], { cwd: LAB_DIR, detached: true, stdio: ["ignore", log, log],
        env: { ...process.env, NEXT_DIST_DIR: process.env.LAB_DIST || ".next-bench", CLICKHOUSE_URL: process.env.CLICKHOUSE_BENCH_URL, CLICKHOUSE2_URL: "",
          ...(CACHED ? { RESULT_CACHE: "", RESULT_CACHE_MB: "256" } : { RESULT_CACHE: "off" }), DATABASE_URL: "", SUPABASE_DB_URL: "" } }).unref();
      await waitUp(LAB + "/lab", 120000);
    },
    stop() {
      try { execSync("systemctl --user stop " + LAB_SCOPE + ".scope", { stdio: "ignore" }); } catch { /* not running */ }
      try { execSync("fuser -k " + portPort(LAB) + "/tcp", { stdio: "ignore" }); } catch { /* already gone */ }
    },
  },
};
async function stopAll() {
  for (const s of Object.values(SERVERS)) s.stop();
  for (let i = 0; i < 20 && (listening(portPort(PORTAL)) || listening(portPort(LAB))); i++) await sleep(500);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await stopAll(); process.exit(1); });

(async () => {
  const reps = +(process.argv[2] || 3);
  const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENARIOS);
  const out = path.join(__dirname, "results", new Date().toISOString().replace(/[:.]/g, "-") + ".jsonl");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await launch({ headless: true, args: ["--no-sandbox"] });
  await stopAll();
  if (listening(portPort(PORTAL)) || listening(portPort(LAB))) throw new Error("a bench port is still in use");
  const measure = async (name, app, r, phase) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    const a = await dbNow();
    const srvDone = sampleServer(app);
    const d = await drive(page, SCENARIOS[name][app]);
    const srv = srvDone();
    const b = await dbNow();
    await page.screenshot({ path: path.join(path.dirname(out), `${name}-${app}-${r}${phase ? "-" + phase : ""}.png`) });
    await ctx.close();
    const cost = await collect(USER[app], a, b);
    const rec = { scenario: name, app, rep: r, cache: CACHED ? "on" : "off", phase: phase || null, window: [a, b], ...d, ...cost, ...srv };
    fs.appendFileSync(out, JSON.stringify(rec) + "\n");
    console.log(`${name.padEnd(10)} ${app.padEnd(6)} rep${r} ${(phase || "").padEnd(6)} q=${cost.queries} cpu=${cost.cpu_s}s read=${(cost.read_bytes / 2 ** 30).toFixed(2)}GiB rows=${(cost.read_rows / 1e6).toFixed(1)}M peak=${(cost.peak_mem / 2 ** 20).toFixed(0)}MiB db=${cost.db_s}s wall=${(d.wallMs / 1000).toFixed(1)}s http=${d.requests} | server cpu=${srv.srv_cpu_s}s mem=${srv.srv_mem_base_mib}→${srv.srv_mem_peak_mib}MiB${d.timedOut ? " TIMEOUT" : ""}${cost.failed ? " failed=" + cost.failed : ""}${d.errors.length ? " pageErrors=" + d.errors.length : ""}`);
  };
  const up = async (app, r) => {
    // ClickHouse Cloud idles the service when unused; wake it before an app tries to connect
    for (let i = 0; i < 30; i++) { try { await ch("SELECT 1"); break; } catch { await sleep(5000); } }
    await SERVERS[app].start();
    // one unmeasured load of the app's home page, so the first measured scenario doesn't pay for server warm-up
    const ctx = await browser.newContext(); await drive(await ctx.newPage(), app === "portal" ? PORTAL + "/" : LAB + "/"); await ctx.close();
    console.log(`-- ${app} up (rep ${r}, cache ${CACHED ? "on" : "off"})`);
  };
  for (let r = 0; r < reps; r++) {
    // alternate which app goes first so neither always benefits from a warmer database
    for (const app of (r % 2 ? ["lab", "portal"] : ["portal", "lab"]).filter((a) => !process.env.APPS || process.env.APPS.split(",").includes(a))) {
      if (CACHED) {
        for (const name of names) {
          await up(app, r);
          try { await measure(name, app, r, "first"); await measure(name, app, r, "repeat"); } finally { await stopAll(); }
        }
      } else {
        await up(app, r);
        try { for (const name of names) await measure(name, app, r, null); } finally { await stopAll(); }
      }
    }
  }
  await browser.close();
  console.log("results:", out);
})().catch(async (e) => { console.error(e); await stopAll(); process.exit(1); });
