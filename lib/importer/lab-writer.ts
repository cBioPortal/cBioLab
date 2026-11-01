// Writes one study's lab_ rows (lib/importer/lab-schema.ts) from the rows the importer produces for
// cBioPortal's tables. The importer applies cBioPortal's rules once and emits cBioPortal-shaped
// rows; this turns each into its file-shaped row, swapping internal ids for the files' own
// identifiers, so the two schemas always hold the same data. Rows that depend on rows arriving
// later (a mutation's driver annotation, a timeline event's values) are held until `finish`.
//
// Rows go to staging copies of the lab_ tables first; `finish` then merges them in
// (`mergeStaged`): only rows that are new or changed are written, and rows the import no longer
// has get a deletion marker, so importing an unchanged study writes nothing. An update (`scope`
// "samples") replaces only the rows of the samples and patients it names.
//
// Rows are written denormalized: what a query would otherwise join for — the gene's symbol, the
// sample's patient and panel, whether the gene is on that panel, the cytoband — is copied onto
// each row here, and the clinical rows form the full grid of samples (or patients) by the study's
// attributes, with '' where the file has no value. The views then read single tables. Copy-number
// events (lab_cna_event) are kept apart from the matrix values they come from, as cBioPortal's
// sample_cna_event is, so the columns only they need stay off every expression value.
import { Inserter, exec, type Row, type WriteConn } from "./ch-write.ts";
import type { Gene } from "./genes.ts";
import { query } from "./ch-write.ts";
import { LAB_TABLES, NOT_IN_PROFILE_VALUES, mergeStaged, stageName } from "./lab-schema.ts";

/** What the translation needs to know about the study being imported. */
export interface LabStudyContext {
  studyId: string;
  /** internal id → stable id, for each kind the importer numbers */
  patient(id: number): string;
  sample(id: number): { sample: string; patient: string };
  profile(id: number): string;
  panel(id: number): string;
  /** the gene a genetic entity id is, and the gene of an Entrez id */
  geneOfEntity(entityId: number): Gene;
  geneOfEntrez(entrez: number): Gene | null;
  /** the study's reference genome */
  referenceGenome(): string;
  /** every sample and patient the import names */
  sampleIds(): string[];
  patientIds(): string[];
}

/** Whether an import replaces the whole study, or only the samples (and their patients) it names. */
export type MergeScope = "study" | "samples";

type Held = Record<string, unknown>;


type ProfileKind = { alteration_type: unknown; datatype: unknown; show_in_analysis_tab: unknown };

