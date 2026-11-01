// Example updates to a study in the lab_ tables (lab-schema.ts), written as new row versions the
// way a live update is: visible to the next query, merged into the study's partitions later
// (`compactStudy`). They exist to try the update and review machinery on real studies — the
// update page (/import/updates) makes them — and each keeps the tables as an import would leave
// them: a new sample comes with its clinical grid, profiles, case lists and data; a new attribute
// fills the grid for every sample or patient; a mutation carries its panel and patient; counts the
// importer computes (MUTATION_COUNT, SAMPLE_COUNT, the study's) are recomputed.
//
// Every edit is planned before it is applied: the plan says what it would write and what of it
// already exists, and applying either skips what exists or writes it again as a new version.
// Generated values are a function of the seed, so the same edit twice meets its own rows.
import { exec, insertAll, query, sq, type Row, type WriteConn } from "./ch-write.ts";
import { LAB_TABLES, columnsOf, compactStudy, refreshLabStudy } from "./lab-schema.ts";

export type EditKind = "samples" | "profile" | "clinical" | "mutations" | "expression";

export interface EditParams {
  kind: EditKind;
  seed?: number;
  /** samples: how many new samples; mutations, expression: how many existing samples */
  count?: number;
  /** samples: their ids are <prefix>-S1… and their patients' <prefix>-P1… */
  prefix?: string;
  /** profile: what the new profile holds */
  profileKind?: "expression" | "methylation" | "protein";
  /** profile: how many genes it has values for (from GENES, then protein-coding genes by Entrez id) */
  genes?: number;
  /** clinical: the attribute, its level and type */
  attribute?: string;
  level?: "sample" | "patient";
  datatype?: "STRING" | "NUMBER";
  /** mutations: how many per sample */
  perSample?: number;
  /** expression: which of the study's continuous profiles */
  profile?: string;
}

export interface Conflict { what: string; count: number; examples: string[] }
export interface EditPlan { summary: string; rows: Record<string, number>; conflicts: Conflict[] }
export interface EditResult { rows: Record<string, number>; seconds: number; merged: string[] }

/** Genes the generated profiles, mutations and values use first. */
export const GENES = ["TP53", "KRAS", "PIK3CA", "EGFR", "BRAF", "PTEN", "APC", "ARID1A", "KMT2D", "NF1", "CDKN2A", "RB1", "ATM", "BRCA2",
  "SMAD4", "CTNNB1", "FBXW7", "ERBB2", "IDH1", "NRAS"];

const RESPONSES = ["Complete response", "Partial response", "Stable disease", "Progressive disease"];
const AMINO = "ACDEFGHIKLMNPQRSTVWY";

/** A small seeded generator, so an edit is the same each time it is made with the same seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normally distributed value from two hashes of the row, computed on the server. */
const normal = (seed: number, ...keys: string[]) =>
  `toString(round(sqrt(-2 * log((sipHash64(${seed}, 1, ${keys.join(", ")}) % 1000000 + 1) / 1000001)) * cos(2 * pi() * (sipHash64(${seed}, 2, ${keys.join(", ")}) % 1000000) / 1000000), 4))`;

const list = (xs: string[]) => "(" + (xs.length ? xs.map(sq).join(", ") : "''") + ")";
const arr = (xs: string[]) => "[" + xs.map(sq).join(", ") + "]";
const one = async (conn: WriteConn, sql: string) => Number((await query<{ n: number }>(conn, sql))[0]?.n ?? 0);
const strings = async (conn: WriteConn, sql: string) => (await query<{ x: string }>(conn, sql)).map((r) => r.x);
const conflict = (what: string, xs: string[]): Conflict[] => xs.length ? [{ what, count: xs.length, examples: xs.slice(0, 8) }] : [];

