// Partitions: one cohort split into disjoint, exhaustive child cohorts, resolved before compilation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolvePartitions, planPartition, comparableChildren, assertPartitionChildrenFit } from "../lib/cohort-partitions.ts";
import { resolveExtends } from "../lib/cohort-extends.ts";
import type { AnalysisDoc, Clause, CohortDef, Leaf } from "../lib/types.ts";

const luad: CohortDef = { all: [{ kind: "clinical", attribute: "CANCER_TYPE_DETAILED", values: ["Lung Adenocarcinoma"] }] };
const g12c: Clause = { kind: "oql", q: "KRAS: G12C" };
const krasMut: Clause = { kind: "oql", q: "KRAS: MUT" };
const krasProfiled: Leaf = { kind: "profiled", type: "MUTATION", gene: "KRAS" };

function doc(partitions: Record<string, any> | undefined, cohorts: AnalysisDoc["cohorts"] = { LUAD: luad }): any {
  return { cohorts, partitions };
}
const resolve = (d: any) => resolvePartitions(d, d.partitions || {});

// Simulate membership: evaluate a resolved cohort def against an in-memory patient table, using
// the same meaning the compiler gives each clause (a `not` is "base patients EXCEPT").
type Patient = Record<string, unknown>;
function matches(p: Patient, c: Clause): boolean {
  const any = (c as { any?: Leaf[] }).any;
  if (any) return any.some((l) => matches(p, l));
  const not = (c as { not?: Clause }).not;
  if (not) return !matches(p, not);
  const l = c as Record<string, any>;
  if (l.kind === "profiled") return (p.profiled as string[]).includes(l.gene + ":" + l.type);
  if (l.kind === "oql") {
    const [gene, spec] = String(l.q).split(":").map((x) => x.trim());
    return (p.alts as string[]).includes(gene + ":" + spec) || (spec === "MUT" && (p.alts as string[]).some((a) => a.startsWith(gene + ":")));
  }
  if (l.kind === "clinical") {
    const v = p[l.attribute];
    if (l.op === "!=" && l.value === "") return v != null && v !== "";
    if (l.values) return l.values.includes(v);
    return v === l.value;
  }
  throw new Error("unsimulated " + JSON.stringify(l));
}
const member = (p: Patient, def: CohortDef) => (def.all || []).every((c) => matches(p, c));

