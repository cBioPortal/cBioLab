// The timeline view's track model (lib/timeline-tracks.ts) — the rules it takes from cBioPortal's
// patient-view timeline — and the figure's promises about what it draws (lib/timeline-svg.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTracks, flattenTracks, sampleMarks, sampleTipRows, numericResult, axisTicks, dayScale, formatDays, yearLabel, monthTicks, axisMarks, timelineAxisItems, MONTH, YEAR, type AxisMark, type AxisTick } from "../lib/timeline-tracks.ts";
import { rowAt, timelineSvg, timelineSummary, zoomFromDrag, ZOOM_MIN_DRAG } from "../lib/timeline-svg.ts";
import { standaloneSvg } from "../app/lab/chart-files.ts";
import { patientEventsSql, timelinePatientRowSource } from "../lib/patient-timeline.ts";
import { pageSql, rankSql } from "../lib/table-query.ts";
import type { PatientEvent, PatientTimeline } from "../lib/types.ts";
import { timelineDataFiles, TIMELINE_ZIP, eventTables } from "../lib/timeline-tables.ts";

const ev = (type: string, start: number, attrs: Record<string, string> = {}, end: number | null = null): PatientEvent =>
  ({ type, start, end, attrs: Object.entries(attrs) });

const EVENTS: PatientEvent[] = [
  ev("Treatment", 33, { SUBTYPE: "Chemo", AGENT: "CISPLATIN" }, 40),
  ev("Treatment", -5437, { SUBTYPE: "Chemo", AGENT: "METHOTREXATE" }, -5327),
  ev("Treatment", 33, { SUBTYPE: "Radiation Therapy" }),
  ev("TREATMENT", 1734, { SUBTYPE: "Immuno", AGENT: "NIVOLUMAB" }, 1814),
  ev("Lab_Test", -5437, { TEST: "CEA", RESULT: "1.8" }),
  ev("Lab_Test", -5307, { TEST: "CEA", RESULT: "<0.5" }),
  ev("Lab_Test", -5307, { TEST: "ER", RESULT: "positive" }),
  ev("Sample acquisition", -5453, { SAMPLE_ID: "P-1-T02" }),
  ev("Sample acquisition", 0, { SAMPLE_ID: "P-1-T03" }),
  ev("Surgery", 0, { SUBTYPE: "SAMPLE" }),
  ev("Status", 4000, { STATUS: "DECEASED" }),
];

describe("timeline tracks: cBioPortal's grouping", () => {
  const tracks = buildTracks(EVENTS);
  test("event types in the portal's order, folded by case (lib/event-names.ts)", () => {
    // PAT-TL-TR-1: a root track is its event type upper-cased, as the portal's (eventType.toUpperCase())
    assert.deepEqual(tracks.map((t) => t.label), ["SAMPLE ACQUISITION", "SURGERY", "STATUS", "TREATMENT", "LAB_TEST"]);
    // TREATMENT and Treatment are one track
    assert.equal(tracks.find((t) => t.uid === "treatment")!.children.flatMap((c) => c.children.length ? c.children : [c]).length, 4);
  });
  test("treatment nests by type → subtype → agent; a lone Other is absorbed into its parent", () => {
    const tx = tracks.find((t) => t.uid === "treatment")!;
    // no TREATMENT_TYPE anywhere: the single Other level vanishes, and subtypes sit directly under Treatment
    assert.deepEqual(tx.children.map((c) => c.label), ["Chemo", "Radiation Therapy", "Immuno"], "sorted by first start");
    assert.deepEqual(tx.children[0].children.map((c) => c.uid), ["treatment.Chemo.METHOTREXATE", "treatment.Chemo.CISPLATIN"]);
    // Radiation has no AGENT: its own Other child is absorbed, so its events sit on it
    const rt = tx.children[1];
    assert.equal(rt.children.length, 0);
    assert.equal(rt.items.length, 1);
  });
  test("a lab test is a line chart only when every result is a number; a bound counts, and is marked censored", () => {
    const lab = tracks.find((t) => t.uid === "lab_test")!;
    assert.equal(lab.children.find((c) => c.label === "CEA")!.draw, "line");
    assert.equal(lab.children.find((c) => c.label === "ER")!.draw, "events");
    assert.deepEqual(numericResult(EVENTS[5]), { v: 0.5, censored: true });
    assert.deepEqual(numericResult(EVENTS[4]), { v: 1.8, censored: false });
    assert.equal(numericResult(EVENTS[6]), null);
  });
  test("collapsing a track folds every descendant's events into its row", () => {
    const rows = flattenTracks(tracks, new Set(["treatment"]));
    const tx = rows.find((r) => r.track.uid === "treatment")!;
    assert.equal(tx.collapsed, true);
    assert.equal(tx.items.length, 4);
    assert.equal(rows.some((r) => r.track.uid.startsWith("treatment.")), false);
  });
  test("samples numbered in collection order and coloured by type", () => {
    const m = sampleMarks([{ id: "P-1-T03", type: "Metastasis" }, { id: "P-1-T02", type: "Primary" }], EVENTS);
    assert.deepEqual([...m.values()].map((x) => [x.id, x.label, x.color]), [["P-1-T02", "1", "black"], ["P-1-T03", "2", "red"]]);
  });
});

