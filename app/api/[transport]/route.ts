// MCP endpoint on Vercel/Next: serves the same tools as mcp/server.ts at /api/mcp, for agents.
// Federation between cbio-lab instances is not here; it has its own API (app/api/federation/v1).
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../../mcp/tools.ts";
import { cachedAnalysis, cachedContract } from "../../../lib/next-cache.ts";
import { refreshSettings } from "../../../lib/settings.ts";

const handler = createMcpHandler(
  (server) => registerTools(server, { runAnalysis: (doc) => cachedAnalysis(doc), buildContract: cachedContract }),
  { serverInfo: { name: "cbio-lab", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 }
);

// the tools answer by the federation settings an administrator may change (lib/settings.ts)
const serve = async (req: Request) => { await refreshSettings(); return handler(req); };

export { serve as GET, serve as POST, serve as DELETE };
export const maxDuration = 60;
