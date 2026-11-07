// The signatures view (lib/views/signatures/): one cohort's patients with mutational-signature values
// and one patient's signatures — cBioPortal's Mutational Signatures tab. The runner is driven with a
// hand-made participant whose tables live in memory; the rules (data.ts), the row sources' SQL, the
// figure, the text and the method record are checked on their own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runSignatures } from "../lib/views/signatures/run.ts";
import { signaturePatientsSource, signatureValuesSource } from "../lib/views/signatures/sql.ts";
import { SIGNIFICANT_P, channelClass, defaultVersion, natural, pairsOf, pctText, signatureFamilies, signatureRows, spectrumOf, spectrumUnit, versionLabel } from "../lib/views/signatures/data.ts";
import { signaturesSvg, FIGURE_SIGNATURES } from "../lib/views/signatures/figure.ts";
import { signaturesKind } from "../lib/views/signatures/kind.ts";
import { signaturesMethod } from "../lib/views/signatures/method.ts";
import { pageSql } from "../lib/table-query.ts";
import { lintSvg } from "../lib/chart/lint.ts";
import { pagedTable } from "../lib/views/rows.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewParticipation, ViewResult } from "../lib/types.ts";
import type { TableQuery, RowSource } from "../lib/table-query.ts";
import type { SignaturesView, SignaturesResult } from "../lib/views/signatures/types.ts";

type Row = Record<string, unknown>;
const base = (label: string) => label.replace(/:(rows|counts|values|rank)$/, "");
const drawableOnly = (src: RowSource) => src.with.includes("WHERE profiled > 0");
const filtered = (rows: Row[], q: TableQuery) => {
  const f = q.filters?.patient as { op: string; value: string } | undefined;
  return rows.filter((r) => !f || r.patient === f.value);
};

const PROFILES = ["mutational_signatures_contribution_SBS", "mutational_signatures_pvalue_SBS", "mutational_signatures_counts_SBS", "mutational_signatures_contribution_ID", "other_assay"];
// P1: two samples (T2 not profiled for ID); P2: no values at all
const EVERYONE: Row[] = [
  { cohort: "A", study: "s1", patient: "P1", samples: 3, profiled: 2, types: "ID, SBS" },
  { cohort: "A", study: "s1", patient: "P2", samples: 1, profiled: 0, types: "" },
];
const SAMPLES = [{ sid: "T2", type: "Metastasis" }, { sid: "T1", type: "Primary" }, { sid: "T3", type: "Primary" }];
const pairs = (o: Record<string, number | null>) => Object.entries(o).map(([s, x]) => [s, x]);
const VALUES: Row[] = [
  { profile: "mutational_signatures_contribution_SBS", entity: "mutational_signature_contribution_SBS1", name: "SBS1", description: "Ageing", url: "https://x/sbs1", vals: pairs({ T1: 0.2, T2: 0.6 }) },
  { profile: "mutational_signatures_contribution_SBS", entity: "mutational_signature_contribution_SBS7a", name: "SBS7a (UV)", description: "", url: "", vals: pairs({ T1: 0.75, T2: 0.4 }) },
  { profile: "mutational_signatures_contribution_SBS", entity: "mutational_signature_contribution_SBS10", name: "SBS10", description: "", url: "", vals: pairs({ T1: 0.005, T2: null }) },
  { profile: "mutational_signatures_contribution_SBS", entity: "mutational_signature_contribution_SBS2", name: "SBS2", description: "", url: "", vals: pairs({ T1: 0, T2: 0 }) },
  { profile: "mutational_signatures_pvalue_SBS", entity: "mutational_signature_pvalue_SBS7a", name: "", description: "", url: "", vals: pairs({ T1: 0.01, T2: 0.2 }) },
  { profile: "mutational_signatures_counts_SBS", entity: "mutational_signatures_matrix_T_C-T_G", name: "T[C>T]G", description: "", url: "", vals: pairs({ T1: 30, T2: 5 }) },
  { profile: "mutational_signatures_counts_SBS", entity: "mutational_signatures_matrix_A_C-A_A", name: "A[C>A]A", description: "", url: "", vals: pairs({ T1: 10 }) },
  { profile: "mutational_signatures_contribution_ID", entity: "mutational_signature_contribution_ID1", name: "ID1", description: "", url: "", vals: pairs({ T1: 0.9 }) },
];
const tables = (o: { everyone?: Row[]; values?: Row[] } = {}) => (table: string, src: RowSource): Row[] => {
  switch (table) {
    case "signatures": case "signatures:everyone": case "signatures:member": {
      const all = o.everyone ?? EVERYONE;
      return drawableOnly(src) ? all.filter((r) => Number(r.profiled) > 0) : all;
    }
    case "signatures:samples": return SAMPLES.map((s) => ({ cohort: "A", study: "s1", patient: "P1", ...s }));
    case "signatures:values": return (o.values ?? VALUES).map((r) => ({ cohort: "A", study: "s1", patient: "P1", ...r }));
    default: throw new Error("unexpected table " + table);
  }
};

