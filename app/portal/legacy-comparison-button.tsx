"use client";
// "Open in cBioPortal" on the Comparison page: saves the page's groups as a cBioPortal comparison
// session (lib/legacy-comparison.ts) and opens it in a new browser tab. Looks like LegacyLinkButton.
import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import type { PortalHold } from "../../lib/legacy-link.ts";
import { legacyComparisonState } from "../../lib/legacy-comparison.ts";

export function LegacyComparisonButton({ study, cohorts, tab, held, className }: {
  study: string; cohorts: Record<string, unknown>; tab?: string; held: Record<string, PortalHold> | null; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = legacyComparisonState(study, Object.keys(cohorts), tab, held);
  const cls = cn(TB, "legacylink", className);
  const body = <>{busy ? <Loader2 className="animate-spin" /> : <ExternalLink />}Open in cBioPortal</>;
  if (!state || !state.ok)
    return <Button variant="outline" size="sm" className={cn(cls, !state ? "cursor-wait" : "cursor-not-allowed", "opacity-50 hover:bg-card hover:text-foreground")} aria-disabled="true"
      data-tip={state?.tip || "waiting for the page's studies"}>{body}</Button>;
  const open = async () => {
    if (busy) return;
    // opened now, while the click still counts as the reader's, so no popup blocker stops it
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/legacy-comparison", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ study, cohorts, tab }) });
      const j = await r.json() as { href?: string; error?: string };
      if (!j.href) throw new Error(j.error || "no link came back");
      if (win) win.location.href = j.href; else window.open(j.href, "_blank", "noopener");
    } catch (e) {
      win?.close();
      setError(String((e as Error)?.message || e));
    } finally { setBusy(false); }
  };
  return (
    <Button variant="outline" size="sm" className={cn(cls, error && "border-destructive text-destructive")} onClick={() => void open()} aria-busy={busy}
      data-tip={busy ? "saving the groups to cBioPortal…" : error ? "could not open it: " + error : state.tip}>{body}</Button>
  );
}
