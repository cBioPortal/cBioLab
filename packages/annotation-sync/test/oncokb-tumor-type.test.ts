// OncoKB by tumour type, the parts that run without a database: how one key is asked of OncoKB, what
// is stored for its answer, and which keys a batch asks. Each test cites its row of the case table
// (T*, Q*, S*) taken from cbioportal-frontend e9d70fb: StoreUtils.ts (SU), OncoKbUtils.ts (OKU),
// DefaultMutationMapperDataFetcher.ts (DMF), DefaultMutationMapperStore.ts (DMS). The key space's SQL
// (which mutations become keys, with which tumour type) and the mutation table's read are run against
// the fixture study by scripts/check-oncokb-tumor-type.ts. OncoKB is a stubbed fetch.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { oncokbTumorTypeSource as src, proteinChangeQuery, storeRow, tumorTypeKeySpace } from "../src/sources/oncokb-tumor-type.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const EGFR = 1956, KRAS = 3845, NOTKB = 999, UNLISTED = 123456;

interface Asked { path: string; body: unknown }
/**
 * OncoKB stand-in. Its cancer gene list curates EGFR and KRAS, lists NOTKB as not annotated and
 * leaves UNLISTED out. Each byProteinChange query is answered with a level that names its tumour
 * type, so a stored row shows which query it came from. The source keeps the curated list for the
 * process, so every test sees this one list.
 */
function oncokb(): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ path, body });
    if (path === "/utils/cancerGeneList")
      return Response.json([{ entrezGeneId: EGFR, oncokbAnnotated: true }, { entrezGeneId: KRAS, oncokbAnnotated: true }, { entrezGeneId: NOTKB, oncokbAnnotated: false }]);
    return Response.json((body as { tumorType: string | null }[]).map((q) => ({
      oncogenic: "Oncogenic", mutationEffect: { knownEffect: "Gain-of-function" },
      highestSensitiveLevel: q.tumorType === "Lung Adenocarcinoma" ? "LEVEL_1" : q.tumorType === null ? "LEVEL_4" : "LEVEL_3A",
      highestResistanceLevel: null, highestDiagnosticImplicationLevel: null, highestPrognosticImplicationLevel: null
    })));
  }) as typeof fetch;
  return asked;
}

/** one key row as the key space returns it (all Strings) */
const key = (gene: string, entrez: number, alteration: string, consequence: string, tumorType: string, start = "858", end = start) => ({
  alteration_type: "MUTATION", hugo_gene_symbol: gene, alteration, consequence, tumor_type: tumorType,
  entrez_gene_id: String(entrez), protein_start: start, protein_end: end
});
const L858R = (tumorType: string) => key("EGFR", EGFR, "L858R", "Missense_Mutation", tumorType);
/** what is sent: absent and undefined properties are the same once the body is JSON */
const sent = (q: object) => JSON.parse(JSON.stringify(q));
const byProteinChange = (asked: Asked[]) => asked.filter((a) => a.path === "/annotate/mutations/byProteinChange");

test("Q5 a key is asked by Entrez id, protein change, mutation type, positions and tumour type, somatic, with no evidence types (OKU 169-196, DMF 353-364)", () => {
  assert.deepEqual(sent(proteinChangeQuery(L858R("Lung Adenocarcinoma"))), {
    alteration: "L858R", consequence: "Missense_Mutation", gene: { entrezGeneId: EGFR }, proteinStart: 858, proteinEnd: 858,
    tumorType: "Lung Adenocarcinoma", germline: false });
});

test("T1 T2 the tumour type asked with is the key's, as the key space chose it (detailed type)", () => {
  assert.equal(proteinChangeQuery(L858R("Lung Squamous Cell Carcinoma")).tumorType, "Lung Squamous Cell Carcinoma");
});

test("T4 T5 a key with no tumour type ('') is asked with tumorType null, not '' (SU 919 `|| null`)", () => {
  const q = sent(proteinChangeQuery(L858R("")));
  assert.equal(q.tumorType, null);
  assert.ok("tumorType" in q, "tumorType is sent, as null");
});

test("Q9 protein positions that are absent (0 or empty) are sent as absent, not 0", () => {
  for (const blank of ["0", ""]) {
    const q = sent(proteinChangeQuery(key("EGFR", EGFR, "L858R", "Missense_Mutation", "Lung Adenocarcinoma", blank)));
    assert.ok(!("proteinStart" in q) && !("proteinEnd" in q), JSON.stringify(blank) + " → " + JSON.stringify(q));
  }
});

test("Q9b the importer's unknown position -1 (MUTATED, extensions: 87k warehouse rows) is passed on as the portal passes it (DMF 361-362)", () => {
  const q = sent(proteinChangeQuery(key("EGFR", EGFR, "MUTATED", "Splice_Region", "Lung Adenocarcinoma", "-1")));
  assert.equal(q.proteinStart, -1);
  assert.equal(q.proteinEnd, -1);
});

test("S1 OncoKB's oncogenicity, effect and four highest levels are stored, and its whole answer in data", () => {
  const a = { oncogenic: "Likely Oncogenic", mutationEffect: { knownEffect: "Loss-of-function" }, highestSensitiveLevel: "LEVEL_4",
    highestResistanceLevel: "LEVEL_R2", highestDiagnosticImplicationLevel: "LEVEL_Dx1", highestPrognosticImplicationLevel: "LEVEL_Px3" };
  const r = storeRow(key("TP53", 7157, "R175H", "Missense_Mutation", "Glioma", "175"), a);
  assert.deepEqual([r.oncogenicity, r.mutation_effect, r.highest_sensitive_level, r.highest_resistance_level, r.highest_diagnostic_level, r.highest_prognostic_level],
    ["Likely Oncogenic", "Loss-of-function", "LEVEL_4", "LEVEL_R2", "LEVEL_Dx1", "LEVEL_Px3"]);
  assert.deepEqual(JSON.parse(String(r.data)), a);
});

