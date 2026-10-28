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
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { ArrowUpIcon, MessageSquareIcon, RotateCcwIcon, SquareIcon, SquarePenIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/app/_ui/button";
import { Textarea } from "@/app/_ui/textarea";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/app/_ui/ai/conversation";
import { Message, MessageContent, MessageResponse } from "@/app/_ui/ai/message";
import { Reasoning } from "@/app/_ui/ai/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, type ToolPart } from "@/app/_ui/ai/tool";

const STORE = "cohortlab.chat";
const OPEN = "cohortlab.chat.open";

interface ChatInfo { enabled: boolean; signInRequired: boolean; model: string | null }
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

/** The page's tools, waiting briefly for a page that registers them after it mounts. */
async function waitForPage(ms = 10000): Promise<PageApi | null> {
  const t0 = Date.now();
  while (!pageApi() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
  return pageApi();
}

export function ChatSidebar() {
  const [info, setInfo] = useState<ChatInfo | null>(null);
  useEffect(() => {
    fetch("/api/chat").then((r) => r.ok ? r.json() : null).then(setInfo, () => setInfo(null));
  }, []);
  if (!info?.enabled) return null;
  return <ChatPanel info={info} />;
}

function ChatPanel({ info }: { info: ChatInfo }) {
  const [open, setOpenState] = useState<boolean>(() => stored(OPEN, false));
  const setOpen = (v: boolean) => { setOpenState(v); store(OPEN, v); };
  const [input, setInput] = useState("");
  const initial = useMemo(() => stored<UIMessage[]>(STORE, []), []);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages }) => {
      const p = pageApi();
      return { body: { messages, page: p?.page ?? location.pathname, tools: p?.tools ?? [] } };
    }
  }), []);

  const { messages, sendMessage, addToolOutput, status, error, stop, setMessages, regenerate, clearError } = useChat({
    id: "sidebar",
    messages: initial,
    transport,
    throttle: 50,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
  const newChat = () => { void stop(); setMessages([]); clearError(); store(STORE, null); };

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
        <Button variant="ghost" size="icon-sm" onClick={newChat} data-tip="New conversation" aria-label="New conversation"><SquarePenIcon /></Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} data-tip="Close" aria-label="Close the assistant"><XIcon /></Button>
      </div>

      <Conversation>
        <ConversationContent>
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
