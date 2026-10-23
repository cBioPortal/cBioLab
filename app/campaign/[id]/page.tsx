"use client";
// One hypothesis campaign, as a researcher drives it: ask → an AI proposes → review →
// lock (pre-register) → test on the discovery half → replicate on the held-out half → report.
// Everything the page shows comes from /api/campaign/[id]; the order of steps is enforced
// there and in the database, so this page cannot skip one even by accident.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { encodeSpec } from "../../../lib/lab-links.ts";
import { withSplit, primaryCohorts, type Hypothesis } from "../../../lib/hypothesis.ts";
import type { Campaign, Funnel, HypothesisRow } from "../../../lib/campaign.ts";
import { installAgentTools } from "../agent-tools.ts";
import { Prompt } from "../prompt.tsx";
import { AgentToolsMenu } from "../../_agent/AgentToolsMenu.tsx";
import { SiteHeader } from "../../_ui/site-header.tsx";
import { useCustomDataState } from "../../lab/custom-data-panel.tsx";
import { LoaderCircle, Lock, Play } from "lucide-react";
import { Button } from "../../_ui/button";
import { Checkbox } from "../../_ui/checkbox";
import { Textarea } from "../../_ui/textarea";

type Prior = { campaignId: string; question: string; verdict: string | null; p: number | null; lockedAt: string | null };
type View = { campaign: Campaign; funnel: Funnel; prior: Record<string, Prior[]>; note?: any };

const STEPS = ["Ask", "Propose", "Review", "Lock", "Test", "Report"] as const;
const fmtP = (p?: number | null) => p == null ? "–" : p < 1e-3 ? p.toExponential(1) : p.toFixed(3);
const labLink = (h: HypothesisRow, part?: "discovery" | "validation") =>
  "/lab?doc=" + encodeSpec(part ? withSplit(h.spec.doc, part) : h.spec.doc);
const asHyp = (h: HypothesisRow): Hypothesis => ({ statement: h.statement, ...h.spec });

function testLabel(h: HypothesisRow): string {
  const p = h.spec.primary;
  if (p.stat === "compare") return `${p.gene} ${p.measure === "driver" ? "driver " : ""}alteration frequency`;
  if (p.stat === "survival") return "survival (log-rank)";
  if (p.stat === "clinical") return p.attribute;
  return `Cox term: ${p.term}`;
}
function directionLabel(h: HypothesisRow): string {
  const [a, b] = primaryCohorts(asHyp(h));
  const d = h.spec.direction || "any";
  if (d === "any") return "any difference";
  const p = h.spec.primary;
  if (p.stat === "survival") return d === "higher" ? `worse survival in ${a}` : `better survival in ${a}`;
  if (p.stat === "cox") return d === "higher" ? "hazard ratio above 1" : "hazard ratio below 1";
  return `${d} in ${a} than ${b}`;
}

const VERDICT: Record<string, { label: string; cls: string; blurb: string }> = {
  replicated: { label: "Held up", cls: "v-rep", blurb: "Significant on the discovery half after correction, and again on held-out patients." },
  "not-replicated": { label: "Failed replication", cls: "v-fail", blurb: "Looked real on the discovery half, then did not hold up on patients the test had never seen." },
  "not-supported": { label: "Not supported", cls: "v-null", blurb: "Did not survive the correction for how many hypotheses were tested, or pointed the wrong way." },
  untestable: { label: "Untestable here", cls: "v-untest", blurb: "The data cannot answer it — known before any result, so it is not counted as a test." }
};

