"use client";
// The campaign start page. Campaigns are started by the researcher's AI assistant in the
// browser (Claude in the Chrome sidebar) through this page's tools — the app never calls a
// model. A campaign's own page is where the work happens (app/campaign/[id]/page.tsx).
import { useEffect, useState } from "react";
import { installIndexTools } from "./agent-tools.ts";
import { Prompt } from "./prompt.tsx";
import { AgentToolsMenu } from "../_agent/AgentToolsMenu.tsx";
import LoginButton from "../lab/login-button.tsx";

type Row = { id: string; question: string; study: string; status: string; lockedAt: string | null; createdAt: string };

const START_PROMPT = `On this page, use window.cohortLab.createCampaign(question) to start a hypothesis campaign for my research question below, in my words. When the campaign page opens, read its "For AI agents" section, then write and register hypotheses for it. Do not lock the campaign. My question: `;

const EXAMPLES = [
  "What distinguishes non-small cell lung cancer patients who fail first-line immunotherapy within 6 months from those who respond durably?",
  "In colorectal cancer, which genomic and clinical features are associated with shorter overall survival after first chemotherapy?",
  "Among breast cancer patients treated with hormone therapy, what predicts progression within a year?"
];

export default function CampaignIndex() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [webmcp, setWebmcp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/campaign", { cache: "no-store" }).then((r) => r.json())
      .then((j) => j.error ? setErr(j.error) : setRows(j.campaigns)).catch((e) => setErr(String(e)));
    const t = installIndexTools();
    setWebmcp(t.webmcp);
    return t.cleanup;
  }, []);

  return (
    <>
      <header>
        <h1>Hypothesis campaigns</h1>
        <span className="sub">cbio-lab as the referee for AI-generated hypotheses</span>
        <span className="spacer" />
        <a href="/lab" className="camp-nav">analysis app</a>
        <a href="/rationale" className="camp-nav">why this exists</a>
        <LoginButton />
        <AgentToolsMenu page="campaign list" tools={[["campaign_create", "createCampaign(question, study?)"], ["campaign_list", "listCampaigns()"]]} webmcp={webmcp}
          intro="Your AI assistant — Claude in the Chrome sidebar — starts a campaign for your question with these tools; the campaign's own page then has the tools for its hypotheses." />
      </header>
      <main className="camp">
        <section className="camp-explain">
          <div><strong>1 · You ask</strong><p>Your research question, in plain words, to your AI assistant — Claude in the Chrome sidebar.</p></div>
          <div><strong>2 · AI proposes</strong><p>It writes candidate hypotheses as precise, checkable analyses through this site's tools. You edit the list and add your own.</p></div>
          <div><strong>3 · Lock in</strong><p>The list is timestamped and frozen before any result exists. Nothing can be quietly dropped later.</p></div>
          <div><strong>4 · The tool referees</strong><p>Each is tested on half the patients, corrected for how many were tried, and rechecked on the other half.</p></div>
        </section>

        <section className="card">
          <h2>Start a campaign</h2>
          <p className="camp-help">
            This site does not call an AI model. Your assistant in the browser starts the campaign and writes its hypotheses
            through the tools this page exposes (<a href="#for-ai-agents">For AI agents</a>, below); the site checks everything
            it submits against the data and keeps the record. Starting a campaign, and changing one, needs the login (top
            right); reading them does not. Open the sidebar on this page and give it your question:
          </p>
          <Prompt label="Start a campaign over WebMCP" text={START_PROMPT} />
          <p className="camp-help">Example questions, on msk_chord_2024:</p>
          <ul className="camp-exlist">{EXAMPLES.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>

        <section className="card">
          <h2>Campaigns</h2>
          {err && <p className="camp-err">{err}</p>}
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

        <details className="card camp-agent" id="for-ai-agents" open>
          <summary><h2>For AI agents <span className="plain">· start a campaign with tools</span></h2></summary>
          <p className="camp-help">
            A browser agent that supports <strong>WebMCP</strong> finds these through <code>document.modelContext</code>; any agent
            that can run JavaScript here can call them as <code>window.cohortLab.*</code> (each returns a promise).{" "}
            {webmcp === null ? "" : webmcp ? "WebMCP: tools registered in this browser." : "WebMCP is not available in this browser — use window.cohortLab."}
          </p>
          <table className="camp-table camp-tools">
            <thead><tr><th>WebMCP tool</th><th>window.cohortLab</th></tr></thead>
            <tbody>
              <tr><td><code>campaign_create</code></td><td><code>createCampaign(question, study?)</code></td></tr>
              <tr><td><code>campaign_list</code></td><td><code>listCampaigns()</code></td></tr>
            </tbody>
          </table>
          <p className="camp-help">
            <code>createCampaign</code> takes the user's question in their words (study defaults to msk_chord_2024) and opens the
            new campaign's page, whose own "For AI agents" section has the tools for writing, checking and registering hypotheses.
          </p>
        </details>
      </main>
    </>
  );
}