function local(t: ReturnType<typeof tables>) {
  const rows = (l: string, source: (db: string) => RowSource, q: TableQuery) => filtered(t(base(l), source("db")), q);
  return {
    instance: { id: "a", mode: "patient-level", label: "Local", conn: { id: "a", db: "db" } },
    cohortSql: () => "SELECT 1",
    rowsPage: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], limit: number, offset: number) => {
      const all = rows(l, source, q);
      return { rows: all.slice(offset, offset + limit), total: all.length };
    },
    rowsCounts: async (l: string, source: (db: string) => RowSource, q: TableQuery) => {
      const all = t(base(l), source("db")), kept = rows(l, source, q);
      return all.length ? [{ cohort: "A", study: "s1", n: kept.length, all: all.length }] : [];
    },
    rowsValues: async () => [{ v: "P1", n: 1, lo: "P1", hi: "P1" }],
    rowsRank: async (l: string, source: (db: string) => RowSource, q: TableQuery, _d: string[], study: string, patient: string) => {
      const i = rows(l, source, q).findIndex((r) => r.study === study && r.patient === patient);
      return i < 0 ? null : i;
    },
  };
}
const cohort = (): EvaluatedCohort => ({ studies: ["s1"], perStudy: { s1: { sql: "", count: 2, samples: 4, mode: "" } }, count: 2, samples: 4, text: "" });
function ctx(o: { t?: ReturnType<typeof tables>; ga?: string[]; resolver?: unknown; extra?: Partial<ViewRun>; two?: boolean } = {}): ViewRun {
  const cohorts: Record<string, EvaluatedCohort> = o.two ? { A: cohort(), B: cohort() } : { A: cohort() };
  return {
    doc: { study: "s1", cohorts: Object.fromEntries(Object.keys(cohorts).map((n) => [n, { study: "s1" }])), views: [] } as never,
    cohorts, resolvers: { s1: o.resolver ?? local(o.t ?? tables()) } as never, vNames: Object.keys(cohorts), vStudies: ["s1"],
    participationFor: (_s: string[], requiresPatientLevel: boolean): ViewParticipation => ({ studies: [], requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: o.ga ?? PROFILES }), ...(o.extra || {}),
  };
}
const run = (view: Partial<SignaturesView>, c: ViewRun = ctx()) => runSignatures({ kind: "signatures", cohorts: ["A"], ...view } as SignaturesView, c);
const sig = (v: ViewResult) => (v as ViewResult & { signatures: SignaturesResult }).signatures;
const err = (v: ViewResult) => (v as { error?: string }).error;

