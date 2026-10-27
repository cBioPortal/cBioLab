// MCP endpoint on Vercel/Next: serves the same tools as mcp/server.ts at /api/mcp.
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "../../../mcp/tools.ts";
import { cachedAnalysis, cachedContract } from "../../../lib/next-cache.ts";
import { asLoopbackPeer, isLoopbackRequest } from "../../../lib/loopback-peer.ts";
import { logInbound } from "../../../lib/federation-log.ts";
import { refreshSettings } from "../../../lib/settings.ts";

const handler = createMcpHandler(
  (server) => registerTools(server, { runAnalysis: (doc) => cachedAnalysis(doc), buildContract: cachedContract }),
  { serverInfo: { name: "cbio-lab", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 }
);

// a call this app made to itself is answered as its simulated peer (lib/loopback-peer.ts)
const serve = async (req: Request) => {
  // which tools exist and who counts as the simulated peer are settings an administrator may change
  await refreshSettings();
  const asPeer = isLoopbackRequest(req);
  const call = req.method === "POST" ? await toolCall(req) : null;
  const t0 = Date.now();
  const res = await (asPeer ? asLoopbackPeer(() => handler(req)) : handler(req));
  // logged once the answer has been written, which a streamed response is not when it is returned
  if (call) void res.clone().text().then((body) => logInbound(call.name, call.args, asPeer, Date.now() - t0, res.status, body), () => {});
  return res;
};

/** The tool a JSON-RPC request calls, for the log (lib/federation-log.ts); read from a copy. */
async function toolCall(req: Request): Promise<{ name: string; args: unknown } | null> {
  try {
    const body = await req.clone().json();
    return body?.method === "tools/call" && typeof body.params?.name === "string" ? { name: body.params.name, args: body.params.arguments } : null;
  } catch { return null; }
}

export { serve as GET, serve as POST, serve as DELETE };
export const maxDuration = 60;
