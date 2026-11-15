// OncoKB for structural variants, the parts that run without a database: the query one key is asked
// with, what is stored for its answer, and which keys a batch asks. Each test cites its row of the
// case table (Y*, S*) taken from cbioportal-frontend e9d70fb: OncoKbUtils.ts (OKU, in
// packages/oncokb-frontend-commons/src/util) and StoreUtils.ts (SU). Which structural variants become
// keys, with which SV type and tumour type, and the SV table's read are SQL, run against the fixture
// study by scripts/check-oncokb-sv.ts. OncoKB is a stubbed fetch.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ONCOKB_SV_TABLE, oncokbSvSource as src, storeRow, structuralVariantQuery, svKeySpace } from "../src/sources/oncokb-sv.ts";
import { ANNOTATION_SOURCES } from "../src/index.ts";
import { ONCOKB_SV_TABLE as APP_ONCOKB_SV_TABLE } from "../../../lib/annotation-store.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const EML4 = 27436, ALK = 238, KIF5B = 3799, RET = 5979, TTN = 7273, MUC16 = 94025, MET = 4233;
const LUAD = "Lung Adenocarcinoma";

interface Asked { path: string; body: unknown }
/**
 * OncoKB stand-in. Its cancer gene list curates EML4, ALK, RET and MET, lists KIF5B as not annotated
 * and leaves TTN and MUC16 out (as OncoKB's list does). Each structural-variant query is answered
 * with a level that names its tumour type, so a stored row shows which query it came from. The
 * source keeps the curated list for the process, so every test sees this one list.
 */
function oncokb(): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ path, body });
    if (path === "/utils/cancerGeneList")
      return Response.json([EML4, ALK, RET, MET].map((e) => ({ entrezGeneId: e, oncokbAnnotated: true })).concat([{ entrezGeneId: KIF5B, oncokbAnnotated: false }]));
    return Response.json((body as { tumorType: string | null }[]).map((q) => ({
      query: q, oncogenic: "Oncogenic", mutationEffect: { knownEffect: "Gain-of-function" },
      highestSensitiveLevel: q.tumorType === LUAD ? "LEVEL_1" : q.tumorType === null ? "LEVEL_4" : "LEVEL_3A",
      highestResistanceLevel: null, highestDiagnosticImplicationLevel: null, highestPrognosticImplicationLevel: null
    })));
  }) as typeof fetch;
  return asked;
}

/** one key row as svKeySpace returns it (all Strings, '' for a site with no gene and for no tumour type) */
const key = (site1: number | "", site2: number | "", svType: string, tumorType = LUAD) =>
  ({ site1_entrez: String(site1), site2_entrez: String(site2), sv_type: svType, tumor_type: tumorType });
/** what is sent: absent and undefined properties are the same once the body is JSON */
const sent = (q: object) => JSON.parse(JSON.stringify(q));
const svQueries = (asked: Asked[]) => asked.filter((a) => a.path === "/annotate/structuralVariants").flatMap((a) => a.body as Record<string, unknown>[]);

// ---- Y: the query for one key (generateAnnotateStructuralVariantQuery, OKU 284-317) ------------

test("Y1 both genes: geneA = site1, geneB = site2, FUSION, a functional fusion, the id site1_site2_TYPE_tumour type (OKU 89-100, 299-316)", () => {
  assert.deepEqual(sent(structuralVariantQuery(key(EML4, ALK, "FUSION"))), {
    id: "27436_238_FUSION_Lung_Adenocarcinoma", geneA: { entrezGeneId: EML4 }, geneB: { entrezGeneId: ALK },
    structuralVariantType: "FUSION", functionalFusion: true, tumorType: LUAD });
});

test("Y2 site1 = site2 (both set): two genes counted, so a functional fusion with geneA = geneB (OKU 299-303, two pushes)", () => {
  assert.deepEqual(sent(structuralVariantQuery(key(2263, 2263, "FUSION"))), {
    id: "2263_2263_FUSION_Lung_Adenocarcinoma", geneA: { entrezGeneId: 2263 }, geneB: { entrezGeneId: 2263 },
    structuralVariantType: "FUSION", functionalFusion: true, tumorType: LUAD });
});

// The portal's id is built from the API's StructuralVariant, which omits an absent site's Entrez id
// (cbioportal.org /api/structural-variant/fetch, skcm_tcga_pan_can_atlas_2018 TCGA-D9-A4Z5-01: no
// site1EntrezGeneId key), so the template literal writes "undefined" there (OKU 95).
test("Y3 site1 only: geneA = geneB = site1, the key's type (its class), not a functional fusion; the absent site2 is 'undefined' in the id (OKU 95, 306-311)", () => {
  assert.deepEqual(sent(structuralVariantQuery(key(675, "", "DELETION"))), {
    id: "675_undefined_DELETION_Lung_Adenocarcinoma", geneA: { entrezGeneId: 675 }, geneB: { entrezGeneId: 675 },
    structuralVariantType: "DELETION", functionalFusion: false, tumorType: LUAD });
});

