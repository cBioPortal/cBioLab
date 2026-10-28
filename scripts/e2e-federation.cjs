// Patient-level federation end to end, against a server whose second database is served to itself
// as a simulated peer through its own federation API (lib/loopback-peer.ts): the timeline and alterations views list and
// show a peer's patients beside this instance's own, a plot draws from the peer's counts (its cases
// are not shared under these rules), every other view keeps the peer aggregate-only, and nothing
// patient-level answers an outside caller of the federation API.
//
// Run by scripts/gate.sh when a second database is configured; on its own against a server started
// with the simulated peer on:
//   PORT=3110 LOOPBACK_PEER=b FEDERATION_DISCLOSE_PATIENTS='*:timeline+alterations+oncoprint' \
//     FEDERATION_ACCEPT_PATIENT_LEVEL='*:timeline+alterations+oncoprint' npx next start -p 3110
//   E2E_PORT=3110 node scripts/e2e-federation.cjs
const { launch } = require("../e2e-browser.cjs");

const BASE = "http://127.0.0.1:" + (process.env.E2E_PORT || 3100);
const LOCAL = "msk_chord_2024", PEER = "nsclc_public_genie_bpc", PEER_PATIENT = "GENIE-DFCI-109626";
const COHORTS = { "KRAS mut": { studies: [LOCAL, PEER], all: [{ kind: "oql", q: "KRAS: MUT" }] }, "peer's patients": { study: PEER, all: [] }, "peer first": { studies: [PEER, LOCAL], all: [] } };
const doc = (views) => ({ dsl: "2.5", study: LOCAL, cohorts: COHORTS, views });

async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(path + " " + r.status + ": " + (j.error || "").slice(0, 200));
  return j;
}

/** An outside caller of the federation API — no token, so never answered as the peer. */
async function outsideCall(op, args) {
  const r = await fetch(BASE + "/api/federation/v1/" + op, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, error: String(j.error || "") };
}

/** An agent's view of /api/mcp: the tools it lists. */
async function mcpToolNames() {
  const r = await fetch(BASE + "/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const text = await r.text();
  const line = text.includes("data:") ? text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5) : text;
  return (JSON.parse(line).result?.tools || []).map((t) => t.name);
}

