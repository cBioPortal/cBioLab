// CLI demo: runs the real command lines at request time and shows exactly what came back —
// stdout, the SVG, the TSV, the PNG. Two modes: with no `?spec=`, the twelve-patient fixture;
// with one, THIS figure — the spec an oncoprint's export menu handed over, run through the same
// two command lines. Results are memoised for a few minutes so a reload does not re-spawn
// processes.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { marked } from "marked";
import { decodeSpec, isLocalSpec } from "../../../lib/lab-links.ts";
import { formatGeneList } from "../../../lib/gene-tracks.ts";

export const metadata = { title: "Oncoprint CLI — Cohort Lab" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const run = promisify(execFile);
const ROOT = process.cwd();
const FIX = "test/fixtures/oncoprint";
const PY = join(ROOT, "python", ".venv", "bin", "python");

interface Step { title: string; cmd: string; stdout: string; stderr: string; ms: number; svg?: string; png?: string; text?: string; skipped?: string }
const memo = new Map<string, { at: number; steps: Step[] }>();

async function sh(title: string, argv: string[], opts: { env?: Record<string, string>; show?: (dir: string) => Partial<Step>; dir: string; python?: boolean; cmd?: string }): Promise<Step> {
  const [bin, ...rest] = argv;
  const cmd = opts.cmd || (opts.python ? "python -m cohortlab" : "node scripts/oncoprint-cli.ts") + " " + rest.slice(opts.python ? 2 : 1).join(" ");
  if (opts.python && !existsSync(PY)) return { title, cmd, stdout: "", stderr: "", ms: 0, skipped: "python/.venv is not present on this host (uv venv python/.venv && uv pip install numpy matplotlib)" };
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await run(bin, rest, { cwd: ROOT, timeout: 240000, env: { ...process.env, ...(opts.env || {}) }, maxBuffer: 64 * 1024 * 1024 });
    return { title, cmd, stdout, stderr, ms: Date.now() - t0, ...(opts.show ? opts.show(opts.dir) : {}) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { title, cmd, stdout: err.stdout || "", stderr: (err.stderr || "") + (err.message || ""), ms: Date.now() - t0 };
  }
}

const cached = (key: string) => { const m = memo.get(key); return m && Date.now() - m.at < 5 * 60 * 1000 ? m.steps : null; };
const keep = (key: string, steps: Step[]) => {
  memo.set(key, { at: Date.now(), steps });
  for (const k of memo.keys()) { if (memo.size <= 12) break; memo.delete(k); }
  return steps;
};

async function fixtureSteps(): Promise<Step[]> {
  const hit = cached("fixture"); if (hit) return hit;
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
  return keep("fixture", out);
}

/** the argv, and the command as a reader would type it, for the step that produces the contract */
function sourceArgs(spec: Record<string, unknown>, dir: string): { argv: string[]; shown: string } {
  if (!isLocalSpec(spec)) {
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2));
    // the engine needs warehouse credentials; the child inherits the server's, a reader supplies their own
    return { argv: ["--spec", join(dir, "spec.json")], shown: "node --env-file=.env.local scripts/oncoprint-cli.ts --spec spec.json" };
  }
  const argv: string[] = [], shown: string[] = ["node scripts/oncoprint-cli.ts"];
  for (const k of ["events", "clinical", "coverage"] as const) {
    if (typeof spec[k] === "string" && (spec[k] as string).trim()) {
      writeFileSync(join(dir, k + ".tsv"), spec[k] as string);
      argv.push("--" + k, join(dir, k + ".tsv"));
      shown.push("--" + k + " " + k + ".tsv");
    }
  }
  if (Array.isArray(spec.genes) && spec.genes.length) {
    const g = formatGeneList(spec.genes as unknown[]);
    argv.push("--genes", g); shown.push("--genes '" + g + "'");
  }
  if (spec.groupBy) { argv.push("--group-by", String(spec.groupBy)); shown.push("--group-by " + spec.groupBy); }
  if (spec.sort) { const s = Array.isArray(spec.sort) ? spec.sort.join(",") : String(spec.sort); argv.push("--sort=" + s); shown.push("--sort=" + s); }
  if (spec.study) { argv.push("--study", String(spec.study)); shown.push("--study '" + spec.study + "'"); }
  if (spec.unit === "sample") { argv.push("--unit", "sample"); shown.push("--unit sample"); }
  if (spec.display && Object.keys(spec.display).length) {
    const d = JSON.stringify(spec.display);
    argv.push("--display", d); shown.push("--display '" + d + "'");
  }
  return { argv, shown: shown.join(" ") };
}

