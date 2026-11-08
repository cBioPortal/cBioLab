// The assays view (lib/views/assays/): every entity of one generic-assay profile compared between
// cohorts — Welch's t for two cohorts and Welch's ANOVA for more on numeric profiles, chi-squared on
// cohort × value for categorical ones, Benjamini–Hochberg across the entities — driven with
// hand-made participants whose answers are counts and moments, and its figures.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runAssays } from "../lib/views/assays/run.ts";
import { assaysSvg, assayEntitySvg, valueColors } from "../lib/views/assays/figure.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { AssaysResult, AssaysView } from "../lib/views/assays/types.ts";
import { palette } from "../lib/svg-kit.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
const PT = "sigs";
const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
/** n, Σv, Σv² of `vals`, as a moments row */
const mom = (entity: string, vals: number[], other = 0): Row =>
  ({ entity, n: vals.length, sx: vals.reduce((a, b) => a + b, 0), sxx: vals.reduce((a, b) => a + b * b, 0), other });

interface SiteOpts { meta?: Row; names?: Row[]; rows: Record<string, Row[]>; entities?: number; asked?: string[] }
/** a local participant: its profile's metadata, entity names (and how many it has), and per cohort its moments or value counts */
const site = (o: SiteOpts) => ({
  instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
  viewMeta: async (label: string, build: (s: string, d: string) => unknown) => {
    o.asked?.push(label, String(build("s", "db")));
    return label === "assays:profile" ? (o.meta ? [o.meta] : []) : label === "assays:entities" ? [{ n: o.entities ?? 0 }] : (o.names ?? []);
  },
  viewAggregate: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => unknown) => {
    build("SELECT 'p' AS patient_id", "s", "db");
    return o.rows[label.split(":").pop()!] ?? [];
  },
  viewAggregateMany: async () => [],
});
const remote = () => ({ instance: { id: "peer", mode: "aggregate-only", label: "peer", conn: PRIMARY } });

function ctx(cohorts: Record<string, EvaluatedCohort>, resolvers: Record<string, unknown>, ga: Record<string, string[]> = {}): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: resolvers as never, vNames, vStudies,
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async (st: string) => ({ profiles: [], gaProfiles: ga[st] ?? [PT] }),
  };
}
const NUM = { generic_assay_type: "MUTATIONAL_SIGNATURE", datatype: "LIMIT-VALUE", patient_level: 0, name: "Mutational signatures" };
const CAT = { generic_assay_type: "ARMLEVEL_CNA", datatype: "CATEGORICAL", patient_level: 0, name: "Arm-level CNA" };
const v = (o: Partial<AssaysView> = {}): AssaysView => ({ kind: "assays", profileType: PT, ...o });
const two = (s: Record<string, unknown>) => ctx({ A: cohort({ s1: 10 }), B: cohort({ s1: 10 }) }, s);
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + " ≉ " + b);
const res = (r: ViewResult) => { assert.equal(r.error, undefined, String(r.error)); return (r as ViewResult & { assays: AssaysResult }).assays; };

/** two-sided p of Student's t with 4 degrees of freedom, in closed form (Abramowitz & Stegun 26.7.4) */
const pT4 = (t: number) => { const th = Math.atan(Math.abs(t) / 2); return 1 - Math.sin(th) * (1 + Math.cos(th) ** 2 / 2); };
/** two-sided p of a 1-df chi-squared: P(|Z| > √χ²) */
const pChi1 = (x: number) => 2 * (1 - normalCdf(Math.sqrt(x)));
function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 is too coarse; integrate the density by Simpson's rule instead
  const n = 2000, h = z / n; let s = 0;
  for (let i = 0; i <= n; i++) { const x = i * h, w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2; s += w * Math.exp(-x * x / 2); }
  return 0.5 + s * h / 3 / Math.sqrt(2 * Math.PI);
}

