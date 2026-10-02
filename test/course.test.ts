// Clinical-course semantics: name folding, bin arithmetic, and the SQL shape
// that carries the honest bits. No database needed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canonicalEventName, foldEventNames, foldNote } from "../lib/event-names.ts";
import { eventCourseSql, timelineSpanSql, sequenceSql, sequenceKeysSql } from "../lib/federation.ts";

const cohortSql = "SELECT DISTINCT replaceOne(patient_unique_id, 'x_', '') AS pid FROM db.sample_derived";
const course = (o: Partial<Parameters<typeof eventCourseSql>[3]> = {}) =>
  eventCourseSql(cohortSql, "x", "db", {
    anchor: { eventType: "Treatment", occurrence: "FIRST" },
    eventTypes: ["treatment"], binMonths: 3, from: -4, to: 20, ...o
  } as Parameters<typeof eventCourseSql>[3]);

describe("event-name folding: case and whitespace, and nothing else", () => {
  test("folds case", () => {
    assert.equal(canonicalEventName("Treatment"), "treatment");
    assert.equal(canonicalEventName("TREATMENT"), "treatment");
    assert.equal(canonicalEventName("Sample Acquisition"), "sample acquisition");
  });

  test("trims whitespace — 'xrt ' vs 'xrt' is a data-entry artifact, not a name", () => {
    assert.equal(canonicalEventName("  xrt  "), "xrt");
    assert.equal(canonicalEventName("xrt "), canonicalEventName("xrt"));
  });

  test("does NOT merge across separators or word forms", () => {
    // Measured: zero event_type or key pairs differ only by a separator, so
    // there is nothing for a cleverer rule to catch — and a cleverer rule is one
    // step from merging 'Targeted Therapy' with 'Targeted Molecular Therapy'.
    assert.notEqual(canonicalEventName("beta blocker"), canonicalEventName("beta-blocker"));
    assert.notEqual(canonicalEventName("Procedure"), canonicalEventName("Procedures"));
    assert.notEqual(canonicalEventName("Lab Test"), canonicalEventName("Lab_Test"));
  });

  test("groups variants and labels with the most frequent spelling", () => {
    const f = foldEventNames([
      { name: "TREATMENT", n: 10 }, { name: "Treatment", n: 87 }, { name: "Surgery", n: 15 }
    ]);
    assert.equal(f.length, 2);
    assert.equal(f[0].canonical, "treatment");
    assert.equal(f[0].label, "Treatment", "label should be the commonest spelling, not the canonical one");
    assert.equal(f[0].n, 97, "weights sum across variants");
    assert.deepEqual(f[0].variants, ["Treatment", "TREATMENT"]);
  });

  test("the fold is disclosed, never silent", () => {
    const folded = foldEventNames([{ name: "Treatment", n: 87 }, { name: "TREATMENT", n: 10 }]);
    const note = foldNote(folded);
    assert.match(note, /Treatment = TREATMENT/);
    assert.match(note, /No other spelling differences were merged/);
    // nothing folded -> nothing claimed
    assert.equal(foldNote(foldEventNames([{ name: "Surgery", n: 3 }])), "");
  });

  test("empty and junk names are dropped rather than forming a blank group", () => {
    assert.deepEqual(foldEventNames([{ name: "   ", n: 5 }, { name: "", n: 2 }]), []);
  });
});