/** The handed-over figure, run for real: one warehouse hit, then the contract feeds everything else. */
async function specSteps(spec: Record<string, unknown>, key: string): Promise<Step[]> {
  const hit = cached(key); if (hit) return hit;
  const dir = mkdtempSync(join(tmpdir(), "oncoprint-spec-"));
  const node = process.execPath;
  const cli = join(ROOT, "scripts", "oncoprint-cli.ts");
  const opb1 = join(dir, "fig.opb1");
  const { argv, shown } = sourceArgs(spec, dir);
  const out: Step[] = [];
  out.push(await sh(isLocalSpec(spec) ? "1 · your tables → the binary contract" : "1 · your spec → the binary contract (the only step that touches the warehouse)",
    [node, cli, ...argv, "--out", opb1], { dir, cmd: shown + " --out fig.opb1" }));
  if (existsSync(opb1)) {
    out.push(await sh("2 · the contract → SVG, with no database and no credentials",
      [node, cli, "--contract", opb1, "--out", join(dir, "fig.svg"), "--width", "1600", "--quiet"],
      { dir, cmd: "node scripts/oncoprint-cli.ts --contract fig.opb1 --out fig.svg --width 1600",
        show: (d) => ({ svg: readFileSync(join(d, "fig.svg"), "utf8") }) }));
    out.push(await sh("3 · the contract → tabular TSV, one row per track",
      [node, cli, "--contract", opb1, "--out", join(dir, "cells.tsv"), "--quiet"],
      { dir, cmd: "node scripts/oncoprint-cli.ts --contract fig.opb1 --out cells.tsv",
        show: (d) => ({ text: readFileSync(join(d, "cells.tsv"), "utf8") }) }));
    out.push(await sh("4 · Python: the same contract, drawn with numpy + matplotlib",
      [PY, "-m", "cohortlab", "--contract", opb1, "--out", join(dir, "fig.png"), "--width", "1400"],
      { dir, python: true, cmd: "python -m cohortlab --contract fig.opb1 --out fig.png --width 1400",
        env: { PYTHONPATH: join(ROOT, "python"), MPLCONFIGDIR: join(dir, "mpl") },
        show: (d) => ({ png: readFileSync(join(d, "fig.png")).toString("base64") }) }));
  }
  return keep(key, out);
}

