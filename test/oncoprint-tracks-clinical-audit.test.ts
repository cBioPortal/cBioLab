// Audit of PR #196 (Tracks › Clinical), written from the parity case table and the legacy source
// (cbioportal-frontend @ cd8c6df), not from the implementation. One test per table row; a row our
// product cannot express is skipped with the reason. Where PR #196 documents a divergence on
// purpose, the test asserts OUR documented behaviour and says so in its name.
//
// Three layers:
//   - the pure rules (app/_oncoprint/track-edits.ts clinicalTrackRows / trackFreqText, lib/explore.ts
//     mergeExplore, lib/oncoprint.ts normalizeSpec): run everywhere, plain `node --test` included;
//   - the Tracks menu as rendered (TracksMenu, server-rendered with its popover forced open): needs
//     a .tsx loader and module mocks, so it runs under
//       node --experimental-test-module-mocks --import tsx --test test/oncoprint-tracks-clinical-audit.test.ts
//     (or `npx tsx --experimental-test-module-mocks --test …`) and is skipped, saying so, under `npm test`;
//   - the Freq counts as SQL computes them (Explore's facets, which the Results page reads for the
//     menu), run against the committed fixture study test/fixtures/peer-study on connection b, as
//     check:values does. These run when CLICKHOUSE2_* point at it (`npm run peer-db` prints the lines;
//     scripts/gate.sh sets them) and are skipped otherwise. Expected numbers are counted by hand from
//     the fixture's data_clinical_*.txt files.
import test, { describe, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clinicalTrackRows, trackAttrs, trackFreqText, type TrackAttr } from "../app/_oncoprint/track-edits.ts";

const FIXTURE = "cbiolab_peer_fixture";

// ---- helpers -----------------------------------------------------------------------------------

const attr = (attribute: string, n: number, per: "sample" | "patient", displayName?: string, priority?: number): TrackAttr =>
  ({ attribute, kind: "cat", patients: n, per, ...(displayName ? { displayName } : {}), ...(priority != null ? { priority } : {}) });
const rows = (attrs: TrackAttr[], totals = { patients: 100, samples: 100 }) => clinicalTrackRows(attrs, totals);
const labels = (attrs: TrackAttr[], totals?: { patients: number; samples: number }) => rows(attrs, totals).map((r) => r.label);

/** The menu, server-rendered with its popover forced open; null when this runner cannot load it. */
let menuLoad: Promise<{ TracksMenu: React.ComponentType<any> } | string> | null = null;
function loadMenu() {
  menuLoad ??= (async () => {
    if (typeof (mock as { module?: unknown }).module !== "function") return "needs node --experimental-test-module-mocks";
    try {
      const gearUrl = new URL("../app/_ui/gear-menu.tsx", import.meta.url).href;
      const real = await import(gearUrl);
      mock.module(gearUrl, { namedExports: { ...real,
        GearMenu: ({ children, label }: { children: unknown; label: React.ReactNode }) =>
          React.createElement("div", { "data-menu": "open" }, label, typeof children === "function" ? (children as (c: () => void) => React.ReactNode)(() => {}) : children as React.ReactNode) } });
      return await import("../app/_oncoprint/OncoprintCard.tsx");
    } catch (e) {
      return "needs a .tsx loader (tsx): " + (e as Error).message.split("\n")[0];
    }
  })();
  return menuLoad;
}
interface MenuRow { id: string; label: string; freq: string; freqTip: string; disabled: boolean; checked: boolean; labelTip: string }
interface Menu { html: string; rows: MenuRow[]; buttons: { text: string; disabled: boolean }[]; tabs: string[] }
const dec = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function renderMenu(t: { skip: (m: string) => void }, props: Record<string, unknown>): Promise<Menu | null> {
  const m = await loadMenu();
  if (typeof m === "string") { t.skip(m); return null; }
  const html = renderToStaticMarkup(React.createElement(m.TracksMenu, {
    attrs: [], profiles: [], clinical: [], heatmap: [], cohorts: [], derivedCohorts: [], busy: false,
    onClinical() {}, onHeatmap() {}, onDerived() {}, ...props }));
  const rowsOut: MenuRow[] = [];
  for (const [, body] of html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)) {
    const spans = [...body.matchAll(/<span([^>]*)>([^<]*)<\/span>/g)].filter(([, a]) => !/checkbox-indicator/.test(a));
    const tip = (a: string) => dec(/data-tip="([^"]*)"/.exec(a)?.[1] ?? "");
    const [l, f] = spans;
    rowsOut.push({ id: tip(l?.[1] ?? ""), labelTip: tip(l?.[1] ?? ""), label: dec(l?.[2] ?? ""), freq: dec(f?.[2] ?? ""), freqTip: tip(f?.[1] ?? ""),
      disabled: /role="checkbox"[^>]*disabled=""/.test(body), checked: /role="checkbox"[^>]*aria-checked="true"/.test(body) });
  }
  const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, a]) => !/role="(checkbox|tab)"/.test(a))
    .map(([, a, b]) => ({ text: dec(b.replace(/<[^>]+>/g, "")).trim(), disabled: /\sdisabled=""/.test(a) }));
  const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map(([, s]) => dec(s).trim());
  return { html: dec(html), rows: rowsOut, buttons, tabs };
}
const offered = (menu: Menu, re: RegExp) => menu.buttons.some((b) => re.test(b.text) && !b.disabled);

