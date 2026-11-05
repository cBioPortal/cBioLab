// The data sets catalog (lib/datasets.ts): every study each instance holds, with how many samples
// carry each kind of data — counts only, restricted studies left out as the router leaves them out,
// a failed side query costing its column and never the row, and an instance that does not answer
// named rather than silently missing. The warehouse is a stand-in (setChTransport) per instance.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_URL = "http://primary.invalid";
process.env.CLICKHOUSE_DB = "cbio_a";
process.env.CLICKHOUSE2_URL = "http://secondary.invalid";
process.env.CLICKHOUSE2_DB = "cbio_b";
for (const k of ["LOOPBACK_PEER", "LOOPBACK_PEER_LABEL", "STUDY_DENY", "STUDY_ALLOW_RESTRICTED", "CLICKHOUSE_LABEL", "CLICKHOUSE2_LABEL"]) delete process.env[k];

const { setChTransport, PRIMARY, secondary } = await import("../lib/ch.ts");
const { datasetsFor, allDatasets } = await import("../lib/datasets.ts");

type Rows = Record<string, unknown>[];
/** what one instance answers: rows per table the catalog reads, or "fail" */
interface Instance { cancer_study: Rows | "fail"; sample_derived?: Rows | "fail"; copy_number_seg?: Rows | "fail"; clinical_event_derived?: Rows | "fail";
  genetic_profile?: Rows | "fail"; allele_specific_copy_number?: Rows | "fail"; type_of_cancer?: Rows | "fail" }
let instances: Record<string, Instance> = {};
let sent: { conn: string; query: string }[] = [];

const study = (o: Record<string, unknown>) => ({ cid: 1, name: "A study", toc: "brca", citation: "", pmid: "", build: "GRCh37", samples: 0, mutation: 0, cna: 0,
  sv: 0, mrna_expr: 0, rnaseq: 0, microarray: 0, rppa: 0, ms: 0, treatments: 0, ...o });

setChTransport(async (st) => {
  const q = st.query;
  sent.push({ conn: st.conn.id, query: q });
  const inst = instances[st.conn.id];
  if (!inst) throw new Error("instance " + st.conn.id + " is down");
  // the table a statement reads first
  const table = (/FROM \w+\.(\w+)/.exec(q)?.[1] ?? "") as keyof Instance;
  const rows = inst[table] ?? [];
  if (rows === "fail") throw new Error("table " + table + " failed");
  return JSON.stringify({ data: rows, meta: [], rows: rows.length });
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; instances = {}; delete process.env.STUDY_DENY; delete process.env.LOOPBACK_PEER; delete process.env.LOOPBACK_PEER_LABEL; });

const conn = { ...PRIMARY, id: "a", label: "Primary", db: "cbio_a" };

test("a study's row: its names, citation, PubMed ids, build, and the instance it is on", async () => {
  instances.a = {
    cancer_study: [study({ id: "brca_x", cid: 7, name: "Breast X", toc: "brca", citation: "Smith et al. 2020", pmid: "123, 456;x  789", build: "GRCh38" })],
    type_of_cancer: [{ id: "brca", name: "Invasive Breast Carcinoma" }],
  };
  const [r] = await datasetsFor(conn);
  assert.equal(r.id, "brca_x");
  assert.equal(r.name, "Breast X");
  assert.equal(r.cancerType, "Invasive Breast Carcinoma");
  assert.equal(r.citation, "Smith et al. 2020");
  assert.deepEqual(r.pmids, ["123", "456", "789"], "only numeric ids are PubMed ids");
  assert.equal(r.build, "GRCh38");
  assert.equal(r.instance, "a");
  assert.equal(r.instanceLabel, "Primary");
  assert.ok(sent.every((s) => !/\bFROM (?!cbio_a\.)\w+\.\w+/.test(s.query)), "every table is read from the instance's own database");
});

test("missing names and citations: the cancer type's id, no citation, no PubMed ids, an unknown build", async () => {
  instances.a = { cancer_study: [study({ id: "s", toc: "xyz", citation: null, pmid: null, build: null })] };
  const [r] = await datasetsFor(conn);
  assert.equal(r.cancerType, "xyz");
  assert.equal(r.citation, null);
  assert.deepEqual(r.pmids, []);
  assert.equal(r.build, "unknown");
});

