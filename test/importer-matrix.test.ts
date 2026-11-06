// The gene × sample matrix importers (lib/importer/matrix.ts) against the legacy importer's rules
// for tab-delimited profiles (docs/importer/legacy-java-importer.md §G3, §G4, §T1–T9, §P1). Each test
// writes a small file, imports it into a fake ClickHouse and checks what was stored, what was
// skipped and which samples count as profiled. Expected values come from the notes, not the code.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { dataFile, fakeCh, genes, importContext, studyDir, type FakeCh } from "./support/fake-ch.ts";
import { importStudy } from "../lib/importer/import-study.ts";
import { GeneResolver, type Gene } from "../lib/importer/genes.ts";
import type { ImportContext, Profile } from "../lib/importer/context.ts";
import { importDiscreteLong, importMatrix, phosphoResidue } from "../lib/importer/matrix.ts";

const CNA_META = { genetic_alteration_type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE", stable_id: "gistic" };
const LONG_META = { genetic_alteration_type: "COPY_NUMBER_ALTERATION", datatype: "DISCRETE_LONG", stable_id: "cna_long" };
const EXPR_META = { genetic_alteration_type: "MRNA_EXPRESSION", datatype: "CONTINUOUS", stable_id: "mrna" };
const RPPA_META = { genetic_alteration_type: "PROTEIN_LEVEL", datatype: "LOG2-VALUE", stable_id: "rppa" };

const STANDARD: [number, string, string[]?][] = [
  [7157, "TP53", ["P53"]], [1956, "EGFR", ["ERBB"]], [8085, "KMT2D", ["MLL2"]], [58508, "KMT2C", ["MLL2"]], [672, "BRCA1"]
];

let ch: FakeCh;
beforeEach(() => { ch = fakeCh(); });
afterEach(() => { ch.restore(); });

function profile(ctx: ImportContext, meta: Record<string, string>, over: Partial<Profile> = {}): Profile {
  const p: Profile = {
    id: ctx.profiles.length + 1, stableId: ctx.studyId + "_" + meta.stable_id, type: meta.genetic_alteration_type,
    datatype: meta.datatype, showInAnalysisTab: true, ...over
  };
  ctx.profiles.push(p);
  return p;
}

async function wide(text: string, opts: { meta?: Record<string, string>; discrete?: boolean; geneTable?: GeneResolver; ctx?: ImportContext; show?: boolean } = {}) {
  const meta = opts.meta ?? CNA_META;
  const ctx = opts.ctx ?? await importContext(ch, { genes: opts.geneTable ?? genes(STANDARD) });
  const p = profile(ctx, meta, opts.show === undefined ? {} : { showInAnalysisTab: opts.show });
  const discreteCna = meta.genetic_alteration_type === "COPY_NUMBER_ALTERATION" && meta.datatype === "DISCRETE";
  await importMatrix(ctx, dataFile(discreteCna ? "cna_discrete" : "matrix", text, meta), p.id, opts.discrete ?? discreteCna);
  return { ctx, p, report: ctx.reports.at(-1)! };
}

async function long(text: string, opts: { geneTable?: GeneResolver; ctx?: ImportContext } = {}) {
  const ctx = opts.ctx ?? await importContext(ch, { genes: opts.geneTable ?? genes(STANDARD) });
  const p = profile(ctx, LONG_META);
  await importDiscreteLong(ctx, dataFile("cna_discrete_long", text, LONG_META), p.id);
  return { ctx, p, report: ctx.reports.at(-1)! };
}

const sid = (ctx: ImportContext, s: string) => ctx.samples.get(s)!.id;

/** A comma-joined value list as cells, tolerating the legacy trailing comma. */
function cells(values: string, n: number): string[] {
  const parts = values.split(",");
  if (parts.length === n + 1 && parts[n] === "") parts.pop();
  assert.equal(parts.length, n, "value count in " + JSON.stringify(values));
  return parts;
}

/** The stored values of `entity`, keyed by sample stable id, in the profile's sample order. */
function valuesOf(ctx: ImportContext, profileId: number, entity: number): Record<string, string> {
  const order = orderedSamples(ctx, profileId);
  const rows = ch.rows("genetic_alteration").filter((r) => r.genetic_profile_id === profileId && r.genetic_entity_id === entity);
  assert.equal(rows.length, 1, "one genetic_alteration row for entity " + entity);
  const vs = cells(String(rows[0].values), order.length);
  return Object.fromEntries(order.map((s, i) => [s, vs[i]]));
}

function orderedSamples(ctx: ImportContext, profileId: number): string[] {
  const rows = ch.rows("genetic_profile_samples").filter((r) => r.genetic_profile_id === profileId);
  assert.equal(rows.length, 1, "one genetic_profile_samples row");
  const ids = String(rows[0].ordered_sample_list).split(",").filter(Boolean).map(Number);
  return ids.map((n) => ctx.samples.keyOf(n));
}

const storedEntities = (profileId: number) =>
  ch.rows("genetic_alteration").filter((r) => r.genetic_profile_id === profileId).map((r) => Number(r.genetic_entity_id));

const skippedTotal = (r: { skipped: Record<string, number> }) => Object.values(r.skipped).reduce((a, b) => a + b, 0);

function profiledSamples(ctx: ImportContext, profileId: number): { sample: string; panel: number | null }[] {
  return [...ctx.sampleProfile.values()].filter((x) => x.profile === profileId)
    .map((x) => ({ sample: ctx.samples.keyOf(x.sample), panel: x.panel }))
    .sort((a, b) => a.sample.localeCompare(b.sample));
}

/** (entrez, alteration, sample stable id) for each stored sample_cna_event of the profile. */
function events(ctx: ImportContext, profileId: number): [number, number, string][] {
  const byId = new Map(ch.rows("cna_event").map((e) => [Number(e.cna_event_id), e]));
  return ch.rows("sample_cna_event").filter((r) => r.genetic_profile_id === profileId).map((r) => {
    const e = byId.get(Number(r.cna_event_id));
    assert.ok(e, "sample_cna_event names a cna_event that was written");
    return [Number(e.entrez_gene_id), Number(e.alteration), ctx.samples.keyOf(Number(r.sample_id))] as [number, number, string];
  }).sort((a, b) => a[0] - b[0] || a[2].localeCompare(b[2]) || a[1] - b[1]);
}

function geneTableWith(extra: (Gene & { aliases?: string[] })[]): GeneResolver {
  const base: Gene[] = STANDARD.map(([entrez, hugo]) => ({ entrez, hugo, type: "protein-coding", entityId: entrez }));
  const aliases = STANDARD.flatMap(([entrez, , a]) => (a ?? []).map((alias) => ({ entrez, alias })));
  for (const g of extra) {
    base.push({ entrez: g.entrez, hugo: g.hugo, type: g.type, entityId: g.entityId });
    for (const alias of g.aliases ?? []) aliases.push({ entrez: g.entrez, alias });
  }
  return GeneResolver.fromRows(base, aliases);
}

describe("G3: gene resolution in tab-delimited profiles", () => {
  test("G3: a known Entrez id wins over the Hugo symbol", async () => {
    const { p } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\nEGFR\t7157\t1\n");
    assert.deepEqual(storedEntities(p.id), [7157]);
  });

  test("G3: an unknown numeric Entrez id falls back to the Hugo symbol", async () => {
    const { p, report } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\nEGFR\t12345678\t1\n");
    assert.deepEqual(storedEntities(p.id), [1956]);
    assert.equal(report.stored, 1);
  });

  test("G3: a non-numeric Entrez id drops the line even when the symbol is known", async () => {
    const { p, report } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\nTP53\tabc\t1\nEGFR\t1956\t2\n");
    assert.deepEqual(storedEntities(p.id), [1956]);
    assert.equal(report.read, 2);
    assert.equal(report.stored, 1);
    assert.equal(skippedTotal(report), 1);
  });

  test("G3: the Hugo symbol matches ignoring case, then a unique alias", async () => {
    const { p } = await wide("Hugo_Symbol\tS1\ntp53\t1\nERBB\t2\n");
    assert.deepEqual(storedEntities(p.id).sort(), [1956, 7157]);
  });

  test("G3: an ambiguous alias drops the line (no disambiguation file here)", async () => {
    const { p, report } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\nMLL2\t\t1\nTP53\t7157\t0\n");
    assert.deepEqual(storedEntities(p.id), [7157]);
    assert.equal(skippedTotal(report), 1);
  });

  test("G3: an unknown symbol drops the line and is reported", async () => {
    const { p, report } = await wide("Hugo_Symbol\tS1\nNOTAGENE\t1\nTP53\t0\n");
    assert.deepEqual(storedEntities(p.id), [7157]);
    assert.equal(report.read, 2);
    assert.equal(report.stored, 1);
    assert.equal(skippedTotal(report), 1);
  });

  test("G3: an Entrez-only file resolves by Entrez id", async () => {
    const { p } = await wide("Entrez_Gene_Id\tS1\tS2\n7157\t1\t2\n");
    assert.deepEqual(storedEntities(p.id), [7157]);
  });
});

describe("T1: values are stored raw", () => {
  test("T1: values are trimmed and otherwise stored verbatim, NA and blanks included", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\tS2\tS3\tS4\tS5\nTP53\tNA\t\t-1.5\t2.0\t 1 \n", { meta: EXPR_META });
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "NA", S2: "", S3: "-1.5", S4: "2.0", S5: "1" });
  });

  test("T1: a value containing a comma is refused", { todo: "T1: spec says a value with ',' throws; importer skips the row as 'value containing a comma' and continues" }, async () => {
    await assert.rejects(wide("Hugo_Symbol\tS1\tS2\nTP53\t1,5\t2\n", { meta: EXPR_META }));
  });

  test("T1/T9: normal-sample columns are removed from the header and the values", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tTCGA-AA-0001-01\tTCGA-AA-0001-11\tTCGA-AA-0002-01\nTP53\t1\t9\t2\n", { meta: EXPR_META });
    assert.deepEqual(orderedSamples(ctx, p.id), ["TCGA-AA-0001-01", "TCGA-AA-0002-01"]);
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { "TCGA-AA-0001-01": "1", "TCGA-AA-0002-01": "2" });
    assert.deepEqual(profiledSamples(ctx, p.id).map((x) => x.sample), ["TCGA-AA-0001-01", "TCGA-AA-0002-01"]);
    assert.equal(ctx.samples.has("TCGA-AA-0001-11"), false);
  });

  test("T1: a continuous profile is stored the same way and yields no CNA events", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\nTP53\t2\n", { meta: { ...CNA_META, datatype: "LOG2-VALUE", stable_id: "log2CNA" }, discrete: false });
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "2" });
    assert.deepEqual(events(ctx, p.id), []);
  });
});