// The fixture database (connection b), when the run points at it.
const dbReason = process.env.CLICKHOUSE2_LABEL === "fixture peer" ? null : "needs the fixture study on connection b: CLICKHOUSE2_* from `npm run peer-db`";
let dbLoad: Promise<{ explore: (draft?: unknown) => Promise<any>; buildContract: (s: unknown) => Promise<any> }> | null = null;
function db() {
  dbLoad ??= (async () => {
    const { secondary } = await import("../lib/ch.ts");
    const { buildExplore } = await import("../lib/explore.ts");
    const { buildContract } = await import("../lib/oncoprint.ts");
    const conn = secondary();
    assert.ok(conn, "CLICKHOUSE2_URL is set but connection b is not configured");
    return {
      explore: (draft?: unknown) => buildExplore({ study: FIXTURE, conn, skipGenes: true, skipBins: true, ...(draft ? { draft: draft as never } : {}) }),
      buildContract: (s: unknown) => buildContract(s as never)
    };
  })();
  return dbLoad;
}
/** The Tracks menu's rows as the Results page builds them: Explore's facets of the selection, its totals as denominators. */
async function fixtureRows(draft?: unknown) {
  const r = await (await db()).explore(draft);
  const attrs: TrackAttr[] = trackAttrs(r);
  const out = clinicalTrackRows(attrs, r.totals);
  return { totals: r.totals, rows: out, byId: new Map(out.map((x) => [x.attribute, x])) };
}
const freqOf = (m: Map<string, { pct: number | null }>, id: string) => { const x = m.get(id); return x ? trackFreqText(x.pct) : "(not listed)"; };
const FEMALE = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] };
// Every attribute the fixture study declares (clinical_attribute_meta, as `POST /clinical-attributes/fetch` returns them):
// the data files' columns, plus MUTATION_COUNT and SAMPLE_COUNT, which import adds.
const FIXTURE_ATTRS = ["AGE", "CANCER_TYPE", "CANCER_TYPE_DETAILED", "DEAD", "FLAG_BOOL", "FRACTION_GENOME_ALTERED", "KI67_INDEX",
  "MUTATION_COUNT", "ONCOTREE_CODE", "OS_MONTHS", "OS_STATUS", "PARSE_PROBE", "PATIENT_FLAG", "PATIENT_SCORE", "SAMPLE_COUNT",
  "SAMPLE_TYPE", "SEX", "SITE_LABEL", "SMOKING_HISTORY", "TUMOR_GRADE"];

// ---- List contents -----------------------------------------------------------------------------

