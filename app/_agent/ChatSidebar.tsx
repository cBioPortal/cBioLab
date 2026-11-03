"use client";
// The chat sidebar: an assistant docked beside every page, with the model behind /api/chat.
//
// It works the page exactly as an outside assistant does — through the page's WebMCP tools as
// lib/webmcp.ts publishes them (window.cohortLab): each request sends the tools the page exposes
// at that moment, and each call the model makes runs here through window.cohortLab.call, so an
// edit goes through the same engine validation and reaches the page only if accepted. It has no
// other way in: no page state, no private API.
//
// Opening another page (site_open, or the researcher clicking a link) reloads the page, so the
// conversation and whether the panel is open live in sessionStorage; a conversation whose last
// step was a tool call carries on once the new page's tools are up.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { ArrowLeftIcon, ArrowUpIcon, CheckIcon, HistoryIcon, MessageSquareIcon, PencilIcon, PlugIcon, RotateCcwIcon, ShieldAlertIcon, SquareIcon, SquarePenIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/app/_ui/button";
import { Textarea } from "@/app/_ui/textarea";
import { Input } from "@/app/_ui/input";
import { Checkbox } from "@/app/_ui/checkbox";
import { fromToolName, type ConnectorStatus, type PublicConnector } from "../../lib/chat-connectors.ts";
import {
  CONNECTOR_NOTE_KEY, canSwitchOn, connectUrl, loadState, requestEntries, saveState, signedIn, withOn, withToken, type ConnectorState
} from "../../lib/chat-connector-state.ts";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/app/_ui/ai/conversation";
import { Message, MessageContent, MessageResponse } from "@/app/_ui/ai/message";
import { Reasoning } from "@/app/_ui/ai/reasoning";
import { ASK_EVENT, chatInfo, type AskDetail, type ChatInfo } from "./ask.ts";
import {
  MAX_CONVERSATIONS, MAX_MESSAGES, loadHistory, removed, renamed, saveHistory, textOnly, toMessages, withConversation, type Conversation as SavedChat
} from "../../lib/chat-history.ts";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, type ToolPart } from "@/app/_ui/ai/tool";

const STORE = "cohortlab.chat";
const OPEN = "cohortlab.chat.open";
const CONV = "cohortlab.chat.id";

interface PageApi { page: string; tools: { name: string; description: string; input: object }[]; call: (name: string, args: object) => Promise<unknown> }

const pageApi = (): PageApi | null => (window as unknown as { cohortLab?: PageApi }).cohortLab ?? null;
const asText = (x: unknown) => typeof x === "string" ? x : JSON.stringify(x, null, 2);
const message = (e: unknown) => String((e as Error)?.message || e);

function stored<T>(key: string, fallback: T): T {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; }
  catch { return fallback; }
}
function store(key: string, v: unknown) {
  try { if (v === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(v)); }
  catch { /* full or blocked: the conversation just won't survive a page load */ }
}

/** the history lives in localStorage (it outlives the tab); null where the browser blocks it */
const local = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const newId = () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
type Meta = { tools?: string[]; earlier?: string } | undefined;
/** a message the connector sign-in left for this page (sessionStorage), shown once */
function takeNote(): string | null {
  try { const n = sessionStorage.getItem(CONNECTOR_NOTE_KEY); if (n) sessionStorage.removeItem(CONNECTOR_NOTE_KEY); return n; } catch { return null; }
}

