// The chat sidebar's history of conversations (issue #126): what is kept of a conversation, how
// the list is capped, and how it is read and written. Pure and browser-safe; the storage is passed
// in so it runs under test.
//
// What is kept is TEXT ONLY: the reader's questions and the assistant's replies. Tool parts (the
// rows and tables a page returned) are dropped, and only the names of the tools a message called
// stay, beside it. A tool part left without its output would make the next model request invalid,
// and an old result reopened on another page would pass for a current one. The assistant's own
// words can still state patient facts, which the sidebar says.

export const HISTORY_KEY = "cohortlab.chat.history";
/** conversations kept, and messages kept of each; the oldest go first, and the sidebar says so */
export const MAX_CONVERSATIONS = 30;
export const MAX_MESSAGES = 100;
export const TITLE_CHARS = 60;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** the tools this message called, by name — their inputs and results are not kept */
  tools: string[];
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  /** the earliest messages were dropped to stay within MAX_MESSAGES */
  trimmed?: boolean;
  messages: StoredMessage[];
}

/** The part of a chat message this module reads: the AI SDK's UIMessage, loosely. */
export interface MessageLike { id: string; role: string; parts: { type: string; text?: string; toolName?: string }[] }

const isTool = (type: string) => type === "dynamic-tool" || type.startsWith("tool-");

/** A conversation's messages as text only: text parts joined, tool parts reduced to their names. */
export function textOnly(messages: MessageLike[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = m.parts.filter((p) => p.type === "text").map((p) => p.text || "").join("\n\n").trim();
    const tools = [...new Set(m.parts.filter((p) => isTool(p.type)).map((p) => p.type === "dynamic-tool" ? String(p.toolName) : p.type.slice(5)))];
    if (text || tools.length) out.push({ id: m.id, role: m.role, text, tools });
  }
  return out;
}

/** A stored conversation's messages as chat messages: text parts, with the tool names in metadata. */
export function toMessages(c: Conversation): { id: string; role: "user" | "assistant"; parts: { type: "text"; text: string }[]; metadata: { tools: string[]; earlier: string } }[] {
  return c.messages.filter((m) => m.text).map((m) => ({
    id: m.id, role: m.role, parts: [{ type: "text" as const, text: m.text }], metadata: { tools: m.tools, earlier: c.updatedAt }
  }));
}

/** The title a conversation gets from its first question: its first line, cut at TITLE_CHARS. */
export function titleOf(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text)?.text.split("\n").map((s) => s.trim()).find(Boolean) || "";
  if (!first) return "Untitled conversation";
  return first.length <= TITLE_CHARS ? first : first.slice(0, TITLE_CHARS - 1).trimEnd() + "…";
}

/**
 * The history with one conversation written into it: newest first, a conversation already in it
 * replaced (its title, if the reader renamed it, kept), the oldest beyond MAX_CONVERSATIONS left
 * out and counted, a conversation over MAX_MESSAGES cut from the front to start at a question.
 * An empty conversation is not kept.
 */
export function withConversation(history: Conversation[], id: string, messages: StoredMessage[], now: string): { history: Conversation[]; dropped: number } {
  if (!messages.length) return { history: history.filter((c) => c.id !== id), dropped: 0 };
  let kept = messages, trimmed = false;
  if (kept.length > MAX_MESSAGES) {
    kept = kept.slice(kept.length - MAX_MESSAGES);
    const q = kept.findIndex((m) => m.role === "user");
    kept = q > 0 ? kept.slice(q) : kept;
    trimmed = true;
  }
  const before = history.find((c) => c.id === id);
  const next: Conversation = { id, title: before?.title || titleOf(messages), updatedAt: now, ...(trimmed ? { trimmed } : {}), messages: kept };
  const all = [next, ...history.filter((c) => c.id !== id)];
  const out = all.slice(0, MAX_CONVERSATIONS);
  return { history: out, dropped: all.length - out.length };
}

export const renamed = (history: Conversation[], id: string, title: string): Conversation[] => {
  const t = title.trim();
  return t ? history.map((c) => c.id === id ? { ...c, title: t.slice(0, 120) } : c) : history;
};
export const removed = (history: Conversation[], id: string): Conversation[] => history.filter((c) => c.id !== id);

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** The stored history; empty when there is none, or what is there cannot be read. */
export function loadHistory(store: Store | null): Conversation[] {
  try {
    const raw = store?.getItem(HISTORY_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((c): c is Conversation => !!c && typeof c.id === "string" && Array.isArray(c.messages)) : [];
  } catch { return []; }
}

/** Write the history; false when the store is full or blocked, which the sidebar says. */
export function saveHistory(store: Store | null, history: Conversation[]): boolean {
  try { if (!store) return false; store.setItem(HISTORY_KEY, JSON.stringify(history)); return true; }
  catch { return false; }
}