describe("list contents", () => {
  test("1: single study — every server attribute is listed, no exclusion list (MUTATION_COUNT, FRACTION_GENOME_ALTERED are ordinary rows) (RVS:1157-1161, 1193-1199)", () => {
    const got = rows([attr("MUTATION_COUNT", 50, "sample", "Mutation Count", 30), attr("FRACTION_GENOME_ALTERED", 40, "sample", "Fraction Genome Altered", 20), attr("SEX", 100, "patient", "Sex")]);
    assert.deepEqual(got.map((r) => r.attribute).sort(), ["FRACTION_GENOME_ALTERED", "MUTATION_COUNT", "SEX"]);
  });

  test("1: single study, fixture database — the whole study's 20 declared attributes are listed (RVS:1157-1161)", { skip: dbReason ?? false }, async () => {
    const { rows: got } = await fixtureRows();
    assert.deepEqual(got.map((r) => r.attribute).sort(), FIXTURE_ATTRS);
  });

  test("2: Mutation spectrum is always listed in the Clinical tab, ranked first among the rows (RVS:1162-1172, TM:185-204)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 100, "patient", "Sex")], totals: { patients: 100, samples: 100 }, spectrum: true });
    if (!m) return;
    assert.equal(m.rows[0]?.label, "Mutation spectrum", "rows: " + m.rows.map((r) => r.label).join(", "));
  });

  test("3: single study — no \"Study of origin\" row (RVS:1173)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 100, "patient", "Sex")], totals: { patients: 100, samples: 100 } });
    if (!m) return;
    assert.ok(!m.rows.some((r) => /study of origin/i.test(r.label)));
  });

  test("4: multi-study adds \"Study of origin\" (RVS:1173-1184)", { skip: "documented in PR #196: Study of origin is drawn as an automatic row, not listed in the tab; TracksMenu takes no study list" });
  test("5: #samples != #patients adds \"# Samples per Patient\" (RVS:1185-1193)", { skip: "the special row is not ours; a study's own SAMPLE_COUNT attribute is listed as an ordinary row (row 1)" });
  test("6: #samples == #patients — no \"# Samples per Patient\" row (RVS:1185)", { skip: "as row 5: no special row exists to suppress" });
  test("7: one \"Profiled in X\" row per selected profile (RVS:961-979, 1196)", { skip: "documented in PR #196: Profiled-in rows are drawn automatically, not listed in the tab" });
  test("8: comparison-group attributes go to the Groups tab, not Clinical (TM:175-176)", { skip: "no IN_COMPARISON_GROUP attributes in our catalog; cohort rows are a separate tab fed by `cohorts`" });

  test("9: custom-chart attributes are excluded from the Clinical tab (TM:177-180)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 100, "patient", "Sex"), attr("custom:brain-mets/MET_SITE", 30, "patient", "MET_SITE")], totals: { patients: 100, samples: 100 } });
    if (!m) return;
    assert.deepEqual(m.rows.map((r) => r.label), ["Sex"]);
  });

  test("10: same attribute id in two studies — one row, the first study's displayName and priority (TM:157-160 _.uniqBy)", async () => {
    const { mergeExplore } = await import("../lib/explore.ts");
    const part = (study: string, n: number, displayName: string, priority: number, totals: { patients: number; samples: number }) =>
      ({ study, draftCount: null, clinical: [{ kind: "cat", attribute: "GRADE", per: "sample", patients: n, displayName, priority, values: [{ v: "x", n }] }],
        events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, totals });
    const merged = mergeExplore([part("s1", 3, "Grade (first)", 5, { patients: 4, samples: 5 }), part("s2", 2, "Grade (second)", 50, { patients: 3, samples: 3 })] as never);
    const grade = merged.clinical.filter((f) => f.attribute === "GRADE");
    assert.equal(grade.length, 1);
    assert.equal(grade[0].displayName, "Grade (first)");
    assert.equal(grade[0].priority, 5);
  });
});

// ---- Label ------------------------------------------------------------------------------------