describe("bin arithmetic is half-open [t, t+w)", () => {
  // The bug this exists to prevent: with CLOSED bins the anchoring treatment
  // itself overlaps the bin BEFORE the anchor, and the chart reports 100% of the
  // cohort already on treatment before their first treatment. Verified against
  // msk_chord_2024: bin -1 reads 0%, where the closed-bin prototype read 100%.
  test("uses floor(), which is what makes the interval half-open", () => {
    const sql = course();
    assert.match(sql, /floor\(\(/, "bin index must be a floor division");
    assert.ok(!/round\(\(/.test(sql), "round() would straddle the boundary in both directions");
  });

  test("a span's bins are a range from its first bin to its last, inclusive", () => {
    const sql = course();
    assert.match(sql, /range\(/);
    assert.match(sql, /\)\s*\+ 1\)/, "the upper bound is exclusive, so the last bin needs +1");
  });

  test("the window clamps the range, so a far-off anchor cannot explode it", () => {
    // msk_met_2021 anchors ~6,266 days out; without clamping that is 2,000+ bins.
    const sql = course({ from: -4, to: 20 });
    assert.match(sql, /greatest\(floor\(\(.+?\), -4\)/s);
    assert.match(sql, /least\(floor\(\(.+?\), 20\)/s);
  });

  test("point and interval events go through ONE formula", () => {
    // stop_date null or equal collapses to s == e, so there is no second path
    // that could drift from the first.
    assert.match(course(), /coalesce\(ce\.stop_date, ce\.start_date\)/);
  });
});

describe("the course query carries its honest parts", () => {
  test("the denominator is an observation window, not the cohort size", () => {
    const sql = course();
    assert.match(sql, /denom AS/);
    assert.match(sql, /obs AS/);
    assert.match(sql, /OS_MONTHS/, "last contact extends to OS follow-up where declared");
    assert.match(sql, /greatest\(toFloat64\(sp\.last_ev\)/,
      "last contact is the LATER of last event and OS follow-up");
  });

  test("at-risk rows are distinguishable from state rows", () => {
    assert.match(course(), /'' AS et/);
  });

  test("event types match case-insensitively, because the fold is not a rewrite", () => {
    // The database stores 'Treatment' and 'TREATMENT' as distinct literals; a
    // canonical name must therefore match at the column, not by equality.
    const sql = course({ eventTypes: ["TREATMENT"] });
    assert.match(sql, /lowerUTF8\(trimBoth\(ce\.event_type\)\)/);
    assert.match(sql, /'treatment'/, "the canonical form is what gets matched");
  });

  test("anchoring on FIRST vs LAST changes the aggregate, not the shape", () => {
    assert.match(course({ anchor: { eventType: "Treatment", occurrence: "FIRST" } }), /min\(ce\.start_date\)/);
    assert.match(course({ anchor: { eventType: "Treatment", occurrence: "LAST" } }), /max\(ce\.start_date\)/);
  });

  test("without an anchor every patient aligns on day 0", () => {
    const sql = course({ anchor: null });
    assert.match(sql, /CAST\(0 AS Int64\) AS day/);
  });

  test("an anchor attribute narrows by key AND value", () => {
    const sql = course({ anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "FIRST" } });
    assert.match(sql, /lowerUTF8\(trimBoth\(key\)\) = lowerUTF8\(trimBoth\('SUBTYPE'\)\)/, "the key is folded like any other name");
    assert.match(sql, /lowerUTF8\(trimBoth\(value\)\) = lowerUTF8\(trimBoth\('Chemo'\)\)/, "and so is the value, on both sides, in SQL");
  });
});

describe("the course query refuses what it cannot answer", () => {
  test("no event types is an error, not an empty chart", () => {
    assert.throws(() => course({ eventTypes: [] }), /at least one event type/);
  });

  test("an inverted window is an error", () => {
    assert.throws(() => course({ from: 10, to: 2 }), /bad course window/);
  });

  test("duplicate spellings collapse to one measured type", () => {
    // Anchor on something else so the count isolates the measured IN-list.
    const sql = course({ anchor: { eventType: "Surgery", occurrence: "FIRST" },
      eventTypes: ["Treatment", "TREATMENT", "treatment "] });
    const inList = sql.slice(sql.indexOf("lowerUTF8(trimBoth(ce.event_type)) IN ("));
    assert.equal((inList.match(/'treatment'/g) || []).length, 1,
      "three spellings of one concept must not become three IN-list entries");
  });
});

describe("timelineSpan reports structure, which is what picks the measure", () => {
  test("counts interval events separately, so band-vs-mark never reads a name", () => {
    const sql = timelineSpanSql(cohortSql, "x", "db");
    assert.match(sql, /countIf\(ce\.stop_date IS NOT NULL AND ce\.stop_date != ce\.start_date\)/);
  });

  test("reports distinct days, which is what the degenerate gate tests", () => {
    // 17 of the 131 studies with timeline rows put every event on one day.
    assert.match(timelineSpanSql(cohortSql, "x", "db"), /uniqExact\(ce\.start_date\) AS days/);
  });
});

describe("treatment sequences: lines, not records", () => {
  const seq = (o: Partial<Parameters<typeof sequenceSql>[3]> = {}) =>
    sequenceSql(cohortSql, "x", "db", {
      eventType: "Treatment", labelKey: "SUBTYPE", exclude: [], lineGap: 90, maxSteps: 3, ...o
    } as Parameters<typeof sequenceSql>[3]);

  test("groups records into lines by a gap, not one line per record", () => {
    // A patient has a median of 6 treatment records and 4 agents; combination
    // therapy is several records describing ONE decision.
    const sql = seq({ lineGap: 60 });
    assert.match(sql, /s > pms \+ 60/, "the gap threshold starts a new line");
    assert.match(sql, /line_no/);
  });

  test("a line is its sorted combination, so A+B and B+A are one regimen", () => {
    assert.match(seq(), /arrayStringConcat\(arraySort\(groupUniqArrayIf\(lbl, lbl != ''\)\), ' \+ '\)/);
  });

  test("patients who start no further line are kept as an explicit terminal", () => {
    // Attrition is usually the LARGEST flow; a diagram that drops it lies.
    const sql = seq();
    assert.match(sql, /leadInFrame\(combo\)/);
    assert.match(sql, /nxt AS b/);
  });

  test("a path that ends is classified as observed-stop vs censored", () => {
    // Measured on msk_chord_2024: 68% of patients have under 3 months of
    // follow-up after their last therapy, median 15 days. Merging those with
    // genuine stops turns record-keeping into an apparent clinical decision.
    const sql = seq({ lineGap: 90 });
    assert.match(sql, /AS fate/);
    assert.match(sql, /last_seen[\s\S]*?- sq2\.line_end >= 90/,
      "ruling out a further line needs at least one line gap of observation");
    assert.match(sql, /GROUP BY step, a, b, fate/);
  });

  test("the censoring threshold follows lineGap, not a separate constant", () => {
    // A new line is defined by a gap greater than lineGap, so ruling one out
    // needs exactly that much watching. Two constants could disagree.
    assert.match(seq({ lineGap: 45 }), /- sq2\.line_end >= 45/);
    assert.match(seq({ lineGap: 180 }), /- sq2\.line_end >= 180/);
  });

  test("observation counts ANY event type, not just therapy", () => {
    // A patient seen for imaging two years later was genuinely watched, even
    // though they had no further treatment record.
    const sql = seq();
    assert.match(sql, /seen AS/);
    assert.match(sql, /OS_MONTHS/, "and OS follow-up extends it further");
  });

  test("leadInFrame gets an explicit unbounded frame", () => {
    // The default window frame ends at the current row, so leadInFrame would
    // return the default value and every patient would look like they stopped.
    assert.match(seq(), /ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING/);
  });

  test("exclusions are applied, folded like every other name and value", () => {
    const sql = seq({ exclude: ["Prior Medications to MSK", "Bone Treatment"] });
    assert.match(sql, /NOT IN \(lowerUTF8\(trimBoth\('Prior Medications to MSK'\)\), lowerUTF8\(trimBoth\('Bone Treatment'\)\)\)/,
      "'BONE TREATMENT' in another study is the same value, so it is excluded too");
  });

  test("no exclusions means no exclusion clause at all", () => {
    assert.equal(/NOT IN \(/.test(seq({ exclude: [] })), false);
  });

  test("the label key is folded like any other name, the event type too", () => {
    const sql = seq({ labelKey: "Agent", eventType: "TREATMENT" });
    assert.match(sql, /lowerUTF8\(trimBoth\(d\.key\)\) = lowerUTF8\(trimBoth\('agent'\)\)/);
    assert.match(sql, /lowerUTF8\(trimBoth\(ce\.event_type\)\) = lowerUTF8\(trimBoth\('TREATMENT'\)\)/);
  });

  test("a missing labelKey is refused rather than guessed", () => {
    assert.throws(() => seq({ labelKey: "" }), /needs a labelKey/);
  });

  test("a blank label is not a regimen: a line with none is named for what is missing", () => {
    const sql = seq({ labelKey: "Agent" });
    assert.match(sql, /groupUniqArrayIf\(lbl, lbl != ''\)/);
    assert.match(sql, /'\(no AGENT\)'/);
  });

  test("sequenceKeys reports what COULD label a line, for the error path", () => {
    const sql = sequenceKeysSql(cohortSql, "x", "db", "Treatment");
    assert.match(sql, /uniqExact\(lowerUTF8\(trimBoth\(d\.value\)\)\) AS values/,
      "the value count is what tells a reader whether a key is a usable granularity");
  });
});
