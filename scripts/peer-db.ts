// `npm run peer-db` — the second database the tests read (connection b, CLICKHOUSE2_*): a private
// ClickHouse holding the committed fixture study (test/fixtures/peer-study) and the OncoKB calls
// for its variants (test/fixtures/peer-oncokb.tsv, by tumour type peer-oncokb-tumor-type.tsv, and for
// its structural variants by gene pair and tumour type peer-oncokb-sv.tsv) and Genome Nexus's Cancer
// Hotspots for its variants (test/fixtures/peer-hotspots.tsv).
// scripts/gate.sh starts it and points the gate's checks at it, so no test depends on a second
// warehouse's contents.
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
// A tumour-type or structural-variant row whose oncokb_version column is filled is stored under that
// version alone (a release other than the pin, which the mutation and SV tables must not read).
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
const ONCOKB_TUMOR_TYPE = path.join(repo, "test", "fixtures", "peer-oncokb-tumor-type.tsv");
const ONCOKB_SV = path.join(repo, "test", "fixtures", "peer-oncokb-sv.tsv");
const HOTSPOTS = path.join(repo, "test", "fixtures", "peer-hotspots.tsv");
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

async function readTsv(file: string): Promise<Record<string, string>[]> {
  const [head, ...lines] = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim());
  const cols = head.split("\t");
  return lines.map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split("\t")[i] ?? ""])));
}

async function seedOncokb(conn: WriteConn, pin: string | null): Promise<void> {
  const rows = await readTsv(ONCOKB);
  const versions = [...new Set([pin, "fixture"].filter((v): v is string => !!v))];
  const db = { ...conn, db: "annotation" };
  for (const v of versions) {
    const n = await query<{ n: number }>(db, "SELECT count() AS n FROM oncokb FINAL WHERE oncokb_version = " + sq(v));
    if (Number(n[0]?.n) === rows.length) continue;
    await exec(db, "ALTER TABLE oncokb DELETE WHERE oncokb_version = " + sq(v));
    await insertAll(db, "oncokb", rows.map((r) => ({ ...r, oncokb_version: v, api_version: "fixture" })));
    say("OncoKB calls for the fixture's variants stored under " + v);
  }
  if (!pin) say("no primary warehouse to read the app's OncoKB pin from; its calls are stored under \"fixture\" only");
}

/** OncoKB's calls by tumour type: rows with no oncokb_version under the pin and "fixture", the others under theirs. */
async function seedOncokbTumorType(conn: WriteConn, pin: string | null): Promise<void> {
  const rows = await readTsv(ONCOKB_TUMOR_TYPE);
  const own = (v: string) => rows.filter((r) => r.oncokb_version === v || (!r.oncokb_version && (v === pin || v === "fixture")));
  const versions = [...new Set([pin, "fixture", ...rows.map((r) => r.oncokb_version)].filter((v): v is string => !!v))];
  const db = { ...conn, db: "annotation" };
  for (const v of versions) {
    const want = own(v);
    const n = await query<{ n: number }>(db, "SELECT count() AS n FROM oncokb_tumor_type FINAL WHERE oncokb_version = " + sq(v));
    if (Number(n[0]?.n) === want.length) continue;
    await exec(db, "ALTER TABLE oncokb_tumor_type DELETE WHERE oncokb_version = " + sq(v));
    await insertAll(db, "oncokb_tumor_type", want.map((r) => ({ ...r, oncokb_version: v, api_version: "fixture" })));
    say("OncoKB calls by tumour type for the fixture's variants stored under " + v);
  }
}

/** OncoKB's calls for structural variants by gene pair and tumour type, versioned as seedOncokbTumorType's. */
async function seedOncokbSv(conn: WriteConn, pin: string | null): Promise<void> {
  const rows = await readTsv(ONCOKB_SV);
  const own = (v: string) => rows.filter((r) => r.oncokb_version === v || (!r.oncokb_version && (v === pin || v === "fixture")));
  const versions = [...new Set([pin, "fixture", ...rows.map((r) => r.oncokb_version)].filter((v): v is string => !!v))];
  const db = { ...conn, db: "annotation" };
  for (const v of versions) {
    const want = own(v);
    const n = await query<{ n: number }>(db, "SELECT count() AS n FROM oncokb_sv FINAL WHERE oncokb_version = " + sq(v));
    if (Number(n[0]?.n) === want.length) continue;
    await exec(db, "ALTER TABLE oncokb_sv DELETE WHERE oncokb_version = " + sq(v));
    await insertAll(db, "oncokb_sv", want.map((r) => ({ ...r, oncokb_version: v, api_version: "fixture" })));
    say("OncoKB calls for the fixture's structural variants stored under " + v);
  }
}

