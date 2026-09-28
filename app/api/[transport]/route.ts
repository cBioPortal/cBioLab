// MCP endpoint on Vercel/Next: serves the same tools as mcp/server.js at /api/mcp.
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../../mcp/tools.ts";
import { cachedAnalysis, cachedContract } from "../../../lib/next-cache.ts";

const handler = createMcpHandler(
  (server) => registerTools(server, { runAnalysis: (doc) => cachedAnalysis(doc), buildContract: cachedContract }),
  { serverInfo: { name: "cbio-lab", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 }
);

export { handler as GET, handler as POST, handler as DELETE };
export const maxDuration = 60;
