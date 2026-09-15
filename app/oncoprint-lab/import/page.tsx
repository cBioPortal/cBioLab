// Oncoprinter-shaped tables, drawn by this engine. Seeded with the repo's fixture so the
// page shows a figure rather than three empty boxes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ImportOncoprint from "./ImportOncoprint.tsx";

export const metadata = { title: "Oncoprint from pasted data — cbio-lab" };
export const dynamic = "force-dynamic";

export default function ImportPage() {
  const fix = join(process.cwd(), "test", "fixtures", "oncoprint");
  const read = (f: string) => readFileSync(join(fix, f), "utf8").trim();
  return (
    <>
      <header>
        <h1>cbio-lab</h1>
        <span className="sub">oncoprint from pasted data — the portal&apos;s Oncoprinter shape, this engine</span>
        <span className="spacer" />
        <a href="/oncoprint-lab" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>interactive lab →</a>
        <a href="/oncoprint-lab/cli" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>command line →</a>
      </header>
      <main>
        <p className="meta" style={{ maxWidth: "72ch" }}>
          Tab-separated tables in the shape cBioPortal&apos;s Oncoprinter accepts, drawn by the same renderer and the same
          style as every other figure here. Nothing is queried and nothing is stored: the tables are assembled into a
          render contract and sent straight back. Without a coverage table every case counts as profiled for every gene,
          which is the caller&apos;s call to make — the figure cannot know what was assayed.
        </p>
        <ImportOncoprint sample={{ events: read("events.tsv"), clinical: read("clinical.tsv"), coverage: read("coverage.tsv") }} />
      </main>
    </>
  );
}