/** The page's tools, waiting briefly for a page that registers them after it mounts. */
async function waitForPage(ms = 10000): Promise<PageApi | null> {
  const t0 = Date.now();
  while (!pageApi() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
  return pageApi();
}

export function ChatSidebar() {
  const [info, setInfo] = useState<ChatInfo | null>(null);
  useEffect(() => {
    void chatInfo().then(setInfo);
  }, []);
  if (!info?.enabled) return null;
  return <ChatPanel info={info} />;
}

function ChatPanel({ info }: { info: ChatInfo }) {
  const [open, setOpenState] = useState<boolean>(() => stored(OPEN, false));
  const setOpen = (v: boolean) => { setOpenState(v); store(OPEN, v); };
  const [input, setInput] = useState("");
  // the conversation on screen, and the history of those left behind (lib/chat-history.ts)
  const [convId, setConvId] = useState<string>(() => stored<string | null>(CONV, null) ?? newId());
  const [history, setHistory] = useState<SavedChat[]>(() => loadHistory(local()));
  const [historyNote, setHistoryNote] = useState<{ dropped: number; failed: boolean }>({ dropped: 0, failed: false });
  const [showHistory, setShowHistory] = useState(false);
  const initial = useMemo(() => stored<UIMessage[]>(STORE, []), []);
  // connectors (issue #128): the reader's switches and sign-ins, kept in this browser; off until switched on
  const [conn, setConn] = useState<ConnectorState>(() => loadState(local()));
  const [connSaveFailed, setConnSaveFailed] = useState(false);
  const [connStatus, setConnStatus] = useState<Record<string, ConnectorStatus>>({});
  const [connNote, setConnNote] = useState<string | null>(() => takeNote());
  const [showConnectors, setShowConnectors] = useState<boolean>(() => !!connNote);
  const infoRef = useRef(info);
  infoRef.current = info;
  const statusSink = useRef<(s: ConnectorStatus[]) => void>(() => {});
  statusSink.current = (list) => setConnStatus(Object.fromEntries(list.map((s) => [s.id, s])));
  const saveConn = (next: ConnectorState) => { setConn(next); setConnSaveFailed(!saveState(local(), next)); };

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    // what is on is read when the request is made, so a switch applies to the very next message
    prepareSendMessagesRequest: ({ messages }) => {
      const p = pageApi();
      const connectors = requestEntries(loadState(local()), infoRef.current.connectors, Date.now());
      return { body: { messages, page: p?.page ?? location.pathname, tools: p?.tools ?? [], connectors } };
    },
    // what became of each connector this turn comes back in a header
    fetch: async (input, init) => {
      const r = await fetch(input, init);
      try { const h = r.headers.get("x-chat-connectors"); if (h) statusSink.current(JSON.parse(decodeURIComponent(h)) as ConnectorStatus[]); } catch { /* a status is a convenience */ }
      return r;
    }
  }), []);

  const { messages, sendMessage, addToolOutput, addToolApprovalResponse, status, error, stop, setMessages, regenerate, clearError } = useChat({
    id: "sidebar",
    messages: initial,
    transport,
    throttle: 50,
    // a page tool the browser has run, or a connector call the reader has approved or denied
    sendAutomaticallyWhen: (o) => lastAssistantMessageIsCompleteWithToolCalls(o) || lastAssistantMessageIsCompleteWithApprovalResponses(o),
    onToolCall: async ({ toolCall }) => {
      const { toolName, toolCallId, input: args } = toolCall;
      try {
        const p = pageApi();
        if (!p) throw new Error("this page exposes no tools");
        const output = asText(await p.call(toolName, (args ?? {}) as object));
        void addToolOutput({ tool: toolName, toolCallId, output });
      } catch (e) {
        void addToolOutput({ tool: toolName, toolCallId, state: "output-error", errorText: message(e) });
      }
    }
  });

  useEffect(() => { store(STORE, messages.length ? messages : null); }, [messages]);

  // A conversation that stopped on a tool result (site_open reloads the page under it) continues
  // here, once, with this page's tools.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    if (initial.length && lastAssistantMessageIsCompleteWithToolCalls({ messages: initial }))
      void waitForPage().then(() => sendMessage());
  }, [initial, sendMessage]);

  useEffect(() => {
    document.documentElement.dataset.chat = open ? "open" : "closed";
    return () => { delete document.documentElement.dataset.chat; };
  }, [open]);

  const busy = status === "submitted" || status === "streaming";
  const submit = () => {
    const text = input.trim();
    if (!text || busy || info.signInRequired) return;
    void sendMessage({ text });
    setInput("");
  };
  /** write `msgs` as conversation `id` into the history, as text only */
  const keep = (id: string, msgs: UIMessage[]) => {
    const text = textOnly(msgs as never);
    const before = history.find((c) => c.id === id);
    if (before && JSON.stringify(before.messages) === JSON.stringify(text)) return;   // opened and read, not changed
    const next = withConversation(history, id, text, new Date().toISOString());
    const ok = saveHistory(local(), next.history);
    setHistory(next.history);
    setHistoryNote((n) => ({ dropped: n.dropped + next.dropped, failed: !ok }));
  };
  // a turn that has finished is kept; one cut short is kept by the move away from it
  useEffect(() => { store(CONV, convId); }, [convId]);
  useEffect(() => { if (!busy && messages.length) keep(convId, messages); }, [messages, busy]);   // eslint-disable-line react-hooks/exhaustive-deps -- `keep` reads the current history
  const leave = () => { void stop(); if (messages.length) keep(convId, messages); clearError(); };
  const newChat = () => { leave(); setMessages([]); store(STORE, null); setConvId(newId()); setShowHistory(false); };
  const openConversation = (c: SavedChat) => {
    if (c.id === convId) { setShowHistory(false); return; }
    leave();
    const msgs = toMessages(c) as unknown as UIMessage[];
    setMessages(msgs);
    store(STORE, msgs);
    setConvId(c.id);
    setShowHistory(false);
  };
  const reopened = (messages[0]?.metadata as Meta)?.earlier;

  // A page's question (app/_agent/ask.ts, the patient page's Summarize): handled as typed text is;
  // the conversation it leaves is kept in the history.
  const ask = useRef<(d: AskDetail) => void>(() => {});
  ask.current = ({ text, newChat: fresh = true }) => {
    if (info.signInRequired || !text.trim()) return;
    if (fresh) newChat();
    setOpen(true);
    void sendMessage({ text });
  };
  useEffect(() => {
    const on = (e: Event) => ask.current((e as CustomEvent<AskDetail>).detail);
    window.addEventListener(ASK_EVENT, on);
    return () => window.removeEventListener(ASK_EVENT, on);
  }, []);

  if (!open)
    return (
      <Button data-tw className="chat-launcher fixed right-4 bottom-4 z-40 rounded-pill shadow-md" onClick={() => setOpen(true)}
        aria-label="Open the assistant">
        <MessageSquareIcon /> Assistant
      </Button>
    );

  return (
    <aside data-tw className="chat-sidebar fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-card text-foreground shadow-lg sm:w-96"
      aria-label="Assistant">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-2.5">
        <MessageSquareIcon className="size-4 text-primary" />
        <span className="text-md font-medium">Assistant</span>
        <span className="truncate text-xs text-muted-foreground" data-tip="The model behind this assistant">{info.model}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" onClick={() => { setShowConnectors((v) => !v); setShowHistory(false); }} aria-pressed={showConnectors}
          data-tip={"Connectors: external servers the assistant can ask (" + (info.connectors.filter((c) => conn.on.includes(c.id)).length || "none") + " on)"} aria-label="Connectors"><PlugIcon /></Button>
        <Button variant="ghost" size="icon-sm" onClick={() => { setShowHistory((v) => !v); setShowConnectors(false); }} data-tip={showHistory ? "Back to the conversation" : "Earlier conversations"} aria-label={showHistory ? "Back to the conversation" : "Earlier conversations"} aria-pressed={showHistory}>{showHistory ? <ArrowLeftIcon /> : <HistoryIcon />}</Button>
        <Button variant="ghost" size="icon-sm" onClick={newChat} data-tip="New conversation" aria-label="New conversation"><SquarePenIcon /></Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} data-tip="Close" aria-label="Close the assistant"><XIcon /></Button>
      </div>

      {showHistory && <HistoryList history={history} openId={convId} note={historyNote} onOpen={openConversation}
        onRename={(id, t) => { const h = renamed(history, id, t); setHistory(h); setHistoryNote((n) => ({ ...n, failed: !saveHistory(local(), h) })); }}
        onRemove={(id) => { const h = removed(history, id); setHistory(h); setHistoryNote((n) => ({ ...n, failed: !saveHistory(local(), h) })); if (id === convId) newChat(); }}
        onClear={() => { setHistory([]); setHistoryNote({ dropped: 0, failed: !saveHistory(local(), []) }); }} />}
      {showConnectors && <ConnectorsPanel connectors={info.connectors} error={info.connectorsError} state={conn} status={connStatus} note={connNote} saveFailed={connSaveFailed}
        onDismissNote={() => setConnNote(null)}
        onSwitch={(id, on) => saveConn(withOn(conn, id, on))}
        onDisconnect={(id) => saveConn(withToken(conn, id, null))}
        onSaveToken={(id, token) => saveConn(withToken(conn, id, { token }))}
        onConnect={(id) => { location.assign(connectUrl(id, location.pathname + location.search)); }} />}
      <Conversation className={showHistory || showConnectors ? "hidden" : undefined}>
        <ConversationContent>
          {reopened && (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground" role="note">
              Reopened from {new Date(reopened).toLocaleString()}. Only the text was kept, not what the tools returned, so the assistant reads the page again when it needs data.
            </p>
          )}
          {messages.length === 0 && (
            <div className="space-y-2.5 py-6 text-sm text-muted-foreground">
              <p>Ask about the data, or ask for an analysis. The assistant works this page through the same tools any AI assistant uses here (the page&apos;s <span className="font-medium">AI tools</span> menu lists them), so every edit it makes is checked by the engine first.</p>
              <p>It can move between pages, and the conversation comes along.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.parts.map((part, j) => {
                  const live = busy && i === messages.length - 1 && j === m.parts.length - 1;
                  if (part.type === "text")
                    return m.role === "user"
                      ? <p key={j} className="whitespace-pre-wrap">{part.text}</p>
                      : <MessageResponse key={j} isAnimating={live}>{part.text}</MessageResponse>;
                  if (part.type === "reasoning")
                    return part.text || live ? <Reasoning key={j} text={part.text} streaming={live} /> : null;
                  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                    const t = part as ToolPart;
                    const name = t.type === "dynamic-tool" ? t.toolName : t.type.slice(5);
                    if (t.state === "approval-requested" && t.approval)
                      return <ApprovalCard key={j} name={name} input={t.input} connectors={info.connectors}
                        onRespond={(approved) => void addToolApprovalResponse({ id: t.approval!.id, approved })} />;
                    return (
                      <Tool key={j}>
                        <ToolHeader name={name} state={t.state} />
                        <ToolContent>
                          <ToolInput input={t.input} />
                          <ToolOutput output={t.state === "output-available" ? t.output : undefined} errorText={t.state === "output-error" ? t.errorText : undefined} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
                {m.role === "assistant" && !m.parts.some((x) => x.type.startsWith("tool-") || x.type === "dynamic-tool") && (m.metadata as Meta)?.tools?.length
                  ? <p className="text-xs text-muted-foreground">Used {(m.metadata as Meta)!.tools!.join(", ")} (results not kept)</p> : null}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && <div className="animate-pulse text-xs text-muted-foreground">Working…</div>}
          {error && (
            <div className="space-y-1.5 rounded-md bg-destructive-soft p-2.5 text-sm text-destructive" role="alert">
              <p>{error.message || "The request failed."}</p>
              <Button variant="outline" size="xs" onClick={() => { clearError(); void regenerate(); }}><RotateCcwIcon /> Retry</Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {info.connectors.some((c) => conn.on.includes(c.id)) && (
        <p className="shrink-0 border-t px-2.5 pt-2 text-xs text-muted-foreground" role="note">
          Connectors on: {info.connectors.filter((c) => conn.on.includes(c.id)).map((c) => c.name).join(", ")}. The assistant can ask {info.connectors.filter((c) => conn.on.includes(c.id)).length === 1 ? "it" : "them"}, and you approve each call first.
        </p>
      )}
      <form className="shrink-0 border-t p-2.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {info.signInRequired
          ? <p className="text-sm text-muted-foreground">Sign in to use the assistant.</p>
          : (
            <div className="relative">
              <Textarea className="max-h-48 min-h-16 resize-none pr-11 text-sm" value={input} placeholder="Ask the assistant…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
              {busy
                ? <Button type="button" size="icon-sm" variant="outline" className="absolute right-1.5 bottom-1.5" onClick={() => void stop()} aria-label="Stop"><SquareIcon /></Button>
                : <Button type="submit" size="icon-sm" className="absolute right-1.5 bottom-1.5" disabled={!input.trim()} aria-label="Send"><ArrowUpIcon /></Button>}
            </div>
          )}
      </form>
    </aside>
  );
}

/** The conversations left behind: open one, rename it, delete it. Text only is said once, here. */
function HistoryList({ history, openId, note, onOpen, onRename, onRemove, onClear }: {
  history: SavedChat[]; openId: string; note: { dropped: number; failed: boolean };
  onOpen: (c: SavedChat) => void; onRename: (id: string, title: string) => void; onRemove: (id: string) => void; onClear: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-2.5 text-sm" aria-label="Earlier conversations">
      <p className="mb-2 text-xs text-muted-foreground">
        Kept in this browser, as text only: your questions and the assistant&apos;s replies, not what the tools returned. The replies can still state facts about a patient.
        The latest {MAX_CONVERSATIONS} conversations are kept, up to {MAX_MESSAGES} messages each.
      </p>
      {note.failed && <p className="mb-2 rounded-md bg-destructive-soft p-2 text-xs text-destructive" role="alert">The history cannot be saved here (the browser&apos;s storage is full or blocked). The conversation on screen still works.</p>}
      {note.dropped > 0 && <p className="mb-2 rounded-md bg-muted p-2 text-xs text-muted-foreground" role="note">{note.dropped} older {note.dropped === 1 ? "conversation was" : "conversations were"} dropped to stay within the limit.</p>}
      {history.length === 0 && <p className="py-6 text-muted-foreground">No earlier conversations yet. A conversation is kept here when you start a new one.</p>}
      <ul className="space-y-1">
        {history.map((c) => (
          <li key={c.id} className={"flex items-center gap-1 rounded-md border p-1.5" + (c.id === openId ? " border-primary" : "")}>
            {editing === c.id
              ? <TitleField initial={c.title} onDone={(t) => { if (t !== null) onRename(c.id, t); setEditing(null); }} />
              : (
                <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => onOpen(c)} aria-label={"Open: " + c.title}>
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(c.updatedAt).toLocaleString()} · {c.messages.length} messages{c.trimmed ? " (earliest dropped)" : ""}{c.id === openId ? " · open now" : ""}
                  </span>
                </button>
              )}
            {editing !== c.id && <Button variant="ghost" size="icon-xs" onClick={() => setEditing(c.id)} data-tip="Rename" aria-label={"Rename: " + c.title}><PencilIcon /></Button>}
            <Button variant="ghost" size="icon-xs" onClick={() => onRemove(c.id)} data-tip="Delete" aria-label={"Delete: " + c.title}><Trash2Icon /></Button>
          </li>
        ))}
      </ul>
      {history.length > 0 && <Button variant="outline" size="sm" className="mt-3 self-start" onClick={onClear}>Clear history</Button>}
    </div>
  );
}

/** A title being typed: the draft stays in this field, and the list changes only when it is accepted. */
function TitleField({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); onDone(draft); }}>
      <Input autoFocus value={draft} maxLength={120} aria-label="Conversation title" onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onDone(null); } }} />
      <Button type="submit" variant="ghost" size="icon-xs" aria-label="Save the title"><CheckIcon /></Button>
    </form>
  );
}

