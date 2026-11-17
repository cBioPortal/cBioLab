// OncoKB's cancer gene list, the parts that run without a database: the row stored for a gene that
// the list has and for one it does not, how a batch asks for the list, and the source as the sync
// sees it. Each test cites its row of the case table (C*). The portal's rule is react-mutation-mapper
// src/component/column/Annotation.tsx 170-187: a gene is an OncoKB cancer gene when its Entrez id is
// anywhere in the list (isOncoKbCancerGene), and whether OncoKB curates it is the entry's
// oncokbAnnotated, kept apart. The key space's SQL and the app's reads run against the fixture in
// scripts/check-oncokb-cancer-gene.ts. OncoKB is a stubbed fetch.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ONCOKB_CANCER_GENE_TABLE, cancerGeneRow, oncokbCancerGeneSource as src, resetCancerGeneList, type CancerGene } from "../src/sources/oncokb-cancer-gene.ts";
import { ANNOTATION_SOURCES, annotationSource } from "../src/index.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { resetCancerGeneList(); });
afterEach(() => { globalThis.fetch = realFetch; resetCancerGeneList(); });

const KRAS = 3845, TP53 = 7157, BRCA2 = 675, KIF5B = 3799, TTN = 7273, MUC16 = 94025;

/** OncoKB's list: KRAS (explicit oncogene), TP53 (explicit tsg), BRCA2 (geneType only), KIF5B (listed, not curated) */
const LIST: CancerGene[] = [
  { entrezGeneId: KRAS, hugoSymbol: "KRAS", oncokbAnnotated: true, occurrenceCount: 7, oncogene: true, tsg: false, geneType: "ONCOGENE" },
  { entrezGeneId: TP53, hugoSymbol: "TP53", oncokbAnnotated: true, occurrenceCount: 8, oncogene: false, tsg: true, geneType: "TSG" },
  { entrezGeneId: BRCA2, hugoSymbol: "BRCA2", oncokbAnnotated: true, occurrenceCount: 6, geneType: "ONCOGENE_AND_TSG" },
  { entrezGeneId: KIF5B, hugoSymbol: "KIF5B", oncokbAnnotated: false, occurrenceCount: 1, geneType: "INSUFFICIENT_EVIDENCE" }
];

/** OncoKB stand-in answering /utils/cancerGeneList with `list`; returns the paths asked */
function oncokb(list: unknown = LIST): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    asked.push(path);
    if (path === "/utils/cancerGeneList") return Response.json(list);
    return new Response("not stubbed: " + path, { status: 404 });
  }) as typeof fetch;
  return asked;
}

// ---- C1: a listed gene's row --------------------------------------------------------------------

test("C1 a listed gene: cancer_gene, its symbol, curation, roles, occurrence count and its entry as JSON", () => {
  const r = cancerGeneRow(String(KRAS), LIST[0]);
  assert.deepEqual(r, {
    entrez_gene_id: "3845", hugo_symbol: "KRAS", cancer_gene: true, oncokb_annotated: true,
    is_oncogene: true, is_tsg: false, occurrence_count: 7, data: JSON.stringify(LIST[0])
  });
  assert.deepEqual(JSON.parse(String(r.data)), LIST[0]);
});

test("C1 a listed gene OncoKB does not curate is still a cancer gene (isOncoKbCancerGene is any entry; Annotation.tsx 182-186)", () => {
  const r = cancerGeneRow(String(KIF5B), LIST[3]);
  assert.equal(r.cancer_gene, true);
  assert.equal(r.oncokb_annotated, false);
  assert.deepEqual([r.is_oncogene, r.is_tsg, r.occurrence_count], [false, false, 1]);
});

test("C1 with no oncogene/tsg booleans, the roles come from geneType (ONCOGENE_AND_TSG is both)", () => {
  const r = cancerGeneRow(String(BRCA2), LIST[2]);
  assert.deepEqual([r.is_oncogene, r.is_tsg], [true, true]);
  const onc = cancerGeneRow("1", { entrezGeneId: 1, geneType: "oncogene" });
  assert.deepEqual([onc.is_oncogene, onc.is_tsg], [true, false], "geneType read case-insensitively");
  const tsg = cancerGeneRow("1", { entrezGeneId: 1, geneType: "TSG" });
  assert.deepEqual([tsg.is_oncogene, tsg.is_tsg], [false, true]);
});

test("C1 explicit oncogene/tsg booleans win over geneType", () => {
  const r = cancerGeneRow("1", { entrezGeneId: 1, geneType: "ONCOGENE_AND_TSG", oncogene: false, tsg: false });
  assert.deepEqual([r.is_oncogene, r.is_tsg], [false, false]);
  const s = cancerGeneRow("1", { entrezGeneId: 1, geneType: "INSUFFICIENT_EVIDENCE", oncogene: true, tsg: true });
  assert.deepEqual([s.is_oncogene, s.is_tsg], [true, true]);
});

test("C1 an entry with no symbol or occurrence count is stored with '' and 0", () => {
  const r = cancerGeneRow("1", { entrezGeneId: 1 });
  assert.deepEqual([r.cancer_gene, r.hugo_symbol, r.occurrence_count, r.oncokb_annotated], [true, "", 0, false]);
});

// ---- C2: an unlisted gene's row -----------------------------------------------------------------

test("C2 a gene not in the list: a row saying so, everything else empty, false or 0", () => {
  assert.deepEqual(cancerGeneRow(String(TTN), undefined), {
    entrez_gene_id: "7273", hugo_symbol: "", cancer_gene: false, oncokb_annotated: false,
    is_oncogene: false, is_tsg: false, occurrence_count: 0, data: ""
  });
});

