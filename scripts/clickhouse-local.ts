// A private ClickHouse server on this machine: the pinned release (downloaded once), its config
// (loopback only, one password-protected user, data in a folder of its own) and the start-up wait.
// `npm run local` (scripts/local.ts) runs one for the app's own data; `npm run peer-db`
// (scripts/peer-db.ts) runs one holding the committed fixture study the tests use as connection b.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a ClickHouse release number, not an address
export const CLICKHOUSE_VERSION = "26.8.11.7";
const RELEASE = "https://github.com/ClickHouse/ClickHouse/releases/download/v" + CLICKHOUSE_VERSION + "-lts/";

const run = promisify(execFile);

export async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** The pinned ClickHouse release for this OS and CPU, downloaded once into `binDir`. */
export async function clickhouseBinary(binDir: string, say: (msg: string) => void): Promise<string> {
  const bin = path.join(binDir, "clickhouse");
  if (await exists(bin)) return bin;
  await mkdir(binDir, { recursive: true });
  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  let url: string;
  if (os.platform() === "darwin") url = RELEASE + (arch === "arm64" ? "clickhouse-macos-aarch64" : "clickhouse-macos");
  else if (os.platform() === "linux") url = RELEASE + "clickhouse-common-static-" + CLICKHOUSE_VERSION + "-" + arch + ".tgz";
  else throw new Error("cBioLab's private ClickHouse runs on macOS and Linux; this is " + os.platform());
  say("Downloading ClickHouse " + CLICKHOUSE_VERSION + " (once; a few hundred MB)");
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("Downloading " + url + " failed (HTTP " + res.status + ")");
  const file = url.endsWith(".tgz") ? bin + ".tgz" : bin + ".download";
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(file));
  if (file.endsWith(".tgz")) {
    const tmp = path.join(binDir, "unpack");
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

export interface ClickhouseServer {
  /** the server's folder: config, password, logs and data */
  dir: string;
  httpPort: number;
  tcpPort: number;
}

/** ClickHouse's config: loopback only, one password-protected user, data under `s.dir`. */
export async function clickhouseConfig(s: ClickhouseServer): Promise<{ config: string; password: string }> {
  const { dir } = s;
  await mkdir(path.join(dir, "data"), { recursive: true });
  const pwFile = path.join(dir, "password");
  let password: string;
  if (await exists(pwFile)) password = (await readFile(pwFile, "utf8")).trim();
  else { password = randomBytes(18).toString("base64url"); await writeFile(pwFile, password, { mode: 0o600 }); }
  const config = path.join(dir, "config.xml");
  await writeFile(config, `<clickhouse>
  <logger><level>warning</level><log>${dir}/server.log</log><errorlog>${dir}/server.err.log</errorlog><size>50M</size><count>2</count></logger>
  <listen_host>127.0.0.1</listen_host>
  <http_port>${s.httpPort}</http_port>
  <tcp_port>${s.tcpPort}</tcp_port>
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
export async function writeUsers(dir: string, password: string, withDefaultDb: boolean): Promise<void> {
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

export async function ping(httpPort: number): Promise<boolean> {
  try { return (await fetch("http://127.0.0.1:" + httpPort + "/ping")).ok; } catch { return false; }
}

export async function waitFor(check: () => Promise<boolean>, what: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds * 4; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(what + " did not start within " + seconds + " s");
}

/**
 * Starts the server at `config`; the caller waits for it (waitFor, ping). `detached`: it outlives
 * this process, and its pid is written to `<dir>/pid` for whoever stops it.
 */
export async function startClickhouse(bin: string, config: string, s: ClickhouseServer, detached: boolean, say: (msg: string) => void): Promise<ChildProcess> {
  const ch = spawn(bin, ["server", "--config-file=" + config], { cwd: path.dirname(config), stdio: "ignore", detached });
  ch.on("exit", (code) => { if (code) say("ClickHouse exited (" + code + "); see " + path.join(s.dir, "server.err.log")); });
  if (detached) { ch.unref(); await writeFile(path.join(s.dir, "pid"), String(ch.pid)); }
  return ch;
}
