"use client";
// THE app's header, the same on every page: the name (home), which page this is, the same links in
// the same order, a page's own tools (its assistant menu), "Saved work" and the sign-in. "Saved work"
// opens the saved-work manager over the page (app/_saved); its link is the same manager as a page.
import { Bookmark } from "lucide-react";
import LoginButton from "../lab/login-button.tsx";
import { Button } from "./button";
import { TB } from "./toolbar.ts";
import { cn } from "../../lib/cn";
import { useOpenSavedFromUrl, useSaved } from "../_saved/saved-context.tsx";

const LINKS = [
  ["studies", "/", "studies"],
  ["examples", "/lab?tab=examples", "examples"],
  ["reproductions", "/reproductions", "paper reproductions"],
  ["campaigns", "/campaign", "hypothesis campaigns"],
  ["verification", "/verification", "how we verify"],
  ["rationale", "/rationale", "rationale"],
] as const;
export type SiteLink = typeof LINKS[number][0];

const plainClick = (e: React.MouseEvent) => !e.metaKey && !e.ctrlKey && !e.shiftKey;

export function SiteHeader({ page, current, onLink, children }: {
  /** which page this is, beside the name */
  page: string;
  /** the link this page is, marked as the current one */
  current?: SiteLink | "saved";
  /** a page that can open a link in place (the lab's own tabs) does, and says so by returning true */
  onLink?: (link: SiteLink) => boolean;
  /** the page's own tools, before the sign-in */
  children?: React.ReactNode;
}) {
  const saved = useSaved();
  useOpenSavedFromUrl();
  return (
    <header>
      <h1><a href="/" className="text-foreground no-underline">cbio-lab</a></h1>
      <span className="sub" data-tip={page}>{page}</span>
      {LINKS.map(([key, href, label]) => (
        <a key={key} className="toplink" href={href} aria-current={key === current ? "page" : undefined}
          onClick={(e) => { if (plainClick(e) && onLink?.(key)) e.preventDefault(); }}>{label}</a>
      ))}
      {children}
      <Button asChild variant="outline" size="sm" className={cn(TB, "savedbtn")} aria-current={current === "saved" ? "page" : undefined}>
        <a href="/saved" data-tip="your saved cohorts, analyses, uploads, groups and gene lists"
          onClick={(e) => { if (plainClick(e) && current !== "saved") { e.preventDefault(); saved.open("cohorts"); } }}><Bookmark />Saved work</a>
      </Button>
      <LoginButton />
    </header>
  );
}