// ---- C3: a sync's batches -----------------------------------------------------------------------

test("C3 annotate asks for the list once across two batches and returns one row per key, in key order", async () => {
  const asked = oncokb();
  const first = await src.annotate([{ entrez_gene_id: String(TTN) }, { entrez_gene_id: String(KRAS) }, { entrez_gene_id: String(KIF5B) }]);
  const second = await src.annotate([{ entrez_gene_id: String(TP53) }, { entrez_gene_id: String(MUC16) }]);
  assert.deepEqual(asked, ["/utils/cancerGeneList"], "one request for the process");
  assert.deepEqual(first.map((r) => r.entrez_gene_id), ["7273", "3845", "3799"]);
  assert.deepEqual(second.map((r) => r.entrez_gene_id), ["7157", "94025"]);
  assert.deepEqual(first.map((r) => r.cancer_gene), [false, true, true]);
  assert.deepEqual(second.map((r) => r.cancer_gene), [true, false]);
  assert.deepEqual(first[1], cancerGeneRow("3845", LIST[0]));
  assert.deepEqual(second[1], cancerGeneRow("94025", undefined));
});

test("C3 a key is matched by its Entrez id as a number (the key space hands it over as a String)", async () => {
  oncokb([{ entrezGeneId: KRAS, hugoSymbol: "KRAS", oncokbAnnotated: true }]);
  const [r] = await src.annotate([{ entrez_gene_id: "3845" }]);
  assert.deepEqual([r.entrez_gene_id, r.cancer_gene, r.hugo_symbol], ["3845", true, "KRAS"]);
});

// ---- C4: an empty list --------------------------------------------------------------------------

test("C4 an empty list rejects rather than storing every gene as not a cancer gene", async () => {
  oncokb([]);
  await assert.rejects(src.annotate([{ entrez_gene_id: String(KRAS) }]), /empty/);
});

test("C4 a failed request is not kept: the next batch asks for the list again and succeeds", async () => {
  const asked = oncokb();
  const stub = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (calls++ === 0) throw new TypeError("fetch failed");
    return stub(input, init);
  }) as typeof fetch;
  await assert.rejects(src.annotate([{ entrez_gene_id: String(KRAS) }]), /fetch failed/);
  const rows = await src.annotate([{ entrez_gene_id: String(KRAS) }, { entrez_gene_id: String(TTN) }]);
  assert.equal(calls, 2, "asked again after the failure");
  assert.deepEqual(asked, ["/utils/cancerGeneList"], "the second request reached OncoKB");
  assert.deepEqual(rows.map((r) => [r.entrez_gene_id, r.cancer_gene]), [["3845", true], ["7273", false]]);
});

test("C4 an empty list is not kept either: a later batch asks again", async () => {
  const asked = oncokb([]);
  await assert.rejects(src.annotate([{ entrez_gene_id: String(KRAS) }]), /empty/);
  oncokb();
  const [r] = await src.annotate([{ entrez_gene_id: String(KRAS) }]);
  assert.equal(r.cancer_gene, true);
  assert.deepEqual(asked, ["/utils/cancerGeneList"]);
});

// ---- C5: the source as the sync sees it ---------------------------------------------------------

test("C5 the source: id oncokb_cancer_gene, registered, its table, OncoKB's writer and token, keyed by Entrez id", () => {
  assert.equal(src.id, "oncokb_cancer_gene");
  assert.ok(ANNOTATION_SOURCES.includes(src), ANNOTATION_SOURCES.map((s) => s.id).join(","));
  assert.equal(annotationSource("oncokb_cancer_gene"), src);
  assert.equal(ONCOKB_CANCER_GENE_TABLE, "annotation.oncokb_cancer_gene");
  assert.equal(src.table, ONCOKB_CANCER_GENE_TABLE);
  assert.equal(src.versionColumn, "oncokb_version");
  assert.deepEqual(src.keyColumns, ["entrez_gene_id"]);
  assert.equal(src.writer, "oncokb");
  assert.deepEqual(src.needs, ["ONCOKB_TOKEN"]);
});

test("C5 its table holds every column a row has, beside the version and the API version", () => {
  const create = src.ddl.join(" ");
  for (const col of [...Object.keys(cancerGeneRow("1", undefined)), "oncokb_version", "api_version"])
    assert.match(create, new RegExp("[(,] ?" + col + " "), col);
});

test("C5 the key space is the genes the warehouse's alterations name, positive Entrez ids; a study scopes it, quoted", () => {
  const all = src.keySpace("cbioportal", null);
  assert.match(all, /FROM cbioportal\.genomic_event_derived AS g\b/);
  assert.match(all, /g\.entrez_gene_id > 0/, "the column qualified: the String alias would shadow it in WHERE");
  assert.ok(!all.includes("cancer_study_identifier"), "no study, no filter");
  const one = src.keySpace("cbioportal", "o'brien_2024");
  assert.ok(one.startsWith(all), one);
  assert.ok(one.endsWith(" AND g.cancer_study_identifier = 'o\\'brien_2024'"), one);
});

test("C5 its release is OncoKB's: the data version, with the API version alongside", async () => {
  globalThis.fetch = (async () => Response.json({ dataVersion: { version: "v8.1" }, apiVersion: { version: "v1.6" } })) as unknown as typeof fetch;
  assert.deepEqual(await src.release(), { version: "v8.1", extra: { api_version: "v1.6" } });
});