test("Y4 site2 only: geneA = geneB = site2, not a functional fusion; the absent site1 is 'undefined' in the id (OKU 95, 301-311)", () => {
  assert.deepEqual(sent(structuralVariantQuery(key("", MET, "DUPLICATION"))), {
    id: "undefined_4233_DUPLICATION_Lung_Adenocarcinoma", geneA: { entrezGeneId: MET }, geneB: { entrezGeneId: MET },
    structuralVariantType: "DUPLICATION", functionalFusion: false, tumorType: LUAD });
});

test("Y5 one gene, a class OncoKB has no type for: the key's UNKNOWN is sent as UNKNOWN (OKU 273-276)", () => {
  const q = sent(structuralVariantQuery(key(5925, "", "UNKNOWN")));
  assert.equal(q.structuralVariantType, "UNKNOWN");
  assert.equal(q.functionalFusion, false);
  assert.equal(q.id, "5925_undefined_UNKNOWN_Lung_Adenocarcinoma");
});

test("Y6 one gene, class FUSION: type FUSION but not a functional fusion (OKU 273, 314)", () => {
  const q = sent(structuralVariantQuery(key(6098, "", "FUSION")));
  assert.deepEqual([q.structuralVariantType, q.functionalFusion, q.geneA, q.geneB], ["FUSION", false, { entrezGeneId: 6098 }, { entrezGeneId: 6098 }]);
});

test("T1 a key with no tumour type ('') is asked with tumorType null, sent as null, and its id has no tumour-type part (SU 913-920, OKU 96-98)", () => {
  const q = sent(structuralVariantQuery(key(EML4, ALK, "FUSION", "")));
  assert.ok("tumorType" in q, "tumorType is sent, as null");
  assert.equal(q.tumorType, null);
  assert.equal(q.id, "27436_238_FUSION");
});

test("Y10 the id replaces every whitespace with _, so it is the portal's dedup key (OKU 100)", () => {
  assert.equal(structuralVariantQuery(key(EML4, ALK, "FUSION", "Non-Small Cell Lung Cancer")).id, "27436_238_FUSION_Non-Small_Cell_Lung_Cancer");
});

test("Y no evidence types are sent: the whole answer (SU 868-875 passes none)", () => {
  const q = sent(structuralVariantQuery(key(EML4, ALK, "FUSION")));
  assert.ok(!("evidenceTypes" in q) || q.evidenceTypes == null, JSON.stringify(q));
});

// ---- S1: what is stored ------------------------------------------------------------------------

test("S1 OncoKB's oncogenicity, effect and four highest levels are stored, and its whole answer in data", () => {
  const a = { oncogenic: "Likely Oncogenic", mutationEffect: { knownEffect: "Gain-of-function" }, highestSensitiveLevel: "LEVEL_3A",
    highestResistanceLevel: "LEVEL_R2", highestDiagnosticImplicationLevel: "LEVEL_Dx2", highestPrognosticImplicationLevel: "LEVEL_Px1" };
  const r = storeRow(key(EML4, ALK, "FUSION"), a);
  assert.deepEqual([r.oncogenicity, r.mutation_effect, r.highest_sensitive_level, r.highest_resistance_level, r.highest_diagnostic_level, r.highest_prognostic_level],
    ["Likely Oncogenic", "Gain-of-function", "LEVEL_3A", "LEVEL_R2", "LEVEL_Dx2", "LEVEL_Px1"]);
  assert.deepEqual(JSON.parse(String(r.data)), a);
});

test("S1 the stored row is keyed by the four key columns, an absent site and no tumour type kept as ''", () => {
  const r = storeRow(key("", MET, "DUPLICATION", ""), { oncogenic: "Likely Oncogenic" });
  assert.deepEqual([r.site1_entrez, r.site2_entrez, r.sv_type, r.tumor_type], ["", "4233", "DUPLICATION", ""]);
});

test("S1 an answer with no oncogenic is stored as Unknown", () => {
  assert.equal(storeRow(key(EML4, ALK, "FUSION"), {}).oncogenicity, "Unknown");
  assert.equal(storeRow(key(EML4, ALK, "FUSION"), { oncogenic: "" }).oncogenicity, "Unknown");
});

// ---- Y8 Y9: which keys a batch asks (SU 861-866) -----------------------------------------------