describe("assays: what it refuses", () => {
  const s1 = site({ meta: NUM, rows: {} });
  const refusal = async (view: AssaysView, c: ViewRun) => (await runAssays(view, c)).error!;

  test("too few or too many cohorts, a malformed profile, minN or label out of range, an empty cohort", async () => {
    assert.match(await refusal(v(), ctx({ A: cohort({ s1: 1 }) }, { s1 })), /two or more cohorts; this one draws 1/);
    const seven = Object.fromEntries("ABCDEFG".split("").map((n) => [n, cohort({ s1: 1 })]));
    assert.match(await refusal(v(), ctx(seven, { s1 })), /at most 6 cohorts/);
    assert.match(await refusal(v({ profileType: "bad name;" }), two({ s1 })), /profileType names a generic-assay profile/);
    assert.match(await refusal(v({ minN: 1 }), two({ s1 })), /minN is 2 to 10000/);
    assert.match(await refusal(v({ label: 41 }), two({ s1 })), /label is 0 to 40/);
    assert.match(await refusal(v(), ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 0 }) }, { s1 })), /nothing to compare: cohort “A” and “B” are empty/);
    assert.match(await refusal(v(), ctx({ A: cohort({ s1: 0 }), B: cohort({ s1: 2 }) }, { s1 })), /cohort “A” is empty/);
  });

  test("no study holds the profile: the profiles they do hold are listed, or none", async () => {
    assert.match(await refusal(v(), ctx({ A: cohort({ s1: 2 }), B: cohort({ s1: 2 }) }, { s1 }, { s1: ["zeta", "alpha"] })),
      /no study here has a generic-assay profile “sigs” — available: alpha, zeta/);
    assert.match(await refusal(v(), ctx({ A: cohort({ s1: 2 }), B: cohort({ s1: 2 }) }, { s1 }, { s1: [] })), /these studies have no generic-assay profiles/);
  });

  test("per-probe methylation past 25,000 probes is refused before any cohort is asked, naming a smaller profile; so is a profile numeric in one study and categorical in another", async () => {
    const asked: string[] = [];
    const big = site({ meta: { ...NUM, generic_assay_type: "METHYLATION" }, entities: 25001, rows: { A: [mom("cg1", [1, 2, 3])] }, asked });
    const probes = ctx({ A: cohort({ s1: 10 }), B: cohort({ s1: 10 }) }, { s1: big }, { s1: [PT, "methylation_hm27_hm450_merge", "armlevel_cna"] });
    assert.match(await refusal(v(), probes), /“sigs” has more than 25,000 probes in s1, more than this view compares — compare methylation_hm27_hm450_merge instead \(the PanCancer Atlas merged profile has the 22,601 probes/);
    // the count stops just past the limit, so a profile of hundreds of thousands of probes is not read through
    assert.match(asked[asked.indexOf("assays:entities") + 1], /SELECT DISTINCT entity_stable_id FROM db\.generic_assay_data_derived[\s\S]*LIMIT 25001\)/);
    const c = ctx({ A: cohort({ s1: 2, s2: 2 }), B: cohort({ s1: 2, s2: 2 }) }, { s1: site({ meta: CAT, rows: {} }), s2: site({ rows: {} }) });
    assert.match(await refusal(v(), c), /categorical in s1 and numeric in s2; compare one kind at a time/);
  });

  test("per-probe methylation within the limit is compared, its names asked only for the listed probes", async () => {
    const asked: string[] = [];
    const s1 = site({ meta: { ...NUM, generic_assay_type: "METHYLATION", name: "Methylation (HM27 and HM450 merge)" }, entities: 22601, asked,
      names: [{ entity: "cg1", name: "TP53;WRAP53" }], rows: { A: [mom("cg1", [0.1, 0.2, 0.15]), mom("cg2", [0.5, 0.6, 0.4])], B: [mom("cg1", [0.8, 0.9, 0.85]), mom("cg2", [0.5, 0.4, 0.6])] } });
    const r = res(await runAssays(v(), two({ s1 })));
    assert.equal(r.tested, 2);
    assert.deepEqual(r.rows.map((e) => [e.entity, e.name]), [["cg1", "TP53;WRAP53"], ["cg2", "cg2"]]);
    assert.match(asked[asked.indexOf("assays:names") + 1], /ge\.stable_id IN \('cg1','cg2'\)/);
  });

  test("no value at all, or more than 25,000 entities, or nothing testable", async () => {
    assert.match(await refusal(v(), two({ s1: site({ meta: NUM, rows: {} }) })), /none of these cohorts' samples has a value in “sigs”/);
    const many = Array.from({ length: 25001 }, (_, i) => mom("E" + i, [1, 2, 3]));
    assert.match(await refusal(v(), two({ s1: site({ meta: NUM, rows: { A: many } }) })), /has 25,001 entities with values here; an assays view compares at most 25,000/);
    assert.match(await refusal(v(), two({ s1: site({ meta: NUM, rows: { A: [mom("E", [1, 2])], B: [mom("E", [1, 2])] } }) })),
      /no entity of “sigs” had at least 3 samples with a value in every cohort and any spread/);
    assert.match(await refusal(v(), two({ s1: site({ meta: CAT, rows: { A: [{ entity: "1p", value: "Gain", n: 5 }], B: [{ entity: "1p", value: "Gain", n: 5 }] } }) })),
      /and two different values/);
  });
});

