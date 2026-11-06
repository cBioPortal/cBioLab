// The chat sidebar's history (lib/chat-history.ts): text only, capped, and safe when storage is not.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_KEY, MAX_CONVERSATIONS, MAX_MESSAGES, TITLE_CHARS, loadHistory, removed, renamed, saveHistory, textOnly, titleOf, toMessages,
  withConversation, type Conversation, type StoredMessage
} from "../lib/chat-history.ts";

const user = (text: string, id = "u"): StoredMessage => ({ id, role: "user", text, tools: [] });
const bot = (text: string, id = "a"): StoredMessage => ({ id, role: "assistant", text, tools: [] });

describe("what a saved conversation keeps", () => {
  test("text parts stay; tool inputs and results go; only the tool names remain", () => {
    const kept = textOnly([
      { id: "1", role: "user", parts: [{ type: "text", text: "who is this?" }] },
      { id: "2", role: "assistant", parts: [
        { type: "reasoning", text: "thinking about patient P-1" },
        { type: "tool-portal_get_page", text: undefined },
        { type: "dynamic-tool", toolName: "portal_get_tab_results" },
        { type: "tool-portal_get_page" },
        { type: "text", text: "A woman with breast cancer." }] }
    ] as never);
    assert.deepEqual(kept, [
      { id: "1", role: "user", text: "who is this?", tools: [] },
      { id: "2", role: "assistant", text: "A woman with breast cancer.", tools: ["portal_get_page", "portal_get_tab_results"] }
    ]);
    assert.ok(!JSON.stringify(kept).includes("thinking about"), "reasoning is not kept");
  });
  test("a message with nothing in it is not kept; system messages are not kept", () => {
    assert.deepEqual(textOnly([{ id: "1", role: "assistant", parts: [{ type: "step-start" }] }, { id: "2", role: "system", parts: [{ type: "text", text: "x" }] }] as never), []);
  });
  test("reopened, a conversation is text with its tool names and its date in metadata", () => {
    const c: Conversation = { id: "c", title: "t", updatedAt: "2026-11-03T10:00:00Z", messages: [user("q"), { ...bot("a"), tools: ["portal_get_page"] }] };
    const m = toMessages(c);
    assert.deepEqual(m[1].parts, [{ type: "text", text: "a" }]);
    assert.deepEqual(m[1].metadata, { tools: ["portal_get_page"], earlier: "2026-11-03T10:00:00Z" });
  });
});

describe("titles", () => {
  test("the first question's first line, cut to the limit with an ellipsis", () => {
    assert.equal(titleOf([user("What is KRAS?\nmore")]), "What is KRAS?");
    const t = titleOf([user("x".repeat(200))]);
    assert.equal(t.length, TITLE_CHARS);
    assert.ok(t.endsWith("…"));
  });
  test("no question, no title", () => assert.equal(titleOf([bot("hello")]), "Untitled conversation"));
});

describe("the history list", () => {
  test("newest first; writing a conversation again replaces it and keeps a rename", () => {
    let h = withConversation([], "a", [user("first")], "t1").history;
    h = withConversation(h, "b", [user("second")], "t2").history;
    assert.deepEqual(h.map((c) => c.id), ["b", "a"]);
    h = renamed(h, "a", "My title");
    h = withConversation(h, "a", [user("first"), bot("reply")], "t3").history;
    assert.deepEqual(h.map((c) => c.id), ["a", "b"]);
    assert.equal(h[0].title, "My title");
    assert.equal(h[0].messages.length, 2);
  });
  test("an empty conversation is not kept, and leaves the list without it", () => {
    const h = withConversation([], "a", [user("q")], "t").history;
    assert.deepEqual(withConversation(h, "a", [], "t").history, []);
  });
  test("past the cap the oldest go, and are counted", () => {
    let h: Conversation[] = [];
    let dropped = 0;
    for (let i = 0; i < MAX_CONVERSATIONS + 3; i++) ({ history: h, dropped } = withConversation(h, "c" + i, [user("q" + i)], "t" + i));
    assert.equal(h.length, MAX_CONVERSATIONS);
    assert.equal(dropped, 1);
    assert.equal(h[0].id, "c" + (MAX_CONVERSATIONS + 2));
    assert.ok(!h.some((c) => c.id === "c0"));
  });
  test("a conversation over the message cap is cut from the front, to start at a question, and marked", () => {
    const long: StoredMessage[] = [];
    for (let i = 0; i < MAX_MESSAGES; i++) long.push(i % 2 ? bot("a" + i, "a" + i) : user("q" + i, "u" + i));
    long.push(bot("extra", "x"));
    const c = withConversation([], "a", long, "t").history[0];
    assert.equal(c.trimmed, true);
    assert.ok(c.messages.length <= MAX_MESSAGES);
    assert.equal(c.messages[0].role, "user");
    assert.equal(c.messages.at(-1)!.text, "extra");
  });
  test("remove and rename; a blank rename changes nothing", () => {
    const h = withConversation([], "a", [user("q")], "t").history;
    assert.equal(renamed(h, "a", "  ")[0].title, "q");
    assert.deepEqual(removed(h, "a"), []);
  });
});

describe("the store", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  test("what is saved is read back", () => {
    const s = mem();
    const h = withConversation([], "a", [user("q"), bot("a")], "t").history;
    assert.equal(saveHistory(s, h), true);
    assert.deepEqual(loadHistory(s), h);
  });
  test("a full or blocked store says so; a missing or damaged one reads as empty", () => {
    assert.equal(saveHistory({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }, []), false);
    assert.equal(saveHistory(null, []), false);
    assert.deepEqual(loadHistory(null), []);
    assert.deepEqual(loadHistory({ getItem: () => "{not json", setItem: () => {} }), []);
    assert.deepEqual(loadHistory({ getItem: (k) => k === HISTORY_KEY ? JSON.stringify([{ id: 1 }, { id: "ok", messages: [] }, null]) : null, setItem: () => {} }).map((c) => c.id), ["ok"]);
  });
});
