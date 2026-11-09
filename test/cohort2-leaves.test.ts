// The cohort compiler's leaves and readback (lib/cohort2.ts), the parts the main cohort tests do
// not reach: every leaf kind's validation (loud rejection naming what is wrong or what exists),
// the level each leaf selects at, the derived metrics, the stored-set and upload leaves, and the
// plain-language readback of every leaf. The compiler only builds SQL, so the tests read it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compileCohortDef, describeCohortDef, describeClause, cohortClauses, basePatientsSql, baseSamplesSql,
  derivedMetricSql, eventTypeMatchSql, lineClassesParam, profiledCasesSql, splitBucketSql, bareSampleId,
  inCohortSamples, inCohortPatients, INLINE_ID_SQL_LIMIT, PROFILED_MAX_GENES, SPLIT_SALT
} from "../lib/cohort2.ts";
import { withIdSets, idSetTableName, type LoadedIdSet } from "../lib/id-sets.ts";
import { withCustomData } from "../lib/custom-data.ts";
import { LINE_TYPE } from "../lib/compiler.ts";
import type { CohortDef } from "../lib/types.ts";

const ctx = { study: "s1", db: "cbio" };
const one = (leaf: unknown, c: Record<string, unknown> = ctx) => compileCohortDef({ all: [leaf as never] }, c);
const SET = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("the study's samples and patients", () => {
  test("every sample as bare (pid, sid); every patient as bare pid", () => {
    assert.equal(baseSamplesSql("s1", "cbio"),
      "SELECT replaceOne(patient_unique_id, 's1_', '') AS pid, replaceOne(sample_unique_id, 's1_', '') AS sid FROM cbio.sample_derived\n  WHERE cancer_study_identifier = 's1'");
    assert.match(basePatientsSql("s1", "cbio"), /^SELECT DISTINCT replaceOne\(patient_unique_id, 's1_', ''\) AS pid FROM cbio\.sample_derived/);
  });
  test("no definition, an empty one and a null one all mean every sample", () => {
    for (const d of [null, undefined, { all: [] }]) assert.equal(compileCohortDef(d as CohortDef, ctx), baseSamplesSql("s1", "cbio"));
    assert.equal(describeCohortDef({ all: [] }), "all samples in the study");
    assert.equal(describeCohortDef(null), "all samples in the study");
  });
  test("more than 8 clauses, or `all` that is not a list, is refused", () => {
    const leaf = { kind: "clinical", attribute: "SEX", op: "=", value: "F" };
    assert.throws(() => compileCohortDef({ all: Array(9).fill(leaf) }, ctx), /all: \[0-8 clauses\]/);
    assert.throws(() => compileCohortDef({ all: "x" } as never, ctx), /all: \[0-8 clauses\]/);
  });
  test("the join rule: a sample-keyed table by sid, a patient-keyed one by pid", () => {
    assert.equal(inCohortSamples(bareSampleId("g.sample_unique_id", "s1")), "replaceOne(g.sample_unique_id, 's1_', '') IN (SELECT sid FROM cohort)");
    assert.equal(inCohortPatients("x", "grp"), "x IN (SELECT pid FROM grp)");
  });
});

