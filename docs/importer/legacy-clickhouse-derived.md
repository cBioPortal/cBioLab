# Legacy cBioPortal ClickHouse derived tables: hidden calculations

Scope: read-only audit of
- `ref/cbioportal/src/main/resources/db-scripts/clickhouse/populate_derived_tables.sql` (abbrev. **PDT**)
- `ref/cbioportal/src/main/resources/db-scripts/clickhouse/init/schema.sql` (abbrev. **SCHEMA**)
- `ref/cbioportal/src/main/resources/db-scripts/clickhouse/migrate/{migrate_schema.sql,migrate_db.py}`
- `ref/cbioportal-core/scripts/clickhouse_import_support/*`, `ref/cbioportal-core/scripts/importer/{metaImport.py,rebuild_derived_tables.py,cbioportalImporter.py}`
- `ref/cbioportal-core/src/main/java/org/mskcc/cbio/portal/dao/ClickHouse*.java`

A few importer (Java) facts outside that scope are included because they decide what the
base tables contain and so what the derived tables can contain. They are labelled **[importer]**.
All paths below are relative to `ref/`.

ClickHouse semantics this document relies on (they are server settings, not in the SQL):
- `join_use_nulls = 0` (default): a LEFT/RIGHT JOIN miss fills **non-Nullable** columns with the
  type default (`''`, `0`), and **Nullable** columns with `NULL`. PDT relies on this explicitly
  (`if(gene_panel.stable_id = '', 'WES', ...)`).
- `insert_null_as_default = 1` (default): inserting `NULL` into a non-Nullable column stores the
  type default (`''`, `0`). **Uncertain only in that it depends on the target server's settings**;
  with defaults this is what happens.

---

## Top 10 (ranked by risk of a silent mismatch)

1. **CNA events are only ±2, and only for "discrete" CNA profiles.** `cna_event` holds only
   alteration 2 / -2 ([importer] `CnaUtil.java:49-52`); `-1.5` is rewritten to `-2` for events
   ([importer] `ImportTabDelimData.java:668-671`) while `genetic_alteration` keeps the raw
   `-1.5`. Events are only created when the profile is `COPY_NUMBER_ALTERATION` **and**
   `show_profile_in_analysis_tab = true` ([importer] `ImportTabDelimData.java:161-163`). On top
   of that, PDT:228 INNER JOINs `reference_genome_gene` on the study's genome, so CNA events for
   genes without a row for that genome silently disappear from `genomic_event_derived`.
2. **Gene panel default "WES" + `off_panel`.** A `sample_profile.panel_id` that is NULL (or
   unknown) becomes `'WES'` (PDT:94,164,200,236,270). `gene_panel_to_gene_derived` contains a
   synthetic `WES` panel = **every gene in the global `gene` table with entrez > 0** (PDT:111-116).
   `off_panel` = `(panel, hugo_symbol) NOT IN gene_panel_to_gene_derived` (PDT:179-182 etc.) —
   matched by **HUGO symbol**, not entrez.
3. **`sample_profile` is mutated in place before derivation.** PDT:49-82 inserts, into the live
   base table, a row (`panel_id = NULL` → WES) for every member of any sample list whose stable_id
   matches `LIKE '%_sequenced'` that has no MUTATION_EXTENDED `sample_profile` row in that study,
   attached to profile `<study>_mutations`. This makes those samples "profiled for mutations" in
   `sample_to_gene_panel_derived` even though they had no MAF rows.
4. **`clinical_data_derived` is a dense cross-product.** Every sample × every sample-level
   `clinical_attribute_meta` row of its study (and every patient × every patient-level attr),
   with `''` when there is no value (PDT:305-337). Values are raw strings: no numeric parsing,
   no trimming, no NA handling. Patient rows have `sample_unique_id = ''`.
5. **`sample_derived.sequenced` matches by sample stable_id across ALL studies.** PDT:121-130 +
   PDT:151: `sample.stable_id IN sequenced_samples` where `sequenced_samples` is just stable IDs
   from every study's `<study>_sequenced` list. A sample whose barcode is in another study's
   sequenced list gets `sequenced = 1`.
6. **Structural variants are written once per distinct gene partner.** PDT:231-300: site1 row
   (INNER JOIN gene on site1) + site2 row (INNER JOIN gene on site2, only if
   `site2 != site1 OR site1 IS NULL`). A two-gene fusion = 2 rows with identical
   `sv_event_info`/driver fields; an SV with no resolvable gene at either site is dropped.