describe("planPartition", () => {
  test("first match wins, with a not-profiled child ahead of the first OQL arm", () => {
    const { plan, defs } = planPartition("KRAS", { of: "LUAD", arms: [{ name: "G12C", where: g12c }, { name: "Other KRAS", where: krasMut }] }, luad);
    assert.deepEqual(plan.children.map((c) => [c.label, c.role]), [
      ["Not profiled: KRAS mutations", "notEvaluable"],
      ["G12C", "arm"],
      ["Other KRAS", "arm"],
      ["Other", "other"]
    ]);
    assert.deepEqual(defs["KRAS / Not profiled: KRAS mutations"].all, [{ not: krasProfiled }]);
    assert.deepEqual(defs["KRAS / G12C"].all, [krasProfiled, g12c]);
    // the second arm excludes the first; the shared profiling requirement is not repeated
    assert.deepEqual(defs["KRAS / Other KRAS"].all, [krasProfiled, { not: g12c }, krasMut]);
    // every "not an earlier arm" shares one clause
    assert.deepEqual(defs["KRAS / Other"].all, [krasProfiled, { not: { any: [g12c, krasMut] } }]);
    for (const d of Object.values(defs)) assert.equal(d.extends, "LUAD");
  });

  test("children are an exact partition of the parent", () => {
    const { defs } = planPartition("P", { of: "LUAD", arms: [
      { name: "G12C", where: g12c },
      { name: "Subtype A", where: { kind: "clinical", attribute: "SUBTYPE", op: "=", value: "A" } },
      { name: "TP53", where: { kind: "oql", q: "TP53: MUT" } }
    ] }, luad);
    const patients: Patient[] = [];
    // every combination of profiling, alteration and subtype
    for (const kp of [true, false]) for (const tp of [true, false]) for (const sub of ["A", "B", undefined])
      for (const alts of [[], ["KRAS:G12C"], ["KRAS:G12D"], ["TP53:MUT"], ["KRAS:G12C", "TP53:MUT"]])
        patients.push({ profiled: [...(kp ? ["KRAS:MUTATION"] : []), ...(tp ? ["TP53:MUTATION"] : [])], alts, SUBTYPE: sub });
    for (const p of patients) {
      const hits = Object.entries(defs).filter(([, d]) => member(p, d)).map(([n]) => n);
      assert.equal(hits.length, 1, "patient " + JSON.stringify(p) + " landed in " + JSON.stringify(hits));
    }
  });

  test("a long list of arms stays within a cohort's 8 clauses", () => {
    const arms = Array.from({ length: 8 }, (_, i) => ({ name: "v" + i, where: { kind: "clinical", attribute: "SUBTYPE", values: ["v" + i] } as Clause }));
    const { defs } = planPartition("P", { of: "LUAD", arms }, luad);
    for (const d of Object.values(defs)) assert.ok(d.all!.length <= 3, JSON.stringify(d.all));
    assert.deepEqual(defs["P / Other"].all, [{ kind: "clinical", attribute: "SUBTYPE", op: "!=", value: "" }, { not: { any: arms.map((a) => a.where as Leaf) } }]);
  });

  test("a child that would exceed 8 clauses after extends is refused by name", () => {
    const deep: CohortDef = { all: Array.from({ length: 7 }, (_, i) => ({ kind: "clinical", attribute: "A" + i, values: ["x"] } as Clause)) };
    const { doc: out, plans } = resolve(doc({ K: { of: "LUAD", arms: [{ name: "G12C", where: g12c }] } }, { LUAD: deep }));
    assert.throws(() => assertPartitionChildrenFit(resolveExtends(out).cohorts, plans), /“G12C” needs 9 conditions/);
  });

  test("a negated arm is negated back without double negation", () => {
    const wt: Clause = { not: krasMut as Leaf };
    const { defs } = planPartition("P", { of: "LUAD", arms: [{ name: "wild-type", where: wt }] }, luad);
    assert.deepEqual(defs["P / Other"].all, [krasProfiled, krasMut]);
  });

  test("bare OQL needs every alteration type profiled; a clinical arm needs a recorded value", () => {
    const { plan } = planPartition("P", { of: "LUAD", arms: [
      { name: "KRAS altered", where: { kind: "oql", q: "KRAS" } },
      { name: "Stage IV", where: { kind: "clinical", attribute: "STAGE", values: ["IV"] } }
    ] }, luad);
    assert.deepEqual(plan.children.filter((c) => c.role === "notEvaluable").map((c) => c.label), [
      "Not profiled: KRAS mutations", "Not profiled: KRAS copy number", "Not profiled: KRAS structural variants", "No STAGE recorded"
    ]);
  });

  test("conditions it cannot check are named, not assumed known", () => {
    const { plan } = planPartition("P", { of: "LUAD", arms: [
      { name: "high", where: { kind: "genomicData", gene: "EGFR", profileType: "mrna", range: { gt: 2 } } }
    ] }, luad);
    assert.deepEqual(plan.unchecked, ["EGFR mrna"]);
    assert.equal(plan.children.filter((c) => c.role === "notEvaluable").length, 0);
  });

  test("children run where the parent runs", () => {
    const { defs } = planPartition("P", { of: "X", arms: [{ name: "a", where: g12c }] }, { ...luad, studies: ["s1", "s2"], lineGap: 90 });
    assert.deepEqual(defs["P / a"].studies, ["s1", "s2"]);
    assert.equal(defs["P / a"].lineGap, 90);
  });

  test("a custom remainder name", () => {
    const { plan } = planPartition("P", { of: "LUAD", arms: [{ name: "mut", where: krasMut }], other: "KRAS wild-type" }, luad);
    assert.equal(plan.children.at(-1)!.name, "P / KRAS wild-type");
  });

  test("refusals are loud and specific", () => {
    assert.throws(() => planPartition("P", { of: "LUAD", arms: [] }, luad), /at least one arm/);
    assert.throws(() => planPartition("P", { of: "LUAD", arms: [{ name: "", where: g12c }] }, luad), /needs a name/);
    assert.throws(() => planPartition("P", { of: "LUAD", arms: [{ name: "a", where: g12c }, { name: "a", where: krasMut }] }, luad), /both be named “a”/);
    assert.throws(() => planPartition("P", { of: "LUAD", arms: [{ name: "Other", where: g12c }] }, luad), /both be named “Other”/);
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: "a" + i, where: g12c }));
    assert.throws(() => planPartition("P", { of: "LUAD", arms: nine }, luad), /at most 8/);
    assert.throws(() => planPartition("P", { of: "LUAD", arms: [{ name: "x", where: { kind: "oql", q: "{{{" } }] }, luad), /OQL/);
  });

  test("comparable children leave out the not-evaluable buckets", () => {
    const { plan } = planPartition("K", { of: "LUAD", arms: [{ name: "G12C", where: g12c }] }, luad);
    assert.deepEqual(comparableChildren(plan), ["K / G12C", "K / Other"]);
  });
});

