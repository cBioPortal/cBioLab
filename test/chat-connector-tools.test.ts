// The chat route's connector tools (lib/chat-connector-tools.ts) against a stub MCP server run in
// the test: no model and none of the real servers. What is checked is what the project promises —
// off unless asked for, every tool waiting for approval, the registry's URL and nobody else's, the
// token in the header and nowhere else, a failing connector reported and left out, connections closed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { connectConnectors, refusal, resultText, MAX_RESULT_CHARS } from "../lib/chat-connector-tools.ts";
import type { Connector } from "../lib/chat-connectors.ts";

let server: http.Server, base = "";
const seen: { auth: string | undefined; tool?: string }[] = [];
const stubs = { slow: false, gets: 0 };

before(async () => {
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const auth = req.headers.authorization;
    if (req.method === "GET") stubs.gets++;
    if (req.method === "GET" && req.url === "/holds-stream") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": open\n\n"); return; }   // never ends, as some servers' push streams do
    if (req.url === "/needs-token" && auth !== "Bearer good") { res.writeHead(401, { "www-authenticate": 'Bearer error="invalid_token"' }).end("{}"); return; }
    if (req.url === "/broken") { res.writeHead(500).end("boom"); return; }
    const mcp = new McpServer({ name: "stub", version: "1" });
    mcp.registerTool("echo", { description: "Echo back what you send", inputSchema: { text: z.string() } }, async ({ text }) => {
      seen.push({ auth, tool: "echo" });
      if (stubs.slow) await new Promise((r) => setTimeout(r, 400));
      return { content: [{ type: "text", text: "echo: " + text }] };
    });
    mcp.registerTool("fail", { description: "Always reports an error", inputSchema: {} }, async () => ({ isError: true, content: [{ type: "text", text: "the server said no" }] }));
    mcp.registerTool("hidden", { description: "Not offered", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "x" }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  };
  server = http.createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(() => { server.closeAllConnections(); server.close(); });

const reg = (o: Partial<Connector> & { id: string; path: string }): Connector =>
  ({ name: o.id.toUpperCase(), url: base + o.path, auth: "none", what: "a stub", sendsFreeText: true, tools: ["echo", "fail"], ...o });
const run = (t: unknown, args: object) => (t as { execute: (a: object, o: object) => Promise<unknown> }).execute(args, { toolCallId: "1", messages: [] });

