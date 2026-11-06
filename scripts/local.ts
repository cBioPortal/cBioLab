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
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applySchemaMode, schemaMode, setupDatabase } from "../lib/importer/setup.ts";
import { SCHEMA_MODES, type SchemaMode } from "../lib/importer/lab-schema.ts";
import type { WriteConn } from "../lib/importer/ch-write.ts";
import { clickhouseBinary, clickhouseConfig, ping, startClickhouse, waitFor, writeUsers, type ClickhouseServer } from "./clickhouse-local.ts";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const dataDir = path.resolve(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"));
const appPort = Number(opt("--port", "3120"));
const host = opt("--host", "127.0.0.1");
const chHttpPort = Number(opt("--clickhouse-port", "18123"));
const server: ClickhouseServer = { dir: path.join(dataDir, "clickhouse"), httpPort: chHttpPort, tcpPort: chHttpPort + 876 };
const open = !args.includes("--no-open");
const schemaArg = opt("--schema", "");
if (schemaArg && !SCHEMA_MODES.includes(schemaArg as SchemaMode)) throw new Error("--schema is one of " + SCHEMA_MODES.join(", "));
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const say = (msg: string) => console.log("[cbiolab] " + msg);

const children: ChildProcess[] = [];
function stopAll(): void {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });

async function main(): Promise<void> {
  const bin = await clickhouseBinary(path.join(dataDir, "bin"), say);
  const { config, password } = await clickhouseConfig(server);
  if (await ping(chHttpPort)) say("ClickHouse is already running on port " + chHttpPort);
  else {
    say("Starting ClickHouse on 127.0.0.1:" + chHttpPort);
    children.push(await startClickhouse(bin, config, server, false, say));
    await waitFor(() => ping(chHttpPort), "ClickHouse", 60);
  }
  const conn: WriteConn = { id: "a", url: "http://127.0.0.1:" + chHttpPort, user: "default", password, db: "cbioportal", label: "local" };
  await setupDatabase(conn, dataDir, say);
  await applySchemaMode(conn, dataDir, (schemaArg || await schemaMode(conn)) as SchemaMode, say);
  await writeUsers(server.dir, password, true);

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
