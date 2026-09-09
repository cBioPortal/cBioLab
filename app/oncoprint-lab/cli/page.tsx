// CLI demo: runs the real command lines against the fixture at request time and shows
// exactly what came back — stdout, the SVG, the TSV, the PNG. Results are memoised for
// a few minutes so a page reload does not re-spawn four processes.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { marked } from "marked";

export const metadata = { title: "Oncoprint CLI — Cohort Lab" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const run = promisify(execFile);
const ROOT = process.cwd();
const FIX = "test/fixtures/oncoprint";
const PY = join(ROOT, "python", ".venv", "bin", "python");

interface Step { title: string; cmd: string; stdout: string; stderr: string; ms: number; svg?: string; png?: string; text?: string; skipped?: string }
let memo: { at: number; steps: Step[] } | null = null;

async function sh(title: string, argv: string[], opts: { env?: Record<string, string>; show?: (dir: string) => Partial<Step>; dir: string; python?: boolean }): Promise<Step> {
  const [bin, ...rest] = argv;
  const cmd = (opts.python ? "python -m cohortlab" : "node scripts/oncoprint-cli.ts") + " " + rest.slice(opts.python ? 2 : 1).join(" ");
  if (opts.python && !existsSync(PY)) return { title, cmd, stdout: "", stderr: "", ms: 0, skipped: "python/.venv is not present on this host (uv venv python/.venv && uv pip install numpy matplotlib)" };
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await run(bin, rest, { cwd: ROOT, timeout: 90000, env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 16 * 1024 * 1024 });
    return { title, cmd, stdout, stderr, ms: Date.now() - t0, ...(opts.show ? opts.show(opts.dir) : {}) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { title, cmd, stdout: err.stdout || "", stderr: (err.stderr || "") + (err.message || ""), ms: Date.now() - t0 };
  }
}

async function steps(): Promise<Step[]> {
  if (memo && Date.now() - memo.at < 5 * 60 * 1000) return memo.steps;
  const dir = mkdtempSync(join(tmpdir(), "oncoprint-cli-"));
  const node = process.execPath;
  const cli = join(ROOT, "scripts", "oncoprint-cli.ts");
  const common = ["--events", FIX + "/events.tsv", "--clinical", FIX + "/clinical.tsv", "--coverage", FIX + "/coverage.tsv"];
  const out: Step[] = [];
  out.push(await sh("1 · local tables → SVG (grouped by cancer type, sorted by stage)",
    [node, cli, ...common, "--group-by", "CANCER_TYPE", "--sort=STAGE", "--out", join(dir, "fig.svg")],
    { dir, show: (d) => ({ svg: readFileSync(join(d, "fig.svg"), "utf8") }) }));
  out.push(await sh("2 · the same tables → the binary contract, then contract → tabular TSV",
    [node, cli, ...common, "--group-by", "CANCER_TYPE", "--sort=STAGE", "--out", join(dir, "fig.opb1"), "--quiet"], { dir }));
  out.push(await sh("", [node, cli, "--contract", join(dir, "fig.opb1"), "--out", join(dir, "cells.tsv")],
    { dir, show: (d) => ({ text: readFileSync(join(d, "cells.tsv"), "utf8") }) }));
  out.push(await sh("3 · Python: the same contract file, rendered with numpy + matplotlib",
    [PY, "-m", "cohortlab", "--contract", join(dir, "fig.opb1"), "--out", join(dir, "fig.png"), "--width", "1100"],
    { dir, python: true, env: { PYTHONPATH: join(ROOT, "python"), MPLCONFIGDIR: join(dir, "mpl") }, show: (d) => ({ png: readFileSync(join(d, "fig.png")).toString("base64") }) }));
  out.push(await sh("4 · Python: local tables directly, and the frequencies as data",
    [PY, "-c", [
      "import sys; sys.path.insert(0, 'python')",
      "from cohortlab import Oncoprint",
      `op = Oncoprint.from_tables('${FIX}/events.tsv', '${FIX}/clinical.tsv', '${FIX}/coverage.tsv', group_by='CANCER_TYPE', sort='STAGE')`,
      "print(op)",
      "for r in op.frequencies(): print(r)",
      "print(op.tracks['TP53'])"
    ].join("\n")],
    { dir, python: true, env: { PYTHONPATH: join(ROOT, "python") } }));
  out[out.length - 1].cmd = "python -c \"from cohortlab import Oncoprint; op = Oncoprint.from_tables('events.tsv', 'clinical.tsv', 'coverage.tsv', group_by='CANCER_TYPE', sort='STAGE'); print(op); print(op.frequencies()); print(op.tracks['TP53'])\"";
  memo = { at: Date.now(), steps: out };
  return out;
}

export default async function CliPage() {
  const list = await steps();
  const events = readFileSync(join(ROOT, FIX, "events.tsv"), "utf8");
  // the reference is the source: the CLI's own usage header, and the package's README
  const usage = readFileSync(join(ROOT, "scripts", "oncoprint-cli.ts"), "utf8")
    .split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n").trim();
  const readme = await marked.parse(readFileSync(join(ROOT, "python", "README.md"), "utf8"));
  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">oncoprint from the command line — Node and Python, one contract</span>
        <span className="spacer" />
        <a href="/oncoprint-lab" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>interactive lab →</a>
        <a href="/oncoprint-lab/import" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>pasted data →</a>
        <a href="/oncoprint-lab/python" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>python notebook →</a>
      </header>
      <main>
        <p className="meta" style={{ maxWidth: "70ch" }}>
          Every block below was executed on this server when you loaded the page; nothing is a screenshot. The input is a
          twelve-patient fixture in the portal&apos;s Oncoprinter shape (<code>test/fixtures/oncoprint/</code>). No database is involved:
          the engine&apos;s data logic runs as <code>assembleContract</code> over the local tables, and the Python package runs its own
          port of the same function — a test asserts both produce the identical contract.
        </p>
        <details style={{ marginBottom: "0.8rem" }}><summary className="meta">events.tsv — the input</summary><pre>{events}</pre></details>
        {list.map((s, i) => (
          <div className="card" key={i}>
            {s.title && <h2 style={{ marginTop: 0 }}>{s.title}</h2>}
            <pre style={{ margin: 0, background: "var(--ink)", color: "#e4eaee", padding: "0.7rem 0.9rem", borderRadius: 6, whiteSpace: "pre-wrap" }}>
              <span style={{ color: "#7fd3da" }}>$ </span>{s.cmd}{"\n"}
              {s.skipped ? <span style={{ color: "#e0a35c" }}>(skipped: {s.skipped})</span> : <>{s.stdout}{s.stderr && <span style={{ color: "#f2b8b5" }}>{s.stderr}</span>}</>}
            </pre>
            {!s.skipped && <p className="meta" style={{ margin: "0.3rem 0 0" }}>{s.ms} ms wall, including process start-up</p>}
            {s.svg && <div style={{ overflowX: "auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, marginTop: "0.6rem" }} dangerouslySetInnerHTML={{ __html: s.svg }} />}
            {s.png && <img alt="oncoprint rendered by the Python package" src={"data:image/png;base64," + s.png} style={{ maxWidth: "100%", border: "1px solid var(--line)", borderRadius: 8, marginTop: "0.6rem", background: "#fff" }} />}
            {s.text && <pre style={{ marginTop: "0.6rem", maxHeight: 260, overflow: "auto" }}>{s.text.split("\n").map((l) => l.length > 180 ? l.slice(0, 180) + " …" : l).join("\n")}</pre>}
          </div>
        ))}
        <div className="card">
          <h2>Reference <span className="plain">— read from the code, not written beside it</span></h2>
          <p className="meta">The node CLI&apos;s usage is its own header comment; the Python section is the package&apos;s README,
            which ships in the wheel. Neither can drift from what actually runs.</p>
          <h3 style={{ fontSize: "var(--t-base)", margin: "0.8rem 0 0.3rem" }}>node</h3>
          <pre>{usage}</pre>
          <h3 style={{ fontSize: "var(--t-base)", margin: "1rem 0 0.3rem" }}>python</h3>
          <div className="readme" dangerouslySetInnerHTML={{ __html: readme }} />
        </div>
      </main>
    </>
  );
}
