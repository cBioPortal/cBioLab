// The chat connectors' registry and the browser's state about them (lib/chat-connectors.ts,
// lib/chat-connector-state.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONNECTORS, connectorInstructions, fromToolName, parseConnectors, publicConnector, toolName, tokenHeader, validToolName
} from "../lib/chat-connectors.ts";
import { canSwitchOn, loadState, requestEntries, saveState, signedIn, withOn, withToken, CONNECTORS_KEY } from "../lib/chat-connector-state.ts";

const entry = (o: object = {}) => ({ id: "x", name: "X", url: "https://x.example/mcp", auth: "none", what: "something", sendsFreeText: false, ...o });

describe("the connector registry", () => {
  test("the defaults are OpenEvidence (an API token in x-api-token) and cBioPortal MCP (OAuth), https only", () => {
    assert.deepEqual(DEFAULT_CONNECTORS.map((c) => [c.id, c.auth]), [["openevidence", "token"], ["cbioportal", "oauth"]]);
    assert.equal(DEFAULT_CONNECTORS[0].tokenHeader, "x-api-token");
    assert.ok(DEFAULT_CONNECTORS.every((c) => c.url.startsWith("https://")));
    assert.deepEqual(parseConnectors(undefined), DEFAULT_CONNECTORS);
    assert.deepEqual(parseConnectors("  "), DEFAULT_CONNECTORS);
  });
  test("a token connector keeps its header; the others carry none", () => {
    const [t] = parseConnectors(JSON.stringify([entry({ auth: "token", tokenHeader: "x-key" })]));
    assert.equal(t.tokenHeader, "x-key");
    assert.ok(!("tokenHeader" in parseConnectors(JSON.stringify([entry()]))[0]));
  });
  test("a token goes in the header the connector names; OAuth and Authorization ones carry a bearer token; an open one none", () => {
    assert.deepEqual(tokenHeader({ auth: "token", tokenHeader: "x-api-token" }, "T"), { "x-api-token": "T" });
    assert.deepEqual(tokenHeader({ auth: "token", tokenHeader: "Authorization" }, "T"), { Authorization: "Bearer T" });
    assert.deepEqual(tokenHeader({ auth: "oauth" }, "T"), { Authorization: "Bearer T" });
    assert.deepEqual(tokenHeader({ auth: "none" }, "T"), {});
  });
  test("a deployment's own list replaces the defaults", () => {
    assert.deepEqual(parseConnectors(JSON.stringify([entry()])).map((c) => c.id), ["x"]);
  });
  test("an empty list offers none (how a deployment turns connectors off)", () => assert.deepEqual(parseConnectors("[]"), []));
  test("a malformed entry is an error naming it, never skipped", () => {
    const bad = (o: object, re: RegExp) => assert.throws(() => parseConnectors(JSON.stringify([entry(), entry({ id: "y", ...o })])), re);
    bad({ url: "http://y.example/mcp" }, /CHAT_CONNECTORS\[1\] \(y\): url must be https/);
    bad({ url: "nope" }, /not a URL/);
    bad({ auth: "basic" }, /auth is "none", "oauth" or "token"/);
    bad({ auth: "token" }, /names the header its token goes in/);
    bad({ auth: "token", tokenHeader: "bad header" }, /names the header/);
    bad({ id: "Bad Id" }, /id is 1–24/);
    bad({ id: "x" }, /id is used twice/);
    bad({ what: " " }, /what is required/);
    bad({ sendsFreeText: "yes" }, /sendsFreeText/);
    bad({ tools: "a" }, /tools is a list/);
    assert.throws(() => parseConnectors("{"), /not JSON/);
    assert.throws(() => parseConnectors("{}"), /must be a JSON array/);
  });
  test("the browser is told a host, not the URL", () => {
    const p = publicConnector(DEFAULT_CONNECTORS[1]);
    assert.equal(p.host, "mcp.cbioportal.org");
    assert.ok(!("url" in p));
  });
});

describe("tool names", () => {
  test("a connector tool is namespaced, so it cannot shadow a page tool, and read back", () => {
    assert.equal(toolName("openevidence", "ask_openevidence"), "openevidence__ask_openevidence");
    assert.deepEqual(fromToolName("openevidence__ask_openevidence"), { id: "openevidence", tool: "ask_openevidence" });
    assert.equal(fromToolName("portal_get_page"), null);
    assert.equal(fromToolName("analysis_get_results"), null);
  });
  test("a name over 64 characters, or with a character the model API refuses, is not valid", () => {
    assert.equal(validToolName("a".repeat(64)), true);
    assert.equal(validToolName("a".repeat(65)), false);
    assert.equal(validToolName("a.b"), false);
  });
});

