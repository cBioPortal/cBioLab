// MCP endpoint on Vercel/Next: serves the same tools as mcp/server.js at /api/mcp.
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../../mcp/tools.ts";

const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "cbio-lab", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 }
);

export { handler as GET, handler as POST, handler as DELETE };
export const maxDuration = 60;
