// Explore's light mode (lib/explore.ts ExploreArgs.attributesOnly): only what describes the
// selection, computed as the full facets compute it. Written from the rule's case table, not from
// the implementation:
//
//   E1  light = full, for the same study and draft (none, a case list, one clinical filter, three
//       clinical filters — the last read by the full explore through its single draft scan): every
//       clinical facet's attribute, per, kind, patients, samples, distinct, displayName, description,
//       priority, and a numeric one's min / max / median (except for an attribute the draft filters
//       on, whose full facet leaves out its own clauses); no naCount in the light answer (the
//       histogram pass counts it); the set of clinical facets
//       (order-insensitive: facets tying on priority and display name come back in arbitrary order
//       even from the full explore); declaredAttributes; totals; dataTypes; draftCount;
//       studyBreakdown; profiles; gaProfiles; unknownAttributes
//   E2  left out: categorical values [] and no facet disjunctive; no numeric bins; mutatedGenes,
//       cnaGenes, svGenes [] and geneTotals all 0; events []; caseLists []; geneFacets [] even with
//       geneCharts; derived [] even when derived facets are requested
//   E3  the statements sent: no value list, event, case list, gene table, histogram or draft scan
//       (nor a drafted attribute's own-clause-free coverage); the attribute metadata, attribute
//       classification, totals, data types and patient-level samples are sent
//   E4  (schema) ExploreRequest takes attributesOnly true / false / absent and refuses a non-boolean
//
// E1–E3 run the statements against the committed fixture study (test/fixtures/peer-study) on
// connection b, when CLICKHOUSE2_* point at it (`npm run peer-db` prints the lines; scripts/gate.sh
// sets them), and are skipped otherwise. Statements are told apart by what they read and compute
// (classify below), and the full explore is checked to send each kind the light one must not, so a
// classifier that matched nothing could not pass the test. The route and the results page's hook
// (E4's route half, E5) are in explore-attributes-only-route.test.ts.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseBody, ExploreRequest } from "../lib/api-schemas.ts";

const FIXTURE = "cbiolab_peer_fixture";
const noDb = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? false : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";

// ---- E4: the request schema ----------------------------------------------------------------------

describe("E4 the ExploreRequest schema", () => {
  test("E4a attributesOnly true, false and absent are accepted as given", () => {
    assert.equal(parseBody(ExploreRequest, { study: "s", attributesOnly: true }).attributesOnly, true);
    assert.equal(parseBody(ExploreRequest, { study: "s", attributesOnly: false }).attributesOnly, false);
    assert.equal(parseBody(ExploreRequest, { study: "s" }).attributesOnly, undefined);
  });
  for (const bad of ["true", 1, null, {}]) {
    test("E4b a non-boolean attributesOnly (" + JSON.stringify(bad) + ") is refused, naming the field", () => {
      assert.throws(() => parseBody(ExploreRequest, { study: "s", attributesOnly: bad }), /attributesOnly/);
    });
  }
});

// ---- statements, by what they read and compute ---------------------------------------------------

type Kind = "valueList" | "histogram" | "events" | "caseLists" | "geneTables" | "draftScan" | "draftedBase" |
  "meta" | "cls" | "totals" | "dataTypes" | "patientSamples";
