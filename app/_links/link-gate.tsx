"use client";
// Opens a stored link before the page renders (docs/LINKS.md): a page whose URL names one
// (`?s=<id>`) reads its parameters through linkParams() / useLinkParams() (link-state.ts), which
// put the stored ones back — so they must be known before any of it renders. While they are read
// the page says so; a link that cannot be read is said instead of a page opened without it. Also
// says when the page's own URL grew too long and could not be stored.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { configureLinks, knownLink, linkIdOf, onLinkProblem, openLink, type LinkProblem } from "./link-state.ts";

export function LinkGate({ children }: { children: React.ReactNode }) {
  const env = usePublicEnv();
  configureLinks(env.LINK_URL_MAX);
  const id = linkIdOf("?" + useSearchParams().toString());
  // the server's render and the first in the browser agree: a link is "opening" until an effect has looked
  const [state, setState] = useState<{ id: string; error?: string } | null>(id ? { id } : null);
  const [problem, setProblem] = useState<LinkProblem>(null);
  useEffect(() => onLinkProblem(setProblem), []);
  useEffect(() => {
    if (!id || knownLink(id)) { setState(null); return; }
    let live = true;
    setState({ id });
    openLink(id).then(() => { if (live) setState(null); },
      (e) => { if (live) setState({ id, error: String((e as Error)?.message || e) }); });
    return () => { live = false; };
  }, [id]);
  if (state?.error) return <main className="analysis-main"><div className="error" role="alert">This link could not be opened: {state.error}</div></main>;
  if (state) return <main className="analysis-main"><p className="note"><Waiting what="this link" /></p></main>;
  return <>
    {problem && <div className="error" role="alert" data-link-problem>
      This page&apos;s address is {problem.length.toLocaleString("en-US")} characters, too long to reload or share as it is, and storing it as a short
      link failed: {problem.error}</div>}
    {children}
  </>;
}