describe("T2: duplicate genes", () => {
  test("T2: a duplicate gene row — the first wins", async () => {
    const { ctx, p, report } = await wide("Hugo_Symbol\tS1\nEGFR\t1\nEGFR\t2\n", { meta: EXPR_META });
    assert.deepEqual(valuesOf(ctx, p.id, 1956), { S1: "1" });
    assert.equal(report.stored, 1);
    assert.equal(skippedTotal(report), 1);
  });

  test("T2: a later row reaching the same gene through an alias is skipped", async () => {
    const { ctx, p, report } = await wide("Hugo_Symbol\tS1\nEGFR\t1\nERBB\t2\n", { meta: EXPR_META });
    assert.deepEqual(valuesOf(ctx, p.id, 1956), { S1: "1" });
    assert.equal(skippedTotal(report), 1);
  });

  test("T2: a later row reaching the same gene through its Entrez id is skipped", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\nTP53\t\t1\nP53\t7157\t2\n", { meta: EXPR_META });
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "1" });
  });

  test("T2: a duplicate in a discrete CNA file makes events only from the first row", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\nTP53\t-2\nTP53\t2\n");
    assert.deepEqual(events(ctx, p.id), [[7157, -2, "S1"]]);
  });
});

describe("T3: skipped gene symbols", () => {
  test("T3: '///' or '---' in the symbol drops the line, even with a valid Entrez id", async () => {
    const { p, report } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\nTP53///EGFR\t7157\t1\nEGFR---TP53\t1956\t1\nBRCA1\t672\t1\n", { meta: EXPR_META });
    assert.deepEqual(storedEntities(p.id), [672]);
    assert.equal(skippedTotal(report), 2);
  });

  test("T3: '|' keeps the text before it", async () => {
    const { p } = await wide("Hugo_Symbol\tS1\nEGFR|1956\t1\n", { meta: EXPR_META });
    assert.deepEqual(storedEntities(p.id), [1956]);
  });

  test("T3: an empty symbol with an empty Entrez id drops the line", async () => {
    const { p, report } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tS1\n\t\t1\nTP53\t\t1\n", { meta: EXPR_META });
    assert.deepEqual(storedEntities(p.id), [7157]);
    assert.equal(skippedTotal(report), 1);
  });
});