/** what kinds a statement is (a statement may be none of these: the draft's resolution, say) */
function classify(sql: string): Set<Kind> {
  const k = new Set<Kind>();
  // a value list: each attribute's values folded to a key and counted (the facets' value lists, the scan's)
  if (/\bvkey\b/.test(sql)) k.add("valueList");
  // a histogram's input: each numeric attribute's raw values counted, unfolded
  else if (/attribute_value AS v\b/.test(sql) || /\bc\.val\b/.test(sql)) k.add("histogram");
  if (/\.clinical_event\b/.test(sql)) k.add("events");
  // the case-list facet: each list named and counted (a case-list draft reads sample_list too, to resolve)
  if (/\.sample_list\b/.test(sql) && /\bAS name\b/.test(sql)) k.add("caseLists");
  if (/\.(genomic_event_derived|mutation|mutation_event|cna_event|sample_cna_event|structural_variant)\b/.test(sql)) k.add("geneTables");
  // the draft's single scan: a bit per drafted attribute per sample, or a read joined to it
  if (/\bAS pm\b/.test(sql) || /\b_scan_/.test(sql)) k.add("draftScan");
  // a drafted attribute's coverage by level, counted without its own clauses
  if (/attribute_name = '/.test(sql) && /GROUP BY type\s*$/.test(sql.replace(/\nFORMAT \w+$/, ""))) k.add("draftedBase");
  if (/\.clinical_attribute_meta\b/.test(sql)) k.add("meta");
  // the classification: each attribute's share of numeric values, distinct count, range and median
  if (/\bnumratio\b/.test(sql) && /quantileExact/.test(sql)) k.add("cls");
  // the selection's size in both units
  if (/\.sample_derived\b/.test(sql) && /\bAS pts\b/.test(sql) && /\bAS smp\b/.test(sql)) k.add("totals");
  // samples with data of each molecular profile
  if (/\.sample_profile\b/.test(sql) && /\.genetic_profile\b/.test(sql)) k.add("dataTypes");
  // a patient-level attribute counted in the samples of the patients holding it
  if (/type = 'patient'/.test(sql) && /\.sample_derived\b/.test(sql) && /patient_unique_id = /.test(sql)) k.add("patientSamples");
  return k;
}
const FORBIDDEN: Kind[] = ["valueList", "histogram", "events", "caseLists", "geneTables", "draftScan", "draftedBase"];
const REQUIRED: Kind[] = ["meta", "cls", "totals", "dataTypes", "patientSamples"];

// ---- the fixture -------------------------------------------------------------------------------

type Explore = import("../lib/types.ts").ExploreResult;
type Draft = import("../lib/types.ts").CohortDef;
const DRAFTS: [string, Draft | null][] = [
  ["no draft", null],
  ["a case-list draft", { all: [{ kind: "caseList", id: "subset" }] } as unknown as Draft],
  ["a one-attribute clinical draft", { all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] } as unknown as Draft],
  ["a three-attribute clinical draft (scanned)", { all: [
    { kind: "clinical", attribute: "SEX", values: ["Female"] },
    { kind: "clinical", attribute: "SMOKING_HISTORY", values: ["Former", "Current"] },
    { kind: "clinical", attribute: "AGE", op: ">=", value: 50 },
  ] } as unknown as Draft],
];
const PROFILES = { profiles: ["mutations", "cna", "structural_variants"], gaProfiles: [] as string[] };

let explore: (draft: Draft | null, extra?: Record<string, unknown>) => Promise<{ r: Explore; sent: string[] }>;
before(async () => {
  if (noDb) return;
  const { secondary, setChTransport } = await import("../lib/ch.ts");
  const { buildExplore } = await import("../lib/explore.ts");
  const conn = secondary();
  assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
  // every statement on its way to the database, by the build that sent it (builds run one at a time)
  let sent: string[] = [];
  setChTransport(async (st, send) => { sent.push(st.query); return send(); });
  explore = async (draft, extra = {}) => {
    sent = [];
    const r = await buildExplore({ study: FIXTURE, conn, ...PROFILES, ...(draft ? { draft } : {}), ...extra } as never);
    return { r, sent };
  };
});
after(async () => { if (!noDb) (await import("../lib/ch.ts")).setChTransport(null); });

const key = (f: { per?: string; attribute: string }) => f.per + "|" + f.attribute;
/** a facet's fields that describe it, as E1 compares them */
function described(f: Explore["clinical"][number]): Record<string, unknown> {
  const o: Record<string, unknown> = { attribute: f.attribute, per: f.per, kind: f.kind, patients: f.patients, samples: f.samples,
    distinct: f.distinct, displayName: f.displayName, description: f.description, priority: f.priority };
  if (f.kind === "num") Object.assign(o, { min: f.min, max: f.max, median: f.median });
  return o;
}
/** the attributes a draft filters on: their full facets' min/max/median leave out their own clauses, the light ones' do not */
const filteredBy = (draft: Draft | null): Set<string> => new Set(JSON.stringify(draft ?? {}).match(/"attribute":"([^"]+)"/g)?.map((m) => m.slice(13, -1)) ?? []);
const sortedBy = <T>(xs: T[] | undefined, k: (x: T) => string) => (xs || []).slice().sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));