/** Writes deletion markers, at `version`, for every row of these samples (and of these patients' own rows). */
async function deleteSamples(conn: WriteConn, study: string, samples: string[], patients: string[], version: number): Promise<void> {
  for (const t of Object.keys(LAB_TABLES)) {
    const cols = columnsOf(t);
    const where = cols.includes("sample_id") && cols.includes("patient_id") ? `(sample_id IN ${list(samples)} OR (sample_id = '' AND patient_id IN ${list(patients)}))`
      : cols.includes("sample_id") ? `sample_id IN ${list(samples)}` : cols.includes("patient_id") ? `patient_id IN ${list(patients)}` : "";
    if (!where) continue;
    await exec(conn, `INSERT INTO ${t} (${cols.join(", ")}, version, is_deleted) SELECT ${cols.join(", ")}, ${version}, 1 FROM ${t} FINAL
      WHERE study_id = ${sq(study)} AND ${where}`);
  }
}

// ---- new samples: copies of existing samples (one per patient), with their clinical rows, profiles, case lists and data

interface SamplesPlan { ids: string[]; patients: string[]; templates: string[]; templatePatients: string[]; existing: string[] }

async function samplesPlan(conn: WriteConn, study: string, p: EditParams): Promise<SamplesPlan> {
  const n = Math.min(Math.max(1, p.count ?? 5), 1000);
  const prefix = (p.prefix || "DEMO").replace(/[^A-Za-z0-9_.-]/g, "");
  const ids = Array.from({ length: n }, (_, i) => `${prefix}-S${i + 1}`), patients = ids.map((_, i) => `${prefix}-P${i + 1}`);
  const t = await query<{ s: string; p: string }>(conn, `SELECT sample_id AS s, patient_id AS p FROM lab_sample FINAL
    WHERE study_id = ${sq(study)} AND NOT startsWith(sample_id, ${sq(prefix + "-")}) ORDER BY sipHash64(sample_id, ${p.seed ?? 1}) LIMIT 1 BY patient_id LIMIT ${n}`);
  if (t.length < n) throw new Error(`${study} has ${t.length} patients to copy samples from; ${n} new samples need as many`);
  const existing = await strings(conn, `SELECT sample_id AS x FROM lab_sample FINAL WHERE study_id = ${sq(study)} AND sample_id IN ${list(ids)}`);
  return { ids, patients, templates: t.map((r) => r.s), templatePatients: t.map((r) => r.p), existing };
}

/** Per table: the template rows, and the expressions that read them as the new samples' rows. */
async function sampleCopies(conn: WriteConn, study: string, sp: SamplesPlan, keep: (i: number) => boolean) {
  const idx = sp.ids.map((_, i) => i).filter(keep);
  const tpl = idx.map((i) => sp.templates[i]), tplP = idx.map((i) => sp.templatePatients[i]);
  const ids = idx.map((i) => sp.ids[i]), pts = idx.map((i) => sp.patients[i]);
  // the source columns are read as src.<name>: a bare name would be the new value, aliased in the same SELECT
  const bySample = `transform(src.sample_id, ${arr(tpl)}, ${arr(ids)}, src.sample_id)`;
  const ofSample = `transform(src.sample_id, ${arr(tpl)}, ${arr(pts)}, src.patient_id)`, ofPatient = `transform(src.patient_id, ${arr(tplP)}, ${arr(pts)}, src.patient_id)`;
  const out: { table: string; exprs: (version: number) => string[]; where: string }[] = [];
  const svBase = await one(conn, `SELECT max(sv_index) + 1 AS n FROM lab_structural_variant FINAL WHERE study_id = ${sq(study)}`);
  for (const t of Object.keys(LAB_TABLES)) {
    const cols = columnsOf(t);
    const s = cols.includes("sample_id"), pa = cols.includes("patient_id");
    if (!s && !pa) continue;
    const where = s && pa && t === "lab_clinical" ? `(sample_id IN ${list(tpl)} OR (sample_id = '' AND patient_id IN ${list(tplP)}))`
      : s ? `sample_id IN ${list(tpl)}` : `patient_id IN ${list(tplP)}`;
    out.push({
      table: t, where, exprs: (version) => [...cols.map((c) => c === "sample_id" ? (t === "lab_clinical" ? `if(src.sample_id = '', '', ${bySample})` : bySample) + " AS sample_id"
        : c === "patient_id" ? (s ? (t === "lab_clinical" ? `if(src.sample_id = '', ${ofPatient}, ${ofSample})` : ofSample) : ofPatient) + " AS patient_id"
          : c === "sv_index" ? `toUInt32(${svBase} + rowNumberInAllBlocks()) AS sv_index` : c), `${version} AS version`, "0 AS is_deleted"]
    });
  }
  return { copies: out, ids, patients: pts };
}

