// /rationale — renders RATIONALE.md as a page, linked from the site header.
// Server component: reads the file and converts markdown to HTML at request
// time, so the page and the source-controlled doc can never drift into two
// separate copies of the same argument.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { PageTools } from "../_agent/PageTools.tsx";
import { SiteHeader } from "../_ui/site-header.tsx";

export const metadata = { title: "Rationale — cbio-lab" };

marked.setOptions({ gfm: true });

export default function RationalePage() {
  const raw = readFileSync(join(process.cwd(), "RATIONALE.md"), "utf8");
  return (
    <>
      <SiteHeader page="rationale — why this exists" current="rationale"><PageTools kind="rationale" /></SiteHeader>
      <main className="rationale-doc" dangerouslySetInnerHTML={{ __html: marked.parse(raw) as string }} />
    </>
  );
}
