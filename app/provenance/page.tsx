// Provenance page: /provenance?spec=<base64url OncoprintSpec>
// Server component — decodes the spec from the URL, re-renders the oncoprint (inline SVG),
// and shows the DSL plus every SQL query the spec compiles to. Stateless: the link IS the spec.
import { buildContract } from "../../lib/oncoprint.ts";
import { specToQueries } from "../../lib/oncoprint.ts";
import { oncokbPin } from "../../lib/annotation.ts";
import { contractToSvg } from "../../lib/oncoprint-svg.ts";

export const metadata = { title: "Oncoprint provenance — cbio-lab" };
export const maxDuration = 60;
export const instant = false;

export default async function ProvenancePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  let spec: any = null, queries: any = null, svg: string | null = null, contract: any = null, error: string | null = null;
  try {
    if (typeof sp.spec !== "string") throw new Error("missing ?spec= parameter (base64url-encoded OncoprintSpec)");
    spec = JSON.parse(Buffer.from(String(sp.spec), "base64url").toString("utf8"));
    ({ queries } = specToQueries(spec, await oncokbPin()));
    contract = await buildContract(spec);
    svg = contractToSvg(contract, 1200);
  } catch (e) {
    error = String((e as Error)?.message || e);
  }
  return (
    <>
      <header>
        <h1>cbio-lab</h1>
        <span className="sub">oncoprint provenance — the picture, the DSL, and the SQL behind it</span>
        <span className="spacer" />
        {typeof sp.spec === "string" && <>
          <a href={"/oncoprint-lab?spec=" + sp.spec} style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>interactive figure →</a>
          <a href={"/oncoprint-lab/cli?spec=" + sp.spec} style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)", marginRight: "1rem" }}>command line →</a>
          <a href={"/oncoprint-lab/python?spec=" + sp.spec} style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>python notebook →</a>
        </>}
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {contract && (
          <div className="card">
            <h2>Rendered oncoprint <span className="plain">— {contract.stats.nColumns.toLocaleString()} patients · {contract.tracks.length} tracks · re-rendered live from the spec below</span></h2>
            <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid var(--line)" }}
              dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
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
            {queries.map((q: { label: string; sql: string }, i: number) => (
              <div key={i} style={{ marginBottom: "1rem" }}>
                <p style={{ margin: "0 0 0.3rem", fontSize: "var(--t-md)" }}><strong>{i + 1}. {q.label}</strong></p>
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