/** A connector call waiting for the reader: where it goes, what it sends, and the two answers. */
function ApprovalCard({ name, input, connectors, onRespond }: {
  name: string; input: unknown; connectors: PublicConnector[]; onRespond: (approved: boolean) => void;
}) {
  const of = fromToolName(name);
  const c = of && connectors.find((x) => x.id === of.id);
  return (
    <div className="space-y-2 rounded-md border border-mark bg-card p-2.5 text-sm" role="group" aria-label="This call needs your approval">
      <div className="flex items-start gap-1.5">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-mark" />
        <p>
          The assistant wants to call <span className="font-mono text-xs">{of?.tool ?? name}</span> on <span className="font-medium">{c?.name ?? of?.id ?? "an external server"}</span>
          {c && <> (<span className="font-mono text-xs">{c.host}</span>)</>}, a server outside this app. This is exactly what it would send:
        </p>
      </div>
      <pre className="max-h-48 overflow-auto rounded-sm bg-muted p-1.5 font-mono text-xs whitespace-pre-wrap break-words">{JSON.stringify(input, null, 2)}</pre>
      <p className="text-xs text-muted-foreground">Deny it if it names a patient or sample, or anything that could identify one person.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onRespond(true)}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => onRespond(false)}>Deny</Button>
      </div>
    </div>
  );
}

