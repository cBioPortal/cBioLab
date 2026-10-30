// What one study import shares across its steps: the connection, the gene resolver, the study's
// internal ids, its patients and samples, the profiled-sample map and the report the page shows.
import { Inserter, insertAll, query, type Row, type WriteConn } from "./ch-write.ts";
import type { GeneResolver } from "./genes.ts";
import { writesLab, writesLegacy, type SchemaMode } from "./lab-schema.ts";
import { LabWriter } from "./lab-writer.ts";

// shared reference tables: written as they are in every schema mode
const REFERENCE = new Set(["type_of_cancer", "gene", "gene_alias", "genetic_entity", "gene_panel", "gene_panel_list"]);

/** Where an importer step sends rows for one cBioPortal table; `ImportContext.sink`. */
export interface Sink { add(row: Row): Promise<void>; flush(): Promise<void> }

export interface FileReport {
  file: string;
  kind: string;
  /** rows stored */
  stored: number;
  /** rows read */
  read: number;
  /** reason → rows left out for it */
  skipped: Record<string, number>;
  notes: string[];
}

export type Progress = (event: { step: string; file?: string; detail?: string }) => void;

// Internal-id columns allocated by the importer (max + 1, as the legacy DAOs do)
const ID_SOURCES = {
  patient: "internal_id FROM patient",
  sample: "internal_id FROM sample",
  profile: "genetic_profile_id FROM genetic_profile",
  mutationEvent: "mutation_event_id FROM mutation_event",
  cnaEvent: "cna_event_id FROM cna_event",
  seg: "seg_id FROM copy_number_seg",
  segFile: "seg_file_id FROM copy_number_seg_file",
  clinicalEvent: "clinical_event_id FROM clinical_event",
  sampleList: "list_id FROM sample_list",
  sv: "internal_id FROM structural_variant",
  geneticEntity: "id FROM genetic_entity"
} as const;
export type IdKind = keyof typeof ID_SOURCES;

export interface Profile { id: number; stableId: string; type: string; datatype: string; showInAnalysisTab: boolean }

export class ImportContext {
  readonly conn: WriteConn;
  readonly genes: GeneResolver;
  readonly studyId: string;
  readonly mode: SchemaMode;
  /** writes the lab_ tables, in `new` and `both` modes */
  readonly lab: LabWriter | null;
  cancerStudyId = 0;
  referenceGenomeId = 1;
  referenceGenome = "hg19";
  private readonly next = new Map<IdKind, number>();
  /** patient stable id → internal id */
  readonly patients = new Map<string, number>();
  /** sample stable id → internal ids */
  readonly samples = new Map<string, { id: number; patient: number }>();
  /** sample internal id → sample type, as the clinical file or a TCGA barcode says */
  readonly sampleTypes = new Map<number, string>();
  /** samples created because a data file named them and no clinical file did */
  readonly implicitSamples: string[] = [];
  /** `${sampleId}:${profileId}` → panel internal id (null = whole exome/genome) */
  readonly sampleProfile = new Map<string, { sample: number; profile: number; panel: number | null }>();
  readonly profiles: Profile[] = [];
  readonly reports: FileReport[] = [];
  readonly warnings: string[] = [];
  readonly progress: Progress;
  /** stable id → internal id of every gene panel in the database */
  panels = new Map<string, number>();
  /** sample internal id → loci of its non-germline mutations, for MUTATION_COUNT */
  readonly mutationLoci = new Map<number, Set<string>>();
  /** patients with a TREATMENT timeline event */
  readonly treatedPatients = new Set<number>();

  constructor(conn: WriteConn, genes: GeneResolver, studyId: string, progress: Progress, mode: SchemaMode = "legacy") {
    this.conn = conn; this.genes = genes; this.studyId = studyId; this.progress = progress; this.mode = mode;
    this.lab = writesLab(mode) ? new LabWriter(conn, this.labContext()) : null;
  }

  private labContext() {
    const stable = <K>(m: () => Map<string, K>, id: (v: K) => number) => {
      let rev: Map<number, string> | null = null;
      return (n: number) => {
        if (!rev || !rev.has(n)) rev = new Map([...m()].map(([k, v]) => [id(v), k]));
        const v = rev.get(n);
        if (v === undefined) throw new Error("lab schema: unknown internal id " + n);
        return v;
      };
    };
    const patient = stable(() => this.patients, (v) => v);
    const sample = stable(() => this.samples, (v) => v.id);
    const panel = stable(() => this.panels, (v) => v);
    return {
      studyId: this.studyId,
      patient,
      sample: (n: number) => ({ sample: sample(n), patient: patient(this.samples.get(sample(n))!.patient) }),
      profile: (n: number) => { const p = this.profiles.find((x) => x.id === n); if (!p) throw new Error("lab schema: unknown profile " + n); return p.stableId; },
      panel: (n: number) => panel(n),
      entrez: (entity: number) => { const g = this.genes.byEntity(entity); if (!g) throw new Error("lab schema: unknown genetic entity " + entity); return g.entrez; }
    };
  }

