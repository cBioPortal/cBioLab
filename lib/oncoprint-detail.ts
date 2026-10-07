// One column's detail, fetched only when a reader hovers it.
//
// A 400k-column contract carries a bitmask per cell and nothing else, because shipping a
// protein change and an OncoKB level for every alteration would multiply the payload for
// information almost none of which is ever read. This is the other half of that bargain:
// the tooltip asks for one column and gets the specifics.
import { chQueryRows, STUDY } from "./ch.ts";
import { sq } from "./compiler.ts";
import { buildAnnotationIndex } from "./annotation.ts";
import type { OncoprintSpec } from "./types.ts";

export interface ColumnDetail {
  column: string;
  study: string;
  unit: "patient" | "sample";
  /** one entry per alteration this column carries in the figure's genes */
  alterations: { gene: string; kind: string; alteration: string; driver: boolean }[];
  /** gene panels this column was assayed with, and which of the figure's genes they cover */
  panels: { panel: string; covers: string[] }[];
  /** the figure's genes no panel of this column covers */
  notProfiled: string[];
  annotation: string;
}

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

/** Which study a column belongs to; federated ids are "<study>_<id>". */
export function studyOfColumn(column: string, studies: string[]): { study: string; id: string } {
  if (studies.length <= 1) return { study: studies[0] || STUDY, id: column };
  for (const s of studies) if (column.startsWith(s + "_")) return { study: s, id: column.slice(s.length + 1) };
  return { study: studies[0], id: column };
}

export async function columnDetail(spec: OncoprintSpec, column: string): Promise<ColumnDetail> {
  if (!ID_RE.test(column)) throw new Error("column id is not a valid identifier");
  const genes = (spec.genes || []).map((g) => String(g).toUpperCase().trim()).filter((g) => GENE_RE.test(g)).slice(0, 12);
  if (!genes.length) throw new Error("at least one valid gene symbol required");
  const studies = (Array.isArray(spec.studies) && spec.studies.length ? spec.studies : [spec.study || STUDY])
    .map((s) => String(s).replace(/[^A-Za-z0-9._-]/g, ""));
  const { study, id } = studyOfColumn(column, studies);
  // the answer names one patient's alterations: only from a study held at patient level
  const { patientLevelConn } = await import("./federation.ts");
  const conn = await patientLevelConn(study, "a column's detail is one patient's data");
  const db = conn.db;
  const unit = spec.unit === "sample" ? "sample" as const : "patient" as const;
  const uid = sq(study + "_" + id);
  const idCol = unit === "sample" ? "sample_unique_id" : "patient_unique_id";

  const ev = await chQueryRows(
    "SELECT hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt, mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND " + idCol + " = " + uid + "\n" +
    "  AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")", conn);
  const rows = ev.rows.map((r) => ({ pid: id, gene: r[0] as string, vt: r[1] as string, mt: r[2] as string, mv: r[3] as string, cna: r[4] as string }));

  const panelRows = await chQueryRows(
    "SELECT sp.gene_panel_id AS panel, groupUniqArray(pg.gene) AS covers\n" +
    "FROM " + db + ".sample_to_gene_panel_derived sp\n" +
    "LEFT JOIN " + db + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genes.map(sq).join(",") + ")\n" +
    (unit === "sample" ? "" : "JOIN " + db + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n") +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "  AND " + (unit === "sample" ? "sp.sample_unique_id" : "sd.patient_unique_id") + " = " + uid + "\n" +
    "GROUP BY panel", conn);
  const panels = panelRows.rows.map((r) => ({ panel: String(r[0]), covers: ((r[1] as string[]) || []).filter(Boolean) }));
  const covered = new Set(panels.flatMap((p) => p.covers));

  const annotation = spec.display?.annotate === "none"
    ? { isDriver: () => false, source: "none — driver annotation turned off for this figure" }
    : await buildAnnotationIndex(rows, genes, study);

  const label = (r: typeof rows[number]): { kind: string; alteration: string } => {
    if (r.vt === "mutation") return { kind: r.mt || "Mutation", alteration: r.mv || "" };
    if (r.vt === "structural_variant") return { kind: "Structural Variant", alteration: r.mv || "fusion" };
    const v = Number(r.cna);
    return { kind: v >= 2 ? "Amplification" : v <= -2 ? "Deep Deletion" : "Copy number", alteration: String(r.cna ?? "") };
  };
  return {
    column, study, unit,
    alterations: rows.map((r) => ({ gene: r.gene, ...label(r), driver: annotation.isDriver(r) })),
    panels,
    notProfiled: genes.filter((g) => !covered.has(g) && !rows.some((r) => r.gene === g)),
    annotation: annotation.source
  };
}
