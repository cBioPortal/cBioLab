// Provenance page: /provenance?spec=<base64url OncoprintSpec>
// Server component — decodes the spec from the URL, re-renders the oncoprint (inline SVG),
// and shows the DSL plus every SQL query the spec compiles to. Stateless: the link IS the spec.
import { buildContract } from "../../lib/oncoprint.ts";
import { specToQueries } from "../../lib/oncoprint.ts";
import { contractToSvg } from "../../lib/oncoprint-svg.ts";

export const metadata = { title: "Oncoprint provenance — Cohort Lab" };
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export default async function ProvenancePage({ searchParams }) {
  const sp = await searchParams;
  let spec = null, queries = null, svg = null, contract = null, error = null;
  try {
    if (!sp.spec) throw new Error("missing ?spec= parameter (base64url-encoded OncoprintSpec)");
    spec = JSON.parse(Buffer.from(String(sp.spec), "base64url").toString("utf8"));
    ({ queries } = specToQueries(spec));
    contract = await buildContract(spec);
    svg = contractToSvg(contract, 1200);
  } catch (e) {
    error = String(e.message || e);
  }
  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">oncoprint provenance — the picture, the DSL, and the SQL behind it</span>
        <span className="spacer" />
        <a href="/oncoprint" style={{ color: "var(--accent-ink)", fontSize: "0.8rem" }}>oncoprint builder →</a>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {contract && (
          <div className="card">
            <h2>Rendered oncoprint <span className="plain">— {contract.stats.nColumns.toLocaleString()} patients · {contract.tracks.length} tracks · re-rendered live from the spec below</span></h2>
            <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid var(--line)" }}
              dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="note">Conventions: {JSON.stringify(contract.conventions)}</p>
          </div>
        )}
        {spec && (
          <div className="card">
            <h2>OncoprintSpec <span className="plain">— the declarative definition (this URL encodes it; the link is the spec)</span></h2>
            <pre>{JSON.stringify(spec, null, 2)}</pre>
          </div>
        )}
        {queries && (
          <div className="card">
            <h2>Generated SQL <span className="plain">— every query the spec compiles to, in execution order</span></h2>
            {queries.map((q, i) => (
              <div key={i} style={{ marginBottom: "1rem" }}>
                <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}><strong>{i + 1}. {q.label}</strong></p>
                <pre>{q.sql}</pre>
              </div>
            ))}
            <p className="note">Contract assembly (bitmask cells, NOT_PROFILED marking, staircase sort, panel-aware frequencies) happens in application code over these result sets — see <code>lib/oncoprint.js</code>.</p>
          </div>
        )}
      </main>
    </>
  );
}