  /** Rows for cBioPortal table `table`: to that table, to the lab_ tables, or both, as the schema mode says. */
  sink(table: string): Sink {
    const legacy = writesLegacy(this.mode) || REFERENCE.has(table) ? new Inserter(this.conn, table) : null;
    const lab = REFERENCE.has(table) ? null : this.lab;
    return {
      add: async (row) => { if (legacy) await legacy.add(row); if (lab) await lab.accept(table, row); },
      flush: async () => { if (legacy) await legacy.flush(); }
    };
  }

  async insertAll(table: string, rows: Iterable<Row>): Promise<void> {
    if (writesLegacy(this.mode) || REFERENCE.has(table)) await insertAll(this.conn, table, rows);
    if (this.lab && !REFERENCE.has(table)) for (const r of rows) await this.lab.accept(table, r);
  }

  async loadIds(): Promise<void> {
    for (const [k, src] of Object.entries(ID_SOURCES) as [IdKind, string][]) {
      // with no legacy tables the ids live only in this import; genetic entities are shared
      if (!writesLegacy(this.mode) && k !== "geneticEntity") { this.next.set(k, 1); continue; }
      const [col, from] = src.split(" FROM ");
      const r = await query<{ m: number }>(this.conn, "SELECT max(" + col + ") AS m FROM " + from);
      this.next.set(k, Number(r[0]?.m ?? 0) + 1);
    }
    await this.loadPanels();
  }

  async loadPanels(): Promise<void> {
    const p = await query<{ s: string; i: number }>(this.conn, "SELECT stable_id AS s, internal_id AS i FROM gene_panel");
    this.panels = new Map(p.map((x) => [x.s, Number(x.i)]));
  }

  id(kind: IdKind): number {
    const v = this.next.get(kind) ?? 1;
    this.next.set(kind, v + 1);
    return v;
  }

  report(file: string, kind: string): FileReport {
    const r: FileReport = { file, kind, stored: 0, read: 0, skipped: {}, notes: [] };
    this.reports.push(r);
    return r;
  }

  patient(stableId: string): number {
    let id = this.patients.get(stableId);
    if (id === undefined) { id = this.id("patient"); this.patients.set(stableId, id); }
    return id;
  }

  /**
   * The internal id of a sample a data file names. A sample no clinical file listed is created
   * (with a patient of the same id) and reported, where the legacy importer would abort.
   */
  sampleFor(stableId: string): number {
    const s = this.samples.get(stableId);
    if (s) return s.id;
    const patient = this.patient(stableId);
    const id = this.id("sample");
    this.samples.set(stableId, { id, patient });
    this.implicitSamples.push(stableId);
    return id;
  }

  profiled(sample: number, profile: number, panel: number | null): void {
    this.sampleProfile.set(sample + ":" + profile, { sample, profile, panel });
  }

  profileByStableSuffix(suffix: string): Profile | undefined {
    const full = suffix.startsWith(this.studyId + "_") ? suffix : this.studyId + "_" + suffix;
    return this.profiles.find((p) => p.stableId === full);
  }
}

export function skip(r: FileReport, reason: string): void {
  r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
}

// TCGA barcodes (cbioportal-core StableIdUtil)
const TCGA_SAMPLE = /^(TCGA-\w\w-\w\w\w\w-\d\d).*$/;
const TCGA_SAMPLE_TYPE = /^TCGA-\w\w-\w\w\w\w-(\d\d).*$/;
const TCGA_PATIENT_FROM_SAMPLE = /^(TCGA-\w\w-\w\w\w\w)-\d\d.*$/;

/** A sample id as cBioPortal stores it: TCGA barcodes are cut to `TCGA-XX-XXXX-NN`. */
export function sampleId(barcode: string): string {
  if (!barcode.startsWith("TCGA")) return barcode;
  const clean = barcode.includes("Tumor") ? barcode.replace("Tumor", "01") : barcode.includes("Normal") ? barcode.replace("Normal", "11") : barcode;
  const parts = clean.split("-");
  if (parts.length < 4) return barcode + "-01";
  const id = parts.slice(0, 4).join("-");
  return TCGA_SAMPLE.exec(id)?.[1] ?? id;
}

export function tcgaPatient(sample: string): string | null {
  return TCGA_PATIENT_FROM_SAMPLE.exec(sample)?.[1] ?? null;
}

/** TCGA normal-tissue barcodes (sample type 10 or 11), which cBioPortal never stores. */
export function isNormalBarcode(barcode: string): boolean {
  const code = TCGA_SAMPLE_TYPE.exec(barcode)?.[1];
  return code === "10" || code === "11";
}

export const TCGA_SAMPLE_TYPES: Record<string, string> = {
  "01": "Primary Solid Tumor", "02": "Recurrent Solid Tumor", "03": "Primary Blood Tumor", "04": "Recurrent Blood Tumor",
  "06": "Metastatic", "10": "Blood Derived Normal", "11": "Solid Tissues Normal"
};
