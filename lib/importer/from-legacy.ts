// Builds the lab_ tables (lib/importer/lab-schema.ts) from a database in cBioPortal's own schema on
// the same ClickHouse server, a study at a time, by SQL alone: nothing passes through this process.
// It applies the translation lab-writer.ts applies to the importer's rows (internal ids swapped for
// the files' identifiers, the gene symbol, patient, panel and cytoband copied onto each row, the
// clinical grid filled with '') to the rows already stored in cBioPortal's tables. The rows go to
// staging copies of the lab_ tables and are merged in as an import's are (`mergeStaged`), so
// converting a study again writes only what changed in it.
//
// The destination database holds the lab_ tables, copies of the source's reference tables (genes,
// panels, reference genomes, cancer types) and the views that present the lab_ tables under
// cBioPortal's names: a database in the `new` schema mode, read by the app as any other.
import { exec, query, sq, type WriteConn } from "./ch-write.ts";
import { LAB_TABLES, LEGACY_BASE_TABLES, NOT_IN_PROFILE_VALUES, columnsOf, compactStudy, createLabTables, createViews, derivedTypes, mergeStaged,
  refreshLabStudy, removeLabStudy, stageName } from "./lab-schema.ts";
import { derivedTablesSql } from "./setup.ts";

// shared by every study, copied with their rows; the source's other tables are created empty
const REFERENCE_TABLES = ["gene", "gene_alias", "gene_panel", "gene_panel_list", "geneset", "geneset_gene", "geneset_hierarchy_leaf",
  "geneset_hierarchy_node", "genetic_entity", "reference_genome", "reference_genome_gene", "type_of_cancer", "info"];

const STUDY_COUNTS = ["sample_count", "mutation_sample_count", "cna_sample_count", "structural_variant_sample_count", "rna_seq_sample_count",
  "mrna_microarray_sample_count", "mrna_expression_sample_count", "rppa_sample_count", "mass_spectrometry_sample_count", "mirna_sample_count",
  "treatment_patient_count"];

// every JOIN below that may find nothing says so with NULL, and every such column is handled with ifNull
const SETTINGS = { join_use_nulls: "1" };

const ident = (name: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("not a database name: " + name);
  return "`" + name + "`";
};

/** A source table, read through FINAL when its engine replaces rows. */
async function sourceTables(conn: WriteConn, source: string): Promise<(name: string) => string> {
  const rows = await query<{ n: string; e: string }>(conn, `SELECT name AS n, engine AS e FROM system.tables WHERE database = ${sq(source)}`);
  const engines = new Map(rows.map((r) => [r.n, r.e]));
  return (name: string) => {
    const e = engines.get(name);
    if (e === undefined) throw new Error(`${source}.${name} does not exist`);
    return `${ident(source)}.${name}` + (/Replacing|Collapsing/.test(e) ? " FINAL" : "");
  };
}

/**
 * Makes the current database a `new`-schema database fed from `source`: the source's tables other
 * than the study tables the views replace (and its derived tables), the reference ones with their
 * rows; the lab_ tables; and the views, typed as the source's derived tables are.
 */
export async function setupFromLegacy(conn: WriteConn, dataDir: string, source: string, log: (msg: string) => void): Promise<void> {
  await exec({ ...conn, db: "default" }, "CREATE DATABASE IF NOT EXISTS " + ident(conn.db));
  const replaced = new Set([...LEGACY_BASE_TABLES, ...Object.keys(LAB_TABLES)]);
  const tables = await query<{ n: string }>(conn, `SELECT name AS n FROM system.tables WHERE database = ${sq(source)}
    AND engine NOT IN ('View', 'MaterializedView') AND name NOT LIKE '%\\_derived' AND name NOT LIKE '%\\_temp' AND name NOT LIKE 'lab%' ORDER BY name`);
  const have = new Set((await query<{ n: string }>(conn, "SELECT name AS n FROM system.tables WHERE database = currentDatabase()")).map((r) => r.n));
  for (const { n } of tables) {
    if (replaced.has(n) || have.has(n)) continue;
    await exec(conn, `CREATE TABLE ${n} AS ${ident(source)}.${n}`);
    if (REFERENCE_TABLES.includes(n)) {
      log("Copying reference table " + n);
      await exec(conn, `INSERT INTO ${n} SELECT * FROM ${ident(source)}.${n}`);
    }
  }
  await createLabTables(conn, log);
  log("Creating the views over the lab_ tables");
  await createViews(conn, "new", await derivedTablesSql(dataDir), await derivedTypes({ ...conn, db: source }, ""));
  await exec(conn, "CREATE TABLE IF NOT EXISTS cbiolab_schema (mode String, at DateTime64(3) DEFAULT now64(3)) ENGINE = MergeTree ORDER BY at");
  await exec(conn, "INSERT INTO cbiolab_schema (mode) VALUES ('new')");
  await exec(conn, "CREATE TABLE IF NOT EXISTS cbiolab_setup (commit String, at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY tuple()");
  if (!(await query(conn, "SELECT 1 FROM cbiolab_setup LIMIT 1")).length) await exec(conn, `INSERT INTO cbiolab_setup (commit) VALUES (${sq("from " + source)})`);
}