// the lab_ tables a cBioPortal table's rows (or, for a profile, its kind of data file) supply
const SUPPLIES: Record<string, string[]> = {
  patient: ["lab_patient"], sample: ["lab_sample"], clinical_sample: ["lab_clinical"], clinical_patient: ["lab_clinical"],
  sample_profile: ["lab_sample_profile"], copy_number_seg_file: ["lab_segment"], clinical_event: ["lab_timeline_event"]
};
const PROFILE_SUPPLIES: Record<string, string[]> = { MUTATION_EXTENDED: ["lab_mutation"], STRUCTURAL_VARIANT: ["lab_structural_variant"] };
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
  private cytobandOf: Map<number, string> | null = null;
  /** sample|profile → panel ('' for whole exome) of every sample profiled, by stable ids */
  private readonly panels = new Map<string, string>();
  private matrix: Inserter | null = null;
  private readonly sampleIds = new Map<number, string[]>();
  private readonly cnaEvents = new Map<number, { entrez: number; alteration: number }>();
  private readonly sampleCnaEvents: { event: number; sample: number; profile: number }[] = [];
  private readonly profiles = new Map<number, ProfileKind>();
  /** attr_id → whether it is a patient attribute; and the clinical cells the files gave a value */
  private readonly attributes = new Map<string, boolean>();
  private readonly clinical = new Set<string>();
  private readonly samplesSeen = new Set<number>();
  /** samples of a _sequenced case list, and the (sample, profile) pairs with a mutation-profile sample_profile row */
  private readonly sequenced = new Set<string>();
  private readonly mutationProfiled = new Set<string>();
  private readonly profileIds = new Map<string, number>();
  private readonly patientsSeen = new Set<string>();
  private readonly tag = process.pid + "_" + Date.now();
  private staged = false;
  /** lab_ tables this import supplied data for: an update replaces rows only in these */
  private readonly supplied = new Set<string>();
  scope: MergeScope = "study";

  constructor(conn: WriteConn, s: LabStudyContext) { this.conn = conn; this.s = s; }

  private async stage(): Promise<void> {
    if (this.staged) return;
    for (const t of Object.keys(LAB_TABLES)) {
      await exec(this.conn, "DROP TABLE IF EXISTS " + stageName(t, this.tag));
      await exec(this.conn, "CREATE TABLE " + stageName(t, this.tag) + " AS " + t);
    }
    this.staged = true;
  }

  private async write(table: keyof typeof LAB_TABLES, row: Held): Promise<void> {
    await this.stage();
    let ins = this.out.get(table);
    if (!ins) { ins = new Inserter(this.conn, stageName(table, this.tag)); this.out.set(table, ins); }
    await ins.add({ study_id: this.s.studyId, ...row, version: this.version, is_deleted: 0 } as Row);
  }

  /** One row the importer wrote (or would have written) to cBioPortal table `table`. */
  async accept(table: string, r: Row): Promise<void> {
    const n = (k: string) => Number(r[k]);
    const s = this.s;
    for (const t of SUPPLIES[table] ?? []) this.supplied.add(t);
    if (table === "genetic_profile") {
      for (const t of PROFILE_SUPPLIES[String(r.genetic_alteration_type)] ?? ["lab_profile_value"]) this.supplied.add(t);
      if (r.genetic_alteration_type === "COPY_NUMBER_ALTERATION" && r.datatype === "DISCRETE") this.supplied.add("lab_cna_event");
    }
    switch (table) {
      case "cancer_study": this.study = { ...r }; return;
      case "patient": this.patientsSeen.add(String(r.stable_id)); return this.write("lab_patient", { patient_id: r.stable_id });
      case "sample": this.samplesSeen.add(n("internal_id")); return this.write("lab_sample", { sample_id: r.stable_id, patient_id: s.patient(n("patient_id")), sample_type: r.sample_type });
      case "clinical_sample": {
        const x = s.sample(n("internal_id"));
        this.clinical.add(x.sample + "\t" + r.attr_id);
        return this.write("lab_clinical", { patient_id: x.patient, sample_id: x.sample, attr_id: r.attr_id, value: r.attr_value });
      }
      case "clinical_patient": {
        const patient = s.patient(n("internal_id"));
        this.clinical.add("\t" + patient + "\t" + r.attr_id);
        return this.write("lab_clinical", { patient_id: patient, sample_id: "", attr_id: r.attr_id, value: r.attr_value });
      }
      case "clinical_attribute_meta":
        this.attributes.set(String(r.attr_id), Number(r.patient_attribute) === 1);
        return this.write("lab_clinical_attribute", { attr_id: r.attr_id, display_name: r.display_name, description: r.description,
          datatype: r.datatype, patient_attribute: r.patient_attribute, priority: r.priority });
      case "genetic_profile":
        this.profileIds.set(String(r.stable_id), n("genetic_profile_id"));
        this.profiles.set(n("genetic_profile_id"), { alteration_type: r.genetic_alteration_type, datatype: r.datatype, show_in_analysis_tab: r.show_profile_in_analysis_tab });
        return this.write("lab_profile", { profile_id: r.stable_id, alteration_type: r.genetic_alteration_type, generic_assay_type: r.generic_assay_type,
          datatype: r.datatype, name: r.name, description: r.description, show_in_analysis_tab: r.show_profile_in_analysis_tab,
          pivot_threshold: r.pivot_threshold, sort_order: r.sort_order, patient_level: r.patient_level });
      case "genetic_profile_samples":
        this.order.set(n("genetic_profile_id"), String(r.ordered_sample_list).split(",").filter(Boolean).map(Number));
        return;
      case "genetic_alteration": {
        // one row per gene, expanded to one per cell on the server
        const profile = n("genetic_profile_id");
        const kind = String(this.profileKind(profile).alteration_type);
        if (NOT_IN_PROFILE_VALUES.has(kind))
          throw new Error(`lab schema: ${kind} profile ${s.profile(profile)} has matrix values, which lab_profile_value does not hold; this profile type is not supported in the lab schema yet`);
        let ids = this.sampleIds.get(profile);
        if (!ids) { ids = (this.order.get(profile) ?? []).map((x) => s.sample(x).sample); this.sampleIds.set(profile, ids); }
        await this.stage();
        this.matrix ??= new Inserter(this.conn, "lab_profile_value", `INSERT INTO ${stageName("lab_profile_value", this.tag)}
          (study_id, profile_id, sample_id, entrez_gene_id, hugo_gene_symbol, value, version, is_deleted)
          SELECT study_id, profile_id, s, entrez_gene_id, hugo_gene_symbol, v, version, 0
          FROM input('study_id String, profile_id String, entrez_gene_id Int64, hugo_gene_symbol String, samples Array(String), values Array(String), version UInt64')
          ARRAY JOIN samples AS s, values AS v`);
        this.supplied.add("lab_profile_value");
        const gene = s.geneOfEntity(n("genetic_entity_id"));
        await this.matrix.add({ study_id: s.studyId, profile_id: s.profile(profile), entrez_gene_id: gene.entrez, hugo_gene_symbol: gene.hugo, samples: ids,
          values: String(r.values).split(",").slice(0, ids.length), version: this.version });
        return;
      }
      case "sample_profile": {
        const sample = s.sample(n("sample_id")).sample, panel = r.panel_id === null || r.panel_id === undefined ? "" : s.panel(n("panel_id"));
        if (this.profileKind(n("genetic_profile_id")).alteration_type === "MUTATION_EXTENDED") this.mutationProfiled.add(sample);
        this.panels.set(sample + "|" + s.profile(n("genetic_profile_id")), panel);
        return this.write("lab_sample_profile", { sample_id: s.sample(n("sample_id")).sample, profile_id: s.profile(n("genetic_profile_id")),
          alteration_type: this.profileKind(n("genetic_profile_id")).alteration_type,
          panel_id: panel });
      }
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
        if (/_sequenced$/.test(this.lists.get(n("list_id")) ?? "")) this.sequenced.add(s.sample(n("sample_id")).sample);
        return this.write("lab_case_list_sample", { list_id: this.lists.get(n("list_id")), sample_id: s.sample(n("sample_id")).sample });
      case "cna_event": this.cnaEvents.set(n("cna_event_id"), { entrez: n("entrez_gene_id"), alteration: n("alteration") }); return;
      case "sample_cna_event": this.sampleCnaEvents.push({ event: n("cna_event_id"), sample: n("sample_id"), profile: n("genetic_profile_id") }); return;
      case "copy_number_seg_file": return;
      default: throw new Error("lab schema: no translation for rows of " + table);
    }
  }

  /** Entrez id → cytoband in the study's reference genome. */
  private async cytobands(): Promise<Map<number, string>> {
    if (this.cytobandOf) return this.cytobandOf;
    const genome = this.s.referenceGenome().replace(/[^A-Za-z0-9_.-]/g, "");
    const rows = await query<{ e: number; c: string }>(this.conn, `SELECT r.entrez_gene_id AS e, r.cytoband AS c FROM reference_genome_gene r
      JOIN reference_genome g ON g.reference_genome_id = r.reference_genome_id WHERE g.name = '${genome}'`);
    this.cytobandOf = new Map(rows.map((r) => [Number(r.e), r.c]));
    return this.cytobandOf;
  }

  /** Whether a gene is outside a panel ('' for whole exome: every gene with a positive Entrez id). */
  private offPanel(panelGenes: Map<string, Set<string>>, panel: string, hugo: string, entrez: unknown): number {
    if (panel === "") return Number(entrez) > 0 && hugo !== "" ? 0 : 1;
    return panelGenes.get(panel)?.has(hugo) ? 0 : 1;
  }

  private profileKind(id: number): ProfileKind {
    const k = this.profiles.get(id);
    if (!k) throw new Error("lab schema: data for profile " + id + " before the profile");
    return k;
  }

  private gene(entrez: unknown): { hugo: string; type: string | null } {
    const g = entrez === null || entrez === undefined ? null : this.s.geneOfEntrez(Number(entrez));
    return { hugo: g?.hugo ?? "", type: g?.type ?? null };
  }

  /** Writes what was held back, with the study's precomputed counts, and flushes every table. */
  async finish(counts: Record<string, number>, referenceGenome: string): Promise<void> {
    const s = this.s;
    const driverOf = (key: string) => {
      const d = this.drivers.get(key);
      return d ? { has_driver: 1, ...Object.fromEntries(DRIVER.map((k) => [k, d[k] ?? null])) } : { has_driver: 0, ...Object.fromEntries(DRIVER.map((k) => [k, null])) };
    };
    // samples of a _sequenced case list count as profiled for <study>_mutations, as cBioPortal's
    // derived-table script writes them into sample_profile
    const mutations = this.profileIds.get(s.studyId + "_mutations");
    if (mutations !== undefined)
      for (const sample of this.sequenced)
        if (!this.mutationProfiled.has(sample)) {
          this.panels.set(sample + "|" + s.studyId + "_mutations", "");
          await this.write("lab_sample_profile", { sample_id: sample, profile_id: s.studyId + "_mutations",
            alteration_type: this.profileKind(mutations).alteration_type, panel_id: "" });
        }
    const used = [...new Set(this.panels.values())].filter(Boolean).map((p) => "'" + p.replace(/[^A-Za-z0-9_.-]/g, "") + "'");
    const panelGenes = new Map<string, Set<string>>();
    if (used.length)
      for (const r of await query<{ p: string; g: string[] }>(this.conn, `SELECT gp.stable_id AS p, groupArray(g.hugo_gene_symbol) AS g FROM gene_panel gp
        JOIN gene_panel_list gpl ON gpl.internal_id = gp.internal_id JOIN gene g ON g.entrez_gene_id = gpl.gene_id WHERE gp.stable_id IN (${used.join(", ")}) GROUP BY gp.stable_id`))
        panelGenes.set(r.p, new Set(r.g));
    const placed = (sample: string, profile: string) => {
      const panel = this.panels.get(sample + "|" + profile);
      return { panel_id: panel ?? "", profiled: panel === undefined ? 0 : 1 };
    };
    for (const [key, m] of this.mutations) {
      const { mutation_event_id: ev, genetic_profile_id: profile, sample_id: sample, entrez_gene_id: entrez, ...fields } = m;
      const { mutation_event_id: _id, entrez_gene_id: _entrez, ...event } = this.events.get(Number(ev)) ?? {};
      const x = s.sample(Number(sample)), gene = this.gene(entrez), at = placed(x.sample, s.profile(Number(profile)));
      await this.write("lab_mutation", { profile_id: s.profile(Number(profile)), sample_id: x.sample, patient_id: x.patient, entrez_gene_id: entrez,
        hugo_gene_symbol: gene.hugo, gene_type: gene.type, ...at, off_panel: this.offPanel(panelGenes, at.panel_id, gene.hugo, entrez),
        ...event, ...fields, ...driverOf(key) });
    }
    let index = 0;
    for (const [id, v] of [...this.svs].sort((a, b) => a[0] - b[0])) {
      const { internal_id: _i, genetic_profile_id: profile, sample_id: sample, ...fields } = v;
      const x = s.sample(Number(sample)), at = placed(x.sample, s.profile(Number(profile)));
      const g1 = this.gene(fields.site1_entrez_gene_id).hugo, g2 = this.gene(fields.site2_entrez_gene_id).hugo;
      await this.write("lab_structural_variant", { profile_id: s.profile(Number(profile)), sample_id: x.sample, patient_id: x.patient,
        sv_index: index++, ...fields, site1_hugo_gene_symbol: g1, site2_hugo_gene_symbol: g2, ...at,
        site1_off_panel: this.offPanel(panelGenes, at.panel_id, g1, fields.site1_entrez_gene_id),
        site2_off_panel: this.offPanel(panelGenes, at.panel_id, g2, fields.site2_entrez_gene_id), ...driverOf([id, profile, sample].join("|")) });
    }
    const cytobands = this.sampleCnaEvents.length ? await this.cytobands() : new Map<number, string>();
    // events an earlier study created: cBioPortal's cna_event ids are shared across studies
    const known = [...new Set(this.sampleCnaEvents.map((x) => x.event))].filter((id) => !this.cnaEvents.has(id));
    if (known.length)
      for (const r of await query<{ i: number; e: number; a: number }>(this.conn,
        `SELECT cna_event_id AS i, entrez_gene_id AS e, alteration AS a FROM cna_event WHERE cna_event_id IN (${known.join(", ")})`))
        this.cnaEvents.set(Number(r.i), { entrez: Number(r.e), alteration: Number(r.a) });
    for (const x of this.sampleCnaEvents) {
      const ev = this.cnaEvents.get(x.event);
      if (!ev) throw new Error("lab schema: unknown CNA event " + x.event);
      const sample = s.sample(x.sample), gene = this.gene(ev.entrez), at = placed(sample.sample, s.profile(x.profile));
      await this.write("lab_cna_event", { profile_id: s.profile(x.profile), sample_id: sample.sample, patient_id: sample.patient, ...at,
        entrez_gene_id: ev.entrez, hugo_gene_symbol: gene.hugo, cytoband: cytobands.get(ev.entrez) ?? null, alteration: ev.alteration,
        off_panel: this.offPanel(panelGenes, at.panel_id, gene.hugo, ev.entrez) });
    }
    let e = 0;
    for (const [, v] of [...this.timeline].sort((a, b) => a[0] - b[0]))
      await this.write("lab_timeline_event", { patient_id: s.patient(Number(v.patient_id)), event_index: e++, event_type: v.event_type,
        start_date: v.start_date, stop_date: v.stop_date, data: v.data });
    // the empty cells of the clinical grid
    const sampleAttrs = [...this.attributes].filter(([, p]) => !p).map(([a]) => a), patientAttrs = [...this.attributes].filter(([, p]) => p).map(([a]) => a);
    const patientOf = new Map<string, string>();
    for (const id of this.samplesSeen) { const x = s.sample(id); patientOf.set(x.sample, x.patient); }
    for (const [sample, patient] of patientOf)
      for (const a of sampleAttrs) if (!this.clinical.has(sample + "\t" + a)) await this.write("lab_clinical", { patient_id: patient, sample_id: sample, attr_id: a, value: "" });
    for (const patient of this.patientsSeen)
      for (const a of patientAttrs) if (!this.clinical.has("\t" + patient + "\t" + a)) await this.write("lab_clinical", { patient_id: patient, sample_id: "", attr_id: a, value: "" });
    const st = this.study ?? {};
    await this.write("lab_study", { type_of_cancer_id: st.type_of_cancer_id, name: st.name, description: st.description, public: st.public,
      pmid: st.pmid, citation: st.citation, groups: st.groups, status: st.status, import_date: st.import_date, reference_genome: referenceGenome,
      mirna_sample_count: 0, ...counts });
    for (const ins of this.out.values()) await ins.flush();
    await this.matrix?.flush();
    await mergeStaged(this.conn, s.studyId, this.tag, this.version,
      this.scope === "study" ? null : { samples: s.sampleIds(), patients: s.patientIds(), profiles: [...this.profileIds.keys()], tables: this.supplied });
  }
}