describe("assays: a numeric profile", () => {
  // E1: A 1,2,3 (mean 2, var 1), B 4,5,6 (mean 5, var 1): t = −3/√(1/3 + 1/3) = −3.674…, Welch df = 4
  // E2: A 1,2,3 and B 1,2,3: t = 0, p = 1
  // FLAT: every value 1 — no spread, not tested; FEW: B has two values < minN 3 — not tested
  // BH over the two tested: q(E1) = min(2·p1, 1), q(E2) = 1
  const rows = {
    A: [mom("E1", [1, 2, 3], 2), mom("E2", [1, 2, 3]), mom("FLAT", [1, 1, 1]), mom("FEW", [1, 2, 3])],
    B: [mom("E1", [4, 5, 6], 1), mom("E2", [1, 2, 3]), mom("FLAT", [1, 1, 1]), mom("FEW", [1, 5])],
  };
  const t1 = -3 / Math.sqrt(2 / 3), p1 = pT4(t1);

  test("Welch's t per entity, BH across the tested ones, the rest counted as untested", async () => {
    const r = res(await runAssays(v(), two({ s1: site({ meta: NUM, names: [{ entity: "E1", name: "Signature 1" }], rows }) })));
    assert.equal(r.datatype, "numeric");
    assert.equal(r.unit, "samples");
    assert.equal(r.test, "Welch's t-test");
    assert.deepEqual([r.tested, r.untested, r.missing], [2, 2, 3]);
    const [e1, e2] = r.rows;
    assert.equal(e1.entity, "E1");
    assert.equal(e1.name, "Signature 1", "an entity is shown by the name its study gives it");
    assert.equal(e2.name, "E2", "an entity with no name keeps its id");
    close(e1.statistic, t1, 1e-4); // the statistic is reported to 4 decimals
    close(e1.p, p1, 1e-6);
    close(e1.q, 2 * p1, 1e-6);
    assert.equal(e1.diff, -3);
    assert.equal(e1.higherIn, "B");
    assert.deepEqual(e1.cells, [{ cohort: "A", n: 3, mean: 2, sd: 1 }, { cohort: "B", n: 3, mean: 5, sd: 1 }]);
    close(e2.p, 1); assert.equal(e2.q, 1);
    assert.equal(r.significant, 1);
    assert.deepEqual(r.labels, ["E1"]);
    assert.ok(r.grid && r.grid.cells.length === 0, "with every entity in rows, the volcano's density grid is empty");
  });

  test("label caps how many significant entities are named; minN lowers the bar", async () => {
    const r = res(await runAssays(v({ label: 0, minN: 2 }), two({ s1: site({ meta: NUM, rows }) })));
    assert.deepEqual(r.labels, []);
    assert.equal(r.tested, 3, "FEW (2 values in B) is tested at minN 2");
    assert.equal(r.minN, 2);
  });

  test("moments add across studies; a study without the profile, and a remote peer, are named as left out", async () => {
    // A: s1 gives 1,2 and s2 gives 3 → 1,2,3; B: s1 gives 4 and s2 gives 5,6 → 4,5,6 — the same E1 as above
    const c = ctx({ A: cohort({ s1: 2, s2: 1, s3: 1, p: 1 }), B: cohort({ s1: 1, s2: 2 }) }, {
      s1: site({ meta: NUM, names: [{ entity: "E1", name: "first" }], rows: { A: [mom("E1", [1, 2])], B: [mom("E1", [4])] } }),
      s2: site({ meta: NUM, names: [{ entity: "E1", name: "second" }], rows: { A: [mom("E1", [3])], B: [mom("E1", [5, 6])] } }),
      s3: site({ meta: NUM, rows: {} }), p: remote(),
    }, { s1: [PT], s2: [PT], s3: ["other"] });
    const out = await runAssays(v(), c);
    const r = res(out);
    close(r.rows[0].statistic, t1, 1e-4);
    assert.equal(r.rows[0].name, "first", "the first study in the view's order names an entity");
    assert.deepEqual(r.excluded!.map((e) => e.study).sort(), ["p", "s3"]);
    assert.ok(r.excluded!.some((e) => e.study === "s3" && e.reason === "has no sigs profile"));
    assert.match(out.caveat!, /summed across 2 studies; overlap is not deduplicated/);
    assert.match(out.caveat!, /Left out: .*s3 \(has no sigs profile\)/);
    assert.deepEqual(out.studies, ["s1", "s2", "s3", "p"]);
  });

  test("three cohorts: Welch's ANOVA, highest mean named, no difference or volcano", async () => {
    // means 2, 5, 8, each n 3 and variance 1: w = 3 each, weighted mean 5, A = 3·(9 + 0 + 9)/2 = 27,
    // Σ(1 − w/W)²/(n − 1) = 3·(2/3)²/2 = 2/3, B = 1 + 2·(3 − 2)/(9 − 1)·(2/3) = 7/6, F = 27/(7/6)
    const c = ctx({ A: cohort({ s1: 3 }), B: cohort({ s1: 3 }), C: cohort({ s1: 3 }) },
      { s1: site({ meta: { ...NUM, patient_level: 1 }, rows: { A: [mom("E", [1, 2, 3])], B: [mom("E", [4, 5, 6])], C: [mom("E", [7, 8, 9])] } }) });
    const out = await runAssays(v(), c);
    const r = res(out);
    assert.equal(r.test, "Welch's ANOVA");
    assert.equal(r.unit, "patients", "a patient-level profile gives one value per patient");
    close(r.rows[0].statistic, 27 / (7 / 6), 1e-4);
    assert.equal(r.rows[0].higherIn, "C");
    assert.equal(r.rows[0].diff, undefined);
    assert.equal(r.grid, undefined);
    assert.match(out.caveat!, /from the patients owning each cohort's samples/);
  });

  test("past 300 tested entities the rest are summarised in the volcano's grid, every one of them counted", async () => {
    const A: Row[] = [], B: Row[] = [];
    for (let i = 0; i < 310; i++) { A.push(mom("E" + String(i).padStart(3, "0"), [1, 2, 3])); B.push(mom("E" + String(i).padStart(3, "0"), [1 + i / 100, 2 + i / 100, 3 + i / 100])); }
    const r = res(await runAssays(v(), two({ s1: site({ meta: NUM, rows: { A, B } }) })));
    assert.equal(r.tested, 310);
    assert.equal(r.rows.length, 300);
    assert.equal(r.grid!.cells.reduce((a, c) => a + c[2], 0), 10);
    for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].p <= r.rows[i].p, "rows are most significant first");
  });
});

