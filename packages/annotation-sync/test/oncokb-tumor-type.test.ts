// OncoKB by tumour type: the key space asks the warehouse for what the portal's mutation table asks
// OncoKB about, and a batch is asked the way the portal asks it. OncoKB is a stubbed fetch.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { oncokbTumorTypeSource as src, proteinChangeQuery, storeRow, tumorTypeKeySpace } from "../src/sources/oncokb-tumor-type.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Asked { path: string; body: unknown }
/** OncoKB stand-in: curates KRAS (3845) and TP53 (7157) only; answers each query with a level that names its tumour type */
function oncokb(): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace("https://www.oncokb.org/api/v1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ path, body });
    if (path === "/utils/cancerGeneList")
      return Response.json([{ entrezGeneId: 3845, oncokbAnnotated: true }, { entrezGeneId: 7157, oncokbAnnotated: true }, { entrezGeneId: 999, oncokbAnnotated: false }]);
    return Response.json((body as { tumorType: string | null }[]).map((q) => ({
      oncogenic: "Oncogenic", mutationEffect: { knownEffect: "Gain-of-function" },
      highestSensitiveLevel: q.tumorType === "Pancreatic Adenocarcinoma" ? "LEVEL_3A" : "LEVEL_4", highestResistanceLevel: null,
      highestDiagnosticImplicationLevel: "LEVEL_Dx2", highestPrognosticImplicationLevel: null
    })));
  }) as typeof fetch;
  return asked;
}

const key = (gene: string, entrez: number, alteration: string, tumorType: string) => ({
  alteration_type: "MUTATION", hugo_gene_symbol: gene, alteration, consequence: "Missense_Mutation", tumor_type: tumorType,
  entrez_gene_id: String(entrez), protein_start: "12", protein_end: "12"
});

