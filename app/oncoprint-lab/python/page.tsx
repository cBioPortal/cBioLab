// Python notebook demo: Pyodide in the browser, our cohortlab package loaded from this
// repo's source files, the same binary contract endpoint the interactive lab uses.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import PyNotebook from "./PyNotebook.tsx";

export const metadata = { title: "Oncoprint in Python — Cohort Lab" };
export const dynamic = "force-dynamic";

export default function PythonPage() {
  const root = process.cwd();
  const pkgDir = join(root, "python", "cohortlab");
  const files: Record<string, string> = {};
  for (const f of readdirSync(pkgDir)) if (f.endsWith(".py")) files["cohortlab/" + f] = readFileSync(join(pkgDir, f), "utf8");
  const fix = join(root, "test", "fixtures", "oncoprint");
  const fixtures = { events: readFileSync(join(fix, "events.tsv"), "utf8"), clinical: readFileSync(join(fix, "clinical.tsv"), "utf8"), coverage: readFileSync(join(fix, "coverage.tsv"), "utf8") };
  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">oncoprint in Python — the package running in your browser via Pyodide</span>
        <span className="spacer" />
        <a href="/oncoprint-lab" style={{ color: "var(--accent-ink)", fontSize: "0.8rem", marginRight: "1rem" }}>interactive lab →</a>
        <a href="/oncoprint-lab/cli" style={{ color: "var(--accent-ink)", fontSize: "0.8rem" }}>command line →</a>
      </header>
      <main>
        <PyNotebook files={files} fixtures={fixtures} />
      </main>
    </>
  );
}
