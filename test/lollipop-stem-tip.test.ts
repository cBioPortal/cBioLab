// The lollipop stem's tooltip as the portal's (MUT-LP-10, MUT-STM-3), written from the spec table
// (rows T1–T7) before the code. Legacy (cbioportal-frontend @ cd8c6df): react-mutation-mapper
// LollipopMutationPlot.tsx `lollipopTooltip` (bold count info, a line break, "AA Change: " +
// lollipopLabelText(mutationsAtPosition) with no size), LollipopTooltipCountInfo.tsx ("{count} mutated
// of {patientCount} profiled patients"), and Mutations.tsx `plotLollipopTooltipCountInfo`
// (patientCount = filteredPatients.length). New exports and fields are read off the modules at run
// time, so this file loads before they exist and each row fails on its own.
//
// T1 runs against the committed fixture study (test/fixtures/peer-study) on connection b when
// CLICKHOUSE2_* point at it (`npm run peer-db` prints the lines; scripts/gate.sh sets them), and is
// skipped otherwise. Its expected numbers are counted by hand from data_clinical_sample.txt: 59 sample
// rows, whose PATIENT_ID column holds 53 distinct ids (FX-P01–FX-P04, FX-P43 and FX-P49 have two
// samples each: 59 − 6 = 53), the same 53 as data_clinical_patient.txt.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./support/tsx-loader.mjs", import.meta.url);
const lib = await import("../lib/lollipop.ts") as Record<string, unknown>;
const { buildLollipopGene } = await import("../lib/lollipop.ts");
const { lollipopPanelsSvg } = await import("../lib/lollipop-svg.ts");
type HotspotGene = import("../lib/views/hotspots/types.ts").HotspotGene;

const FIXTURE = "cbiolab_peer_fixture";
const FIXTURE_PATIENTS = 53, FIXTURE_SAMPLES = 59;

const stemTip = (position: unknown, cohortPatients?: number): string => {
  assert.equal(typeof lib.lollipopStemTip, "function", "lib/lollipop.ts exports lollipopStemTip");
  return (lib.lollipopStemTip as (p: unknown, c?: number) => string)(position, cohortPatients);
};
const change = (c: string, rows: number, n = rows) => ({ change: c, n, rows, driver: true, impact: "missense" });
/** a codon's stem as buildLollipopGene makes one */
const position = (n: number, changes: ReturnType<typeof change>[], pos = 12) =>
  ({ pos, n, color: "#008000", impact: "missense", driver: true, changes, types: [{ mtype: "Missense_Mutation", driver: true, rows: changes.reduce((s, c) => s + c.rows, 0) }] });

const report = (gene: string, cohortPatients: number | undefined, changes: ReturnType<typeof change>[] = [change("G12D", 1)]) => ({
  changes: changes.map((c) => ({ gene, pos: 12, ...c })),
  types: [{ gene, pos: 12, mtype: "Missense_Mutation", driver: true, rows: changes.reduce((s, c) => s + c.rows, 0) }],
  totals: [{ gene, patients: changes.reduce((s, c) => s + c.n, 0), pairs: changes.reduce((s, c) => s + c.rows, 0), somaticSamples: 1 }],
  cohortSamples: 500, minCount: 1, annotated: true, ...(cohortPatients === undefined ? {} : { cohortPatients })
});
const PROTEIN = { proteinLength: 189, transcriptId: "T", domains: [] };

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const T3 = "7 mutated of 594 profiled patients\nAA Change: G12D/V/C";

const dbReason = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? null : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";

test("T1 lollipopCounts on the fixture study reports its distinct patients beside its samples", { skip: dbReason ?? false }, async () => {
  const { secondary } = await import("../lib/ch.ts");
  const { PatientLevelResolver } = await import("../lib/federation.ts");
  const conn = secondary();
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
  const r = new PatientLevelResolver(FIXTURE, { oncokbPin: null }, { id: "b", mode: "patient-level", label: conn.label, conn });
  const rep = await r.lollipopCounts(null, ["KRAS"]) as { cohortSamples: number; cohortPatients?: number };
  assert.equal(rep.cohortSamples, FIXTURE_SAMPLES, "cohortSamples unchanged: the fixture's 59 samples");
  assert.equal(rep.cohortPatients, FIXTURE_PATIENTS, "cohortPatients: the fixture's 53 distinct patients");
  assert.ok(rep.cohortPatients! <= rep.cohortSamples);
});

test("T2 buildLollipopGene sums the reports' cohortPatients, and leaves it unset when a report lacks it", () => {
  const both = buildLollipopGene("KRAS", [report("KRAS", 10), report("KRAS", 32)] as never, PROTEIN) as HotspotGene & { cohortPatients?: number };
  assert.equal(both.cohortPatients, 42, "10 + 32");
  assert.equal(both.cohortSamples, 1000, "cohortSamples still summed");
  const partial = buildLollipopGene("KRAS", [report("KRAS", 10), report("KRAS", undefined)] as never, PROTEIN) as HotspotGene & { cohortPatients?: number };
  assert.equal(partial.cohortPatients, undefined, "one report (an older site) has no cohortPatients");
  assert.ok(!("cohortPatients" in partial) || partial.cohortPatients === undefined);
});

test("T3 the count line, then every protein change at the codon", () => {
  assert.equal(stemTip(position(7, [change("G12D", 5), change("G12V", 2), change("G12C", 1)]), 594), T3);
});

test("T4 the AA Change line lists all the changes, never 'and N more'", () => {
  const tip = stemTip(position(20, [change("G12D", 9), change("G12V", 5), change("G12C", 3), change("G12A", 2), change("G12S", 1)]), 594);
  assert.equal(tip, "20 mutated of 594 profiled patients\nAA Change: G12D/V/C/A/S");
  assert.doesNotMatch(tip, /more/);
});

test("T5 with no patient count: 'N mutation(s)', singular for one", () => {
  assert.equal(stemTip(position(1, [change("G12D", 1)]), undefined), "1 mutation\nAA Change: G12D");
  assert.equal(stemTip(position(3, [change("G12D", 2), change("G12V", 1)]), undefined), "3 mutations\nAA Change: G12D/V");
});

test("T6 plain numbers, no thousands separator, as the portal renders them", () => {
  const tip = stemTip(position(1205, [change("G12D", 1205)]), 10945);
  assert.equal(tip.split("\n")[0], "1205 mutated of 10945 profiled patients");
});

test("T7 the figure's stem <title> is the tooltip text, newline kept", () => {
  const g = buildLollipopGene("KRAS", [report("KRAS", 594, [change("G12D", 5, 5), change("G12V", 2, 1), change("G12C", 1, 1)])] as never, PROTEIN);
  const gene = { ...g, cohortPatients: 594 } as HotspotGene;
  assert.equal(gene.positions.find((p) => p.pos === 12)?.n, 7, "the stem is T3's: 7 patients");
  const svg = lollipopPanelsSvg([gene], { width: 720 }, "", undefined);
  const m = svg.match(/data-codon="12"[^>]*><title>([\s\S]*?)<\/title>/);
  assert.ok(m, "a <title> on codon 12's stem");
  assert.equal(decode(m[1]), T3);
});
