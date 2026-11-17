// The cancertypes view's runner (lib/views/cancertypes/run.ts), driven with a hand-made participant:
// the order of the groups (by share when frequencies are drawn, by count when counts are), the
// results text's unit, the default category (D*) and the study labels (L*) — the case table's rows,
// from cbioportal-frontend cd8c6df CancerSummaryContainer.tsx groupAlterationsBy / mapStudyIdToName
// and FormatUtils.tsx shortenStudyName.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCancertypes, shortStudyName } from "../lib/views/cancertypes/run.ts";
import { cancertypesKind } from "../lib/views/cancertypes/kind.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
const ALL = "\x01all";
const grp = (grp: string, profiled: number, altered: number): Row =>
  ({ gene: "*", grp, label: grp, profiled, altered, mutation: altered, amp: 0, homdel: 0, sv: 0, multiple: 0 });
// Small: 4 of 10 altered (40%); Large: 30 of 300 (10%); Mid: 20 of 50 (40%)
const ROWS: Row[] = [grp("Small", 10, 4), grp("Large", 300, 30), grp("Mid", 50, 20),
  { gene: "*", grp: ALL, profiled: 360, altered: 54 }];
const TOT: Row[] = [{ grp: "Small", samples: 10, mut: 10, cna: 0, sv: 0 }, { grp: "Large", samples: 300, mut: 300, cna: 0, sv: 0 },
  { grp: "Mid", samples: 50, mut: 50, cna: 0, sv: 0 }, { grp: ALL, samples: 360 }];