// ---- the plan and the edit of each kind

export async function planEdit(conn: WriteConn, study: string, p: EditParams): Promise<EditPlan> {
  const S = sq(study);
  switch (p.kind) {
    case "samples": {
      const sp = await samplesPlan(conn, study, p);
      const { copies } = await sampleCopies(conn, study, sp, () => true);
      const rows: Record<string, number> = {};
      for (const c of copies) rows[c.table] = await one(conn, `SELECT count() AS n FROM ${c.table} FINAL WHERE study_id = ${S} AND ${c.where} AND is_deleted = 0`);
      return { summary: `${sp.ids.length} new samples (${sp.ids[0]} … ${sp.ids[sp.ids.length - 1]}), each a copy of an existing sample of another patient — its clinical values, profiles, case lists and data`,
        rows, conflicts: conflict("samples already in the study", sp.existing) };
    }
    case "profile": {
      const pr = profileOf(study, p);
      const genes = await geneRows(conn, p.genes ?? 20);
      const samples = await one(conn, `SELECT count() AS n FROM lab_sample FINAL WHERE study_id = ${S}`);
      const exists = await strings(conn, `SELECT profile_id AS x FROM lab_profile FINAL WHERE study_id = ${S} AND profile_id = ${sq(pr.id)}`);
      return { summary: `a new ${pr.alteration} profile ${pr.id} ("${pr.name}"): values for ${genes.length} genes in all ${samples.toLocaleString()} samples`,
        rows: { lab_profile: 1, lab_sample_profile: samples, lab_profile_value: samples * genes.length }, conflicts: conflict("profile already in the study", exists) };
    }
    case "clinical": {
      const a = attributeOf(p);
      const n = await one(conn, `SELECT count() AS n FROM ${a.level === "sample" ? "lab_sample" : "lab_patient"} FINAL WHERE study_id = ${S}`);
      const exists = await strings(conn, `SELECT attr_id AS x FROM lab_clinical_attribute FINAL WHERE study_id = ${S} AND attr_id = ${sq(a.id)}`);
      return { summary: `a new ${a.level} attribute ${a.id} (${a.datatype}) with a value for every ${a.level} (about one in ten left empty)`,
        rows: { lab_clinical_attribute: 1, lab_clinical: n }, conflicts: conflict("attribute already in the study", exists) };
    }
    case "mutations": {
      const m = await mutationRows(conn, study, p);
      return { summary: `${m.rows.length} missense mutations in ${m.samples} samples profiled for ${m.profile}, in ${GENES.length} cancer genes`,
        rows: { lab_mutation: m.rows.length, lab_clinical: m.samples }, conflicts: conflict("mutations already recorded (same sample, gene and protein change)", m.existing.map((r) => `${String(r.sample_id)} ${String(r.hugo_gene_symbol)} ${String(r.protein_change)}`)) };
    }
    case "expression": {
      const e = await expressionCells(conn, study, p);
      return { summary: `${e.cells} values of ${e.profile}: ${e.samples.length} samples × ${e.genes.length} genes`,
        rows: { lab_profile_value: e.cells }, conflicts: conflict("values already set", e.existing) };
    }
  }
}