describe("resolvePartitions", () => {
  test("no partitions: the document is returned as is", () => {
    const d = doc(undefined);
    assert.equal(resolve(d).doc, d);
  });

  test("children become ordinary cohorts that resolve through extends", () => {
    const { doc: out } = resolve(doc({ K: { of: "LUAD", arms: [{ name: "G12C", where: g12c }] } }));
    const flat = resolveExtends(out);
    assert.deepEqual(flat.cohorts["K / G12C"].all, [...luad.all!, krasProfiled, g12c]);
    assert.equal(flat.cohorts["K / G12C"].extends, undefined);
    assert.deepEqual(flat.cohorts.LUAD, luad);
  });

  test("a partition can split another partition's child, in any declaration order", () => {
    const { doc: out, plans } = resolve(doc({
      "G12C by stage": { of: "K / G12C", arms: [{ name: "IV", where: { kind: "clinical", attribute: "STAGE", values: ["IV"] } }] },
      K: { of: "LUAD", arms: [{ name: "G12C", where: g12c }] }
    }));
    assert.deepEqual(plans.map((p) => p.name), ["G12C by stage", "K"]);
    const flat = resolveExtends(out);
    assert.deepEqual(flat.cohorts["G12C by stage / IV"].all, [
      ...luad.all!, krasProfiled, g12c,
      { kind: "clinical", attribute: "STAGE", op: "!=", value: "" }, { kind: "clinical", attribute: "STAGE", values: ["IV"] }
    ]);
  });

  test("unknown parents, cycles and name clashes are refused", () => {
    assert.throws(() => resolve(doc({ K: { of: "nope", arms: [{ name: "a", where: g12c }] } })), /unknown cohort “nope”/);
    assert.throws(() => resolve(doc({
      A: { of: "B / x", arms: [{ name: "x", where: g12c }] },
      B: { of: "A / x", arms: [{ name: "x", where: g12c }] }
    })), /splits its own descendant/);
    assert.throws(() => resolve(doc({ LUAD: { of: "LUAD", arms: [{ name: "a", where: g12c }] } })), /same name as a cohort/);
    assert.throws(() => resolve(doc({ K: { of: "LUAD", arms: [{ name: "a", where: g12c }] } }, { LUAD: luad, "K / a": luad })), /already exists/);
    assert.throws(() => resolve(doc({ K: { arms: [{ name: "a", where: g12c }] } as never })), /needs `of`/);
  });
});

import { armsFromSelection, withoutChart, renamePartitionChild } from "../lib/partition-arms.ts";

