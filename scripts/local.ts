// `npm run local` — cBioLab on your own machine, with your own data.
//
// Starts a private ClickHouse (downloaded once, a pinned release), creates cBioPortal's schema in
// it with the reference genes and datahub's gene panels, starts the app against it and opens the
// import page, where a study folder, a set of files or a datahub study id becomes a study.
// Everything lives in ~/.cbiolab (CBIOLAB_DATA overrides): the ClickHouse binary, its data, the
// app's own Postgres and the unpacked datahub studies. Nothing is sent anywhere.
//
//   npm run local                          http://127.0.0.1:3120
//   npm run local -- --port 3200 --no-open
//   npm run local -- --import datahub:acc_tcga   import a study before the app starts
//   npm run local -- --schema both         where imports write (lib/importer/lab-schema.ts): legacy
//                                          (cBioPortal's tables, the default), new (the lab_ tables,
//                                          shown to the app through views), or both
//
// The app runs as `next dev` with its build output in `.next-local`, so it can share a checkout
// with a dev server that owns `.next`.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { applySchemaMode, schemaMode, setupDatabase } from "../lib/importer/setup.ts";
import { SCHEMA_MODES, type SchemaMode } from "../lib/importer/lab-schema.ts";
import type { WriteConn } from "../lib/importer/ch-write.ts";

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a ClickHouse release number, not an address
const CLICKHOUSE_VERSION = "26.8.11.7";
const RELEASE = "https://github.com/ClickHouse/ClickHouse/releases/download/v" + CLICKHOUSE_VERSION + "-lts/";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const dataDir = path.resolve(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"));
const appPort = Number(opt("--port", "3120"));
const host = opt("--host", "127.0.0.1");
const chHttpPort = Number(opt("--clickhouse-port", "18123"));
const open = !args.includes("--no-open");
const schemaArg = opt("--schema", "");
if (schemaArg && !SCHEMA_MODES.includes(schemaArg as SchemaMode)) throw new Error("--schema is one of " + SCHEMA_MODES.join(", "));
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const run = promisify(execFile);
const say = (msg: string) => console.log("[cbiolab] " + msg);

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** The pinned ClickHouse release for this OS and CPU, downloaded once. */
async function clickhouseBinary(): Promise<string> {
  const bin = path.join(dataDir, "bin", "clickhouse");
  if (await exists(bin)) return bin;
  await mkdir(path.dirname(bin), { recursive: true });
  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  let url: string;
  if (os.platform() === "darwin") url = RELEASE + (arch === "arm64" ? "clickhouse-macos-aarch64" : "clickhouse-macos");
  else if (os.platform() === "linux") url = RELEASE + "clickhouse-common-static-" + CLICKHOUSE_VERSION + "-" + arch + ".tgz";
  else throw new Error("cBioLab local mode runs on macOS and Linux; this is " + os.platform());
  say("Downloading ClickHouse " + CLICKHOUSE_VERSION + " (once; a few hundred MB)");
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("Downloading " + url + " failed (HTTP " + res.status + ")");
  const file = url.endsWith(".tgz") ? bin + ".tgz" : bin + ".download";
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(file));
  if (file.endsWith(".tgz")) {
    const tmp = path.join(dataDir, "bin", "unpack");
    await mkdir(tmp, { recursive: true });
    await run("tar", ["-xzf", file, "-C", tmp]);
    const { stdout } = await run("find", [tmp, "-type", "f", "-name", "clickhouse", "-path", "*bin*"]);
    await run("mv", [stdout.trim().split("\n")[0], bin]);
    await rm(tmp, { recursive: true, force: true });
    await rm(file, { force: true });
  } else await run("mv", [file, bin]);
  await chmod(bin, 0o755);
  // macOS quarantines downloaded binaries; this one was fetched by us, not opened from a browser
  if (os.platform() === "darwin") await run("xattr", ["-d", "com.apple.quarantine", bin]).catch(() => undefined);
  return bin;
}

/** ClickHouse's config: loopback only, one password-protected user, data under dataDir. */
async function clickhouseConfig(): Promise<{ config: string; password: string }> {
  const dir = path.join(dataDir, "clickhouse");
  await mkdir(path.join(dir, "data"), { recursive: true });
  const pwFile = path.join(dir, "password");
  let password: string;
  if (await exists(pwFile)) password = (await readFile(pwFile, "utf8")).trim();
  else { password = randomBytes(18).toString("base64url"); await writeFile(pwFile, password, { mode: 0o600 }); }
  const config = path.join(dir, "config.xml");
  await writeFile(config, `<clickhouse>
  <logger><level>warning</level><log>${dir}/server.log</log><errorlog>${dir}/server.err.log</errorlog><size>50M</size><count>2</count></logger>
  <listen_host>127.0.0.1</listen_host>
  <http_port>${chHttpPort}</http_port>
  <tcp_port>${chHttpPort + 876}</tcp_port>
  <path>${dir}/data/</path>
  <tmp_path>${dir}/data/tmp/</tmp_path>
  <user_files_path>${dir}/data/user_files/</user_files_path>
  <format_schema_path>${dir}/data/format_schemas/</format_schema_path>
  <max_server_memory_usage_to_ram_ratio>0.5</max_server_memory_usage_to_ram_ratio>
  <mark_cache_size>268435456</mark_cache_size>
  <users_config>users.xml</users_config>
  <default_profile>default</default_profile>
  <default_database>default</default_database>
</clickhouse>
`);
  await writeUsers(dir, password, await exists(path.join(dir, "data", "metadata", "cbioportal.sql")));
  return { config, password };
}

