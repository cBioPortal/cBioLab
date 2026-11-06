// Invariant 1 at the MCP surface: a study the warehouse does not hold is refused by name.
// describe_study used to describe a missing study as one with no events, and campaign_create made
// a campaign for any well-formed id. The warehouse is a stand-in (setChTransport) holding one
// study; the campaign ledger is the tests' in-process Postgres.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// lib/ch.ts reads these at import
process.env.CLICKHOUSE_DB = "testdb";
process.env.STUDY_ID = "test_study";

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { registerTools } = await import("../mcp/tools.ts");
const { setChTransport } = await import("../lib/ch.ts");
const { createCampaign } = await import("../lib/campaign.ts");
const { startPostgres } = await import("./support/postgres.ts");

type Engine = Parameters<typeof registerTools>[1];
type Result = { content: { type: string; text?: string }[]; isError?: boolean };

/** whether the stand-in warehouse holds test_study (its study check and its routing both follow) */
let holdsStudy = true;
let statements: string[] = [];
setChTransport(async (st) => {
  statements.push(st.query);
  let data: Record<string, unknown>[] = [];
  if (/SELECT count\(\) AS n FROM testdb\.cancer_study WHERE cancer_study_identifier = 'test_study'/.test(st.query)) data = [{ n: holdsStudy ? 1 : 0 }];
  else if (/SELECT cancer_study_identifier AS id, name FROM testdb\.cancer_study/.test(st.query)) data = [{ id: "test_study", name: "Test study" }];
  return JSON.stringify({ meta: [], data, rows: data.length, statistics: { rows_read: 1, elapsed: 0, bytes_read: 0 } });
});

const engine: Engine = {
  runAnalysis: async () => { throw new Error("runAnalysis not expected here"); },
  buildContract: async () => { throw new Error("buildContract not expected here"); },
};

async function connect() {
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, engine);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    call: async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result,
    close: async () => { await client.close(); await server.close(); },
  };
}
const textOf = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

beforeEach(() => { holdsStudy = true; statements = []; });
after(() => setChTransport(null));

describe("describe_study", () => {
  test("refuses a study the warehouse does not hold, naming it, and asks nothing more", async () => {
    holdsStudy = false;
    const c = await connect();
    try {
      const r = await c.call("describe_study");
      assert.equal(r.isError, true, textOf(r));
      assert.match(textOf(r), /unknown study 'test_study'/);
      assert.equal(statements.length, 1, "only the study check ran: " + statements.join(" | "));
    } finally { await c.close(); }
  });

  test("describes a study the warehouse holds", async () => {
    const c = await connect();
    try {
      const r = await c.call("describe_study");
      assert.ok(!r.isError, textOf(r));
      assert.match(textOf(r), /^Study: test_study /);
    } finally { await c.close(); }
  });
});

describe("campaign_create", () => {
  before(async () => { await startPostgres(); });

  test("refuses a well-formed id for a study that does not exist, by name", async () => {
    const c = await connect();
    try {
      assert.match(textOf(await c.call("campaign_create", { question: "What predicts early failure?", study: "no_such_study" })),
        /REJECTED: .*unknown study 'no_such_study'/);
    } finally { await c.close(); }
  });

  test("creates a campaign for a study the warehouse holds", async () => {
    const c = await connect();
    try {
      assert.match(textOf(await c.call("campaign_create", { question: "What predicts early failure?", study: "test_study" })), /created for test_study/);
    } finally { await c.close(); }
  });

  test("createCampaign asks its study check before it writes anything", async () => {
    let asked = "";
    await assert.rejects(createCampaign("A real question", "elsewhere", {}, async (s) => { asked = s; throw new Error("unknown study 'elsewhere'"); }),
      /unknown study 'elsewhere'/);
    assert.equal(asked, "elsewhere");
  });

  test("a malformed id is refused before the study check runs", async () => {
    let asked = false;
    await assert.rejects(createCampaign("A real question", "bad id; drop", {}, async () => { asked = true; }), /invalid study id/);
    assert.equal(asked, false);
  });
});
