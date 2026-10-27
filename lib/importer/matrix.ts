// Gene × sample matrices — discrete and continuous copy number, expression, protein, methylation
// (notes/legacy-java-importer.md §T). Values are stored as written; the first row for a gene wins;
// every sample in the header counts as profiled; discrete CNA also yields the ±2 events.
import path from "node:path";
import { Inserter, insertAll, query } from "./ch-write.ts";
import { ImportContext, skip, sampleId, isNormalBarcode } from "./context.ts";
import { panelOf } from "./mutations.ts";
import { openTable, type DataFile } from "./study.ts";

// header columns that are not samples (case-insensitive)
const ID_COLUMNS = new Set(["gene symbol", "hugo_symbol", "entrez_gene_id", "locus id", "cytoband", "composite.element.ref", "geneset_id", "entity_stable_id"]);

/** Discrete values that make a CNA event, and the alteration each stands for. */
export function cnaEventValue(v: string): number | null {
  if (v === "2") return 2;
  if (v === "-2" || v === "-1.5") return -2;
  return null;
}

/** Global (entrez, alteration) → cna_event id, as cBioPortal keeps them. */
async function cnaEvents(ctx: ImportContext): Promise<Map<string, number>> {
  const rows = await query<{ i: number; e: number; a: number }>(ctx.conn, "SELECT cna_event_id AS i, entrez_gene_id AS e, alteration AS a FROM cna_event");
  return new Map(rows.map((x) => [x.e + ":" + x.a, Number(x.i)]));
}

export async function importMatrix(ctx: ImportContext, f: DataFile, profile: number, discrete: boolean): Promise<void> {
  const r = ctx.report(path.basename(f.file), discrete ? "copy number (discrete)" : "profile matrix");
  const t = await openTable(f.file);
  const lower = t.header.map((x) => x.toLowerCase());
  const iHugo = lower.findIndex((x) => x === "hugo_symbol" || x === "gene symbol");
  const iEntrez = lower.findIndex((x) => x === "entrez_gene_id" || x === "locus id");
  const iAntibody = lower.indexOf("composite.element.ref");
  if (iHugo < 0 && iEntrez < 0 && iAntibody < 0) throw new Error(path.basename(f.file) + " has no Hugo_Symbol, Entrez_Gene_Id or Composite.Element.Ref column");
  let firstSample = 0;
  lower.forEach((x, i) => { if (ID_COLUMNS.has(x)) firstSample = i + 1; });
  const cols: { index: number; sample: number }[] = [];
  for (let i = firstSample; i < t.header.length; i++) {
    const raw = t.header[i];
    if (!raw || isNormalBarcode(raw)) continue;
    cols.push({ index: i, sample: ctx.sampleFor(sampleId(raw)) });
  }
  const panel = panelOf(ctx, f, r);
  for (const c of cols) ctx.profiled(c.sample, profile, panel);
  await insertAll(ctx.conn, "genetic_profile_samples", [{ genetic_profile_id: profile, ordered_sample_list: cols.map((c) => c.sample).join(",") + "," }]);

  const events = discrete ? await cnaEvents(ctx) : null;
  const newEvents = new Inserter(ctx.conn, "cna_event"), sce = new Inserter(ctx.conn, "sample_cna_event");
  const ga = new Inserter(ctx.conn, "genetic_alteration");
  const seen = new Set<number>();
  const antibodies = new Set<string>();
  for await (const row of t.rows) {
    r.read++;
    const values = cols.map((c) => (row[c.index] ?? "").trim());
    if (values.some((v) => v.includes(","))) { skip(r, "value containing a comma"); continue; }
    if (iAntibody >= 0) {
      // RPPA: "GENE1 GENE2|antibody"; the row is stored for each gene the antibody names
      const [geneText, antibody = ""] = (row[iAntibody] ?? "").split("|");
      if (antibodies.has(antibody)) { skip(r, "antibody repeated"); continue; }
      antibodies.add(antibody);
      if (/p[STY]\d+/.test(antibody)) { skip(r, "phospho-protein antibody (not imported yet)"); continue; }
      const genes = geneText.trim().split(/\s+/).map((g) => ctx.genes.nonAmbiguous(g)).filter((g) => g !== null);
      if (!genes.length) { skip(r, "gene not recognised"); continue; }
      for (const g of genes) {
        if (seen.has(g.entrez)) continue;
        seen.add(g.entrez);
        await ga.add({ genetic_profile_id: profile, genetic_entity_id: g.entityId, values: values.join(",") + "," });
      }
      r.stored++;
      continue;
    }
    const gene = ctx.genes.forMatrix(iHugo >= 0 ? (row[iHugo] ?? "").trim() : "", iEntrez >= 0 ? (row[iEntrez] ?? "") : "");
    if (!gene) { skip(r, "gene not recognised or ambiguous"); continue; }
    if (seen.has(gene.entrez)) { skip(r, "gene repeated (first row kept)"); continue; }
    seen.add(gene.entrez);
    await ga.add({ genetic_profile_id: profile, genetic_entity_id: gene.entityId, values: values.join(",") + "," });
    r.stored++;
    // cBioPortal makes no CNA events for miRNA genes
    if (!events || gene.type === "miRNA") continue;
    for (let i = 0; i < values.length; i++) {
      const alt = cnaEventValue(values[i]);
      if (alt === null) continue;
      const key = gene.entrez + ":" + alt;
      let ev = events.get(key);
      if (ev === undefined) {
        ev = ctx.id("cnaEvent");
        events.set(key, ev);
        await newEvents.add({ cna_event_id: ev, entrez_gene_id: gene.entrez, alteration: alt });
      }
      await sce.add({ cna_event_id: ev, sample_id: cols[i].sample, genetic_profile_id: profile, annotation_json: null });
    }
  }
  await ga.flush(); await newEvents.flush(); await sce.flush();
}