function ctx(): ViewRun {
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "SELECT 1", count: 360, samples: 360, mode: "patient-level" } },
    count: 360, samples: 360, text: "" } as never;
  const site = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string) => label.startsWith("cancertypes:samples:") ? TOT : ROWS,
  };
  return {
    doc: { study: "s1", cohorts: { A: { study: "s1" } }, views: [] } as never,
    cohorts: { A: cohort }, resolvers: { s1: site } as never, vNames: ["A"], vStudies: ["s1"],
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = (view: Record<string, unknown>) => runCancertypes({ kind: "cancertypes", genes: ["KRAS"], minSamples: 1, ...view } as never, ctx());
const order = (r: ViewResult) => (r as unknown as { cancertypes: { panels: { groups: { key: string }[] }[] } }).cancertypes.panels[0].groups.map((g) => g.key);
const text = (r: ViewResult) => {
  const out: string[] = [];
  cancertypesKind.text!(r as never, { out, caveatOf: () => "", noteOf: () => "" } as never);
  return out.join("\n");
};

describe("cancertypes: bar order and unit", () => {
  test("frequencies: highest share first, ties by more profiled", async () => {
    assert.deepEqual(order(await run({})), ["Mid", "Small", "Large"]);
  });
  test("absolute counts: highest count first (CTS-SO-2)", async () => {
    assert.deepEqual(order(await run({ show: "count" })), ["Large", "Mid", "Small"]);
  });
  test("the results text names the unit counted", async () => {
    const p = text(await run({}));
    assert.match(p, /patients profiled for at least one gene/);
    assert.match(p, /54 of 360 profiled patients altered/);
    assert.doesNotMatch(p, /samples/);
    assert.match(text(await run({ unit: "sample" })), /54 of 360 profiled samples altered/);
  });
});

// ---- D: the default category, and L: the study labels -------------------------------------------
/** what the fake participants were asked: each query's label and the SQL its builder wrote for study s */
type Asked = { label: string; sql: string }[];
const LONG = "Pan-Lung Cancer Integrated Genomic Characterization Study"; // 57 characters, no "("
const LONG_PAREN = LONG + " (TCGA, Nat Genet 2016)"; // "(" at index 58
const SHORT_PAREN = "Lung Adenocarcinoma (TCGA, Firehose Legacy)"; // "(" at index 20
/** a default pre-query's rows: one group per cancer type given, plus the whole cohort */
const typesRows = (types: string[]): Row[] => [...types.map((t) => ({ grp: t, samples: 5, mut: 5, cna: 0, sv: 0 })),
  { grp: ALL, samples: 5 * types.length, mut: 5 * types.length, cna: 0, sv: 0 }];

/**
 * A view's context: `cohorts` maps each cohort to its studies, `defaults` each cohort to the cancer
 * types its "cancertypes:default:" query returns, `names` each study to the name its SQL returns
 * as a by-study group's label. Main queries answer ROWS/TOT, or, grouped by study (no attribute in
 * the SQL), one group per study keyed by its id; `empty` answers nothing profiled.
 */
function ctxOf(o: { cohorts: Record<string, string[]>; defaults?: Record<string, string[]>; names?: Record<string, string>; empty?: boolean }, asked: Asked): ViewRun {
  const studies = [...new Set(Object.values(o.cohorts).flat())];
  const cohorts: Record<string, EvaluatedCohort> = {};
  for (const [n, sts] of Object.entries(o.cohorts))
    cohorts[n] = { studies: sts, perStudy: Object.fromEntries(sts.map((s) => [s, { sql: "SELECT 1", count: 360, samples: 360, mode: "patient-level" }])),
      count: 360, samples: 360, text: "" } as never;
  const site = (study: string) => ({
    instance: { id: "local-" + study, mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string, def: { cohort?: string }, build: (c: string, s: string, d: string) => string) => {
      const sql = String(build("SELECT 1", study, "db"));
      asked.push({ label, sql });
      if (label.startsWith("cancertypes:default:")) return typesRows(o.defaults?.[label.slice("cancertypes:default:".length)] ?? []);
      if (o.empty) return label.startsWith("cancertypes:samples:") ? [{ grp: ALL, samples: 0, mut: 0, cna: 0, sv: 0 }] : [{ gene: "*", grp: ALL, profiled: 0, altered: 0 }];
      const byStudy = !/attribute_name/.test(sql);
      if (!byStudy) return label.startsWith("cancertypes:samples:") ? TOT : ROWS;
      return label.startsWith("cancertypes:samples:")
        ? [{ grp: study, label: o.names?.[study] ?? study, samples: 20, mut: 20, cna: 0, sv: 0 }, { grp: ALL, label: "", samples: 20, mut: 20, cna: 0, sv: 0 }]
        : [{ ...grp(study, 20, 5), label: o.names?.[study] ?? study }, { gene: "*", grp: ALL, profiled: 20, altered: 5 }];
    },
  });
  return {
    doc: { study: studies[0], cohorts: Object.fromEntries(Object.entries(o.cohorts).map(([n, sts]) => [n, { study: sts[0] }])), views: [] } as never,
    cohorts, resolvers: Object.fromEntries(studies.map((s) => [s, site(s)])) as never, vNames: Object.keys(o.cohorts), vStudies: studies,
    participationFor: (sts: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: sts.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const runOn = (o: Parameters<typeof ctxOf>[0], view: Record<string, unknown> = {}) => {
  const asked: Asked = [];
  return runCancertypes({ kind: "cancertypes", genes: ["KRAS"], minSamples: 1, ...view } as never, ctxOf(o, asked)).then((r) => ({ r, asked }));
};
type CtResult = { error?: string; cancertypes?: { groupBy: string; panels: { groups: { key: string; label: string }[] }[] } };
const groupByOf = (r: ViewResult) => (r as unknown as CtResult).cancertypes?.groupBy;
const preQueries = (asked: Asked) => asked.filter((a) => a.label.startsWith("cancertypes:default:")).map((a) => a.label).sort();
/** the attribute the main queries were built with, read from the SQL the builders wrote */
const mainAttribute = (asked: Asked) => [...new Set(asked.filter((a) => !a.label.startsWith("cancertypes:default:"))
  .map((a) => /'CANCER_TYPE_DETAILED'/.test(a.sql) ? "CANCER_TYPE_DETAILED" : /'CANCER_TYPE'/.test(a.sql) ? "CANCER_TYPE" : /attribute_name/.test(a.sql) ? "other" : "study"))];

describe("cancertypes: the default category (CTS-CT-2, CTS-MD-2)", () => {
  test("D1 cohorts spanning two studies group by study, with no default pre-query", async () => {
    const { r, asked } = await runOn({ cohorts: { A: ["s1", "s2"] } });
    assert.equal((r as unknown as CtResult).error, undefined);
    assert.equal(groupByOf(r), "study");
    assert.deepEqual(preQueries(asked), []);
    assert.deepEqual(mainAttribute(asked), ["study"]);
  });
  test("D2 one study whose samples have one cancer type: CANCER_TYPE_DETAILED", async () => {
    const { r, asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["non-small cell lung cancer"] } });
    assert.equal(groupByOf(r), "CANCER_TYPE_DETAILED");
    assert.deepEqual(preQueries(asked), ["cancertypes:default:A"]);
    assert.deepEqual(mainAttribute(asked), ["CANCER_TYPE_DETAILED"]);
  });
  test("D2 the pre-query groups by CANCER_TYPE", async () => {
    const { asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["non-small cell lung cancer"] } });
    const pre = asked.filter((a) => a.label === "cancertypes:default:A");
    assert.equal(pre.length, 1);
    assert.match(pre[0].sql, /'CANCER_TYPE'/);
    assert.doesNotMatch(pre[0].sql, /'CANCER_TYPE_DETAILED'/);
  });
  test("D3 one study, two cancer types: CANCER_TYPE", async () => {
    const { r, asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["non-small cell lung cancer", "lung cancer"] } });
    assert.equal(groupByOf(r), "CANCER_TYPE");
    assert.deepEqual(preQueries(asked), ["cancertypes:default:A"]);
    assert.deepEqual(mainAttribute(asked), ["CANCER_TYPE"]);
  });
  test("D4 groupBy given is used as given, with no pre-query", async () => {
    for (const groupBy of ["CANCER_TYPE", "CANCER_TYPE_DETAILED", "TUMOR_GRADE", "study"]) {
      const { r, asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["one type"] } }, { groupBy });
      assert.equal(groupByOf(r), groupBy, groupBy);
      assert.deepEqual(preQueries(asked), [], groupBy);
    }
    const { r, asked } = await runOn({ cohorts: { A: ["s1", "s2"] } }, { groupBy: "CANCER_TYPE" });
    assert.equal(groupByOf(r), "CANCER_TYPE", "two studies, groupBy given");
    assert.deepEqual(preQueries(asked), []);
  });
  test("D5 two cohorts of one study, one type each but different: CANCER_TYPE (distinct over both)", async () => {
    const { r, asked } = await runOn({ cohorts: { A: ["s1"], B: ["s1"] }, defaults: { A: ["luad type"], B: ["lusc type"] } });
    assert.equal(groupByOf(r), "CANCER_TYPE");
    assert.deepEqual(preQueries(asked), ["cancertypes:default:A", "cancertypes:default:B"]);
  });
  test("D5 two cohorts of one study, the same one type: CANCER_TYPE_DETAILED", async () => {
    const { r } = await runOn({ cohorts: { A: ["s1"], B: ["s1"] }, defaults: { A: ["luad type"], B: ["luad type"] } });
    assert.equal(groupByOf(r), "CANCER_TYPE_DETAILED");
  });
  test("D6 one study, a cohort with no samples: CANCER_TYPE (legacy wants exactly one type for the detailed one), then refused as before", async () => {
    const { r, asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: [] }, empty: true });
    assert.match(String((r as unknown as CtResult).error), /no patient in this cohort was profiled/);
    assert.deepEqual(preQueries(asked), ["cancertypes:default:A"]);
    assert.deepEqual(mainAttribute(asked), ["CANCER_TYPE"]);
  });
});

