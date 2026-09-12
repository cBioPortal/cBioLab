// Python notebook demo: Pyodide in the browser, our cohortlab package loaded from this
// repo's source files, the same binary contract endpoint the interactive lab uses.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import PyNotebook from "./PyNotebook.tsx";
import { decodeSpec, jupyterLiteUrl } from "../../../lib/lab-links.ts";

export const metadata = { title: "Oncoprint in Python — Cohort Lab" };
export const dynamic = "force-dynamic";

export default async function PythonPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const encoded = typeof sp.spec === "string" ? sp.spec : null;
  const cut = typeof sp.cut === "string" ? sp.cut : null;
  let spec: Record<string, unknown> | null = null, error: string | null = null;
  if (encoded) {
    try { spec = decodeSpec(encoded) as Record<string, unknown>; }
    catch (e) { error = "could not read ?spec=: " + String((e as Error).message || e); }
  }
  const root = process.cwd();
  const pkgDir = join(root, "python", "cohortlab");
  const files: Record<string, string> = {};
  for (const f of readdirSync(pkgDir)) if (f.endsWith(".py") || f === "style.json") files["cohortlab/" + f] = readFileSync(join(pkgDir, f), "utf8");
  const fix = join(root, "test", "fixtures", "oncoprint");
  const fixtures = { events: readFileSync(join(fix, "events.tsv"), "utf8"), clinical: readFileSync(join(fix, "clinical.tsv"), "utf8"), coverage: readFileSync(join(fix, "coverage.tsv"), "utf8") };
  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">{spec ? "your oncoprint in Python" : "oncoprint in Python"} — the package running in your browser via Pyodide</span>
        <span className="spacer" />
        <a href="/oncoprint-lab" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>interactive lab →</a>
        <a href="/oncoprint-lab/import" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>pasted data →</a>
        <a href={"/oncoprint-lab/cli" + (encoded ? "?spec=" + encoded + (cut ? "&cut=" + encodeURIComponent(cut) : "") : "")} style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>command line →</a>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {encoded && (() => {
          // The same figure as a real notebook. The download works anywhere; JupyterLite is
          // jupyter.org running JupyterLab in the reader's browser, and it fetches the file from
          // this server — so it needs this instance to be reachable from that browser as a public
          // address, which a private or tailnet-only deployment is not.
          const ipynb = "/api/oncoprint/notebook/oncoprint.ipynb?spec=" + encoded + (cut ? "&cut=" + encodeURIComponent(cut) : "");
          const base = process.env.APP_BASE_URL;
          return (
            <p className="meta" style={{ margin: "0 0 0.8rem" }}>
              Prefer a real notebook? <a href={ipynb} download="oncoprint.ipynb">Download .ipynb</a> — the package and this
              figure&apos;s contract are embedded, so it opens in Jupyter, VS Code or Colab and runs with nothing installed
              {base ? <> · <a href={jupyterLiteUrl(base + ipynb)} target="_blank" rel="noreferrer">open it in JupyterLite ↗</a></> : null}.
            </p>
          );
        })()}
        <PyNotebook files={files} fixtures={fixtures} spec={spec} cut={cut} />
      </main>
    </>
  );
}