/** The connectors: off until switched on, each with its sign-in when it needs one, and what became of it last turn. */
function ConnectorsPanel({ connectors, error, state, status, note, saveFailed, onDismissNote, onSwitch, onDisconnect, onConnect, onSaveToken }: {
  connectors: PublicConnector[]; error: string | null; state: ConnectorState; status: Record<string, ConnectorStatus>; note: string | null; saveFailed: boolean;
  onDismissNote: () => void; onSwitch: (id: string, on: boolean) => void; onDisconnect: (id: string) => void; onConnect: (id: string) => void; onSaveToken: (id: string, token: string) => void;
}) {
  const now = Date.now();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-2.5 text-sm" aria-label="Connectors">
      <p className="mb-2 text-xs text-muted-foreground">
        Connectors are external servers the assistant can ask. They are off until you switch them on. What the assistant writes in a call goes to that server, a third party, and this app cannot check it,
        so you approve every call before it runs, and the assistant is told never to put a patient or sample identifier in one. Switches and sign-ins are kept in this browser only.
      </p>
      {error && <p className="mb-2 rounded-md bg-destructive-soft p-2 text-xs text-destructive" role="alert">The deployment&apos;s connectors could not be read: {error}</p>}
      {note && <p className="mb-2 flex items-start justify-between gap-2 rounded-md bg-muted p-2 text-xs" role="status"><span>{note}</span><button type="button" className="shrink-0 cursor-pointer underline" onClick={onDismissNote}>dismiss</button></p>}
      {saveFailed && <p className="mb-2 rounded-md bg-destructive-soft p-2 text-xs text-destructive" role="alert">This browser would not keep the setting (its storage is full or blocked), so connectors stay off.</p>}
      {!error && connectors.length === 0 && <p className="py-6 text-muted-foreground">This deployment has no connectors.</p>}
      <ul className="space-y-2">
        {connectors.map((c) => {
          const can = canSwitchOn(state, c, now);
          const on = state.on.includes(c.id) && can.ok;
          const s = status[c.id];
          return (
            <li key={c.id} className="space-y-1.5 rounded-md border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{c.name} <span className="font-mono text-xs font-normal text-muted-foreground">{c.host}</span></div>
                  <div className="text-xs text-muted-foreground">{c.what}</div>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs">
                  <Checkbox checked={on} disabled={!can.ok && !on} onCheckedChange={(v) => onSwitch(c.id, v === true)} aria-label={"Switch on " + c.name} />
                  On
                </label>
              </div>
              {c.sendsFreeText && <p className="text-xs text-muted-foreground">It takes free text, so anything the assistant writes in a question leaves this app.</p>}
              {c.auth === "oauth" && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {signedIn(state, c.id, now)
                    ? <><span className="text-ok">Signed in</span><Button size="xs" variant="outline" onClick={() => onDisconnect(c.id)}>Disconnect</Button></>
                    : <><span className="text-muted-foreground">{state.tokens[c.id] ? "Sign-in expired." : "Not signed in."}</span><Button size="xs" onClick={() => onConnect(c.id)}>Connect</Button></>}
                </div>
              )}
              {c.auth === "token" && (
                signedIn(state, c.id, now)
                  ? <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-ok">API token saved in this browser</span><Button size="xs" variant="outline" onClick={() => onDisconnect(c.id)}>Remove token</Button></div>
                  : <TokenField name={c.name} onSave={(t) => onSaveToken(c.id, t)} />
              )}
              {!can.ok && <p className="text-xs text-muted-foreground">Cannot be switched on: {can.why}.</p>}
              {on && s && !s.ok && (
                <p className="text-xs text-destructive" role="alert">
                  Not available at the last message: {s.reason}.
                  {s.signIn && c.auth === "oauth" && <> <button type="button" className="cursor-pointer underline" onClick={() => onConnect(c.id)}>Connect again</button></>}
                  {s.signIn && c.auth === "token" && <> Remove the token and add a good one.</>}
                </p>
              )}
              {on && s?.ok && <p className="text-xs text-muted-foreground">Reached at the last message ({s.tools} {s.tools === 1 ? "tool" : "tools"}).</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** An API token being typed: the draft stays in this field; it is sent only to the connector's own server, in the header it names. */
function TokenField({ name, onSave }: { name: string; onSave: (token: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onSave(draft.trim()); setDraft(""); } }}>
      <Input type="password" autoComplete="off" value={draft} placeholder="Paste your API token" aria-label={"API token for " + name} className="h-7 text-xs" onChange={(e) => setDraft(e.target.value)} />
      <Button type="submit" size="xs" disabled={!draft.trim()}>Save</Button>
    </form>
  );
}
