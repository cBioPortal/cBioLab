// Hypothesis campaigns: the ledger (Postgres, db/migrations/0002_campaigns.sql) and the
// procedure that runs one. The order of operations IS the method:
//
//   draft     — hypotheses are added (by an AI generator or a researcher). Each is checked
//               for feasibility on the discovery half: cohort sizes only, never an outcome.
//   locked    — the list is frozen and hashed before any result exists. Database triggers,
//               not this code, keep it frozen.
//   running   — every feasible hypothesis is tested on the DISCOVERY half; one BH correction
//               runs across all of them; only survivors are re-run, unchanged, on the
//               VALIDATION half the generator never saw.
//   complete  — every row carries its result, nulls included.
//
// Nothing here chooses what to test. That is the generator's job; this module is the
// referee, and a referee that could be talked into anything would be worthless.
import { createHash } from "node:crypto";
import { dbQuery } from "./db.ts";
import {
  DEFAULT_PLAN, extractPrimary, testIdentity, primaryCohorts, pinCohortOrder, replicated, scoreDiscovery,
  validateHypothesis, withSplit, type Hypothesis, type Outcome, type Plan, type Verdict
} from "./hypothesis.ts";
import type { AnalysisDoc, AnalysisResult } from "./types.ts";

export type Run = (doc: AnalysisDoc) => Promise<AnalysisResult>;

export interface Feasibility { ok: boolean; reason?: string; n?: Record<string, number> }

export interface HypothesisRow {
  id: string; position: number; statement: string; rationale: string | null;
  spec: Pick<Hypothesis, "doc" | "primary" | "direction">;
  hash: string; source: "generator" | "researcher";
  feasibility: Feasibility | null;
  discovery: Outcome | null; q: number | null; validation: Outcome | null;
  verdict: Verdict | null; registeredAt: string;
}
export interface Campaign {
  id: string; question: string; study: string; plan: Plan;
  status: "draft" | "locked" | "running" | "complete";
  ledgerHash: string | null; lockedAt: string | null; completedAt: string | null; createdAt: string;
  hypotheses: HypothesisRow[];
}

const errText = (e: unknown) => String((e as Error)?.message || e);

export function hypothesisHash(h: Hypothesis): string {
  return createHash("sha256").update(testIdentity(h)).digest("hex");
}

// ---- the engine-facing steps ---------------------------------------------------------------

/** Arm sizes on the discovery half, from cohort definitions alone. No view runs, so no outcome is seen. */
export async function checkFeasibility(h: Hypothesis, run: Run, plan: Plan = DEFAULT_PLAN): Promise<Feasibility> {
  try { validateHypothesis(h); } catch (e) { return { ok: false, reason: errText(e) }; }
  let r: AnalysisResult;
  try { r = await run({ ...withSplit(h.doc, "discovery"), views: [] }); }
  catch (e) { return { ok: false, reason: "rejected by the engine: " + errText(e) }; }
  const names = primaryCohorts(h);
  const n = Object.fromEntries(names.map((c) => [c, r.cohorts[c]?.count ?? 0]));
  const small = names.filter((c) => n[c] < plan.minArm);
  if (small.length)
    return { ok: false, n, reason: small.map((c) => `"${c}" has ${n[c]} patients in the discovery half`).join("; ") + ` (minimum ${plan.minArm})` };
  return { ok: true, n };
}

export async function testOn(h: Hypothesis, part: "discovery" | "validation", run: Run): Promise<Outcome> {
  try { return extractPrimary(h, await run(withSplit(h.doc, part))); }
  catch (e) { return { ok: false, reason: "rejected by the engine: " + errText(e) }; }
}

async function pool<T>(items: T[], width: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
  }));
}

// ---- the ledger --------------------------------------------------------------------------

function rowOut(r: Record<string, any>): HypothesisRow {
  return {
    id: r.id, position: r.position, statement: r.statement, rationale: r.rationale, spec: r.spec,
    hash: r.hash, source: r.source, feasibility: r.feasibility, discovery: r.discovery,
    q: r.q, validation: r.validation, verdict: r.verdict, registeredAt: new Date(r.registered_at).toISOString()
  };
}
const iso = (d: unknown) => d ? new Date(d as string).toISOString() : null;

export async function createCampaign(question: string, study: string, plan: Partial<Plan> = {}): Promise<Campaign> {
  if (!question.trim()) throw new Error("a campaign needs a question");
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(study)) throw new Error("invalid study id");
  const full: Plan = { ...DEFAULT_PLAN, ...plan };
  const [r] = await dbQuery<{ id: string }>(
    "insert into campaigns (question, study, plan) values ($1, $2, $3) returning id", [question.trim(), study, full]);
  return getCampaign(r.id);
}

