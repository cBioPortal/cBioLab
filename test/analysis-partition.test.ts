// Proposing a split's arms from the data (lib/analysis.ts proposePartition): exactly one thing to
// split by; a categorical attribute's frequent values become arms and the rest go to Other; a
// numeric one is split at the cohort's own median (a percentile leaf, resolved live) or cut into
// quantiles written into the arms; a gene gives mutated / wild-type, OQL an arm per query, a
// generic-assay entity a median or per-value split; names never collide with the cohort's other
// splits. Also study resolution and each study's profiles. The warehouse is a stand-in
// (setChTransport) answering each statement by what it reads.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "testdb";
process.env.STUDY_ID = "st1";
process.env.ONCOKB_PIN = "v1";
for (const k of ["CLICKHOUSE2_URL", "FEDERATION_PEERS", "CH_RUN_CACHE", "LOOPBACK_PEER", "STUDY_DENY", "STUDY_ALLOW_RESTRICTED"]) delete process.env[k];

const { setChTransport } = await import("../lib/ch.ts");
const { proposePartition, resolveStudy, validStudies, studyProfiles, studyProfilesMany, resolveDocCohorts } = await import("../lib/analysis.ts");
type Row = Record<string, unknown>;

const PT = "mutational_signature";
let sent: string[] = [];
let answers: [RegExp, Row[] | ((q: string) => Row[])][] = [];
/** the studies the warehouse holds, and each one's profiles */
const BASE: [RegExp, Row[] | ((q: string) => Row[])][] = [
  [/SELECT cancer_study_identifier AS id, name FROM testdb\.cancer_study/, [{ id: "st1", name: "Study one" }, { id: "st2", name: "Study two" }, { id: "tcga_restricted", name: "GENIE v3.1-consortium" }]],
  [/gp\.genetic_alteration_type = 'GENERIC_ASSAY'/, (q) => /'st1'/.test(q) ? [{ s: "st1", pt: PT }] : []],
  [/AS profile, gp\.genetic_alteration_type AS type/, (q) => [
    ...(/'st1'/.test(q) ? [{ s: "st1", profile: "mutations", type: "MUTATION_EXTENDED", datatype: "MAF", name: "Mutations", assay: "", ord: 1, pl: 0 },
      { s: "st1", profile: PT, type: "GENERIC_ASSAY", datatype: "LIMIT-VALUE", name: "Signatures", assay: "MUTATIONAL_SIGNATURE", ord: 2, pl: 1 }] : []),
    ...(/'st2'/.test(q) ? [{ s: "st2", profile: "gistic", type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", name: "CNA", assay: "", ord: 0, pl: 0 }] : []),
  ]],
];
setChTransport(async ({ query }) => {
  sent.push(query);
  const hit = answers.find(([re]) => re.test(query)) ?? BASE.find(([re]) => re.test(query));
  const data = hit ? (typeof hit[1] === "function" ? hit[1](query) : hit[1]) : [];
  return JSON.stringify({ meta: [], data, rows: data.length });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; answers = []; });
const on = (re: RegExp, rows: Row[] | ((q: string) => Row[])) => { answers.push([re, rows]); };

/** declared datatypes: SEX and SUBTYPE are text, AGE a number */
const declared = () => on(/upper\(cam\.datatype\) AS dt/, (q) => [["SEX", "STRING"], ["SUBTYPE", "STRING"], ["AGE", "NUMBER"]]
  .filter(([a]) => q.includes("'" + a + "'")).map(([a, dt]) => ({ a, dt })));
const values = (rows: Row[]) => on(/AS per, attribute_value AS v/, (q) => rows.filter((r) => q.includes("'" + r.a + "'")));

const doc = {
  study: "st1",
  cohorts: {
    All: { all: [], splits: { SEX: { arms: [{ name: "Female", where: { kind: "clinical", attribute: "SEX", values: ["Female"] } }] } } },
    Both: { studies: ["st1", "st2"], all: [] },
    Elsewhere: { study: "nowhere", all: [] },
  },
  views: [],
} as never;
const propose = (req: Record<string, unknown>) => proposePartition({ doc, cohort: "All", ...req } as never);

describe("studies", () => {
  test("a known study resolves; an unknown or restricted one is refused by name; junk is stripped first", async () => {
    assert.equal(await resolveStudy("st1"), "st1");
    assert.equal(await resolveStudy(null, "st2"), "st2");
    assert.equal(await resolveStudy(undefined), "st1", "the configured study");
    await assert.rejects(resolveStudy("st1'; DROP"), /unknown study 'st1DROP'/);
    await assert.rejects(resolveStudy("nowhere"), /unknown study 'nowhere'/);
    await assert.rejects(resolveStudy("tcga_restricted"), /consortium\/private-access and is excluded/);
    assert.deepEqual([...(await validStudies())].sort(), ["st1", "st2"]);
  });

  test("each study's profiles: the catalog, the generic-assay types, and the ones genetic_alteration_derived holds; asked once, then cached", async () => {
    const m = await studyProfilesMany(["st1", "st2"]);
    const st1 = m.get("st1")!;
    assert.deepEqual(st1.gaProfiles, [PT]);
    assert.ok(!st1.profiles.includes(PT), "a generic assay is not in genetic_alteration_derived");
    const sig = st1.catalog.find((c) => c.profile === PT)!;
    assert.deepEqual([sig.assayType, sig.patientLevel, sig.order, sig.study], ["MUTATIONAL_SIGNATURE", true, 2, "st1"]);
    const mut = st1.catalog.find((c) => c.profile === "mutations")!;
    assert.equal(mut.assayType, undefined);
    assert.equal(mut.patientLevel, undefined);
    assert.deepEqual(m.get("st2")!.gaProfiles, []);
    const n = sent.length;
    assert.deepEqual((await studyProfiles("st1")).gaProfiles, [PT]);
    assert.equal(sent.filter((q) => /genetic_profile/.test(q)).length, sent.slice(0, n).filter((q) => /genetic_profile/.test(q)).length, "no second genetic_profile read");
  });

  test("a document's cohorts, resolved as a run resolves them: splits expanded into child cohorts", async () => {
    declared();
    values([{ a: "SEX", per: "patient", v: "Female", n: 60 }, { a: "SEX", per: "patient", v: "Male", n: 40 }]);
    const { doc: resolved, docStudy } = await resolveDocCohorts(doc);
    assert.equal(docStudy, "st1");
    assert.ok(Object.keys(resolved.cohorts).length >= 3);
    assert.ok(!("splits" in resolved.cohorts.All), "the children carry the split; the cohort handed on has none");
  });
});

describe("what to split by", () => {
  test("exactly one of attribute, gene, oql or assay", async () => {
    await assert.rejects(propose({}), /name exactly one of attribute, gene, oql or assay/);
    await assert.rejects(propose({ attribute: "SEX", gene: "TP53" }), /exactly one/);
    await assert.rejects(propose({ attribute: "" }), /exactly one/);
  });
  test("a cohort the document does not have is refused, naming those it has", async () => {
    await assert.rejects(proposePartition({ doc, cohort: "Nope", gene: "TP53" } as never), /no cohort “Nope” to split; have All, Both, Elsewhere/);
  });
  test("a name the cohort's other splits already use is refused", async () => {
    await assert.rejects(propose({ gene: "TP53", name: " SEX " }), /“All” already has a split named “SEX”/);
  });
  test("an attribute name that could not be a column is refused before any query", async () => {
    await assert.rejects(propose({ attribute: "SEX; DROP" }), /is not a valid attribute name/);
    assert.ok(!sent.some((q) => /clinical_data_derived/.test(q)));
  });
});

describe("a gene or OQL", () => {
  test("a gene gives mutated against wild-type, named after the gene", async () => {
    const r = await propose({ gene: "TP53" });
    assert.equal(r.name, "TP53");
    assert.equal(r.def.split, "TP53");
    assert.equal(r.def.of, "All");
    assert.equal(r.def.source?.gene, "TP53");
  });
  test("an explicit name is used as given, trimmed", async () => {
    const r = await propose({ gene: "KRAS", name: "  KRAS status " });
    assert.equal(r.name, "KRAS status");
  });
  test("OQL gives an arm per query", async () => {
    const r = await propose({ oql: ["EGFR: MUT", "KRAS: AMP"] });
    assert.equal(r.name, "OQL");
    assert.equal(r.def.arms.length, 2);
  });
});

describe("a clinical attribute", () => {
  test("categorical: an arm per value held by enough patients, the rest named as going to Other", async () => {
    declared();
    values([
      { a: "SUBTYPE", per: "patient", v: "LumA", n: 50 }, { a: "SUBTYPE", per: "patient", v: "LumB", n: 30 },
      { a: "SUBTYPE", per: "patient", v: "Her2", n: 4 }, { a: "SUBTYPE", per: "patient", v: "Basal", n: 2 },
    ]);
    const r = await propose({ attribute: "SUBTYPE" });
    assert.equal(r.name, "SUBTYPE");
    assert.equal(r.def.arms.length, 2);
    assert.match(r.note!, /^2 values with fewer patients go to Other: (Her2, Basal|Basal, Her2)$/);
  });

  test("a name already taken by a split gets a fresh one", async () => {
    declared();
    values([{ a: "SEX", per: "patient", v: "Female", n: 60 }, { a: "SEX", per: "patient", v: "Male", n: 40 }]);
    const r = await propose({ attribute: "SEX" });
    assert.notEqual(r.name, "SEX");
    assert.match(r.name, /^SEX/);
    assert.equal(r.note, undefined, "every value earned an arm");
  });

  test("an attribute no study declares is refused, saying so", async () => {
    declared();
    await assert.rejects(propose({ attribute: "SMOKING" }), /cannot split by 'SMOKING': not declared by st1/);
  });

  test("an attribute declared differently across the cohort's studies is refused, not merged", async () => {
    on(/upper\(cam\.datatype\) AS dt/, (q) => [{ a: "AGE", dt: /'st1'/.test(q) ? "NUMBER" : "STRING" }]);
    on(/AS per, attribute_value AS v/, [{ a: "AGE", per: "patient", v: "60", n: 20 }]);
    on(/sum\(x \* x\) AS sxx/, [{ a: "AGE", per: "patient", n: 20, sx: 1200, sxx: 80000, mn: 40, mx: 80 }]);
    await assert.rejects(proposePartition({ doc, cohort: "Both", attribute: "AGE" } as never), /declared inconsistently/);
  });

  test("categorical values are merged across the cohort's studies before arms are chosen", async () => {
    declared();
    values([{ a: "SUBTYPE", per: "patient", v: "LumA", n: 6 }, { a: "SUBTYPE", per: "patient", v: "LumB", n: 30 }]);
    const r = await proposePartition({ doc, cohort: "Both", attribute: "SUBTYPE" } as never);
    // LumA has 6 patients in each study: 12 together, enough for an arm though neither study alone has 10
    assert.equal(r.def.arms.length, 2);
    assert.equal(r.note, undefined);
  });

  test("a categorical attribute cannot be cut into quantiles", async () => {
    declared();
    values([{ a: "SUBTYPE", per: "patient", v: "LumA", n: 50 }]);
    await assert.rejects(propose({ attribute: "SUBTYPE", quantiles: 4 }), /is categorical; only a numeric attribute is cut into quantiles/);
  });

  describe("numeric", () => {
    const numeric = () => {
      declared();
      on(/sum\(x \* x\) AS sxx/, [{ a: "AGE", per: "patient", n: 90, sx: 5400, sxx: 340000, mn: 20, mx: 90 }]);
    };
    test("split at the cohort's own median, through a percentile leaf the engine resolves live", async () => {
      numeric();
      const r = await propose({ attribute: "AGE" });
      assert.equal(r.name, "AGE");
      assert.match(r.note!, /split at the median of AGE within “All”/);
      assert.deepEqual(r.def.arms[0].where, { kind: "clinical", attribute: "AGE", op: "<", percentile: 0.5, percentileOf: "All" });
      assert.equal(r.def.other, "AGE at or above median");
      assert.deepEqual(r.def.source, { attribute: "AGE", median: true });
    });
    test("a cohort over several studies has no one median to split at", async () => {
      numeric();
      await assert.rejects(proposePartition({ doc, cohort: "Both", attribute: "AGE" } as never), /needs a cohort in a single study \(“Both” spans 2\)/);
    });
    test("quartiles: an arm per interval, cuts written in, and a tied cut dropped and said so", async () => {
      numeric();
      on(/quantilesExact|quantileExact/, [{ n: 90, hi: 90, qs: [40, 55, 55] }]);
      const r = await propose({ attribute: "AGE", quantiles: 4 });
      assert.equal(r.def.source?.quantiles, 4);
      assert.equal(r.def.arms.length, 3);
      assert.match(r.note!, /AGE cut at its quartiles within “All” — 3 groups, not 4, because tied values cannot be divided/);
      assert.deepEqual(r.def.arms.map((a) => (a.where as { range: unknown }).range), [{ lte: 40 }, { gt: 40, lte: 55 }, { gt: 55 }]);
    });
    test("quantiles of a value every case shares are refused, as are quantiles of no cases", async () => {
      numeric();
      on(/quantilesExact|quantileExact/, [{ n: 90, hi: 50, qs: [50] }]);
      await assert.rejects(propose({ attribute: "AGE", quantiles: 2 }), /AGE takes a single value across the 90 cases of “All” that have one — nothing to cut/);
      answers.pop();
      on(/quantilesExact|quantileExact/, [{ n: 0 }]);
      await assert.rejects(propose({ attribute: "AGE", quantiles: 2 }), /no case of “All” has a value for AGE/);
    });
  });
});

describe("a generic-assay entity", () => {
  test("a malformed profile or entity is refused before any query", async () => {
    await assert.rejects(propose({ assay: { profileType: "x;y", entity: "SBS1" } }), /name a generic-assay profile and one of its entities/);
  });
  test("a study without the profile is refused by name, as is a cohort over several studies", async () => {
    await assert.rejects(propose({ assay: { profileType: "methylation", entity: "cg1" } }), /st1 has no generic-assay profile 'methylation'/);
    await assert.rejects(proposePartition({ doc, cohort: "Both", assay: { profileType: PT, entity: "SBS1" } } as never),
      /a split on a generic assay needs a cohort in a single study \(“Both” spans 2\)/);
  });
  test("numeric: split at the cohort's median, the cut written into the arm", async () => {
    on(/AS median/, [{ dt: "LIMIT-VALUE", n: 40, median: 0.123456 }]);
    const r = await propose({ assay: { profileType: PT, entity: "SBS1" } });
    assert.deepEqual(r.def.arms[0].where, { kind: "genericAssay", profileType: PT, entity: "SBS1", range: { gt: 0.123456 } });
    assert.match(r.note!, /split at the median of .* within “All” \(0\.1235, over its samples' values\)/);
    assert.deepEqual(r.def.source, { assay: { profileType: PT, entity: "SBS1" }, median: true });
  });
  test("numeric with no values is refused", async () => {
    on(/AS median/, [{ dt: "LIMIT-VALUE", n: 0 }]);
    await assert.rejects(propose({ assay: { profileType: PT, entity: "SBS1" } }), /no patient of “All” has a value for/);
  });
  test("numeric quantiles: arms by interval", async () => {
    on(/AS median/, [{ dt: "LIMIT-VALUE", n: 40, median: 0.5 }]);
    on(/AS qs/, [{ n: 40, hi: 1, qs: [0.5] }]);
    const r = await propose({ assay: { profileType: PT, entity: "SBS1" }, quantiles: 2 });
    assert.equal(r.def.arms.length, 2);
    assert.match(r.note!, /cut at its median within “All”$/);
    assert.equal(r.def.source?.quantiles, 2);
  });
  test("categorical: an arm per value held by enough patients", async () => {
    on(/AS median/, [{ dt: "CATEGORICAL", n: 40 }]);
    on(/AS v,/, [{ v: "High", n: 20 }, { v: "Low", n: 15 }, { v: "Rare", n: 1 }]);
    const r = await propose({ assay: { profileType: PT, entity: "MSI" } });
    assert.deepEqual(r.def.arms.map((a) => (a.where as { values: string[] }).values), [["High"], ["Low"]]);
    assert.deepEqual(r.def.source?.otherValues, ["Rare"]);
    assert.equal(r.note, "1 value with fewer patients go to Other: Rare");
  });
  test("categorical with no frequent value, or asked for quantiles, is refused", async () => {
    on(/AS median/, [{ dt: "BINARY", n: 3 }]);
    on(/AS v,/, [{ v: "yes", n: 2 }]);
    await assert.rejects(propose({ assay: { profileType: PT, entity: "MSI" } }), /no value of .* is held by at least 10 patients/);
    await assert.rejects(propose({ assay: { profileType: PT, entity: "MSI" }, quantiles: 4 }), /is categorical; only a numeric entity is cut into quantiles/);
  });
});