describe("what the model is told", () => {
  test("nothing when no connector is on", () => assert.equal(connectorInstructions([], []), ""));
  test("the connectors that answered, the no-identifiers rule, and those that did not", () => {
    const [oe, cb] = DEFAULT_CONNECTORS;
    const t = connectorInstructions([oe, cb], [{ id: "openevidence", ok: true, tools: 1 }, { id: "cbioportal", ok: false, tools: 0, reason: "sign in again" }]);
    assert.match(t, /openevidence \(OpenEvidence: clinical questions/);
    assert.ok(!/cbioportal \(cBioPortal MCP/.test(t.split("Not available")[0]), "an unreachable connector is not offered");
    assert.match(t, /never include a patient or sample identifier/);
    assert.match(t, /Not available this turn: cBioPortal MCP \(sign in again\)/);
    assert.match(t, /do not repeat it with the same arguments/);
  });
});

describe("the browser's connector state", () => {
  const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  test("nothing is on and nobody is signed in until the reader says so", () => {
    assert.deepEqual(loadState(mem()), { on: [], tokens: {} });
    assert.deepEqual(loadState(null), { on: [], tokens: {} });
    assert.deepEqual(loadState({ getItem: () => "{bad", setItem: () => {} }), { on: [], tokens: {} });
  });
  test("what is saved is read back; a full store says so", () => {
    const s = mem();
    const st = withToken(withOn({ on: [], tokens: {} }, "openevidence", true), "cbioportal", { token: "t", expiresAt: 5 });
    assert.equal(saveState(s, st), true);
    assert.deepEqual(loadState(s), st);
    assert.equal(saveState({ getItem: () => null, setItem: () => { throw new Error("Quota"); } }, st), false);
    assert.equal(saveState(null, st), false);
  });
  test("damaged tokens and ons are dropped on reading", () => {
    const s = mem();
    s.m.set(CONNECTORS_KEY, JSON.stringify({ on: ["a", 3, null], tokens: { a: { token: "" }, b: { token: "t" }, c: 4 } }));
    assert.deepEqual(loadState(s), { on: ["a"], tokens: { b: { token: "t" } } });
  });
  test("an OAuth connector needs a sign-in that has not run out, a token one a token; an open one neither", () => {
    const [oe, cb] = DEFAULT_CONNECTORS;
    const empty = { on: [], tokens: {} };
    assert.deepEqual(canSwitchOn(empty, { id: "open", auth: "none" }, 10), { ok: true });
    assert.deepEqual(canSwitchOn(empty, oe, 10), { ok: false, why: "add your API token first" });
    assert.deepEqual(canSwitchOn(withToken(empty, "openevidence", { token: "k" }), oe, 10), { ok: true });
    assert.deepEqual(canSwitchOn(empty, cb, 10), { ok: false, why: "connect (sign in) first" });
    assert.deepEqual(canSwitchOn(withToken(empty, "cbioportal", { token: "t", expiresAt: 20 }), cb, 10), { ok: true });
    assert.deepEqual(canSwitchOn(withToken(empty, "cbioportal", { token: "t", expiresAt: 5 }), cb, 10), { ok: false, why: "the sign-in has expired: connect again" });
    assert.equal(signedIn(withToken(empty, "cbioportal", { token: "t" }), "cbioportal", 1e15), true, "no expiry given, none assumed");
  });
  test("signing out switches the connector off", () => {
    const st = withToken(withOn(withOn({ on: [], tokens: {} }, "cbioportal", true), "openevidence", true), "cbioportal", { token: "tok", expiresAt: 100 });
    assert.deepEqual(withToken(st, "cbioportal", null).on, ["openevidence"]);
  });
  test("a request names what is on and may be, each with its token", () => {
    const st = withToken(withToken(withOn(withOn({ on: [], tokens: {} }, "cbioportal", true), "openevidence", true), "openevidence", { token: "k" }), "cbioportal", { token: "tok", expiresAt: 100 });
    assert.deepEqual(requestEntries(st, DEFAULT_CONNECTORS, 10), [{ id: "openevidence", token: "k" }, { id: "cbioportal", token: "tok" }]);
    assert.deepEqual(requestEntries(st, DEFAULT_CONNECTORS, 200), [{ id: "openevidence", token: "k" }], "a sign-in that has run out is not named");
    assert.deepEqual(requestEntries(withOn({ on: [], tokens: {} }, "x", true), DEFAULT_CONNECTORS, 1), [], "an id the deployment does not have is not named");
  });
  test("one stored as on that has no credential is not named, as the panel shows it off (it was: 'no API token' on every message)", () => {
    const st = withOn({ on: [], tokens: {} }, "openevidence", true);
    assert.deepEqual(st.on, ["openevidence"]);
    assert.deepEqual(requestEntries(st, DEFAULT_CONNECTORS, 10), []);
    assert.deepEqual(requestEntries(withToken(st, "openevidence", { token: "k" }), DEFAULT_CONNECTORS, 10), [{ id: "openevidence", token: "k" }], "and is named once it has one");
  });
});