export interface StudyChange { studyId: string; change: "new" | "changed" | "removed" }

/** The studies whose import date in `source` differs from the converted copy's, and those no longer in `source`. */
export async function changedStudies(conn: WriteConn, source: string): Promise<StudyChange[]> {
  const t = await sourceTables(conn, source);
  const rows = await query<{ s: string; d: string }>(conn, `SELECT ifNull(src.s, dst.study_id) AS s,
      multiIf(dst.study_id IS NULL, 'new', src.s IS NULL, 'removed', 'changed') AS d
    FROM (SELECT cancer_study_identifier AS s, import_date AS d FROM ${t("cancer_study")} WHERE cancer_study_identifier IS NOT NULL) AS src
    FULL JOIN (SELECT study_id, import_date FROM lab_study FINAL) AS dst ON dst.study_id = src.s
    WHERE src.s IS NULL OR dst.study_id IS NULL OR ifNull(src.d, toDateTime64(0, 6)) != dst.import_date
    ORDER BY s
    SETTINGS join_use_nulls = 1`);
  return rows.map((r) => ({ studyId: r.s, change: r.d as StudyChange["change"] }));
}

export interface ConvertResult { studyId: string; rows: Record<string, number>; skipped: string[]; seconds: number }

/**
 * Converts one study of `source` into the current database's lab_ tables. Profiles whose values
 * the lab_ tables do not hold (generic assays) are left out and named in `skipped`.
 */
