// The federation API (lib/federation-api.ts): POST /api/federation/v1/<op> with the op's arguments as
// JSON. Answers 200 with the op's result, or an error naming why: 404 for an op this instance does
// not serve (a patient-level op without FEDERATION_DISCLOSE_PATIENTS), 400 for a malformed request,
// 422 for a refusal.
import { answerFederation } from "../../../../../lib/federation-api.ts";
import { asLoopbackPeer, isLoopbackRequest } from "../../../../../lib/loopback-peer.ts";
import { logInbound } from "../../../../../lib/federation-log.ts";
import { refreshSettings } from "../../../../../lib/settings.ts";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  // which ops exist and who counts as the simulated peer are settings an administrator may change
  await refreshSettings();
  let args: unknown;
  try { args = await req.json(); } catch { return Response.json({ error: "the body is not JSON" }, { status: 400 }); }
  // a call this app made to itself is answered as its simulated peer (lib/loopback-peer.ts)
  const asPeer = isLoopbackRequest(req);
  const t0 = Date.now();
  const { status, body } = await (asPeer ? asLoopbackPeer(() => answerFederation(op, args)) : answerFederation(op, args));
  const text = JSON.stringify(body);
  logInbound(op, args, asPeer, Date.now() - t0, status, text.length);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}