7. **`genetic_alteration_derived` drops `'NA'` AND empty values; `generic_assay_data_derived`
   keeps `'NA'`.** PDT:390,400 maps `''`→NULL then `WHERE alteration_value != 'NA'` (NULL fails
   the predicate too). PDT:439 does the same mapping but has no WHERE; NULL then lands in a
   non-Nullable String column as `''`. Values are stored as unparsed strings in both. Only
   entities that are genes survive (INNER JOIN `gene`, PDT:396), so geneset scores are excluded.
8. **Importer-computed clinical attributes are in the clinical data.** [importer]
   `MUTATION_COUNT` (`DaoMutation.java:143-193`) = count of DISTINCT
   `(chr,start,end,ref,alt)` per sample, excluding `mutation_status = 'GERMLINE'`
   (case-insensitive), with the mutation join **not restricted to the profile** (any profile's
   mutations for that sample count). `FRACTION_GENOME_ALTERED`
   (`FractionGenomeAlteredCalculator.java:15-44`) = Σlen(|seg_mean| ≥ 0.2) / Σlen, 4 dp HALF_UP,
   samples with zero measured length omitted. Both auto-create their `clinical_attribute_meta`
   row (datatype NUMBER, priority "30"/"20").
9. **Mutation rows are pre-filtered at import, but not in PDT.** [importer]
   `MutationFilter.java:77-125` rejects Mutation_Status starting with None/LOH/Wildtype,
   Validation_Status starting with Redacted, and (default) types Silent/Intron/3'UTR/3'Flank/
   5'UTR/IGR; 5'Flank is kept only for TERT (entrez 7015) and its protein_change rewritten to
   `Promoter`. Matching is case-insensitive **prefix**. PDT itself does not filter germline,
   uncalled profiles, or mutation types. `genomic_event_derived` requires a `sample_profile`
   row (INNER JOIN, PDT:185); `mutation_derived` does not.
10. **NULL/'' coercions differ per table.** Missing driver annotations are `''` in
    `genomic_event_derived` (non-Nullable target, PDT:171-174) but `NULL` in `mutation_derived`
    (PDT:485-488); `mutation_status`/`protein_change`/`mutation_type` NULL → `''` in
    `genomic_event_derived`; `ascn_method ''` → NULL in `mutation_derived` (PDT:493);
    `clinical_event_data_derived.stop_date` NULL → 0 and events with no attributes yield one row
    with `key = ''`, `value = ''` (PDT:363,367).

---

## How the derived tables are rebuilt

| Aspect | Fact | Where |
|---|---|---|
| Granularity | **Full rebuild of every study every time.** No `WHERE` on study anywhere in PDT. | PDT:88-532 |
| Mechanism | `CREATE TABLE x_temp AS x` → `INSERT ... SELECT` → `OPTIMIZE` → `EXCHANGE TABLES` → drop temp. DDL lives in SCHEMA, not PDT. | PDT:19-31, 534-572 |
| Pre-step dedup | `OPTIMIZE TABLE ... FINAL` on ReplacingMergeTree sources `clinical_patient`, `clinical_sample`, `genetic_alteration`, `genetic_profile_samples`, `sample_profile`, each followed by a sleep of `{optimize_backoff_secs}` seconds. | PDT:33-43, 85-86 |
| Backoff default | `CLICKHOUSE_OPTIMIZE_BACKOFF_SECS` defaults to `'0'`. | `cbioportal-core/scripts/importer/rebuild_derived_tables.py:42` |
| Live side-effect | The `sample_profile` fix-up writes into the base table, not a temp copy, and is permanent. | PDT:45-82 |
| Callers | After every `metaImport.py` import (unless `--no-derive-tables`); `metaImport.py derive-tables`; `migrate_db.py --populate-derived-tables`; `create_derived_tables_in_clickhouse_database.sh` (blue/green DBs). | `metaImport.py:150,242-259,268-285`; `migrate_db.py:227-233`; `create_derived_tables_in_clickhouse_database.sh:93-98` |
| Study visibility | Study is set UNAVAILABLE during import and made available only after a successful rebuild. | `cbioportalImporter.py:473,553-555`; `metaImport.py:249-256` |
| Cloning | `clone_clickhouse_database.sh` copies only the **schema** of `*_derived` tables (data must be repopulated). | `clone_clickhouse_database.sh:246-250` |
| Not optimized | `mutation_derived_temp` is not in the OPTIMIZE list (harmless, parts merge eventually). | PDT:535-545 |

### Dependencies outside the study

