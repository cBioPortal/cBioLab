// The page's side of stored links (app/_links/link-state.ts), driven with a stand-in browser: an
// address bar, a history and a /api/links server whose answers the test releases when it chooses.
// The rules themselves are test/links.test.ts; the store test/support/store-contracts.ts; the real
// browser test/e2e/links.cjs.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { linkId } from "../lib/link-store.ts";
import type { LinkParams } from "../lib/links.ts";

// ---- a stand-in browser ---------------------------------------------------------------------
type Entry = { url: URL; state: unknown };
const browser = {
  entries: [] as Entry[], at: 0,
  reset(url: string) { this.entries = [{ url: new URL(url, "http://lab.test"), state: null }]; this.at = 0; },
  get now() { return this.entries[this.at]; },
};
const set = (url: string, state: unknown, push: boolean) => {
  const e = { url: new URL(url, browser.now.url), state: structuredClone(state) };
  if (push) { browser.entries = browser.entries.slice(0, browser.at + 1).concat(e); browser.at++; } else browser.entries[browser.at] = e;
};
Object.assign(globalThis, {
  window: globalThis,
  location: { get pathname() { return browser.now.url.pathname; }, get search() { return browser.now.url.search; }, get hash() { return browser.now.url.hash; } },
  history: {
    get state() { return browser.now.state; },
    pushState: (s: unknown, _: string, u: string) => set(u, s, true),
    replaceState: (s: unknown, _: string, u: string) => set(u, s, false),
  },
});

// ---- a stand-in /api/links ------------------------------------------------------------------
const server = {
  links: new Map<string, LinkParams>(),
  posts: 0, fail: null as string | null,
  /** answers wait for this when set */
  hold: null as Promise<void> | null,
};
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  if (server.hold) await server.hold;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (input === "/api/links" && init?.method === "POST") {
    server.posts++;
    if (server.fail) return json({ error: server.fail }, 500);
    const { params } = JSON.parse(String(init.body));
    const id = linkId(params);
    server.links.set(id, params);
    return json({ id }, 201);
  }
  const m = /^\/api\/links\/(.+)$/.exec(input);
  if (m) { const p = server.links.get(decodeURIComponent(m[1])); return p ? json({ id: m[1], params: p }) : json({ error: "no stored link" }, 404); }
  return json({ error: "unexpected " + input }, 500);
}) as typeof fetch;

const { writeSearch, flushLink, linkParams, openLink, linkTo, onLinkProblem, currentLinkUrlMax, currentLinkIdleMs, knownLink } = await import("../app/_links/link-state.ts");

/** wait until the stand-in server has answered and the page has acted on it */
const settle = () => new Promise((r) => setTimeout(r, 20));
const LONG = "1." + "y".repeat(400);
const MAX = 300;

