"use client";
// The saved-work manager as a page of its own (the dialog any page opens is the same manager): the
// tab is in the URL, /saved?tab=groups, so a link or a reload lands on it.
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader } from "../_ui/site-header.tsx";
import { SavedManager } from "../_saved/saved-manager.tsx";
import { isSavedTab } from "../_saved/saved-tabs.ts";

export default function SavedPage() {
  const q = useSearchParams(), router = useRouter();
  const t = q.get("tab");
  return <>
    <SiteHeader page="your saved work — cohorts, analyses, uploads, groups and gene lists" current="saved" />
    <main className="analysis-main">
      <SavedManager tab={isSavedTab(t) ? t : "cohorts"} onTab={(next) => router.replace("/saved?tab=" + next, { scroll: false })} />
    </main>
  </>;
}