/**
 * The one user. Its default database is the study database, but only once that exists: a user
 * whose default database is missing can run nothing, not even the statement that creates it.
 * ClickHouse reloads this file by itself when it changes.
 */
async function writeUsers(dir: string, password: string, withDefaultDb: boolean): Promise<void> {
  await writeFile(path.join(dir, "users.xml"), `<clickhouse>
  <profiles><default><max_memory_usage>4000000000</max_memory_usage></default></profiles>
  <quotas><default/></quotas>
  <users>
    <default>
      <password>${password}</password>
      <networks><ip>127.0.0.1</ip><ip>::1</ip></networks>
      <profile>default</profile>
      <quota>default</quota>${withDefaultDb ? "\n      <default_database>cbioportal</default_database>" : ""}
    </default>
  </users>
</clickhouse>
`, { mode: 0o600 });
}

async function ping(): Promise<boolean> {
  try { return (await fetch("http://127.0.0.1:" + chHttpPort + "/ping")).ok; } catch { return false; }
}

async function waitFor(check: () => Promise<boolean>, what: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds * 4; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(what + " did not start within " + seconds + " s");
}

const children: ChildProcess[] = [];
function stopAll(): void {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });

async function main(): Promise<void> {
  const bin = await clickhouseBinary();
  const { config, password } = await clickhouseConfig();
  if (await ping()) say("ClickHouse is already running on port " + chHttpPort);
  else {
    say("Starting ClickHouse on 127.0.0.1:" + chHttpPort);
    const ch = spawn(bin, ["server", "--config-file=" + config], { cwd: path.dirname(config), stdio: "ignore" });
    children.push(ch);
    ch.on("exit", (code) => { if (code) say("ClickHouse exited (" + code + "); see " + path.join(dataDir, "clickhouse", "server.err.log")); });
    await waitFor(ping, "ClickHouse", 60);
  }
  const conn: WriteConn = { id: "a", url: "http://127.0.0.1:" + chHttpPort, user: "default", password, db: "cbioportal", label: "local" };
  await setupDatabase(conn, dataDir, say);
  await applySchemaMode(conn, dataDir, (schemaArg || await schemaMode(conn)) as SchemaMode, say);
  await writeUsers(path.join(dataDir, "clickhouse"), password, true);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CBIOLAB_LOCAL: "1",
    CBIOLAB_DATA: dataDir,
    CLICKHOUSE_URL: conn.url, CLICKHOUSE_USER: conn.user, CLICKHOUSE_PASSWORD: password, CLICKHOUSE_DB: conn.db,
    CLICKHOUSE_LABEL: "local",
    // an import changes the data underneath every cached answer; local data is small enough to answer fresh
    RESULT_CACHE: "off",
    PGLITE_DIR: path.join(dataDir, "pglite"),
    NEXT_DIST_DIR: ".next-local",
    ALLOWED_DEV_ORIGINS: [process.env.ALLOWED_DEV_ORIGINS, os.hostname()].filter(Boolean).join(",")
  };
  // the public warehouse and its peers are not this instance's business
  for (const k of ["CLICKHOUSE2_URL", "LOOPBACK_PEER", "PEER_MCP", "DATABASE_URL"]) env[k] = "";

  // `npm run import` in another terminal reads this to reach the same database
  await writeFile(path.join(dataDir, "local.env"), ["CBIOLAB_LOCAL", "CBIOLAB_DATA", "CLICKHOUSE_URL", "CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD", "CLICKHOUSE_DB"]
    .map((k) => k + "=" + (env[k] ?? "")).join("\n") + "\n", { mode: 0o600 });

  const pre = opt("--import", "");
  if (pre) {
    say("Importing " + pre);
    const imp = spawn(process.execPath, [path.join(repo, "scripts", "import-study.ts"), pre], { cwd: repo, env, stdio: "inherit" });
    const code = await new Promise<number | null>((r) => imp.on("exit", r));
    if (code) say("The import of " + pre + " failed; the app starts anyway");
  }

  if (host !== "127.0.0.1" && host !== "localhost")
    say("Warning: next dev's live-reload socket refuses connections when bound to " + host + ", and pages then never become " +
      "interactive. To reach cBioLab from another machine, keep the default 127.0.0.1 and forward the port (ssh -L or tailscale serve).");
  say("Starting cBioLab on " + host + ":" + appPort);
  const next = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(appPort), "-H", host],
    { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(next);
  const logFile = createWriteStream(path.join(dataDir, "app.log"), { flags: "a" });
  next.stdout?.pipe(logFile);
  next.stderr?.pipe(logFile);
  next.on("exit", (code) => { say("cBioLab stopped (" + code + "); log: " + path.join(dataDir, "app.log")); stopAll(); process.exit(code ?? 0); });
  const shown = host === "0.0.0.0" ? os.hostname() : host;
  const url = "http://" + shown + ":" + appPort + "/import";
  await waitFor(async () => { try { return (await fetch("http://127.0.0.1:" + appPort + "/api/version")).ok; } catch { return false; } }, "cBioLab", 180);
  // the first request compiles the import page; make it before the browser does
  await fetch("http://127.0.0.1:" + appPort + "/import").catch(() => undefined);
  say("Ready: " + url + "   (Ctrl-C stops cBioLab and its database)");
  if (open) {
    const opener = os.platform() === "darwin" ? "open" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  }
}

main().catch((e: unknown) => {
  console.error("[cbiolab] " + (e instanceof Error ? e.message : String(e)));
  stopAll();
  process.exit(1);
});