/** The GRCh37 Genome Nexus release the app reads: GENOME_NEXUS_PIN, else the primary warehouse's, if it has one. */
async function appVariantPin(): Promise<string | null> {
  if (process.env.GENOME_NEXUS_PIN) return process.env.GENOME_NEXUS_PIN;
  if (!process.env.CLICKHOUSE_URL) return null;
  const { variantPins } = await import("../lib/variant-annotation.ts");
  return (await variantPins()).hg19;
}

/**
 * Cancer Hotspots for the fixture's variants (the study is GRCh37): one `annotation.variant` row per
 * variant of the TSV, its `hotspots` list as Genome Nexus's record holds it, and the rest of the record
 * from its `annotation` column when filled (JSON: the `canonical` transcript per gene and the
 * `transcripts` with their `exon`, which the mutation table's Exon column reads), under the release the
 * app reads and under "fixture", with a sync_run row so the study counts as synced. Replaced whole
 * when the TSV changes.
 */
async function seedHotspots(conn: WriteConn): Promise<void> {
  if (!(await exists(HOTSPOTS))) return;
  const [head, ...lines] = (await readFile(HOTSPOTS, "utf8")).split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const cols = head.split("\t");
  const rows = lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
  const pin = await appVariantPin();
  const versions = [...new Set([pin, "fixture"].filter((v): v is string => !!v))];
  const db = { ...conn, db: "annotation" };
  const digest = createHash("sha256").update(await readFile(HOTSPOTS)).digest("hex").slice(0, 16);
  for (const v of versions) {
    const n = await query<{ n: number }>(db, "SELECT count() AS n FROM sync_run WHERE source = 'genome_nexus' AND version = " + sq(v) + " AND study = " + sq(STUDY) + " AND note = " + sq("fixture " + digest));
    if (Number(n[0]?.n) > 0) continue;
    await exec(db, "ALTER TABLE variant DELETE WHERE source = 'genome_nexus' AND version = " + sq(v) + " SETTINGS mutations_sync = 1");
    await insertAll(db, "variant", rows.map((r) => ({
      source: "genome_nexus", version: v, chr: r.chr, start_position: Number(r.start_position), end_position: Number(r.end_position),
      reference_allele: r.reference_allele, variant_allele: r.variant_allele,
      data: JSON.stringify({ ...JSON.parse(r.annotation || "{}"), hotspots: JSON.parse(r.hotspots || "[]") })
    })));
    await insertAll(db, "sync_run", [{ run_id: "fixture_" + digest, started_at: new Date().toISOString().replace("T", " ").slice(0, 19), source: "genome_nexus",
      version: v, study: STUDY, variants_total: rows.length, already_stored: 0, annotated_new: rows.length, failed: 0, note: "fixture " + digest }]);
    say("Cancer Hotspots for the fixture's variants stored under Genome Nexus " + v);
  }
  if (!pin) say("no primary warehouse to read the app's Genome Nexus pin from; its hotspots are stored under \"fixture\" only");
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
  const pin = await appPin();
  await seedOncokb(conn, pin);
  await seedOncokbTumorType(conn, pin);
  await seedOncokbSv(conn, pin);
  await seedHotspots(conn);
  process.stdout.write(["CLICKHOUSE2_URL=" + conn.url, "CLICKHOUSE2_USER=" + conn.user, "CLICKHOUSE2_PASSWORD=" + password,
    "CLICKHOUSE2_DB=" + conn.db, "CLICKHOUSE2_LABEL=" + LABEL].join("\n") + "\n");
}

main().catch((e: unknown) => {
  say(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
