"use client";
// A prompt for the researcher's AI assistant (Claude in the Chrome sidebar), with a copy
// button. The app never calls a model itself; this is how a page hands work to the sidebar.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";

export function Prompt({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked: the text is on screen to select by hand */ }
  }
  return (
    <div className="camp-prompt">
      <div className="camp-prompt-head"><strong>{label}</strong><Button variant="outline" size="sm" className={TB} onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "copied" : "copy prompt"}</Button></div>
      <p>{text}{text.endsWith(": ") && <em>…</em>}</p>
    </div>
  );
}