describe("T4: miRNA rows", () => {
  const mirTable = () => geneTableWith([
    { entrez: 406892, hugo: "MIR-100/100", type: "miRNA", entityId: 406892, aliases: ["hsa-mir-100"] },
    { entrez: 900001, hugo: "MIR-100/100*", type: "miRNA", entityId: 900001, aliases: ["hsa-mir-100"] },
    { entrez: 900002, hugo: "PROT100", type: "protein-coding", entityId: 900002, aliases: ["hsa-mir-100"] }
  ]);

  test("T4: a symbol naming several miRNA genes is stored once per miRNA gene; non-miRNA matches ignored",
    { todo: "T4: spec says the row is stored once per miRNA gene; importer skips it as 'gene not recognised or ambiguous'" }, async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\nhsa-mir-100\t1.5\n", { meta: EXPR_META, geneTable: mirTable() });
    assert.deepEqual(storedEntities(p.id).sort((a, b) => a - b), [406892, 900001]);
    assert.deepEqual(valuesOf(ctx, p.id, 406892), { S1: "1.5" });
    assert.deepEqual(valuesOf(ctx, p.id, 900001), { S1: "1.5" });
  });

  test("T4: a real Hugo symbol that is also an alias of a miRNA gene goes down the miRNA path",
    { todo: "T4: spec says a Hugo symbol that is also a miRNA alias is stored per miRNA gene; importer stores it for the Hugo gene" }, async () => {
      const table = geneTableWith([
        { entrez: 900010, hugo: "MIRHOST", type: "protein-coding", entityId: 900010 },
        { entrez: 900011, hugo: "MIR-7/7", type: "miRNA", entityId: 900011, aliases: ["MIRHOST"] }
      ]);
      const { p } = await wide("Hugo_Symbol\tS1\nMIRHOST\t1\n", { meta: EXPR_META, geneTable: table });
      assert.deepEqual(storedEntities(p.id), [900011]);
    });

  test("T4/T5: miRNA rows in a discrete CNA file make no CNA events", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\nhsa-mir-100\t2\nTP53\t2\n", { geneTable: mirTable() });
    assert.deepEqual(events(ctx, p.id), [[7157, 2, "S1"]]);
  });
});