describe("label", () => {
  test("11: the row label is displayName (TM:231)", () => {
    assert.deepEqual(labels([attr("SAMPLE_TYPE", 100, "sample", "Sample Type")]), ["Sample Type"]);
  });

  test("11: rendered label is displayName; the id in the row's tooltip is OUR documented divergence (PR #196) (TM:231, ACT:164-166)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SAMPLE_TYPE", 100, "sample", "Sample Type")], totals: { patients: 100, samples: 100 } });
    if (!m) return;
    assert.equal(m.rows[0].label, "Sample Type");
    assert.ok(!m.rows[0].label.includes("SAMPLE_TYPE"), "no id in the label itself");
    assert.equal(m.rows[0].labelTip, "SAMPLE_TYPE");
  });
});

// ---- Freq -------------------------------------------------------------------------------------

describe("freq", () => {
  test("12: single study, fixture database — sample-level Freq = samples with a value / queried samples (RVS:1250-1290, TM:242-256)", { skip: dbReason ?? false }, async () => {
    const { totals, byId } = await fixtureRows();
    assert.deepEqual(totals, { patients: 40, samples: 44 });
    // counted from data_clinical_sample.txt: non-blank cells of 44 samples
    const expected: [string, string][] = [["SAMPLE_TYPE", "100.0%"], ["CANCER_TYPE", "100.0%"], ["FRACTION_GENOME_ALTERED", "100.0%"],
      ["PARSE_PROBE", "27.3%"] /* 12/44 */, ["KI67_INDEX", "13.6%"] /* 6/44, ">90" and "high" count */, ["SITE_LABEL", "13.6%"] /* 6/44 */,
      ["FLAG_BOOL", "11.4%"] /* 5/44 */, ["TUMOR_GRADE", "9.1%"] /* 4/44 */];
    assert.deepEqual(expected.map(([id]) => [id, freqOf(byId, id)]), expected);
  });

  test("13: a sample subset (custom case set) — counts over those samples only, fixture database, SEX = Female (RVS:1257-1264)", { skip: dbReason ?? false }, async () => {
    const { totals, byId } = await fixtureRows(FEMALE);
    // 24 female patients; FX-P02 and FX-P04 have two samples: 26 samples
    assert.deepEqual(totals, { patients: 24, samples: 26 });
    const expected: [string, string][] = [["SAMPLE_TYPE", "100.0%"], ["PARSE_PROBE", "26.9%"] /* 7/26: P02×2, P04×2, P05, P06, P08 */,
      ["FLAG_BOOL", "11.5%"] /* 3/26: P02×2, P05 */, ["TUMOR_GRADE", "7.7%"] /* 2/26 */, ["KI67_INDEX", "7.7%"], ["SITE_LABEL", "7.7%"]];
    assert.deepEqual(expected.map(([id]) => [id, freqOf(byId, id)]), expected);
  });

  test("14: multi-study — counts over all queried samples, summed across the studies' rows (RVS:1266-1273, 1281-1290)", async () => {
    const { mergeExplore } = await import("../lib/explore.ts");
    const part = (study: string, n: number, totals: { patients: number; samples: number }) =>
      ({ study, draftCount: null, clinical: [{ kind: "cat", attribute: "GRADE", per: "sample", patients: n, displayName: "Grade", priority: 1, values: [{ v: "x", n }] }],
        events: [], caseLists: [], profiles: [], gaProfiles: [], stats: { ms: 0 }, totals });
    const merged = mergeExplore([part("s1", 3, { patients: 4, samples: 5 }), part("s2", 2, { patients: 3, samples: 3 })] as never);
    const got = clinicalTrackRows(merged.clinical.map((f) => ({ attribute: f.attribute, kind: f.kind, patients: f.patients, per: f.per, displayName: f.displayName, priority: f.priority })), merged.totals);
    assert.equal(trackFreqText(got[0].pct), "62.5%"); // (3 + 2) / (5 + 3)
  });

  test("15: patient-level attribute counted over queried PATIENTS is OUR documented divergence (PR #196; the portal counts those patients' samples / #samples) (RVS:1275-1290)", { skip: dbReason ?? false }, async () => {
    const all = await fixtureRows();
    const female = await fixtureRows(FEMALE);
    // PATIENT_SCORE: FX-P01 (2 samples), FX-P02 (2 samples). Portal: 4/44 = 9.1%, females 2/26 = 7.7%.
    // PATIENT_FLAG: FX-P01 only. Portal: 2/44 = 4.5%.
    assert.deepEqual([freqOf(all.byId, "PATIENT_SCORE"), freqOf(all.byId, "PATIENT_FLAG"), freqOf(female.byId, "PATIENT_SCORE"), freqOf(all.byId, "OS_MONTHS")],
      ["5.0%" /* 2/40 */, "2.5%" /* 1/40 */, "4.2%" /* 1/24 */, "100.0%" /* 40/40; the portal's 44/44 */]);
  });

  test("15: the patient-level row's tooltip says it counts patients and that the portal counts samples (documented, PR #196)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 5, "patient", "Sex")], totals: { patients: 8, samples: 10 } });
    if (!m) return;
    assert.equal(m.rows[0].freq, "62.5%");
    assert.match(m.rows[0].freqTip, /patients/);
    assert.match(m.rows[0].freqTip, /portal counts/);
  });

  test("16: the denominator of a sample-level attribute is the queried samples, never the patients (TM:242-256)", () => {
    const [r] = rows([attr("SAMPLE_TYPE", 50, "sample")], { patients: 50, samples: 200 });
    assert.equal(r.pct, 25);
  });

  test("17: an attribute with no values counts 0 → \"0%\" (RVS:1292-1296)", () => {
    const [r] = rows([attr("EMPTY", 0, "sample", "Empty")], { patients: 10, samples: 12 });
    assert.equal(r.pct, 0);
    assert.equal(trackFreqText(r.pct), "0%");
  });

  test("17: fixture database, SEX = Female — PATIENT_FLAG (no female has a value) is still listed, at \"0%\" (RVS:1292-1296; the list is study-wide, RVS:1157)", { skip: dbReason ?? false }, async () => {
    const { byId } = await fixtureRows(FEMALE);
    assert.equal(freqOf(byId, "PATIENT_FLAG"), "0%");
  });

  test("18: \"NA\" values are counted as the backend counts them (RVS:1325-1329)", { skip: "the fixture study holds no \"NA\" strings to count, and this audit may not change the committed fixture; docs/dsl.md says ours treats NA/N/A/NaN as no value, as the portal's importer does" });
  test("19: Study of origin / # Samples per Patient → 100% (RVS:1298-1301)", { skip: "documented in PR #196: these are not rows of our tab (rows 4, 5)" });
  test("20: Mutation spectrum Freq = samples sequenced / samples (RVS:1302-1308)", { skip: "documented open item (docs/PORTAL-PARITY.md: \"Its Freq in Tracks › Clinical\")" });
  test("21: Profiled-in X → 100% (RVS:1310-1312)", { skip: "documented in PR #196: Profiled-in rows are not listed (row 7)" });

  test("22: Freq = 100*count/numSamples, unrounded (TM:253)", () => {
    const [r] = rows([attr("METASTATIC_SITE", 4779, "sample")], { patients: 10336, samples: 10945 });
    assert.equal(r.pct, (100 * 4779) / 10945);
  });

  test("23: print 0 → \"0%\" (SVU:1987-1988)", () => assert.equal(trackFreqText(0), "0%"));
  test("24: print 99.95 → \"99.9%\"; 99.9 ≤ v < 100 never rounds up to 100.0 (SVU:1989-1990)", () => {
    assert.deepEqual([99.95, 99.9, 99.999].map(trackFreqText), ["99.9%", "99.9%", "99.9%"]);
  });
  test("25: print 100 → \"100.0%\" (SVU:1991-1992)", () => assert.equal(trackFreqText(100), "100.0%"));
  test("26: print 43.66 → \"43.7%\", toFixed(1); 0.1 → \"0.1%\" (SVU:1991-1992)", () => {
    assert.deepEqual([43.66, 0.1, 12.34].map(trackFreqText), ["43.7%", "0.1%", "12.3%"]);
  });
  test("27: print 0.05 → \"<0.1%\"; 0.0999 too (SVU:1993-1994)", () => assert.deepEqual([0.05, 0.0999].map(trackFreqText), ["<0.1%", "<0.1%"]));
  test("28: print negative / NaN → \"NA\", no % (SVU:1985-1986)", () => {
    assert.deepEqual([-1, NaN].map(trackFreqText), ["NA", "NA"]);
  });
  test("28: zero queried samples → \"NA\" (100*0/0 is NaN) (SVU:1985-1986, TM:253)", () => {
    const [r] = rows([attr("SAMPLE_TYPE", 0, "sample")], { patients: 0, samples: 0 });
    assert.equal(trackFreqText(r.pct), "NA");
  });

  test("29: the Freq column's header tooltip reads \"% samples with data\" (ACT:189-196)", { todo: "cosmetic: the Tracks menu's Freq header tooltip and loading text differ from the portal's (docs/PORTAL-PARITY.md)" }, async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 5, "patient", "Sex")], totals: { patients: 8, samples: 10 } });
    if (!m) return;
    assert.ok(m.html.includes("% samples with data"), "no such header tooltip");
  });

  test("30: while Freq is loading the rows are hidden behind \"Calculating data availability...\" (ACT:363-400)", { todo: "cosmetic: the Tracks menu's Freq header tooltip and loading text differ from the portal's (docs/PORTAL-PARITY.md)" }, async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 5, "patient", "Sex")], loading: true });
    if (!m) return;
    assert.equal(m.rows.length, 0, "no rows while loading");
    assert.ok(m.html.includes("Calculating data availability..."), "loading text");
  });

  test("31: a 0% row is disabled — its checkbox cannot be ticked (ACT:66-71, 142-155)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 5, "patient", "Sex"), attr("ZERO", 0, "sample", "Zero")], totals: { patients: 8, samples: 10 } });
    if (!m) return;
    assert.deepEqual(m.rows.map((r) => [r.label, r.disabled]), [["Sex", false], ["Zero", true]]);
  });
});

