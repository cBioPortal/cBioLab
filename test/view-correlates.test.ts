// The correlates view's runner (lib/views/correlates/run.ts), driven with hand-made participants whose
// answers are the per-gene sums correlatesMomentsSql returns: one gene against every gene of a
// profile (or every entity of a numeric generic assay), ranked by Spearman's ρ with Pearson's r
// beside it, BH over ρ; one study's ρ from its rank sums, several studies' by Fisher z
// (lib/views/correlates/types.ts, method.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCorrelates } from "../lib/views/correlates/run.ts";
import { pearsonFromMoments, fisherZMeta, pearsonR, benjaminiHochberg } from "../lib/stats.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { CorrelatesResult, CorrelatesView } from "../lib/views/correlates/types.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;

/** average ranks (ties share the mean of their ranks), 1-based */
function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
/** the row correlatesMomentsSql returns for `gene`, from its paired values x (query gene) and y */
function sums(gene: string, x: number[], y: number[]): Row {
  const rx = ranks(x), ry = ranks(y);
  const s = (a: number[], b: number[]) => a.reduce((t, v, i) => t + v * b[i], 0);
  const one = x.map(() => 1);
  return { gene, n: x.length, sx: s(x, one), sy: s(y, one), sxy: s(x, y), sxx: s(x, x), syy: s(y, y),
    rsx: s(rx, one), rsy: s(ry, one), rsxy: s(rx, ry), rsxx: s(rx, rx), rsyy: s(ry, ry) };
}
const momentsOf = (r: Row, rank = false) => {
  const k = (n: string) => Number(r[(rank ? "r" : "") + n]);
  return { n: Number(r.n), sx: k("sx"), sy: k("sy"), sxy: k("sxy"), sxx: k("sxx"), syy: k("syy") };
};

const X = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** ESR1's values, and genes against it: UP rises with it (monotone, not linear), DOWN falls, NOISE wobbles, FLAT has no spread, FEW too few samples */
const STUDY_ROWS: Row[] = [
  sums("ESR1", X, X),
  sums("UP", X, X.map((x) => x * x)),
  sums("PGR", X, X.map((x, i) => x + (i % 3) - 1)),
  sums("DOWN", X, X.map((x) => -x * 2 + (x % 2))),
  sums("NOISE", X, [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8]),
  sums("FLAT", X, X.map(() => 7)),
  sums("FEW", X.slice(0, 5), [1, 2, 3, 4, 5]),
];

interface SiteOpts { profiles?: string[]; ga?: string[]; catalog?: Partial<ProfileInfo>[]; rows?: Row[]; entities?: number; names?: Row[]; bands?: Row[] | "fail" }
interface Site { r: unknown; labels: string[]; o: SiteOpts }
/** a local participant that answers the moments query with `rows`, and metadata by label */
function site(o: SiteOpts = {}): Site {
  const labels: string[] = [];
  const r = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string, _def: unknown, build: (c: string, s: string, d: string) => unknown) => {
      build("SELECT 's' AS sample_id", "s", "db"); labels.push(label);
      return o.rows ?? STUDY_ROWS;
    },
    viewMeta: async (label: string, build: (s: string, d: string) => unknown) => {
      build("s", "db"); labels.push(label);
      if (label === "correlates:entities") return [{ n: o.entities ?? 10 }];
      if (label === "correlates:names") return o.names ?? [];
      if (label === "cytobands") { if (o.bands === "fail") throw new Error("no"); return o.bands ?? [{ gene: "UP", cytoband: "1p36" }]; }
      return [];
    },
  };
  return { r, labels, o };
}
const remote = () => ({ instance: { id: "peer", mode: "aggregate-only", label: "peer", conn: PRIMARY } });