export async function applyEdit(conn: WriteConn, study: string, p: EditParams, onConflict: "skip" | "update", merge: boolean): Promise<EditResult> {
  const t0 = Date.now();
  const S = sq(study);
  const version = Date.now();
  const rows: Record<string, number> = {};
  const count = async (t: string, where: string) => { rows[t] = (rows[t] ?? 0) + await one(conn, `SELECT count() AS n FROM ${t} WHERE study_id = ${S} AND version = ${version + 1} AND ${where}`); };
  switch (p.kind) {
    case "samples": {
      const sp = await samplesPlan(conn, study, p);
      const exists = new Set(sp.existing);
      if (onConflict === "update" && exists.size)
        await deleteSamples(conn, study, sp.ids.filter((x) => exists.has(x)), sp.patients.filter((_, i) => exists.has(sp.ids[i])), version);
      const { copies, ids, patients } = await sampleCopies(conn, study, sp, (i) => onConflict === "update" || !exists.has(sp.ids[i]));
      if (!ids.length) break;
      for (const c of copies) {
        await exec(conn, `INSERT INTO ${c.table} (${columnsOf(c.table).join(", ")}, version, is_deleted)
          SELECT ${c.exprs(version + 1).join(", ")} FROM (SELECT * FROM ${c.table} FINAL WHERE study_id = ${S} AND ${c.where} AND is_deleted = 0) AS src`);
        await count(c.table, "1");
      }
      await refreshLabStudy(conn, study, patients);
      break;
    }
    case "profile": {
      const pr = profileOf(study, p);
      const exists = await one(conn, `SELECT count() AS n FROM lab_profile FINAL WHERE study_id = ${S} AND profile_id = ${sq(pr.id)}`);
      if (exists && onConflict === "skip") break;
      if (exists) for (const t of ["lab_profile_value", "lab_sample_profile"])
        await exec(conn, `INSERT INTO ${t} SELECT * REPLACE (${version} AS version, 1 AS is_deleted) FROM ${t} FINAL WHERE study_id = ${S} AND profile_id = ${sq(pr.id)}`);
      const genes = await geneRows(conn, p.genes ?? 20);
      await insertAll(conn, "lab_profile", [{ study_id: study, profile_id: pr.id, alteration_type: pr.alteration, generic_assay_type: null, datatype: pr.datatype,
        name: pr.name, description: "Generated on the update page: random values, for trying updates", show_in_analysis_tab: 1, pivot_threshold: null,
        sort_order: null, patient_level: 0, version: version + 1, is_deleted: 0 }]);
      await exec(conn, `INSERT INTO lab_sample_profile SELECT study_id, sample_id, ${sq(pr.id)}, ${sq(pr.alteration)}, '', ${version + 1}, 0
        FROM lab_sample FINAL WHERE study_id = ${S}`);
      await exec(conn, `INSERT INTO lab_profile_value (study_id, profile_id, sample_id, entrez_gene_id, hugo_gene_symbol, value, version, is_deleted)
        SELECT s.study_id, ${sq(pr.id)}, s.sample_id, g.e, g.h, ${normal(p.seed ?? 1, "s.sample_id", "g.e")}, ${version + 1}, 0
        FROM lab_sample AS s FINAL CROSS JOIN (SELECT arrayJoin(${"[" + genes.map((g) => `(${g.entrez}, ${sq(g.hugo)})`).join(", ") + "]"}) AS x, toInt64(x.1) AS e, x.2 AS h) AS g
        WHERE s.study_id = ${S}`);
      for (const t of ["lab_profile", "lab_sample_profile", "lab_profile_value"]) await count(t, `profile_id = ${sq(pr.id)}`);
      await refreshLabStudy(conn, study, []);
      break;
    }
    case "clinical": {
      const a = attributeOf(p);
      const exists = await one(conn, `SELECT count() AS n FROM lab_clinical_attribute FINAL WHERE study_id = ${S} AND attr_id = ${sq(a.id)}`);
      if (exists && onConflict === "skip") break;
      await insertAll(conn, "lab_clinical_attribute", [{ study_id: study, attr_id: a.id, display_name: a.display, description: "Generated on the update page",
        datatype: a.datatype, patient_attribute: a.level === "patient" ? 1 : 0, priority: "1", version: version + 1, is_deleted: 0 }]);
      const key = a.level === "sample" ? "sample_id" : "patient_id";
      const h = (k: number) => `sipHash64(${p.seed ?? 1}, ${k}, ${key})`;
      const value = a.datatype === "NUMBER" ? `toString(round(${h(2)} % 10000 / 100, 1))` : `${arr(RESPONSES)}[${h(2)} % ${RESPONSES.length} + 1]`;
      await exec(conn, `INSERT INTO lab_clinical (study_id, patient_id, sample_id, attr_id, value, version, is_deleted)
        SELECT study_id, patient_id, ${a.level === "sample" ? "sample_id" : "''"}, ${sq(a.id)}, if(${h(1)} % 10 = 0, '', ${value}), ${version + 1}, 0
        FROM ${a.level === "sample" ? "lab_sample" : "lab_patient"} FINAL WHERE study_id = ${S}`);
      for (const t of ["lab_clinical_attribute", "lab_clinical"]) await count(t, `attr_id = ${sq(a.id)}`);
      break;
    }
    case "mutations": {
      const m = await mutationRows(conn, study, p);
      const existing = new Set(m.existing.map(mutationKey));
      // an update is a new version of the recorded mutation: its own key, new read counts
      const write: Record<string, unknown>[] = [...m.rows.filter((r) => !existing.has(mutationKey(r))),
        ...(onConflict === "update" ? m.existing.map((r) => ({ ...r, tumor_alt_count: m.next(), tumor_ref_count: m.next() })) : [])];
      await insertAll(conn, "lab_mutation", write.map((r) => ({ ...r, version: version + 1, is_deleted: 0 }) as Row));
      rows.lab_mutation = write.length;
      const samples = [...new Set(write.map((r) => String(r.sample_id)))];
      if (samples.length && await one(conn, `SELECT count() AS n FROM lab_clinical_attribute FINAL WHERE study_id = ${S} AND attr_id = 'MUTATION_COUNT'`)) {
        await exec(conn, `INSERT INTO lab_clinical (study_id, patient_id, sample_id, attr_id, value, version, is_deleted)
          SELECT study_id, any(patient_id), sample_id, 'MUTATION_COUNT', toString(count()), ${version + 1}, 0 FROM lab_mutation FINAL
          WHERE study_id = ${S} AND profile_id = ${sq(m.profile)} AND sample_id IN ${list(samples)} GROUP BY study_id, sample_id`);
        await count("lab_clinical", "attr_id = 'MUTATION_COUNT'");
      }
      break;
    }
    case "expression": {
      const e = await expressionCells(conn, study, p);
      const skip = onConflict === "skip" ? `AND (s.x, g.e) NOT IN (SELECT sample_id, entrez_gene_id FROM lab_profile_value FINAL
        WHERE study_id = ${S} AND profile_id = ${sq(e.profile)} AND value NOT IN ('', 'NA'))` : "";
      await exec(conn, `INSERT INTO lab_profile_value (study_id, profile_id, sample_id, entrez_gene_id, hugo_gene_symbol, value, version, is_deleted)
        SELECT ${S}, ${sq(e.profile)}, s.x, g.e, g.h, ${normal((p.seed ?? 1) + 7, "s.x", "g.e")}, ${version + 1}, 0
        FROM (SELECT arrayJoin(${arr(e.samples)}) AS x) AS s CROSS JOIN (SELECT arrayJoin(${"[" + e.genes.map((g) => `(${g.entrez}, ${sq(g.hugo)})`).join(", ") + "]"}) AS y, toInt64(y.1) AS e, y.2 AS h) AS g
        WHERE 1 ${skip}`, { transform_null_in: "1" });
      await count("lab_profile_value", `profile_id = ${sq(e.profile)}`);
      break;
    }
  }
  const merged = merge ? await compactStudy(conn, study) : [];
  return { rows, seconds: (Date.now() - t0) / 1000, merged };
}