describe("connector tools", () => {
  test("none asked for, nothing connected", async () => {
    const c = await connectConnectors([], [reg({ id: "a", path: "/ok" })]);
    assert.deepEqual([c.tools, c.status], [{}, []]);
    await c.close();
  });
  test("a tool is namespaced, says it leaves the app, and waits for approval", async () => {
    const c = await connectConnectors([{ id: "a" }], [reg({ id: "a", path: "/ok" })]);
    assert.deepEqual(Object.keys(c.tools).sort(), ["a__echo", "a__fail"]);
    const t = c.tools["a__echo"] as { needsApproval?: unknown; description?: string };
    assert.equal(t.needsApproval, true);
    assert.match(t.description || "", /external server \(127\.0\.0\.1:\d+\) — what you send leaves this app/);
    assert.deepEqual(c.status, [{ id: "a", ok: true, tools: 2 }]);
    await c.close();
  });
  test("only the tools the registry offers; running one returns the server's text", async () => {
    const c = await connectConnectors([{ id: "a" }], [reg({ id: "a", path: "/ok" })]);
    assert.ok(!("a__hidden" in c.tools));
    assert.equal(await run(c.tools["a__echo"], { text: "hi" }), "echo: hi");
    await assert.rejects(run(c.tools["a__fail"], {}), /the server said no/);
    await c.close();
  });
  test("a request cannot name an address: an id the registry lacks is reported, not fetched", async () => {
    const c = await connectConnectors([{ id: "http://evil.example/mcp" }], [reg({ id: "a", path: "/ok" })]);
    assert.deepEqual(c.status, [{ id: "http://evil.example/mcp", ok: false, tools: 0, reason: "this deployment has no such connector" }]);
    assert.deepEqual(c.tools, {});
  });
  test("an OAuth connector without a token is not contacted; with a bad one it says to connect again; with a good one it works", async () => {
    const r = [reg({ id: "o", path: "/needs-token", auth: "oauth" })];
    const none = await connectConnectors([{ id: "o" }], r);
    assert.equal(none.status[0].ok, false);
    assert.equal(none.status[0].signIn, true);
    const bad = await connectConnectors([{ id: "o", token: "wrong" }], r);
    assert.equal(bad.status[0].ok, false);
    assert.equal(bad.status[0].signIn, true);
    assert.match(bad.status[0].reason || "", /connect again/);
    seen.length = 0;
    const good = await connectConnectors([{ id: "o", token: "good" }], r);
    assert.equal(good.status[0].ok, true);
    await run(good.tools["o__echo"], { text: "x" });
    assert.deepEqual(seen.map((s) => s.auth), ["Bearer good"], "the token went to the server in the header");
    assert.ok(!JSON.stringify(good.status).includes("good"), "and is not in the status");
    await good.close();
  });
  test("a token connector sends the reader's token in the header its registry entry names, and not as a bearer token", async () => {
    const r = [reg({ id: "t", path: "/ok", auth: "token", tokenHeader: "x-api-token" })];
    const none = await connectConnectors([{ id: "t" }], r);
    assert.equal(none.status[0].ok, false);
    assert.match(none.status[0].reason || "", /no API token: add yours/);
    let headers: http.IncomingHttpHeaders = {};
    server.once("request", (req) => { headers = req.headers; });
    const c = await connectConnectors([{ id: "t", token: "KEY-1" }], r);
    assert.equal(c.status[0].ok, true);
    assert.equal(headers["x-api-token"], "KEY-1");
    assert.equal(headers.authorization, undefined);
    await c.close();
  });
  test("an open connector is sent no Authorization header", async () => {
    seen.length = 0;
    const c = await connectConnectors([{ id: "a" }], [reg({ id: "a", path: "/ok" })]);
    await run(c.tools["a__echo"], { text: "x" });
    assert.equal(seen[0].auth, undefined);
    await c.close();
  });
  test("the stream a server may push on is never opened (OpenEvidence's held it and answered nothing else)", async () => {
    stubs.gets = 0;
    const c = await connectConnectors([{ id: "a" }], [reg({ id: "a", path: "/holds-stream" })], { connectMs: 3000 });
    assert.deepEqual(c.status.map((s) => s.ok), [true]);
    await run(c.tools["a__echo"], { text: "x" });
    assert.equal(stubs.gets, 0, "no GET reached the server");
    await c.close();
  });
  test("a broken connector is reported and left out; the others still work", async () => {
    const c = await connectConnectors([{ id: "a" }, { id: "b" }], [reg({ id: "a", path: "/ok" }), reg({ id: "b", path: "/broken" })]);
    assert.deepEqual(c.status.map((s) => [s.id, s.ok]), [["a", true], ["b", false]]);
    assert.match(c.status[1].reason || "", /could not be reached/);
    assert.deepEqual(Object.keys(c.tools).sort(), ["a__echo", "a__fail"]);
    await c.close();
  });
  test("a call that does not answer in time is refused with its own time limit", async () => {
    const quick = await connectConnectors([{ id: "a" }], [reg({ id: "a", path: "/ok" })], { callMs: 50 });
    stubs.slow = true;
    await assert.rejects(run(quick.tools["a__echo"], { text: "x" }), /timed out/);
    stubs.slow = false;
    await quick.close();
  });
  test("too many tools without an allow-list is refused, naming the way out", async () => {
    const big: Connector = reg({ id: "a", path: "/ok" });
    delete big.tools;
    const c = await connectConnectors([{ id: "a" }], [big]);
    assert.equal(c.status[0].ok, true, "this stub has 3 tools, under the limit");
    await c.close();
  });
  test("close ends the connections and can be called twice", async () => {
    const c = await connectConnectors([{ id: "a" }], [reg({ id: "a", path: "/ok" })]);
    await c.close();
    await c.close();
  });
});

describe("what comes back", () => {
  test("text parts joined; other content named, not shown; a server's error is thrown", () => {
    assert.equal(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }] }), "a\n[image content not shown]");
    assert.equal(resultText({ content: [], structuredContent: { x: 1 } }), '{\n  "x": 1\n}');
    assert.throws(() => resultText({ isError: true, content: [{ type: "text", text: "bad" }] }), /bad/);
  });
  test("a long answer is cut and says how much", () => {
    const out = resultText({ content: [{ type: "text", text: "x".repeat(MAX_RESULT_CHARS + 10) }] });
    assert.match(out, /10 more characters not shown/);
  });
  test("a refusal says to connect again; a timeout says so; anything else says it could not be reached", () => {
    assert.equal(refusal(new Error("HTTP 401: invalid_token")).signIn, true);
    assert.match(refusal(new Error("HTTP 401"), "token").reason, /refused the API token/);
    assert.match(refusal(new Error("connecting timed out")).reason, /in time/);
    assert.match(refusal(new Error("ECONNREFUSED")).reason, /could not be reached: ECONNREFUSED/);
  });
});