| Global input | Used by | Effect |
|---|---|---|
| `gene` (seeded, `info.gene_table_version = hgnc_v7_2025.10.7`) | every gene-keyed derived table; WES pseudo-panel | HUGO symbol in derived tables comes from the gene table at rebuild time, not from the study file. WES panel = all genes with entrez > 0. |
| `reference_genome_gene` (+ `cancer_study.reference_genome_id`) | `genomic_event_derived` CNA rows (`cna_cytoband`) | INNER JOIN filters CNA rows for genes missing from the study's genome (PDT:228). |
| `gene_panel`, `gene_panel_list` | panels are global objects (unique `stable_id`), shared across studies | |
| `cna_event`, `mutation_event` | shared across studies (cna_event unique on `(entrez_gene_id, alteration)`) | `ClickHouseConstraintChecker.java` unique keys |
| `genetic_entity`, `generic_entity_properties` | `generic_assay_meta_derived` | Built for all GENERIC_ASSAY entities, not per study. |
| `type_of_cancer` (cancer type hierarchy) | **not used** by any derived table | |

---

## sample_to_gene_panel_derived

SCHEMA:665-673 · PDT:88-101 · MergeTree ORDER BY (gene_panel_id, alteration_type, genetic_profile_id, sample_unique_id)

| Column | Source / expression |
|---|---|
| sample_unique_id | `concat(cancer_study_identifier, '_', sample.stable_id)` |
| alteration_type | `genetic_profile.genetic_alteration_type` (raw, e.g. `MUTATION_EXTENDED`, `COPY_NUMBER_ALTERATION`, `MRNA_EXPRESSION`, `GENERIC_ASSAY`…) |
| gene_panel_id | `if(gene_panel.stable_id = '', 'WES', gene_panel.stable_id)` via LEFT JOIN on `sample_profile.panel_id` |
| cancer_study_identifier | `cancer_study.cancer_study_identifier` (via the **profile's** study) |
| genetic_profile_id | `genetic_profile.stable_id` (string, not the numeric id) |

Rows: one per `sample_profile` row (after the fix-up below), for **all** profile types; no
`show_profile_in_analysis_tab` filter.

### Pre-step: sample_profile fix-up (PDT:45-86)
For each `sample_list` with `stable_id LIKE '%_sequenced'`, every member sample whose
`(sample_id, cancer_study_id)` has no `sample_profile` row for **any** MUTATION_EXTENDED profile of
that study gets `(sample_id, <profile with stable_id = study || '_mutations'>, NULL)` inserted.

### Gotchas
- **What:** NULL / unknown panel → `'WES'`. **Where:** PDT:94. **Effect:** profiles without a gene panel matrix (expression, CNA, etc.) all appear as WES. **New importer must:** emit `'WES'` whenever no panel is assigned. **Severity:** high.
- **What:** Fix-up adds mutation-profiled rows from `_sequenced` case list. **Where:** PDT:49-82. **Effect:** samples in the sequenced list but absent from the MAF are counted as profiled (WES) — denominators for mutation frequency include them. **New importer must:** union `<study>_sequenced` members into the `<study>_mutations` profile with panel WES, only when the sample has no MUTATION_EXTENDED profile row in the study. **Severity:** high.
- **What:** `LIKE '%_sequenced'` — `_` is a single-char wildcard; matches any list ending in `sequenced` with ≥1 preceding char (e.g. `x_unsequenced`), and is not restricted to `<study>_sequenced`. **Where:** PDT:61. **Effect:** odd case lists can mark samples as mutation-profiled; only takes effect if a `<study>_mutations` profile exists (PDT:81). **New importer must:** decide whether to mirror exactly (for parity) — note in parity tests. **Severity:** low.
- **What:** Fix-up check is study-scoped, not profile-scoped. **Where:** PDT:62-71. **Effect:** a sample already in a *different* MUTATION_EXTENDED profile of the study is not added to `<study>_mutations`. **New importer must:** replicate. **Severity:** low.
- **What:** Panel ID that refers to an absent `gene_panel` also becomes WES (LEFT JOIN miss → `''`). **Where:** PDT:99. **Severity:** low (FK checker in `ClickHouseConstraintChecker.java` guards `sample_profile.panel_id`).

## gene_panel_to_gene_derived

SCHEMA:270-275 · PDT:103-116 · MergeTree ORDER BY gene_panel_id

| Column | Source / expression |
|---|---|
| gene_panel_id | `gene_panel.stable_id`; plus literal `'WES'` |
| gene | `gene.hugo_gene_symbol` (from global gene table, joined on `gene_panel_list.gene_id = gene.entrez_gene_id`) |

Rows: all panels × their genes (INNER JOIN gene — panel entries whose entrez is not in `gene`
are dropped) **UNION ALL** `('WES', every gene with entrez_gene_id > 0)`.

### Gotchas
- **What:** WES pseudo-panel = entire global gene table (entrez > 0). **Where:** PDT:111-116. **Effect:** `off_panel` is false for any WES-profiled event in a known gene; gene-level "profiled" counts for WES samples include all genes. **New importer must:** generate the same synthetic WES panel from the same gene table version. **Severity:** high.
- **What:** Panels are global, not per study. **Where:** PDT:108-110 (no study join). **Severity:** low.
- **What:** A real panel named `WES` would be merged with the synthetic one. **Where:** PDT:111. **Severity:** low.

## sample_derived

SCHEMA:625-643 · PDT:118-155 · MergeTree ORDER BY (cancer_study_identifier, sample_unique_id)

| Column | Source / expression |
|---|---|
| sample_unique_id | `concat(study_id, '_', sample.stable_id)` |
| sample_unique_id_base64 | `base64Encode(sample.stable_id)` — **stable_id only, no study prefix** |
| sample_stable_id | `sample.stable_id` |
| patient_unique_id | `concat(study_id, '_', patient.stable_id)` |
| patient_unique_id_base64 | `base64Encode(patient.stable_id)` — no study prefix |
| patient_stable_id | `patient.stable_id` |
| cancer_study_identifier | via `patient.cancer_study_id` |
| internal_id | `sample.internal_id` (Int64 → `Int` / Int32) |
| patient_internal_id | `sample.patient_id` (Int64 → Int32) |
| sample_type | `sample.sample_type` (raw string from importer) |
| sequenced | `1` if `sample.stable_id IN (stable_ids of members of any study's <study>_sequenced list)`, else `0` |
| copy_number_segment_present | `1` if `sample_unique_id` has ≥1 `copy_number_seg` row, else `0` |

Not present: mutation counts, CNA flags, panel info — those are not in sample_derived.

### Gotchas
- **What:** `sequenced` matched on bare stable_id across studies. **Where:** PDT:121-130, 151. **Effect:** cross-study leakage when barcodes repeat between studies (common for TCGA PanCancer vs. provisional studies). **New importer must:** for parity, compute from the global set of sequenced stable_ids (or deliberately fix and accept a diff). **Severity:** med.
- **What:** `sequenced` uses exact `<study>_sequenced` (unlike the fix-up's `LIKE`). **Where:** PDT:129. **Severity:** low.
- **What:** base64 columns encode the bare stable_id despite their names. **Where:** PDT:140,143. **Severity:** low.
- **What:** internal ids narrowed to Int32. **Where:** SCHEMA:634,636. **Severity:** low.

## genomic_event_derived

SCHEMA:389-411 · PDT:157-300 · MergeTree ORDER BY (genetic_profile_stable_id, cancer_study_identifier, variant_type, entrez_gene_id, hugo_gene_symbol, sample_unique_id). Four INSERTs (UNION semantics, no dedup).

| Column | mutation (PDT:159-193) | cna (PDT:195-229) | structural_variant (PDT:231-300, ×2) |
|---|---|---|---|
| sample_unique_id | `study_sample` | same | same |
| hugo_gene_symbol | `gene.hugo_gene_symbol` (LEFT JOIN gene → `''` if missing) | gene (INNER) | site1 / site2 gene (INNER) |
| entrez_gene_id | `gene.entrez_gene_id` (→ 0 if missing; Int64→Int32) | gene | site gene |
| gene_panel_stable_id | `if(panel='', 'WES', panel)` from `sample_profile` | same | same |
| cancer_study_identifier | via profile's study | same | same |
| genetic_profile_stable_id | `genetic_profile.stable_id` | same | same |
| variant_type | `'mutation'` | `'cna'` | `'structural_variant'` |
| mutation_variant | `mutation_event.protein_change` (NULL→`''`) | `'NA'` | `'NA'` |
| mutation_type | `mutation_event.mutation_type` (NULL→`''`) | `'NA'` | `'NA'` |
| mutation_status | `mutation.mutation_status` (NULL→`''`) | `'NA'` | `structural_variant.sv_status` |
| driver_filter, driver_filter_annotation, driver_tiers_filter, driver_tiers_filter_annotation | `alteration_driver_annotation` LEFT JOIN on (profile, sample, mutation_event_id); NULL→`''` | same on cna_event_id | same on `sv.internal_id` |
| cna_alteration | NULL | `cna_event.alteration` (Int32→Nullable(Int8); only ±2 exist) | NULL |
| cna_cytoband | `''` | `reference_genome_gene.cytoband` for study's genome (NULL→`''`) | `''` |
| sv_event_info | `''` | `''` | `structural_variant.event_info` (NULL→`''`) |
| patient_unique_id | `study_patient` | same | same |
| off_panel | `(gene_panel_stable_id, hugo_gene_symbol) NOT IN gene_panel_to_gene_derived_temp` | same | same |

Joins that filter:
- mutation: INNER `mutation_event`, INNER `sample_profile` on (sample, profile), INNER study/sample/patient; `genetic_profile` is LEFT but followed by INNER on its study → effectively INNER.
- cna: INNER `sample_cna_event`, `sample_profile`, `gene`, **`reference_genome_gene`**.
- SV: INNER `gene` per site, INNER `sample_profile`.

### Gotchas
- **What:** CNA = ±2 only (importer), only discrete profiles with `show_profile_in_analysis_tab`, `-1.5` → `-2`. **Where:** [importer] `CnaUtil.java:49-52`, `ImportTabDelimData.java:161-163,668-671`. **Effect:** gains/hetlosses never appear as genomic events; they exist only in `genetic_alteration_derived`. **New importer must:** emit cna events only for 2/-2 (after -1.5→-2) from discrete profiles shown in analysis tab. **Severity:** high.
- **What:** CNA rows require a `reference_genome_gene` row for the study's genome. **Where:** PDT:228. **Effect:** silent loss of CNA events for genes absent from the hg19/hg38 gene map. **New importer must:** apply the same INNER filter (or record the diff). **Severity:** high.
- **What:** `sample_profile` INNER JOIN required for every event type. **Where:** PDT:185-186, 221, 261, 295. **Effect:** events for samples not in the profile's sample list (or not in the fix-up) are dropped. **New importer must:** filter events to `(sample, profile)` pairs that are profiled. **Severity:** med.
- **What:** SV split into one row per distinct gene. **Where:** PDT:231-300 (site2 filter PDT:298-300). **Effect:** event counts double for fusions; `site1 = site2` → one row; site1 NULL + site2 gene → one row (site2); site2 NULL → site1 row only; both NULL → dropped. **New importer must:** reproduce exactly. **Severity:** high.
- **What:** off_panel matched by HUGO symbol against a panel table built from the global gene table. **Where:** PDT:179-182, 215-218, 251-254, 285-288. **Effect:** gene symbol changes in the gene table change off_panel; mutations whose gene is missing get `hugo=''` → always off_panel. **New importer must:** compute after symbol resolution against the same gene table. **Severity:** high.
- **What:** No mutation_status / germline / uncalled-profile filter in PDT. **Where:** PDT:159-193 (no WHERE). **Effect:** germline mutations and any MUTATION_UNCALLED profile rows present in `mutation` are included (identified only via `genetic_profile_stable_id`/`mutation_status`). The importer-level filter (top-10 #9) is the only filtering. **New importer must:** apply `MutationFilter` rules at load time and nothing more here. **Severity:** high.
- **What:** Missing driver annotation → `''` (not NULL); `mutation_status` NULL → `''`. **Where:** PDT:170-174; SCHEMA:400-404 (non-Nullable). **Effect:** filters like `driver_filter = ''` vs `IS NULL` behave differently from mutation_derived. **New importer must:** write `''`. **Severity:** med. (Relies on `insert_null_as_default=1`.)
- **What:** `alteration_driver_annotation.alteration_event_id` holds three id spaces (mutation_event_id, cna_event_id, structural_variant.internal_id), disambiguated only by profile. **Where:** PDT:193, 229, 263. **Severity:** low (for the new schema design).
- **What:** No dedup. Same mutation in two profiles → two rows. **Severity:** low.

## clinical_data_derived

SCHEMA:148-159 · PDT:302-337 · MergeTree ORDER BY (cancer_study_identifier, type, attribute_name, sample_unique_id)

| Column | sample rows (PDT:305-320) | patient rows (PDT:323-337) |
|---|---|---|
| internal_id | `sample.internal_id` (via sample_derived_temp) | `patient.internal_id` — **different id space, same column** |
| sample_unique_id | `study_sample` | `''` |
| patient_unique_id | `study_patient` | `study_patient` |
| attribute_name | `clinical_attribute_meta.attr_id` | same |
| attribute_value | `ifNull(clinical_sample.attr_value, '')` | `ifNull(clinical_patient.attr_value, '')` |
| cancer_study_identifier | study | study |
| type | `'sample'` | `'patient'` |

Rows: for each study, **every sample × every `clinical_attribute_meta` row with
`patient_attribute = 0`**, and **every patient × every row with `patient_attribute = 1`**.

### Gotchas
- **What:** Dense matrix with `''` for missing. **Where:** PDT:316-320, 333-337 (LEFT JOIN + ifNull). **Effect:** row counts = samples × attrs; "missing" and "empty string" are indistinguishable; count-based queries must exclude `''`. **New importer must:** emit a row for every (entity, attribute) pair with `''` when absent. **Severity:** high.
- **What:** No value normalization. **Where:** PDT:310, 328. **Effect:** `NA`, `N/A`, whitespace, numbers as typed — numeric vs categorical decided at query time from `clinical_attribute_meta.datatype`. Whatever the Java clinical importer did to values (not audited here) is preserved. **New importer must:** store strings exactly as legacy stored them; verify the clinical importer's own NA handling separately. **Severity:** med (uncertain upstream).
- **What:** Attributes computed by the importer appear here: `MUTATION_COUNT`, `FRACTION_GENOME_ALTERED` (see top-10 #8). **Where:** [importer] `DaoMutation.java:143-193`; `DaoCopyNumberSegment.java:53-76`; `FractionGenomeAlteredCalculator.java:15-44`. **Effect:** the new importer has to reproduce these numbers exactly, including formatting (`"0.0002"`, not `2.0E-4`). **Severity:** high.
- **What:** `MUTATION_COUNT` quirks: DISTINCT by `(chr,start,end,ref,alt)` (same locus across genes counted once); excludes `UPPER(mutation_status) = 'GERMLINE'` only; `mutation` joined on `sample_id` only, not profile (other mutation profiles of the sample count); samples in the profile with no mutations get `0`; computed **at mutation import time**, before the PDT fix-up, so samples added by the fix-up get no value (`''`). Behaviour of `count(DISTINCT ...)` when some coordinate columns are NULL is **uncertain** (ClickHouse likely skips such rows). **Where:** `DaoMutation.java:168-178`. **Severity:** high.
- **What:** `FRACTION_GENOME_ALTERED`: altered if `|segment_mean| >= 0.2`, length `end - start`, 4 dp HALF_UP, samples with total length ≤ 0 omitted. **Where:** `FractionGenomeAlteredCalculator.java:15-44`. **Severity:** high.
- **What:** ReplacingMergeTree source; last insert per `(internal_id, attr_id)` wins, but only after OPTIMIZE FINAL. Backoff defaults to 0 s. **Where:** SCHEMA:203-213; PDT:34-37; `rebuild_derived_tables.py:42`. **Effect:** on replicated/cloud ClickHouse, unmerged duplicates could produce duplicate derived rows. **New importer must:** dedupe in the importer (last value wins). **Severity:** med.
- **What:** `internal_id` column mixes sample and patient ids. **Where:** PDT:306, 324. **Severity:** low.

## clinical_attribute_meta (base table, not derived)

SCHEMA:138-146. Not rebuilt by PDT; written by the importer. It drives which rows exist in
`clinical_data_derived`. Importer-added rows: `MUTATION_COUNT` ("Mutation Count", NUMBER, sample,
priority "30") and `FRACTION_GENOME_ALTERED` ("Fraction Genome Altered", NUMBER, sample,
priority "20") ([importer] `DaoMutation.java:155-160`, `DaoCopyNumberSegment.java:61-66`).
`priority` is a String column.

## clinical_event_derived

SCHEMA:188-201 · PDT:339-354

| Column | Source |
|---|---|
| clinical_event_id | `clinical_event.clinical_event_id` |
| patient_id | `clinical_event.patient_id` (internal id) |
| patient_stable_id | `patient.stable_id` (no study prefix) |
| start_date, stop_date | copied (stop_date stays NULL) |
| event_type | copied (LowCardinality) |
| cancer_study_identifier | via patient |

Straight copy, INNER JOIN patient/study. No gotchas beyond `patient_stable_id` being unprefixed.

## clinical_event_data_derived

SCHEMA:175-186 · PDT:356-370

| Column | Source / expression |
|---|---|
| patient_unique_id | `concat(study, '_', patient.stable_id)` |
| key, value | `clinical_event_data.key/value` (`''` when the event has no data rows) |
| start_date | `clinical_event.start_date` (Int64 → Int32) |
| stop_date | `ifNull(clinical_event.stop_date, 0)` (Int32) |
| event_type | `clinical_event.event_type` |
| cancer_study_identifier | via patient |

### Gotchas
- **What:** RIGHT JOIN → every event appears; events without attributes get one row with `key=''`, `value=''`. **Where:** PDT:366-367. **New importer must:** emit that placeholder row. **Severity:** med.
- **What:** `stop_date` NULL → `0`, indistinguishable from a real day 0. **Where:** PDT:363. **Severity:** med.
- **What:** Dates narrowed to Int32. **Where:** SCHEMA:180-181. **Severity:** low.

## genetic_alteration_derived

SCHEMA:346-355 · PDT:372-401 · MergeTree ORDER BY (cancer_study_identifier, hugo_gene_symbol, profile_type, sample_unique_id)

| Column | Source / expression |
|---|---|
| sample_unique_id | from `sample_derived_temp` joined on `internal_id` |
| cancer_study_identifier | from `sample_derived_temp` |
| hugo_gene_symbol | `gene.hugo_gene_symbol` via `genetic_alteration.genetic_entity_id = gene.genetic_entity_id` |
| profile_type | `replaceOne(genetic_profile.stable_id, study || '_', '')` (e.g. `gistic`, `rna_seq_v2_mrna`, `log2CNA`) |
| alteration_value | element of `splitByString(',', substring(values, 1, -1))` zipped with `genetic_profile_samples.ordered_sample_list`; `''` → NULL |

Filters: `genetic_alteration_type NOT IN ('GENERIC_ASSAY','MUTATION_EXTENDED','MUTATION_UNCALLED','STRUCTURAL_VARIANT')`;
`alteration_value != 'NA'` (also drops NULL, i.e. empty strings); INNER JOIN `gene` (drops geneset
scores and any non-gene entity).

### Gotchas
- **What:** `'NA'` and empty values are dropped. **Where:** PDT:390, 400. **Effect:** sparse; "missing" means NA or blank. Other non-numeric strings (`NaN`, `-`, `null`) are kept. **New importer must:** drop exactly `'NA'` and `''` (case-sensitive), keep everything else. **Severity:** high.
- **What:** Values not parsed; stored as the importer's string. Discrete CNA keeps `-1.5`, `0`, `-1`, `1`. **Where:** SCHEMA:352; [importer] `ImportTabDelimData.java:604-611` stores before CNA recoding. **Severity:** med.
- **What:** Positional zip relies on trailing comma in both `values` and `ordered_sample_list`. **Where:** PDT:390-391; [importer] `DaoGeneticAlteration.java:85`, `DaoGeneticProfileSamples.java:39`. **Effect:** none if the new importer writes long-format directly — just ensure sample order mapping is identical. **Severity:** low.
- **What:** Includes all CNA (discrete + continuous), mRNA, protein, methylation etc., regardless of `show_profile_in_analysis_tab`. **Where:** PDT:398. **Severity:** med.
- **What:** Importer duplicates rows: miRNA lines stored for every matched miRNA gene; RPPA lines with several genes stored per gene. **Where:** [importer] `ImportTabDelimData.java:582-590, 612-615`. **Effect:** one input row → several hugo symbols. **New importer must:** replicate gene resolution (including alias lookup). **Severity:** med.
- **What:** Keyed by HUGO only — no entrez column. **Where:** SCHEMA:350. **Severity:** low.
- **What:** `replaceOne` removes the first `<study>_` occurrence anywhere in the stable_id. **Where:** PDT:378. **Severity:** low.

## generic_assay_data_derived

SCHEMA:277-291 · PDT:403-452 · MergeTree ORDER BY (profile_type, entity_stable_id, patient_unique_id, sample_unique_id)

| Column | Source / expression |
|---|---|
| sample_unique_id, patient_unique_id | from `sample_derived_temp` |
| genetic_entity_id | `genetic_alteration.genetic_entity_id` cast to **String** |
| value | split/zipped like above; `''` → NULL → stored `''` |
| generic_assay_type | `genetic_profile.generic_assay_type` |
| profile_stable_id | `genetic_profile.stable_id` |
| entity_stable_id | `genetic_entity.stable_id` |
| datatype | `genetic_profile.datatype` |
| patient_level | `genetic_profile.patient_level` (Nullable(Int32) → NUMERIC; NULL → 0) |
| profile_type | `replaceOne(profile_stable_id, study || '_', '')` |

Filter: `generic_assay_type IS NOT NULL` (not `genetic_alteration_type = 'GENERIC_ASSAY'`).

### Gotchas
- **What:** `'NA'` is **kept**, blanks become `''` (unlike genetic_alteration_derived). **Where:** PDT:439, 450 (no WHERE). **New importer must:** emit a row per (entity, sample) including NA and blank. **Severity:** high.
- **What:** Patient-level generic assay: rows are per sample in `ordered_sample_list`; how the importer fills patient-level values into samples was **not verified**. **Severity:** med (uncertain).
- **What:** `patient_level` NULL → 0. **Where:** SCHEMA:287; PDT:438. **Severity:** low.

## generic_assay_profile_entity_derived

SCHEMA:301-306 · PDT:510-518. `SELECT DISTINCT profile.stable_id, entity.stable_id` from
`genetic_alteration` where `genetic_alteration_type = 'GENERIC_ASSAY'`. An entity is listed for a
profile if it has a `genetic_alteration` row, even if all values are NA. (Note: this filter uses
`genetic_alteration_type`, while generic_assay_data_derived uses `generic_assay_type IS NOT NULL`.)

## generic_assay_meta_derived

SCHEMA:293-299 · PDT:520-532

| Column | Source |
|---|---|
| entity_stable_id | `genetic_entity.stable_id` |
| entity_type | `genetic_entity.entity_type` (always `GENERIC_ASSAY`) |
| properties | `Map(name → value)` from `generic_entity_properties`, skipping rows where `value = ''` and the LEFT JOIN miss row |

Global (not per study). Entities with no properties get an empty map. Duplicate property names
per entity are prevented by the unique key `(genetic_entity_id, name)`
(`ClickHouseConstraintChecker.java:426`). Severity of differences: low, but properties are
shared across studies, so a later import with `update_generic_assay_entity` changes them for all.

## mutation_derived

SCHEMA:487-535 · PDT:454-508 · MergeTree ORDER BY (molecularProfileId, sampleId, entrezGeneId)

| Column | Source |
|---|---|
| molecularProfileId | `genetic_profile.stable_id` |
| sampleId / sampleInternalId / patientId | `sample.stable_id` / `sample.internal_id` / `patient.stable_id` (unprefixed) |
| entrezGeneId | `mutation.entrez_gene_id` |
| studyId | via **patient**'s study |
| center, mutationStatus, validationStatus, tumor/normal alt/ref counts, aminoAcidChange, annotationJSON | `mutation.*` copied (NULLs preserved) |
| chr … keyword | `mutation_event.*` copied |
| driverFilter … driverTiersFilterAnnotation | `alteration_driver_annotation` LEFT JOIN — **NULL** when absent |
| GENE.entrezGeneId / hugoGeneSymbol / type | `gene` (INNER JOIN) |
| alleleSpecificCopyNumber.* | LEFT JOIN `allele_specific_copy_number` on (event, profile, sample); `ascnMethod = nullIf(ascn_method, '')` |

### Gotchas
- **What:** No `sample_profile` join (unlike genomic_event_derived). **Where:** PDT:500-508. **Effect:** a mutation for an unprofiled sample is in mutation_derived but not genomic_event_derived. **Severity:** med.
- **What:** Driver columns NULL here vs `''` in genomic_event_derived. **Where:** PDT:485-488 vs 171-174. **Severity:** med.
- **What:** `ascnMethod` `''` → NULL; ASCN columns NULL when no ASCN row (LEFT JOIN on Nullable columns). Non-Nullable `ascn_method` would be `''` on a miss, then nullIf → NULL. **Where:** PDT:493. **Severity:** low.
- **What:** No filtering of germline / uncalled; all `mutation` rows. **Severity:** med (see top-10 #9).

---

## Importer-level (upstream) filters that shape base tables [importer]

| Rule | Where |
|---|---|
| Mutation rejected if `Mutation_Status` starts with (case-insensitive) `None`, `LOH`, `Wildtype` | `MutationFilter.java:77-88, 246-251` |
| Rejected if `Validation_Status` starts with `Redacted` | `MutationFilter.java:90-94` |
| If meta file lists filtered types → reject those types; 5'Flank kept as `Promoter` | `MutationFilter.java:96-106` |
| Else reject types starting with `Silent`, `Intron`, `3'UTR`, `3'Flank`, `5'UTR`, `IGR`; 5'Flank only for TERT (7015) → protein_change `Promoter` | `MutationFilter.java:107-125`, whitelist `:42-43` |
| Duplicate mutation_event check aborts import | `ImportExtendedMutationData.java:470-474` |
| Discrete CNA events: only `2` and `-2`; `-1.5` → `-2`; only if profile is COPY_NUMBER_ALTERATION and shown in analysis tab | `CnaUtil.java:49-52`; `ImportTabDelimData.java:45-47,161-163,664-692` |
| Gene lines with `///` or `---` skipped; unknown genes skipped | `ImportTabDelimData.java:534-566` |

(Clinical, SV, case list, gene panel matrix and generic-assay importers were not audited here.)
