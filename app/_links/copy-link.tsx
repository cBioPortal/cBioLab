"use client";
// "Copy link" (docs/LINKS.md): a short link to the page as it is, made when the reader asks for one.
// Its long parameters are stored (copyLink in link-state.ts) and the link is `?s=<id>`; a page with
// nothing long is linked as it is. The link is put on the clipboard and shown, so it can be copied
// by hand where the clipboard is refused.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Link2, Loader2 } from "lucide-react";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { copyLink } from "./link-state.ts";

type State = { busy: true } | { url: string; copied: boolean } | { error: string } | null;

export function CopyLinkButton({ className, onCopied }: { className?: string;
  /** told the link once it is made (the bar, which the copy itself makes unnecessary, says so instead) */
  onCopied?: (url: string, copied: boolean) => void }) {
  const [state, setState] = useState<State>(null);
  // a link shown is the page as it was: once the page changes (other than by being copied), it goes
  const key = useSearchParams().toString();
  const copiedAt = useRef<string | null>(null);
  useEffect(() => { if (copiedAt.current !== null && key !== copiedAt.current) { copiedAt.current = null; setState(null); } }, [key]);
  const copy = async () => {
    setState({ busy: true });
    try {
      const url = await copyLink();
      let copied = true;
      try { await navigator.clipboard.writeText(url); } catch { copied = false; }
      copiedAt.current = location.search.slice(1);
      setState({ url, copied });
      onCopied?.(url, copied);
    } catch (e) { setState({ error: String((e as Error)?.message || e) }); }
  };
  const busy = !!state && "busy" in state;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-copy-link>
      <Button variant="outline" size="sm" className={TB} disabled={busy} onClick={() => void copy()}
        data-tip="copy a short link to this page as it is now — anyone with it sees the same">
        {busy ? <Loader2 className="animate-spin" /> : state && "url" in state && state.copied ? <Check /> : <Link2 />}
        {state && "url" in state && state.copied ? "Link copied" : "Copy link"}
      </Button>
      {state && "url" in state && (
        <Input readOnly value={state.url} aria-label="link to this page" data-copied-link={state.url}
          className={cn("h-7 text-sm", state.copied ? "w-56" : "w-80")} onFocus={(e) => e.currentTarget.select()} />
      )}
      {state && "error" in state && <span className="text-sm text-destructive" role="alert" data-copy-link-error>could not make a link: {state.error}</span>}
    </span>
  );
}
