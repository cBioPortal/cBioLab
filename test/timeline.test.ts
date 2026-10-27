// The timeline view's track model (lib/timeline-tracks.ts) — the rules it takes from cBioPortal's
// patient-view timeline — and the figure's promises about what it draws (lib/timeline-svg.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTracks, flattenTracks, sampleMarks, numericResult, axisTicks, dayScale, formatDays, yearLabel } from "../lib/timeline-tracks.ts";
import { timelineSvg, timelineSummary } from "../lib/timeline-svg.ts";
import { patientEventsSql, timelinePatientRowSource } from "../lib/patient-timeline.ts";
import { pageSql, rankSql } from "../lib/table-query.ts";
import type { PatientEvent, PatientTimeline } from "../lib/types.ts";

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
    assert.deepEqual(tracks.map((t) => t.label), ["Sample acquisition", "Surgery", "Status", "Treatment", "Lab_Test"]);
    // TREATMENT and Treatment are one track, labelled with the commoner spelling
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
