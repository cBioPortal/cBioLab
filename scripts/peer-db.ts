// `npm run peer-db` — the second database the tests read (connection b, CLICKHOUSE2_*): a private
// ClickHouse holding the committed fixture study (test/fixtures/peer-study) and the OncoKB calls
// for its variants (test/fixtures/peer-oncokb.tsv). scripts/gate.sh starts it and points the gate's
// checks at it, so no test depends on a second warehouse's contents.
//
//   node --env-file-if-exists=.env.local scripts/peer-db.ts            start it (or find it running); print CLICKHOUSE2_* lines
//   node scripts/peer-db.ts --stop                                     stop the one on this port
//   options: --port <http port>    default PEER_DB_PORT, else 20000 + GATE_PORT % 10000 (23100 for the gate's default 3100)
//
// The server runs in the background and outlives this script. Its data is in CBIOLAB_PEER_DATA
// (default ~/.cbiolab-peer/<port>), one folder per port so concurrent gates never share one; the
// ClickHouse binary and cBioPortal's reference files are shared with `npm run local` in
// CBIOLAB_DATA (default ~/.cbiolab). A second run finds the server, sees the fixture already
// imported (a hash of its files is stored beside it) and only re-checks the OncoKB rows: seconds.
//
// The OncoKB rows are stored under the version this app pins (ONCOKB_PIN, else the primary
// warehouse's latest, read through CLICKHOUSE_*), since a peer annotates with its caller's pin
// (lib/federation-api.ts), and under "fixture" so the table is never empty without a primary.
// Logs go to stderr; stdout carries only the KEY=value lines.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CBIOPORTAL_COMMIT, setupDatabase } from "@cbiolab/importer/setup";
import { exec, insertAll, query, sq, type WriteConn } from "@cbiolab/importer/ch-write";
import { importStudy } from "@cbiolab/importer/import-study";
import { clickhouseBinary, clickhouseConfig, exists, ping, startClickhouse, waitFor, writeUsers, type ClickhouseServer } from "./clickhouse-local.ts";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIXTURE = path.join(repo, "test", "fixtures", "peer-study");
const ONCOKB = path.join(repo, "test", "fixtures", "peer-oncokb.tsv");
const STUDY = "cbiolab_peer_fixture";
const LABEL = "fixture peer";
const httpPort = Number(opt("--port", process.env.PEER_DB_PORT || String(20000 + Number(process.env.GATE_PORT || 3100) % 10000)));
const shared = path.resolve(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"));
const peerDir = path.resolve(process.env.CBIOLAB_PEER_DATA || path.join(os.homedir(), ".cbiolab-peer", String(httpPort)));
const server: ClickhouseServer = { dir: path.join(peerDir, "clickhouse"), httpPort, tcpPort: httpPort + 10000 };
const say = (msg: string) => console.error("[peer-db] " + msg);

async function stop(): Promise<void> {
  const pidFile = path.join(server.dir, "pid");
  if (!(await ping(httpPort))) { say("nothing answers on port " + httpPort); return; }
  if (!(await exists(pidFile))) throw new Error("port " + httpPort + " answers, but " + pidFile + " is missing: not a server this script started");
  process.kill(Number((await readFile(pidFile, "utf8")).trim()), "SIGTERM");
  await waitFor(async () => !(await ping(httpPort)), "ClickHouse's shutdown", 60);
  say("stopped the peer database on port " + httpPort);
}

/** The fixture's files and the reference data they are imported against, as one hash. */
async function fixtureHash(): Promise<string> {
  const h = createHash("sha256").update(CBIOPORTAL_COMMIT);
  for (const f of (await readdir(FIXTURE)).sort()) h.update(f).update(await readFile(path.join(FIXTURE, f)));
  return h.digest("hex");
}

async function importFixture(conn: WriteConn): Promise<void> {
  await exec(conn, "CREATE TABLE IF NOT EXISTS cbiolab_peer_fixture (hash String, at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY at");
  const hash = await fixtureHash();
  const last = await query<{ h: string }>(conn, "SELECT argMax(hash, at) AS h FROM cbiolab_peer_fixture");
  const present = await query<{ n: number }>(conn, "SELECT count() AS n FROM cancer_study WHERE cancer_study_identifier = " + sq(STUDY));
  if (last[0]?.h === hash && Number(present[0]?.n) > 0) { say(STUDY + " is imported and current"); return; }
  say("importing " + path.relative(repo, FIXTURE));
  const r = await importStudy(conn, shared, FIXTURE, STUDY, () => undefined);
  for (const f of r.files) say("  " + f.file + ": " + f.stored + " of " + f.read + " rows" + (Object.keys(f.skipped).length ? " — not stored: " + JSON.stringify(f.skipped) : ""));
  for (const w of r.warnings) say("  warning: " + w);
  // the fixture is written to import whole; a file left out is a fixture (or importer) bug to see
  if (r.notImported.length) throw new Error("files of the fixture were not imported: " + r.notImported.map((n) => n.file + " (" + n.reason + ")").join("; "));
  await exec(conn, "INSERT INTO cbiolab_peer_fixture (hash) VALUES (" + sq(hash) + ")");
  say("imported " + r.patients + " patients, " + r.samples + " samples in " + r.seconds + " s");
}

/** The OncoKB version the app will annotate with: ONCOKB_PIN, else the primary warehouse's latest, if it has one. */
async function appPin(): Promise<string | null> {
  if (process.env.ONCOKB_PIN) return process.env.ONCOKB_PIN;
  if (!process.env.CLICKHOUSE_URL) return null;
  const { oncokbPin } = await import("../lib/annotation.ts");
  return oncokbPin();
}

async function seedOncokb(conn: WriteConn): Promise<void> {
  const [head, ...lines] = (await readFile(ONCOKB, "utf8")).split("\n").filter((l) => l.trim());
  const cols = head.split("\t");
  const rows = lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
  const pin = await appPin();
  const versions = [...new Set([pin, "fixture"].filter((v): v is string => !!v))];
  const db = { ...conn, db: "oncokb_annotation" };
  for (const v of versions) {
    const n = await query<{ n: number }>(db, "SELECT count() AS n FROM variant_annotation FINAL WHERE oncokb_version = " + sq(v));
    if (Number(n[0]?.n) === rows.length) continue;
    await exec(db, "ALTER TABLE variant_annotation DELETE WHERE oncokb_version = " + sq(v));
    await insertAll(db, "variant_annotation", rows.map((r) => ({ ...r, oncokb_version: v, api_version: "fixture" })));
    say("OncoKB calls for the fixture's variants stored under " + v);
  }
  if (!pin) say("no primary warehouse to read the app's OncoKB pin from; its calls are stored under \"fixture\" only");
}

async function main(): Promise<void> {
  if (args.includes("--stop")) return stop();
  const bin = await clickhouseBinary(path.join(shared, "bin"), say);
  const { config, password } = await clickhouseConfig(server);
  if (await ping(httpPort)) say("ClickHouse is already running on port " + httpPort);
  else {
    say("starting ClickHouse on 127.0.0.1:" + httpPort + " (data in " + peerDir + ")");
    await startClickhouse(bin, config, server, true, say);
    await waitFor(() => ping(httpPort), "ClickHouse", 60);
  }
  // not "b": a write here must never be taken for a read of the app's connection b (LOOPBACK_PEER=b refuses those)
  const conn: WriteConn = { id: "peer-db", url: "http://127.0.0.1:" + httpPort, user: "default", password, db: "cbioportal", label: LABEL };
  await setupDatabase(conn, shared, say);
  await writeUsers(server.dir, password, true);
  await importFixture(conn);
  await seedOncokb(conn);
  process.stdout.write(["CLICKHOUSE2_URL=" + conn.url, "CLICKHOUSE2_USER=" + conn.user, "CLICKHOUSE2_PASSWORD=" + password,
    "CLICKHOUSE2_DB=" + conn.db, "CLICKHOUSE2_LABEL=" + LABEL].join("\n") + "\n");
}

main().catch((e: unknown) => {
  say(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