describe("timeline axis", () => {
  test("runs of four or more empty years are cut, keeping the run's ends; the cut is reported", () => {
    const items = [{ i: 0, start: -5437, end: -5327 }, { i: 1, start: 0, end: 48 }];
    const { ticks, cutYears } = axisTicks(items, true);
    assert.ok(cutYears >= 10, "about 13 empty years between the two events");
    assert.equal(ticks.filter((t) => t.trim).length, 1);
    const full = axisTicks(items, false);
    assert.equal(full.cutYears, 0);
    assert.equal(full.ticks.some((t) => t.trim), false);
  });
  test("the scale is monotonic across a cut", () => {
    const items = [{ i: 0, start: -5437, end: -5327 }, { i: 1, start: 0, end: 48 }];
    const { x } = dayScale(axisTicks(items, true).ticks, 800);
    const days = [-5450, -5437, -5000, -3000, -400, 0, 48, 60];
    const xs = days.map(x);
    for (let k = 1; k < xs.length; k++) assert.ok(xs[k] >= xs[k - 1], days[k] + " is not left of " + days[k - 1]);
    assert.ok(xs[xs.length - 1] <= 800);
  });
  test("labels and durations read as the portal writes them", () => {
    assert.equal(yearLabel(0), "0");
    assert.equal(yearLabel(-730), "-2y");
    assert.equal(formatDays(400), "1 year, 1 month, 5 days");
    assert.equal(formatDays(-30), "-1 month");
  });
});

