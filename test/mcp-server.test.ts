// The standalone MCP server (mcp/server.ts): stateless Streamable HTTP on POST /mcp, serving the
// same tools as /api/mcp. It listens as soon as it is imported, so the test gives it a free port,
// keeps hold of the listening server (through express's own listen) to close it afterwards, and
// talks to it with the SDK's own HTTP client. No tool here reaches the warehouse.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port;
    s.close(() => resolve(port));
  }).on("error", reject);
});

const express = (await import("express")).default as unknown as { application: { listen: (...a: unknown[]) => Server } };
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { dslForAgents } = await import("../lib/dsl-agent.ts");

let server: Server;
let base: string;

before(async () => {
  const port = await freePort();
  const saved = process.env.MCP_PORT;
  process.env.MCP_PORT = String(port);
  const listen = express.application.listen;
  const listening = new Promise<Server>((resolve) => {
    express.application.listen = function (this: unknown, ...args: unknown[]) {
      const s = listen.apply(this, args);
      s.once("listening", () => resolve(s));
      return s;
    };
  });
  const log = console.log;
  console.log = () => {};
  try {
    await import("../mcp/server.ts");
    server = await listening;
  } finally {
    console.log = log;
    express.application.listen = listen;
    if (saved == null) delete process.env.MCP_PORT; else process.env.MCP_PORT = saved;
  }
  base = "http://127.0.0.1:" + port + "/mcp";
});

after(() => new Promise<void>((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
}));

describe("mcp/server.ts", () => {
  test("listens on MCP_PORT, on the loopback interface only", () => {
    const addr = server.address() as { address: string; port: number };
    assert.equal(addr.address, "127.0.0.1");
    assert.equal(String(addr.port), new URL(base).port);
  });

  test("GET /mcp is refused: the server is POST only (stateless)", async () => {
    const res = await fetch(base);
    assert.equal(res.status, 405);
    assert.deepEqual(await res.json(), { error: "POST only (stateless)" });
  });

  test("an MCP client can connect, list the tools and call one, over a fresh server per request", async () => {
    const client = new Client({ name: "server-test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(base)));
    try {
      assert.equal(client.getServerVersion()?.name, "cbio-lab");
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const n of ["describe_dsl", "run_analysis", "describe_study", "query_cohort", "derive_treatment_lines", "render_oncoprint", "campaign_create", "campaign_run"])
        assert.ok(names.includes(n), "serves " + n);
      const r = await client.callTool({ name: "describe_dsl", arguments: {} }) as { content: { type: string; text: string }[] };
      assert.equal(r.content[0].text, dslForAgents());
      const bad = await client.callTool({ name: "derive_treatment_lines", arguments: { gap: 0 } }) as { isError?: boolean };
      assert.equal(bad.isError, true, "a schema violation is an error result, and the server keeps serving");
      assert.ok((await client.listTools()).tools.length >= 12);
    } finally { await client.close(); }
  });

  test("a request that is not JSON-RPC is answered with an error, not a crash", async () => {
    const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ hello: "world" }) });
    assert.ok(res.status >= 400 && res.status < 500, "status " + res.status);
    const body = await res.json() as { jsonrpc: string; error: { message: string } };
    assert.equal(body.jsonrpc, "2.0");
    assert.ok(body.error.message);
    // and it still serves the next one
    assert.equal((await fetch(base)).status, 405);
  });
});
