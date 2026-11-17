/**
 * Fixture check: the Genomic Alterations table's any-type counts (lib/federation-views.ts
 * enrichEvents*Sql), run against the committed fixture study on connection b — never matched as text.
 *
 * The SQL is run over a scratch copy of the fixture's genomic tables, in a database of its own on the
 * fixture's ClickHouse, with a few samples added for the shapes the fixture study does not hold (its
 * panel matrix is relied on by other checks, so it is not changed):
 *   FX-X1-T1  mutations on PEERFIX_NO_EGFR, copy number on PEERFIX_FULL: TP53 on both panels (counted
 *             once), EGFR profiled only through the copy-number panel; TP53 missense, EGFR amplified
 *   FX-X2-T1  mutations whole-exome, copy number on PEERFIX_NO_EGFR; KRAS 5'Flank and Intron (types
 *             outside the portal's tree), EGFR missense
 *   FX-X3-T1  mutations on PEERFIX_FULL only; KRAS with a blank mutation type (stored '')
 *   FX-X4-T1  mutations on PEERFIX_FULL; whole-exome on a log2 copy-number profile only, which the
 *             portal's tab does not ask, so it profiles nothing for copy number
 * Two ways the expected counts are known: pinned by hand for those samples (the rule table's edges:
 * Other on keeps unknown and blank types, Other off drops them, a sample's panels are one union,
 * whole-exome profiles every gene, the discrete profile only), and recomputed for every gene of the
 * fixture plus them by a per-sample reading of the portal's rule written here
 * (ClickhouseAlterationFilterMapper.xml mutationAlterationFilter; CMM-STM-2).
 *
 * Run: npm run check:enrichment-events (connection b must be the fixture peer, `npm run peer-db`)
 */
import { exec, query, sq, type Conn } from "@cbiolab/clickhouse";
import { enrichEventsAlteredSql, enrichEventsPanelProfiledSql, enrichEventsWesSql } from "../lib/federation-views.ts";
import { ALTERATION_EVENTS, MUTATION_UNITS, MUTATION_UNIT_LIST, type AlterationEvent } from "../lib/alteration-events.ts";

const STUDY = "cbiolab_peer_fixture";
// one per run, so two gates on one fixture peer do not drop each other's copy
const SCRATCH = "cbiolab_check_enrichment_events_" + process.pid + "_" + Date.now().toString(36);
const conn: Conn = { id: "b", url: process.env.CLICKHOUSE2_URL || "", user: process.env.CLICKHOUSE2_USER || "", password: process.env.CLICKHOUSE2_PASSWORD || "",
  db: process.env.CLICKHOUSE2_DB || "", label: process.env.CLICKHOUSE2_LABEL };
if (!conn.url || !conn.db) throw new Error("connection b (CLICKHOUSE2_*) is not set: start the fixture with npm run peer-db");
const DB = conn.db;

let failures = 0, passes = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (pass) passes++; else failures++;
};

// a scratch database is written, so refuse anything but the fixture peer (peer-db records its import in this table)
const marker = await query<{ n: string }>(conn, "SELECT count() AS n FROM system.tables WHERE database = " + sq(DB) + " AND name = 'cbiolab_peer_fixture'");
if (!Number(marker[0]?.n)) throw new Error("connection b is not the fixture peer database (no cbiolab_peer_fixture table): refusing to write a scratch database there");