describe("assays: a categorical profile", () => {
  // 1p: A Gain 6 Loss 2, B Gain 2 Loss 6: every expected count 4, χ² = 4 · (2²/4) = 4 on 1 df
  // A's Gain (and B's Loss) are furthest above independence: +2/√4 = 1; the first in order is named
  // 2q: a single value throughout — not tested; NA and blank are not called, and are counted apart
  const rows = {
    A: [{ entity: "1p", value: "Gain", n: 6 }, { entity: "1p", value: "Loss", n: 2 }, { entity: "2q", value: "Gain", n: 5 }, { entity: "1p", value: "NA", n: 3 }],
    B: [{ entity: "1p", value: "Gain", n: 2 }, { entity: "1p", value: "Loss", n: 6 }, { entity: "2q", value: "Gain", n: 5 }, { entity: "1p", value: " ", n: 1 }],
  };

  test("chi-squared on cohort × value, the most over-represented cell named, NA and blank left out", async () => {
    const out = await runAssays(v(), two({ s1: site({ meta: CAT, rows }) }));
    const r = res(out);
    assert.equal(r.datatype, "categorical");
    assert.equal(r.test, "Pearson chi-squared test (cohort × value)");
    assert.deepEqual([r.tested, r.untested, r.missing], [1, 1, 4]);
    const e = r.rows[0];
    close(e.statistic, 4, 1e-4);
    close(e.p, pChi1(4), 1e-6);
    assert.equal(e.higherIn, "A");
    assert.equal(e.value, "Gain");
    assert.deepEqual(e.cells, [{ cohort: "A", n: 8, values: { Gain: 6, Loss: 2 } }, { cohort: "B", n: 8, values: { Gain: 2, Loss: 6 } }]);
    assert.deepEqual(r.values, ["Gain", "Loss"], "values by frequency: Gain 18, Loss 8");
    assert.equal(r.grid, undefined);
    assert.match(out.caveat!, /Values NA or blank mean not called and are left out \(4 of them\)/);
  });
});

// ---- the figures --------------------------------------------------------------------------------