describe("the rules", () => {
  test("profiles group by type; the type shown first is the portal's", () => {
    assert.deepEqual(signatureFamilies(PROFILES), [
      { version: "ID", contribution: "mutational_signatures_contribution_ID", pvalue: null, counts: null },
      { version: "SBS", contribution: "mutational_signatures_contribution_SBS", pvalue: "mutational_signatures_pvalue_SBS", counts: "mutational_signatures_counts_SBS" },
    ]);
    assert.equal(defaultVersion(["v2", "v3"]), "v3");
    assert.equal(defaultVersion(["DBS", "ID", "SBS"]), "SBS");
    assert.equal(defaultVersion(["DBS", "ID"]), "DBS");
    assert.equal(defaultVersion([]), null);
    assert.equal(versionLabel("DBS"), "Double base substitutions (DBS)");
    assert.equal(versionLabel("ID"), "Small insertions and deletions (ID)");
    assert.equal(versionLabel("v2"), "COSMIC v2 signatures");
    assert.equal(versionLabel("X"), "X");
    assert.equal(spectrumUnit("DBS"), "double base substitutions");
    assert.equal(spectrumUnit("ID"), "indels");
    assert.equal(spectrumUnit("v2"), "mutations");
    assert.ok(natural("SBS2", "SBS10a") < 0);
  });
  test("a share is written as the portal's table writes it; NA is not 0", () => {
    assert.equal(pctText(0.004), "<1%");
    assert.equal(pctText(0), "<1%");
    assert.equal(pctText(0.756), "76%");
    assert.equal(pctText(null), "NA");
  });
  test("pairs read from arrays or objects; a value that is not a number is null", () => {
    const m = pairsOf([["T1", 0.5], { 1: "T2", 2: null }, ["T3", "x"]]);
    assert.deepEqual([...m], [["T1", 0.5], ["T2", null], ["T3", null]]);
    assert.equal(pairsOf(null).size, 0);
  });
  test("signatures pair with their p-values by key, and sort by the first sample", () => {
    const rows = signatureRows(VALUES.filter((r) => r.profile === "mutational_signatures_contribution_SBS").map((r) => ({ ...r, vals: pairsOf(r.vals) }) as never),
      [{ entity: "mutational_signature_pvalue_SBS7a", vals: pairsOf(pairs({ T1: 0.01 })) }], ["T1", "T2"]);
    assert.deepEqual(rows.map((r) => r.name), ["SBS7a (UV)", "SBS1", "SBS10", "SBS2"]);
    assert.deepEqual(rows[0].values, [{ value: 0.75, p: 0.01 }, { value: 0.4, p: null }]);
    assert.deepEqual(rows[2].values[1], { value: null, p: null });
  });
  test("channels take COSMIC's classes and order", () => {
    assert.deepEqual(channelClass("A[C>T]G").group, "C>T");
    assert.equal(channelClass("CT>AG").group, "CT>NN");
    assert.equal(channelClass("1:Del:T:3").group, "1bp deletion");
    assert.equal(channelClass("1:Ins:C:0").group, "1bp insertion");
    assert.equal(channelClass("3:Del:R:2").group, ">1bp deletion");
    assert.equal(channelClass("4:Ins:R:0").group, ">1bp insertion");
    assert.equal(channelClass("5:Del:M:1").group, "Microhomology");
    assert.equal(channelClass("weird").group, "other");
    const names = ["5:Del:M:1", "2:Del:R:0", "1:Ins:T:0", "1:Del:T:5", "1:Del:C:1", "1:Del:C:0", "2:Ins:R:3", "zz", "T[C>A]A", "A[C>A]A", "AC>CA"];
    const sp = spectrumOf(names.map((n) => ({ entity: "e_" + n, name: n, vals: new Map([["S", 1]]) })), "S");
    assert.deepEqual(sp.channels.map((c) => c.label), ["A[C>A]A", "T[C>A]A", "AC>CA", "1:Del:C:0", "1:Del:C:1", "1:Del:T:5", "1:Ins:T:0", "2:Del:R:0", "2:Ins:R:3", "5:Del:M:1", "zz"]);
    assert.equal(sp.total, names.length);
    // a channel with no name takes its label from the entity id; a sample without a count has no channel
    const own = spectrumOf([{ entity: "mutational_signatures_matrix_A_C-A_A", name: "", vals: new Map([["S", 2]]) }, { entity: "x", name: "y", vals: new Map() }], "S");
    assert.deepEqual(own.channels.map((c) => c.label), ["A_C-A_A"]);
  });
});

