/**
 * Live check: two of the Results → Mutations tab's states (PR J), run against the committed fixture
 * study on connection b.
 *
 *   E  a queried gene with no mutations and no fusions in the cohort (BRCA1: no mutation, SV or panel
 *      row in test/fixtures/peer-study). Legacy keeps its tab and draws its plot empty
 *      (ResultsViewPageStore.ts 3479-3496, 3630-3660; MutationMapper.tsx 422-460, 584-615); PR J keeps
 *      it in runHotspots's `hotspots` (lib/views/hotspots/run.ts), in query order, all zeros (EX1),
 *      draws "No BRCA1 mutations in this cohort" in its plot (EX2), and says so in the caption (EX8).
 *      The mutation table is unchanged (EX7). The fixture study is hg19, so no GRCh38 flag (L4-L6).
 *   G  germline vs somatic in the somatic mutation frequency (lib/federation.ts lollipopTotalsSql's
 *      somatic_samples, run through lollipopCounts): legacy's GERMLINE_REGEXP `/Germline/i`, an
 *      unanchored case-insensitive substring (constants.ts 5; MutationUtils.tsx 232, 285-311), so
 *      Germline, germline, GERMLINE and Germline_LOH are germline (G2, G3) and anything else, a blank
 *      status included, is somatic (G4, G5). PTEN's p.D92N rows on FX-P12/P13/P14/P15/P17 are each
 *      that sample's only PTEN row, with status Germline, germline, GERMLINE, Germline_LOH and blank
 *      (stored `NA` by the importer); FX-P10's R130Q is SOMATIC and FX-P29 has two SOMATIC rows
 *      (data_mutations.txt).
 *
 * Each expected answer is written down by hand from test/fixtures/peer-study (data_clinical_sample.txt,
 * data_mutations.txt) by the portal's rule (cbioportal-frontend e9d70fb) and PR J's decisions.
 *
 * Run: node --env-file=.env.local scripts/check-mutation-tab-states.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { buildLollipopGene } from "../lib/lollipop.ts";
import { lollipopPanelsSvg, lollipopSummaryText } from "../lib/lollipop-svg.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { CohortDef } from "../lib/types.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

const STUDY = "cbiolab_peer_fixture";
const PIN = "fixture";
/** every sample of the fixture study (data_clinical_sample.txt): the somatic frequency's denominator */
const STUDY_SAMPLES = 59;

// the protein (length, domains) is asked of an address that refuses at once, so nothing leaves the machine
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }

const resolver = () => new PatientLevelResolver(STUDY, { oncokbPin: PIN }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const only = (sample: string): CohortDef => ({ all: [{ kind: "sampleList", ids: [STUDY + ":" + sample] }] });
const ctxFor = (def: CohortDef): ViewRun => ({
  doc: { study: STUDY, cohorts: { c: def }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver() },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: PIN, studyProfiles: async () => ({ profiles: [], gaProfiles: [] })
} as unknown as ViewRun);

type Hot = { hotspots?: HotspotGene[]; note?: string; error?: string; grch38?: boolean };
const hot = async (genes: string[], def: CohortDef = WHOLE): Promise<Hot> => {
  try { return await runHotspots({ kind: "hotspots", genes, cohorts: ["c"] } as never, ctxFor(def)) as Hot; }
  catch (e) { return { error: "threw: " + String((e as Error).message).slice(0, 200) }; }
};
const names = (h: Hot) => (h.hotspots || []).map((g) => g.gene);
const shape = (g: HotspotGene | undefined) => g && ({ mutated: g.mutated, mutations: g.mutations, positions: g.positions.length, somaticSamples: g.somaticSamples,
  cohortSamples: g.cohortSamples, unpositioned: g.unpositioned, withheld: g.withheld, tally: g.tally });
const ZERO = { driver: 0, vus: 0 };
const EMPTY = { mutated: 0, mutations: 0, positions: 0, somaticSamples: 0, cohortSamples: STUDY_SAMPLES, unpositioned: 0, withheld: 0,
  tally: { missense: ZERO, truncating: ZERO, inframe: ZERO, splice: ZERO, fusion: ZERO, other: ZERO } };
const isEmpty = (g: HotspotGene | undefined) => JSON.stringify(shape(g)) === JSON.stringify(EMPTY);
/** a sentence of the caption that names the gene and says it has no mutations */
const saysNone = (text: string, gene: string) => text.split(/(?<=\.)\s/).some((s) => s.includes(gene) && /\bno\b[^.]*\bmutations?\b/i.test(s));

// ---- E: the empty gene in the lollipop --------------------------------------------------------

const both = await hot(["KRAS", "BRCA1"]);
ok("EX1 E1 [KRAS, BRCA1]: both genes in `hotspots`, in query order", JSON.stringify(names(both)) === '["KRAS","BRCA1"]', both.error || JSON.stringify(names(both)));
const brca = (both.hotspots || []).find((g) => g.gene === "BRCA1");
ok("EX1 E6 E8 BRCA1 beside KRAS: mutated 0, mutations 0, no position, somaticSamples 0 of 59, unpositioned 0, withheld 0, every tally 0/0",
  isEmpty(brca), JSON.stringify(shape(brca)) || "not listed");
const reversed = await hot(["BRCA1", "KRAS"]);
ok("EX1 E4 [BRCA1, KRAS]: query order kept, the empty gene first", JSON.stringify(names(reversed)) === '["BRCA1","KRAS"]', reversed.error || JSON.stringify(names(reversed)));

const kras = await hot(["KRAS"]);
const krasAlone = (kras.hotspots || []).find((g) => g.gene === "KRAS"), krasBeside = (both.hotspots || []).find((g) => g.gene === "KRAS");
ok("EX1 KRAS's own numbers are the same with and without the empty gene beside it", !!krasAlone && krasAlone.mutated > 0 &&
  JSON.stringify(shape(krasAlone)) === JSON.stringify(shape(krasBeside)), JSON.stringify([shape(krasAlone), shape(krasBeside)]).slice(0, 300));

const alone = await hot(["BRCA1"]);
ok("EX1 EX5 [BRCA1] alone: one gene, all zeros, not the bare-note fallback (an empty `hotspots`)",
  JSON.stringify(names(alone)) === '["BRCA1"]' && isEmpty(alone.hotspots![0]), alone.error || JSON.stringify(alone.hotspots?.map(shape)));
ok("EX1 [BRCA1] alone: no error; the method caption is still set", !alone.error && !!alone.note, alone.error || "");

const fusionOnly = await hot(["ERG", "BRCA1"]);
ok("EX1 E3 [ERG, BRCA1]: the fusion-only gene and the empty gene both kept", JSON.stringify(names(fusionOnly)) === '["ERG","BRCA1"]',
  fusionOnly.error || JSON.stringify(names(fusionOnly)));

ok("EX8 the caption says BRCA1 has no mutations rather than leaving it out", saysNone(both.note || "", "BRCA1"), (both.note || "").slice(0, 400));
ok("EX8 [BRCA1] alone: the caption says so too", saysNone(alone.note || "", "BRCA1"), (alone.note || "").slice(0, 400));
ok("EX8 [KRAS] alone: the caption says no gene lacks mutations", !saysNone(kras.note || "", "KRAS"), (kras.note || "").slice(0, 400));
const words = lollipopSummaryText(both.hotspots || [], []);
ok("EX8 the figure's words (lollipopSummaryText) say BRCA1 has no mutations", saysNone(words, "BRCA1"), words.slice(0, 300));
const svg = lollipopPanelsSvg(both.hotspots || [], { width: 720 }, "");
ok("EX2 E5 the figure draws BRCA1's plot with the one line `No BRCA1 mutations in this cohort`, once, and no BRCA1 stem",
  (svg.match(/No BRCA1 mutations in this cohort/g) || []).length === 1 && /# BRCA1 Mutations/.test(svg) && !/data-gene="BRCA1"/.test(svg),
  "message ×" + (svg.match(/No BRCA1 mutations in this cohort/g) || []).length);
ok("EX2 KRAS, which has mutations, gets no such line", !/No KRAS mutations/.test(svg));

ok("L4 L6 the fixture study is hg19: the result carries no GRCh38 flag", both.grch38 !== true && alone.grch38 !== true, JSON.stringify([both.grch38, alone.grch38]));

// EX7: the table is unchanged — an empty gene's table is empty
try {
  const t = await runMutations({ kind: "mutations", gene: "BRCA1", cohorts: ["c"], rows: 25 }, ctxFor(WHOLE)) as { mutations?: { rows: unknown[]; total: number }; error?: string };
  ok("EX7 E10 the BRCA1 table: no rows, total 0", !!t.mutations && t.mutations.rows.length === 0 && t.mutations.total === 0,
    t.error || JSON.stringify(t.mutations ? { rows: t.mutations.rows.length, total: t.mutations.total } : t).slice(0, 200));
} catch (e) { ok("EX7 the BRCA1 table runs", false, String((e as Error).message).slice(0, 200)); }

// ---- G: germline vs somatic in the somatic mutation frequency ---------------------------------

const somatic = async (def: CohortDef, gene: string) => {
  try {
    const rep = await resolver().lollipopCounts(def, [gene], 1);
    const g = buildLollipopGene(gene, [rep], null);
    return { somatic: g.somaticSamples, mutated: g.mutated, of: rep.cohortSamples };
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};

/** [sample, its only PTEN row's status as written in the MAF, somatic samples expected, spec rows] */
const PTEN_ROWS: [string, string, number, string][] = [
  ["FX-P12-T1", "Germline", 0, "G2 mixed case is germline (N3: 592 warehouse rows in 13 studies)"],
  ["FX-P13-T1", "germline", 0, "G2 lower case is germline (N3: all_stjude_2013)"],
  ["FX-P14-T1", "GERMLINE", 0, "G2 upper case is germline"],
  ["FX-P15-T1", "Germline_LOH", 0, "G3 a value containing Germline is germline (unanchored substring)"],
  ["FX-P17-T1", "(blank, stored NA)", 1, "G4 G5 a blank status is not germline: somatic"],
  ["FX-P10-T1", "SOMATIC", 1, "G4 the control: a SOMATIC row"],
];
for (const [sample, status, want, why] of PTEN_ROWS) {
  const got = await somatic(only(sample), "PTEN");
  ok(`G6 ${sample} (only PTEN row ${status}): PTEN somatic samples ${want} of 1 — ${why}`,
    typeof got !== "string" && got.somatic === want && got.mutated === 1 && got.of === 1, JSON.stringify(got));
}
const whole = await somatic(WHOLE, "PTEN");
ok("G6 whole study: PTEN somatic samples 3 of 59 (FX-P10, FX-P17, FX-P29), patients with a PTEN row 7",
  typeof whole !== "string" && whole.somatic === 3 && whole.mutated === 7 && whole.of === STUDY_SAMPLES, JSON.stringify(whole));
const ptenView = await hot(["PTEN"]);
const pten = (ptenView.hotspots || [])[0];
ok("G6 the view's PTEN somatic frequency: 3 of 59", !!pten && pten.somaticSamples === 3 && pten.cohortSamples === STUDY_SAMPLES,
  ptenView.error || JSON.stringify(pten && { somatic: pten.somaticSamples, of: pten.cohortSamples }));
// G8: FX-P44's EGFR rows are SOMATIC, NA, Germline, GERMLINE and germline — somatic by its SOMATIC and NA rows
const p44 = await somatic(only("FX-P44-T1"), "EGFR");
ok("G8 FX-P44 (EGFR rows SOMATIC, NA and germline in three spellings): EGFR somatic samples 1", typeof p44 !== "string" && p44.somatic === 1, JSON.stringify(p44));

console.log(`\n${checks - failures}/${checks} mutation tab state checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