// ---- what each kind generates

function profileOf(study: string, p: EditParams) {
  const kind = p.profileKind ?? "expression";
  const def = { expression: ["MRNA_EXPRESSION", "Z-SCORE", "Demo mRNA expression z-scores"], methylation: ["METHYLATION", "CONTINUOUS", "Demo methylation (beta values)"],
    protein: ["PROTEIN_LEVEL", "Z-SCORE", "Demo protein expression z-scores"] }[kind];
  return { id: `${study}_demo_${kind}`, alteration: def[0], datatype: def[1], name: def[2] };
}

function attributeOf(p: EditParams) {
  const id = (p.attribute || "DEMO_RESPONSE").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return { id, display: id.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" "), level: p.level ?? "sample", datatype: p.datatype ?? "STRING" };
}

async function geneRows(conn: WriteConn, n: number): Promise<{ entrez: number; hugo: string }[]> {
  const want = Math.min(Math.max(1, n), 20000);
  const rows = await query<{ e: number; h: string }>(conn, `SELECT entrez_gene_id AS e, hugo_gene_symbol AS h FROM gene
    WHERE entrez_gene_id > 0 AND (hugo_gene_symbol IN ${list(GENES)} OR type = 'protein-coding')
    ORDER BY indexOf(${arr(GENES)}, hugo_gene_symbol) = 0, indexOf(${arr(GENES)}, hugo_gene_symbol), entrez_gene_id LIMIT 1 BY hugo_gene_symbol LIMIT ${want}`);
  return rows.map((r) => ({ entrez: Number(r.e), hugo: r.h }));
}