describe("T5: CNA events from the discrete matrix", () => {
  test("T5: events only for exactly '2' and '-2'; '-1.5' is a -2 event but stays -1.5 in genetic_alteration", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\tS2\tS3\tS4\tS5\tS6\tS7\tS8\nTP53\t2\t-2\t-1.5\t1\t-1\t0\t2.0\t-2.0\n");
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "2", S2: "-2", S3: "-1.5", S4: "1", S5: "-1", S6: "0", S7: "2.0", S8: "-2.0" });
    assert.deepEqual(events(ctx, p.id), [[7157, -2, "S2"], [7157, -2, "S3"], [7157, 2, "S1"]].sort((a, b) => String(a[2]).localeCompare(String(b[2]))) as never);
  });

  test("T5: one cna_event per (gene, alteration), shared by every sample that has it", async () => {
    await wide("Hugo_Symbol\tS1\tS2\tS3\nTP53\t-2\t-2\t2\nEGFR\t2\t0\t2\n");
    const keys = ch.rows("cna_event").map((e) => e.entrez_gene_id + ":" + e.alteration).sort();
    assert.deepEqual(keys, ["1956:2", "7157:-2", "7157:2"]);
    assert.equal(ch.rows("sample_cna_event").length, 5);
  });

  test("T5: a cna_event is global, so a second profile in the same import reuses it", async () => {
      const ctx = await importContext(ch, { genes: genes(STANDARD) });
      // the existing events are read back as a database would return the rows inserted so far
      ch.answer(/SELECT\s+cna_event_id\b/i, () => ch.rows("cna_event").map((e) => ({ i: e.cna_event_id, e: e.entrez_gene_id, a: e.alteration })));
      await wide("Hugo_Symbol\tS1\nTP53\t-2\n", { ctx });
      await wide("Hugo_Symbol\tS2\nTP53\t-2\n", { ctx, meta: { ...CNA_META, stable_id: "cna2" } });
      assert.equal(ch.rows("cna_event").length, 1);
      assert.equal(ch.rows("sample_cna_event").length, 2);
    });

  test("T5: a profile not shown in the analysis tab makes no events (the study import passes the flag)", async () => {
    const meta = (show: string) => "cancer_study_identifier: st\ngenetic_alteration_type: COPY_NUMBER_ALTERATION\ndatatype: DISCRETE\n" +
      "stable_id: cna\nshow_profile_in_analysis_tab: " + show + "\nprofile_name: CNA\nprofile_description: d\ndata_filename: data_cna.txt\n";
    for (const [show, events] of [["false", 0], ["true", 1]] as const) {
      const fake = fakeCh();
      try {
        fake.answer(/AS g FROM gene\b/, [{ e: 7157, h: "TP53", t: "protein-coding", g: 7157 }]);
        await importStudy(fake.conn, "/nonexistent", studyDir({
          "meta_study.txt": "type_of_cancer: brca\ncancer_study_identifier: st\nname: St\ndescription: d\n",
          "meta_cna.txt": meta(show), "data_cna.txt": "Hugo_Symbol\tS1\nTP53\t-2\n",
        }), "st", () => {}, false, false);
        assert.equal(fake.rows("sample_cna_event").length, events, "show_profile_in_analysis_tab: " + show);
      } finally { fake.restore(); }
    }
  });

  test("T5: event values are matched on the trimmed cell", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\nTP53\t -2 \n");
    assert.deepEqual(events(ctx, p.id), [[7157, -2, "S1"]]);
  });
});

