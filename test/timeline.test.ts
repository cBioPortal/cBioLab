// The timeline view's track model (lib/timeline-tracks.ts) — the rules it takes from cBioPortal's
// patient-view timeline — and the figure's promises about what it draws (lib/timeline-svg.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTracks, flattenTracks, sampleMarks, sampleTipRows, numericResult, axisTicks, dayScale, formatDays, yearLabel, monthTicks, axisMarks, timelineAxisItems, MONTH, YEAR, type AxisMark, type AxisTick } from "../lib/timeline-tracks.ts";
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
