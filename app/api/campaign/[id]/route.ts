// One campaign: read it, and move it through draft → locked → complete.
// Every step is a POST {action}; the order is enforced by lib/campaign.ts and the database.
import {
  getCampaign, addHypotheses, removeHypothesis, lockCampaign, runCampaign, funnel, priorTests,
  checkFeasibility, reportText
} from "../../../../lib/campaign.ts";
import { proposeHypotheses } from "../../../../lib/generator.ts";
import { cachedAnalysis } from "../../../../lib/next-cache.ts";
import type { AnalysisDoc } from "../../../../lib/types.ts";

export const maxDuration = 300;

const run = (d: AnalysisDoc) => cachedAnalysis(d);
const fail = (e: unknown, status = 400) => Response.json({ error: String((e as Error)?.message || e) }, { status });

async function view(id: string) {
  const c = await getCampaign(id);
  const prior = Object.fromEntries(await Promise.all(c.hypotheses.map(async (h) => [h.id, await priorTests(h.hash, id)])));
  return { campaign: c, funnel: funnel(c), prior };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // ?format=text: the same report the MCP tools return, for agents that read rather than parse
    if (new URL(req.url).searchParams.get("format") === "text")
      return new Response(reportText(await getCampaign(id), new URL(req.url).origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
    return Response.json(await view(id));
  } catch (e) { return fail(e, 404); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try { body = await req.json(); } catch { return fail("body must be JSON"); }
  try {
    const c = await getCampaign(id);
    let note: unknown = null;
    if (body.action === "propose" || body.action === "idea") {
      const idea = body.action === "idea" ? String(body.idea || "").trim() : undefined;
      if (body.action === "idea" && !idea) return fail("describe the idea to test");
      const p = await proposeHypotheses({ question: c.question, study: c.study, count: Math.min(Number(body.count) || 12, 30),
        idea, existing: c.hypotheses.map((h) => h.statement), run });
      const added = await addHypotheses(id, p.hypotheses, idea ? "researcher" : "generator", run);
      note = { added: added.added.length, rejected: [...added.rejected, ...p.unresolved] };
    } else if (body.action === "add") {
      note = await addHypotheses(id, Array.isArray(body.hypotheses) ? body.hypotheses : [body.hypothesis], body.source === "generator" ? "generator" : "researcher", run);
    } else if (body.action === "check") {
      const h = body.hypothesis || {};
      note = await checkFeasibility({ ...h, doc: { ...h.doc, study: h.doc?.study || c.study } }, run, c.plan);
    } else if (body.action === "remove") {
      const byPos = body.position != null ? c.hypotheses.find((h) => h.position === Number(body.position)) : undefined;
      if (body.position != null && !byPos) return fail(`no hypothesis #${body.position}`);
      await removeHypothesis(id, byPos ? byPos.id : String(body.hypothesisId));
    } else if (body.action === "lock") {
      await lockCampaign(id);
    } else if (body.action === "run") {
      await runCampaign(id, run);
    } else return fail("action must be propose, idea, add, check, remove, lock or run");
    return Response.json({ ...(await view(id)), note });
  } catch (e) { return fail(e); }
}