describe("arms from Explore's selection in one chart", () => {
  const stage = (vals: string[]) => ({ kind: "clinical", attribute: "STAGE", values: vals } as Clause);
  test("each selected value of a categorical chart becomes an arm; the rest of the selection is the parent", () => {
    const r = armsFromSelection({ all: [luad.all![0], stage(["IV", "III"])] }, { kind: "clinical", attribute: "STAGE" })!;
    assert.deepEqual(r.base.all, [luad.all![0]]);
    assert.deepEqual(r.arms.map((a) => a.name), ["IV", "III"]);
    assert.deepEqual(r.arms[0].where, { kind: "clinical", attribute: "STAGE", values: ["IV"] });
  });
  test("each clicked histogram bin becomes an arm with its own range", () => {
    const bins: Clause[] = [{ kind: "clinical", attribute: "TMB", range: { gt: 10, lte: 20 } }, { kind: "clinical", attribute: "TMB", range: { gt: 20 } }];
    const r = armsFromSelection({ all: bins }, { kind: "clinical", attribute: "TMB" })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["> 10 and ≤ 20", "> 20"]);
    assert.deepEqual(r.base.all, []);
  });
  test("a gene table takes only its own kind of OQL entry", () => {
    const r = armsFromSelection({ all: [{ kind: "oql", q: "KRAS: MUT; EGFR: AMP; STK11: MUT" }] }, { kind: "genes", specs: [": MUT"] })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["KRAS: MUT", "STK11: MUT"]);
    assert.deepEqual(r.base.all, [{ kind: "oql", q: "EGFR: AMP" }]);
  });
  test("a chart with nothing selected gives nothing", () => {
    assert.equal(armsFromSelection({ all: [luad.all![0]] }, { kind: "clinical", attribute: "STAGE" }), null);
  });
  test("an attribute is one chart, whatever level a study records it at", () => {
    const r = armsFromSelection({ all: [{ kind: "clinical", attribute: "X", values: ["a"] }, { kind: "clinical", attribute: "X", values: ["b"] }] },
      { kind: "clinical", attribute: "X" })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["a", "b"]);
    assert.equal(r.base.all.length, 0);
  });
});

describe("groups from a chart's checked rows", () => {
  test("the chart's own filter leaves what the groups are drawn from", () => {
    const base = withoutChart({ all: [luad.all![0], { kind: "clinical", attribute: "STAGE", values: ["I", "II"] } as Clause] }, { kind: "clinical", attribute: "STAGE" });
    assert.deepEqual(base, [luad.all![0]]);
  });
  test("a generic-assay chart drops its own clause and keeps another entity's", () => {
    const mine = { kind: "genericAssay", profileType: "armlevel_cna", entity: "8q_status", values: ["Gain"] } as Clause;
    const other = { kind: "genericAssay", profileType: "armlevel_cna", entity: "1p_status", values: ["Loss"] } as Clause;
    assert.deepEqual(withoutChart({ all: [mine, other] }, { kind: "assay", profileType: "armlevel_cna", entity: "8q_status" }), [other]);
  });
});

describe("renaming a partition's child", () => {
  const d = (): any => ({ partitions: {
    K: { of: "LUAD", arms: [{ name: "G12C", where: g12c }, { name: "KRAS mutated", where: krasMut }] },
    S: { of: "K / G12C", arms: [{ name: "F", where: g12c }] } },
    views: [{ kind: "survival", cohorts: ["K / G12C", "K"] }] });
  test("an arm: the arm, views naming it and splits of it all follow", () => {
    const out = renamePartitionChild(d(), "K", "G12C", "KRAS G12C");
    assert.equal(out.partitions.K.arms[0].name, "KRAS G12C");
    assert.equal(out.partitions.S.of, "K / KRAS G12C");
    assert.deepEqual((out.views[0] as any).cohorts, ["K / KRAS G12C", "K"]);
  });
  test("the remainder", () => {
    assert.equal(renamePartitionChild(d(), "K", "Other", "KRAS wild-type").partitions.K.other, "KRAS wild-type");
  });
  test("clashes and blanks are refused", () => {
    assert.throws(() => renamePartitionChild(d(), "K", "G12C", "KRAS mutated"), /already has a row/);
    assert.throws(() => renamePartitionChild(d(), "K", "G12C", "  "), /cannot be empty/);
  });
});

import { expandSplits, splitsDrawn, viewDrawProblem } from "../lib/partition-arms.ts";