const cohort = (counts: Record<string, number>): EvaluatedCohort => ({
  studies: Object.keys(counts),
  perStudy: Object.fromEntries(Object.entries(counts).map(([st, n]) => [st, { sql: "SELECT 1", count: n, samples: n, mode: "patient-level" }])),
  count: Object.values(counts).reduce((a, b) => a + b, 0), samples: 0, text: "",
});
function ctx(cohorts: Record<string, EvaluatedCohort>, sites: Record<string, Site | ReturnType<typeof remote>>): ViewRun {
  const vNames = Object.keys(cohorts);
  const vStudies = [...new Set(vNames.flatMap((n) => cohorts[n].studies))];
  return {
    doc: { study: vStudies[0], cohorts: Object.fromEntries(vNames.map((n) => [n, { study: cohorts[n].studies[0] }])), views: [] } as never,
    cohorts, resolvers: Object.fromEntries(Object.entries(sites).map(([st, s]) => [st, "r" in s ? s.r : s])) as never, vNames, vStudies,
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies, requiresPatientLevel, aggregateOnly: [] } as never),
    pin: null,
    studyProfiles: async (st: string) => {
      const s = sites[st] as Site;
      return { profiles: s.o.profiles ?? ["mrna", "cna"], gaProfiles: s.o.ga ?? [], catalog: (s.o.catalog ?? []) as ProfileInfo[] };
    },
  };
}
const v = (o: Partial<CorrelatesView> = {}): CorrelatesView => ({ kind: "correlates", gene: "ESR1", profileType: "mrna", minN: 6, ...o });
const one = (o: SiteOpts = {}) => ctx({ A: cohort({ s1: 12 }) }, { s1: site(o) });
const res = (r: ViewResult) => { assert.equal(r.error, undefined, String(r.error)); return (r as ViewResult & { correlates: CorrelatesResult }).correlates; };
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + " ≉ " + b);

