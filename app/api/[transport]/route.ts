// MCP endpoint on Vercel/Next: serves the same tools as mcp/server.js at /api/mcp.
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../../mcp/tools.ts";
import { cachedAnalysis, cachedContract } from "../../../lib/next-cache.ts";
import { asLoopbackPeer, isLoopbackRequest } from "../../../lib/loopback-peer.ts";

const handler = createMcpHandler(
  (server) => registerTools(server, { runAnalysis: (doc) => cachedAnalysis(doc), buildContract: cachedContract }),
  { serverInfo: { name: "cbio-lab", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 }
);

// a call this app made to itself is answered as its simulated peer (lib/loopback-peer.ts)
const serve = (req: Request) => isLoopbackRequest(req) ? asLoopbackPeer(() => handler(req)) : handler(req);

export { serve as GET, serve as POST, serve as DELETE };
export const maxDuration = 60;
