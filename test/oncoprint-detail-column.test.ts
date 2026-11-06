// One oncoprint column's hover detail (lib/oncoprint-detail.ts): which study a (federated) column
// belongs to, and the column's alterations in the figure's genes — labelled, driver-called by the
// pinned OncoKB store — its panels, and the genes no panel of it covers. The answer names one
// patient's alterations, so it is refused for a study held only in aggregate. The warehouse is a
// stand-in (setChTransport) that records each statement.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.ONCOKB_PIN = "v-test";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "CH_RUN_CACHE", "AGGREGATE_ONLY_INSTANCES", "AGGREGATE_ONLY_STUDIES", "LOOPBACK_PEER"]) delete process.env[k];

const { setChTransport } = await import("../lib/ch.ts");
const { studyOfColumn, columnDetail } = await import("../lib/oncoprint-detail.ts");

type Row = Record<string, unknown>;
let sent: string[] = [];
const none = (_sql: string): Row[] => [];
let answer: (sql: string) => Row[] = none;
setChTransport(async ({ query, format }) => {
  sent.push(query);
  const rows = /FROM cbio\.cancer_study\n?/.test(query) && /AS id, name/.test(query)
    ? [{ id: "s1", name: "Study one" }, { id: "s2", name: "Study two" }, { id: "agg_s", name: "Aggregate study" }]
    : answer(query);
  return format === "JSONCompact"
    ? JSON.stringify({ meta: Object.keys(rows[0] ?? {}).map((name) => ({ name })), data: rows.map((r) => Object.values(r)) })
    : JSON.stringify({ meta: [], data: rows, rows: rows.length });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; answer = none; });

const events = () => sent.filter((q) => /FROM cbio\.genomic_event_derived/.test(q));
const panels = () => sent.filter((q) => /sample_to_gene_panel_derived sp/.test(q));

describe("which study a column belongs to", () => {
  test("one study: the column is its own id", () => {
    assert.deepEqual(studyOfColumn("s1_P1", ["s1"]), { study: "s1", id: "s1_P1" });
  });
  test("no study listed: the default study", () => {
    assert.deepEqual(studyOfColumn("P1", []), { study: "s1", id: "P1" });
  });
  test("federated: the study whose prefix the column carries, the rest its bare id", () => {
    assert.deepEqual(studyOfColumn("brca_P-7", ["luad", "brca"]), { study: "brca", id: "P-7" });
  });
  test("federated, no prefix matches: the first study, the column unchanged", () => {
    assert.deepEqual(studyOfColumn("P1", ["luad", "brca"]), { study: "luad", id: "P1" });
  });
});