async function main() {
  const results = [];
  const ok = (name, cond, extra) => results.push((cond ? "PASS " : "FAIL ") + "federation: " + name + (extra ? "  [" + extra + "]" : ""));
  const isPeer = (s) => /simulated peer/.test(String(s));

  try {
    const altSpec = { kind: "alterations", rows: 5, cohorts: ["KRAS mut"], patient: { study: PEER, id: PEER_PATIENT }, mutations: { rows: 5, sort: { column: "vaf", desc: true } } };
    const r = await post("/api/analysis", doc([
      { kind: "timeline", rows: 5, cohorts: ["KRAS mut"], filters: { source: { op: "contains", value: "simulated peer" } }, sort: { column: "events", desc: true } },
      { kind: "alterations", rows: 5, cohorts: ["KRAS mut"], filters: { patient: { op: "equals", value: PEER_PATIENT } } },
      altSpec,
      { kind: "alterations", rows: 5, cohorts: ["KRAS mut"], patient: { study: PEER, id: "GENIE-NOT-A-PATIENT" } },
      { kind: "table", rows: 5, cohorts: ["KRAS mut"] },
      { kind: "compare", cohorts: ["KRAS mut"], genes: ["TP53"] },
    ]));
    const [tl, list, alt, notMember, table, compare] = r.views;
    const remoteQueries = (v) => (v.queries || []).filter((q) => q.remote).length;

    // the timeline: the peer's patients listed with their source, and one of them drawn from the peer
    const t = tl.timeline;
    ok("timeline lists both studies, the peer's from the peer", !tl.error && t.lists.length === 2 && t.lists.find((l) => l.study === PEER)?.total > 0 && t.rows.every((x) => isPeer(x.values[1])),
      tl.error || JSON.stringify(t.lists));
    ok("timeline draws a peer patient's record from the peer", t.patient?.study === PEER && t.patient.events.length > 0 && t.patient.source?.remote === true && remoteQueries(tl) > 0,
      t.patient ? t.patient.patient + ": " + t.patient.events.length + " events" : "no patient");

    // the alterations view: the list's counts and the patient's tables, both computed by the peer, agree
    const row = list.alterations?.rows.find((x) => x.patient === PEER_PATIENT);
    const cols = list.alterations?.columns.map((c) => c.id) || [];
    const listed = row ? Number(row.values[cols.indexOf("mutations")]) : NaN;
    const a = alt.alterations;
    ok("alterations shows a peer patient's tables, marked as the peer's", !alt.error && a.patient?.source?.remote === true && a.patient.samples.length > 0 && a.tables.mutations.total > 0,
      alt.error || (a.patient?.id + ": " + a.tables.mutations.total + " mutations"));
    ok("the peer's patient list and its tables count the same mutations", listed === a.tables.mutations.total && isPeer(row?.values[cols.indexOf("source")]), listed + " vs " + a.tables.mutations.total);
    ok("a peer table is annotated, and says with which OncoKB version", a.oncokbPin != null && a.tables.mutations.rows.some((x) => x.values[3] !== ""), String(a.oncokbPin));
    const vafs = a.tables.mutations.rows.map((x) => x.values[7]);
    ok("a peer table is sorted by the peer as asked", vafs.length > 1 && vafs.every((v, i) => i === 0 || vafs[i - 1] >= v), vafs.join(", "));
    ok("prev / next step through the peer's patients", a.position && a.position.prev?.study === PEER && a.position.next?.study === PEER, JSON.stringify(a.position));
    const page = await post("/api/view-page", { doc: doc([altSpec]), view: 0, table: "mutations", offset: 5, limit: 5 });
    ok("a peer table pages on", page.rows?.length === 5 && page.rows.every((x) => x.patient === PEER_PATIENT), String(page.rows?.length));
    ok("a patient the peer's cohort does not hold is refused", /not a patient of this cohort/.test(notMember.error || ""), notMember.error);

    // every other view keeps the peer aggregate-only, and one that would leave its patients out is not drawn
    ok("the clinical table is not drawn without the peer's patients, and says why", !table.table && new RegExp("Cannot be drawn without leaving out the patients of " + PEER).test(table.error || ""), table.error);
    ok("an aggregate view reaches the peer through the federation API", !compare.error && remoteQueries(compare) > 0 && compare.participation.studies.some((s) => s.study === PEER && s.remote), compare.error);

    // a plot: its counts from the peer through the federation API, pooled or alone; its cases only where the rules share
    // them, and these do not (FEDERATION_DISCLOSE_PATIENTS without "plot"), so the peer's study is density
    const plots = await post("/api/analysis", doc([
      { kind: "plot", unit: "sample", cohorts: ["KRAS mut"], x: { source: "clinical", attribute: "MUTATION_COUNT" }, y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } },
      { kind: "plot", unit: "sample", cohorts: ["peer's patients"], x: { source: "alteration", gene: "TP53", by: "mutated" }, y: { source: "clinical", attribute: "MUTATION_COUNT" } },
      { kind: "plot", unit: "sample", cohorts: ["peer first"], x: { source: "clinical", attribute: "MUTATION_COUNT" }, y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } },
    ]));
    const [pooled, peerBox, peerFirst] = plots.views;
    ok("a plot pooled with the peer's study draws, its counts from the peer through the federation API", !pooled.error && pooled.plot?.n > 0 && remoteQueries(pooled) > 0,
      pooled.error || pooled.plot?.n + " samples, " + remoteQueries(pooled) + " queries on the peer");
    // the axes' kinds are asked of the first study, here the peer's, with no cohort
    ok("a pooled plot whose first study is the peer's draws", !peerFirst.error && peerFirst.plot?.n > 0 && remoteQueries(peerFirst) > 0,
      peerFirst.error || peerFirst.plot?.n + " samples, " + remoteQueries(peerFirst) + " queries on the peer");
    const pb = peerBox.plot;
    ok("a plot of the peer's study alone draws its box and violin from the peer, and draws none of its cases, saying why",
      !peerBox.error && pb?.shape === "box" && (pb.violin || []).length > 0 && remoteQueries(peerBox) > 0 && pb.pointSet?.rule === "none" &&
      /may not show individual cases/.test(pb.pointSet?.why || "") && !(pb.points || []).length,
      peerBox.error || JSON.stringify(pb?.pointSet) + "; " + (pb?.groups || []).map((g) => g.g + " " + g.n).join(", "));

    // an oncoprint: the peer's patients as columns of the same figure as this instance's
    const onco = doc([{ kind: "oncoprint", genes: ["KRAS", "TP53"], cohorts: ["KRAS mut"] }]);
    const op = (await post("/api/analysis", onco)).views[0];
    ok("an oncoprint draws the peer's patients as columns beside this instance's", !op.error && op.nColumns > 0 && remoteQueries(op) > 0 &&
      (op.queries || []).some((q) => !q.remote) && new RegExp("columns of " + PEER + " come from .*via federation").test(op.note || ""),
      op.error || op.nColumns + " columns, " + remoteQueries(op) + " queries on the peer; " + op.note);
    // the page's path: the spec the analysis hands it, posted to /api/oncoprint with the cohort definitions
    const specView = (await post("/api/analysis?oncoprint=spec", onco)).views[0];
    const contract = specView.spec ? await post("/api/oncoprint?provenance=1", specView.spec) : {};
    const columns = contract.columns || [];
    const fromPeer = columns.filter((c) => c.startsWith(PEER + "_")).length, fromHere = columns.filter((c) => c.startsWith(LOCAL + "_")).length;
    ok("the page's oncoprint has columns from both studies, the peer's read through the federation API",
      fromPeer > 0 && fromHere > 0 && fromPeer + fromHere === columns.length && (contract.queries || []).some((q) => q.remote && q.study === PEER),
      specView.error || contract.error || fromPeer + " peer, " + fromHere + " local of " + columns.length + " columns");
    ok("both paths draw the same columns", columns.length === op.nColumns, columns.length + " vs " + op.nColumns);
    const outsideOnco = await outsideCall("oncoprint-columns", { study: PEER, groups: null, genes: ["KRAS"], clinical: [], heatmap: [], overlays: [], unit: "patient", lineGap: 90 });
    ok("an outside caller gets no oncoprint columns of the simulated peer's study", outsideOnco.status === 422 && /not held here at patient level/.test(outsideOnco.error),
      outsideOnco.status + " " + outsideOnco.error);

    // an outside caller: patient-level data of neither database
    const parts = [{ cohort: "c", cohortDef: { all: [] } }];
    const own = await outsideCall("patient-rows", { study: LOCAL, table: "timeline", parts, source: "x", defaults: ["patient"], mode: "counts" });
    ok("an outside caller gets no patient of this instance's own database", own.status === 422 && /not a study this instance discloses/.test(own.error), own.status + " " + own.error);
    const peer = await outsideCall("patient-rows", { study: PEER, table: "timeline", parts, source: "x", defaults: ["patient"], mode: "counts" });
    ok("nor of the simulated peer's, without the token", peer.status === 422 && /not held here at patient level/.test(peer.error), peer.status + " " + peer.error);
    // and an agent at /api/mcp is offered no federation op at all
    const tools = await mcpToolNames();
    ok("/api/mcp lists its agent tools and no federation op", tools.includes("run_analysis") && !tools.some((n) => /^federated_/.test(n)), tools.join(","));
  } catch (e) {
    ok("the federated analysis", false, String(e.message).split("\n")[0].slice(0, 200));
  }

  // the card: a peer patient said to come from the peer
  const browser = await launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const d = doc([{ kind: "alterations", cohorts: ["KRAS mut"], patient: { study: PEER, id: PEER_PATIENT } }]);
    await p.goto(BASE + "/lab?tab=analysis&doc=" + encodeURIComponent(Buffer.from(JSON.stringify(d)).toString("base64")));
    await p.waitForSelector(".tl-who", { timeout: 300000 });
    const who = await p.locator(".tl-who").first().evaluate((e) => e.parentElement.innerText);
    ok("the alterations card says the patient came from the peer via federation", new RegExp(PEER_PATIENT + "[\\s\\S]*simulated peer[\\s\\S]*via federation").test(who), who.split("\n")[0]);
    ok("the card has no JS errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  } catch (e) {
    ok("the alterations card", false, String(e.message).split("\n")[0].slice(0, 200));
  } finally { await browser.close(); }

  console.log(results.join("\n"));
  process.exit(results.some((x) => x.startsWith("FAIL")) ? 1 : 0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(2); });
