// Cohort Lab MCP server — standalone Streamable HTTP (stateless).
// The same tools are served on Vercel via app/api/[transport]/route.js.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// load .env.local BEFORE importing tools (lib/ch.js reads process.env at import)
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) { /* env must come from environment then */ }

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
const express = (await import("express")).default;
const { registerTools } = await import("./tools.js");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.post("/mcp", async (req, res) => {
  try {
    const server = new McpServer({ name: "cohort-lab", version: "1.0.0" });
    registerTools(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(e.message || e) }, id: null });
  }
});
app.get("/mcp", (req, res) => res.status(405).json({ error: "POST only (stateless)" }));

const PORT = process.env.MCP_PORT || 3201;
app.listen(PORT, "127.0.0.1", () => console.log("cohort-lab MCP on http://127.0.0.1:" + PORT + "/mcp"));