describe("T7: RPPA (Composite.Element.Ref)", () => {
  const rppaTable = () => geneTableWith([
    { entrez: 207, hugo: "AKT1", type: "protein-coding", entityId: 207 },
    { entrez: 208, hugo: "AKT2", type: "protein-coding", entityId: 208 }
  ]);

  test("T7: phosphoResidue reads the residue off the antibody id, or null for a total-protein antibody", () => {
    assert.equal(phosphoResidue("Akt_pS473"), "pS473");
    assert.equal(phosphoResidue("MAPK_pT202_Y204"), "pT202_Y204");
    assert.equal(phosphoResidue("Akt"), null);
    assert.equal(phosphoResidue("EGFR"), null);
  });

  test("T7: a total-protein row is stored for every gene listed", async () => {
    const { ctx, p } = await wide("Composite.Element.Ref\tS1\nAKT1 AKT2|Akt\t0.1\n", { meta: RPPA_META, geneTable: rppaTable() });
    assert.deepEqual(storedEntities(p.id).sort((a, b) => a - b), [207, 208]);
    assert.deepEqual(valuesOf(ctx, p.id, 207), { S1: "0.1" });
  });

  test("T7: NA genes are ignored; the other genes are still stored", async () => {
    const { p } = await wide("Composite.Element.Ref\tS1\nNA AKT1|Akt\t0.1\n", { meta: RPPA_META, geneTable: rppaTable() });
    assert.deepEqual(storedEntities(p.id), [207]);
  });

  test("T7: a phospho antibody maps to new phosphoprotein genes <GENE>_<residue> with negative Entrez ids", async () => {
    const { ctx, p } = await wide("Composite.Element.Ref\tS1\nAKT1 AKT2|Akt_pS473\t0.5\n", { meta: RPPA_META, geneTable: rppaTable() });
    const made = ch.rows("gene");
    // cBioPortal keeps Hugo symbols upper-cased, so the residue's case is not compared
    assert.deepEqual(made.map((g) => String(g.hugo_gene_symbol).toUpperCase()).sort(), ["AKT1_PS473", "AKT2_PS473"]);
    for (const g of made) {
      assert.equal(g.type, "phosphoprotein");
      assert.ok(Number(g.entrez_gene_id) < 0, "phospho gene entrez " + g.entrez_gene_id);
      assert.equal(ch.rows("gene_alias").filter((a) => a.entrez_gene_id === g.entrez_gene_id).length, 3);
    }
    const entities = made.map((g) => Number(g.genetic_entity_id)).sort((a, b) => a - b);
    assert.deepEqual(storedEntities(p.id).sort((a, b) => a - b), entities);
    assert.deepEqual(valuesOf(ctx, p.id, entities[0]), { S1: "0.5" });
    assert.equal(storedEntities(p.id).includes(207), false);
  });

  test("T7: an existing phospho gene is reused, not created again", async () => {
    const table = geneTableWith([
      { entrez: 207, hugo: "AKT1", type: "protein-coding", entityId: 207 },
      { entrez: -5, hugo: "AKT1_PS473", type: "phosphoprotein", entityId: 777 }
    ]);
    const { p } = await wide("Composite.Element.Ref\tS1\nAKT1|Akt_pS473\t0.5\n", { meta: RPPA_META, geneTable: table });
    assert.equal(ch.rows("gene").length, 0);
    assert.deepEqual(storedEntities(p.id), [777]);
  });

  test("T7: a duplicate antibody id drops the later row", async () => {
    const { ctx, p, report } = await wide("Composite.Element.Ref\tS1\nAKT1|Akt\t0.1\nAKT2|Akt\t0.2\n", { meta: RPPA_META, geneTable: rppaTable() });
    assert.deepEqual(storedEntities(p.id), [207]);
    assert.deepEqual(valuesOf(ctx, p.id, 207), { S1: "0.1" });
    assert.equal(skippedTotal(report), 1);
  });
});

