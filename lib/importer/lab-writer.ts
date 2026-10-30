// Writes one study's lab_ rows (lib/importer/lab-schema.ts) from the rows the importer produces for
// cBioPortal's tables. The importer applies cBioPortal's rules once and emits cBioPortal-shaped
// rows; this turns each into its file-shaped row, swapping internal ids for the files' own
// identifiers, so the two schemas always hold the same data. Rows that depend on rows arriving
// later (a mutation's driver annotation, a timeline event's values) are held until `finish`.
import { Inserter, type Row, type WriteConn } from "./ch-write.ts";
import { LAB_TABLES } from "./lab-schema.ts";

/** What the translation needs to know about the study being imported. */
export interface LabStudyContext {
  studyId: string;
  /** internal id → stable id, for each kind the importer numbers */
  patient(id: number): string;
  sample(id: number): { sample: string; patient: string };
  profile(id: number): string;
  panel(id: number): string;
  /** genetic entity id → Entrez id of the gene it is */
  entrez(entityId: number): number;
}

type Held = Record<string, unknown>;
const DRIVER = ["driver_filter", "driver_filter_annotation", "driver_tiers_filter", "driver_tiers_filter_annotation"] as const;

export class LabWriter {
  private readonly conn: WriteConn;
  private readonly s: LabStudyContext;
  private readonly version = Date.now();
  private readonly out = new Map<string, Inserter>();
  private study: Held | null = null;
  private readonly order = new Map<number, number[]>();
  private readonly events = new Map<number, Held>();
  private readonly mutations = new Map<string, Held>();
  private readonly svs = new Map<number, Held>();
  private readonly drivers = new Map<string, Held>();
  private readonly timeline = new Map<number, Held & { data: Record<string, string> }>();
  private readonly lists = new Map<number, string>();

  constructor(conn: WriteConn, s: LabStudyContext) { this.conn = conn; this.s = s; }

  private async write(table: keyof typeof LAB_TABLES, row: Held): Promise<void> {
    let ins = this.out.get(table);
    if (!ins) { ins = new Inserter(this.conn, table); this.out.set(table, ins); }
    await ins.add({ study_id: this.s.studyId, ...row, version: this.version, is_deleted: 0 } as Row);
  }

  /** One row the importer wrote (or would have written) to cBioPortal table `table`. */
  async accept(table: string, r: Row): Promise<void> {
    const n = (k: string) => Number(r[k]);
    const s = this.s;
    switch (table) {
      case "cancer_study": this.study = { ...r }; return;
      case "patient": return this.write("lab_patient", { patient_id: r.stable_id });
      case "sample": return this.write("lab_sample", { sample_id: r.stable_id, patient_id: s.patient(n("patient_id")), sample_type: r.sample_type });
      case "clinical_sample": {
        const x = s.sample(n("internal_id"));
        return this.write("lab_clinical", { patient_id: x.patient, sample_id: x.sample, attr_id: r.attr_id, value: r.attr_value });
      }
      case "clinical_patient":
        return this.write("lab_clinical", { patient_id: s.patient(n("internal_id")), sample_id: "", attr_id: r.attr_id, value: r.attr_value });
      case "clinical_attribute_meta":
        return this.write("lab_clinical_attribute", { attr_id: r.attr_id, display_name: r.display_name, description: r.description,
          datatype: r.datatype, patient_attribute: r.patient_attribute, priority: r.priority });
      case "genetic_profile":
        return this.write("lab_profile", { profile_id: r.stable_id, alteration_type: r.genetic_alteration_type, generic_assay_type: r.generic_assay_type,
          datatype: r.datatype, name: r.name, description: r.description, show_in_analysis_tab: r.show_profile_in_analysis_tab,
          pivot_threshold: r.pivot_threshold, sort_order: r.sort_order, patient_level: r.patient_level });
      case "genetic_profile_samples":
        this.order.set(n("genetic_profile_id"), String(r.ordered_sample_list).split(",").filter(Boolean).map(Number));
        return;
      case "genetic_alteration": {
        const profile = n("genetic_profile_id"), samples = this.order.get(profile) ?? [];
        const values = String(r.values).split(",").slice(0, samples.length);
        const pid = s.profile(profile), entrez = s.entrez(n("genetic_entity_id"));
        for (let i = 0; i < values.length; i++)
          await this.write("lab_profile_value", { profile_id: pid, sample_id: s.sample(samples[i]).sample, entrez_gene_id: entrez, value: values[i] });
        return;
      }
      case "sample_profile":
        return this.write("lab_sample_profile", { sample_id: s.sample(n("sample_id")).sample, profile_id: s.profile(n("genetic_profile_id")),
          panel_id: r.panel_id === null || r.panel_id === undefined ? "" : s.panel(n("panel_id")) });
      case "mutation_event": this.events.set(n("mutation_event_id"), { ...r }); return;
      case "mutation": this.mutations.set([r.mutation_event_id, r.genetic_profile_id, r.sample_id].join("|"), { ...r }); return;
      case "structural_variant": this.svs.set(n("internal_id"), { ...r }); return;
      case "alteration_driver_annotation": this.drivers.set([r.alteration_event_id, r.genetic_profile_id, r.sample_id].join("|"), { ...r }); return;
      case "copy_number_seg":
        return this.write("lab_segment", { sample_id: s.sample(n("sample_id")).sample, chr: r.chr, start: r.start, end: r.end,
          num_probes: r.num_probes, segment_mean: r.segment_mean });
      case "clinical_event":
        this.timeline.set(n("clinical_event_id"), { ...r, data: {} });
        return;
      case "clinical_event_data": {
        const ev = this.timeline.get(n("clinical_event_id"));
        if (ev) ev.data[String(r.key)] = String(r.value);
        return;
      }
      case "sample_list":
        this.lists.set(n("list_id"), String(r.stable_id));
        return this.write("lab_case_list", { list_id: r.stable_id, category: r.category, name: r.name, description: r.description });
      case "sample_list_list":
        return this.write("lab_case_list_sample", { list_id: this.lists.get(n("list_id")), sample_id: s.sample(n("sample_id")).sample });
      // derived from lab_profile_value / not part of the file-shaped data
      case "cna_event": case "sample_cna_event": case "copy_number_seg_file": return;
      default: throw new Error("lab schema: no translation for rows of " + table);
    }
  }

