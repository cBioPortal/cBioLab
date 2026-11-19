// The Mutations tab's germline mutation frequency (spec-germline G1, G2, G9a, with #329's review): a
// site's germline samples arrive in LollipopReport.totals[].germlineSamples and its denominator in
// LollipopReport.germlineCohortSamples (the cohort's samples on `<study>_germline` when the study has
// that list, else every cohort sample); buildLollipopGene sums both over sites, and leaves both
// absent when a site sends either one not at all (older code). GeneSummary
// (app/_lollipop/HotspotsBody.tsx) shows "Germline Mutation Frequency" only when germlineSamples > 0.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/ch.ts reads these at import; ClickHouse is a stand-in (setChTransport) and nothing leaves the machine
process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "fed_a";
process.env.CLICKHOUSE_USER = "u";
process.env.CLICKHOUSE_PASSWORD = "p";
process.env.STUDY_ID = "s1";
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "LOOPBACK_PEER", "CH_RUN_CACHE"]) delete process.env[k];

register("./support/tsx-loader.mjs", import.meta.url);
const { setChTransport, PRIMARY } = await import("../lib/ch.ts");
const { PatientLevelResolver } = await import("../lib/federation.ts");
const { buildLollipopGene } = await import("../lib/lollipop.ts");
const { runHotspots } = await import("../lib/views/hotspots/run.ts");
const { Untimed } = await import("../lib/views/run.ts");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { HotspotsBody } = await import("../app/_lollipop/HotspotsBody.tsx");
type HotspotGene = import("../lib/views/hotspots/types.ts").HotspotGene;
type ViewRun = import("../lib/views/run.ts").ViewRun;

/** a field the change adds, read without the type knowing it yet */
const field = (o: unknown, k: string): unknown => (o as Record<string, unknown> | undefined)?.[k];

const report = (somaticSamples: number, germlineSamples: number | undefined, cohortSamples: number, germlineCohortSamples: number | undefined) => ({
  changes: [{ gene: "PTEN", pos: 92, change: "D92N", n: 3, rows: 3, driver: true, impact: "missense" }],
  types: [{ gene: "PTEN", pos: 92, mtype: "Missense_Mutation", driver: true, rows: 3 }],
  totals: [{ gene: "PTEN", patients: 3, pairs: 3, somaticSamples, ...(germlineSamples === undefined ? {} : { germlineSamples }) }],
  cohortSamples, ...(germlineCohortSamples === undefined ? {} : { germlineCohortSamples }), minCount: 1, annotated: true,
});
const PROTEIN = { proteinLength: 403, transcriptId: "ENST00000371953", domains: [], ids: { refseq: "NM_000314", ensembl: "ENST00000371953.3" } };
const build = (...reports: ReturnType<typeof report>[]) => buildLollipopGene("PTEN", reports as never, PROTEIN);

test("G1 buildLollipopGene sums germlineSamples and germlineCohortSamples over sites, like somaticSamples", () => {
  const g = build(report(1, 2, 30, 10), report(2, 3, 29, 29));
  assert.equal(field(g, "germlineSamples"), 5);
  assert.equal(field(g, "germlineCohortSamples"), 39);
  assert.equal(g.somaticSamples, 3, "somaticSamples unchanged");
  assert.equal(g.cohortSamples, 59);
});

test("G2 a gene with no germline row: germlineSamples 0, its denominator still counted", () => {
  const g = build(report(3, 0, 59, 59));
  assert.equal(field(g, "germlineSamples"), 0);
  assert.equal(field(g, "germlineCohortSamples"), 59);
});

test("G2 a site on older code: germlineSamples and germlineCohortSamples absent (unknown), not 0", async (t) => {
  const absent = (g: HotspotGene, why: string) => {
    assert.ok(!("germlineSamples" in g) || g.germlineSamples === undefined, why + ": germlineSamples " + JSON.stringify(field(g, "germlineSamples")));
    assert.ok(!("germlineCohortSamples" in g) || field(g, "germlineCohortSamples") === undefined, why + ": germlineCohortSamples " + JSON.stringify(field(g, "germlineCohortSamples")));
  };
  await t.test("the report has no germlineCohortSamples", () => absent(build(report(3, 2, 59, undefined)), "no germlineCohortSamples"));
  await t.test("the gene's total has no germlineSamples", () => absent(build(report(3, undefined, 59, 59)), "no germlineSamples"));
  await t.test("neither", () => absent(build(report(3, undefined, 59, undefined)), "neither"));
  await t.test("one current site beside one older site", () => absent(build(report(1, 2, 30, 30), report(2, undefined, 29, undefined)), "mixed sites"));
  await t.test("no germline line is drawn for it", () => assert.doesNotMatch(card(build(report(3, 2, 59, undefined))), /Germline Mutation Frequency/));
});