// ---- Sort -------------------------------------------------------------------------------------

describe("sort", () => {
  test("32: rank Study of origin < Mutation spectrum < Profiled-in < the rest (TM:185-204)", { skip: "documented in PR #196: none of the three special rows is listed (Mutation spectrum first is row 2's test)" });

  test("33: freq descending first (TM:205-210)", () => {
    assert.deepEqual(labels([attr("A", 10, "sample", "a"), attr("B", 90, "sample", "b"), attr("C", 50, "sample", "c")]), ["b", "c", "a"]);
  });
  test("33: freq compared unrounded — 33.34% before 33.33% though both print \"33.3%\" and the second has higher priority (TM:205-210)", () => {
    const got = rows([attr("LOW", 3333, "sample", "Low", 50), attr("HIGH", 3334, "sample", "High", 1)], { patients: 10000, samples: 10000 });
    assert.deepEqual(got.map((r) => [r.label, trackFreqText(r.pct)]), [["High", "33.3%"], ["Low", "33.3%"]]);
  });
  test("33: equal freq → priority descending, numerically (10 before 9) (TM:211)", () => {
    assert.deepEqual(labels([attr("A", 50, "sample", "A nine", 9), attr("B", 50, "sample", "B ten", 10), attr("C", 50, "sample", "C one", 1)]), ["B ten", "A nine", "C one"]);
  });
  test("33: equal freq and priority → displayName lowercased, ascending (TM:212)", () => {
    assert.deepEqual(labels([attr("B", 50, "sample", "banana", 1), attr("A", 50, "sample", "Apple", 1), attr("C", 50, "sample", "Cherry", 1)]), ["Apple", "banana", "Cherry"]);
  });
  test("33: names compare by UTF-16 code unit as lodash sortBy does — \"zeta\" before \"Éclair\" (TM:212)", () => {
    assert.deepEqual(labels([attr("E", 50, "sample", "Éclair", 1), attr("Z", 50, "sample", "zeta", 1)]), ["zeta", "Éclair"]);
  });

  test("33: fixture database — the portal's order uses each attribute's stored priority (1; MUTATION_COUNT 30) (TM:205-214, RVS:1157)", { skip: dbReason ?? false }, async () => {
    const { rows: got } = await fixtureRows();
    // Sample-level Freqs as the portal counts them; patient-level ones are 100% both ways except PATIENT_SCORE/FLAG (row 15).
    const top = got.slice(0, 14).map((r) => r.attribute);
    assert.deepEqual(top, ["MUTATION_COUNT", // 100%, priority 30
      // 100%, priority 1, by display name lowercased
      "AGE", "CANCER_TYPE", "CANCER_TYPE_DETAILED", "DEAD", "FRACTION_GENOME_ALTERED", "SAMPLE_COUNT" /* Number of Samples Per Patient */,
      "ONCOTREE_CODE", "OS_MONTHS", "OS_STATUS", "SAMPLE_TYPE", "SEX", "SMOKING_HISTORY",
      "PARSE_PROBE" /* 27.3% */]);
    assert.deepEqual(got.slice(14, 18).map((r) => r.attribute), ["KI67_INDEX", "SITE_LABEL" /* 13.6%: "ki-67 index" < "site label" */, "FLAG_BOOL" /* 11.4% */, "TUMOR_GRADE" /* 9.1% */]);
  });

  test("34: the table re-sorts by its Name / Freq headers (ACT:178-184, 216-217)", { skip: "our menu has no column headers to sort by (not claimed by PR #196)" });
});

