// The page's side of stored links (app/_links/link-state.ts), driven with a stand-in browser: an
// address bar, a history and a /api/links server whose answers the test can hold or fail.
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
  location: {
    get origin() { return browser.now.url.origin; }, get pathname() { return browser.now.url.pathname; },
    get search() { return browser.now.url.search; }, get hash() { return browser.now.url.hash; },
  },
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
};
globalThis.fetch = (async (input: string, init?: RequestInit) => {
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

const { writeSearch, copyLink, linkParams, heldElsewhere, currentHeld, openLink, linkTo, onHeld, currentLinkUrlMax, knownLink } =
  await import("../app/_links/link-state.ts");

const MAX = 300;
/** a long parameter, different each time so no test sees another's stored link */
let n = 0;
const long = () => "1." + "y".repeat(400) + (n++);
const HELD = /^\?(.*&)?long=[0-9a-z]+$/;

beforeEach(() => {
  browser.reset("/lab?tab=analysis");
  server.posts = 0; server.fail = null;
  (globalThis as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax = MAX;
});

describe("writing the page's URL", () => {
  test("a URL up to the limit is written as it is, and nothing is stored", () => {
    writeSearch("?tab=analysis&doc=short", { push: true });
    assert.equal(location.search, "?tab=analysis&doc=short");
    assert.equal(browser.entries.length, 2);
    assert.equal(server.posts, 0);
    assert.equal(currentHeld(), null);
  });

  test("past the limit the long parameters are held in the entry, the address says so, and nothing is stored", () => {
    const heard: unknown[] = [];
    const off = onHeld((h) => heard.push(h));
    const doc = long();
    writeSearch("?tab=analysis&doc=" + doc, { push: true, state: { labDepth: 3 } });
    assert.match(location.search, HELD);
    assert.ok(location.search.startsWith("?tab=analysis&"), "the short parameters stay readable");
    assert.equal(linkParams().get("doc"), doc, "the page still reads what it wrote");
    assert.equal((history.state as { labDepth: number }).labDepth, 3);
    assert.equal(server.posts, 0);
    assert.deepEqual(heard.at(-1), { length: ("?tab=analysis&doc=" + doc).length });
    assert.deepEqual(currentHeld(), heard.at(-1));
    off();
  });

  test("each edit changes the address's mark, so a page re-reads its parameters; a run of edits stores nothing", () => {
    const marks = new Set<string>();
    for (let i = 0; i < 3; i++) { writeSearch("?doc=" + long(), { push: true }); marks.add(location.search); }
    assert.equal(marks.size, 3);
    assert.equal(server.posts, 0);
  });

  test("a write beside held parameters keeps them", () => {
    const doc = long();
    writeSearch("?tab=analysis&doc=" + doc + "&changes=" + long());
    const q = linkParams();
    q.set("changes", "small");
    writeSearch("?" + q.toString());
    assert.equal(linkParams().get("doc"), doc);
    assert.equal(linkParams().get("changes"), "small");
  });

  test("a reload keeps the held parameters (history.state survives it); Back returns to an earlier entry's", () => {
    const a = long(), b = long();
    writeSearch("?doc=" + a, { push: true });
    writeSearch("?doc=" + b, { push: true });
    browser.at--;   // Back
    assert.equal(linkParams().get("doc"), a);
    browser.entries[browser.at] = { ...browser.now, state: structuredClone(browser.now.state) };   // a reload: the same entry, the same state
    assert.equal(linkParams().get("doc"), a);
  });

  test("an address holding nothing here (copied from another browser) is told apart, not read as empty", () => {
    writeSearch("?tab=analysis&doc=" + long());
    const copied = location.search;
    browser.reset("/lab" + copied);   // another browser: the address, without its history entry
    assert.ok(heldElsewhere(location.search));
    assert.equal(linkParams().get("doc"), null);
    assert.equal(currentHeld(), null);
  });
});

describe("copying a link", () => {
  test("a long page's link is stored once, and the address becomes the link it copied", async () => {
    const doc = long();
    writeSearch("?tab=analysis&doc=" + doc, { push: true });
    const url = await copyLink();
    assert.match(url, /^http:\/\/lab\.test\/lab\?s=[A-Za-z0-9_-]{22}&tab=analysis$/);
    assert.equal(location.search, new URL(url).search);
    assert.equal(server.posts, 1);
    assert.equal(linkParams().get("doc"), doc);
    assert.equal(currentHeld(), null);
    assert.equal(await copyLink(), url);
    assert.equal(server.posts, 1, "the same page copied again is not stored again");
  });

  test("a page of a link already made keeps that link as the reader moves between tabs", async () => {
    writeSearch("?tab=analysis&doc=" + long());
    const url = await copyLink();
    const q = linkParams();
    q.set("tab", "explore");
    writeSearch("?" + q.toString());
    assert.equal(location.search, new URL(url).search.replace("tab=analysis", "tab=explore"));
    const edited = linkParams();
    edited.set("doc", long());
    writeSearch("?" + edited.toString());
    assert.match(location.search, HELD, "an edit to the long parameters is no longer that link");
  });

  test("a link under the limit is shortened too when it holds a long parameter; one with none is copied as it is", async () => {
    (globalThis as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax = 5000;
    writeSearch("?tab=analysis&doc=" + long());
    assert.ok(location.search.includes("doc="), "under the limit, the address carries it");
    assert.match(await copyLink(), /\?s=[A-Za-z0-9_-]{22}&tab=analysis$/);
    writeSearch("?tab=examples");
    assert.equal(await copyLink(), "http://lab.test/lab?tab=examples");
    assert.equal(server.posts, 1);
  });

  test("a store that fails is said, and the address is left as it was", async () => {
    writeSearch("?doc=" + long());
    const before = location.search;
    server.fail = "the database is down";
    await assert.rejects(copyLink(), /the database is down/);
    assert.equal(location.search, before);
  });
});

describe("opening and making links", () => {
  test("a stored link is read once and then remembered", async () => {
    server.links.set("abcdefghijklmnopqrstu1", { doc: "opened" });
    assert.deepEqual(await openLink("abcdefghijklmnopqrstu1"), { doc: "opened" });
    server.links.delete("abcdefghijklmnopqrstu1");
    assert.deepEqual(await openLink("abcdefghijklmnopqrstu1"), { doc: "opened" });
    assert.deepEqual(knownLink("abcdefghijklmnopqrstu1"), { doc: "opened" });
    await assert.rejects(openLink("abcdefghijklmnopqrstu2"), /no stored link/);
  });

  test("a link to another page is short however much it carries", async () => {
    assert.equal(await linkTo("/portal/comparison", { doc: "small" }), "/portal/comparison?doc=small");
    const url = await linkTo("/portal/comparison", { doc: long(), off: "x" });
    assert.match(url, /^\/portal\/comparison\?s=[A-Za-z0-9_-]{22}&off=x$/);
  });

  test("the limit is the deployment's, unless a test sets its own", () => {
    delete (globalThis as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax;
    assert.equal(currentLinkUrlMax(), 8000);
  });
});