test("the key space is one row per gene, protein change, mutation type and tumour type of a study's somatic mutations", () => {
  const sql = tumorTypeKeySpace("cbio", "s'1");
  assert.match(sql, /FROM cbio\.mutation_derived m/);
  assert.match(sql, /GROUP BY hugo_gene_symbol, alteration, consequence, tumor_type$/);
  assert.match(sql, /AND m\.studyId = 's\\'1'/);
  assert.match(sql, /cancer_study_identifier = 's\\'1'/);
  // germline calls go to OncoKB by HGVSc, fusions as structural variants: neither is a key here
  assert.match(sql, /lower\(ifNull\(m\.mutationStatus, ''\)\) != 'germline'/);
  assert.match(sql, /ifNull\(m\.mutationType, ''\) != 'Fusion'/);
  assert.match(sql, /ifNull\(m\.proteinChange, ''\) != ''/);
  assert.doesNotMatch(tumorTypeKeySpace("cbio", null), /studyId =|cancer_study_identifier =/);
});

test("the tumour type is the sample's detailed cancer type, the study's for a sample with no cancer type, and none for CANCER_TYPE alone", () => {
  const sql = tumorTypeKeySpace("cbio", "s");
  // the sample's CANCER_TYPE and CANCER_TYPE_DETAILED, counted apart
  assert.match(sql, /countIf\(attribute_name = 'CANCER_TYPE_DETAILED'\) AS n_detailed/);
  assert.match(sql, /WHERE type = 'sample' AND attribute_name IN \('CANCER_TYPE', 'CANCER_TYPE_DETAILED'\)/);
  // no row of either: the study's cancer type; a row of CANCER_TYPE alone: ''
  assert.match(sql, /if\(c\.sample_unique_id = '', ifNull\(st\.name, ''\), if\(c\.n_detailed > 0, c\.detailed, ''\)\) AS tumor_type/);
  assert.match(sql, /cbio\.type_of_cancer t ON t\.type_of_cancer_id = s\.type_of_cancer_id/);
  assert.match(sql, /c\.sample_unique_id = concat\(m\.studyId, '_', m\.sampleId\)/);
});

test("a key is asked as the portal asks it: by Entrez id, with its consequence and positions, and no tumour type as null", () => {
  assert.deepEqual(proteinChangeQuery(key("KRAS", 3845, "G12D", "Pancreatic Adenocarcinoma")), {
    alteration: "G12D", consequence: "Missense_Mutation", gene: { entrezGeneId: 3845 }, proteinStart: 12, proteinEnd: 12,
    tumorType: "Pancreatic Adenocarcinoma", germline: false });
  const bare = proteinChangeQuery({ ...key("KRAS", 3845, "G12D", ""), consequence: "", protein_start: "0", protein_end: "0" });
  assert.equal(bare.tumorType, null);
  assert.equal(bare.consequence, undefined);
  assert.equal(bare.proteinStart, undefined);
});

test("only curated genes are asked about; the others are stored unasked, so the next sync does not pick them up", async () => {
  const asked = oncokb();
  const rows = await src.annotate([
    key("KRAS", 3845, "G12D", "Pancreatic Adenocarcinoma"),
    key("KRAS", 3845, "G12D", "Adrenocortical Carcinoma"),
    key("NOTKB", 999, "A1V", "Pancreatic Adenocarcinoma")
  ]);
  assert.deepEqual(asked.map((a) => a.path), ["/utils/cancerGeneList", "/annotate/mutations/byProteinChange"]);
  assert.equal((asked[1].body as unknown[]).length, 2);
  assert.equal(rows.length, 3);
  // the level is the tumour type's
  const level = (t: string) => rows.find((r) => r.hugo_gene_symbol === "KRAS" && r.tumor_type === t)!.highest_sensitive_level;
  assert.equal(level("Pancreatic Adenocarcinoma"), "LEVEL_3A");
  assert.equal(level("Adrenocortical Carcinoma"), "LEVEL_4");
  const unasked = rows.find((r) => r.hugo_gene_symbol === "NOTKB")!;
  assert.deepEqual([unasked.oncogenicity, unasked.data], ["", ""]);
  // the store's columns only: the extra key-space columns are not written
  assert.ok(!("entrez_gene_id" in rows[0]));

  // the curated list is asked once per process
  await src.annotate([key("TP53", 7157, "R175H", "")]);
  assert.equal(asked.filter((a) => a.path === "/utils/cancerGeneList").length, 1);
});

test("a stored row keeps all four highest levels and OncoKB's whole answer for the card", () => {
  const a = { oncogenic: "Likely Oncogenic", mutationEffect: { knownEffect: "Loss-of-function" }, highestSensitiveLevel: "LEVEL_4",
    highestResistanceLevel: "LEVEL_R2", highestDiagnosticImplicationLevel: "LEVEL_Dx1", highestPrognosticImplicationLevel: "LEVEL_Px3" };
  const r = storeRow(key("TP53", 7157, "R175H", "Glioma"), a);
  assert.deepEqual([r.oncogenicity, r.mutation_effect, r.highest_sensitive_level, r.highest_resistance_level, r.highest_diagnostic_level, r.highest_prognostic_level],
    ["Likely Oncogenic", "Loss-of-function", "LEVEL_4", "LEVEL_R2", "LEVEL_Dx1", "LEVEL_Px3"]);
  assert.deepEqual(JSON.parse(String(r.data)), a);
  assert.equal(storeRow(key("TP53", 7157, "R175H", ""), {}).oncogenicity, "Unknown");
});

test("an answer that does not match the queries one for one fails the batch rather than mislabelling keys", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith("/utils/cancerGeneList") ? Response.json([{ entrezGeneId: 3845, oncokbAnnotated: true }]) : Response.json([]);
  }) as typeof fetch;
  await assert.rejects(src.annotate([key("KRAS", 3845, "G12D", "")]), /OncoKB answered 0 for 1 queries/);
});

test("it is licensed like OncoKB: the OncoKB writer and token, and the same release", () => {
  assert.equal(src.id, "oncokb_tumor_type");
  assert.equal(src.writer, "oncokb");
  assert.deepEqual(src.needs, ["ONCOKB_TOKEN"]);
  assert.deepEqual(src.keyColumns, ["alteration_type", "hugo_gene_symbol", "alteration", "consequence", "tumor_type"]);
});
