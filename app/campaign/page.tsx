"use client";
// The campaign index: start a new question, or reopen one. A campaign's page is where the
// work happens (app/campaign/[id]/page.tsx).
import { useEffect, useState } from "react";

type Row = { id: string; question: string; study: string; status: string; lockedAt: string | null; createdAt: string };

const EXAMPLES = [
  "What distinguishes non-small cell lung cancer patients who fail first-line immunotherapy within 6 months from those who respond durably?",
  "In colorectal cancer, which genomic and clinical features are associated with shorter overall survival after first chemotherapy?",
  "Among breast cancer patients treated with hormone therapy, what predicts progression within a year?"
];

export default function CampaignIndex() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [study, setStudy] = useState("msk_chord_2024");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/campaign", { cache: "no-store" }).then((r) => r.json())
      .then((j) => j.error ? setErr(j.error) : setRows(j.campaigns)).catch((e) => setErr(String(e)));
  }, []);

  async function create() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/campaign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, study }) });
    const j = await r.json();
    if (j.error) { setErr(j.error); setBusy(false); } else window.location.href = `/campaign/${j.campaign.id}`;
  }

  return (
    <>
      <header>
        <h1>Hypothesis campaigns</h1>
        <span className="sub">cbio-lab as the referee for AI-generated hypotheses</span>
        <span className="spacer" />
        <a href="/lab" className="camp-nav">analysis app</a>
        <a href="/rationale" className="camp-nav">why this exists</a>
      </header>
      <main className="camp">
        <section className="camp-explain">
          <div><strong>1 · You ask</strong><p>A research question, in plain words.</p></div>
          <div><strong>2 · AI proposes</strong><p>Your AI assistant — Claude in the Chrome sidebar — writes candidate hypotheses as precise, checkable analyses through this site's tools. You edit the list and add your own.</p></div>
          <div><strong>3 · Lock in</strong><p>The list is timestamped and frozen before any result exists. Nothing can be quietly dropped later.</p></div>
          <div><strong>4 · The tool referees</strong><p>Each is tested on half the patients, corrected for how many were tried, and rechecked on the other half.</p></div>
        </section>

        <section className="card">
          <h2>New campaign</h2>
          <label htmlFor="q">Research question</label>
          <textarea id="q" className="camp-qin" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="What do you want to find out?" />
          <div className="camp-examples">
            {EXAMPLES.map((x) => <button key={x} className="camp-ex" onClick={() => setQ(x)}>{x}</button>)}
          </div>
          <div className="row">
            <div><label htmlFor="study">Study</label><input id="study" value={study} onChange={(e) => setStudy(e.target.value)} /></div>
            <button className="primary" disabled={busy || !q.trim()} onClick={create}>{busy ? "creating…" : "Start"}</button>
          </div>
          {err && <p className="camp-err">{err}</p>}
        </section>

        <section className="card">
          <h2>Campaigns</h2>
          {!rows && !err && <p className="camp-help"><span className="spinner" /> loading…</p>}
          {rows && !rows.length && <p className="camp-help">None yet.</p>}
          {rows && !!rows.length && (
            <table className="camp-table">
              <thead><tr><th>Question</th><th>Study</th><th>Status</th><th>Started</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><a href={`/campaign/${r.id}`}>{r.question}</a></td>
                  <td>{r.study}</td>
                  <td><span className={"camp-status " + r.status}>{r.status}</span></td>
                  <td className="camp-dim">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