test("patients and samples are counted from the study's samples; samples fall back to the study's own count", async () => {
  instances.a = {
    cancer_study: [study({ id: "s1", cid: 1, samples: 999 }), study({ id: "s2", cid: 2, samples: 40 })],
    sample_derived: [{ id: "s1", patients: "10", samples: "12" }],
  };
  const rows = await datasetsFor(conn);
  const s1 = rows.find((r) => r.id === "s1")!, s2 = rows.find((r) => r.id === "s2")!;
  assert.deepEqual([s1.patients, s1.samples], [10, 12]);
  assert.deepEqual([s2.patients, s2.samples], [0, 40]);
});

test("data type counts: mutations, CNA, SV, protein, mRNA and its RNA-seq and microarray columns", async () => {
  instances.a = {
    cancer_study: [
      study({ id: "own", cid: 1, mutation: 5, cna: 4, sv: 3, mrna_expr: 2, rnaseq: 6, microarray: 1, rppa: 7, ms: 9, treatments: 8 }),
      study({ id: "seq", cid: 2, mrna_expr: 20 }),
      study({ id: "array", cid: 3, mrna_expr: 30 }),
      study({ id: "both", cid: 4, mrna_expr: 40 }),
    ],
    genetic_profile: [
      { cid: 2, types: ["MRNA_EXPRESSION"], ga: [], has_rnaseq: 1, has_array: 0 },
      { cid: 3, types: ["MRNA_EXPRESSION"], ga: [], has_rnaseq: 0, has_array: 1 },
      { cid: 4, types: ["MRNA_EXPRESSION"], ga: [], has_rnaseq: 1, has_array: 1 },
    ],
  };
  const by = Object.fromEntries((await datasetsFor(conn)).map((r) => [r.id, r]));
  assert.deepEqual({ mutation: by.own.mutation, cna: by.own.cna, sv: by.own.sv, treatments: by.own.treatments }, { mutation: 5, cna: 4, sv: 3, treatments: 8 });
  assert.equal(by.own.mrna, 6, "mRNA is the largest of the expression counts");
  assert.equal(by.own.protein, 9, "protein is the larger of RPPA and mass spectrometry");
  assert.deepEqual([by.own.rnaseq, by.own.microarray], [6, 1], "a study's own RNA-seq and microarray counts are used as they are");
  assert.deepEqual([by.seq.rnaseq, by.seq.microarray], [20, 0], "an RNA-seq expression profile counts as RNA-seq");
  assert.deepEqual([by.array.rnaseq, by.array.microarray], [0, 30], "a microarray profile counts as microarray");
  assert.deepEqual([by.both.rnaseq, by.both.microarray], [40, 0], "with both, the expression count is RNA-seq's");
});

test("segments, timeline, methylation, allele-specific copy number and generic assays", async () => {
  instances.a = {
    cancer_study: [study({ id: "s1", cid: 1 }), study({ id: "s2", cid: 2 }), study({ id: "s3", cid: 3 })],
    copy_number_seg: [{ cid: 1, n: "11" }],
    clinical_event_derived: [{ id: "s1", n: "22" }],
    genetic_profile: [
      { cid: 1, types: ["METHYLATION", "MUTATION_EXTENDED"], ga: ["MUTATIONAL_SIGNATURE", "ARMLEVEL_CNA", ""] },
      { cid: 2, types: ["GENERIC_ASSAY"], ga: ["METHYLATION", "TREATMENT_RESPONSE"] },
    ],
    allele_specific_copy_number: [{ cid: 2 }],
  };
  const by = Object.fromEntries((await datasetsFor(conn)).map((r) => [r.id, r]));
  assert.deepEqual([by.s1.segments, by.s1.timeline], [11, 22]);
  assert.equal(by.s1.methylation, true, "methylation as its own profile type");
  assert.equal(by.s2.methylation, true, "methylation as a generic assay");
  assert.equal(by.s3.methylation, false);
  assert.deepEqual(by.s1.genericAssays, ["ARMLEVEL_CNA", "MUTATIONAL_SIGNATURE"], "sorted, empty dropped");
  assert.deepEqual(by.s2.genericAssays, ["TREATMENT_RESPONSE"], "methylation is its own column, not a generic assay");
  assert.deepEqual([by.s1.ascn, by.s2.ascn, by.s3.ascn], [false, true, false]);
  assert.deepEqual([by.s3.segments, by.s3.timeline, by.s3.genericAssays], [0, 0, []]);
});