function stage(c: Campaign | undefined): number {
  if (!c) return 0;
  if (c.status === "complete") return 5;
  if (c.status === "running") return 4;
  if (c.status === "locked") return 4;
  return c.hypotheses.length ? 2 : 1;
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | string>(null);
  const [note, setNote] = useState<string | null>(null);
  // changing the record (register, remove, lock, run) needs the login; reading it does not
  const login = useCustomDataState();
  const why = !login.loaded ? "checking whether you are logged in…"
    : !login.enabled ? "this deployment has no sign-in, so campaigns cannot be changed on it"
    : !login.unlocked ? "sign in to change this campaign" : null;

  const load = useCallback(async () => {
    const r = await fetch(`/api/campaign/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (j.error) setErr(j.error); else { setV(j); setErr(null); }
    return j as View;
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // the page's steps as WebMCP tools and window.cohortLab, once the study is known
  const study = v?.campaign.study;
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!study) return;
    const t = installAgentTools(id, study, () => { void load(); });
    setWebmcp(t.webmcp);
    return t.cleanup;
  }, [id, study, load]);

  // poll while the server works, so results appear row by row
  useEffect(() => {
    if (busy !== "run" && v?.campaign.status !== "running") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [busy, v?.campaign.status, load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action); setNote(null); setErr(null);
    try {
      const r = await fetch(`/api/campaign/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (j.error) setErr(j.error);
      else {
        setV(j);
        if (action === "add")
          setNote(`${j.note.added.length} registered.` + (j.note.rejected.length ? ` ${j.note.rejected.length} rejected: ` + j.note.rejected.map((x: any) => `“${x.statement}” (${x.reason})`).join("; ") : ""));
      }
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  }

  if (err && !v) return <main className="camp"><p className="camp-err">{err}</p></main>;
  if (!v) return <main className="camp"><div className="skeleton-view" style={{ height: 320 }} /></main>;
  const c = v.campaign, f = v.funnel, s = stage(c);
  const testable = c.hypotheses.filter((h) => h.feasibility?.ok);
  const untestable = c.hypotheses.filter((h) => !h.feasibility?.ok);

  return (
    <>
      <SiteHeader page="hypothesis campaigns — cbio-lab as the referee for AI-generated hypotheses" current="campaigns">
        <AgentToolsMenu page="campaign" tools={TOOL_LIST} webmcp={webmcp}
          intro="Your AI assistant — Claude in the Chrome sidebar — writes, checks and registers this campaign's hypotheses with these tools, and can lock and run it once you agree. The engine checks everything it submits." />
      </SiteHeader>
      <main className="camp">
        <section className="camp-q">
          <div className="camp-eyebrow">Research question · {c.study}</div>
          <h2>{c.question}</h2>
          <ol className="camp-steps">
            {STEPS.map((x, i) => <li key={x} className={i < s ? "done" : i === s ? "now" : ""}>{x}</li>)}
          </ol>
        </section>

        {err && <p className="camp-err">{err}</p>}

        {c.status === "draft" && (
          <section className="card camp-draft">
            <h2>Build the list of hypotheses</h2>
            <p className="camp-help">
              This page does not call an AI model. Hypotheses are written by <strong>your AI assistant in the browser</strong> —
              Claude in the Chrome sidebar — through the tools this page exposes (<a href="#for-ai-agents">For AI agents</a>, below).
              The engine checks everything it submits: a malformed hypothesis comes back with the reason, and one the data cannot
              answer is marked <em>untestable</em>. Nobody sees a result until the list is locked and run.
            </p>
            <div className="camp-prompts">
              <Prompt label="Ask the sidebar for hypotheses" text={PROPOSE_PROMPT} />
              <Prompt label="Have it add your own idea" text={IDEA_PROMPT} />
            </div>
            {note && <p className="camp-note">{note}</p>}
          </section>
        )}

        {c.status !== "draft" && (
          <section className="card camp-receipt">
            <div>
              <div className="camp-eyebrow">Pre-registered</div>
              <strong>{new Date(c.lockedAt!).toLocaleString()}</strong> — {testable.length} testable hypotheses frozen before any result existed.
              The database refuses any later addition, removal or edit.
            </div>
            <code title="sha256 over every registered test">{c.ledgerHash?.slice(0, 24)}…</code>
          </section>
        )}

        {c.status === "complete" && <Report c={c} f={f} />}

        {(c.status === "locked" || c.status === "running") && (
          <section className="card camp-run">
            <h2>Test</h2>
            <p className="camp-help">
              Each hypothesis now runs on the <strong>discovery half</strong> of the patients. One correction is applied across
              all {testable.length} of them (false-discovery rate {c.plan.fdr}). Only the survivors are re-run, unchanged, on the{" "}
              <strong>validation half</strong> — patients no step so far has touched. Which half a patient is in is fixed by the
              engine, not chosen by anyone.
            </p>
            {busy === "run" ? (
              <Button disabled><LoaderCircle className="animate-spin" /> testing… {c.hypotheses.filter((h) => h.discovery).length}/{testable.length} on the discovery half</Button>
            ) : c.status === "running" ? (
              // Marked running, but not by this page: another tab or agent is running it, or a run
              // was cut off (a server time limit). Results so far are saved and a resume re-runs
              // only what is missing, so offering it is safe either way.
              <div className="camp-act-row">
                <Button disabled={!!busy || !!why} title={why || undefined} onClick={() => act("run")}><Play />Resume the run</Button>
                <span className="camp-dim">
                  {c.hypotheses.filter((h) => h.discovery).length}/{testable.length} tested so far. A run is in progress elsewhere or
                  was interrupted; resuming re-runs only what is missing.
                </span>
              </div>
            ) : (
              <Button disabled={!!busy || !!why} title={why || undefined} onClick={() => act("run")}><Play />{`Run all ${testable.length} tests`}</Button>
            )}
          </section>
        )}

        {c.status !== "complete" && (
          <section className="card">
            <h2>Hypotheses <span className="plain">· {testable.length} testable{untestable.length ? `, ${untestable.length} untestable` : ""}</span></h2>
            {!c.hypotheses.length && <p className="camp-help">None yet.</p>}
            <div className="camp-list">
              {testable.map((h) => <HypCard key={h.id} h={h} prior={v.prior[h.id]} canRemove={c.status === "draft" && !busy} removeWhy={why} onRemove={() => act("remove", { hypothesisId: h.id })} />)}
            </div>
            {!!untestable.length && <>
              <h3 className="camp-sub">Untestable with this data</h3>
              <div className="camp-list">
                {untestable.map((h) => <HypCard key={h.id} h={h} prior={v.prior[h.id]} canRemove={c.status === "draft" && !busy} removeWhy={why} onRemove={() => act("remove", { hypothesisId: h.id })} />)}
              </div>
            </>}
          </section>
        )}

        {c.status === "draft" && testable.length > 0 && (
          <section className="card camp-lock">
            <h2>Lock in</h2>
            <p className="camp-help">
              Locking pre-registers {testable.length === 1 ? "this hypothesis" : `these ${testable.length} hypotheses`}: the list is timestamped and hashed, and from then on
              nothing can be added, removed or reworded — the database itself refuses. This is what lets the final report
              say “1 of {testable.length} tested” and mean it.
            </p>
            <Button disabled={!!busy || !!why} title={why || undefined} onClick={() => act("lock")}>
              {busy === "lock" ? <><LoaderCircle className="animate-spin" /> locking…</> : <><Lock />{`Lock in ${testable.length} ${testable.length === 1 ? "hypothesis" : "hypotheses"}`}</>}
            </Button>
          </section>
        )}
        <AgentPanel c={c} webmcp={webmcp} busy={!!busy} why={why} onSubmit={(hs, source) => act("add", { hypotheses: hs, source })} />
      </main>
    </>
  );
}

const PROPOSE_PROMPT = `Read the "For AI agents" section of this page. Using window.cohortLab, read the hypothesis format (getFormat) and the study vocabulary (getVocabulary), then write 10 diverse hypotheses for this campaign's research question, each grounded in published work. Check any you are unsure of with checkHypothesis, register them with registerHypotheses, and fix and resubmit any that are rejected. Do not lock the campaign.`;
const IDEA_PROMPT = `Using window.cohortLab on this page, write my idea below as ONE hypothesis in the campaign's hypothesis format (getFormat, getVocabulary), faithful to what I mean, and register it with registerHypotheses([hypothesis], "researcher"). If the data cannot express it exactly, tell me what you had to change. My idea: `;

const TOOL_LIST: [string, string][] = [
  ["campaign_get", "getCampaign()"], ["campaign_format", "getFormat()"], ["campaign_vocabulary", "getVocabulary()"],
  ["campaign_check_hypothesis", "checkHypothesis(h)"], ["campaign_register", "registerHypotheses([h, …], source?)"],
  ["campaign_remove", "removeHypothesis(n)"], ["campaign_lock", "lock()"], ["campaign_run", "run()"], ["campaign_report", "report()"]
];

/** How an AI agent in the browser drives this page — visible, so an agent reading the page finds it. */
function AgentPanel({ c, webmcp, busy, why, onSubmit }: { c: Campaign; webmcp: boolean | null; busy: boolean; why: string | null; onSubmit: (hs: unknown[], source: "generator" | "researcher") => void }) {
  const [text, setText] = useState("");
  const [mine, setMine] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  function submit() {
    setBad(null);
    let hs: unknown;
    try { hs = JSON.parse(text); } catch (e) { setBad("not valid JSON: " + (e as Error).message); return; }
    onSubmit(Array.isArray(hs) ? hs : [hs], mine ? "researcher" : "generator");
  }
  return (
    <details className="card camp-agent" open={c.status === "draft"} id="for-ai-agents">
      <summary><h2>For AI agents <span className="plain">· drive this campaign with tools</span></h2></summary>
      <p className="camp-help">
        Every step on this page is also a tool. A browser agent that supports <strong>WebMCP</strong> finds them through
        {" "}<code>document.modelContext</code>; any agent that can run JavaScript here can call them as{" "}
        <code>window.cohortLab.*</code> (each returns a promise). The engine checks everything submitted, exactly as for
        the buttons above. {webmcp === null ? "" : webmcp ? "WebMCP: tools registered in this browser." : "WebMCP is not available in this browser — use window.cohortLab."}
      </p>
      <table className="camp-table camp-tools">
        <thead><tr><th>WebMCP tool</th><th>window.cohortLab</th></tr></thead>
        <tbody>{TOOL_LIST.map(([a, b]) => <tr key={a}><td><code>{a}</code></td><td><code>{b}</code></td></tr>)}</tbody>
      </table>
      <p className="camp-help">
        Workflow: read <a href="/api/campaign/format" target="_blank" rel="noreferrer">the hypothesis format</a> and{" "}
        <a href={`/api/catalog?study=${encodeURIComponent(c.study)}`} target="_blank" rel="noreferrer">the study vocabulary</a>,
        write hypotheses, <code>checkHypothesis</code> any you are unsure of, <code>registerHypotheses</code>, then — after the
        user confirms — <code>lock()</code> and <code>run()</code>, and report what <code>report()</code> says, failures included.
        Plain-text report: <a href={`/api/campaign/${c.id}?format=text`} target="_blank" rel="noreferrer">/api/campaign/{c.id.slice(0, 8)}…?format=text</a>.
      </p>
      {c.status === "draft" && <>
        <label htmlFor="agent-json">Or paste hypotheses as JSON (one object or an array)</label>
        <Textarea id="agent-json" className="camp-json font-mono text-md md:text-md" rows={6} value={text} onChange={(e) => setText(e.target.value)}
          placeholder='[{"statement": "…", "rationale": "…", "doc": {"study": "…", "cohorts": {…}, "views": [{…}]}, "primary": {"view": 0, "stat": "compare", "gene": "…"}, "direction": "higher"}]' />
        <div className="row">
          <Button variant="outline" disabled={busy || !text.trim() || !!why} title={why || undefined} onClick={submit}>Submit hypotheses</Button>
          <label className="chk camp-inline"><Checkbox checked={mine} onCheckedChange={(on) => setMine(on === true)} /> these are the researcher's own ideas</label>
          {bad && <span className="camp-err">{bad}</span>}
        </div>
      </>}
    </details>
  );
}

function HypCard({ h, prior, canRemove, removeWhy, onRemove }: { h: HypothesisRow; prior?: Prior[]; canRemove: boolean; removeWhy: string | null; onRemove: () => void }) {
  const n = h.feasibility?.n || {};
  return (
    <article className={"camp-hyp" + (h.feasibility?.ok ? "" : " untest")}>
      <div className="camp-hyp-top">
        <span className="camp-num">#{h.position}</span>
        <span className="camp-stmt">{h.statement}</span>
        <span className={"camp-src " + h.source}>{h.source === "generator" ? "AI" : "researcher"}</span>
      </div>
      <div className="camp-chips">
        <span className="camp-chip">tests: {testLabel(h)}</span>
        <span className="camp-chip">predicts: {directionLabel(h)}</span>
        {!!Object.keys(n).length && <span className="camp-chip num">patients in the discovery half — {Object.entries(n).map(([k, x]) => `${k}: ${x}`).join(" · ")}</span>}
        {h.discovery && <span className="camp-chip">discovery p = {h.discovery.ok ? fmtP(h.discovery.p) : "—"}</span>}
      </div>
      {h.rationale && <p className="camp-rat">{h.rationale}</p>}
      {!h.feasibility?.ok && <p className="camp-why">{h.feasibility?.reason}</p>}
      {!!prior?.length && <p className="camp-prior">Tested before: {prior.map((p) => `“${p.question}” → ${p.verdict}${p.p != null ? ` (p=${fmtP(p.p)})` : ""}`).join("; ")}</p>}
      <div className="camp-links">
        <a href={labLink(h)} target="_blank" rel="noreferrer">open the analysis</a>
        {canRemove && <Button variant="link" size="inline" className="text-destructive" disabled={!!removeWhy} title={removeWhy || undefined} onClick={onRemove}>remove</Button>}
      </div>
    </article>
  );
}

function Report({ c, f }: { c: Campaign; f: Funnel }) {
  const groups = ["replicated", "not-replicated", "not-supported", "untestable"] as const;
  const bars: [string, number][] = [
    ["registered", f.registered], ["testable", f.testable], ["tested", f.tested],
    ["p < 0.05 on discovery", f.nominal], ["survived the correction", f.survivedCorrection], ["held up on held-out patients", f.replicated]
  ];
  const max = Math.max(1, f.registered);
  return (
    <>
      <section className="camp-contrast">
        <div className="camp-big naive">
          <div className="camp-bignum">{f.nominal}</div>
          <div>“discoveries” an AI reporting p &lt; 0.05 on the data would have claimed</div>
        </div>
        <div className="camp-arrow">→</div>
        <div className="camp-big honest">
          <div className="camp-bignum">{f.replicated}</div>
          <div>held up after pre-registration, correction for {f.tested} tests, and replication on patients the test never saw</div>
        </div>
      </section>

      <section className="card">
        <h2>Funnel</h2>
        <div className="camp-funnel">
          {bars.map(([k, x]) => (
            <div key={k} className="camp-frow">
              <span className="camp-flab">{k}</span>
              <span className="camp-fbar"><span style={{ width: `${(100 * x) / max}%` }} /></span>
              <span className="camp-fnum">{x}</span>
            </div>
          ))}
        </div>
        <p className="camp-help">
          Decision rules fixed before any result: false-discovery rate {c.plan.fdr} across every tested hypothesis;
          replication means p &lt; {c.plan.replicationAlpha} on the held-out half, in the same direction; every group ≥ {c.plan.minArm} patients.
        </p>
      </section>

      {groups.map((g) => {
        const hs = c.hypotheses.filter((h) => (h.verdict || (h.feasibility?.ok ? "" : "untestable")) === g);
        if (!hs.length) return null;
        return (
          <section key={g} className={"card camp-group " + VERDICT[g].cls}>
            <h2>{VERDICT[g].label} <span className="plain">· {hs.length}</span></h2>
            <p className="camp-help">{VERDICT[g].blurb}</p>
            <table className="camp-table">
              <thead><tr><th>#</th><th>Hypothesis</th><th>Discovery half</th><th>Validation half</th><th /></tr></thead>
              <tbody>
                {hs.map((h) => (
                  <tr key={h.id}>
                    <td className="num">{h.position}</td>
                    <td>
                      <div className="camp-stmt">{h.statement}</div>
                      <div className="camp-dim">{testLabel(h)} · predicts {directionLabel(h)} · {h.source === "generator" ? "AI" : "researcher"}</div>
                    </td>
                    <td>
                      {!h.feasibility?.ok ? <span className="camp-dim">{h.feasibility?.reason}</span>
                        : h.discovery?.ok ? <>
                          <div>p = {fmtP(h.discovery.p)} · q = {fmtP(h.q)}</div>
                          <div className="camp-dim">{h.discovery.effect}</div>
                          {h.discovery.directionOk === false && <div className="camp-warn">opposite to the prediction</div>}
                        </> : <span className="camp-dim">{h.discovery?.reason}</span>}
                    </td>
                    <td>
                      {h.validation ? (h.validation.ok ? <>
                        <div>p = {fmtP(h.validation.p)}</div>
                        <div className="camp-dim">{h.validation.effect}</div>
                      </> : <span className="camp-dim">{h.validation.reason}</span>) : <span className="camp-dim">not run — {h.feasibility?.ok ? "did not survive discovery" : "untestable"}</span>}
                    </td>
                    <td className="camp-links">
                      {h.feasibility?.ok && <a href={labLink(h, "discovery")} target="_blank" rel="noreferrer">discovery</a>}
                      {h.validation && <a href={labLink(h, "validation")} target="_blank" rel="noreferrer">validation</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="camp-foot">
        Every result is an association in a retrospective cohort, not a causal claim. Each link opens the exact analysis
        that produced the number — its cohort definitions, the SQL they compiled to, and a live re-run.
      </p>
    </>
  );
}