  /** Writes what was held back, with the study's precomputed counts, and flushes every table. */
  async finish(counts: Record<string, number>, referenceGenome: string): Promise<void> {
    const s = this.s;
    const driverOf = (key: string) => {
      const d = this.drivers.get(key);
      return d ? { has_driver: 1, ...Object.fromEntries(DRIVER.map((k) => [k, d[k] ?? null])) } : { has_driver: 0, ...Object.fromEntries(DRIVER.map((k) => [k, null])) };
    };
    for (const [key, m] of this.mutations) {
      const { mutation_event_id: ev, genetic_profile_id: profile, sample_id: sample, entrez_gene_id: entrez, ...fields } = m;
      const { mutation_event_id: _id, entrez_gene_id: _entrez, ...event } = this.events.get(Number(ev)) ?? {};
      await this.write("lab_mutation", { profile_id: s.profile(Number(profile)), sample_id: s.sample(Number(sample)).sample, entrez_gene_id: entrez,
        ...event, ...fields, ...driverOf(key) });
    }
    let index = 0;
    for (const [id, v] of [...this.svs].sort((a, b) => a[0] - b[0])) {
      const { internal_id: _i, genetic_profile_id: profile, sample_id: sample, ...fields } = v;
      await this.write("lab_structural_variant", { profile_id: s.profile(Number(profile)), sample_id: s.sample(Number(sample)).sample,
        sv_index: index++, ...fields, ...driverOf([id, profile, sample].join("|")) });
    }
    let e = 0;
    for (const [, v] of [...this.timeline].sort((a, b) => a[0] - b[0]))
      await this.write("lab_timeline_event", { patient_id: s.patient(Number(v.patient_id)), event_index: e++, event_type: v.event_type,
        start_date: v.start_date, stop_date: v.stop_date, data: v.data });
    const st = this.study ?? {};
    await this.write("lab_study", { type_of_cancer_id: st.type_of_cancer_id, name: st.name, description: st.description, public: st.public,
      pmid: st.pmid, citation: st.citation, groups: st.groups, status: st.status, import_date: st.import_date, reference_genome: referenceGenome,
      mirna_sample_count: 0, ...counts });
    for (const ins of this.out.values()) await ins.flush();
  }
}
