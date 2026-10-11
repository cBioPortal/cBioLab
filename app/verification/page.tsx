// /verification — how the numbers this tool reports are checked, written for the people who read
// them (bench scientists, PIs) rather than for the people who maintain the code. Server component:
// every figure on it is read from what the checks themselves wrote (docs/verification/*.json, from
// scripts/check-portal-parity.ts, check-cohort-logic.ts and check-mutants.ts), from the golden
// fixtures the statistics tests read, and from lib/verification.ts — so the page reports the last
// run, and says when that was, instead of restating claims by hand.
import { PageTools } from "../_agent/PageTools.tsx";
import { STAT_CHECKS, COXNET_CHECK, JUDGMENT_CALLS } from "../../lib/verification.ts";
import { VERIFIED } from "../../lib/method.ts";
import { REPRODUCTIONS } from "../../lib/reproductions.ts";
import { EXAMPLES } from "../../lib/dsl-reference.ts";
import parity from "../../docs/verification/portal-parity.json" with { type: "json" };
import logic from "../../docs/verification/cohort-logic.json" with { type: "json" };
import mutants from "../../docs/verification/mutants.json" with { type: "json" };
import survival from "../../test/fixtures/golden/survival.json" with { type: "json" };
import regression from "../../test/fixtures/golden/regression.json" with { type: "json" };
import tables from "../../test/fixtures/golden/tables.json" with { type: "json" };
import moments from "../../test/fixtures/golden/moments.json" with { type: "json" };
import incidence from "../../test/fixtures/golden/incidence.json" with { type: "json" };
import gsea from "../../test/fixtures/golden/gsea.json" with { type: "json" };
import coxnet from "../../test/fixtures/golden/coxnet.json" with { type: "json" };

export const metadata = { title: "How we check the numbers — cbio-lab" };

const FIXTURES: Record<string, Record<string, unknown>> = { survival, regression, tables, moments, incidence, gsea, coxnet };
const caseCount = (fixture: string, keys: string[]) =>
  keys.reduce((n, k) => n + ((FIXTURES[fixture][k] as unknown[] | undefined)?.length || 0), 0);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const STUDY_NOTE: Record<string, string> = {
  brca_tcga: "whole-exome; publishes two copy-number profiles",
  nsclc_ctdx_msk_2022: "eight different gene panels",
  msk_ch_2020: "mostly whole-exome, some panel",
  crc_apc_impact_2020: "one targeted panel",
  luad_tcga_pan_can_atlas_2018: "whole-exome",
  blca_mskcc_solit_2014: "targeted panel; see the limits below",
  msk_chord_2024: "25,000 patients with treatment timelines, several panels, OncoKB driver calls",
};
const PARITY_GROUPS: Record<string, string> = {
  size: "patients and samples", mutations: "mutation frequency", "copy number": "copy-number frequency",
  "structural variants": "fusion frequency", clinical: "clinical counts", cohort: "filtered cohorts",
};
const GUARD_LABEL: Record<string, string> = {
  unit: "statistics checks", "cohort-logic": "cohort-logic checks", "portal-parity": "cBioPortal comparison",
};

function Verdict({ ok }: { ok: boolean }) {
  return <span className={"verif-mark " + (ok ? "ok" : "err")} aria-label={ok ? "passes" : "fails"}>{ok ? "✓" : "✗"}</span>;
}