describe("T8: sample column detection", () => {
  test("T8: known annotation columns (any case) are not samples", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tEntrez_Gene_Id\tCYTOBAND\tLocus ID\tS1\tS2\nTP53\t7157\t17p13.1\t7157\t1\t2\n", { meta: EXPR_META });
    assert.deepEqual(orderedSamples(ctx, p.id), ["S1", "S2"]);
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "1", S2: "2" });
    for (const col of ["CYTOBAND", "Locus ID", "Cytoband"]) assert.equal(ctx.samples.has(col), false, col);
  });

  test("T8: the 'Gene Symbol' header is an id column", async () => {
    const { ctx, p } = await wide("Gene Symbol\tS1\nTP53\t1\n", { meta: EXPR_META });
    assert.deepEqual(orderedSamples(ctx, p.id), ["S1"]);
    assert.deepEqual(storedEntities(p.id), [7157]);
  });
});

describe("T9/P1: profiled samples of a matrix profile", () => {
  test("T9: the sample order is the header order", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS3\tS1\tS2\nTP53\t3\t1\t2\n", { meta: EXPR_META });
    assert.deepEqual(orderedSamples(ctx, p.id), ["S3", "S1", "S2"]);
    assert.deepEqual(cells(String(ch.rows("genetic_alteration")[0].values), 3), ["3", "1", "2"]);
  });

  test("T9/P1: every header sample is profiled, even with only NA values; no panel means null", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\tS2\nTP53\t1\tNA\nEGFR\t2\tNA\n", { meta: EXPR_META });
    assert.deepEqual(profiledSamples(ctx, p.id), [{ sample: "S1", panel: null }, { sample: "S2", panel: null }]);
  });

  test("T9/P1: a header sample is profiled even when no gene row survives", async () => {
    const { ctx, p } = await wide("Hugo_Symbol\tS1\nNOTAGENE\t1\n", { meta: EXPR_META });
    assert.deepEqual(profiledSamples(ctx, p.id).map((x) => x.sample), ["S1"]);
  });

  test("P1: the meta gene_panel is the panel of every profiled sample", async () => {
    const ctx = await importContext(ch, { genes: genes(STANDARD) });
    ctx.panels.set("IMPACT468", 42);
    const { p } = await wide("Hugo_Symbol\tS1\tS2\nTP53\t1\t2\n", { ctx, meta: { ...EXPR_META, gene_panel: "IMPACT468" } });
    assert.deepEqual(profiledSamples(ctx, p.id), [{ sample: "S1", panel: 42 }, { sample: "S2", panel: 42 }]);
  });

  test("P1: an unknown meta gene_panel is an error",
    { todo: "P1: spec says an unknown gene_panel throws; importer notes it and profiles the samples as whole-exome (panel null)" }, async () => {
    const ctx = await importContext(ch, { genes: genes(STANDARD) });
    await assert.rejects(wide("Hugo_Symbol\tS1\nTP53\t1\n", { ctx, meta: { ...EXPR_META, gene_panel: "NO_SUCH_PANEL" } }));
  });

  test("P1: a header sample no clinical file listed is created and reported (intended departure: legacy aborts)", async () => {
    const ctx = await importContext(ch, { genes: genes(STANDARD) });
    const known = ctx.sampleFor("S1");
    ctx.implicitSamples.length = 0;
    const { p } = await wide("Hugo_Symbol\tS1\tS9\nTP53\t1\t2\n", { ctx, meta: EXPR_META });
    assert.equal(sid(ctx, "S1"), known);
    assert.deepEqual(ctx.implicitSamples, ["S9"]);
    assert.deepEqual(profiledSamples(ctx, p.id).map((x) => x.sample), ["S1", "S9"]);
  });
});

