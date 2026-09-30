// /rationale — renders RATIONALE.md as a page, linked from the site header.
// Server component: reads the file and converts markdown to HTML at request
// time, so the page and the source-controlled doc can never drift into two
// separate copies of the same argument. The one Mermaid fence is pulled out
// and handed to a client component (mermaid needs a browser to render SVG);
// everything else is static HTML from marked.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import MermaidBlock from "./mermaid-block.tsx";
import { PageTools } from "../_agent/PageTools.tsx";

export const metadata = { title: "Rationale — cbio-lab" };

marked.setOptions({ gfm: true });

export default function RationalePage() {
  const raw = readFileSync(join(process.cwd(), "RATIONALE.md"), "utf8");

  // Split on ```mermaid fences so each becomes its own client-rendered block,
  // interleaved with statically-rendered markdown segments.
  const parts = raw.split(/```mermaid\n([\s\S]*?)```/g);
  // parts alternates: [markdown, mermaidSource, markdown, mermaidSource, ...]

  return (
    <main className="rationale-doc">
      <div className="rationale-nav">
        <a href="/lab">← back to the app</a>
        <span className="spacer" />
        <PageTools kind="rationale" />
      </div>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <MermaidBlock key={i} source={part} />
          : part.trim()
            ? <div key={i} dangerouslySetInnerHTML={{ __html: marked.parse(part) as string }} />
            : null
      )}
    </main>
  );
}