describe("a column's detail", () => {
  const ROWS: Row[] = [
    { gene: "TP53", vt: "mutation", mt: "Missense_Mutation", mv: "R175H", cna: "" },
    { gene: "KRAS", vt: "cna", mt: "", mv: "", cna: "2" },
    { gene: "CDKN2A", vt: "cna", mt: "", mv: "", cna: "-2" },
    { gene: "MYC", vt: "cna", mt: "", mv: "", cna: "-1" },
    { gene: "ALK", vt: "structural_variant", mt: "", mv: "", cna: "" },
    { gene: "TP53", vt: "mutation", mt: "", mv: "", cna: "" },
  ];
  const GENES = ["tp53", "KRAS", "CDKN2A", "MYC", "ALK", "EGFR", "BRAF"];
  const withData = (panelRows: Row[] = [{ panel: "IMPACT468", covers: ["TP53", "KRAS", "EGFR", ""] }]) => {
    answer = (q) => /genomic_event_derived/.test(q) ? ROWS
      : /sample_to_gene_panel_derived sp/.test(q) ? panelRows
      : /variant_annotation/.test(q) ? [{ t: "MUTATION", gene: "TP53", alteration: "R175H", is_driver: 1 }, { t: "CNA", gene: "KRAS", alteration: "AMPLIFICATION", is_driver: 1 },
        { t: "CNA", gene: "CDKN2A", alteration: "DELETION", is_driver: 1 }, { t: "SV", gene: "ALK", alteration: "Fusion", is_driver: 1 }]
      : /sync_run/.test(q) ? [{ study: "s1" }] : [];
  };

  test("each alteration is labelled by its kind and driver-called by the pinned store", async () => {
    withData();
    const d = await columnDetail({ study: "s1", genes: GENES } as never, "P1");
    assert.equal(d.study, "s1");
    assert.equal(d.unit, "patient");
    assert.deepEqual(d.alterations, [
      { gene: "TP53", kind: "Missense_Mutation", alteration: "R175H", driver: true },
      { gene: "KRAS", kind: "Amplification", alteration: "2", driver: true },
      { gene: "CDKN2A", kind: "Deep Deletion", alteration: "-2", driver: true },
      { gene: "MYC", kind: "Copy number", alteration: "-1", driver: false },
      { gene: "ALK", kind: "Structural Variant", alteration: "fusion", driver: true },
      { gene: "TP53", kind: "Mutation", alteration: "", driver: false },
    ]);
    assert.match(d.annotation, /^OncoKB v-test \(pinned\)/);
  });

  test("panels list the figure's genes they cover; a gene neither covered nor altered is not profiled", async () => {
    withData();
    const d = await columnDetail({ study: "s1", genes: GENES } as never, "P1");
    assert.deepEqual(d.panels, [{ panel: "IMPACT468", covers: ["TP53", "KRAS", "EGFR"] }]);
    assert.deepEqual(d.notProfiled, ["BRAF"], "covered (EGFR) or altered (MYC, ALK…) genes are profiled");
  });

  test("a panel with no covered gene covers nothing, so every unaltered gene is not profiled", async () => {
    withData([{ panel: "P", covers: null }]);
    const d = await columnDetail({ study: "s1", genes: ["EGFR", "BRAF"] } as never, "P1");
    assert.deepEqual(d.panels, [{ panel: "P", covers: [] }]);
    assert.deepEqual(d.notProfiled, ["EGFR", "BRAF"]);
  });

  test("patient columns read the patient's events and its samples' panels; sample columns read the sample's", async () => {
    await columnDetail({ study: "s1", genes: ["TP53"], display: { annotate: "none" } } as never, "P1");
    assert.match(events()[0], /patient_unique_id = 's1_P1'/);
    assert.match(panels()[0], /JOIN cbio\.sample_derived sd/);
    assert.match(panels()[0], /sd\.patient_unique_id = 's1_P1'/);
    sent = [];
    const d = await columnDetail({ study: "s1", genes: ["TP53"], unit: "sample", display: { annotate: "none" } } as never, "S1");
    assert.equal(d.unit, "sample");
    assert.match(events()[0], /sample_unique_id = 's1_S1'/);
    assert.doesNotMatch(panels()[0], /sample_derived sd/);
    assert.match(panels()[0], /sp\.sample_unique_id = 's1_S1'/);
  });

  test("a federated column is read from its own study, by its bare id", async () => {
    const d = await columnDetail({ studies: ["s1", "s2"], genes: ["TP53"], display: { annotate: "none" } } as never, "s2_P9");
    assert.equal(d.study, "s2");
    assert.match(events()[0], /cancer_study_identifier = 's2' AND patient_unique_id = 's2_P9'/);
  });

  test("annotation turned off: no store is asked, and the detail says annotation is off", async () => {
    withData();
    const d = await columnDetail({ study: "s1", genes: ["TP53"], display: { annotate: "none" } } as never, "P1");
    assert.equal(d.alterations.every((a) => a.driver === false), true);
    assert.match(d.annotation, /^none — driver annotation turned off/);
    assert.equal(sent.some((q) => /variant_annotation/.test(q)), false);
  });

  test("genes are upper-cased, invalid symbols dropped, at most 12 asked for", async () => {
    const genes = [" egfr ", "bad gene", ...Array.from({ length: 14 }, (_, i) => "G" + i)];
    await columnDetail({ study: "s1", genes, display: { annotate: "none" } } as never, "P1");
    const asked = /hugo_gene_symbol IN \(([^)]*)\)/.exec(events()[0])![1].split(",");
    assert.equal(asked.length, 12);
    assert.equal(asked[0], "'EGFR'");
    assert.equal(asked.includes("'BAD GENE'"), false);
  });

  test("an id that is not an identifier, or no valid gene, is refused before any query", async () => {
    await assert.rejects(columnDetail({ study: "s1", genes: ["TP53"] } as never, "P1' OR 1=1"), /column id is not a valid identifier/);
    await assert.rejects(columnDetail({ study: "s1", genes: ["not a gene"] } as never, "P1"), /at least one valid gene symbol required/);
    await assert.rejects(columnDetail({ study: "s1" } as never, "P1"), /at least one valid gene symbol required/);
    assert.equal(sent.length, 0);
  });

  test("a study held only in aggregate is refused: the detail is one patient's data", async () => {
    process.env.AGGREGATE_ONLY_STUDIES = "agg_s";
    try {
      await assert.rejects(columnDetail({ study: "agg_s", genes: ["TP53"] } as never, "P1"),
        /a column's detail is one patient's data, and .* is not entitled to patient-level data \(agg_s\)/);
      assert.equal(events().length, 0, "no event was read");
    } finally { delete process.env.AGGREGATE_ONLY_STUDIES; }
  });
});