// ---- Select / Deselect all --------------------------------------------------------------------

describe("select / deselect all", () => {
  const three = { attrs: [attr("SAMPLE_TYPE", 10, "sample", "Sample Type"), attr("SEX", 5, "patient", "Sex"), attr("ZERO", 0, "sample", "Zero")], totals: { patients: 8, samples: 10 } };

  test("35: \"Select all (N)\", N = the rows listed (filtered), selected and 0% rows included (FHT:374-378)", async (t) => {
    const m = await renderMenu(t, { ...three, clinical: ["SEX"] });
    if (!m) return;
    assert.ok(m.buttons.some((b) => b.text === "Select all (3)"), "buttons: " + m.buttons.map((b) => b.text).join(" | "));
  });

  test("36: Select all is offered while fewer rows are selected than listed, and not once every row is (FHT:370-379)", async (t) => {
    const some = await renderMenu(t, { ...three, clinical: ["SEX"] });
    if (!some) return;
    assert.ok(offered(some, /^Select all/), "1 of 3 selected: offered");
    const all = await renderMenu(t, { attrs: three.attrs.slice(0, 2), totals: three.totals, clinical: ["SAMPLE_TYPE", "SEX"] });
    assert.ok(all && !offered(all, /^Select all/), "2 of 2 selected: not offered; buttons: " + all?.buttons.map((b) => b.text + (b.disabled ? " [disabled]" : "")).join(" | "));
  });

  test("37: Deselect all is offered iff at least one row is selected (shown/hidden; disabled counts as not offered) (FHT:370, 380)", async (t) => {
    const none = await renderMenu(t, three);
    if (!none) return;
    assert.ok(!offered(none, /^Deselect all/), "none selected: not offered");
    const one = await renderMenu(t, { ...three, clinical: ["SEX"] });
    assert.ok(one && offered(one, /^Deselect all/), "one selected: offered");
  });

  const noDom = "needs a DOM to click and type in the menu; the repo has no DOM library for unit tests (the e2e suite is where this belongs)";
  test("38: Select all with a search filter adds only the filtered rows, minus 0% rows (FHT:264-265, ACT:315-320)", { skip: noDom });
  test("39: Deselect all with a search filter removes only the filtered rows, 0% rows included (FHT:271-272, ACT:324-325, TM:304-315)", { skip: noDom });
  test("40: Select / Deselect all apply to the figure at once and discard other staged ticks (TM:291-315)", { skip: noDom });
});