try {
  // ---- the scratch copy: the fixture's rows, and the added samples ----------------------------------------
  await exec(conn, "DROP DATABASE IF EXISTS " + SCRATCH);
  await exec(conn, "CREATE DATABASE " + SCRATCH);
  for (const [t, where] of [["genomic_event_derived", "cancer_study_identifier = " + sq(STUDY)], ["sample_to_gene_panel_derived", "cancer_study_identifier = " + sq(STUDY)],
    ["gene_panel_to_gene_derived", "1"], ["genetic_profile", "1"]] as const) {
    await exec(conn, `CREATE TABLE ${SCRATCH}.${t} AS ${DB}.${t}`);
    await exec(conn, `INSERT INTO ${SCRATCH}.${t} SELECT * FROM ${DB}.${t} WHERE ${where}`);
  }
  const id = (s: string) => STUDY + "_" + s;
  const MUT = id("mutations"), CNA = id("cna"), LOG2 = id("log2CNA");
  await exec(conn, `INSERT INTO ${SCRATCH}.genetic_profile (genetic_profile_id, stable_id, cancer_study_id, genetic_alteration_type, datatype, name, description, show_profile_in_analysis_tab)
    SELECT max(genetic_profile_id) + 1, ${sq(LOG2)}, any(cancer_study_id), 'COPY_NUMBER_ALTERATION', 'LOG2-VALUE', 'Log2 copy number', '', 0 FROM ${SCRATCH}.genetic_profile WHERE stable_id = ${sq(CNA)}`);
  const panelRows: [string, string, string, string][] = [
    ["FX-X1-T1", "MUTATION_EXTENDED", "PEERFIX_NO_EGFR", MUT], ["FX-X1-T1", "COPY_NUMBER_ALTERATION", "PEERFIX_FULL", CNA],
    ["FX-X2-T1", "MUTATION_EXTENDED", "WES", MUT], ["FX-X2-T1", "COPY_NUMBER_ALTERATION", "PEERFIX_NO_EGFR", CNA],
    ["FX-X3-T1", "MUTATION_EXTENDED", "PEERFIX_FULL", MUT],
    ["FX-X4-T1", "MUTATION_EXTENDED", "PEERFIX_FULL", MUT], ["FX-X4-T1", "COPY_NUMBER_ALTERATION", "WES", LOG2],
  ];
  await exec(conn, `INSERT INTO ${SCRATCH}.sample_to_gene_panel_derived (sample_unique_id, alteration_type, gene_panel_id, cancer_study_identifier, genetic_profile_id) VALUES ` +
    panelRows.map(([s, t, p, g]) => `(${sq(id(s))}, ${sq(t)}, ${sq(p)}, ${sq(STUDY)}, ${sq(g)})`).join(", "));
  const eventRows: { s: string; gene: string; vt: "mutation" | "cna"; type?: string; cna?: number; panel: string }[] = [
    { s: "FX-X1-T1", gene: "TP53", vt: "mutation", type: "Missense_Mutation", panel: "PEERFIX_NO_EGFR" },
    { s: "FX-X1-T1", gene: "EGFR", vt: "cna", cna: 2, panel: "PEERFIX_FULL" },
    { s: "FX-X2-T1", gene: "KRAS", vt: "mutation", type: "5'Flank", panel: "WES" },
    { s: "FX-X2-T1", gene: "KRAS", vt: "mutation", type: "Intron", panel: "WES" },
    { s: "FX-X2-T1", gene: "EGFR", vt: "mutation", type: "Missense_Mutation", panel: "WES" },
    { s: "FX-X3-T1", gene: "KRAS", vt: "mutation", type: "", panel: "PEERFIX_FULL" },
  ];
  await exec(conn, `INSERT INTO ${SCRATCH}.genomic_event_derived (sample_unique_id, hugo_gene_symbol, entrez_gene_id, gene_panel_stable_id, cancer_study_identifier,
    genetic_profile_stable_id, variant_type, mutation_variant, mutation_type, mutation_status, driver_filter, driver_filter_annotation, driver_tiers_filter,
    driver_tiers_filter_annotation, cna_alteration, cna_cytoband, sv_event_info, patient_unique_id, off_panel) VALUES ` +
    eventRows.map((e) => `(${sq(id(e.s))}, ${sq(e.gene)}, 0, ${sq(e.panel)}, ${sq(STUDY)}, ${sq(e.vt === "cna" ? CNA : MUT)}, ${sq(e.vt)}, '', ${sq(e.vt === "cna" ? "NA" : e.type!)}, ` +
      `${sq(e.vt === "cna" ? "NA" : "SOMATIC")}, '', '', '', '', ${e.cna ?? "NULL"}, '', '', ${sq(id(e.s.replace(/-T\d$/, "")))}, false)`).join(", "));

  // ---- running the builders --------------------------------------------------------------------------------
  const cohortOf = (samples: string[]) => "SELECT tupleElement(t, 1) AS pid, tupleElement(t, 2) AS sid FROM (SELECT arrayJoin([" +
    samples.map((s) => "(" + sq(s.replace(/-T\d$/, "")) + ", " + sq(s) + ")").join(", ") + "]) AS t)";
  async function counts(samples: string[], events: AlterationEvent[]): Promise<{ altered: Map<string, number>; profiled: (g: string) => number; panel: Map<string, number>; wes: number }> {
    const c = cohortOf(samples);
    const [a, p, w] = await Promise.all([
      query<{ gene: string; altered: string }>(conn, enrichEventsAlteredSql(c, STUDY, SCRATCH, events, null, false)),
      query<{ gene: string; profiled: string }>(conn, enrichEventsPanelProfiledSql(c, STUDY, SCRATCH, events)),
      query<{ n: string }>(conn, enrichEventsWesSql(c, STUDY, SCRATCH, events))]);
    const panel = new Map(p.map((r) => [r.gene, Number(r.profiled)])), wes = Number(w[0]?.n || 0);
    return { altered: new Map(a.map((r) => [r.gene, Number(r.altered)])), panel, wes, profiled: (g) => (panel.get(g) || 0) + wes };
  }

  // ---- pinned: the added samples ------------------------------------------------------------------------------
  const SYN = ["FX-X1-T1", "FX-X2-T1", "FX-X3-T1", "FX-X4-T1"];
  const ev = (...xs: AlterationEvent[]) => xs;
  const allMut = MUTATION_UNIT_LIST;
  const CASES: { label: string; events: AlterationEvent[]; expect: Record<string, [number, number] | null>; wes?: number }[] = [
    { label: "every type", events: [...ALTERATION_EVENTS], wes: 1,
      // TP53: X1's two panels both list it, one sample; KRAS: 5'Flank and Intron (X2) and a blank type (X3) all count
      expect: { TP53: [1, 4], EGFR: [2, 4], KRAS: [2, 4] } },
    { label: "Missense only (Other off: IN)", events: ev("missense"), wes: 1,
      // EGFR is off X1's mutation panel: copy number not selected, so not profiled there
      expect: { TP53: [1, 4], EGFR: [1, 3], KRAS: null } },
    { label: "every mutation type but Missense (Other on: NOT IN)", events: allMut.filter((u) => u !== "missense"), wes: 1,
      expect: { KRAS: [2, 4], TP53: null, EGFR: null } },
    { label: "Missense and Inframe (Other off: IN)", events: ev("missense", "inframe", "inframe_ins", "inframe_del"), wes: 1,
      expect: { KRAS: null, EGFR: [1, 3] } },
    { label: "Amplification only (discrete copy number)", events: ev("amp"), wes: 0,
      // X4's whole-exome row is on the log2 profile: not profiled; X2's NO_EGFR panel lacks EGFR; X3 has no copy-number row
      expect: { EGFR: [1, 1], TP53: null } },
    { label: "Missense and Amplification", events: ev("missense", "amp"), wes: 1,
      expect: { EGFR: [2, 4], TP53: [1, 4] } },
    { label: "Deletion only", events: ev("homdel"), wes: 0, expect: { EGFR: null } },
  ];
  for (const k of CASES) {
    const r = await counts(SYN, k.events);
    for (const [gene, want] of Object.entries(k.expect)) {
      const got: [number, number] | null = r.altered.has(gene) ? [r.altered.get(gene)!, r.profiled(gene)] : null;
      ok(`added samples, ${k.label}: ${gene} altered/profiled`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    if (k.wes != null) ok(`added samples, ${k.label}: whole-exome samples`, r.wes === k.wes, `got ${r.wes}, want ${k.wes}`);
  }

  // ---- every gene of the fixture and the added samples, against a per-sample reading of the portal's rule ------
  const events = await query<{ s: string; gene: string; vt: string; mt: string; st: string; cna: number | null; off: boolean | number }>(conn,
    `SELECT replaceOne(sample_unique_id, ${sq(STUDY + "_")}, '') AS s, hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt, mutation_status AS st,
     cna_alteration AS cna, off_panel AS off FROM ${SCRATCH}.genomic_event_derived`);
  const panels = await query<{ s: string; t: string; p: string; g: string }>(conn,
    `SELECT replaceOne(sample_unique_id, ${sq(STUDY + "_")}, '') AS s, alteration_type AS t, gene_panel_id AS p, genetic_profile_id AS g FROM ${SCRATCH}.sample_to_gene_panel_derived`);
  const discrete = new Set((await query<{ id: string }>(conn, `SELECT stable_id AS id FROM ${SCRATCH}.genetic_profile WHERE genetic_alteration_type = 'COPY_NUMBER_ALTERATION' AND datatype = 'DISCRETE'`)).map((r) => r.id));
  const genesOf = new Map<string, Set<string>>();
  for (const r of await query<{ p: string; gene: string }>(conn, `SELECT gene_panel_id AS p, gene FROM ${SCRATCH}.gene_panel_to_gene_derived`)) {
    if (!genesOf.has(r.p)) genesOf.set(r.p, new Set());
    genesOf.get(r.p)!.add(r.gene);
  }
  const everySample = [...new Set(panels.map((r) => r.s))];

  /** the portal's rule, case by case: a sample is altered by one of its events passing the selection, profiled by the union of its selected profiles' panels */
  function oracle(sel: AlterationEvent[]): { altered: Map<string, number>; profiled: (g: string) => number } {
    const on = MUTATION_UNIT_LIST.filter((u) => sel.includes(u));
    const values = (us: readonly string[]) => new Set<string>(us.flatMap((u) => [...MUTATION_UNITS[u as keyof typeof MUTATION_UNITS]]));
    const mutationCounts = (type: string): boolean => {
      if (!on.length) return false;
      if (on.length === MUTATION_UNIT_LIST.length) return true;
      if (on.includes("other")) return !values(MUTATION_UNIT_LIST.filter((u) => !on.includes(u))).has(type.toLowerCase());
      return values(on).has(type.toLowerCase());
    };
    const passes = (e: (typeof events)[number]) => !e.off && (
      (e.vt === "mutation" && e.st !== "UNCALLED" && mutationCounts(e.mt)) ||
      (e.vt === "cna" && e.cna != null && ((sel.includes("amp") && e.cna >= 2) || (sel.includes("homdel") && e.cna <= -2))) ||
      (e.vt === "structural_variant" && sel.includes("sv")));
    const altered = new Map<string, Set<string>>();
    for (const e of events) if (passes(e)) { if (!altered.has(e.gene)) altered.set(e.gene, new Set()); altered.get(e.gene)!.add(e.s); }
    const types = new Set([on.length && "MUTATION_EXTENDED", (sel.includes("amp") || sel.includes("homdel")) && "COPY_NUMBER_ALTERATION", sel.includes("sv") && "STRUCTURAL_VARIANT"].filter(Boolean));
    const mine = new Map<string, string[]>();
    for (const r of panels) if (types.has(r.t) && (r.t !== "COPY_NUMBER_ALTERATION" || discrete.has(r.g))) mine.set(r.s, [...(mine.get(r.s) || []), r.p]);
    return { altered: new Map([...altered].map(([g, s]) => [g, s.size])),
      profiled: (g) => [...mine.values()].filter((ps) => ps.includes("WES") || ps.some((p) => genesOf.get(p)?.has(g))).length };
  }
  const SELECTIONS: [string, AlterationEvent[]][] = [["every type", [...ALTERATION_EVENTS]], ["Missense only", ev("missense")],
    ["every mutation type but Missense", allMut.filter((u) => u !== "missense")], ["Truncating and Splice, Other off", ev("truncating", "nonsense", "frameshift", "frameshift_ins", "frameshift_del", "nonstart", "nonstop", "splice")],
    ["Amplification and SV", ev("amp", "sv")], ["Deletion and Other", ev("homdel", "other")], ["SV only", ev("sv")]];
  for (const [label, sel] of SELECTIONS) {
    const want = oracle(sel), got = await counts(everySample, sel);
    const genes = [...new Set([...want.altered.keys(), ...got.altered.keys()])].sort();
    const differ = genes.filter((g) => want.altered.get(g) !== got.altered.get(g) || want.profiled(g) !== got.profiled(g));
    ok(`fixture + added samples, ${label}: every altered gene's altered/profiled (${genes.length} genes)`, differ.length === 0 && genes.length > 0,
      differ.slice(0, 3).map((g) => `${g} got ${got.altered.get(g)}/${got.profiled(g)}, want ${want.altered.get(g)}/${want.profiled(g)}`).join("; "));
  }
} finally {
  await exec(conn, "DROP DATABASE IF EXISTS " + SCRATCH);
}
console.log(failures ? `\n${failures} of ${failures + passes} enrichment event checks FAILED` : `\nall ${passes} enrichment event checks passed`);
process.exit(failures ? 1 : 0);