const mutationKey = (r: Record<string, unknown>) => [r.sample_id, r.hugo_gene_symbol, r.protein_change].map(String).join("|");

async function mutationRows(conn: WriteConn, study: string, p: EditParams) {
  const S = sq(study), profile = study + "_mutations";
  if (!(await one(conn, `SELECT count() AS n FROM lab_profile FINAL WHERE study_id = ${S} AND profile_id = ${sq(profile)}`)))
    throw new Error(`${study} has no mutation profile (${profile}) to add mutations to`);
  const k = Math.min(Math.max(1, p.count ?? 5), 1000), per = Math.min(Math.max(1, p.perSample ?? 2), 20);
  const samples = await query<{ s: string; p: string; panel: string }>(conn, `SELECT sp.sample_id AS s, s.patient_id AS p, sp.panel_id AS panel
    FROM lab_sample_profile AS sp FINAL JOIN lab_sample AS s FINAL ON s.study_id = sp.study_id AND s.sample_id = sp.sample_id
    WHERE sp.study_id = ${S} AND sp.profile_id = ${sq(profile)} ORDER BY sipHash64(sp.sample_id, ${p.seed ?? 1}) LIMIT ${k}`);
  const genes = await query<{ e: number; h: string; t: string | null; chr: string | null; start: number | null }>(conn, `SELECT g.entrez_gene_id AS e, g.hugo_gene_symbol AS h,
      g.type AS t, any(r.chr) AS chr, any(r.start) AS start FROM gene g LEFT JOIN reference_genome_gene r ON r.entrez_gene_id = g.entrez_gene_id
    WHERE g.hugo_gene_symbol IN ${list(GENES)} GROUP BY e, h, t`);
  const panels = [...new Set(samples.map((s) => s.panel).filter(Boolean))];
  const onPanel = new Set((panels.length ? await query<{ x: string }>(conn, `SELECT concat(gp.stable_id, '|', g.hugo_gene_symbol) AS x FROM gene_panel gp
    JOIN gene_panel_list l ON l.internal_id = gp.internal_id JOIN gene g ON g.entrez_gene_id = l.gene_id WHERE gp.stable_id IN ${list(panels)}`) : []).map((r) => r.x));
  const template = (await query<Record<string, unknown>>(conn, `SELECT * EXCEPT (version, is_deleted) FROM lab_mutation FINAL WHERE study_id = ${S} LIMIT 1`))[0] ?? {};
  const r = rng(p.seed ?? 1);
  const next = () => Math.floor(r() * 300) + 5;
  const out: Record<string, unknown>[] = [];
  for (const s of samples)
    for (let i = 0; i < per; i++) {
      const g = genes[Math.floor(r() * genes.length)];
      const pos = Math.floor(r() * 900) + 10, from = AMINO[Math.floor(r() * 20)], to = AMINO[Math.floor(r() * 20)];
      const start = Number(g.start ?? 1_000_000) + pos * 3;
      out.push({ ...template, study_id: study, profile_id: profile, sample_id: s.s, patient_id: s.p, panel_id: s.panel, profiled: 1,
        entrez_gene_id: Number(g.e), hugo_gene_symbol: g.h, gene_type: g.t, off_panel: s.panel === "" || onPanel.has(s.panel + "|" + g.h) ? 0 : 1,
        chr: g.chr ?? "1", start_position: start, end_position: start, reference_allele: "C", tumor_seq_allele: "T", tumor_seq_allele1: "C", tumor_seq_allele2: "T",
        protein_change: `${from}${pos}${to}`, amino_acid_change: `${from}${pos}${to}`, mutation_type: "Missense_Mutation", variant_type: "SNP",
        keyword: `${g.h} ${from}${pos} missense`, protein_pos_start: pos, protein_pos_end: pos, codon_change: null, refseq_mrna_id: null,
        tumor_alt_count: next(), tumor_ref_count: next(), normal_alt_count: 0, normal_ref_count: next(), has_driver: 0, driver_filter: null,
        driver_filter_annotation: null, driver_tiers_filter: null, driver_tiers_filter_annotation: null, annotation_json: null });
    }
  const keys = out.map((m) => `(${sq(String(m.sample_id))}, ${sq(String(m.hugo_gene_symbol))}, ${sq(String(m.protein_change))})`);
  const existing = keys.length ? await query<Record<string, unknown>>(conn, `SELECT * EXCEPT (version, is_deleted) FROM lab_mutation FINAL
    WHERE study_id = ${S} AND profile_id = ${sq(profile)} AND (sample_id, hugo_gene_symbol, ifNull(protein_change, '')) IN (${keys.join(", ")})`) : [];
  return { rows: out, existing, samples: samples.length, profile, next };
}