describe("cancertypes: study labels (CTS-CH-8)", () => {
  test("L2a a \"(\" past index 50: the first 49 characters, \"...\", then from the \"(\" on", () => {
    assert.equal(shortStudyName(LONG_PAREN), LONG.slice(0, 49) + "..." + "(TCGA, Nat Genet 2016)");
    const at51 = "x".repeat(51) + "(MSK, 2020)";
    assert.equal(shortStudyName(at51), "x".repeat(49) + "...(MSK, 2020)");
  });
  test("L2b a \"(\" at index 50 or before: unchanged", () => {
    const at50 = "x".repeat(50) + "(MSK, 2020)";
    assert.equal(shortStudyName(at50), at50);
    assert.equal(shortStudyName(SHORT_PAREN), SHORT_PAREN);
  });
  test("L2c no \"(\": unchanged, however long", () => {
    assert.equal(shortStudyName(LONG), LONG);
    assert.equal(shortStudyName("y".repeat(120)), "y".repeat(120));
  });
  test("L1 grouped by study: each group keyed by the study id, labelled with its name through shortStudyName", async () => {
    const { r } = await runOn({ cohorts: { A: ["s1", "s2"] }, names: { s1: LONG_PAREN, s2: SHORT_PAREN } }, { groupBy: "study" });
    const groups = (r as unknown as CtResult).cancertypes!.panels[0].groups.map((g) => [g.key, g.label]).sort();
    assert.deepEqual(groups, [["s1", LONG.slice(0, 49) + "...(TCGA, Nat Genet 2016)"], ["s2", SHORT_PAREN]]);
  });
});