test("restricted studies are left out, as the router leaves them out", async () => {
  instances.a = { cancer_study: [
    study({ id: "public_one", name: "GENIE v2.0-public" }),
    study({ id: "genie_c", name: "GENIE v3.1-consortium" }),
    study({ id: "x_private", name: "X" }),
    study({ id: "denied", name: "Denied" }),
    study({ id: "glass", name: "GLASS Consortium" }),
  ] };
  process.env.STUDY_DENY = "denied";
  assert.deepEqual((await datasetsFor(conn)).map((r) => r.id).sort(), ["glass", "public_one"]);
});

test("a failed side query empties its column, never the row; a failed study list fails the instance", async () => {
  instances.a = {
    cancer_study: [study({ id: "s1", cid: 1, samples: 5 })],
    sample_derived: [{ id: "s1", patients: 3, samples: 5 }],
    copy_number_seg: "fail", clinical_event_derived: "fail", genetic_profile: "fail", allele_specific_copy_number: "fail", type_of_cancer: "fail",
  };
  const [r] = await datasetsFor(conn);
  assert.equal(r.id, "s1");
  assert.deepEqual([r.patients, r.samples, r.segments, r.timeline, r.methylation, r.ascn, r.genericAssays, r.cancerType], [3, 5, 0, 0, false, false, [], "brca"]);
  instances.a = { cancer_study: "fail" };
  await assert.rejects(datasetsFor(conn), /cancer_study failed/);
  instances.a = { cancer_study: [study({ id: "s1" })], sample_derived: "fail" };
  await assert.rejects(datasetsFor(conn), /sample_derived failed/, "patient and sample counts are not a side column");
});

test("every instance's catalog: first instance wins an id, largest studies first", async () => {
  instances.a = { cancer_study: [study({ id: "shared", name: "on a", samples: 10 }), study({ id: "small", cid: 2, samples: 1 })] };
  instances.b = { cancer_study: [study({ id: "shared", name: "on b", samples: 100 }), study({ id: "big", cid: 3, samples: 50 })] };
  const r = await allDatasets();
  assert.deepEqual(r.rows.map((x) => x.id), ["big", "shared", "small"]);
  assert.equal(r.rows.find((x) => x.id === "shared")!.name, "on a");
  assert.equal(r.rows.find((x) => x.id === "big")!.instance, "b");
  assert.deepEqual(r.unreachable, []);
  assert.deepEqual(r.viaFederation, []);
});

test("an instance that does not answer is named; the others are still listed", async () => {
  instances.a = { cancer_study: [study({ id: "s1", samples: 1 })] };
  const r = await allDatasets();
  assert.deepEqual(r.rows.map((x) => x.id), ["s1"]);
  assert.deepEqual(r.unreachable, [secondary()!.label]);
});

test("the simulated peer's studies are not read directly: the peer is named instead", async () => {
  instances.a = { cancer_study: [study({ id: "s1" })] };
  instances.b = { cancer_study: [study({ id: "peer_study" })] };
  process.env.LOOPBACK_PEER = "b";
  const r = await allDatasets();
  assert.deepEqual(r.rows.map((x) => x.id), ["s1"]);
  assert.ok(!sent.some((s) => s.conn === "b"), "nothing was asked of the peer's instance");
  assert.deepEqual(r.viaFederation, [secondary()!.label]);
  process.env.LOOPBACK_PEER_LABEL = "Peer hospital";
  assert.deepEqual((await allDatasets()).viaFederation, ["Peer hospital"]);
});