test("S1 the stored row is keyed by the key's five columns, the tumour type '' kept as ''", () => {
  const r = storeRow(L858R(""), { oncogenic: "Oncogenic" });
  assert.deepEqual([r.alteration_type, r.hugo_gene_symbol, r.alteration, r.consequence, r.tumor_type], ["MUTATION", "EGFR", "L858R", "Missense_Mutation", ""]);
  assert.ok(!("entrez_gene_id" in r) && !("protein_start" in r), "the key space's extra columns are not stored");
});

test("S2 an answer with no oncogenic is stored as Unknown", () => {
  assert.equal(storeRow(L858R("Lung Adenocarcinoma"), {}).oncogenicity, "Unknown");
  assert.equal(storeRow(L858R("Lung Adenocarcinoma"), { oncogenic: "" }).oncogenicity, "Unknown");
});

test("Q1 Q2 only genes OncoKB curates are asked; the others (listed not annotated, or not listed) are stored unasked (DMF 313-320, DMS 976)", async () => {
  const asked = oncokb();
  const rows = await src.annotate([
    L858R("Lung Adenocarcinoma"),
    key("NOTKB", NOTKB, "A1V", "Missense_Mutation", "Lung Adenocarcinoma", "1"),
    key("UNLISTED", UNLISTED, "B2W", "Missense_Mutation", "Lung Adenocarcinoma", "2")
  ]);
  const queries = byProteinChange(asked).flatMap((a) => a.body as { gene: { entrezGeneId: number } }[]);
  assert.deepEqual(queries.map((q) => q.gene.entrezGeneId), [EGFR]);
  assert.equal(rows.length, 3, "every key gets a row, so the next sync does not pick the unasked ones up again");
  for (const g of ["NOTKB", "UNLISTED"]) {
    const r = rows.find((x) => x.hugo_gene_symbol === g)!;
    assert.deepEqual([r.oncogenicity, r.data], ["", ""], g);
  }
  assert.equal(rows.find((x) => x.hugo_gene_symbol === "EGFR")!.oncogenicity, "Oncogenic");
});

test("Q5 a batch sends each key as the query the portal writes, with no evidence types", async () => {
  const asked = oncokb();
  await src.annotate([L858R("Lung Adenocarcinoma")]);
  const [q] = byProteinChange(asked).flatMap((a) => a.body as Record<string, unknown>[]);
  assert.equal(q.alteration, "L858R");
  assert.equal(q.consequence, "Missense_Mutation");
  assert.deepEqual(q.gene, { entrezGeneId: EGFR });
  assert.equal(q.tumorType, "Lung Adenocarcinoma");
  assert.equal(q.germline, false);
  assert.ok(!("evidenceTypes" in q) || q.evidenceTypes == null, "no evidence types: the whole answer");
});

test("Q7 S6 one alteration in two tumour types is two queries, each stored with its own tumour type's level", async () => {
  const asked = oncokb();
  const rows = await src.annotate([L858R("Lung Adenocarcinoma"), L858R("Lung Squamous Cell Carcinoma"), L858R("")]);
  const queries = byProteinChange(asked).flatMap((a) => a.body as { tumorType: string | null }[]);
  assert.deepEqual(queries.map((q) => q.tumorType).sort(), ["Lung Adenocarcinoma", "Lung Squamous Cell Carcinoma", null].sort());
  const level = (t: string) => rows.find((r) => r.tumor_type === t)?.highest_sensitive_level;
  assert.equal(level("Lung Adenocarcinoma"), "LEVEL_1");
  assert.equal(level("Lung Squamous Cell Carcinoma"), "LEVEL_3A");
  assert.equal(level(""), "LEVEL_4", "T4 the key with no tumour type is stored under '' with the null-tumour-type answer");
});

test("Q6 the key is gene, alteration, mutation type and tumour type: the portal's query id (OKU 103) less the Entrez id the gene names", () => {
  assert.deepEqual(src.keyColumns, ["alteration_type", "hugo_gene_symbol", "alteration", "consequence", "tumor_type"]);
});

// Not from the case table: the source's licence (it is OncoKB's data) and a guard against storing
// an answer under the wrong key.
test("it is licensed like OncoKB: the OncoKB writer and token", () => {
  assert.equal(src.writer, "oncokb");
  assert.deepEqual(src.needs, ["ONCOKB_TOKEN"]);
});

test("an answer that does not match the queries one for one fails the batch rather than mislabelling keys", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith("/utils/cancerGeneList") ? Response.json([{ entrezGeneId: EGFR, oncokbAnnotated: true }]) : Response.json([]);
  }) as typeof fetch;
  await assert.rejects(src.annotate([L858R("Lung Adenocarcinoma")]));
});

// The key space's SQL is run against the fixture by scripts/check-oncokb-tumor-type.ts; here only how a
// study reaches it: quoted by sq(), on both the clinical and the mutation table, and absent for every study.
test("key space: the study is quoted and scopes both tables; no study, no filter", () => {
  const one = tumorTypeKeySpace("cbioportal", "o'brien_2024");
  assert.equal(one.split("cancer_study_identifier = 'o\\'brien_2024'").length - 1, 1);
  assert.equal(one.split("m.studyId = 'o\\'brien_2024'").length - 1, 1);
  const all = tumorTypeKeySpace("cbioportal", null);
  assert.ok(!all.includes("o\\'brien") && !all.includes("m.studyId = "));
  assert.ok(all.includes("FROM cbioportal.mutation_derived"));
});