export async function convertStudy(conn: WriteConn, source: string, studyId: string, log: (msg: string) => void = () => undefined): Promise<ConvertResult> {
  const t0 = Date.now();
  const t = await sourceTables(conn, source);
  const S = sq(studyId);
  const found = await query<{ i: number }>(conn, `SELECT cancer_study_id AS i FROM ${t("cancer_study")} WHERE cancer_study_identifier = ${S}`);
  if (found.length !== 1) throw new Error(`${source} has ${found.length} studies named ${studyId}`);
  const sid = Number(found[0].i);
  const version = Date.now();
  const tag = "conv" + process.pid + "_" + version;
  const V = `${version} AS version, 0 AS is_deleted`;
  // the study's rows of cBioPortal's id-keyed tables, as subqueries keyed by internal id
  const patients = `(SELECT internal_id, stable_id FROM ${t("patient")} WHERE cancer_study_id = ${sid})`;
  const samples = `(SELECT s.internal_id AS internal_id, s.stable_id AS stable_id, p.stable_id AS patient, s.sample_type AS sample_type
    FROM ${t("sample")} AS s JOIN ${patients} AS p ON p.internal_id = s.patient_id)`;
  const profiles = `(SELECT genetic_profile_id, stable_id, genetic_alteration_type, datatype FROM ${t("genetic_profile")} WHERE cancer_study_id = ${sid})`;
  const genes = `(SELECT entrez_gene_id, hugo_gene_symbol, type, genetic_entity_id FROM ${t("gene")})`;
  const profileIds = `(SELECT genetic_profile_id FROM ${profiles})`;
  const sampleIds = `(SELECT internal_id FROM ${samples})`;
  const of = (table: string, column: string, ids: string) => `(SELECT * FROM ${t(table)} WHERE ${column} IN ${ids})`;
  const stage = (table: string) => stageName(table, tag);
  // where each sample was profiled for each profile, read back from the staged rows
  const placed = `(SELECT sample_id, profile_id, panel_id FROM ${stage("lab_sample_profile")})`;
  const panelGenes = `(SELECT gp.stable_id AS panel_id, g.hugo_gene_symbol AS hugo FROM ${t("gene_panel")} AS gp
    JOIN ${t("gene_panel_list")} AS gpl ON gpl.internal_id = gp.internal_id JOIN ${t("gene")} AS g ON g.entrez_gene_id = gpl.gene_id)`;
  // a gene outside the sample's panel ('' for whole exome: every gene with a positive Entrez id)
  const offPanel = (panel: string, hugo: string, entrez: string) =>
    `if(${panel} = '', if(ifNull(${entrez}, 0) > 0 AND ${hugo} != '', 0, 1), if((${panel}, ${hugo}) IN (SELECT panel_id, hugo FROM ${panelGenes}), 0, 1))`;
  const driver = ["driver_filter", "driver_filter_annotation", "driver_tiers_filter", "driver_tiers_filter_annotation"];

  const rows: Record<string, number> = {};
  const insert = async (table: string, select: string) => {
    log("Writing " + table);
    await exec(conn, `INSERT INTO ${stage(table)} (${[...columnsOf(table), "version", "is_deleted"].join(", ")}) ${select}`, SETTINGS);
  };
  const skipped = (await query<{ p: string }>(conn, `SELECT stable_id AS p FROM ${profiles}
    WHERE genetic_alteration_type IN (${[...NOT_IN_PROFILE_VALUES].filter((k) => k === "GENERIC_ASSAY").map(sq).join(", ")}) ORDER BY p`)).map((r) => r.p);
  const hasCounts = (await query(conn, `SELECT 1 FROM system.columns WHERE database = ${sq(source)} AND table = 'cancer_study' AND name = 'sample_count'`)).length > 0;

  try {
    for (const table of Object.keys(LAB_TABLES)) {
      await exec(conn, "DROP TABLE IF EXISTS " + stage(table));
      await exec(conn, `CREATE TABLE ${stage(table)} AS ${table}`);
    }
    await insert("lab_study", `SELECT ${S}, c.type_of_cancer_id, c.name, c.description, c.public, c.pmid, c.citation, c.groups, c.status,
        ifNull(c.import_date, toDateTime64(0, 6)), ifNull(r.name, 'hg19'),
        ${STUDY_COUNTS.map((k) => hasCounts && k !== "mirna_sample_count" ? `c.${k}` : "0").join(", ")}, ${V}
      FROM ${t("cancer_study")} AS c LEFT JOIN ${t("reference_genome")} AS r ON r.reference_genome_id = c.reference_genome_id
      WHERE c.cancer_study_id = ${sid}`);
    await insert("lab_patient", `SELECT ${S}, stable_id, ${V} FROM ${patients}`);
    await insert("lab_sample", `SELECT ${S}, stable_id, patient, sample_type, ${V} FROM ${samples}`);
    await insert("lab_clinical_attribute", `SELECT ${S}, attr_id, display_name, description, datatype, patient_attribute, priority, ${V}
      FROM ${t("clinical_attribute_meta")} WHERE cancer_study_id = ${sid}`);
    // the clinical grid: every value, then '' for each sample (patient) and attribute of its kind without one
    const attrs = (patient: number) => `(SELECT attr_id FROM ${t("clinical_attribute_meta")} WHERE cancer_study_id = ${sid} AND patient_attribute = ${patient})`;
    await insert("lab_clinical", `SELECT ${S}, s.patient, s.stable_id, v.attr_id, v.attr_value, ${V}
      FROM ${of("clinical_sample", "internal_id", sampleIds)} AS v JOIN ${samples} AS s ON s.internal_id = v.internal_id`);
    await insert("lab_clinical", `SELECT ${S}, s.patient, s.stable_id, a.attr_id, '', ${V} FROM ${samples} AS s CROSS JOIN ${attrs(0)} AS a
      WHERE (s.internal_id, a.attr_id) NOT IN (SELECT internal_id, attr_id FROM ${of("clinical_sample", "internal_id", sampleIds)})`);
    await insert("lab_clinical", `SELECT ${S}, p.stable_id, '', v.attr_id, v.attr_value, ${V}
      FROM ${of("clinical_patient", "internal_id", `(SELECT internal_id FROM ${patients})`)} AS v JOIN ${patients} AS p ON p.internal_id = v.internal_id`);
    await insert("lab_clinical", `SELECT ${S}, p.stable_id, '', a.attr_id, '', ${V} FROM ${patients} AS p CROSS JOIN ${attrs(1)} AS a
      WHERE (p.internal_id, a.attr_id) NOT IN (SELECT internal_id, attr_id FROM ${of("clinical_patient", "internal_id", `(SELECT internal_id FROM ${patients})`)})`);
    await insert("lab_profile", `SELECT ${S}, stable_id, genetic_alteration_type, generic_assay_type, datatype, name, description,
        show_profile_in_analysis_tab, pivot_threshold, sort_order, patient_level, ${V}
      FROM ${t("genetic_profile")} WHERE cancer_study_id = ${sid}`);
    await insert("lab_sample_profile", `SELECT ${S}, s.stable_id, gp.stable_id, gp.genetic_alteration_type, ifNull(pn.stable_id, ''), ${V}
      FROM ${of("sample_profile", "genetic_profile_id", profileIds)} AS sp JOIN ${samples} AS s ON s.internal_id = sp.sample_id
      JOIN ${profiles} AS gp ON gp.genetic_profile_id = sp.genetic_profile_id LEFT JOIN ${t("gene_panel")} AS pn ON pn.internal_id = sp.panel_id`);
    // samples of a _sequenced case list count as profiled for <study>_mutations, as cBioPortal's derived-table script writes them
    await insert("lab_sample_profile", `SELECT ${S}, s.stable_id, gp.stable_id, gp.genetic_alteration_type, '', ${V}
      FROM ${of("sample_list_list", "sample_id", sampleIds)} AS l JOIN ${samples} AS s ON s.internal_id = l.sample_id
      JOIN ${profiles} AS gp ON gp.stable_id = ${sq(studyId + "_mutations")}
      WHERE l.list_id IN (SELECT list_id FROM ${t("sample_list")} WHERE cancer_study_id = ${sid} AND stable_id = ${sq(studyId + "_sequenced")})
        AND s.stable_id NOT IN (SELECT sample_id FROM ${stage("lab_sample_profile")} WHERE alteration_type = 'MUTATION_EXTENDED')`);
    // a matrix row is one comma-joined string, in the order of the profile's sample list
    await insert("lab_profile_value", `SELECT ${S}, x.profile, s.stable_id, x.entrez, x.hugo, x.value, ${V}
      FROM (SELECT gp.stable_id AS profile, g.entrez_gene_id AS entrez, g.hugo_gene_symbol AS hugo, cell.1 AS sample, cell.2 AS value
        FROM ${of("genetic_alteration", "genetic_profile_id", profileIds)} AS ga
        JOIN ${profiles} AS gp ON gp.genetic_profile_id = ga.genetic_profile_id
        JOIN ${of("genetic_profile_samples", "genetic_profile_id", profileIds)} AS o ON o.genetic_profile_id = ga.genetic_profile_id
        JOIN ${genes} AS g ON g.genetic_entity_id = ga.genetic_entity_id
        ARRAY JOIN arrayMap((id, v) -> (toInt64(id), v), arrayFilter((x) -> x != '', splitByChar(',', o.ordered_sample_list)) AS ids,
          arrayResize(splitByChar(',', ga.values), length(ids), '')) AS cell
        WHERE gp.genetic_alteration_type NOT IN (${[...NOT_IN_PROFILE_VALUES].map(sq).join(", ")})) AS x
      JOIN ${samples} AS s ON s.internal_id = x.sample`);
    const eventColumns = ["chr", "start_position", "end_position", "reference_allele", "tumor_seq_allele", "protein_change", "mutation_type", "ncbi_build",
      "strand", "variant_type", "db_snp_rs", "db_snp_val_status", "refseq_mrna_id", "codon_change", "uniprot_accession", "protein_pos_start",
      "protein_pos_end", "canonical_transcript", "keyword"];
    const mutationColumns = columnsOf("lab_mutation").slice(columnsOf("lab_mutation").indexOf("center"), columnsOf("lab_mutation").indexOf("has_driver"));
    await insert("lab_mutation", `SELECT ${S}, gp.stable_id, s.stable_id, s.patient, ifNull(at.panel_id, ''), at.sample_id IS NOT NULL, m.entrez_gene_id,
        ifNull(g.hugo_gene_symbol, '') AS hugo, g.type, ${offPanel("ifNull(at.panel_id, '')", "hugo", "m.entrez_gene_id")},
        ${eventColumns.map((c) => "e." + c).join(", ")}, ${mutationColumns.map((c) => "m." + c).join(", ")},
        d.sample_id IS NOT NULL, ${driver.map((c) => "d." + c).join(", ")}, ${V}
      FROM ${of("mutation", "genetic_profile_id", profileIds)} AS m JOIN ${profiles} AS gp ON gp.genetic_profile_id = m.genetic_profile_id
      JOIN ${samples} AS s ON s.internal_id = m.sample_id
      JOIN ${of("mutation_event", "mutation_event_id", `(SELECT mutation_event_id FROM ${t("mutation")} WHERE genetic_profile_id IN ${profileIds})`)} AS e
        ON e.mutation_event_id = m.mutation_event_id
      LEFT JOIN ${genes} AS g ON g.entrez_gene_id = m.entrez_gene_id
      LEFT JOIN ${placed} AS at ON at.sample_id = s.stable_id AND at.profile_id = gp.stable_id
      LEFT JOIN ${of("alteration_driver_annotation", "genetic_profile_id", profileIds)} AS d
        ON d.alteration_event_id = m.mutation_event_id AND d.genetic_profile_id = m.genetic_profile_id AND d.sample_id = m.sample_id`);
    const svColumns = columnsOf("lab_structural_variant").filter((c) => !["study_id", "profile_id", "sample_id", "patient_id", "sv_index",
      "site1_hugo_gene_symbol", "site2_hugo_gene_symbol", "panel_id", "profiled", "site1_off_panel", "site2_off_panel", "has_driver", ...driver].includes(c));
    // numbered in the order cBioPortal stored them, as the importer numbers a file's rows
    await insert("lab_structural_variant", `SELECT ${S}, gp.stable_id, s.stable_id, s.patient,
        toUInt32(row_number() OVER (ORDER BY v.internal_id) - 1),
        v.site1_entrez_gene_id, ifNull(g1.hugo_gene_symbol, '') AS hugo1, ifNull(g2.hugo_gene_symbol, '') AS hugo2,
        ifNull(at.panel_id, '') AS panel, at.sample_id IS NOT NULL,
        ${offPanel("panel", "hugo1", "v.site1_entrez_gene_id")}, ${offPanel("panel", "hugo2", "v.site2_entrez_gene_id")},
        ${svColumns.filter((c) => c !== "site1_entrez_gene_id").map((c) => "v." + c).join(", ")},
        d.sample_id IS NOT NULL, ${driver.map((c) => "d." + c).join(", ")}, ${V}
      FROM ${of("structural_variant", "genetic_profile_id", profileIds)} AS v JOIN ${profiles} AS gp ON gp.genetic_profile_id = v.genetic_profile_id
      JOIN ${samples} AS s ON s.internal_id = v.sample_id
      LEFT JOIN ${genes} AS g1 ON g1.entrez_gene_id = v.site1_entrez_gene_id
      LEFT JOIN ${genes} AS g2 ON g2.entrez_gene_id = v.site2_entrez_gene_id
      LEFT JOIN ${placed} AS at ON at.sample_id = s.stable_id AND at.profile_id = gp.stable_id
      LEFT JOIN ${of("alteration_driver_annotation", "genetic_profile_id", profileIds)} AS d
        ON d.alteration_event_id = v.internal_id AND d.genetic_profile_id = v.genetic_profile_id AND d.sample_id = v.sample_id`);
    await insert("lab_cna_event", `SELECT ${S}, gp.stable_id, s.stable_id, s.patient, ifNull(at.panel_id, '') AS panel, at.sample_id IS NOT NULL,
        e.entrez_gene_id, ifNull(g.hugo_gene_symbol, '') AS hugo, cb.cytoband, toInt8(e.alteration), ${offPanel("panel", "hugo", "e.entrez_gene_id")}, ${V}
      FROM ${of("sample_cna_event", "genetic_profile_id", profileIds)} AS x JOIN ${profiles} AS gp ON gp.genetic_profile_id = x.genetic_profile_id
      JOIN ${samples} AS s ON s.internal_id = x.sample_id
      JOIN ${of("cna_event", "cna_event_id", `(SELECT cna_event_id FROM ${t("sample_cna_event")} WHERE genetic_profile_id IN ${profileIds})`)} AS e
        ON e.cna_event_id = x.cna_event_id
      LEFT JOIN ${genes} AS g ON g.entrez_gene_id = e.entrez_gene_id
      LEFT JOIN ${placed} AS at ON at.sample_id = s.stable_id AND at.profile_id = gp.stable_id
      LEFT JOIN (SELECT r.entrez_gene_id AS entrez_gene_id, any(r.cytoband) AS cytoband FROM ${t("reference_genome_gene")} AS r
        WHERE r.reference_genome_id = (SELECT reference_genome_id FROM ${t("cancer_study")} WHERE cancer_study_id = ${sid})
        GROUP BY r.entrez_gene_id) AS cb ON cb.entrez_gene_id = e.entrez_gene_id`);
    await insert("lab_segment", `SELECT ${S}, s.stable_id, c.chr, c.start, c.end, c.num_probes, c.segment_mean, ${V}
      FROM ${t("copy_number_seg")} AS c JOIN ${samples} AS s ON s.internal_id = c.sample_id WHERE c.cancer_study_id = ${sid}`);
    // numbered in the order cBioPortal stored them, each event's values by key (cBioPortal keeps no
    // order for them); written in slices of patients, so no slice
    // gathers more than ~2M of the events' values
    const events = of("clinical_event", "patient_id", `(SELECT internal_id FROM ${patients})`);
    const values = (await query<{ n: number }>(conn, `SELECT count() AS n FROM ${t("clinical_event_data")}
      WHERE clinical_event_id IN (SELECT clinical_event_id FROM ${events})`))[0]?.n ?? 0;
    const slices = Math.max(1, Math.ceil(Number(values) / 2_000_000));
    for (let i = 0; i < slices; i++) {
      const slice = `(SELECT * FROM ${events} WHERE patient_id % ${slices} = ${i})`;
      await insert("lab_timeline_event", `SELECT ${S}, p.stable_id, ix.n, e.event_type, e.start_date, e.stop_date, ifNull(kv.data, map()), ${V}
        FROM ${slice} AS e JOIN ${patients} AS p ON p.internal_id = e.patient_id
        JOIN (SELECT clinical_event_id, patient_id, toUInt32(row_number() OVER (ORDER BY clinical_event_id) - 1) AS n FROM ${events}) AS ix
          ON ix.clinical_event_id = e.clinical_event_id AND ix.patient_id % ${slices} = ${i}
        LEFT JOIN (SELECT clinical_event_id, mapSort(CAST((groupArray(key), groupArray(value)), 'Map(String, String)')) AS data
          FROM ${t("clinical_event_data")} WHERE clinical_event_id IN (SELECT clinical_event_id FROM ${slice}) GROUP BY clinical_event_id) AS kv
          ON kv.clinical_event_id = e.clinical_event_id`);
    }
    await insert("lab_case_list", `SELECT ${S}, stable_id, category, name, description, ${V} FROM ${t("sample_list")} WHERE cancer_study_id = ${sid}`);
    await insert("lab_case_list_sample", `SELECT ${S}, l.stable_id, s.stable_id, ${V}
      FROM ${of("sample_list_list", "sample_id", sampleIds)} AS ll JOIN (SELECT list_id, stable_id FROM ${t("sample_list")} WHERE cancer_study_id = ${sid}) AS l ON l.list_id = ll.list_id
      JOIN ${samples} AS s ON s.internal_id = ll.sample_id`);
    for (const table of Object.keys(LAB_TABLES))
      rows[table] = Number((await query<{ n: number }>(conn, `SELECT count() AS n FROM ${stage(table)}`))[0]?.n ?? 0);
    log("Merging into the lab_ tables");
    await mergeStaged(conn, studyId, tag, version, null);
  } finally {
    for (const table of Object.keys(LAB_TABLES)) await exec(conn, "DROP TABLE IF EXISTS " + stage(table));
  }
  if (!hasCounts) await refreshLabStudy(conn, studyId, []);
  log("Merging the study's partitions");
  await compactStudy(conn, studyId);
  return { studyId, rows, skipped, seconds: (Date.now() - t0) / 1000 };
}

/** Removes a study the source no longer has. */
export async function removeConverted(conn: WriteConn, studyId: string): Promise<boolean> {
  return removeLabStudy(conn, studyId);
}