test("Y8 Y9 a key is asked when either partner is curated; one with neither curated is stored unasked, oncogenicity empty (SU 861-866 `||`)", async () => {
  const asked = oncokb();
  const rows = await src.annotate([key(KIF5B, RET, "FUSION"), key(TTN, MUC16, "FUSION"), key(RET, KIF5B, "FUSION"), key(TTN, "", "UNKNOWN")]);
  const ids = svQueries(asked).map((q) => q.id).sort();
  assert.deepEqual(ids, ["3799_5979_FUSION_Lung_Adenocarcinoma", "5979_3799_FUSION_Lung_Adenocarcinoma"], "Y9 curated site2, and curated site1, are asked; Y8 is not");
  assert.equal(rows.length, 4, "every key gets a row, so the next sync does not pick the unasked ones up again");
  for (const [s1, s2] of [[String(TTN), String(MUC16)], [String(TTN), ""]]) {
    const r = rows.find((x) => x.site1_entrez === s1 && x.site2_entrez === s2)!;
    assert.deepEqual([r.oncogenicity, r.data], ["", ""], "Y8 S7 " + s1 + "/" + s2);
  }
  assert.equal(rows.find((x) => x.site1_entrez === String(KIF5B))!.oncogenicity, "Oncogenic");
});

test("Y4 Y9 a site2-only key whose gene is curated is asked (the absent site1 is no gene, not gene 0)", async () => {
  const asked = oncokb();
  await src.annotate([key("", MET, "DUPLICATION")]);
  assert.deepEqual(svQueries(asked).map((q) => q.id), ["undefined_4233_DUPLICATION_Lung_Adenocarcinoma"]);
});

test("the batch is POSTed to /annotate/structuralVariants, each key as the query the portal writes (SU 1049-1060)", async () => {
  const asked = oncokb();
  await src.annotate([key(EML4, ALK, "FUSION")]);
  const posts = asked.filter((a) => a.path === "/annotate/structuralVariants");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, [sent(structuralVariantQuery(key(EML4, ALK, "FUSION")))]);
});

test("S5 one pair in two tumour types is two queries, each stored with its own tumour type's level", async () => {
  const asked = oncokb();
  const rows = await src.annotate([key(EML4, ALK, "FUSION"), key(EML4, ALK, "FUSION", "Lung Squamous Cell Carcinoma"), key(EML4, ALK, "FUSION", "")]);
  assert.deepEqual(svQueries(asked).map((q) => q.tumorType as string | null).sort(), [LUAD, "Lung Squamous Cell Carcinoma", null].sort());
  const level = (t: string) => rows.find((r) => r.tumor_type === t)?.highest_sensitive_level;
  assert.equal(level(LUAD), "LEVEL_1");
  assert.equal(level("Lung Squamous Cell Carcinoma"), "LEVEL_3A");
  assert.equal(level(""), "LEVEL_4", "T1 the key with no tumour type is stored under '' with the null-tumour-type answer");
});

// ---- the source as the sync sees it ------------------------------------------------------------

test("S1 the source: id oncokb_sv, the four key columns, its own table, named alike by the app", () => {
  assert.equal(src.id, "oncokb_sv");
  assert.deepEqual(src.keyColumns, ["site1_entrez", "site2_entrez", "sv_type", "tumor_type"]);
  assert.equal(ONCOKB_SV_TABLE, "annotation.oncokb_sv");
  assert.equal(src.table, ONCOKB_SV_TABLE);
  assert.equal(APP_ONCOKB_SV_TABLE, ONCOKB_SV_TABLE);
});

test("it is registered after oncokb_tumor_type", () => {
  const ids = ANNOTATION_SOURCES.map((s) => s.id);
  assert.equal(ids.indexOf("oncokb_sv"), ids.indexOf("oncokb_tumor_type") + 1, ids.join(","));
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
    return url.endsWith("/utils/cancerGeneList") ? Response.json([{ entrezGeneId: ALK, oncokbAnnotated: true }]) : Response.json([]);
  }) as typeof fetch;
  await assert.rejects(src.annotate([key(EML4, ALK, "FUSION")]));
});

// The key space's SQL is run against the fixture by scripts/check-oncokb-sv.ts; here only how a study
// reaches it: quoted by sq(), scoping the structural variants and the samples' tumour types, and absent
// for every study.
test("key space: the study is quoted and scopes the variants and their tumour types; no study, no filter", () => {
  const one = svKeySpace("cbioportal", "o'brien_2024");
  assert.ok(one.includes(" AND cs.cancer_study_identifier = 'o\\'brien_2024'"));
  assert.ok(one.split("'o\\'brien_2024'").length - 1 >= 2, "the tumour-type subquery is scoped to the study too");
  const all = svKeySpace("cbioportal", null);
  assert.ok(!all.includes("o\\'brien") && !all.includes("AND cs.cancer_study_identifier ="));
  assert.ok(all.includes("FROM cbioportal.structural_variant sv"));
  assert.equal(src.keySpace("cbioportal", null), all);
});

test("its release is OncoKB's: the data version, with the API version alongside", async () => {
  globalThis.fetch = (async () => Response.json({ dataVersion: { version: "v8.1" }, apiVersion: { version: "v1.6" } })) as unknown as typeof fetch;
  assert.deepEqual(await src.release(), { version: "v8.1", extra: { api_version: "v1.6" } });
});