describe("clinical leaf", () => {
  test("a stored attribute matches at the level each study records it: (lvl, id) rows tested against both", () => {
    const sql = one({ kind: "clinical", attribute: "STAGE", op: "=", value: "IV" });
    assert.match(sql, /SELECT DISTINCT type AS lvl, if\(type = 'sample'/);
    assert.match(sql, /\('sample', replaceOne\(sample_unique_id, 's1_', ''\)\) IN \(/);
    assert.match(sql, /OR \('patient', replaceOne\(patient_unique_id, 's1_', ''\)\) IN \(/);
    assert.match(sql, /attribute_name = 'STAGE'/);
  });
  test("a number compares numerically, a string ordering literally, equality folded", () => {
    assert.match(one({ kind: "clinical", attribute: "AGE", op: ">=", value: 60 }), / >= 60/);
    assert.match(one({ kind: "clinical", attribute: "GRADE", op: "<", value: "G3" }), /attribute_value < 'G3'/);
    assert.match(one({ kind: "clinical", attribute: "SEX", op: "!=", value: "Male" }), / != /);
  });
  test("a range takes every bound given, and refuses a bound that is not a number", () => {
    const sql = one({ kind: "clinical", attribute: "AGE", range: { gt: 1, lte: 9 } });
    assert.match(sql, / > 1 AND .* <= 9/);
    assert.match(one({ kind: "clinical", attribute: "AGE", range: { gte: 5 } }), / >= 5/);
    assert.match(one({ kind: "clinical", attribute: "AGE", range: { lt: 5 } }), / < 5/);
    assert.throws(() => one({ kind: "clinical", attribute: "AGE", range: { gt: "abc" } }), /clinical range\.gt must be a number/);
  });
  test("refused: no attribute, an over-long one, an unknown op, no condition, and the removed `per`", () => {
    assert.throws(() => one({ kind: "clinical", op: "=", value: 1 }), /invalid clinical attribute/);
    assert.throws(() => one({ kind: "clinical", attribute: "x".repeat(201), op: "=", value: 1 }), /invalid clinical attribute/);
    assert.throws(() => one({ kind: "clinical", attribute: "A", op: "LIKE", value: 1 }), /invalid clinical op/);
    assert.throws(() => one({ kind: "clinical", attribute: "A" }), /needs op\/value, values\[\], or range/);
    assert.throws(() => one({ kind: "clinical", attribute: "A", op: "=", value: 1, per: "patient" }), /`per` was removed/);
  });
});

describe("the deprecated alteration leaf compiles through OQL", () => {
  const same = (alt: Record<string, unknown>, q: string) =>
    assert.equal(one({ kind: "alteration", ...alt }, { ...ctx, oncokbPin: "v1" }), one({ kind: "oql", q }, { ...ctx, oncokbPin: "v1" }), q);
  test("each type selection and driver flag maps to its OQL", () => {
    same({ gene: "kras" }, "KRAS:");
    same({ gene: "KRAS", driver: "driverOnly" }, "KRAS: DRIVER");
    same({ gene: "KRAS", types: ["MUT"] }, "KRAS: MUT");
    same({ gene: "KRAS", types: ["CNA", "SV"], driver: "driverOnly" }, "KRAS: AMP_DRIVER HOMDEL_DRIVER FUSION_DRIVER");
    same({ gene: "KRAS", types: ["MUT", "SV"] }, "KRAS: MUT FUSION");
  });
  test("a bad gene is refused", () => {
    assert.throws(() => one({ kind: "alteration", gene: "no gene" }), /invalid gene symbol in alteration clause/);
  });
});

describe("profiled leaf", () => {
  test("a gene narrows to panels covering it or whole-exome; no gene means any panel of the type", () => {
    const sql = one({ kind: "profiled", type: "cna", gene: "egfr" });
    assert.match(sql, /alteration_type = 'COPY_NUMBER_ALTERATION'/);
    assert.match(sql, /gene_panel_id = 'WES' OR sp\.gene_panel_id IN \(\n.*WHERE gene = 'EGFR'/);
    assert.doesNotMatch(one({ kind: "profiled", type: "SV" }), /WES/);
  });
  test("a gene list is each gene's clause intersected, duplicates folded", () => {
    const sql = one({ kind: "profiled", type: "MUTATION", genes: ["tp53", "KRAS", "TP53"] });
    assert.equal(sql.match(/INTERSECT DISTINCT/g)?.length, 1);
    assert.match(sql, /'TP53'[\s\S]*'KRAS'/);
  });
  test("refused: an unknown type, gene and genes together, an empty list, too many genes, a bad symbol", () => {
    assert.throws(() => one({ kind: "profiled", type: "RNA" }), /type must be MUTATION, CNA, or SV/);
    assert.throws(() => one({ kind: "profiled", type: "CNA", gene: "A", genes: ["B"] }), /`gene` or `genes`, not both/);
    assert.throws(() => one({ kind: "profiled", type: "CNA", genes: [] }), /at least one gene/);
    const many = Array.from({ length: PROFILED_MAX_GENES + 1 }, (_, i) => "G" + i);
    assert.throws(() => one({ kind: "profiled", type: "CNA", genes: many }), new RegExp("at most " + PROFILED_MAX_GENES + " genes; this names " + many.length));
    assert.throws(() => one({ kind: "profiled", type: "CNA", gene: "bad gene" }), /profiled clause: invalid gene symbol/);
  });
  test("profiledCasesSql: per sample or per patient, the same whole-exome rule", () => {
    const s = profiledCasesSql("tp53", "MUTATION", { study: "s1", db: "cbio", unit: "sample" });
    assert.match(s, /SELECT DISTINCT replaceOne\(sd\.sample_unique_id, 's1_', ''\) AS profiled_id/);
    assert.match(s, /alteration_type = 'MUTATION_EXTENDED'/);
    assert.match(s, /gene_panel_id = 'WES' OR .*\n.*WHERE gene = 'TP53'/);
    assert.match(profiledCasesSql("KRAS", "SV", { study: "s1", db: "cbio", unit: "patient" }), /sd\.patient_unique_id/);
    assert.throws(() => profiledCasesSql("x y", "CNA", { study: "s1", db: "cbio", unit: "sample" }), /invalid gene symbol/);
  });
});

describe("caseList, genomicData and genericAssay leaves", () => {
  test("caseList refuses an id that is not one", () => {
    assert.throws(() => one({ kind: "caseList", id: "a list; drop" }), /caseList clause: bad list id/);
  });
  test("caseList by category: the study's list of that category, the first by id; an id or a category, not both", () => {
    const sql = one({ kind: "caseList", category: "all_cases_with_mutation_data" });
    assert.match(sql, /sl\.list_id = \(SELECT sl\.list_id\n {2}FROM cbio\.sample_list sl[\s\S]*WHERE sl\.category = 'all_cases_with_mutation_data' AND cs\.cancer_study_identifier = 's1'\n {2}ORDER BY sl\.stable_id LIMIT 1\)/);
    assert.match(one({ kind: "caseList", id: "sequenced" }), /sl\.stable_id = 's1_sequenced' AND cs\.cancer_study_identifier = 's1'/);
    assert.throws(() => one({ kind: "caseList", id: "x", category: "all_cases_in_study" }), /a list id or a category, not both or neither/);
    assert.throws(() => one({ kind: "caseList" }), /not both or neither/);
    assert.throws(() => one({ kind: "caseList", category: "All Cases'; --" }), /bad category/);
  });
  test("an oql leaf's exp / prot name the profile EXP and PROT read", () => {
    const c = { ...ctx, profiles: ["mrna_median_Zscores", "rna_seq_v2_mrna_median_Zscores", "rppa_Zscores"] };
    assert.match(one({ kind: "oql", q: "TP53: EXP>=2" }, c), /ga\.profile_type = 'mrna_median_Zscores'/);
    assert.match(one({ kind: "oql", q: "TP53: EXP>=2", exp: "rna_seq_v2_mrna_median_Zscores" }, c), /ga\.profile_type = 'rna_seq_v2_mrna_median_Zscores'/);
    assert.match(one({ kind: "oql", q: "TP53: PROT<=-2", prot: "rppa_Zscores" }, c), /ga\.profile_type = 'rppa_Zscores' AND .* <= -2/);
    assert.throws(() => one({ kind: "oql", q: "TP53: EXP>=2", exp: "gistic" }, c), /OQL EXP is set to read the mRNA profile 'gistic', which this study does not have; its mRNA profiles: mrna_median_Zscores, rna_seq_v2_mrna_median_Zscores/);
    assert.throws(() => one({ kind: "oql", q: "TP53: EXP>=2", exp: "x y" }, c), /oql clause: exp names a profile by its id/);
    // a pin no entry reads is harmless
    assert.doesNotThrow(() => one({ kind: "oql", q: "TP53: MUT", prot: "rppa_Zscores" }, c));
  });
  test("ifHeld: a study without the pinned profile has no EXP / PROT alterations instead of being refused", () => {
    const c = { ...ctx, profiles: ["mutations", "mrna_median_Zscores"] };
    const sql = one({ kind: "oql", q: "TP53: MUT EXP>=2", exp: "rna_seq_v2_mrna_median_all_sample_Zscores", ifHeld: true }, c);
    // the pinned id is read as named, which matches none of this study's rows
    assert.match(sql, /ga\.profile_type = 'rna_seq_v2_mrna_median_all_sample_Zscores'/);
    assert.match(sql, /MUT|mutation/i);
    // still a profile of the right kind, and still checked for shape
    assert.throws(() => one({ kind: "oql", q: "TP53: EXP>=2", exp: "gistic", ifHeld: true }, c), /OQL EXP is set to read the mRNA profile 'gistic'/);
    assert.throws(() => one({ kind: "oql", q: "TP53: EXP>=2", exp: "rna_seq_v2_mrna_median_Zscores", ifHeld: "yes" } as never, c), /ifHeld is true or left out/);
    assert.throws(() => one({ kind: "oql", q: "TP53: EXP>=2", ifHeld: true }, c), /name exp or prot/);
  });
  test("genomicData: values or a range of the gene's profile, checked against the study's profiles", () => {
    const sql = one({ kind: "genomicData", gene: "erbb2", profileType: "gistic", values: ["2", "-2"] });
    assert.match(sql, /hugo_gene_symbol = 'ERBB2' AND ga\.profile_type = 'gistic'/);
    assert.match(sql, /ga\.alteration_value IN \('2','-2'\)/);
    assert.throws(() => one({ kind: "genomicData", gene: "ERBB2", profileType: "mrna", range: { gt: 1 } }, { ...ctx, profiles: ["gistic"] }),
      /profile 'mrna' not in this study \(available: gistic\)/);
    assert.throws(() => one({ kind: "genomicData", gene: "ERBB2", profileType: "mrna", range: { gt: 1 } }, { ...ctx, profiles: [] }), /available: none/);
    assert.throws(() => one({ kind: "genomicData", gene: "", profileType: "mrna", range: { gt: 1 } }), /genomicData clause: bad gene/);
    assert.throws(() => one({ kind: "genomicData", gene: "A", profileType: "mrna" }), /needs range\{gt,gte,lt,lte\} or values\[\]/);
    assert.throws(() => one({ kind: "genomicData", gene: "A", profileType: "mrna", range: { lt: "x" } }), /range\.lt must be a number/);
  });
  test("genericAssay: the study's exact profile, at the level it records, measured / values / range", () => {
    const sql = one({ kind: "genericAssay", profileType: "armlevel_cna", entity: "1p", measured: true });
    assert.match(sql, /if\(patient_level = 1, 'patient', 'sample'\) AS lvl/);
    assert.match(sql, /profile_stable_id = 's1_armlevel_cna'/);
    assert.match(sql, /trimBoth\(value\) NOT IN \('','NA'/);
    assert.match(one({ kind: "genericAssay", profileType: "p", entity: "e", range: { gte: 0.3 } }), / >= 0\.3/);
    assert.match(one({ kind: "genericAssay", profileType: "p", entity: "e", values: ["Gain"] }), /value IN \('Gain'\)/);
  });
  test("genericAssay refused: a study with none, missing fields, an unknown profile, no condition", () => {
    assert.throws(() => one({ kind: "genericAssay", profileType: "p", entity: "e", measured: true }, { ...ctx, gaProfiles: [] }), /has no generic assay profiles/);
    assert.throws(() => one({ kind: "genericAssay", profileType: "p" }), /needs profileType and entity/);
    assert.throws(() => one({ kind: "genericAssay", profileType: "p", entity: "e", measured: true }, { ...ctx, gaProfiles: ["q", "r"] }),
      /profile 'p' not in this study \(available: q, r\)/);
    assert.throws(() => one({ kind: "genericAssay", profileType: "p", entity: "e" }), /needs range, values\[\] or measured: true/);
  });
});

describe("derived metrics", () => {
  test("follow-up and history read the timeline's dates, alteredGenes counts high-level events only", () => {
    assert.match(derivedMetricSql("followupMonths", "s1", "cbio"), /max\(ce\.start_date\) \/ /);
    assert.match(derivedMetricSql("historyMonths", "s1", "cbio"), /greatest\(0, -min\(ce\.start_date\)\)/);
    const g = derivedMetricSql("alteredGenes", "s1", "cbio");
    assert.match(g, /uniqExact\(hugo_gene_symbol\) AS v/);
    assert.match(g, /abs\(cna_alteration\) >= 2/);
  });
  test("lines and treatmentSpan need an event type, matched by its folded name", () => {
    assert.throws(() => derivedMetricSql("lines", "s1", "cbio"), /metric 'lines' needs an eventType/);
    const span = derivedMetricSql("treatmentSpan", "s1", "cbio", { eventType: "Treatment" });
    assert.match(span, /max\(coalesce\(ce\.stop_date, ce\.start_date\)\) - min\(ce\.start_date\)/);
    assert.ok(span.includes(eventTypeMatchSql("ce.event_type", "Treatment")));
    assert.match(derivedMetricSql("lines", "s1", "cbio", { eventType: "Treatment", lineClasses: "all" }), /SELECT pid, max\(line_no\) AS v FROM lines GROUP BY pid$/);
  });
  test("a derived leaf: its range over the metric, refused without an eventType or a range", () => {
    const sql = one({ kind: "derived", metric: "lines", eventType: "Treatment", lineGap: 30, lineClasses: ["Chemo"], range: { gte: 2 } });
    assert.match(sql, /WHERE v >= 2/);
    assert.throws(() => one({ kind: "derived", metric: "lines", range: { gte: 2 } }), /metric 'lines' needs an eventType/);
    assert.throws(() => one({ kind: "derived", metric: "alteredGenes", range: { gte: "many" } }), /range\.gte must be a number/);
  });
  test("buckets of one metric with different event types are not one scan", () => {
    const leaf = (eventType: string) => ({ kind: "derived", metric: "treatmentSpan", eventType, range: { gte: 1 } });
    const sql = compileCohortDef({ all: [{ any: [leaf("A"), leaf("B")] } as never] }, ctx);
    assert.match(sql, /UNION DISTINCT/);
  });
  test("lineClassesParam: systemic, all, or up to 40 names", () => {
    assert.equal(lineClassesParam("systemic"), "systemic");
    assert.equal(lineClassesParam("all"), "all");
    assert.deepEqual(lineClassesParam(["Chemo", "IO"]), ["Chemo", "IO"]);
    for (const bad of [[], ["  "], Array(41).fill("x"), "some", [1], ["x".repeat(121)]])
      assert.throws(() => lineClassesParam(bad), /lineClasses is "systemic", "all", or a list of up to 40/, JSON.stringify(bad).slice(0, 40));
  });
});

describe("sample and patient lists", () => {
  test("inline ids for this study only; a list naming nobody here selects nothing rather than failing", () => {
    const sql = one({ kind: "sampleList", ids: ["s1:S1", "s2:S9", "s1:S2"] });
    assert.match(sql, /replaceOne\(sample_unique_id, 's1_', ''\) IN \('S1','S2'\)/);
    assert.match(one({ kind: "patientList", ids: ["s2:P1"] }), /AND 1=0/);
  });
  test("ids that do not parse as <study>:<id> are refused", () => {
    assert.throws(() => one({ kind: "sampleList", ids: ["S1", ":x", "y:"] }), /sampleList clause needs ids as "<study>:<id>"/);
  });
  test("an inline list past the statement budget is refused, pointing at a stored set", () => {
    const ids = Array.from({ length: Math.ceil(INLINE_ID_SQL_LIMIT / 12) + 10 }, (_, i) => "s1:SAMPLE-" + String(i).padStart(6, "0"));
    assert.throws(() => one({ kind: "sampleList", ids }), /too many to write into one query .* save it as a stored id set/);
  });
  test("refused: ids and a set together, a part without a set, a set that is not a uuid, an empty part", () => {
    assert.throws(() => one({ kind: "sampleList", ids: ["s1:a"], set: SET }), /takes ids or a stored set, not both/);
    assert.throws(() => one({ kind: "patientList", ids: ["s1:a"], part: "x" }), /part names a part of a stored set, so it needs set/);
    assert.throws(() => one({ kind: "sampleList", set: "nope" }), /set must be a stored id set's id/);
    assert.throws(() => one({ kind: "sampleList", set: SET, part: "" }), /part must name a part of the set/);
  });
  test("a stored set the request read is its external table; one it did not read is refused", async () => {
    const s: LoadedIdSet = { id: SET, name: "my set", level: "sample", count: 2, perStudy: { s1: ["S1", "S2"] } };
    assert.throws(() => one({ kind: "sampleList", set: SET }), /which this request did not read/);
    await withIdSets([s], new Map([["s1", "primary"]]), async () => {
      assert.match(one({ kind: "sampleList", set: SET }), new RegExp("IN \\(SELECT id FROM " + idSetTableName(SET, "s1") + "\\)"));
      assert.match(one({ kind: "sampleList", set: SET }, { study: "s2", db: "cbio" }), /AND 1=0/, "no ids for another study: nobody there");
      assert.equal(describeClause({ kind: "sampleList", set: SET }), "in stored sample set “my set” (2 samples)");
    });
    assert.equal(describeClause({ kind: "patientList", set: SET }), "in stored patient set " + SET);
  });
});

describe("split and upload leaves, unknown kinds", () => {
  test("split: a fixed salted hash of the patient, discovery 0 and validation 1", () => {
    assert.equal(splitBucketSql("pid", "s1"), "cityHash64(concat('" + SPLIT_SALT + ":s1:', pid)) % 2");
    assert.match(one({ kind: "split", part: "validation" }), /% 2 = 1/);
    assert.match(one({ kind: "split", part: "discovery" }), /% 2 = 0/);
    assert.throws(() => one({ kind: "split", part: "test" }), /part must be "discovery" or "validation"/);
  });
  test("upload: any row of the dataset's columns; refused without a dataset, or one not sent", async () => {
    assert.throws(() => one({ kind: "upload", dataset: "mine" }), /upload clause needs dataset:"custom:<name>"/);
    assert.throws(() => one({ kind: "upload", dataset: "custom:mine" }), /custom data that was not sent with it: 'mine'/);
    const ds = { id: "mine", name: "mine", columns: [{ name: "score", type: "number" }], rows: [] };
    await withCustomData({ datasets: [ds as never], allowedConns: new Set(["primary"]), allowedDbs: new Set(["cbio"]) }, async () => {
      const sql = one({ kind: "upload", dataset: "custom:mine" });
      assert.match(sql, /attribute_name IN \('[^']*mine\/score'\)/);
      assert.throws(() => one({ kind: "upload", dataset: "custom:other" }), /'other'/);
    });
  });
  test("a timeline event selects patients — every sample of each — as does the v1 flat shape, with the cohort's line gap", () => {
    const ev = { a: { eventType: "TREATMENT" }, rel: { type: "NONE" } };
    const sql = one({ kind: "event", ...ev });
    assert.match(sql, /AND replaceOne\(patient_unique_id, 's1_', ''\) IN \(/, "matched by patient, not sample");
    assert.equal(compileCohortDef(ev as never, ctx), compileCohortDef({ all: [ev as never] }, ctx), "v1 sugar is the same cohort");
    assert.equal(describeCohortDef(ev as never), "has treatment");
  });
  test("a clause with no kind is a v1 event only when it has a and rel; an unknown kind is named", () => {
    assert.throws(() => one({ foo: 1 }), /unknown clause kind: \["foo"\]/);
    assert.throws(() => one({ kind: "telepathy" }), /unknown clause kind: \["kind"\]/);
  });
  test("`any` takes 1 to 8 leaves", () => {
    assert.throws(() => compileCohortDef({ all: [{ any: [] } as never] }, ctx), /any: 1-8 leaves/);
    assert.throws(() => compileCohortDef({ all: [{ any: Array(9).fill({ kind: "split", part: "discovery" }) } as never] }, ctx), /any: 1-8 leaves/);
  });
  test("`not` of an `any` is the study minus their union", () => {
    const sql = compileCohortDef({ all: [{ not: { any: [{ kind: "split", part: "discovery" }, { kind: "clinical", attribute: "SEX", op: "=", value: "F" }] } } as never] }, ctx);
    assert.match(sql, /EXCEPT DISTINCT\n\(\(SELECT[\s\S]*UNION DISTINCT/);
  });
  test("a locked cohort compiles to its frozen sample set wherever it is compiled", async () => {
    const s: LoadedIdSet = { id: SET, name: "lock", level: "sample", count: 1, perStudy: { s1: ["S1"] } };
    await withIdSets([s], new Map([["s1", "primary"]]), async () => {
      const sql = compileCohortDef({ all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "F" }], lock: { set: SET } } as never, ctx);
      assert.doesNotMatch(sql, /attribute_name = 'SEX'/, "the definition is not re-evaluated");
      assert.match(sql, new RegExp(idSetTableName(SET, "s1")));
    });
  });
});

describe("readback", () => {
  const text = (leaf: unknown) => describeClause(leaf);
  test("each leaf kind in plain words", () => {
    assert.equal(text({ kind: "alteration", gene: "KRAS", driver: "driverOnly", types: ["MUT"] }), "KRAS driver-altered (MUT)");
    assert.equal(text({ kind: "alteration", gene: "KRAS", types: ["MUT", "CNA", "SV"] }), "KRAS altered");
    assert.equal(text({ kind: "clinical", attribute: "STAGE", values: ["III", "IV"] }), "STAGE in [III, IV]");
    assert.equal(text({ kind: "clinical", attribute: "AGE", range: { gte: 18, lt: 65 } }), "AGE gte 18, lt 65");
    assert.equal(text({ kind: "clinical", attribute: "TMB", op: ">=", value: 10, percentile: 0.75, percentileOf: "LUAD" }), "TMB >= 10 (75th percentile of LUAD)");
    assert.equal(text({ kind: "clinical", attribute: "TMB", op: ">=", value: 10, percentile: 0.5 }), "TMB >= 10 (50th percentile)");
    assert.equal(text({ kind: "profiled", type: "MUTATION", genes: ["tp53", "kras"] }), "profiled for TP53, KRAS MUTATION");
    assert.equal(text({ kind: "profiled", type: "CNA", gene: "egfr" }), "profiled for EGFR CNA");
    assert.equal(text({ kind: "profiled", type: "SV" }), "profiled for SV");
    assert.equal(text({ kind: "derived", metric: "alteredGenes", range: { gt: 3, lte: 9 } }), "alteredGenes > 3 and ≤ 9 genes");
    assert.equal(text({ kind: "derived", metric: "lines", eventType: "Treatment", range: { gte: 2, lt: 4 } }), "lines of 'Treatment' ≥ 2 and < 4");
    assert.equal(text({ kind: "derived", metric: "followupMonths", range: { gte: 24 } }), "followupMonths ≥ 24 months");
    assert.equal(text({ kind: "caseList", id: "s1_sequenced" }), "in case list s1_sequenced");
    assert.equal(text({ kind: "caseList", category: "all_cases_with_cna_data" }), "in each study's case list of category all_cases_with_cna_data");
    assert.equal(text({ kind: "oql", q: "TP53: EXP>2", exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" }), "OQL[TP53: EXP>2] (EXP on rna_seq_v2_mrna_median_Zscores) (PROT on rppa_Zscores)");
    assert.equal(text({ kind: "oql", q: "TP53: EXP>2", exp: "rna_seq_v2_mrna_median_Zscores", ifHeld: true }),
      "OQL[TP53: EXP>2] (EXP on rna_seq_v2_mrna_median_Zscores) (in each study holding it; none in a study without it)");
    assert.equal(text({ kind: "split", part: "validation" }), "in the validation half (fixed held-out split)");
    assert.equal(text({ kind: "upload", dataset: "custom:mine" }), "with a row in upload mine");
    assert.equal(text({ kind: "genomicData", gene: "ERBB2", profileType: "mrna", range: { gt: 2 } }), 'ERBB2 mrna {"gt":2}');
    assert.equal(text({ kind: "genericAssay", entity: "1p", values: ["Loss"] }), '1p ["Loss"]');
    assert.equal(text({ kind: "proteinPosition", gene: "APC" }), "APC protein position {}");
    assert.equal(text({ kind: "sampleList", ids: ["s1:a"] }), "in a list of 1 sample");
    assert.equal(text({ kind: "patientList", ids: ["s1:a", "s2:b"] }), "in a list of 2 patients across 2 studies");
    assert.equal(text({ kind: "patientList" }), "in a list of 0 patients");
    assert.equal(text({ kind: "nonsense" }), "?");
  });
  test("timeline events: before, during, not followed by, a treatment line, and the prior-treatment guard", () => {
    const chemo = { eventType: "TREATMENT", attrs: [{ key: "AGENT", value: "Cisplatin" }], occurrence: "FIRST" };
    const prog = { eventType: "Progression (derived)", occurrence: "LAST" };
    assert.equal(text({ kind: "event", a: chemo, b: prog, rel: { type: "BEFORE", maxDays: 90 } }), "first Cisplatin treatment then last progression ≤90d");
    assert.equal(text({ a: chemo, b: prog, rel: { type: "DURING" } }), "last progression during first Cisplatin treatment");
    assert.equal(text({ kind: "event", a: chemo, b: { eventType: "STATUS" }, rel: { type: "NOT_FOLLOWED_BY", withinDays: 30 } }), "first Cisplatin treatment NOT followed by status ≤30d");
    assert.equal(text({ kind: "event", a: chemo, rel: { type: "HAS" }, priorGuard: true }), "has first Cisplatin treatment (treatment-naïve)");
    assert.equal(text({ kind: "event", a: null, rel: {} }), "has ?");
  });
  test("a treatment line reads its number from an equality or a comparison, or says n", () => {
    assert.equal(text({ kind: "event", a: { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" } }), "has line 2");
    assert.equal(text({ kind: "event", a: { eventType: LINE_TYPE, occurrence: "FIRST", numeric: { key: "LINE_NO", op: ">=", value: 3 } }, rel: {} }), "has first line ≥3");
    assert.equal(text({ kind: "event", a: { eventType: LINE_TYPE, numeric: { key: "LINE_NO", op: "=", value: 1 } }, rel: {} }), "has line 1");
    assert.equal(text({ kind: "event", a: { eventType: LINE_TYPE, numeric: { key: "LINE_NO", op: "!~", value: 1 } }, rel: {} }), "has line !~1");
    assert.equal(text({ kind: "event", a: { eventType: LINE_TYPE }, rel: {} }), "has line n");
  });
  test("negations and unions; cohortClauses normalises v1 sugar", () => {
    const f = { kind: "clinical", attribute: "SEX", op: "=", value: "F" };
    const s = { kind: "split", part: "discovery" };
    assert.equal(describeClause({ not: f }), "NOT SEX = F");
    assert.equal(describeClause({ not: { any: [f, s] } }), "NOT (SEX = F OR in the discovery half (fixed held-out split))");
    assert.equal(describeClause({ any: [f, s] }), "(SEX = F OR in the discovery half (fixed held-out split))");
    assert.deepEqual(cohortClauses(null), []);
    assert.deepEqual(cohortClauses({ all: [f] } as never), [f]);
    const v1 = { a: { eventType: "TREATMENT" }, rel: { type: "HAS" } };
    assert.deepEqual(cohortClauses(v1 as never), [v1]);
    assert.deepEqual(cohortClauses({} as never), []);
  });
});