describe("a view's cohort list: a cohort is itself, a split is its arms", () => {
  const parts = [
    { name: "KRAS-mutant / K", of: "KRAS-mutant", comparable: ["KRAS-mutant / K / G12C", "KRAS-mutant / K / other", "KRAS-mutant / K / Other"] },
    { name: "KRAS-mutant / K / G12C / S", of: "KRAS-mutant / K / G12C", comparable: ["KRAS-mutant / K / G12C / S / F", "KRAS-mutant / K / G12C / S / Other"] }
  ];
  test("a split cohort named in a view is the whole cohort", () => {
    assert.deepEqual(expandSplits(["EGFR-mutant", "KRAS-mutant"], parts), ["EGFR-mutant", "KRAS-mutant"]);
  });
  test("the split's name is its arms and Other; an arm split again stays one arm", () => {
    assert.deepEqual(expandSplits(["KRAS-mutant / K"], parts), ["KRAS-mutant / K / G12C", "KRAS-mutant / K / other", "KRAS-mutant / K / Other"]);
  });
  test("parent and split in one list; nothing listed twice", () => {
    assert.deepEqual(expandSplits(["KRAS-mutant", "KRAS-mutant / K", "KRAS-mutant / K / other"], parts),
      ["KRAS-mutant", "KRAS-mutant / K / G12C", "KRAS-mutant / K / other", "KRAS-mutant / K / Other"]);
  });
  test("a nested split is chosen by its own name", () => {
    assert.deepEqual(expandSplits(["KRAS-mutant / K / G12C / S"], parts), ["KRAS-mutant / K / G12C / S / F", "KRAS-mutant / K / G12C / S / Other"]);
  });
});

describe("a view draws from at most one split", () => {
  const parts = [
    { name: "N / KRAS", of: "N", comparable: ["N / KRAS / G12C", "N / KRAS / Other"] },
    { name: "N / stage", of: "N", comparable: ["N / stage / I", "N / stage / Other"] },
    { name: "E / sex", of: "E", comparable: ["E / sex / F", "E / sex / Other"] },
    { name: "N / KRAS / G12C / sex", of: "N / KRAS / G12C", comparable: ["N / KRAS / G12C / sex / F", "N / KRAS / G12C / sex / Other"] }
  ];
  test("whole cohorts and one split's groups are one split", () => {
    assert.deepEqual(splitsDrawn(["E", "N / KRAS / G12C", "N / KRAS / Other"], parts), ["N / KRAS"]);
    assert.deepEqual(splitsDrawn(["E", "N"], parts), []);
  });
  test("two splits — of one cohort, of different cohorts, or nested — are told apart", () => {
    assert.deepEqual(splitsDrawn(["N / KRAS", "N / stage / I"], parts), ["N / KRAS", "N / stage"]);
    assert.deepEqual(splitsDrawn(["N / KRAS", "E / sex"], parts), ["N / KRAS", "E / sex"]);
    assert.deepEqual(splitsDrawn(["N / KRAS / Other", "N / KRAS / G12C / sex / F"], parts), ["N / KRAS", "N / KRAS / G12C / sex"]);
  });
});

describe("a view draws whole cohorts or one split's groups, not both", () => {
  const parts = [
    { name: "N / KRAS", of: "N", comparable: ["N / KRAS / G12C", "N / KRAS / Other"] },
    { name: "N / stage", of: "N", comparable: ["N / stage / I", "N / stage / Other"] }
  ];
  test("whole cohorts together, or one split's groups together, are fine", () => {
    assert.equal(viewDrawProblem(["E", "N"], parts), null);
    assert.equal(viewDrawProblem(["N / KRAS"], parts), null);
    assert.equal(viewDrawProblem(["N / KRAS / G12C", "N / KRAS / Other"], parts), null);
  });
  test("a whole cohort beside a split's groups is refused, naming both", () => {
    assert.match(viewDrawProblem(["E", "N / KRAS / G12C"], parts)!, /whole cohorts or the groups of one split, not both; this one names “E” beside “N \/ KRAS”/);
  });
  test("two splits are refused, naming both", () => {
    assert.match(viewDrawProblem(["N / KRAS", "N / stage / I"], parts)!, /“N \/ KRAS” and “N \/ stage”/);
  });
});
