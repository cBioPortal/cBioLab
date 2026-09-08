// Oncoprint lab: /oncoprint-lab?spec=<base64url OncoprintSpec> or ?preset=chord|top5|top11
// Spike surface for the level-of-detail client renderer over the binary contract.
// Stateless — the link is the spec, like /provenance.
import OncoprintLab from "./OncoprintLab.tsx";

export const metadata = { title: "Oncoprint lab — Cohort Lab" };
export const dynamic = "force-dynamic";

const GENES = ["TP53", "KRAS", "EGFR", "STK11", "KEAP1", "PIK3CA", "ARID1A"];
const BIG = ["msk_impact_50k_2026", "msk_ch_2023", "msk_met_2021", "msk_chord_2024", "msk_ch_2020", "msk_impact_2017",
  "pan_origimed_2020", "sarcoma_msk_2022", "crc_msk_2026", "msk_ctdna_vte_2024", "pancan_mimsi_msk_2024"];
const PRESETS: Record<string, { label: string; spec: Record<string, unknown> }> = {
  chord: { label: "MSK-CHORD, 25k patients, two cohorts", spec: { study: "msk_chord_2024", genes: GENES, clinical: ["CANCER_TYPE", "CURRENT_AGE_DEID"],
    layout: { groupBy: { kind: "cohorts", groups: [
      { name: "TP53 mut", dsl: { all: [{ kind: "oql", q: "TP53: MUT" }] } },
      { name: "TP53 wt", dsl: { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] } } ] } } } },
  top5: { label: "5 largest studies, ~166k patients", spec: { studies: BIG.slice(0, 5), genes: GENES, clinical: ["CANCER_TYPE", "AGE"] } },
  top11: { label: "11 largest studies, ~211k patients", spec: { studies: BIG, genes: GENES, clinical: ["CANCER_TYPE", "AGE"] } },
  genie: { label: "GENIE public + 5 largest, ~409k patients", spec: { studies: ["genie_public", ...BIG.slice(0, 5)], dbs: { genie_public: "cbioportal_genie_green" }, genes: GENES, clinical: ["CANCER_TYPE", "SEX"] } },
  genie11: { label: "GENIE public + 11 largest, ~454k patients", spec: { studies: ["genie_public", ...BIG], dbs: { genie_public: "cbioportal_genie_green" }, genes: GENES, clinical: ["CANCER_TYPE", "SEX"] } }
};

export default async function OncoprintLabPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  let spec: Record<string, unknown> | null = null, error: string | null = null;
  const preset = typeof sp.preset === "string" ? sp.preset : null;
  try {
    if (typeof sp.spec === "string") spec = JSON.parse(Buffer.from(sp.spec, "base64url").toString("utf8"));
    else spec = PRESETS[preset || "chord"]?.spec ?? null;
    if (!spec) throw new Error("unknown preset; use ?preset=" + Object.keys(PRESETS).join("|") + " or ?spec=<base64url>");
  } catch (e) { error = String((e as Error)?.message || e); }
  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">oncoprint lab — level-of-detail canvas over the binary contract</span>
        <span className="spacer" />
        <a href="/oncoprint-lab/cli" style={{ color: "var(--accent-ink)", fontSize: "0.8rem", marginRight: "1rem" }}>command line →</a>
        <a href="/oncoprint-lab/python" style={{ color: "var(--accent-ink)", fontSize: "0.8rem", marginRight: "1rem" }}>python notebook →</a>
        <a href="/analysis" style={{ color: "var(--accent-ink)", fontSize: "0.8rem" }}>analysis →</a>
      </header>
      <main>
        <p className="meta" style={{ margin: "0 0 0.6rem" }}>
          presets: {Object.entries(PRESETS).map(([k, p]) => (
            <a key={k} href={"/oncoprint-lab?preset=" + k} style={{ marginRight: "1rem", fontWeight: (preset || "chord") === k ? 600 : 400 }}>{p.label}</a>
          ))}
        </p>
        {error && <div className="error">{error}</div>}
        {spec && <OncoprintLab spec={spec} />}
        {spec && <details style={{ marginTop: "0.6rem" }}><summary className="meta">spec</summary><pre>{JSON.stringify(spec, null, 2)}</pre></details>}
      </main>
    </>
  );
}
