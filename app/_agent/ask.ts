"use client";
// How a page puts a question to the chat sidebar. The sidebar is in the root layout and is just
// another WebMCP client; a page that wants it to answer something dispatches this event, and the
// sidebar handles it exactly as it handles typed text. It adds no tool and no private way into the
// page: the model still reads the page only through the page's own tools.
import { useEffect, useState } from "react";

export const ASK_EVENT = "cbiolab:ask";
export interface AskDetail { text: string; /** drop the current conversation first (the default) */ newChat?: boolean }

/** Ask the sidebar: opens it, starts a new conversation unless told not to, and sends `text`. */
export function askAssistant(text: string, newChat = true): void {
  window.dispatchEvent(new CustomEvent<AskDetail>(ASK_EVENT, { detail: { text, newChat } }));
}

export interface ChatInfo { enabled: boolean; signInRequired: boolean; model: string | null }

// one request per page load, shared by the sidebar and every button that needs to know
let info: Promise<ChatInfo | null> | null = null;
export const chatInfo = (): Promise<ChatInfo | null> =>
  info ??= fetch("/api/chat").then((r) => r.ok ? r.json() as Promise<ChatInfo> : null).catch(() => null);

/** null while it is being asked; then whether the sidebar is on, and whether the reader may use it. */
export function useAssistant(): { available: boolean; model: string | null } | null {
  const [a, setA] = useState<{ available: boolean; model: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    void chatInfo().then((i) => { if (live) setA({ available: !!i?.enabled && !i.signInRequired, model: i?.model ?? null }); });
    return () => { live = false; };
  }, []);
  return a;
}
