// Import jobs for the import page. Each import runs `scripts/import-study.ts --json` in its own
// process (its own memory, so a large MAF never shares the web server's heap) and its progress
// lines are kept here for the page to poll. One import at a time: every import rebuilds the
// derived tables of the whole database, so two at once would rebuild over each other.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ImportResult } from "./import-study.ts";

export interface JobEvent { step: string; file?: string; at: number }

export interface Job {
  id: string;
  /** what was imported: a folder, an upload or datahub:<id> */
  source: string;
  state: "running" | "done" | "failed";
  events: JobEvent[];
  result?: ImportResult;
  deleted?: boolean;
  error?: string;
  startedAt: number;
}

// on globalThis so `next dev` reloading this module does not forget a running import
const g = globalThis as typeof globalThis & { cbiolabJobs?: { jobs: Map<string, Job>; running: Job | null } };
const state = (g.cbiolabJobs ??= { jobs: new Map(), running: null });
const jobs = state.jobs;

export function dataDir(): string {
  return process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab");
}

export function job(id: string): Job | undefined {
  return jobs.get(id);
}

export function runningJob(): Job | null {
  return state.running;
}

/** Starts `scripts/import-study.ts` with these arguments; throws if an import is already running. */
export function startJob(source: string, args: string[]): Job {
  const running = state.running;
  if (running) throw new Error("An import is already running (" + running.source + "); wait for it to finish");
  const j: Job = { id: randomUUID(), source, state: "running", events: [], startedAt: Date.now() };
  jobs.set(j.id, j);
  state.running = j;
  const child = spawn(process.execPath, ["--max-old-space-size=4096", path.join(process.cwd(), "scripts", "import-study.ts"), ...args, "--json"],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const stderr: string[] = [];
  child.stderr.on("data", (d: Buffer) => { stderr.push(d.toString()); if (stderr.length > 50) stderr.shift(); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let o: Record<string, unknown>;
    try { o = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (o.type === "progress") j.events.push({ step: String(o.step), file: o.file ? String(o.file) : undefined, at: Date.now() });
    else if (o.type === "result") { j.result = o.result as ImportResult | undefined; j.deleted = o.deleted as boolean | undefined; }
    else if (o.type === "error") j.error = String(o.message);
  });
  child.on("exit", (code) => {
    j.state = code === 0 && !j.error ? "done" : "failed";
    if (j.state === "failed" && !j.error) j.error = stderr.join("").trim().split("\n").slice(-5).join("\n") || "the import stopped (exit " + code + ")";
    state.running = null;
  });
  return j;
}