describe("the row sources", () => {
  const part = { cohort: "A", study: "s1", cohortSql: "SELECT '' AS sid, '' AS pid" };
  test("the list counts each patient's samples with a value, in the study's own profiles", () => {
    const sql = pageSql(signaturePatientsSource([{ ...part, profiles: ["mutational_signatures_contribution_SBS"] }], "db"), {}, [], 10, 0);
    assert.match(sql, /profile_stable_id IN \('s1_mutational_signatures_contribution_SBS'\)/);
    assert.match(sql, /WHERE profiled > 0/);
    assert.match(sql, /patient_unique_id, 's1_', ''\) IN \(SELECT pid FROM c0\)/);
    const cohortOnly = pageSql(signaturePatientsSource([{ ...part, profiles: [] }], "db", "cohort", false), {}, [], 10, 0);
    assert.match(cohortOnly, /profile_type IN \(''\)/);
    assert.match(cohortOnly, /sample_unique_id, 's1_', ''\) IN \(SELECT sid FROM c0\)/);
    assert.doesNotMatch(cohortOnly, /WHERE profiled > 0/);
    assert.throws(() => signaturePatientsSource([], "db"));
  });
  test("one patient's values name the patient, and with samples: cohort only the cohort's", () => {
    const sql = pageSql(signatureValuesSource(part, "P-1", "db", ["mutational_signatures_contribution_SBS"], "cohort"), {}, [], 10, 0);
    assert.match(sql, /patient_unique_id = 's1_P-1'/);
    assert.match(sql, /ck AS \(SELECT/);
    assert.doesNotMatch(pageSql(signatureValuesSource(part, "P-1", "db", []), {}, [], 10, 0), /ck AS/);
  });
});