// ---- Staged ticks / Update tracks -------------------------------------------------------------

describe("staged ticks / update tracks", () => {
  const noDom = "needs a DOM to click in the menu; the repo has no DOM library for unit tests (the e2e suite is where this belongs)";
  test("41: ticking a row only stages it; the figure is unchanged (TM:326-335)", { skip: noDom });

  test("42: the staged ticks start as the figure's tracks (RVO:577-582)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SAMPLE_TYPE", 10, "sample", "Sample Type"), attr("SEX", 5, "patient", "Sex")], totals: { patients: 8, samples: 10 }, clinical: ["SEX"] });
    if (!m) return;
    assert.deepEqual(m.rows.map((r) => [r.label, r.checked]), [["Sample Type", false], ["Sex", true]]);
  });

  test("43: \"Update tracks\" is not shown while the staged ticks equal the figure's (TM:337-345, 357-367)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SEX", 5, "patient", "Sex")], totals: { patients: 8, samples: 10 }, clinical: ["SEX"] });
    if (!m) return;
    assert.ok(!m.buttons.some((b) => /Update tracks/.test(b.text)));
  });

  test("44: Update tracks applies the staged ticks in one change and closes the menu (TM:317-324)", { skip: noDom });
  test("45: removing a track from the oncoprint updates both the selection and the staged ticks (RVO:1660-1673)", { skip: noDom });
});

