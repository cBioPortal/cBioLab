"use client";
// Wraps every page that keeps its state in its URL (docs/LINKS.md):
// - opens a stored link before the page renders: a page whose URL names one (`?s=<id>`) reads its
//   parameters through linkParams() / useLinkParams() (link-state.ts), which put the stored ones
//   back, so they must be known before any of it renders. While they are read the page says so; a
//   link that cannot be read is said instead of a page opened without it.
// - refuses an address whose parameters were held in another browser (`long=` with nothing held
//   here), saying where it came from, rather than opening the page without them.
// - while the page's address holds less than the page, a bar across the top says so and offers
//   Copy link.
// - tells the header this page has a link to copy (LinkedPage), so Copy link is always there.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Info } from "lucide-react";
import { Input } from "../_ui/input";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { CopyLinkButton } from "./copy-link.tsx";
import { LinkedPage } from "./use-link.ts";
import { configureLinks, currentHeld, currentLinkUrlMax, heldElsewhere, knownLink, linkIdOf, onHeld, openLink, type Held } from "./link-state.ts";

export function LinkGate({ children }: { children: React.ReactNode }) {
  const env = usePublicEnv();
  configureLinks(env.LINK_URL_MAX);
  const search = "?" + useSearchParams().toString();
  const id = linkIdOf(search);
  // the server's render and the first in the browser agree: a link is "opening" until an effect has looked
  const [state, setState] = useState<{ id: string; error?: string } | null>(id ? { id } : null);
  const [held, setHeld] = useState<Held>(null);
  const [elsewhere, setElsewhere] = useState(false);
  // a link copied from the bar: the address is now that link, so nothing is held, but the bar stays
  // to say so and show it, until the page changes again
  const [copied, setCopied] = useState<{ url: string; clipboard: boolean; at: string } | null>(null);
  // history.state is the browser's alone: read after the first render, and again as the address changes
  useEffect(() => {
    setHeld(currentHeld()); setElsewhere(heldElsewhere(location.search));
    setCopied((c) => c && c.at === location.search ? c : null);
  }, [search]);
  useEffect(() => onHeld(setHeld), []);
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
  if (elsewhere) return <main className="analysis-main"><div className="error" role="alert" data-link-elsewhere>
    This address was copied from a page whose state was too long to keep in its address, so it does not hold that
    state, and this browser does not have it. Ask whoever sent it for the page&apos;s <b>Copy link</b> link instead: that
    one holds everything.</div></main>;
  return <LinkedPage.Provider value={true}>
    {copied && !held && <div role="status" data-link-copied
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ok bg-ok-soft px-4 py-2 text-md text-foreground">
      <Check className="size-4 shrink-0 text-ok" aria-hidden />
      <span className="min-w-0 flex-1">
        {copied.clipboard ? "Link copied." : "Here is the link (the clipboard refused it; copy it from the field)."} The address
        bar now holds this short link too; it changes again, and this page is held out of it, once you edit.
      </span>
      <Input readOnly value={copied.url} aria-label="link to this page" data-copied-link={copied.url} className="h-7 w-80 text-sm"
        onFocus={(e) => e.currentTarget.select()} />
    </div>}
    {held && <div role="status" data-link-held
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-mark bg-mark-soft px-4 py-2 text-md text-foreground">
      <Info className="size-4 shrink-0 text-mark" aria-hidden />
      <span className="min-w-0 flex-1">
        This page is now too long to keep in its address ({held.length.toLocaleString("en-US")} characters; the limit
        is {currentLinkUrlMax().toLocaleString("en-US")}), so the address bar no longer changes as you work. Reload, Back
        and Undo still work in this tab. To share or keep this page, use Copy link: it makes a short link that holds everything.
      </span>
      <CopyLinkButton onCopied={(url, clipboard) => setCopied({ url, clipboard, at: location.search })} />
    </div>}
    {children}
  </LinkedPage.Provider>;
}