export async function getCampaign(id: string): Promise<Campaign> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("invalid campaign id");
  const [c] = await dbQuery<Record<string, any>>("select * from campaigns where id = $1", [id]);
  if (!c) throw new Error("no such campaign: " + id);
  const rows = await dbQuery<Record<string, any>>(
    "select * from campaign_hypotheses where campaign_id = $1 order by position", [id]);
  return {
    id: c.id, question: c.question, study: c.study, plan: c.plan, status: c.status,
    ledgerHash: c.ledger_hash, lockedAt: iso(c.locked_at), completedAt: iso(c.completed_at),
    createdAt: iso(c.created_at)!, hypotheses: rows.map(rowOut)
  };
}

export async function listCampaigns(): Promise<Omit<Campaign, "hypotheses" | "plan">[]> {
  const rows = await dbQuery<Record<string, any>>(
    "select id, question, study, status, ledger_hash, locked_at, completed_at, created_at from campaigns order by created_at desc limit 50");
  return rows.map((c) => ({ id: c.id, question: c.question, study: c.study, status: c.status,
    ledgerHash: c.ledger_hash, lockedAt: iso(c.locked_at), completedAt: iso(c.completed_at), createdAt: iso(c.created_at)! }));
}

/** Earlier results for the same test, in any campaign: the negative-result memory. */
export async function priorTests(hash: string, exceptCampaign?: string): Promise<{ campaignId: string; question: string; verdict: Verdict | null; p: number | null; lockedAt: string | null }[]> {
  const rows = await dbQuery<Record<string, any>>(
    `select h.campaign_id, c.question, h.verdict, h.discovery, c.locked_at from campaign_hypotheses h
       join campaigns c on c.id = h.campaign_id
      where h.hash = $1 and h.verdict is not null and h.campaign_id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000')
      order by c.locked_at`, [hash, exceptCampaign ?? null]);
  return rows.map((r) => ({ campaignId: r.campaign_id, question: r.question, verdict: r.verdict,
    p: r.discovery?.p ?? null, lockedAt: iso(r.locked_at) }));
}

export interface AddResult { added: HypothesisRow[]; rejected: { statement: string; reason: string }[] }

