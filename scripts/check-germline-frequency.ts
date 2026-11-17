/**
 * Live check: the Mutations tab's germline mutation frequency (spec-germline G1, G2), run against the
 * committed fixture study on connection b.
 *
 * Expected answers by hand from test/fixtures/peer-study/data_mutations.txt (Hugo_Symbol,
 * Tumor_Sample_Barcode, Mutation_Status), by legacy's /Germline/i:
 *   PTEN  FX-P12-T1 Germline, FX-P13-T1 germline, FX-P14-T1 GERMLINE, FX-P15-T1 Germline_LOH  -> germline 4
 *         FX-P10-T1 SOMATIC, FX-P29-T1 SOMATIC ×2, FX-P17-T1 blank                           -> somatic 3
 *   KRAS  24 samples (FX-P01..P04 T1+T2, FX-P05..P20 T1), all SOMATIC                                             -> germline 0
 * The denominator is the study's 59 samples (data_clinical_sample.txt).
 *
 * Run: node --env-file=.env.local scripts/check-germline-frequency.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import { buildLollipopGene } from "../lib/lollipop.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { CohortDef } from "../lib/types.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

const STUDY = "cbiolab_peer_fixture";
const PIN = "fixture";
const STUDY_SAMPLES = 59;

process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
const field = (o: unknown, k: string): unknown => (o as Record<string, unknown> | undefined)?.[k];

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }

const resolver = () => new PatientLevelResolver(STUDY, { oncokbPin: PIN }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const only = (sample: string): CohortDef => ({ all: [{ kind: "sampleList", ids: [STUDY + ":" + sample] }] });
const ctx: ViewRun = {
  doc: { study: STUDY, cohorts: { c: WHOLE }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver() },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: PIN, studyProfiles: async () => ({ profiles: [], gaProfiles: [] })
} as unknown as ViewRun;

const counts = async (def: CohortDef, gene: string) => {
  try {
    const rep = await resolver().lollipopCounts(def, [gene], 1);
    const t = rep.totals.find((x) => x.gene === gene);
    const g = buildLollipopGene(gene, [rep], null);
    return { totalGermline: field(t, "germlineSamples"), germline: field(g, "germlineSamples"), somatic: g.somaticSamples, of: g.cohortSamples };
  } catch (e) { return { error: "threw: " + String((e as Error).message).slice(0, 200) }; }
};

const pten = await counts(WHOLE, "PTEN");
ok("G1 PTEN totals[].germlineSamples 4 (FX-P12 Germline, FX-P13 germline, FX-P14 GERMLINE, FX-P15 Germline_LOH)",
  field(pten, "totalGermline") === 4, JSON.stringify(pten));
ok("G1 PTEN HotspotGene.germlineSamples 4 of 59", field(pten, "germline") === 4 && field(pten, "of") === STUDY_SAMPLES, JSON.stringify(pten));
ok("G1 PTEN somaticSamples unchanged: 3 (FX-P10, FX-P17 blank, FX-P29)", field(pten, "somatic") === 3, JSON.stringify(pten));

for (const [sample, status, want] of [["FX-P12-T1", "Germline", 1], ["FX-P13-T1", "germline", 1], ["FX-P14-T1", "GERMLINE", 1],
  ["FX-P15-T1", "Germline_LOH", 1], ["FX-P17-T1", "blank", 0], ["FX-P10-T1", "SOMATIC", 0]] as const) {
  const got = await counts(only(sample), "PTEN");
  ok(`G1 ${sample} (only PTEN row ${status}): germlineSamples ${want}`, field(got, "germline") === want, JSON.stringify(got));
}

const kras = await counts(WHOLE, "KRAS");
ok("G2 KRAS (every row SOMATIC): germlineSamples 0", field(kras, "germline") === 0 && field(kras, "totalGermline") === 0, JSON.stringify(kras));

try {
  const v = await runHotspots({ kind: "hotspots", genes: ["PTEN", "KRAS"], cohorts: ["c"] } as never, ctx) as { hotspots?: HotspotGene[] };
  const by = Object.fromEntries((v.hotspots || []).map((g) => [g.gene, field(g, "germlineSamples")]));
  ok("G1 G2 the hotspots view: PTEN germlineSamples 4, KRAS 0", by.PTEN === 4 && by.KRAS === 0, JSON.stringify(by));
} catch (e) { ok("G1 G2 the hotspots view: PTEN germlineSamples 4, KRAS 0", false, "threw: " + String((e as Error).message).slice(0, 200)); }

console.log(`\n${checks - failures}/${checks} germline frequency checks passed`);
process.exit(failures ? 1 : 0);