// ---- what review asked of the default category ----------------------------------------------------
type Method = { method?: { steps: { title: string; detail: string }[] } };
const steps = (r: ViewResult) => ((r as unknown as Method).method?.steps || []);

describe("cancertypes: the default category, as the method record and the queries state it", () => {
  test("an empty groupBy is no category: the portal's default, not a refusal", async () => {
    const { r } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["luad"] } }, { groupBy: "  " });
    assert.equal((r as unknown as CtResult).error, undefined);
    assert.equal(groupByOf(r), "CANCER_TYPE_DETAILED");
  });
  test("the default reached by CANCER_TYPE reuses its per-group samples answer: no second samples query", async () => {
    const { r, asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["luad", "brca"] } });
    assert.equal(groupByOf(r), "CANCER_TYPE");
    assert.deepEqual(asked.filter((a) => a.label.startsWith("cancertypes:samples:")), []);
  });
  test("a default reached by CANCER_TYPE_DETAILED still asks for its own samples", async () => {
    const { asked } = await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["luad"] } });
    assert.deepEqual(asked.filter((a) => a.label.startsWith("cancertypes:samples:")).map((a) => a.label), ["cancertypes:samples:A"]);
  });
  test("the method record states the rule, the count it read and the category chosen", async () => {
    const one = steps((await runOn({ cohorts: { A: ["s1"] }, defaults: { A: ["luad"] } })).r);
    const choose = one.find((s) => s.title === "Choose the category");
    assert.ok(choose, JSON.stringify(one.map((s) => s.title)));
    assert.match(choose!.detail, /counts 1 distinct CANCER_TYPE value: grouped by CANCER_TYPE_DETAILED/);
    const two = steps((await runOn({ cohorts: { A: ["s1", "s2"] } })).r);
    assert.match(two.find((s) => s.title === "Choose the category")!.detail, /2 studies: grouped by study/);
    assert.equal(steps((await runOn({ cohorts: { A: ["s1"] } }, { groupBy: "CANCER_TYPE" })).r).some((s) => s.title === "Choose the category"), false);
  });
  test("the method record states how a sample without a cancer type is grouped", async () => {
    const detail = (r: ViewResult) => steps(r).map((s) => s.detail).join(" ");
    assert.match(detail((await runOn({ cohorts: { A: ["s1"] } }, { groupBy: "CANCER_TYPE" })).r), /without a CANCER_TYPE takes its study's type of cancer/);
    assert.match(detail((await runOn({ cohorts: { A: ["s1"] } }, { groupBy: "CANCER_TYPE_DETAILED" })).r), /without a CANCER_TYPE_DETAILED takes its CANCER_TYPE, else its study's type of cancer/);
    assert.doesNotMatch(detail((await runOn({ cohorts: { A: ["s1"] } }, { groupBy: "TUMOR_GRADE" })).r), /type of cancer/);
  });
});