/** Register hypotheses on a draft campaign. Structural problems reject; small arms register as untestable. */
export async function addHypotheses(id: string, hyps: Hypothesis[], source: "generator" | "researcher", run: Run): Promise<AddResult> {
  const c = await getCampaign(id);
  if (c.status !== "draft") throw new Error("campaign is locked: its hypothesis list is frozen");
  const seen = new Map(c.hypotheses.map((h) => [h.hash, h.position]));
  const out: AddResult = { added: [], rejected: [] };
  let position = c.hypotheses.reduce((m, h) => Math.max(m, h.position), 0);
  const checked = await Promise.all(hyps.map(async (h) => {
    const hh = pinCohortOrder({ ...h, doc: { ...h.doc, study: h.doc?.study || c.study } });
    try { validateHypothesis(hh); } catch (e) { return { h: hh, reason: errText(e) }; }
    return { h: hh, feas: await checkFeasibility(hh, run, c.plan) };
  }));
  for (const x of checked) {
    if ("reason" in x) { out.rejected.push({ statement: String(x.h?.statement || ""), reason: x.reason! }); continue; }
    const hash = hypothesisHash(x.h);
    if (seen.has(hash)) { out.rejected.push({ statement: x.h.statement, reason: `the same test is already registered as #${seen.get(hash)}` }); continue; }
    seen.set(hash, ++position);
    const [r] = await dbQuery<Record<string, any>>(
      `insert into campaign_hypotheses (campaign_id, position, statement, rationale, spec, hash, source, feasibility)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [id, position, x.h.statement.trim(), x.h.rationale ?? null,
       { doc: x.h.doc, primary: x.h.primary, direction: x.h.direction || "any" }, hash, source, x.feas]);
    out.added.push(rowOut(r));
  }
  return out;
}

export async function removeHypothesis(id: string, hypothesisId: string): Promise<void> {
  const c = await getCampaign(id);
  if (c.status !== "draft") throw new Error("campaign is locked: its hypothesis list is frozen");
  await dbQuery("delete from campaign_hypotheses where campaign_id = $1 and id = $2", [id, hypothesisId]);
}

/** The pre-registration receipt: one hash over every registered test, in no particular order. */
export function ledgerHash(hashes: string[]): string {
  return createHash("sha256").update([...hashes].sort().join("\n")).digest("hex");
}

export async function lockCampaign(id: string): Promise<Campaign> {
  const c = await getCampaign(id);
  if (c.status !== "draft") throw new Error("campaign is already locked");
  if (!c.hypotheses.some((h) => h.feasibility?.ok)) throw new Error("nothing to lock: no hypothesis is testable");
  await dbQuery("update campaigns set status = 'locked', locked_at = now(), ledger_hash = $2 where id = $1 and locked_at is null",
    [id, ledgerHash(c.hypotheses.map((h) => h.hash))]);
  return getCampaign(id);
}

const asHyp = (h: HypothesisRow): Hypothesis => ({ statement: h.statement, ...h.spec });

/**
 * Test every feasible hypothesis on the discovery half, correct across all of them, and
 * replicate the survivors on the validation half. Resumable: rows that already hold a
 * discovery result are not re-run, so an interrupted run continues rather than re-rolls.
 */
export async function runCampaign(id: string, run: Run, width = 3): Promise<Campaign> {
  const c = await getCampaign(id);
  if (c.status === "draft") throw new Error("lock the campaign first: results before registration are not pre-registered");
  if (c.status === "complete") return c;
  await dbQuery("update campaigns set status = 'running' where id = $1", [id]);
  const testable = c.hypotheses.filter((h) => h.feasibility?.ok);
  for (const h of c.hypotheses.filter((h) => !h.feasibility?.ok && !h.verdict))
    await dbQuery("update campaign_hypotheses set verdict = 'untestable' where id = $1", [h.id]);

  await pool(testable.filter((h) => !h.discovery), width, async (h) => {
    h.discovery = await testOn(asHyp(h), "discovery", run);
    await dbQuery("update campaign_hypotheses set discovery = $2 where id = $1", [h.id, h.discovery]);
  });

  const scores = scoreDiscovery(testable.map((h) => h.discovery ?? undefined), c.plan);
  const survivors: HypothesisRow[] = [];
  for (const [i, h] of testable.entries()) {
    h.q = scores[i].q ?? null;
    const verdict: Verdict | null = !h.discovery?.ok ? "untestable" : scores[i].promising ? null : "not-supported";
    if (verdict === null) survivors.push(h);
    await dbQuery("update campaign_hypotheses set q = $2, verdict = coalesce(verdict, $3) where id = $1", [h.id, h.q, verdict]);
  }

  await pool(survivors.filter((h) => !h.validation), width, async (h) => {
    h.validation = await testOn(asHyp(h), "validation", run);
    const verdict: Verdict = replicated(h.discovery!, h.validation, c.plan) ? "replicated" : "not-replicated";
    await dbQuery("update campaign_hypotheses set validation = $2, verdict = $3 where id = $1", [h.id, h.validation, verdict]);
  });

  await dbQuery("update campaigns set status = 'complete', completed_at = now() where id = $1", [id]);
  return getCampaign(id);
}

// ---- the report ----------------------------------------------------------------------------

export interface Funnel {
  registered: number; testable: number; tested: number;
  /** discovery p < 0.05 — what a generator reporting nominal p-values would claim */
  nominal: number;
  /** survived the campaign-wide correction, pointing the declared way */
  survivedCorrection: number;
  replicated: number;
}

export function funnel(c: Campaign): Funnel {
  const hs = c.hypotheses;
  return {
    registered: hs.length,
    testable: hs.filter((h) => h.feasibility?.ok).length,
    tested: hs.filter((h) => h.discovery?.ok).length,
    nominal: hs.filter((h) => h.discovery?.ok && h.discovery.p! < 0.05).length,
    survivedCorrection: hs.filter((h) => h.verdict === "replicated" || h.verdict === "not-replicated").length,
    replicated: hs.filter((h) => h.verdict === "replicated").length
  };
}

const fmtP = (p?: number | null) => p == null ? "–" : p < 1e-3 ? p.toExponential(1) : p.toFixed(3);

/** Plain-text report for MCP clients: every hypothesis, nulls included, in registration order. */
export function reportText(c: Campaign, base = ""): string {
  const f = funnel(c);
  const lines = [
    `Campaign: ${c.question}`,
    `Study: ${c.study} · status: ${c.status}` + (c.lockedAt ? ` · locked ${c.lockedAt} · receipt ${c.ledgerHash?.slice(0, 16)}` : ""),
    `Plan: FDR ${c.plan.fdr} across all tested hypotheses; replication p < ${c.plan.replicationAlpha} on the held-out half, same direction; arms ≥ ${c.plan.minArm}.`,
    "",
    `Funnel: ${f.registered} registered → ${f.testable} testable → ${f.tested} tested → ${f.nominal} nominal (p<0.05) → ${f.survivedCorrection} survived correction → ${f.replicated} replicated`,
    `Reporting nominal p-values alone would have claimed ${f.nominal}; ${f.replicated} held up on patients the test never saw.`,
    ""
  ];
  for (const h of c.hypotheses) {
    lines.push(`#${h.position} [${h.verdict ?? (h.feasibility?.ok ? "registered" : "untestable")}] ${h.statement}` + (h.source === "researcher" ? " (researcher)" : ""));
    if (!h.feasibility?.ok) lines.push(`    untestable: ${h.feasibility?.reason}`);
    if (h.discovery) lines.push(`    discovery: ${h.discovery.ok ? `p=${fmtP(h.discovery.p)} q=${fmtP(h.q)} · ${h.discovery.effect}` + (h.discovery.directionOk === false ? " · OPPOSITE to the declared direction" : "") : h.discovery.reason}`);
    if (h.validation) lines.push(`    validation: ${h.validation.ok ? `p=${fmtP(h.validation.p)} · ${h.validation.effect}` : h.validation.reason}`);
  }
  lines.push("", "Every result is an association in a retrospective cohort, not a causal claim.");
  if (base) lines.push(`Full report: ${base}/campaign/${c.id}`);
  return lines.join("\n");
}