beforeEach(() => {
  browser.reset("/lab?tab=analysis");
  server.posts = 0; server.fail = null; server.hold = null;
  (globalThis as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax = MAX;
  // store at once unless a test is about waiting
  (globalThis as { __cbioLinkIdleMs?: number }).__cbioLinkIdleMs = 0;
});

describe("writing the page's URL", () => {
  test("a short URL is written as it is and nothing is stored", async () => {
    writeSearch("?tab=analysis&doc=short", { push: true });
    await settle();
    assert.equal(location.search, "?tab=analysis&doc=short");
    assert.equal(browser.entries.length, 2);
    assert.equal(server.posts, 0);
  });

  test("a long one is stored, and the entry becomes ?s= plus the short parameters, keeping its own state", async () => {
    writeSearch("?tab=analysis&doc=" + LONG, { push: true, state: { labDepth: 3 } });
    assert.ok(location.search.includes("doc="), "written in full at once; shortened once stored");
    await settle();
    assert.match(location.search, /^\?s=[A-Za-z0-9_-]{22}&tab=analysis$/);
    assert.equal((history.state as { labDepth: number }).labDepth, 3);
    assert.equal(linkParams().get("doc"), LONG, "the page still reads what it wrote");
    assert.equal(browser.entries.length, 2, "one history entry, rewritten in place");
  });

  test("a write made while the link was being stored wins: the older answer does not overwrite it", async () => {
    let release!: () => void;
    server.hold = new Promise((r) => { release = r; });
    writeSearch("?doc=" + LONG + "a");
    writeSearch("?tab=explore");
    release();
    await settle();
    assert.equal(location.search, "?tab=explore");
  });

  test("a write beside a stored link keeps what the link held", async () => {
    writeSearch("?tab=analysis&doc=" + LONG + "b&changes=" + LONG);
    await settle();
    const q = linkParams();
    q.set("changes", "small");
    writeSearch("?" + q.toString());
    await settle();
    assert.equal(linkParams().get("doc"), LONG + "b", "the stored doc survived a write that only changed ?changes=");
    assert.equal(linkParams().get("changes"), "small");
  });

  test("a store that fails leaves the long URL and says so; the next one that works clears it", async () => {
    const heard: unknown[] = [];
    const off = onLinkProblem((p) => heard.push(p));
    server.fail = "the database is down";
    writeSearch("?doc=" + LONG + "c");
    await settle();
    assert.ok(location.search.startsWith("?doc="));
    assert.deepEqual(heard.at(-1), { length: location.search.length, error: "the database is down" });
    server.fail = null;
    writeSearch("?doc=" + LONG + "d");
    await settle();
    assert.equal(heard.at(-1), null);
    off();
  });

  test("a run of edits to a long page is stored once, when the page is idle", async () => {
    (globalThis as { __cbioLinkIdleMs?: number }).__cbioLinkIdleMs = 60;
    for (const x of ["f1", "f2", "f3"]) { writeSearch("?doc=" + LONG + x, { push: true }); await settle(); }
    assert.equal(server.posts, 0, "nothing stored while the reader is still editing");
    assert.ok(location.search.startsWith("?doc="), "the long URL works meanwhile");
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(server.posts, 1);
    assert.match(location.search, /^\?s=/);
    assert.equal(linkParams().get("doc"), LONG + "f3", "the last edit is the one stored");
  });

  test("flushLink stores a waiting link at once, for a page about to copy its address", async () => {
    (globalThis as { __cbioLinkIdleMs?: number }).__cbioLinkIdleMs = 60_000;
    writeSearch("?doc=" + LONG + "g");
    await flushLink();
    assert.equal(server.posts, 1);
    assert.match(location.search, /^\?s=/);
    await flushLink();
    assert.equal(server.posts, 1, "nothing waits any more");
  });

  test("Back to a shortened entry reads it from that entry's own state, without the server", async () => {
    writeSearch("?doc=" + LONG + "e", { push: true });
    await settle();
    const id = new URLSearchParams(location.search).get("s")!;
    writeSearch("?tab=other", { push: true });
    browser.at--;   // Back
    assert.equal(knownLink(id)?.doc, LONG + "e");
  });
});

describe("opening and making links", () => {
  test("a stored link is read once and then remembered", async () => {
    server.links.set("abcdefghijklmnopqrstu1", { doc: "opened" });
    assert.deepEqual(await openLink("abcdefghijklmnopqrstu1"), { doc: "opened" });
    server.links.delete("abcdefghijklmnopqrstu1");
    assert.deepEqual(await openLink("abcdefghijklmnopqrstu1"), { doc: "opened" });
    await assert.rejects(openLink("abcdefghijklmnopqrstu2"), /no stored link/);
  });

  test("a link to another page is short however much it carries", async () => {
    assert.equal(await linkTo("/portal/comparison", { doc: "small" }), "/portal/comparison?doc=small");
    const url = await linkTo("/portal/comparison", { doc: LONG, off: "x" });
    assert.match(url, /^\/portal\/comparison\?s=[A-Za-z0-9_-]{22}&off=x$/);
  });

  test("the limit is the deployment's, unless a test sets its own", () => {
    delete (globalThis as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax;
    assert.equal(currentLinkUrlMax(), 8000);
    delete (globalThis as { __cbioLinkIdleMs?: number }).__cbioLinkIdleMs;
    assert.equal(currentLinkIdleMs(), 1500);
  });
});
