"use client";
// The homepage, as cBioPortal's: choose studies, then explore them or query them by gene
// (query-flow.tsx). The selection is in the URL (?studies=a,b), so a refresh or a shared link
// lands on it.
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "../_ui/site-header.tsx";
import { QueryFlow } from "./query-flow.tsx";

/** the selection written back in place: ticking studies is not a history entry */
function writeStudies(ids: string[]) {
  try { history.replaceState(null, "", ids.length ? "/?" + new URLSearchParams({ studies: ids.join(",") }).toString() : "/"); }
  catch { /* URL state is a convenience, never a failure */ }
}

export function HomePage() {
  const q = useSearchParams();
  const studies = [...new Set((q.get("studies") || q.get("study") || "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9._-]+$/.test(s)))];
  return <>
    <SiteHeader page="choose studies, then explore them or query them by gene" current="studies" />
    <main className="analysis-main">
      <QueryFlow initial={{ studies, filters: [], query: "" }} onStudies={writeStudies} queryTitle="Select genes to query:" />
    </main>
  </>;
}