async function expressionCells(conn: WriteConn, study: string, p: EditParams) {
  const S = sq(study);
  const profiles = await strings(conn, `SELECT profile_id AS x FROM lab_profile FINAL WHERE study_id = ${S} AND datatype != 'DISCRETE'
    AND alteration_type IN ('MRNA_EXPRESSION', 'PROTEIN_LEVEL', 'METHYLATION', 'COPY_NUMBER_ALTERATION') ORDER BY x`);
  if (!profiles.length) throw new Error(`${study} has no continuous profile (expression, protein, methylation or continuous copy number) to set values in`);
  const profile = p.profile && profiles.includes(p.profile) ? p.profile : profiles[0];
  const k = Math.min(Math.max(1, p.count ?? 5), 1000);
  const samples = await strings(conn, `SELECT sample_id AS x FROM lab_sample_profile FINAL WHERE study_id = ${S} AND profile_id = ${sq(profile)}
    ORDER BY sipHash64(sample_id, ${p.seed ?? 1}) LIMIT ${k}`);
  const genes = await geneRows(conn, p.genes ?? 5);
  const existing = await strings(conn, `SELECT concat(hugo_gene_symbol, ' in ', sample_id, ' = ', value) AS x FROM lab_profile_value FINAL
    WHERE study_id = ${S} AND profile_id = ${sq(profile)} AND sample_id IN ${list(samples)} AND entrez_gene_id IN (${genes.map((g) => g.entrez).join(", ") || 0})
    AND value NOT IN ('', 'NA') ORDER BY x`);
  return { profile, profiles, samples, genes, cells: samples.length * genes.length, existing };
}

/** The study's continuous profiles, for the expression edit's choice. */
export async function continuousProfiles(conn: WriteConn, study: string): Promise<string[]> {
  return strings(conn, `SELECT profile_id AS x FROM lab_profile FINAL WHERE study_id = ${sq(study)} AND datatype != 'DISCRETE'
    AND alteration_type IN ('MRNA_EXPRESSION', 'PROTEIN_LEVEL', 'METHYLATION', 'COPY_NUMBER_ALTERATION') ORDER BY x`);
}