export default function VerificationPage() {
  const byStudy = parity.studies.map((s) => {
    const rows = parity.checks.filter((c) => c.study === s);
    return { study: s, total: rows.length, agree: rows.filter((c) => c.agree).length };
  });
  const repro = { total: REPRODUCTIONS.length, full: REPRODUCTIONS.filter((r) => r.badge === "full").length,
    partial: REPRODUCTIONS.filter((r) => r.badge === "partial").length };
  const statCases = STAT_CHECKS.reduce((n, c) => n + caseCount(c.fixture, c.caseKeys), 0) + caseCount(COXNET_CHECK.fixture, COXNET_CHECK.caseKeys);
  const blcaShared = parity.checks.find((c) => c.study === "blca_mskcc_solit_2014" && c.group === "copy number");
  const shipped = mutants.mutants.find((m) => m.history)?.history;
  // the same rule checked in several studies reads as one claim with a line of numbers per study
  const lastRun = [parity.ranAt, logic.ranAt, mutants.ranAt].sort()[0];
  const logicStudies = [...new Set(logic.checks.map((c) => c.study))];
  const suiteStudies = [...new Set([...parity.studies, ...logicStudies])].map((id) => ({
    id,
    usedBy: [parity.studies.includes(id) && "counts against cBioPortal", logicStudies.includes(id) && "cohort logic"].filter((x): x is string => !!x),
    why: STUDY_NOTE[id] || "",
  }));
  const claims: { claim: string; runs: typeof logic.checks }[] = [];
  for (const c of logic.checks) {
    const seen = claims.find((x) => x.claim === c.claim);
    if (seen) seen.runs.push(c); else claims.push({ claim: c.claim, runs: [c] });
  }

  return (
    <main className="repro-page verif-page">
      <div className="repro-nav">
        <a href="/lab">← back to the app</a>
        <a href="/reproductions">paper reproductions</a>
        <a href="/rationale">rationale</a>
        <span className="spacer" />
        <PageTools kind="verification" spec={{ parity, logic, mutants }} />
      </div>

      <div className="repro-intro">
        <h1>How we check the numbers</h1>
        <p className="lede">
          This page is the report of an <b>automated verification suite</b>: a set of programs that check
          this tool&apos;s numbers against things we did not write, namely cBioPortal and the standard
          statistics libraries. It is built to run in continuous integration (CI): automatically, on every
          proposed change to the code, blocking any change that fails a check and publishing each run&apos;s
          results as a report. This page displays that report. The results below are from the run on{" "}
          {when(lastRun)}.
        </p>
        <p className="lede" style={{ marginTop: "var(--s3)" }}>
          Why this matters: much of this tool&apos;s code was written with an AI assistant. That is a reason to
          check its numbers, not to trust them, so nothing here asks you to trust the code. Every check
          compares against an independent source, every check can be rerun by anyone with the same access,
          and the checks have themselves been tested by planting bugs in the code and confirming each bug is
          caught.
        </p>
        <div className="repro-tiles">
          <div className="repro-tile ok"><span className="n">{parity.agree}/{parity.total}</span><span className="l">counts match cBioPortal</span></div>
          <div className="repro-tile ok"><span className="n">{logic.pass}/{logic.total}</span><span className="l">cohort rules hold</span></div>
          <div className="repro-tile ok"><span className="n">{STAT_CHECKS.length + 1}</span><span className="l">groups of statistics match the standard libraries</span></div>
          <div className="repro-tile ok"><span className="n">{mutants.caught}/{mutants.total}</span><span className="l">planted bugs caught</span></div>
          <div className="repro-tile"><span className="n">{repro.full}/{repro.total}</span><span className="l">papers fully reproduced (checked by hand, not by the suite)</span></div>
        </div>
      </div>

      <nav className="verif-toc" aria-label="On this page">
        <a href="#suite">How the suite runs</a>
        <a href="#counts">1. Counts</a>
        <a href="#cohorts">2. Cohorts</a>
        <a href="#statistics">3. Statistics</a>
        <a href="#recheck">4. Recheck a result</a>
        <a href="#papers">5. Papers</a>
        <a href="#planted">6. Planted bugs</a>
        <a href="#limits">What this does not show</a>
        <a href="#rerun">Rerun</a>
      </nav>

      <section className="verif-sec" id="suite">
        <h2>How the suite runs, and what it depends on</h2>
        <p>
          The suite has five stages. On every proposed change, CI runs all of them, together with a build of
          the app and its end-to-end browser tests, and keeps the report as an artifact of the run. Anyone
          can run the same five stages with one command, <span className="mono">npm run verify</span>, which
          takes about ten minutes and stops with an error if any check fails. The report is written to{" "}
          <span className="mono">docs/verification/</span>; this page shows the copy saved with the code,
          refreshed from a passing run.
        </p>
        <table className="verif-table">
          <thead><tr><th>Stage</th><th>What it checks</th><th>What it needs</th></tr></thead>
          <tbody>
            <tr><td>Statistics</td><td>Each statistical method against lifelines, statsmodels and scipy (section 3)</td>
              <td>Nothing external: no network, no database. The reference answers are saved with the code.</td></tr>
            <tr><td>Counts against cBioPortal</td><td>Cohort sizes, gene frequencies, clinical counts and filtered cohorts (section 1)</td>
              <td>The <b>public cBioPortal API</b> at <span className="mono">www.cbioportal.org</span> (no account or key), and the <b>warehouse</b></td></tr>
            <tr><td>Cohort logic</td><td>And / or / not, splits, lines of therapy, held-out halves (section 2)</td>
              <td>The <b>warehouse</b>, including its OncoKB annotations for driver mutations</td></tr>
            <tr><td>Method scripts</td><td>Each example analysis&apos;s Python script reproduces its numbers (section 4)</td>
              <td>The <b>warehouse</b>, and Python with pinned versions of the statistics libraries</td></tr>
            <tr><td>Planted bugs</td><td>Each planted bug makes at least one of the checks above fail (section 6)</td>
              <td>Whatever the stages it reruns need</td></tr>
          </tbody>
        </table>
        <p>
          <b>The warehouse</b> is this tool&apos;s own database: a copy of the public studies in cBioPortal,
          loaded into ClickHouse, which is the database every analysis in the app runs against. The suite
          only reads from it. In CI, the read-only login is supplied as a secret.
        </p>
        <p><b>The studies the suite uses</b>, chosen because each exercises something that is easy to get wrong:</p>
        <table className="verif-table">
          <thead><tr><th>Study</th><th>Used by</th><th>Why</th></tr></thead>
          <tbody>
            {suiteStudies.map((st) => (
              <tr key={st.id}>
                <td className="mono"><a href={"https://www.cbioportal.org/study/summary?id=" + st.id}>{st.id}</a></td>
                <td>{st.usedBy.join(", ")}</td>
                <td>{st.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>One known source of false alarms.</b> The cBioPortal comparison needs both sides to hold the same
          release of each study. If cBioPortal updates a study before the warehouse is reloaded, the
          comparison fails even though nothing in the code is wrong. That failure is intended: the suite
          reports the difference rather than tolerating it, and someone has to check whether the cause is the
          data or the code.
        </p>
      </section>

      <section className="verif-sec" id="counts">
        <h2><span className="q">1</span> Are the patient and mutation counts the same as cBioPortal&apos;s?</h2>
        <p>
          cBioPortal has been used and checked by the cancer genomics community for over a decade, and it was
          built by a different team on separate code. We ask both tools the same questions about the same
          studies and require <b>exactly</b> the same answer. A count either matches or it does not, so no
          tolerance is allowed. The questions cover cohort sizes, how often each top gene is mutated,
          amplified, deleted or fused (both the number of altered samples and the number of samples
          sequenced for that gene), clinical counts, and filtered cohorts such as &ldquo;patients with a TP53
          mutation&rdquo;.
        </p>
        <table className="verif-table">
          <thead><tr><th>Study</th><th>Why it was chosen</th><th className="num">Comparisons</th><th className="num">Agree</th></tr></thead>
          <tbody>
            {byStudy.map((s) => (
              <tr key={s.study}>
                <td className="mono">{s.study}</td>
                <td>{STUDY_NOTE[s.study] || ""}</td>
                <td className="num">{s.total}</td>
                <td className="num"><Verdict ok={s.agree === s.total} /> {s.agree}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="verif-more">
          <summary>All {parity.total} comparisons</summary>
          <table className="verif-table compact">
            <thead><tr><th>Study</th><th>What</th><th className="num">This tool</th><th className="num">cBioPortal</th><th></th></tr></thead>
            <tbody>
              {parity.checks.map((c, i) => (
                <tr key={i}>
                  <td className="mono">{c.study}</td>
                  <td>{PARITY_GROUPS[c.group] || c.group}: {c.what}</td>
                  <td className="num mono">{c.ours}</td>
                  <td className="num mono">{c.portal}</td>
                  <td><Verdict ok={c.agree} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <p className="verif-run">Last run {when(parity.ranAt)} against {parity.reference}. Frequencies are shown as altered / sequenced for that gene.</p>
      </section>

      <section className="verif-sec" id="cohorts">
        <h2><span className="q">2</span> Does a cohort contain the patients its definition says?</h2>
        <p>
          No reference program can tell us who belongs in &ldquo;never-smokers with a TP53 mutation who
          received immunotherapy&rdquo;. What we can test is logic that must hold whatever the right answer
          is. For example, &ldquo;A and B&rdquo; must be exactly the patients found in both A and B, and a
          cohort plus its opposite must make up the whole study. The tool computes each side separately on
          real data, and the check compares the actual patient lists, not just the totals.
        </p>
        <ul className="verif-checks">
          {claims.map((c) => (
            <li key={c.claim}>
              <Verdict ok={c.runs.every((r) => r.pass)} />
              <span className="claim">{c.claim}</span>
              {c.runs.map((r, i) => <span className="detail" key={i}><span className="mono">{r.study}</span> · {r.detail}</span>)}
            </li>
          ))}
        </ul>
        <p className="verif-run">Last run {when(logic.ranAt)}.</p>
      </section>

      <section className="verif-sec" id="statistics">
        <h2><span className="q">3</span> Are the statistics computed correctly?</h2>
        <p>
          Every statistical method the tool reports is checked against the library statisticians already
          use for it: lifelines, statsmodels and scipy, which are widely used in published analyses.
          Both are given the same datasets ({statCases.toLocaleString()} test cases in all). The test data
          is chosen to be awkward: tied death times, empty groups, very small and very large counts, patients
          who enter the study late. Our numbers must match the library&apos;s to the precision shown below,
          and the check runs before every release.
        </p>
        <table className="verif-table">
          <thead><tr><th>Method</th><th>Used in</th><th>Checked against</th><th>Must agree to</th><th className="num">Cases</th></tr></thead>
          <tbody>
            {STAT_CHECKS.map((c) => (
              <tr key={c.method}>
                <td>{c.method}</td>
                <td>{c.usedFor}</td>
                <td>{c.keys.map((k) => VERIFIED[k].library + " " + VERIFIED[k].version).filter((x, i, a) => a.indexOf(x) === i).join(", ")}</td>
                <td>{c.agreement}</td>
                <td className="num">{caseCount(c.fixture, c.caseKeys)}</td>
              </tr>
            ))}
            <tr>
              <td>{COXNET_CHECK.method}</td>
              <td>{COXNET_CHECK.usedFor}</td>
              <td>{COXNET_CHECK.reference}</td>
              <td>{COXNET_CHECK.agreement}</td>
              <td className="num">{caseCount(COXNET_CHECK.fixture, COXNET_CHECK.caseKeys)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="verif-sec" id="recheck">
        <h2><span className="q">4</span> Can I check a specific result myself?</h2>
        <p>
          Yes. Every result in the analysis app has a <b>How this was computed</b> panel. It lists each
          step from the database rows to the number on screen, the exact database queries that ran, and a
          short Python script that recomputes the result with the standard libraries. You can send that
          script to a statistician or run it yourself.
        </p>
        <p>
          The scripts are checked too. Before every release, the analyses in the app&apos;s Examples gallery
          ({EXAMPLES.length} of them) are run, and every script must reproduce the numbers the app showed.
          If the code changes how a result is computed but the script is not updated to match, the check
          fails.
        </p>
      </section>

      <section className="verif-sec" id="papers">
        <h2><span className="q">5</span> Does it find what published papers found?</h2>
        <p>
          We took {repro.total} published cancer genomics papers whose data is in cBioPortal and re-derived
          their main findings from scratch with this tool. {repro.full} reproduce fully, {repro.partial}{" "}
          partly, and the rest are blocked by data the study does not include. Each one opens in the app
          as a runnable analysis, with the paper&apos;s claim written beside our result. One reproduction
          found a bug in this tool: a sarcoma study with no copy-number data reported MDM2 amplification
          as 0% instead of saying the data was missing. That bug has been fixed.
        </p>
        <p><a className="repro-open" href="/reproductions">See the paper reproductions →</a></p>
      </section>

      <section className="verif-sec" id="planted">
        <h2><span className="q">6</span> Would these checks notice a mistake?</h2>
        <p>
          A check that always passes proves nothing. To show these checks would notice a real error, we
          planted {mutants.total} realistic bugs in the code, one at a time, and reran the checks after
          each. These are bugs that produce believable but wrong numbers rather than crashes. {mutants.caught}{" "}
          of {mutants.total} were caught.
          {shipped && <> One is a real bug this project once shipped: {shipped.replace(/^Shipped once: /, "")}{" "}
          The cBioPortal comparison now catches it.</>}
        </p>
        <table className="verif-table">
          <thead><tr><th>The planted bug</th><th>Result</th><th>What the check reported</th></tr></thead>
          <tbody>
            {mutants.mutants.map((m) => (
              <tr key={m.id}>
                <td>{m.effect}{m.history && <span className="verif-shipped"> shipped once</span>}</td>
                <td><span className={"verif-pill " + (m.caught ? "ok" : "err")}>{m.caught ? "caught" : "missed"}</span> {GUARD_LABEL[m.guard]}</td>
                <td className="evidence">{m.failures ? m.failures + " failing · " : ""}{m.evidence.replace(/^(FAIL |not ok \d+ - )/, "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="verif-run">Last run {when(mutants.ranAt)}.</p>
      </section>

      <section className="verif-sec limits" id="limits">
        <h2>What these checks do not show</h2>
        <ul>
          <li>
            <b>Matching cBioPortal shows we compute the same thing from the same data, not that the data
            is right, and not that cBioPortal is right.</b> We found an example while building this page.
            In <span className="mono">blca_mskcc_solit_2014</span>, one copy-number dataset is labeled as
            whole-exome even though the samples were sequenced on a panel. Both tools therefore count each
            sample twice: copy-number frequencies are divided by 218 for a 109-sample study
            {blcaShared && <> (for example, {blcaShared.what}: {blcaShared.ours} in both tools)</>}, so they
            appear half as common as they are. We have not changed this tool to differ from cBioPortal: the fix
            belongs in the study&apos;s data, where it corrects both.
          </li>
          <li>
            <b>The checks cover the studies, genes and questions listed above, not every possible query.</b>
            They were chosen to include the hard cases (several gene panels in one study, two copy-number
            datasets, timelines), but an untested combination could still be wrong.
          </li>
          <li>
            <b>The statistics checks show the arithmetic matches the reference library.</b> They do not show
            that a method is the right choice for your question. The choices we made are listed below so a
            statistician can review them.
          </li>
          <li>
            <b>No software can check study design.</b> Comparing patients who reached a third line of
            therapy with those who did not builds in survival bias (to reach a third line, a patient has to
            live long enough). The tool attaches caveats like this to its results where it can detect them,
            but interpreting a result is still the researcher&apos;s job.
          </li>
          <li>
            <b>The paper reproductions are rerun by hand when they are revised, not automatically.</b> As
            the database is updated, a rerun may give slightly different numbers.
          </li>
        </ul>
      </section>

      <section className="verif-sec" id="choices">
        <h2>Choices a statistician should review</h2>
        <p>Where there is more than one defensible method, this is the one the tool uses. Each is pinned by the checks in section 3.</p>
        <dl className="verif-choices">
          {JUDGMENT_CALLS.map((j) => (
            <div key={j.choice}><dt>{j.choice}</dt><dd>{j.why}</dd></div>
          ))}
        </dl>
      </section>

      <section className="verif-sec" id="rerun">
        <h2>Running the suite</h2>
        <p>
          With network access, the warehouse login in <span className="mono">.env.local</span>, and{" "}
          <span className="mono">uv</span> for Python:
        </p>
        <pre className="verif-cmd">{[
          "npm run verify          # every stage below; writes the report to docs/verification/",
          "",
          "npm test                # statistics (no database or network needed)",
          "npm run check:portal    # counts against cBioPortal",
          "npm run check:cohorts   # cohort logic",
          "npm run check:methods   # every example's Python script reproduces its numbers",
          "npm run check:mutants   # plant each bug, confirm a check catches it (about three minutes)",
        ].join("\n")}</pre>
        <p className="verif-run">
          The reference answers for the statistics are generated by the Python scripts in{" "}
          <span className="mono">python/golden/</span>, with library versions pinned, so a statistician can
          regenerate them independently.
        </p>
      </section>
    </main>
  );
}