// ---- the denominator from the database, on a stand-in ClickHouse ----------------------------
/** what the stand-in answers to the germline-list statement (the one selecting `lists`) */
let germlineList: { lists: number; n: number } = { lists: 0, n: 0 };
setChTransport(async ({ query }) => {
  const data = /\bAS lists\b/.test(query) ? [germlineList]
    : /SELECT uniqExact\(sid\) AS n FROM cohort/.test(query) ? [{ n: 7 }]
    : /AS patients, uniqExact\(sid\) AS samples\b/.test(query) ? [{ patients: 6, samples: 7 }]
    : /\bAS somatic_samples\b/.test(query) ? [{ gene: "KRAS", patients: 2, pairs: 2, somatic_samples: 2, germline_samples: 1 }]
    : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
const reportFor = async (list: { lists: number; n: number }) => {
  germlineList = list;
  const r = new PatientLevelResolver("s1", { oncokbPin: null }, { id: PRIMARY.id, mode: "patient-level", label: "stand-in", conn: PRIMARY });
  return r.lollipopCounts({ all: [] }, ["KRAS"], 1);
};

test("G1 the study has no `<study>_germline` list (lists 0): germlineCohortSamples = cohortSamples", async () => {
  const rep = await reportFor({ lists: 0, n: 0 });
  assert.equal(rep.cohortSamples, 7);
  assert.equal(field(rep, "germlineCohortSamples"), 7);
  assert.equal(field(rep.totals.find((x) => x.gene === "KRAS"), "germlineSamples"), 1);
});

test("G1 the study has the list: germlineCohortSamples = the cohort's samples on it", async () => {
  const rep = await reportFor({ lists: 1, n: 3 });
  assert.equal(rep.cohortSamples, 7);
  assert.equal(field(rep, "germlineCohortSamples"), 3);
});

test("G2 the hotspots view's note names a site that reports no germline counts (older code)", async () => {
  const older = {
    instance: { id: "c1", mode: "patient-level", label: "Local c1", conn: { id: "c1", db: "c1" } },
    cohortSql: () => "SELECT 1",
    lollipopCounts: async () => ({ changes: [], types: [], totals: [{ gene: "KRAS", patients: 0, pairs: 0, somaticSamples: 0 }], cohortSamples: 10, minCount: 1, annotated: true }),
  };
  const ctx = {
    doc: { study: "old_site_study", cohorts: { Q: { study: "old_site_study" } }, views: [] },
    cohorts: { Q: { studies: ["old_site_study"], perStudy: { old_site_study: { sql: "", count: 10, samples: 10, mode: "" } }, count: 10, samples: 10, text: "" } },
    resolvers: { old_site_study: older }, vNames: ["Q"], vStudies: ["old_site_study"],
    participationFor: (_s: string[], requiresPatientLevel: boolean) => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: "v7", studyProfiles: async () => ({ profiles: ["mutations"], gaProfiles: [] }),
  } as unknown as ViewRun;
  const res = await runHotspots({ kind: "hotspots", genes: ["KRAS"], cohorts: ["Q"] } as never, ctx);
  const note = String(field(res instanceof Untimed ? res.result : res, "note") ?? "");
  assert.match(note, /old_site_study[^.]*reports no germline counts \(older code\)/, note.slice(-400));
});

// ---- G9a: GeneSummary ---------------------------------------------------------------------------
function card(g: HotspotGene) {
  return renderToStaticMarkup(createElement(HotspotsBody, {
    v: { kind: "hotspots", note: "the method caption", hotspots: [g] } as never, onHide: () => {}, onCodons: () => {} }));
}
const withGermline = (n: number, of: number): HotspotGene => ({ ...build(report(3, n, 59, of)), germlineSamples: n, germlineCohortSamples: of } as HotspotGene);

test("G9a GeneSummary shows the germline frequency over germlineCohortSamples when germlineSamples > 0", async (t) => {
  await t.test("no list: over every cohort sample, formatted as the somatic one", () => {
    const html = card(withGermline(4, 59));
    assert.match(html, /Somatic Mutation Frequency<\/span> <b>5\.1%<\/b>/, "the somatic line, for its format");
    assert.match(html, /Germline Mutation Frequency<\/span> <b>6\.8%<\/b>/);
    assert.match(html, /data-tip="4 of 59 samples carry a germline mutation in PTEN"/);
  });
  await t.test("a germline list of 5 holding 3 of the germline samples: 3 of 5", () => {
    const html = card(withGermline(3, 5));
    assert.match(html, /Germline Mutation Frequency<\/span> <b>60\.0%<\/b>/);
    assert.match(html, /data-tip="3 of 5 samples carry a germline mutation in PTEN"/);
    assert.match(html, /Somatic Mutation Frequency<\/span> <b>5\.1%<\/b>/, "the somatic rate keeps every cohort sample");
  });
});

test("G9a GeneSummary shows no germline line when germlineSamples is 0", () => {
  const html = card(withGermline(0, 59));
  assert.match(html, /Somatic Mutation Frequency/);
  assert.doesNotMatch(html, /Germline Mutation Frequency/);
  assert.doesNotMatch(html, /germline mutation in/);
});
