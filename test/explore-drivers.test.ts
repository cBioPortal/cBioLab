// Explore's drivers-only counts: the gene tables and gene charts count only the calls OncoKB makes
// drivers, while every denominator (samples profiled for the gene) is read exactly as before, and
// counting every alteration sends the statements it always sent. The warehouse is a stand-in
// (setChTransport) that records each statement and answers with no rows unless told otherwise.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
for (const k of ["CLICKHOUSE2_URL", "ONCOKB_PIN", "FEDERATION_PEERS", "CH_RUN_CACHE"]) delete process.env[k];

const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { geneTables, buildExplore } = await import("../lib/explore.ts");
const { driverEventSql, annotationMatchSql } = await import("../lib/oql.ts");
const { studiesWithoutDrivers } = await import("../lib/annotation.ts");

let sent: string[] = [];
type Answer = (sql: string) => Record<string, unknown>[];
/** no rows, whatever is asked */
const none: Answer = (_sql) => [];
let answer: Answer = none;
setChTransport(async ({ query }) => {
  sent.push(query);
  const data = answer(query);
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; answer = none; });

const STUDY = "luad_tcga_pan_can_atlas_2018";
/** the statements that read events (numerators), as against the panel tables (denominators) */
const eventReads = () => sent.filter((q) => /FROM cbio_a\.genomic_event_derived/.test(q));
const panelReads = () => sent.filter((q) => /sample_to_gene_panel_derived/.test(q) && !/FROM cbio_a\.genomic_event_derived/.test(q));

describe("the OncoKB driver condition", () => {
  test("matches an event on the store's own keys, the same ones the driver join uses", () => {
    const sql = driverEventSql("v7.5", "g");
    assert.match(sql, /^\(g\.hugo_gene_symbol, multiIf\(g\.variant_type = 'mutation', 'MUTATION'/);
    assert.match(sql, /IN \(\n\s+SELECT hugo_gene_symbol, alteration_type, alteration FROM annotation\.oncokb/);
    assert.match(sql, /oncokb_version = 'v7\.5' AND is_driver\)$/);
    const join = annotationMatchSql("ann", "g");
    for (const key of ["'MUTATION'", "'CNA'", "'SV'", "'AMPLIFICATION'", "'DELETION'", "'Fusion'", "g.mutation_variant"])
      assert.ok(sql.includes(key) && join.includes(key), key);
    assert.match(driverEventSql("v7.5"), /^\(hugo_gene_symbol, multiIf\(variant_type/, "unqualified columns when no table is named");
  });
  test("a pin reaches SQL as a quoted literal only", () => {
    assert.match(driverEventSql("v1' OR 1=1 --"), /oncokb_version = 'v1\\' OR 1=1 --'/);
  });
});

describe("gene tables", () => {
  test("counting every alteration sends no driver condition", async () => {
    await geneTables({ studies: [STUDY], db: "cbio_a", conn: PRIMARY });
    assert.ok(sent.length > 0);
    assert.ok(sent.every((q) => !/annotation\.oncokb/.test(q)), "no statement reads the OncoKB store");
  });
  test("drivers only narrows every event read, and no denominator", async () => {
    answer = (q) => /AS altered/.test(q) && /variant_type = 'mutation'/.test(q)
      ? [{ g: "KRAS", altered: 168, on_panel: 168, events: 171 }]
      : /gene_panel_id = 'WES'/.test(q) ? [{ n: 566 }] : [];
    const r = await geneTables({ studies: [STUDY], db: "cbio_a", conn: PRIMARY, driverPin: "v7.5" });
    assert.equal(eventReads().length, 6, "altered and distinct-gene reads for mutations, CNA and SVs");
    for (const q of eventReads()) assert.ok(q.includes(driverEventSql("v7.5")), "event read without the driver condition:\n" + q);
    assert.ok(panelReads().length > 0);
    for (const q of panelReads()) assert.doesNotMatch(q, /annotation\.oncokb/, "a denominator must not depend on driver status");
    assert.deepEqual((r.mutatedGenes || []).map((g) => [g.gene, g.altered, g.profiled, g.freqPct]), [["KRAS", 168, 566, 29.7]]);
  });
});

describe("Explore", () => {
  test("drivers only without the OncoKB store is refused before any query", async () => {
    await assert.rejects(buildExplore({ study: STUDY, oncokbPin: null, drivers: true }), /needs the OncoKB annotation store/);
    assert.equal(sent.length, 0);
  });
  // the gene charts are kept when the gene was profiled in some sample
  const profiled = (q: string) => /FROM cbio_a\.sample_derived/.test(q) && /sample_to_gene_panel_derived/.test(q) ? [{ n: 566 }] : [];
  test("the gene charts count driver calls and say so; the answer names the pin", async () => {
    answer = profiled;
    const r = await buildExplore({ study: STUDY, oncokbPin: "v7.5", drivers: true, geneCharts: ["KRAS"] });
    assert.equal(r.drivers, "v7.5");
    const states = (r.geneFacets || []).flatMap((f) => f.states.map((s) => s.label));
    for (const label of ["Driver mutation", "No driver mutation", "Driver amplification", "Driver deletion", "No driver call", "Not profiled"])
      assert.ok(states.includes(label), label + " in " + states.join(", "));
    const chartReads = eventReads().filter((q) => /hugo_gene_symbol = 'KRAS'/.test(q));
    assert.equal(chartReads.length, 3, "mutated, CNA calls and any CNA call");
    for (const q of chartReads) assert.ok(q.includes(driverEventSql("v7.5")));
  });
  test("counting every alteration keeps the charts' own labels and no driver field", async () => {
    answer = profiled;
    const r = await buildExplore({ study: STUDY, oncokbPin: "v7.5", geneCharts: ["KRAS"] });
    assert.equal(r.drivers, undefined);
    assert.deepEqual((r.geneFacets || []).flatMap((f) => f.states.map((s) => s.label)),
      ["Mutated", "Not mutated", "Not profiled", "Amplified", "Deleted", "Diploid", "Not profiled"]);
    assert.ok(sent.every((q) => !/annotation\.oncokb/.test(q)));
  });
});

describe("which studies have OncoKB calls", () => {
  test("the studies the store has not annotated", async () => {
    answer = (q) => /sync_run/.test(q) ? [{ study: STUDY }] : [];
    assert.deepEqual(await studiesWithoutDrivers([STUDY, "prad_mskcc_2017"]), ["prad_mskcc_2017"]);
  });
});
