// The data sets catalog: every study each configured instance holds, with how many of its samples
// carry each kind of data — the portal's Data Sets page, built from the same tables every view
// queries. Counts only; restricted studies are left out exactly as the router leaves them out.
import { chQuery, connections, type ChConn } from "./ch.ts";
import { isRestrictedStudy } from "./federation.ts";

export interface DatasetRow {
  id: string; name: string; cancerType: string;
  citation: string | null; pmids: string[];
  build: string;
  patients: number; samples: number;
  /** samples with each data type, as the study's own import counted them */
  mutation: number; cna: number; sv: number; mrna: number; protein: number;
  /** RNA-seq and microarray samples separately (the portal's RNA-Seq and mRNA Microarray columns) */
  rnaseq: number; microarray: number;
  /** samples with copy-number segments; patients with any timeline event; patients with treatments */
  segments: number; timeline: number; treatments: number;
  methylation: boolean;
  /** FACETS allele-specific copy number for its current mutation profile */
  ascn: boolean;
  /** generic assay types the study carries (mutational signatures, arm-level CNA, …) */
  genericAssays: string[];
  instance: string; instanceLabel: string;
}

const n = (x: unknown) => Number(x) || 0;

/** One instance's catalog. A failed side query degrades its column to empty, never the row. */
export async function datasetsFor(conn: ChConn): Promise<DatasetRow[]> {
  const db = conn.db;
  const q = async (sql: string) => (await chQuery<Record<string, unknown>>(sql, conn)).data;
  const soft = (sql: string) => q(sql).catch(() => [] as Record<string, unknown>[]);
  const [studies, patients, segs, timeline, profiles, ascn, toc] = await Promise.all([
    q("SELECT cs.cancer_study_identifier AS id, cs.cancer_study_id AS cid, cs.name AS name, cs.type_of_cancer_id AS toc,\n" +
      "       cs.citation AS citation, cs.pmid AS pmid, rg.name AS build,\n" +
      "       cs.sample_count AS samples, cs.mutation_sample_count AS mutation, cs.cna_sample_count AS cna,\n" +
      "       cs.structural_variant_sample_count AS sv, cs.mrna_expression_sample_count AS mrna_expr,\n" +
      "       cs.rna_seq_sample_count AS rnaseq, cs.mrna_microarray_sample_count AS microarray,\n" +
      "       cs.rppa_sample_count AS rppa, cs.mass_spectrometry_sample_count AS ms, cs.treatment_patient_count AS treatments\n" +
      "FROM " + db + ".cancer_study cs LEFT JOIN " + db + ".reference_genome rg ON rg.reference_genome_id = cs.reference_genome_id"),
    q("SELECT cancer_study_identifier AS id, uniqExact(patient_unique_id) AS patients, uniqExact(sample_unique_id) AS samples FROM " + db + ".sample_derived GROUP BY id"),
    soft("SELECT cancer_study_id AS cid, uniqExact(sample_id) AS n FROM " + db + ".copy_number_seg GROUP BY cid"),
    soft("SELECT cancer_study_identifier AS id, uniqExact(patient_id) AS n FROM " + db + ".clinical_event_derived GROUP BY id"),
    soft("SELECT cancer_study_id AS cid, groupUniqArray(genetic_alteration_type) AS types,\n" +
      "       groupUniqArrayIf(generic_assay_type, genetic_alteration_type = 'GENERIC_ASSAY') AS ga,\n" +
      "       countIf(genetic_alteration_type = 'MRNA_EXPRESSION' AND position(stable_id, 'rna_seq') > 0) > 0 AS has_rnaseq,\n" +
      "       countIf(genetic_alteration_type = 'MRNA_EXPRESSION' AND position(stable_id, 'rna_seq') = 0 AND position(stable_id, 'mrna') > 0) > 0 AS has_array\n" +
      "FROM " + db + ".genetic_profile GROUP BY cid"),
    soft("SELECT DISTINCT gp.cancer_study_id AS cid FROM " + db + ".allele_specific_copy_number a\n" +
      "JOIN " + db + ".genetic_profile gp ON gp.genetic_profile_id = a.genetic_profile_id"),
    soft("SELECT type_of_cancer_id AS id, name FROM " + db + ".type_of_cancer")
  ]);
  const byId = <K extends string>(rows: Record<string, unknown>[], key: K) => new Map(rows.map((r) => [String(r[key]), r]));
  const pat = byId(patients, "id"), seg = byId(segs, "cid"), tl = byId(timeline, "id"), prof = byId(profiles, "cid");
  const ascnSet = new Set(ascn.map((r) => String(r.cid)));
  const tocName = new Map(toc.map((r) => [String(r.id), String(r.name)]));
  return studies.filter((s) => !isRestrictedStudy(String(s.id), String(s.name))).map((s): DatasetRow => {
    const id = String(s.id), cid = String(s.cid);
    const types = (prof.get(cid)?.types as string[] | undefined) || [];
    const ga = (prof.get(cid)?.ga as string[] | undefined) || [];
    const p = pat.get(id);
    return {
      id, name: String(s.name),
      cancerType: tocName.get(String(s.toc)) || String(s.toc),
      citation: s.citation ? String(s.citation) : null,
      pmids: String(s.pmid || "").split(/[,;\s]+/).filter((x) => /^\d+$/.test(x)),
      build: String(s.build || "unknown"),
      patients: n(p?.patients), samples: n(p?.samples) || n(s.samples),
      mutation: n(s.mutation), cna: n(s.cna), sv: n(s.sv),
      mrna: Math.max(n(s.mrna_expr), n(s.rnaseq), n(s.microarray)),
      // the portal's columns: a study's own count, else its expression count when its profile is that kind
      rnaseq: n(s.rnaseq) || (Number(prof.get(cid)?.has_rnaseq) ? n(s.mrna_expr) : 0),
      microarray: n(s.microarray) || (Number(prof.get(cid)?.has_array) && !Number(prof.get(cid)?.has_rnaseq) ? n(s.mrna_expr) : 0),
      protein: Math.max(n(s.rppa), n(s.ms)),
      segments: n(seg.get(cid)?.n), timeline: n(tl.get(id)?.n), treatments: n(s.treatments),
      // methylation arrives as its own profile type in some studies and as a generic assay in most
      methylation: types.includes("METHYLATION") || ga.includes("METHYLATION"),
      ascn: ascnSet.has(cid),
      genericAssays: ga.filter((x) => x && x !== "METHYLATION").sort(),
      instance: conn.id, instanceLabel: conn.label
    };
  });
}

/** Every instance's catalog, first instance winning an id collision (the router's rule); the
 *  instances that did not answer are named rather than silently missing. */
export async function allDatasets(): Promise<{ rows: DatasetRow[]; unreachable: string[] }> {
  const unreachable: string[] = [];
  const per = await Promise.all(connections().map((c) => datasetsFor(c).catch(() => { unreachable.push(c.label); return [] as DatasetRow[]; })));
  const seen = new Set<string>(), rows: DatasetRow[] = [];
  for (const list of per) for (const r of list) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  rows.sort((a, b) => b.samples - a.samples);
  return { rows, unreachable };
}