/**
 * Discrete CNA in long form (Hugo_Symbol, Entrez_Gene_Id, Sample_Id, Value): pivoted to the
 * matrix the wide form would have been, with -1.5 stored as -2 as the legacy importer does here.
 */
export async function importDiscreteLong(ctx: ImportContext, f: DataFile, profile: number): Promise<void> {
  const r = ctx.report(path.basename(f.file), "copy number (discrete, long)");
  const t = await openTable(f.file);
  const h = new Map(t.header.map((x, i) => [x.toLowerCase(), i]));
  const at = (row: string[], k: string) => { const i = h.get(k); return i === undefined ? "" : (row[i] ?? "").trim(); };
  const samples: number[] = [], sampleIdx = new Map<number, number>();
  const genes = new Map<number, { entity: number; values: Map<number, string> }>();
  const events = await cnaEvents(ctx);
  const newEvents = new Inserter(ctx.conn, "cna_event"), sce = new Inserter(ctx.conn, "sample_cna_event");
  for await (const row of t.rows) {
    r.read++;
    const gene = ctx.genes.forMatrix(at(row, "hugo_symbol"), at(row, "entrez_gene_id"));
    if (!gene) { skip(r, "gene not recognised or ambiguous"); continue; }
    const raw = at(row, "sample_id");
    if (!raw || isNormalBarcode(raw)) { skip(r, "no sample or normal sample"); continue; }
    const sample = ctx.sampleFor(sampleId(raw));
    if (!sampleIdx.has(sample)) { sampleIdx.set(sample, samples.length); samples.push(sample); }
    const v0 = at(row, "value");
    const v = v0 === "-1.5" ? "-2" : v0;
    let g = genes.get(gene.entrez);
    if (!g) { g = { entity: gene.entityId, values: new Map() }; genes.set(gene.entrez, g); }
    if (g.values.has(sample)) { skip(r, "gene and sample repeated (first kept)"); continue; }
    g.values.set(sample, v);
    r.stored++;
    const alt = cnaEventValue(v);
    if (alt === null || gene.type === "miRNA") continue;
    const key = gene.entrez + ":" + alt;
    let ev = events.get(key);
    if (ev === undefined) { ev = ctx.id("cnaEvent"); events.set(key, ev); await newEvents.add({ cna_event_id: ev, entrez_gene_id: gene.entrez, alteration: alt }); }
    await sce.add({ cna_event_id: ev, sample_id: sample, genetic_profile_id: profile, annotation_json: null });
  }
  const panel = panelOf(ctx, f, r);
  for (const s of samples) ctx.profiled(s, profile, panel);
  await insertAll(ctx.conn, "genetic_profile_samples", [{ genetic_profile_id: profile, ordered_sample_list: samples.join(",") + "," }]);
  const ga = new Inserter(ctx.conn, "genetic_alteration");
  for (const g of genes.values())
    await ga.add({ genetic_profile_id: profile, genetic_entity_id: g.entity, values: samples.map((s) => g.values.get(s) ?? "").join(",") + "," });
  await ga.flush(); await newEvents.flush(); await sce.flush();
}