for (const [name, draft] of DRAFTS) {
  describe("light vs full explore of the fixture, " + name, () => {
    let full: { r: Explore; sent: string[] }, light: { r: Explore; sent: string[] };
    before(async () => {
      if (noDb) return;
      // light first, so nothing the full build does can have warmed what the light one sends
      light = await explore(draft, { attributesOnly: true, geneCharts: ["KRAS"], derived: [{ metric: "followupMonths" }, { metric: "alteredGenes" }] });
      full = await explore(draft, { geneCharts: ["KRAS"], derived: [{ metric: "followupMonths" }, { metric: "alteredGenes" }] });
      assert.ok(full.r.clinical.length > 5, "the fixture has facets to compare: " + full.r.clinical.length);
    });

    test("E1a the same clinical facets, each described the same", { skip: noDb }, () => {
      assert.deepEqual(light.r.clinical.map(key).sort(), full.r.clinical.map(key).sort(), "the set of facets");
      const fullBy = new Map(full.r.clinical.map((f) => [key(f), f]));
      // every field that differs, on every facet, so one run names them all
      const differ: string[] = [];
      const own = filteredBy(draft);
      for (const f of light.r.clinical) {
        const l = described(f), u = described(fullBy.get(key(f))!);
        if (f.kind === "num" && own.has(f.attribute)) for (const k of ["min", "max", "median"]) { delete l[k]; delete u[k]; }
        for (const k of new Set([...Object.keys(l), ...Object.keys(u)]))
          if (!Object.is(l[k], u[k])) differ.push(key(f) + "." + k + ": light " + JSON.stringify(l[k]) + ", full " + JSON.stringify(u[k]));
      }
      assert.deepEqual(differ, [], "fields that differ from the full explore");
      // the histogram pass counts naCount; the light answer, which has none, leaves it out rather than give another number
      assert.deepEqual(light.r.clinical.filter((f) => f.kind === "num" && f.naCount !== undefined).map(key), [], "no naCount in the light answer");
      assert.ok(light.r.clinical.some((f) => f.kind === "num") && light.r.clinical.some((f) => f.kind === "cat"), "both kinds compared");
    });
    test("E1b the same declaredAttributes, totals, dataTypes, draftCount, studyBreakdown, profiles, gaProfiles, unknownAttributes", { skip: noDb }, () => {
      assert.deepEqual(sortedBy(light.r.declaredAttributes, key), sortedBy(full.r.declaredAttributes, key), "declaredAttributes");
      assert.ok((full.r.declaredAttributes || []).length > 0, "the fixture declares attributes");
      assert.deepEqual(light.r.totals, full.r.totals, "totals");
      assert.deepEqual(sortedBy(light.r.dataTypes, (d) => d.profile), sortedBy(full.r.dataTypes, (d) => d.profile), "dataTypes");
      assert.ok((full.r.dataTypes || []).length > 0, "the fixture has data types");
      assert.equal(light.r.draftCount, full.r.draftCount, "draftCount");
      assert.deepEqual(light.r.studyBreakdown, full.r.studyBreakdown, "studyBreakdown");
      assert.deepEqual(light.r.profiles, full.r.profiles, "profiles");
      assert.deepEqual(light.r.gaProfiles, full.r.gaProfiles, "gaProfiles");
      assert.deepEqual(light.r.unknownAttributes, full.r.unknownAttributes, "unknownAttributes");
      if (draft) assert.ok(full.r.draftCount != null && full.r.draftCount < (full.r.studyBreakdown?.[0]?.n ?? -1) + 1, "the draft is resolved");
    });

    test("E2a categorical facets carry no values and none is disjunctive; numeric ones no bins", { skip: noDb }, () => {
      assert.ok(full.r.clinical.some((f) => f.kind === "cat" && f.values.length), "the full explore has value lists");
      assert.ok(full.r.clinical.some((f) => f.kind === "num" && f.bins?.length), "the full explore has bins");
      for (const f of light.r.clinical) {
        if (f.kind === "cat") {
          assert.deepEqual(f.values, [], key(f) + " values");
          assert.ok(!f.disjunctive, key(f) + " disjunctive");
        } else assert.ok(!f.bins || f.bins.length === 0, key(f) + " bins");
      }
    });
    test("E2b no gene tables, events, case lists, gene charts or derived facets, though asked for", { skip: noDb }, () => {
      assert.ok(full.r.mutatedGenes?.length && full.r.events.length && full.r.caseLists.length && full.r.geneFacets?.length && full.r.derived?.length,
        "the full explore has each of them");
      assert.deepEqual(light.r.mutatedGenes, []);
      assert.deepEqual(light.r.cnaGenes, []);
      assert.deepEqual(light.r.svGenes, []);
      assert.deepEqual(light.r.geneTotals, { mutated: 0, cna: 0, sv: 0 });
      assert.deepEqual(light.r.events, []);
      assert.deepEqual(light.r.caseLists, []);
      assert.deepEqual(light.r.geneFacets, []);
      assert.deepEqual(light.r.derived, []);
    });

    test("E3 sends the attribute, classification, totals, data-type and patient-sample statements and none of the rest", { skip: noDb }, () => {
      const kinds = (sent: string[]) => sent.map((q) => ({ q, k: classify(q) }));
      const lightK = kinds(light.sent), fullK = kinds(full.sent);
      // the full explore sends every kind the light one must not, so the classifier is seen to match
      const expectFull: Kind[] = ["valueList", "histogram", "events", "caseLists", "geneTables"];
      if (name.includes("scanned")) expectFull.push("draftScan");
      if (name.includes("one-attribute")) expectFull.push("draftedBase");
      for (const k of expectFull) assert.ok(fullK.some((x) => x.k.has(k)), "the full explore sends a " + k + " statement");
      for (const k of FORBIDDEN) {
        const hit = lightK.find((x) => x.k.has(k));
        assert.equal(hit, undefined, "light mode sent a " + k + " statement:\n" + hit?.q.slice(0, 400));
      }
      for (const k of REQUIRED) {
        assert.ok(lightK.some((x) => x.k.has(k)), "light mode sends the " + k + " statement");
        assert.ok(fullK.some((x) => x.k.has(k)), "the full explore sends the " + k + " statement");
      }
    });
  });
}