describe("G4/T6: discrete CNA in long form", () => {
  const H = "Hugo_Symbol\tEntrez_Gene_Id\tSample_Id\tValue\n";

  test("T6: -1.5 is stored as -2 (unlike the wide form) and makes a -2 event", async () => {
    const { ctx, p } = await long(H + "TP53\t7157\tS1\t-1.5\nTP53\t7157\tS2\t2\nTP53\t7157\tS3\t1\n");
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "-2", S2: "2", S3: "1" });
    assert.deepEqual(events(ctx, p.id), [[7157, -2, "S1"], [7157, 2, "S2"]]);
  });

  test("T6: a gene/sample cell absent from the file is stored as ''", async () => {
    const { ctx, p } = await long(H + "TP53\t7157\tS1\t-2\nEGFR\t1956\tS2\t2\n");
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "-2", S2: "" });
    assert.deepEqual(valuesOf(ctx, p.id, 1956), { S1: "", S2: "2" });
  });

  test("T6: a duplicate (gene, sample) pair keeps the first value", async () => {
    const { ctx, p } = await long(H + "TP53\t7157\tS1\t-2\nTP53\t7157\tS1\t2\n");
    assert.deepEqual(valuesOf(ctx, p.id, 7157), { S1: "-2" });
    assert.deepEqual(events(ctx, p.id), [[7157, -2, "S1"]]);
  });

  test("T6: a blank value is an error", { todo: "T6: spec says a blank value throws; importer stores ''" }, async () => {
    await assert.rejects(long(H + "TP53\t7157\tS1\t\n"));
  });

  test("T6: an NA value is an error", { todo: "T6: spec says NA throws (Integer.valueOf); importer stores 'NA'" }, async () => {
    await assert.rejects(long(H + "TP53\t7157\tS1\tNA\n"));
  });

  test("P1: a long CNA profile's profiled samples are the samples in the file", async () => {
    const { ctx, p } = await long(H + "TP53\t7157\tS1\t0\nEGFR\t1956\tS2\t-1\nEGFR\t1956\tS1\t1\n");
    assert.deepEqual(profiledSamples(ctx, p.id), [{ sample: "S1", panel: null }, { sample: "S2", panel: null }]);
    assert.deepEqual([...orderedSamples(ctx, p.id)].sort(), ["S1", "S2"]);
  });

  test("G4: a non-numeric Entrez id falls back to the Hugo symbol",
    { todo: "G4: spec says a non-digit Entrez becomes 0 and the Hugo symbol is tried; importer drops the row (the G3 rule)" }, async () => {
    const { p } = await long(H + "TP53\tabc\tS1\t-2\n");
    assert.deepEqual(storedEntities(p.id), [7157]);
  });

  test("G4: an unknown Entrez id falls back to the Hugo symbol", async () => {
    const { p } = await long(H + "EGFR\t12345678\tS1\t2\n");
    assert.deepEqual(storedEntities(p.id), [1956]);
  });

  test("G4: '///' or '---' drops the row; '|' truncates the symbol", async () => {
    const { p, report } = await long(H + "TP53///EGFR\t\tS1\t2\nTP53---EGFR\t\tS1\t2\nEGFR|x\t\tS1\t2\n");
    assert.deepEqual(storedEntities(p.id), [1956]);
    assert.equal(skippedTotal(report), 2);
  });

  test("G4: an ambiguous alias is a hard error",
    { todo: "G4: spec says an ambiguous alias aborts the long-CNA import (or the departure is documented); importer neither throws nor documents it" }, async () => {
      await assert.rejects(long(H + "MLL2\t\tS1\t2\n"));
    });
});