// ---- Defaults at load -------------------------------------------------------------------------

describe("defaults at load", () => {
  const why = "default tracks are chosen by the Results page component; no exported function to call (and the document, not a URL/session, holds the tracks: invariant 9)";
  test("46: URL clinicallist / session is used when present (RVO:356-365, 752-766)", { skip: why });
  test("47: else the server's oncoprint_clinical_tracks_config_json (RVO:772-783)", { skip: why });
  test("48: else Study of origin (>1 study), # Samples per Patient (samples > patients), every Profiled-in attribute (RVO:367-398)", { skip: why });
});

// ---- Cap --------------------------------------------------------------------------------------

describe("cap", async () => {
  const { normalizeSpec } = await import("../lib/oncoprint.ts");
  test("49: 30 clinical tracks are all kept — no cap of 8 (TM, RVO: no cap)", () => {
    const many = Array.from({ length: 30 }, (_, i) => "ATTR_" + i);
    assert.deepEqual(normalizeSpec({ genes: ["TP53"], clinical: many } as never).clinical, many);
  });

  test("49: fixture database — all 20 of the study's attributes are drawn as tracks (TM, RVO: no cap)", { skip: dbReason ?? false }, async () => {
    const c = await (await db()).buildContract({ study: FIXTURE, genes: ["KRAS"], clinical: FIXTURE_ATTRS, unit: "sample", display: { annotate: "none" } });
    const drawn = c.tracks.filter((t: { kind: string }) => t.kind === "clinical").map((t: { label: string }) => t.label);
    assert.equal(drawn.length, 20, "drawn: " + drawn.join(", "));
  });

  test("49: refusing past 100 tracks (CLINICAL_TRACK_LIMIT) is OUR documented divergence (PR #196; the portal has no cap)", () => {
    const at = Array.from({ length: 100 }, (_, i) => "ATTR_" + i);
    assert.equal(normalizeSpec({ genes: ["TP53"], clinical: at } as never).clinical?.length, 100);
    assert.throws(() => normalizeSpec({ genes: ["TP53"], clinical: [...at, "ONE_MORE"] } as never), /101 tracks asked for; an oncoprint draws at most 100/);
  });
});

// ---- Other ------------------------------------------------------------------------------------

describe("other", () => {
  test("50: a Save tracks button when the session service is on (TM:270-278)", { skip: "documented in PR #196: tracks live in the document (invariant 9; ONC-MD-12 N/A)" });

  test("51: the Clinical tab's label counts its options (TM:587-600)", async (t) => {
    const m = await renderMenu(t, { attrs: [attr("SAMPLE_TYPE", 10, "sample", "Sample Type"), attr("SEX", 5, "patient", "Sex"), attr("ZERO", 0, "sample", "Zero")], totals: { patients: 8, samples: 10 } });
    if (!m) return;
    assert.ok(m.tabs.includes("Clinical (3)"), "tabs: " + m.tabs.join(" | "));
  });
});