describe("correlates: refusals", () => {
  const err = async (view: CorrelatesView, c: ViewRun = one()) => (await runCorrelates(view, c)).error ?? "";
  test("one cohort, a gene, a profile name, show and minN in range, a non-empty cohort", async () => {
    assert.match(await err(v(), ctx({ A: cohort({ s1: 3 }), B: cohort({ s1: 3 }) }, { s1: site() })), /reads one cohort; this one draws 2/);
    assert.match(await err(v({ gene: "" })), /gene names the query gene/);
    assert.match(await err(v({ profileType: "bad name" })), /profileType names a continuous molecular profile/);
    assert.match(await err(v({ otherProfile: "x;y" })), /profileType names a continuous molecular profile/);
    for (const show of [0, 251]) assert.match(await err(v({ show })), /show is 1 to 250 genes/);
    for (const minN of [3, 100001]) assert.match(await err(v({ minN })), /minN is 4 to 100000/);
    assert.match(await err(v(), ctx({ A: cohort({ s1: 0 }) }, { s1: site() })), /nothing to correlate: cohort “A” is empty/);
  });

  test("the query profile may not be a generic assay; a categorical assay cannot be the other side", async () => {
    assert.match(await err(v({ profileType: "sigs" }), one({ ga: ["sigs"] })), /“sigs” is a generic assay; the query is a gene's profile/);
    assert.match(await err(v({ otherProfile: "arm" }), one({ ga: ["arm"], catalog: [{ profile: "arm", datatype: "CATEGORICAL" }] })), /“arm” is a categorical generic assay/);
  });

  test("a generic assay with more entities than the view correlates is refused, with the count", async () => {
    assert.match(await err(v({ otherProfile: "meth" }), one({ ga: ["meth"], entities: 400000 })),
      /“meth” has 400,000 entities in s1, more than this view correlates \(at most 25,000\); plot chosen ones against ESR1 instead/);
  });

  test("no study holds the profiles: the available ones are listed (cna left out)", async () => {
    assert.equal(await err(v({ profileType: "rppa" })), "no study in “A” has “rppa” — available: mrna");
    assert.equal(await err(v({ otherProfile: "rppa" })), "no study in “A” has “mrna” and “rppa” — available: mrna");
    assert.equal(await err(v(), one({ profiles: [] })), "no study in “A” has “mrna” — these studies have no molecular profiles");
  });

  test("no sample with a value for the gene, and no gene with enough samples", async () => {
    assert.equal(await err(v(), one({ rows: [] })), "no sample in “A” has a value for ESR1 on “mrna”");
    assert.equal(await err(v({ minN: 50 })), "no gene had at least 50 samples with a value for both it and ESR1, and any spread");
    // the excluded studies are mentioned when only some hold the profile
    const c = ctx({ A: cohort({ s1: 12, s2: 4 }) }, { s1: site({ rows: [] }), s2: site({ profiles: ["cna"] }) });
    assert.equal(await err(v(), c), "no sample in “A” has a value for ESR1 on “mrna” in the studies that hold it");
  });
});

describe("correlates: one study", () => {
  test("ρ from the rank sums, r from the value sums, BH over ρ's p; the gene against itself left out", async () => {
    const s = site();
    const r = await runCorrelates(v(), ctx({ A: cohort({ s1: 12 }) }, { s1: s }));
    const c = res(r);
    assert.equal(c.rhoFrom, "rank");
    assert.equal(c.tested, 4, "UP, PGR, DOWN, NOISE");
    assert.equal(c.untested, 2, "FLAT (no spread) and FEW (5 < minN 6)");
    const all = [...c.positive, ...c.negative];
    assert.ok(!all.some((g) => g.gene === "ESR1"));
    const up = c.positive[0];
    assert.equal(up.gene, "UP");
    assert.equal(up.rho, 1, "monotone: Spearman's ρ is exactly 1");
    assert.ok(up.r! < 1 && up.r! > 0.9, "but not linear: Pearson's r is below 1");
    for (const g of all) {
      const row = STUDY_ROWS.find((x) => x.gene === g.gene)!;
      assert.equal(g.rho, pearsonFromMoments(momentsOf(row, true)).r);
      assert.equal(g.r, pearsonFromMoments(momentsOf(row)).r);
      assert.equal(g.n, 12);
    }
    // ranked by ρ: positives descending, negatives from the most negative
    assert.deepEqual(c.positive.map((g) => g.gene), ["UP", "PGR", "NOISE"].filter((g) => c.positive.some((x) => x.gene === g)));
    assert.equal(c.negative[0].gene, "DOWN");
    assert.ok(c.negative[0].rho! < -0.9);
    const ps = [...c.positive, ...c.negative];
    const q = benjaminiHochberg(ps.map((g) => g.rhoP));
    ps.forEach((g, i) => close(g.q, q[i]));
    assert.equal(c.significant, ps.filter((g) => g.q < 0.05).length);
    assert.equal(c.histogram.length, 40);
    assert.deepEqual(c.histogram[0], [-1, 1], "DOWN falls strictly: ρ = −1, in the bottom bin");
    assert.equal(c.histogram.reduce((a, [, n]) => a + n, 0), 4);
    assert.equal(c.histogram[39][1], all.filter((g) => g.rho! >= 0.95).length, "ρ = 1 falls in the top bin, with ρ ≥ 0.95");
    assert.equal(up.cytoband, "1p36");
    assert.equal(c.positive.find((g) => g.gene === "PGR")?.cytoband, undefined, "a gene without a band is left without one");
    assert.ok(s.labels.includes("cytobands"));
    assert.ok(r.method, "a method record");
    assert.match(r.caveat!, /Ranked by Spearman's ρ/);
    assert.doesNotMatch(r.caveat!, /Fisher z/);
    assert.match(r.caveat!, /2 genes were not tested: fewer than 6 samples/);
    assert.equal(r.studies, undefined);
  });

  test("show caps each direction; the defaults are 100 genes and minN 10", async () => {
    const c = res(await runCorrelates(v({ show: 1 }), one()));
    assert.equal(c.positive.length, 1);
    assert.equal(c.negative.length, 1);
    const d = res(await runCorrelates({ kind: "correlates", gene: "ESR1", profileType: "mrna" }, one()));
    assert.equal(d.minN, 10);
    assert.equal(d.untested, 2);
  });

  test("against another profile, the query gene against itself is tested too", async () => {
    const c = res(await runCorrelates(v({ otherProfile: "protein" }), one({ profiles: ["mrna", "protein"] })));
    assert.equal(c.otherProfile, "protein");
    assert.ok(c.positive.some((g) => g.gene === "ESR1"));
    assert.equal(c.tested, 5);
  });

  test("a cytoband lookup that fails leaves the genes without bands rather than failing the view", async () => {
    const c = res(await runCorrelates(v(), one({ bands: "fail" })));
    assert.ok([...c.positive, ...c.negative].every((g) => g.cytoband === undefined));
  });
});

describe("correlates: a generic assay as the other side", () => {
  test("entities are named where the study gives a different name; no cytobands; the caveat says entities", async () => {
    const s = site({ ga: ["sigs"], catalog: [{ profile: "sigs", datatype: "LIMIT-VALUE" }],
      names: [{ entity: "UP", name: "Signature Up" }, { entity: "DOWN", name: "DOWN" }, { entity: "UP", name: "ignored second name" }] });
    const r = await runCorrelates(v({ otherProfile: "sigs" }), ctx({ A: cohort({ s1: 12 }) }, { s1: s }));
    const c = res(r);
    assert.equal(c.otherIsAssay, true);
    assert.equal(c.positive.find((g) => g.gene === "UP")?.name, "Signature Up");
    assert.equal(c.negative.find((g) => g.gene === "DOWN")?.name, undefined, "a name equal to the id is not repeated");
    assert.ok(!s.labels.includes("cytobands"));
    assert.ok(s.labels.includes("correlates:entities") && s.labels.includes("correlates:names"));
    assert.match(r.caveat!, /against every entity of the generic assay “sigs”/);
    assert.match(r.caveat!, /entities were not tested/);
  });
});

describe("correlates: several studies", () => {
  // the second study: the same genes on new samples, with UP no longer perfectly monotone (10 → 80, 9 → 100)
  const Y = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9];
  const ROWS2: Row[] = [
    sums("UP", Y, [5, 2, 17, 9, 36, 25, 65, 51, 80, 100]),
    sums("PGR", Y, Y.map((x) => x + 1)),
    sums("DOWN", Y, Y.map((x) => 20 - x)),
    sums("NOISE", Y, [5, 3, 5, 8, 9, 7, 9, 3, 2, 3]),
  ];
  test("r pools both studies' sums; ρ combines each study's by Fisher z; studies and the method are named", async () => {
    const r = await runCorrelates(v(), ctx({ A: cohort({ s1: 12, s2: 10 }) }, { s1: site(), s2: site({ rows: ROWS2 }) }));
    const c = res(r);
    assert.equal(c.rhoFrom, "meta");
    assert.deepEqual(r.studies, ["s1", "s2"]);
    const pgr = [...c.positive, ...c.negative].find((g) => g.gene === "PGR")!;
    const a = STUDY_ROWS.find((x) => x.gene === "PGR")!, b = ROWS2.find((x) => x.gene === "PGR")!;
    const pooled = Object.fromEntries(Object.entries(momentsOf(a)).map(([k, x]) => [k, x + momentsOf(b)[k as "n"]])) as ReturnType<typeof momentsOf>;
    assert.equal(pgr.n, 22);
    assert.equal(pgr.r, pearsonFromMoments(pooled).r);
    const meta = fisherZMeta([{ r: pearsonR(momentsOf(a, true)), n: 12 }, { r: pearsonR(momentsOf(b, true)), n: 10 }]);
    assert.equal(pgr.rho, meta.r);
    assert.equal(pgr.rhoP, meta.p);
    // UP's ρ is 1 in the first study, where Fisher z is undefined: only the second counts
    const up = c.positive.find((g) => g.gene === "UP")!;
    assert.equal(up.rho, fisherZMeta([{ r: pearsonR(momentsOf(ROWS2[0], true)), n: 10 }]).r);
    assert.match(r.caveat!, /combined by Fisher z weighted by size/);
  });

  test("a study without the profile, and a remote peer, are left out and named", async () => {
    const c = ctx({ A: cohort({ s1: 12, s2: 5, s3: 5 }) }, { s1: site(), s2: site({ profiles: ["cna", "protein"] }), s3: remote() });
    const r = await runCorrelates(v(), c);
    const out = res(r);
    assert.equal(out.rhoFrom, "rank", "one study answered");
    assert.deepEqual(out.excluded, [
      { study: "s3", reason: "a remote peer, which does not serve this view's aggregates yet" },
      { study: "s2", reason: "has no mrna profile" },
    ]);
    assert.match(r.caveat!, /Left out: s3 \(a remote peer.*\), s2 \(has no mrna profile\)\./);
  });
});
