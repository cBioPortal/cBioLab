// /reproductions — real published papers, reproduced against the live warehouse with today's
// DSL. Server component: the gallery is built from lib/reproductions.ts, a source-controlled
// list of real AnalysisDocs — nothing here queries the database itself, that happens once each
// reader clicks through to /lab, exactly like the Examples tab's "copy link"/"Run" pattern.
//
// Each card's "Open in Lab" link carries the FULL document as a ?doc= base64url blob (the same
// encoding /lab's own docLink() produces client-side) — the document's own `notes` and each
// view's own `note` are what actually explain the paper connection, so it travels with the
// analysis rather than living only on this listing page.
import { REPRODUCTIONS, type PaperReproduction } from "../../lib/reproductions.ts";

export const metadata = { title: "Paper reproductions — cbio-lab" };

const BADGE_LABEL: Record<PaperReproduction["badge"], string> = {
  full: "fully reproduced", partial: "partially reproduced", gap: "blocked", bugfound: "bug found"
};

function docLink(doc: unknown): string {
  return "/lab?doc=" + Buffer.from(JSON.stringify(doc), "utf-8").toString("base64url");
}

export default function ReproductionsPage() {
  const counts = REPRODUCTIONS.reduce(
    (acc, r) => { acc[r.badge] = (acc[r.badge] || 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <main className="repro-page">
      <div className="repro-nav">
        <a href="/lab">← back to the app</a>
        <a href="/rationale">rationale</a>
      </div>

      <div className="repro-intro">
        <h1>Paper reproductions</h1>
        <p className="lede">
          Published cancer-genomics findings, reproduced against the live database using this
          tool's own analysis-document DSL — no source changes, just the DSL as it stands today.
          Every number below was run live while this page's content was written; a rerun may
          drift slightly as the warehouse reloads, which each view's own caveat discloses rather
          than something this page freezes in place.
        </p>
        <p className="lede" style={{ marginTop: "var(--s3)" }}>
          Reassessed on 28 September 2026, after eight new view kinds landed. Three papers moved:
          Jonsson's 1p/19q co-deletion, blocked until now, reproduces from the copy-number segments,
          alongside its cell-cycle and recurrence findings; Razavi's endocrine-resistance genes
          (ESR1, NF1, ERBB2) reproduce against the closest proxy the study records; and Jee's
          tissue-versus-plasma finding is compared within patients. The rest were checked and are
          unchanged. The sarcoma study still has no copy-number data, and gastric cancer's
          immunotherapy outcomes are too sparse and oddly coded. Endometrial survival is simply not
          significant on this release. The prostate race analysis still needs a comparison held
          within a second attribute (stage), which none of the new views provides.
        </p>
        <div className="repro-tiles">
          <div className="repro-tile"><span className="n">{REPRODUCTIONS.length}</span><span className="l">papers</span></div>
          <div className="repro-tile ok"><span className="n">{counts.full || 0}</span><span className="l">fully reproduced</span></div>
          <div className="repro-tile mark"><span className="n">{counts.partial || 0}</span><span className="l">partial</span></div>
          <div className="repro-tile err"><span className="n">{counts.bugfound || 0}</span><span className="l">bug found</span></div>
        </div>
      </div>

      <div className="repro-grid">
        {REPRODUCTIONS.map((rep) => (
          <div className="card repro-card" key={rep.slug}>
            <div className="repro-card-head">
              <h3>{rep.title}</h3>
              <span className={"repro-badge " + rep.badge}>{BADGE_LABEL[rep.badge]}</span>
            </div>
            <div className="repro-cite">
              {rep.citation} · <span className="mono">{rep.studyIds.join(", ")}</span>
            </div>
            <p className="repro-summary">{rep.summary}</p>
            <ul className="repro-findings">
              {rep.findings.map((f, i) => (
                <li key={i} className={"repro-finding " + f.verdict}>
                  <span className="repro-claim">{f.claim}</span>
                  <span className="repro-result">{f.result}</span>
                </li>
              ))}
            </ul>
            <div className="repro-card-foot">
              <a className="repro-open" href={docLink(rep.doc)}>Open in Lab →</a>
            </div>
          </div>
        ))}
      </div>

      <footer className="repro-footer">
        Every document above is a real, runnable Analysis document — its own notes (visible once
        opened) explain how each figure connects back to the paper's claim, not just this page's
        summary of it.
      </footer>
    </main>
  );
}