describe("assays: figures", () => {
  const numeric = async () => {
    const rows = { A: [mom("E1", [1, 2, 3]), mom("E2", [1, 2, 3])], B: [mom("E1", [4, 5, 6]), mom("E2", [1, 2, 4])] };
    return runAssays(v(), two({ s1: site({ meta: NUM, names: [{ entity: "E1", name: "SBS7 (UV)" }], rows }) }));
  };

  test("two numeric cohorts: a volcano beside the table when it fits, above it when it doesn't", async () => {
    const out = await numeric();
    const wide = assaysSvg(out as never, { width: 1200 });
    assert.match(wide, /2 Mutational signatures entities tested \(Welch's t-test\) · 0 at q &lt; 0.05|2 Mutational signatures entities tested/);
    assert.match(wide, /difference in mean \(A − B\)/);
    assert.match(wide, /SBS7 \(UV\)/);
    const narrow = assaysSvg(out as never, { width: 400, theme: "auto" });
    assert.match(narrow, /difference in mean/);
    assert.notEqual(wide, narrow);
  });

  test("more entities than the table holds: the rest are counted under it", async () => {
    const A: Row[] = [], B: Row[] = [];
    for (let i = 0; i < 20; i++) { A.push(mom("E" + i, [1, 2, 3])); B.push(mom("E" + i, [-1 - i, -2, 3])); }
    const out = await runAssays(v(), ctx({ A: cohort({ s1: 3 }), B: cohort({ s1: 3 }), C: cohort({ s1: 3 }) },
      { s1: site({ meta: NUM, rows: { A, B, C: A } }) }));
    const svg = assaysSvg(out as never, {});
    assert.match(svg, /\+2 more entities tested/, "18 rows drawn of 20");
    assert.doesNotMatch(svg, /difference in mean/, "three cohorts draw no volcano");
  });

  test("a categorical profile: a 100% bar per cohort, its values in a key", async () => {
    const rows = { A: [{ entity: "1p", value: "Gain", n: 6 }, { entity: "1p", value: "Loss", n: 2 }, { entity: "1p", value: "Neutral", n: 0 }],
      B: [{ entity: "1p", value: "Gain", n: 2 }, { entity: "1p", value: "Loss", n: 6 }] };
    const out = await runAssays(v(), two({ s1: site({ meta: CAT, rows }) }));
    const svg = assaysSvg(out as never, {});
    assert.match(svg, /<title>A: Gain 6\/8<\/title>/);
    assert.match(svg, /<title>B: Loss 6\/8<\/title>/);
    const r = (out as ViewResult & { assays: AssaysResult }).assays;
    const one = assayEntitySvg(r, r.rows[0], {});
    assert.match(one, /<title>Gain: 6 of 8<\/title>/);
    assert.match(one, /A \(n = 8\)/);
  });

  test("the picked numeric entity: mean ± SD, whiskers stopped at 0 (and at 1 for a contribution)", () => {
    const base = { profileType: PT, profileName: "Mutational signatures", assayType: "MUTATIONAL_SIGNATURE", datatype: "numeric", unit: "samples",
      groups: ["A", "B"], tested: 1, untested: 0, significant: 0, minN: 3, test: "Welch's t-test", missing: 0, rows: [], labels: [] } as unknown as AssaysResult;
    const row = (cells: AssaysResult["rows"][number]["cells"]) => ({ entity: "E", name: "E", cells, statistic: 0, p: 1, q: 1, higherIn: "A" });
    const share = assayEntitySvg(base, row([{ cohort: "A", n: 3, mean: 0.5, sd: 0.8 }, { cohort: "B", n: 3, mean: 0.1, sd: null }]));
    assert.match(share, /Whiskers stop at 0 and 1/);
    assert.match(share, /mean ± SD per sample/);
    const nonNeg = assayEntitySvg({ ...base, profileName: "Response", assayType: "TREATMENT_RESPONSE" }, row([{ cohort: "A", n: 3, mean: 5, sd: 1 }, { cohort: "B", n: 0, mean: null, sd: null }]));
    assert.match(nonNeg, /Whiskers stop at 0: the values cannot go below it/);
    assert.match(nonNeg, /no values/);
    const signed = assayEntitySvg({ ...base, unit: "patients" }, row([{ cohort: "A", n: 3, mean: -2, sd: 1 }, { cohort: "B", n: 3, mean: 3, sd: 1 }]), { width: 200, theme: "auto" });
    assert.doesNotMatch(signed, /Whiskers stop/);
    assert.match(signed, /per patient/);
  });

  test("value colours: gain takes amplification's, loss deletion's, a neutral value the rule colour, the rest series colours", () => {
    const p = palette("light");
    const m = valueColors(["Gain", "Loss", "Unchanged", "Other", "More"], p);
    assert.equal(m.get("Unchanged")!.color, p.line);
    const colours = [...m.values()].map((f) => f.color + f.opacity);
    assert.equal(new Set(colours).size, 5, "no two values alike");
    const plain = valueColors(["x", "y"], p);
    assert.notEqual(plain.get("x")!.color, plain.get("y")!.color);
  });
});
