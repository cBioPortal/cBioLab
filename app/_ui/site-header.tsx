"use client";
// THE app's header, the same on every page: the name (home), which page this is, the same links in
// the same order, a page's own tools (its assistant menu) and the sign-in.
import LoginButton from "../lab/login-button.tsx";

const LINKS = [
  ["studies", "/", "studies"],
  ["examples", "/lab?tab=examples", "examples"],
  ["reproductions", "/reproductions", "paper reproductions"],
  ["campaigns", "/campaign", "hypothesis campaigns"],
  ["verification", "/verification", "how we verify"],
  ["rationale", "/rationale", "rationale"],
] as const;
export type SiteLink = typeof LINKS[number][0];

export function SiteHeader({ page, current, onLink, children }: {
  /** which page this is, beside the name */
  page: string;
  /** the link this page is, marked as the current one */
  current?: SiteLink;
  /** a page that can open a link in place (the lab's own tabs) does, and says so by returning true */
  onLink?: (link: SiteLink) => boolean;
  /** the page's own tools, before the sign-in */
  children?: React.ReactNode;
}) {
  return (
    <header>
      <h1><a href="/" className="text-foreground no-underline" title="choose studies, then explore or query them">cbio-lab</a></h1>
      <span className="sub">{page}</span>
      <span className="spacer" />
      {LINKS.map(([key, href, label]) => (
        <a key={key} className="toplink" href={href} aria-current={key === current ? "page" : undefined}
          onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && onLink?.(key)) e.preventDefault(); }}>{label}</a>
      ))}
      {children}
      <LoginButton />
    </header>
  );
}