function Block({ s }: { s: Step }) {
  return (
    <div className="card">
      {s.title && <h2 style={{ marginTop: 0 }}>{s.title}</h2>}
      <pre style={{ margin: 0, background: "var(--ink)", color: "#e4eaee", padding: "0.7rem 0.9rem", borderRadius: 6, whiteSpace: "pre-wrap" }}>
        <span style={{ color: "#7fd3da" }}>$ </span>{s.cmd}{"\n"}
        {s.skipped ? <span style={{ color: "#e0a35c" }}>(skipped: {s.skipped})</span> : <>{s.stdout}{s.stderr && <span style={{ color: "#f2b8b5" }}>{s.stderr}</span>}</>}
      </pre>
      {!s.skipped && <p className="meta" style={{ margin: "0.3rem 0 0" }}>{s.ms.toLocaleString()} ms wall, including process start-up</p>}
      {s.svg && <div style={{ overflowX: "auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 8, marginTop: "0.6rem" }} dangerouslySetInnerHTML={{ __html: s.svg }} />}
      {s.png && <img alt="oncoprint rendered by the Python package" src={"data:image/png;base64," + s.png} style={{ maxWidth: "100%", border: "1px solid var(--line)", borderRadius: 8, marginTop: "0.6rem", background: "#fff" }} />}
      {s.text && <pre style={{ marginTop: "0.6rem", maxHeight: 260, overflow: "auto" }}>{s.text.split("\n").map((l) => l.length > 180 ? l.slice(0, 180) + " …" : l).join("\n")}</pre>}
    </div>
  );
}

export default async function CliPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const encoded = typeof sp.spec === "string" ? sp.spec : null;
  const cut = typeof sp.cut === "string" ? sp.cut : null;
  let spec: Record<string, unknown> | null = null, error: string | null = null;
  if (encoded) {
    try { spec = decodeSpec(encoded) as Record<string, unknown>; }
    catch (e) { error = "could not read ?spec=: " + String((e as Error).message || e); }
  }
  const list = spec ? await specSteps(spec, encoded!) : await fixtureSteps();
  const events = readFileSync(join(ROOT, FIX, "events.tsv"), "utf8");
  // the reference is the source: the CLI's own usage header, and the package's README
  const usage = readFileSync(join(ROOT, "scripts", "oncoprint-cli.ts"), "utf8")
    .split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n").trim();
  const readme = await marked.parse(readFileSync(join(ROOT, "python", "README.md"), "utf8"));
  const link = (href: string) => href + (encoded ? "?spec=" + encoded + (cut ? "&cut=" + encodeURIComponent(cut) : "") : "");
  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">{spec ? "your oncoprint, on the command line" : "oncoprint from the command line — Node and Python, one contract"}</span>
        <span className="spacer" />
        <a href="/oncoprint-lab" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>interactive lab →</a>
        <a href="/oncoprint-lab/import" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>pasted data →</a>
        <a href={link("/oncoprint-lab/python")} style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>python notebook →</a>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {spec ? (
          <>
            <p className="meta" style={{ maxWidth: "78ch" }}>
              This page received a figure&apos;s <strong>spec</strong>, not its data — the link is the definition, and the commands
              below were executed on this server when you loaded the page. Save the spec, and the same two command lines
              reproduce the figure anywhere: <code>node scripts/oncoprint-cli.ts</code> and <code>python -m cohortlab</code>,
              both reading the shared <code>lib/oncoprint-assemble</code> contract.
            </p>
            {cut && <div className="error" style={{ background: "var(--warn-bg, #fff6e5)" }}>{cut} — the figures below are of the cut, not of the whole cohort.</div>}
            <details className="card" style={{ marginBottom: "0.8rem" }}>
              <summary className="meta">spec.json — save this next to the commands below</summary>
              <pre style={{ maxHeight: 320, overflow: "auto" }}>{JSON.stringify(spec, null, 2)}</pre>
              <a className="linklike" download="spec.json"
                href={"data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(spec, null, 2))}>download spec.json</a>
            </details>
            {list.map((s, i) => <Block key={i} s={s} />)}
            {!isLocalSpec(spec) && (
              <div className="card">
                <h2>Without this repo <span className="plain">— the Python package can ask a running instance for the contract</span></h2>
                <pre>{"pip install cohortlab   # or: pip install -e python/\npython -m cohortlab --spec spec.json --server " + (process.env.APP_BASE_URL || "http://localhost:3107") + " --out fig.png"}</pre>
                <p className="meta">The server compiles the spec and answers with OPB1 bytes; every drawing decision then happens
                  locally, from <code>style.json</code>, which is generated from <code>lib/oncoprint-style.ts</code>.</p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="meta" style={{ maxWidth: "70ch" }}>
              Every block below was executed on this server when you loaded the page; nothing is a screenshot. The input is a
              twelve-patient fixture in the portal&apos;s Oncoprinter shape (<code>test/fixtures/oncoprint/</code>). No database is involved:
              the engine&apos;s data logic runs as <code>assembleContract</code> over the local tables, and the Python package runs its own
              port of the same function — a test asserts both produce the identical contract. To see your own figure here, open any
              oncoprint&apos;s <strong>export</strong> menu and choose <em>the command line</em>.
            </p>
            <details style={{ marginBottom: "0.8rem" }}><summary className="meta">events.tsv — the input</summary><pre>{events}</pre></details>
            {list.map((s, i) => <Block key={i} s={s} />)}
          </>
        )}
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
