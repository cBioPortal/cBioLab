"use client";
// Light or dark, the reader's choice: the header's button switches the page to the other scheme.
// The choice is this browser's (localStorage — a per-viewer convenience, never in the document or a
// link), set as data-theme on <html>, which the colour tokens in app/globals.css read; with none
// set the page follows the system. Choosing the scheme the system already has forgets the choice,
// so the page follows the system again. THEME_SCRIPT applies a stored choice before first paint.
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./button";
import { TB } from "./toolbar.ts";

type Scheme = "light" | "dark";
const KEY = "cbiolab-theme";
const EVENT = "cbiolab-theme";

/** Run in <head> before the page paints, so a stored choice never flashes the other scheme first. */
export const THEME_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const systemScheme = (): Scheme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** the scheme the page shows now: the reader's choice, else the system's */
function shown(): Scheme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : systemScheme();
}

function subscribe(change: () => void): () => void {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", change);
  window.addEventListener(EVENT, change);
  // another tab's choice
  const storage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    if (e.newValue === "light" || e.newValue === "dark") document.documentElement.setAttribute("data-theme", e.newValue);
    else document.documentElement.removeAttribute("data-theme");
    change();
  };
  window.addEventListener("storage", storage);
  return () => { mq.removeEventListener("change", change); window.removeEventListener(EVENT, change); window.removeEventListener("storage", storage); };
}

function choose(next: Scheme) {
  const root = document.documentElement;
  const follow = next === systemScheme();
  if (follow) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", next);
  try { if (follow) localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* storage blocked: the choice lasts this page */ }
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeToggle() {
  // null on the server and in the first render, which must match it; the scheme once mounted
  const scheme = useSyncExternalStore(subscribe, shown, () => null);
  const next: Scheme = scheme === "dark" ? "light" : "dark";
  const label = "switch to " + next + " mode";
  return (
    <Button variant="outline" size="sm" className={TB} aria-label={label} data-tip={label} disabled={!scheme}
      onClick={() => choose(next)}>
      {scheme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