describe("timeline figure", () => {
  const t: PatientTimeline = { study: "s", patient: "P-1", events: EVENTS, samples: [{ id: "P-1-T02", type: "Primary" }], source: { label: "peer", remote: true } };
  test("draws every event, and says what it cut, what is a bound, and where it came from", () => {
    const { svg, layout } = timelineSvg(t, { interactive: true });
    const drawn = new Set([...svg.matchAll(/data-ev="([0-9,]+)"/g)].flatMap((m) => m[1].split(",").map(Number)));
    assert.equal(drawn.size, EVENTS.length, "every event has a mark");
    const text = timelineSummary(t, layout);
    assert.match(text, /via federation/);
    assert.match(text, /cut from the axis/);
    assert.match(text, /1 lab value is recorded as a bound/);
  });
  test("a deceased status is the portal's black diamond, in the theme's ink so it shows in dark mode", () => {
    assert.match(timelineSvg(t, { theme: "light" }).svg, /fill="#16232b" transform="rotate\(45/);
    assert.match(timelineSvg(t).svg, /fill="var\(--ink[^"]*" transform="rotate\(45/);
  });
  test("a study's own colour must look like a colour to be used", () => {
    const bad: PatientTimeline = { ...t, events: [ev("Diagnosis", 0, { STYLE_COLOR: "red\" onload=\"x" })] };
    assert.doesNotMatch(timelineSvg(bad).svg, /onload/);
  });
});

describe("timeline queries", () => {
  test("one patient, quoted; the attribute table filtered to their events before the join", () => {
    const sql = patientEventsSql("msk_chord_2024", "P-0000012", "db");
    assert.match(sql, /p\.stable_id = 'P-0000012'/);
    assert.match(sql, /clinical_event_data WHERE clinical_event_id IN \(SELECT clinical_event_id FROM ev\)/);
  });
  test("the patient list keeps patients with no timeline, with no day rather than day 0", () => {
    const sql = pageSql(timelinePatientRowSource([{ cohort: "c", study: "x", cohortSql: "SELECT '' AS pid", source: "here" }], "db"), {}, [], 10, 0);
    assert.match(sql, /LEFT JOIN ev0/);
    assert.match(sql, /if\(ifNull\(ev\.events, 0\) > 0, toNullable\(toInt64\(ev\.first\)\), NULL\)/);
  });
  test("a patient's place in the list is ranked in the page's own order, among the rows the query keeps", () => {
    const src = timelinePatientRowSource([{ cohort: "c", study: "x", cohortSql: "SELECT '' AS pid", source: "here" }], "db");
    const q = { search: "P-0", sort: { column: "events", desc: true } };
    const page = pageSql(src, q, ["patient"], 10, 0), rank = rankSql(src, q, ["patient"], "x", "P-0'1");
    const order = (s: string) => s.match(/ORDER BY (.*?)(\) - 1 AS idx FROM rows)?\n/)![1];
    assert.equal(order(rank), order(page));
    assert.match(rank, /row_number\(\) OVER \(ORDER BY .*\) - 1 AS idx/);
    assert.match(rank, /positionCaseInsensitive|ILIKE|like/i);
    assert.match(rank, /patient = 'P-0\\'1'/);
  });
});

describe("monthTicks (PAT-TL-ZM-1)", () => {
  const lab = (t: { label: string | null }[]) => t.map((x) => x.label);
  const at = (t: { label: string | null }[], i: number) => t[i - 1].label;

  test("M1 PAT-TL-ZM-1: no month ticks at 150 px/year or less", () => {
    assert.deepEqual(monthTicks(0, 150), []);
    assert.deepEqual(monthTicks(0, 100), []);
  });

  test("M2 PAT-TL-ZM-1: 200 px/year labels only months 4 and 8", () => {
    const t = monthTicks(0, 200);
    assert.equal(t.length, 11);
    t.forEach((x, k) => assert.ok(Math.abs(x.day - MONTH * (k + 1)) < 1e-9));
    assert.deepEqual(lab(t), [null, null, null, "4m", null, null, null, "8m", null, null, null]);
  });

  test("M3 PAT-TL-ZM-1: 800 px/year labels every month", () => {
    assert.deepEqual(lab(monthTicks(0, 800)), Array.from({ length: 11 }, (_, k) => `${k + 1}m`));
  });

  test("M4 PAT-TL-ZM-1: year 2 prefixes the year", () => {
    const t = monthTicks(730, 200);
    assert.equal(at(t, 4), "2y 4m");
    assert.equal(at(t, 8), "2y 8m");
    t.forEach((x, k) => assert.ok(Math.abs(x.day - (730 + MONTH * (k + 1))) < 1e-9));
  });

  test("M5 PAT-TL-ZM-1: count -1 counts months back from the year", () => {
    const t = monthTicks(-365, 200);
    assert.equal(at(t, 4), "-8m");
    assert.equal(at(t, 8), "-4m");
  });

  test("M6 PAT-TL-ZM-1: count -2 gives -1y labels", () => {
    const t = monthTicks(-730, 200);
    assert.equal(at(t, 4), "-1y 8m");
    assert.equal(at(t, 8), "-1y 4m");
  });

  test("M7 PAT-TL-ZM-1: negative year at 800 px/year", () => {
    assert.equal(at(monthTicks(-730, 800), 1), "-1y 11m");
  });
});

describe("PAT-TL-TT-3: a sample event's tooltip rows", () => {
  const tip = (attrs: [string, string][], own: [string, string][]) => sampleTipRows({ type: "Specimen", start: 0, end: null, attrs }, own);
  test("ST1 PAT-TL-TT-3: merged, keys upper-cased with spaces for _, sorted, SAMPLE_ID left out", () => {
    assert.deepEqual(tip([["SURGERY", "Astro"], ["SAMPLE_ID", "S1"]], [["CANCER_TYPE", "Glioma"], ["GRADE", "II"]]),
      [["CANCER TYPE", "Glioma"], ["GRADE", "II"], ["SURGERY", "Astro"]]);
  });
  test("ST2 PAT-TL-TT-3: STYLE_COLOR / style_shape left out", () => {
    assert.deepEqual(tip([["STYLE_COLOR", "red"], ["style_shape", "x"], ["A", "1"]], []), [["A", "1"]]);
  });
  test("ST3 PAT-TL-TT-3: a key in both keeps the event's value, once", () => {
    assert.deepEqual(tip([["GRADE", "III"]], [["GRADE", "II"]]), [["GRADE", "III"]]);
  });
  test("ST4 PAT-TL-TT-3: a lower-case key becomes upper-case", () => {
    assert.deepEqual(tip([], [["grade", "II"]]), [["GRADE", "II"]]);
  });
});

describe("timeline download PAT-TL-ZM-4: the portal's timeline download", () => {
  const t: PatientTimeline = { study: "s", patient: "P-1", events: EVENTS, samples: [{ id: "P-1-T02", type: "Primary" }], source: { label: "peer", remote: true } };
  const file = (o: Parameters<typeof timelineSvg>[1]) => standaloneSvg(timelineSvg(t, { width: 900, theme: "light", ...o }).svg);
  test("D1: not interactive unless asked", () => {
    const off = timelineSvg(t, { theme: "light" }).svg;
    assert.doesNotMatch(off, /data-ev=|data-uid=|class="tl-m"|class="tl-h"/);
    const on = timelineSvg(t, { theme: "light", interactive: true }).svg;
    assert.match(on, /data-ev=/);
    assert.match(on, /data-uid=/);
    assert.match(on, /class="tl-m"/);
    assert.match(on, /class="tl-h"/);
  });
  test("D2: the light theme leaves no colour variables", () => {
    assert.doesNotMatch(timelineSvg(t, { theme: "light" }).svg, /var\(--/);
  });
  test("D3: the file's root svg has numeric width and height and an xmlns", () => {
    const root = /<svg\b[^>]*>/.exec(file({}))![0];
    assert.match(root, /\swidth="\d+"/);
    assert.match(root, /\sheight="\d+"/);
    assert.match(root, /\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
  test("D4: collapsed tracks and expanded gaps change the saved figure", () => {
    assert.notEqual(file({ collapsed: ["treatment"] }), file({}), "collapsed");
    assert.notEqual(file({ expandGaps: false }), file({ expandGaps: true }), "expandGaps");
  });
});


describe("timeline data zip (legacy downloadZippedTracks)", () => {
  const evs: PatientEvent[] = [
    ev("Specimen", 0, { SAMPLE_ID: "S1", STYLE_COLOR: "red" }, 5),
    ev("LAB_TEST", -56, { TEST: "CEA" }),
    ev("Specimen", 1854, { SAMPLE_ID: "S2", SITE: "Liver", STYLE_SHAPE: "circle", PATIENT_ID: "X" }),
  ];
  const files = timelineDataFiles("P-1", evs);
  const lines = (t: string) => t.split("\n").slice(0, -1).map(l => l.split("\t"));

  test("DZ1 one file per type, first-appearance order, lower-cased name", () => {
    assert.deepEqual(files.map(f => f.name), ["data_timeline_specimen.txt", "data_timeline_lab_test.txt"]);
  });
  test("DZ2 header: fixed columns then the type's own keys in first-seen order", () => {
    assert.deepEqual(lines(files[0].text)[0],
      ["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "SAMPLE_ID", "STYLE_COLOR", "SITE", "STYLE_SHAPE"]);
    assert.deepEqual(lines(files[1].text)[0], ["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "TEST"]);
  });
  test("DZ3 one row per event: patient, start, end or empty, type as given, values or empty", () => {
    const s = lines(files[0].text);
    assert.equal(s.length, 3);
    assert.deepEqual(s[1], ["P-1", "0", "5", "Specimen", "S1", "red", "", ""]);
    assert.deepEqual(s[2], ["P-1", "1854", "", "Specimen", "S2", "", "Liver", "circle"]);
    assert.deepEqual(lines(files[1].text), [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "TEST"], ["P-1", "-56", "", "LAB_TEST", "CEA"]]);
  });
  test("DZ4 STYLE_* kept; PATIENT_ID attribute adds no second column", () => {
    const h = lines(files[0].text)[0];
    assert.ok(h.includes("STYLE_COLOR") && h.includes("STYLE_SHAPE"));
    assert.equal(h.filter(c => c === "PATIENT_ID").length, 1);
  });
  test("DZ5 tab/newline joined, exactly one trailing newline, no CR", () => {
    for (const f of files) {
      assert.ok(f.text.endsWith("\n") && !f.text.endsWith("\n\n"));
      assert.ok(!f.text.includes("\r"));
    }
    assert.equal(files[1].text, "PATIENT_ID\tSTART_DATE\tSTOP_DATE\tEVENT_TYPE\tTEST\nP-1\t-56\t\tLAB_TEST\tCEA\n");
  });
  test("DZ6 no events gives no files", () => {
    assert.deepEqual(timelineDataFiles("P-1", []), []);
  });
  test("DZ7 archive name", () => {
    assert.equal(TIMELINE_ZIP, "timeline.zip");
  });
  const raw = (type: string, attrs: [string, string][], start = 0, end: number | null = null): PatientEvent => ({ type, start, end, attrs });
  const NAME = /^data_timeline_[a-z0-9_-]+\.txt$/;
  test("DZ8 safe names: lower case, characters outside a-z0-9_- become _", () => {
    const n = (t: string) => timelineDataFiles("P", [raw(t, [])])[0].name;
    assert.equal(n("Treatment/Surgery"), "data_timeline_treatment_surgery.txt");
    assert.equal(n("/../../x"), "data_timeline_" + "/../../x".replace(/[^a-z0-9_-]/g, "_") + ".txt");
    assert.equal(n("/../../x"), "data_timeline________x.txt");
    assert.equal(n("Lab Test"), "data_timeline_lab_test.txt");
    assert.equal(n("LAB-TEST_2"), "data_timeline_lab-test_2.txt");
    const evil = n("..\\evil");
    assert.ok(!evil.includes("\\") && !evil.includes(".."));
  });
  test("DZ9 every name is one plain file name", () => {
    const types = ["Treatment/Surgery", "/../../x", "..\\evil", "Lab Test", "LAB-TEST_2", ".hidden", "a\\b/c"];
    for (const f of timelineDataFiles("P", types.map(t => raw(t, [])))) {
      assert.match(f.name, NAME);
      const rest = f.name.slice("data_timeline_".length);
      assert.ok(!rest.startsWith(".") && !f.name.includes("/") && !f.name.includes("\\") && !f.name.includes(".."), f.name);
    }
  });
  test("DZ10 no file lost: case-only and same-name types get _2, _3", () => {
    const fs = timelineDataFiles("P", [raw("Lab Test", [["A", "1"]]), raw("lab_test", [["B", "2"]]), raw("LAB TEST", [["C", "3"]])]);
    assert.deepEqual(fs.map(f => f.name), ["data_timeline_lab_test.txt", "data_timeline_lab_test_2.txt", "data_timeline_lab_test_3.txt"]);
    assert.deepEqual(lines(fs[0].text), [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "A"], ["P", "0", "", "Lab Test", "1"]]);
    assert.deepEqual(lines(fs[1].text), [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "B"], ["P", "0", "", "lab_test", "2"]]);
    assert.deepEqual(lines(fs[2].text), [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "C"], ["P", "0", "", "LAB TEST", "3"]]);
  });
  test("DZ11 duplicate key: header once, row holds the first value", () => {
    const fs = timelineDataFiles("P", [raw("Lab", [["K", "first"], ["K", "second"], ["J", "j"]])]);
    assert.deepEqual(lines(fs[0].text), [["PATIENT_ID", "START_DATE", "STOP_DATE", "EVENT_TYPE", "K", "J"], ["P", "0", "", "Lab", "first", "j"]]);
  });
  test("DZ-ET eventTables: PATIENT_ID and STYLE_* dropped, fixed columns, first value", () => {
    const t = eventTables([raw("Lab", [["PATIENT_ID", "X"], ["STYLE_COLOR", "red"], ["K", "first"], ["K", "second"], ["style_shape", "c"]], 3, 7)]);
    assert.equal(t.length, 1);
    assert.deepEqual(t[0].columns, ["START_DATE", "STOP_DATE", "EVENT_TYPE", "K"]);
    assert.deepEqual(t[0].rows, [["3", "7", "Lab", "first"]]);
  });
});

describe("axisMarks: the timeline's axis layout", () => {
  const W10 = () => 10;
  const years = (ms: AxisMark[]) => ms.filter((m): m is Extract<AxisMark, { kind: "year" }> => m.kind === "year");
  const months = (ms: AxisMark[]) => ms.filter((m): m is Extract<AxisMark, { kind: "month" }> => m.kind === "month");
  // like lgg_ucsf_2014 P04: samples at 0/461/1075/1343, an event at 1854
  const P04 = timelineAxisItems([0, 461, 1075, 1343].map((d, i) => ev("Specimen", d, { SAMPLE_ID: "S" + i })).concat([ev("Treatment", 1854)]));

  test("AX1 R5: a year wider than 150 px (X(d + YEAR) − X(d)) gets month marks", () => {
    const { ticks } = axisTicks(P04, true);
    assert.equal(ticks[ticks.length - 1].end, 1874);
    const k = 151 / YEAR;
    const ms = axisMarks(ticks, (d) => d * k, -20 * k, 1874 * k, W10);
    assert.ok(months(ms).length > 0);
    // every year whose month falls in the axis has its 11 months, except the last one, cut at its end
    assert.equal(months(ms).filter((m) => m.x < 365 * k).length, 11);
  });

  test("AX2 R5: a year of 150 px or less gets none", () => {
    const { ticks } = axisTicks(P04, true);
    for (const px of [150, 100]) {
      const k = px / YEAR;
      assert.deepEqual(months(axisMarks(ticks, (d) => d * k, -20 * k, 1874 * k, W10)), [], px + " px");
    }
  });

  test("AX3 R5: month density follows each year's real width, not the axis's average", () => {
    // year 0 is wide (200 px), the rest narrow (50 px)
    const X = (d: number) => (d <= YEAR ? d * 200 / YEAR : 200 + (d - YEAR) * 50 / YEAR);
    const ticks: AxisTick[] = [{ start: 0, end: 364 }, { start: 365, end: 729 }, { start: 730, end: 1094 }];
    const ms = months(axisMarks(ticks, X, 0, X(1094), W10));
    assert.equal(ms.length, 11);
    assert.ok(ms.every((m) => m.x > 0 && m.x < 200));
  });

  test("AX4 R6: marks come in drawing order, left to right per tick", () => {
    const { ticks } = axisTicks(P04, true);
    const k = 800 / YEAR;
    const ms = axisMarks(ticks, (d) => d * k, -20 * k, 1874 * k, (s) => s.length * 6);
    for (let i = 1; i < ms.length; i++) assert.ok(ms[i].x > ms[i - 1].x, "mark " + i + " left of the one before");
    assert.deepEqual(years(ms).map((m) => m.day), [0, 365, 730, 1095, 1460, 1825]);
    assert.equal(ms[0].kind, "year");
    assert.equal(ms[1].kind, "month");
  });

  test("AX5 R6: a cut yields {kind: 'cut', years}, in its place in the order", () => {
    const { ticks } = axisTicks([{ i: 0, start: 0, end: 10 }, { i: 1, start: 3000, end: 3000 }], true);
    const cutTick = ticks.find((t) => t.trim)!;
    const { x } = dayScale(ticks, 600);
    const ms = axisMarks(ticks, x, 0, 600, W10);
    const cuts = ms.filter((m) => m.kind === "cut");
    assert.equal(cuts.length, 1);
    assert.deepEqual(cuts[0], { kind: "cut", x: x(cutTick.start), years: cutTick.trim!.years });
    const at = ms.indexOf(cuts[0]);
    assert.ok(ms.slice(0, at).every((m) => m.x < cuts[0].x) && ms.slice(at + 1).every((m) => m.x > cuts[0].x));
  });

  test("AX6 R6: a year label within 6 px of the previous label is left out; its year line stays", () => {
    const ticks: AxisTick[] = [{ start: 0, end: 364 }, { start: 365, end: 729 }, { start: 730, end: 1094 }];
    // label "0" clamps to [0, 10]; "1y" at 20 starts at 15, within 6 px of 10
    const close = years(axisMarks(ticks, (d) => d * 20 / YEAR, 0, 1000, W10));
    assert.equal(close.length, 3);
    assert.ok(close[0].label);
    assert.equal(close[1].label, undefined);
    assert.equal(close[1].day, 365);
    assert.ok(close[2].label, "2y at 40 starts at 35: clear of 10");
    // at 22 it starts at 17, clear
    assert.ok(years(axisMarks(ticks, (d) => d * 22 / YEAR, 0, 1000, W10))[1].label);
  });

  test("AX7 R6: a year label within w/2 + 8 of a cut is left out; its year line stays", () => {
    const ticks: AxisTick[] = [{ start: 0, end: 364 }, { start: 365, end: 729 }, { start: 730, end: 1094, trim: { realEnd: 1824, years: 3 } }, { start: 1825, end: 2189 }];
    // year 1y sits g px left of the cut at day 730
    const mk = (g: number) => (d: number) => {
      if (d <= YEAR) return d * 100 / YEAR;
      if (d <= 730) return 100 + (d - YEAR) * g / YEAR;
      return 100 + g + 60 + (d - 1825) * 100 / YEAR;
    };
    const near = axisMarks(ticks, mk(12), 0, 1000, W10);
    const y1 = years(near).find((m) => m.day === 365)!;
    assert.equal(y1.label, undefined, "12 px from the cut: within 5 + 8");
    assert.ok(near.some((m) => m.kind === "cut"));
    const far = years(axisMarks(ticks, mk(14), 0, 1000, W10)).find((m) => m.day === 365)!;
    assert.ok(far.label, "14 px from the cut: clear");
  });

  test("AX8 R6: end labels are clamped inside [lo, hi]", () => {
    const ticks: AxisTick[] = [{ start: 0, end: 364 }, { start: 365, end: 729 }];
    const ms = years(axisMarks(ticks, (d) => 50 + d * 100 / YEAR, 50, 150, (s) => s.length * 10));
    assert.deepEqual(ms.map((m) => m.x), [50, 150]);
    assert.deepEqual(ms.map((m) => m.label), [{ x: 55, text: "0" }, { x: 140, text: "1y" }]);
  });

  test("AX9 R6: month labels need clearance from the label before them", () => {
    const ticks: AxisTick[] = [{ start: 0, end: 364 }];
    const k = 200 / YEAR;
    const roomy = months(axisMarks(ticks, (d) => d * k, 0, 1000, W10));
    assert.equal(roomy.length, 11);
    assert.deepEqual(roomy.filter((m) => m.label).map((m) => m.label), ["4m", "8m"]);
    // a 120-px-wide "0" label covers [0, 120]: "4m" at ~66 has no room, "8m" at ~133 neither (within 6 px)
    const wide = (s: string) => (s === "0" ? 120 : 10);
    const crowded = months(axisMarks(ticks, (d) => d * k, 0, 1000, wide));
    assert.equal(crowded.length, 11, "the ticks stay");
    assert.equal(crowded[3].label, undefined);
    assert.ok(crowded[3].x - 5 <= 120 + 6);
    // a month label running past hi is left out
    const clipped = months(axisMarks(ticks, (d) => d * k, 0, 135, W10));
    assert.equal(clipped.find((m) => m.label === "8m"), undefined);
  });
});

describe("drag to zoom (PAT-TL-ZM-3)", () => {
  const plot = { x: 100, width: 800 };
  test("a drag of more than 10 px zooms to the stretch it covers, as fractions of the unzoomed plot; 10 px or less is a click", () => {
    assert.equal(ZOOM_MIN_DRAG, 10);
    assert.deepEqual(zoomFromDrag(300, 500, plot, null), [0.25, 0.5]);
    assert.deepEqual(zoomFromDrag(500, 300, plot, null), [0.25, 0.5], "either direction");
    assert.equal(zoomFromDrag(300, 310, plot, null), null);
    assert.deepEqual(zoomFromDrag(300, 311, plot, null)!.map((v) => +v.toFixed(5)), [0.25, 0.26375]);
    assert.deepEqual(zoomFromDrag(0, 2000, plot, null), [0, 1], "held to the plot");
  });
  test("a drag inside a zoomed view zooms further, within the stretch shown", () => {
    assert.deepEqual(zoomFromDrag(100, 500, plot, [0.5, 0.75]), [0.5, 0.625]);
  });
  test("the zoomed figure draws the stretch across the plot and clips the rest; the header column and every event mark stay", () => {
    const t: PatientTimeline = { study: "s", patient: "P-1", events: [ev("Treatment", 0), ev("Treatment", 1000), ev("Status", 2000)], samples: [], source: { label: "here", remote: false } };
    const full = timelineSvg(t, { width: 1000, interactive: true }), zoomed = timelineSvg(t, { width: 1000, interactive: true, zoom: [0, 0.5] });
    assert.doesNotMatch(full.svg, /clip-path/);
    assert.match(zoomed.svg, /<clipPath id="tl-zoom-clip"><rect x="\d+(\.\d+)?" y="0"/);
    assert.match(zoomed.svg, /<g clip-path="url\(#tl-zoom-clip\)">/);
    const xs = (svg: string) => [...svg.matchAll(/data-ev="(\d+)" transform="translate\(([\d.-]+) 0\)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const f = new Map(xs(full.svg)), z = new Map(xs(zoomed.svg));
    const { x, width } = full.layout.plot;
    assert.deepEqual(zoomed.layout.plot, full.layout.plot);
    for (const i of [0, 1, 2]) {
      const frac = (f.get(i)! - x) / width;
      assert.ok(Math.abs(z.get(i)! - (x + frac / 0.5 * width)) < 0.2, "event " + i + " stretched twice as wide from the left edge");
    }
    assert.ok(z.get(2)! > x + width, "the last event falls outside, clipped");
    assert.equal(timelineSvg(t, { width: 1000, zoom: [0.5, 0.5] }).svg.includes("clip-path"), false, "an empty stretch is no zoom");
    // the axis keeps only the marks inside the stretch: day 0's year label is not held at the left edge
    const labelsAt = (svg: string) => [...svg.matchAll(/<text[^>]*x="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), text: m[2] }));
    const inZoom = timelineSvg(t, { width: 1000, zoom: [0.3, 0.6] });
    const zx = inZoom.layout.plot.x;
    assert.ok(!labelsAt(inZoom.svg).some((l) => l.text === "0" && Math.abs(l.x - zx) < 20), labelsAt(inZoom.svg).map((l) => l.text + "@" + l.x).join(" "));
  });
});

test("PAT-TL-TR-5 rowAt: the row the pointer is on, by the figure's own rows; its bottom edge is the next row's", () => {
  const t: PatientTimeline = { study: "s", patient: "P-1", events: EVENTS, samples: [{ id: "P-1-T02", type: "Primary" }], source: { label: "local", remote: false } };
  const { layout } = timelineSvg(t, { width: 900, interactive: true });
  const r = layout.rows;
  assert.ok(r.length > 2);
  assert.equal(rowAt(layout, r[0].y), 0);
  assert.equal(rowAt(layout, r[0].y + r[0].h - 0.5), 0);
  assert.equal(rowAt(layout, r[0].y + r[0].h), 1, "the next row starts where one ends");
  assert.equal(rowAt(layout, r[r.length - 1].y + r[r.length - 1].h / 2), r.length - 1);
  assert.equal(rowAt(layout, r[0].y - 1), null, "the axis above the rows");
  assert.equal(rowAt(layout, r[r.length - 1].y + r[r.length - 1].h + 1), null, "below the last row");
});