describe("the runner", () => {
  test("draws the list's first patient: SBS (the portal's pick), significance and the first sample's spectrum", async () => {
    const v = await run({});
    assert.equal(err(v), undefined);
    const s = sig(v);
    assert.equal(s.patient!.id, "P1");
    assert.deepEqual(s.patient!.samples.map((x) => x.id), ["T1", "T3", "T2"]);
    assert.deepEqual(s.versions, ["ID", "SBS"]);
    assert.equal(s.version, "SBS");
    assert.deepEqual(s.profiled, ["T1", "T2"]);
    assert.deepEqual(s.notProfiled, ["T3"]);
    assert.deepEqual(s.signatures.map((r) => r.name), ["SBS7a (UV)", "SBS1", "SBS10", "SBS2"]);
    assert.equal(s.signatures[0].values[0].p, 0.01);
    assert.equal(s.spectrum!.sample, "T1");
    assert.equal(s.spectrum!.total, 40);
    assert.deepEqual(s.spectrum!.channels.map((c) => c.label), ["A[C>A]A", "T[C>T]G"]);
    assert.deepEqual(s.counted, ["T1", "T2"]);
    assert.deepEqual(s.position, { index: 0, prev: null, next: null });
    assert.match(String((v as { caveat?: string }).caveat), /Significant \(p < 0\.05 in mutational_signatures_pvalue_SBS\): 1 signature–sample value/);
    assert.match(String((v as { caveat?: string }).caveat), /T3 is not profiled/);
    assert.equal(pagedTable(v), s);
    // the method's script check: the total and each channel's share
    assert.equal(v.method!.check!["signatures:total"].v, 40);
    assert.equal(v.method!.check!["signatures:T[C>T]G:percent"].v, 75);
  });
  test("version, sample and counts are the spec's", async () => {
    const s = sig(await run({ patient: { study: "s1", id: "P1" }, sample: "T2", scale: "count" }));
    assert.equal(s.spectrum!.sample, "T2");
    assert.equal(s.spectrum!.total, 5);
    assert.equal(s.scale, "count");
    const id = await run({ version: "ID" });
    assert.equal(sig(id).version, "ID");
    assert.equal(sig(id).spectrum, null);
    assert.match(String(sig(id).noSpectrum), /no ID counts profile/);
    assert.match(String((id as { caveat?: string }).caveat), /no p-value profile for ID/);
  });
  test("a page of the list is the list alone", async () => {
    const s = sig(await run({}, ctx({ extra: { page: { offset: 0, limit: 10 } } })));
    assert.equal(s.patient, null);
    assert.deepEqual(s.rows.map((r) => r.patient), ["P1"]);
    assert.equal(s.rows[0].values[1], 3);
  });
  test("refuses loudly, naming what there is", async () => {
    const cases: [Partial<SignaturesView>, RegExp, ViewRun?][] = [
      [{ rows: 0 }, /rows \(the page size/],
      [{ patient: { study: "s1", id: "bad id!" } }, /patient is \{study, id\}/],
      [{ version: "S B S" }, /version is a signature type/],
      [{ sample: "bad sample!" }, /sample is one of/],
      [{ scale: "log" as never }, /scale is "percent"/],
      [{ samples: "all" as never }, /samples is "patient"/],
      [{ sort: { column: "nope" } }, /nope/],
      [{}, /pages only its patient list/, ctx({ extra: { table: "x" } })],
      [{}, /one cohort's patients; this one draws 2/, ctx({ two: true })],
      [{ version: "DBS" }, /no study of this cohort has DBS signatures.*signature types here: ID, SBS/],
      [{}, /has a mutational-signature profile.*its generic-assay profiles: other_assay/, ctx({ ga: ["other_assay"] })],
      [{}, /it has no generic-assay profiles/, ctx({ ga: [] })],
      [{ patient: { study: "s2", id: "P1" } }, /which this view's cohort does not span/],
      [{ patient: { study: "s1", id: "P2" } }, /P2 has no mutational-signature values in s1 \(1 sample, none profiled\); signature types s1 holds: ID, SBS/],
      [{ patient: { study: "s1", id: "P9" } }, /P9 is not a patient of this cohort/],
      [{ sample: "T9" }, /sample T9 is not one of P1's samples \(T1, T3, T2\)/],
      [{ sample: "T3" }, /T3 has no SBS mutation counts; samples with counts: T1, T2/],
      [{}, /none of this cohort's 2 patients has mutational-signature values/, ctx({ t: tables({ everyone: EVERYONE.map((r) => ({ ...r, profiled: 0 })) }) })],
      [{ filters: { patient: { op: "equals", value: "P5" } } }, /keeps none of the 1 patient/],
      [{}, /P1 has no mutational-signature values in s1/, ctx({ t: tables({ values: [] }) })],
      [{}, /aggregate-only/, ctx({ resolver: { instance: { id: "agg", mode: "aggregate-only", label: "agg", conn: { id: "agg" } } } })],
    ];
    for (const [view, re, c] of cases) assert.match(String(err(await run(view, c))), re, JSON.stringify(view));
    // a type the patient has no values in, though the study holds it
    const noId = tables({ values: VALUES.filter((r) => !String(r.profile).endsWith("_ID")) });
    assert.match(String(err(await run({ version: "ID" }, ctx({ t: noId })))), /P1 has no ID signature values; P1 has values for SBS/);
    // a database error is the view's refusal
    const failing = { ...local(tables()), rowsPage: async () => { throw new Error("boom"); } };
    assert.match(String(err(await run({}, ctx({ resolver: failing })))), /boom/);
  });
});

describe("the figure, text and method", () => {
  const result = async (view: Partial<SignaturesView> = {}) => run(view) as Promise<ViewResult & { signatures: SignaturesResult }>;
  test("draws the bars and the spectrum, and says what it leaves out", async () => {
    const v = await result();
    const svg = signaturesSvg(v as never, { width: 800, theme: "light" })!;
    assert.match(svg, /Signature contributions/);
    assert.match(svg, /T1's mutational spectrum — 40 single base substitutions/);
    assert.match(svg, /SBS7a \(UV\) in T1: 75\.0%, p = 0\.010 \(significant\)/);
    assert.match(svg, /Not profiled for mutational signatures: T3/);
    assert.deepEqual(lintSvg(svg), []);
    assert.equal(signaturesKind.figure!(v as never, { width: 600 }) != null, true);
    // many signatures: the figure draws FIGURE_SIGNATURES, the rest are counted
    const many = { ...v, signatures: { ...v.signatures, profiles: { ...v.signatures.profiles!, pvalue: null }, spectrum: null, noSpectrum: "none here",
      signatures: Array.from({ length: FIGURE_SIGNATURES + 3 }, (_, i) => ({ entity: "e" + i, name: "S" + i, description: "", url: "", values: [{ value: 0.01, p: null }, { value: null, p: null }] })) } };
    const big = signaturesSvg(many as never, { width: 800 })!;
    assert.match(big, /3 more signatures with a contribution above zero/);
    assert.match(big, /records no p-values/);
    assert.match(big, /none here\./);
    const none = { ...v, signatures: { ...v.signatures, signatures: [], profiled: ["T1"], notProfiled: [] } };
    assert.match(signaturesSvg(none as never, { caption: false })!, /No signature contributes above zero/);
    assert.equal(signaturesSvg({ ...v, signatures: { ...v.signatures, patient: null } } as never), null);
    const counts = await result({ scale: "count" });
    assert.match(signaturesSvg(counts as never)!, /Mutations/);
  });
  test("the text lists the signatures above zero and the largest channels", async () => {
    const v = await result();
    const out: string[] = [];
    const t = { out, pFmt: String, caveatOf: () => "", noteOf: () => "", plotUnit: () => "", methodOf: () => "" };
    signaturesKind.text!(v as never, t);
    assert.match(out[0], /SBS7a \(UV\): 75% \* \| 40%/);
    assert.match(out[0], /… 1 more signatures at 0/);
    assert.match(out[0], /T1's spectrum: 40 mutations in 2 channels; largest: T\[C>T\]G 30 \(75\.0%\)/);
    assert.match(out[0], /Not profiled for mutational signatures: T3/);
    assert.equal(signaturesKind.title!(v as never), "Mutational signatures — P1");
    const empty: string[] = [];
    signaturesKind.text!({ ...v, signatures: { ...v.signatures, patient: null } } as never, { ...t, out: empty });
    assert.match(empty[0], /patients to choose from/);
    assert.equal(SIGNIFICANT_P, 0.05);
  });
  test("the method record recomputes the spectrum's shares, or says there is nothing to compute", () => {
    const common = { cohorts: ["A"], queryText: "", sortName: "Samples", desc: true, shown: 1, lists: [], excluded: [], instances: 1, patient: { study: "s1", id: "P1" }, version: "SBS",
      profiles: { contribution: "c", pvalue: "p", counts: "n" }, profiled: ["T1"], signatures: 2 };
    const m = signaturesMethod({ ...common, spectrum: { sample: "T1", total: 0, channels: [{ entity: "e", label: "A[C>A]A", group: "C>A", count: 0 }] } });
    assert.match(m.python!, /RESULT\["signatures:total"\]/);
    assert.equal(m.check!["signatures:A[C>A]A:percent"].v, 0);
    const n = signaturesMethod({ ...common, spectrum: null });
    assert.equal(n.python, undefined);
    assert.match(n.verification!, /nothing is computed/);
  });
});
