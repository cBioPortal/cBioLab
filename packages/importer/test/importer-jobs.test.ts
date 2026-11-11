// The import page's jobs (lib/importer/jobs.ts): each import runs `scripts/import-study.ts --json`
// in its own process, its progress lines are kept for the page to poll, and only one runs at a time.
// The script run is a stand-in written here (the module runs scripts/import-study.ts under the
// working directory, so the test works in a temp folder): it answers with the JSON lines the real
// script prints, chosen by its first argument.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir, job, runningJob, startJob, type Job } from "../src/jobs.ts";

const STAND_IN = `
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const mode = args[0];
if (!args.includes("--json")) { process.stderr.write("not --json\\n"); process.exit(9); }
if (mode === "ok") {
  out({ type: "progress", step: "Reading the study folder" });
  process.stdout.write("not json, ignored\\n");
  out({ type: "progress", step: "Importing", file: "data_mutations.txt" });
  out({ type: "result", result: { studyId: "s1", args } });
} else if (mode === "delete") {
  out({ type: "result", deleted: true, studyId: "s1" });
} else if (mode === "error") {
  out({ type: "error", message: "meta_study.txt is missing" });
  process.exit(1);
} else if (mode === "error-exit0") {
  out({ type: "error", message: "reported, but exited 0" });
} else if (mode === "crash") {
  for (let i = 0; i < 60; i++) process.stderr.write("line " + i + "\\n");
  process.exit(3);
} else if (mode === "silent") {
  process.exit(2);
} else if (mode === "wait") {
  setTimeout(() => out({ type: "result", result: { studyId: "w" } }), 300);
}
`;

const cwd = process.cwd();
before(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "importer-jobs-"));
  // where an app that has the package installed finds the command: a link to the package, as npm workspaces make
  mkdirSync(path.join(dir, "pkg", "bin"), { recursive: true });
  writeFileSync(path.join(dir, "pkg", "bin", "import-study.ts"), STAND_IN);
  mkdirSync(path.join(dir, "node_modules", "@cbiolab"), { recursive: true });
  symlinkSync(path.join(dir, "pkg"), path.join(dir, "node_modules", "@cbiolab", "importer"));
  process.chdir(dir);
});
after(() => { process.chdir(cwd); });

/** wait until `j` has stopped running */
async function finished(j: Job): Promise<Job> {
  for (let i = 0; i < 400 && j.state === "running"; i++) await new Promise((r) => setTimeout(r, 25));
  assert.notEqual(j.state, "running", "the job never finished");
  return j;
}

test("the data folder is CBIOLAB_DATA, else ~/.cbiolab", () => {
  const was = process.env.CBIOLAB_DATA;
  try {
    process.env.CBIOLAB_DATA = "/data/cbiolab";
    assert.equal(dataDir(), "/data/cbiolab");
    delete process.env.CBIOLAB_DATA;
    assert.equal(dataDir(), path.join(os.homedir(), ".cbiolab"));
  } finally { if (was === undefined) delete process.env.CBIOLAB_DATA; else process.env.CBIOLAB_DATA = was; }
});

test("a job is running until its process exits, keeps its progress, and ends done with the result", async () => {
  assert.equal(runningJob(), null);
  const j = startJob("datahub:s1", ["ok", "--id", "s1"]);
  assert.equal(j.state, "running");
  assert.equal(j.source, "datahub:s1");
  assert.equal(runningJob(), j);
  assert.equal(job(j.id), j, "found by its id while running");
  await finished(j);
  assert.equal(j.state, "done");
  assert.equal(runningJob(), null, "nothing runs once it exits");
  assert.equal(job(j.id), j, "and it is still found afterwards, for the page to read");
  assert.deepEqual(j.events.map((e) => [e.step, e.file]), [["Reading the study folder", undefined], ["Importing", "data_mutations.txt"]]);
  assert.ok(j.events.every((e) => typeof e.at === "number"));
  assert.deepEqual(j.result, { studyId: "s1", args: ["ok", "--id", "s1", "--json"] }, "the script is run with --json last");
  assert.equal(j.error, undefined);
});

test("only one import at a time: a second is refused, naming the one running", async () => {
  const j = startJob("my folder", ["wait"]);
  assert.throws(() => startJob("another", ["ok"]), /An import is already running \(my folder\); wait for it to finish/);
  await finished(j);
  assert.equal(j.state, "done");
  const k = startJob("another", ["ok"]);
  await finished(k);
  assert.notEqual(k.id, j.id);
});

test("a delete's result says whether the study was removed", async () => {
  const j = await finished(startJob("delete s1", ["delete"]));
  assert.equal(j.state, "done");
  assert.equal(j.deleted, true);
});

test("an error the script reports fails the job with its message, even on a clean exit", async () => {
  const j = await finished(startJob("x", ["error"]));
  assert.equal(j.state, "failed");
  assert.equal(j.error, "meta_study.txt is missing");
  const k = await finished(startJob("x", ["error-exit0"]));
  assert.equal(k.state, "failed");
  assert.equal(k.error, "reported, but exited 0");
});

test("a process that dies without a message fails with the end of its stderr, else its exit code", async () => {
  const j = await finished(startJob("x", ["crash"]));
  assert.equal(j.state, "failed");
  assert.equal(j.error, ["line 55", "line 56", "line 57", "line 58", "line 59"].join("\n"));
  const k = await finished(startJob("x", ["silent"]));
  assert.equal(k.state, "failed");
  assert.equal(k.error, "the import stopped (exit 2)");
  assert.equal(runningJob(), null);
});

test("an unknown job id is not found", () => {
  assert.equal(job("no-such-job"), undefined);
});
