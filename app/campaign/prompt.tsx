"use client";
// A prompt for the researcher's AI assistant (Claude in the Chrome sidebar), with a copy
// button. The app never calls a model itself; this is how a page hands work to the sidebar.
import { useState } from "react";

export function Prompt({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked: the text is on screen to select by hand */ }
  }
  return (
    <div className="camp-prompt">
      <div className="camp-prompt-head"><strong>{label}</strong><button onClick={copy}>{copied ? "copied" : "copy prompt"}</button></div>
      <p>{text}{text.endsWith(": ") && <em>…</em>}</p>
    </div>
  );
}
