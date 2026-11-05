# Legacy Python import layer: hidden calculations and gotchas

Scope: `ref/cbioportal-core/scripts/importer/` (validateData.py, cbioportal_common.py, metaImport.py,
cbioportalImporter.py, OncoKB scripts, rebuild_derived_tables.py) and the `.pl` wrappers in
`ref/cbioportal-core/scripts/`. All paths below are relative to `ref/cbioportal-core/scripts/importer/`
unless prefixed. Every claim was checked against the code. A few Java call sites were opened only to
confirm what the Python hands off to. Those are marked **[Java]**. Items marked **UNCERTAIN** are inferred,
not confirmed.

Key framing: **the Python layer does almost no data transformation itself.** It (a) orders and dispatches
Java loader classes, (b) validates, and (c) when `-oncokb` is passed, **rewrites the study files on disk**
before loading. Most "validator says X will not be loaded" messages describe Java loader behavior. The
validator is the best written list of those Java rules, so this note collects them, but each needs
confirming in the Java pass.

---

## Top 10 (ranked)

1. **Mutation rows dropped by the loader even though they are in the file** (Silent/Intron/3'UTR/3'Flank/5'UTR/5'Flank/IGR/RNA by default, or whatever `variant_classification_filter` lists *instead*; `Hugo_Symbol=Unknown` + `Entrez_Gene_Id=0`; `Mutation_Status` in LOH/None/Wildtype). The validator does not check these rows at all. (high, §2.1)
2. **Gene identity is computed, not read.** Symbols are upper-cased, aliases resolved, Entrez wins over a conflicting symbol, unknown or non-integer genes are dropped with only a warning, and a later row for an already-seen gene in a matrix file is ignored. (high, §2.2)
3. **OncoKB (`-oncokb`) rewrites the study before load.** It appends `cbp_driver`/`cbp_driver_annotation`/`cbp_driver_tiers`/`cbp_driver_tiers_annotation` to the MAF, writes `data_cna_pd_annotations.txt`, and edits `meta_CNA`. `cbp_driver_tiers` gets the raw OncoKB `oncogenic` string. Discrete CNA `-1.5` is annotated as DELETION because Python's `round(-1.5)` is -2. Without the flag, the only driver data is what is already in the files. (high, §4)
4. **Only `<study>_all` is auto-generated** (when `add_global_case_list: true`). Its name and description are both "All cases in study", its category is `other`, it holds every sample, and a file-defined `_all` takes precedence. `_sequenced`, `_cna`, `_cnaseq` and the rest are **never** generated, only required or recommended by the validator. (high, §1.2)
5. **The load is a destructive replace plus a global post-step.** The pipeline removes the study, re-imports it, leaves it UNAVAILABLE, rebuilds the derived tables with `populate_derived_tables.sql` over the **whole DB**, then marks the study AVAILABLE. `MUTATION_COUNT` and `FRACTION_GENOME_ALTERED` are banned from input because the legacy pipeline computes them. (high, §1.3)
6. **Meta files are parsed twice, by two different parsers.** Python splits on the first `:` and strips the value but not the key. Java uses `java.util.Properties.load(InputStream)`, which means ISO-8859-1 decoding, `#`/`!` comments, `=` separators, backslash escapes and line continuation, with values trimmed. Java also applies defaults: `show_profile_in_analysis_tab` is true unless it equals `false` (any case), and P-VALUE profiles are forced to false. (high, §3)
7. **Load order is fixed, but within a group it follows `os.listdir`.** Single-slot types (SV, CNA_long, gene panel matrix, GSVA score/pvalue) silently keep only the **last** meta file found. The importer, unlike the validator, does not skip `ONCOKB_IMPORT_BACKUP_meta_*`, so after an OncoKB CNA run it picks up the backup meta file too. (med, §1.1, §2.6)
8. **NA tokens differ by file type and are case-sensitive except in clinical files.** Clinical uses `[not applicable]`…`[null]`, empty and `na`, compared case-insensitively. Matrices accept only literal `NA`. In SV files, `0`, `Unknown` and `NA` all mean missing. In MAF files, `NA`/empty/`Unknown` mean no Hugo symbol and `NA`/empty/`0` mean no Entrez ID. Generic assay accepts `NA` or empty. (high, §5.1)
9. **Sample IDs: Python normalizes nothing except stripping clinical cells.** Matching is case-sensitive. **[Java]** truncates TCGA barcodes to `TCGA-XX-XXXX-NN`. A duplicate TCGA sample in clinical data is a *warning* and the later line is ignored. Duplicate IDs in a case list are a warning and get de-duplicated. (high, §5.2)
10. **"Validated" does not mean "loaded as validated".** Exit code 3 (warnings only) loads only with `-o`. `-n` turns off every gene, panel and cancer-type check. Several checks are dead or crash: the `_sequenced` ⊇ MAF-samples check never fires, a missing `generic_entity_meta_properties` raises KeyError, `NA` in GSVA raises ValueError, timeline `PATIENT_ID` is never checked, and incremental mode skips every sample-existence check. (med, §2.7)

---

## 1. Orchestration (cbioportalImporter.py, metaImport.py)

### 1.1 metaImport.py end to end
- **What:** The steps run in this order:
  1. `validateData.main_validate` (metaImport.py:159).
  2. If valid and `-oncokb` was passed, the OncoKB mutation step, then the OncoKB CNA step, then a **re-validation** (metaImport.py:176-227).
  3. If the exit code is 0, or 3 with `-o`, and `--skip_db_import` is not set, `cbioportalImporter.main` (metaImport.py:233-267).
  4. Unless `--no-derive-tables`, `rebuild_derived_tables` (metaImport.py:243-257, 269-283).
  5. `make_study_available` → Java `UpdateCancerStudy <id> AVAILABLE` (cbioportalImporter.py:560-562).
  - `metaImport.py derive-tables` runs only the rebuild (metaImport.py:142-150).
- **Where:** metaImport.py:141-295.
- **Effect:** If validation ends with only warnings and `-o` is absent, nothing is loaded. If the derived-table rebuild fails, the study stays UNAVAILABLE and the exit code is 1.
- **New importer must:** Decide whether its own validation gates the load the same way. Model availability as a post-derive step.
- Severity: med

### 1.2 process_study_directory load order and auto case list
- **What:** Meta files are any directory entry matching `(\b|_)meta(\b|[_0-9])`, case-insensitive, except dot-files and files ending in `~`. The order is **unsorted `os.listdir`** (cbioportalImporter.py:276-283). Load order:
  1. Cancer types. Java `ImportTypesOfCancers ... false`, i.e. "don't clobber existing" (cbioportalImporter.py:72, 401-402).
  2. **`RemoveCancerStudy`**, then `ImportCancerStudy` (409-410).
  3. Sample clinical data. Exactly one file is required; a second raises RuntimeError (358-364, 413-417).
  4. Resource definition (420-422), then sample resources (425-427).
  5. All "regular" types in listdir order: patient clinical, mutations, discrete CNA, continuous/log2 CNA, non-z-score expression, methylation, protein, generic assay, timeline, seg, gistic, mutsig, patient/study resources (432-433).
  6. Structural variants (436-438), then CNA_long (441-444).
  7. Expression with `datatype: Z-SCORE` (447-448). Protein Z-SCORE is *not* in this group; it loads in step 5.
  8. GSVA scores, then GSVA p-values (451-459).
  9. Gene panel matrix (461-463).
  10. Every file in `case_lists/` except dot-files and files ending in `~`, through `ImportSampleList`, in listdir order (244-248, 466-468).
  11. If the meta_study has `add_global_case_list` equal to `true` (case-insensitive), `AddCaseList <study> all` (470-471, 221-227).
- **[Java]** `AddCaseList.addAllCasesList` (src/main/java/.../scripts/AddCaseList.java:32-51) creates stable_id `<study>_all` with name and description "All cases in study", category `other`, and every sample stable ID in DB order. If `_all` already exists it is kept.
- **Effect:** A study without `add_global_case_list` and without a `case_lists/*_all` file gets **no** `_all` list. The validator reports that as an error, but a run with `-o`/`-n` style relaxations does not stop on it. If `case_lists/cases_all.txt` exists, the generated list never appears.
- **New importer must:** Generate `_all` only under the same condition, with the same name, description and category, and let file-defined lists win. Do **not** synthesize `_sequenced`/`_cna`/`_cnaseq`; the legacy pipeline never does. Note that cancer types already in the DB are not updated from the study's cancer_type file (clobber=false; exact Java semantics **UNCERTAIN**).
- Severity: high

### 1.3 Replace semantics, availability and derived tables
- **What:** A full study import always removes the existing study first (cbioportalImporter.py:409). The study stays UNAVAILABLE until `rebuild_derived_tables` has run `clickhouse client --multiquery --queries-file $PORTAL_HOME/db-scripts/clickhouse/populate_derived_tables.sql` against the whole database (rebuild_derived_tables.py:15-22, 50-75). It needs the env vars CLICKHOUSE_HOST, CLICKHOUSE_NATIVE_PORT, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD and CLICKHOUSE_DB, and accepts `CLICKHOUSE_OPTIMIZE_BACKOFF_SECS` (default 0). Incremental mode (`-d`) does not delete the study; it sets it UNAVAILABLE first (cbioportalImporter.py:553-555).
- **Where:** cbioportalImporter.py:404-410, 553-557; rebuild_derived_tables.py; metaImport.py:243-286.
- **Effect:** Rows for the study in derived tables, such as the clinical/genomic event tables the API reads, exist only after the rebuild. The SQL that builds them is at `ref/cbioportal/src/main/resources/db-scripts/clickhouse/populate_derived_tables.sql` (out of scope here, but it holds **hidden calculations** that need their own audit).
- **New importer must:** Reproduce what populate_derived_tables.sql derives, per study, and treat the import as replace, not merge, unless incremental.
- Severity: high

### 1.4 What does NOT run automatically
- **What:** Z-scores are **not** computed by the pipeline. `convertExpressionZscores.pl` wraps Java `NormalizeExpressionLevels` as a manual tool, and Z-SCORE profiles are loaded from files (step 7 above). `updateOncokbAnnotations.py` is a separate manual post-load tool, not called by metaImport. MUTATION_COUNT and FRACTION_GENOME_ALTERED are **rejected** in clinical input (validateData.py:2538, 2717-2724) because the legacy system computes them. **[Java]** The computation lives in `util/FractionGenomeAlteredCalculator.java`, `dao/DaoMutation.java`, `dao/DaoCopyNumberSegment.java` and `dao/DaoClinicalData.java`.
- **Where:** scripts/convertExpressionZscores.pl; validateData.py:2538.
- **Effect:** A study with a `data_mrna_seq_v2_rsem.txt` and no z-score file has no z-score profile. Mutation count and FGA appear as clinical attributes although they are not in any input file.
- **New importer must:** Not compute z-scores. **Must** compute MUTATION_COUNT and FGA the way the Java/derived SQL does (follow-up audit).
- Severity: high (MUTATION_COUNT/FGA), low (z-scores)

### 1.5 Orchestration bugs that change outcomes
- **What:**
  - `JavaRunException` is referenced in `except` clauses but never imported (cbioportalImporter.py:29-46 vs 120, 516). A Java failure in remove-samples or incremental import therefore surfaces as a NameError; the import still aborts.
  - `import_data` silently **skips** a file when the CLI data path does not `endswith` the meta file's `data_filename` (cbioportalImporter.py:174-177).
  - metaImport with `-oncokb` crashes when the study has no MUTATION_EXTENDED meta file, because `find_meta_file_by_fields` returns None and then `open(None)` is called (metaImport.py:178-180, libImportOncokb.py:149-155).
- **Effect:** Error paths only; no silent data change apart from the single-file skip.
- **New importer must:** Nothing to replicate. Just don't treat these as specified behavior.
- Severity: low

---

## 2. Validator vs loader: accepted-but-transformed or dropped

Exit codes: 0 means clean, 3 means warnings only, 1 means errors, 2 means critical (validateData.py:136-145).
**Every WARNING below is a case the legacy pipeline loads (with `-o`) while changing or dropping data.**

### 2.1 Mutations (MAF)
- **What:** Several kinds of MAF row are not loaded, and some are not even validated:
  - **Variant filter:** The default skip list is Silent, Intron, 3'UTR, 3'Flank, 5'UTR, 5'Flank, IGR, RNA (validateData.py:1613-1622). If the meta has `variant_classification_filter`, that comma list **replaces** the default (2258-2261). **[Java]** reads the same field, split on commas and trimmed (GeneticProfileReader.java:324-337).
  - **Filtered lines are not validated at all:** `checkLine` returns right after `skipValidation`, so their sample IDs and genes are never checked (1738-1740).
  - **Intergenic rows:** `Hugo_Symbol == 'Unknown'` with `Entrez_Gene_Id == '0'` is filtered. If there is no Entrez column, the Entrez value defaults to `'0'`, so `Unknown` alone is enough. A non-IGR/Targeted_Region classification only adds a warning (2263-2285).
  - **Mutation_Status:** `loh`, `none` and `wildtype` (case-insensitive) produce "will not be loaded" (2407-2409).
  - **No amino-acid change:** With no `HGVSp_Short`/`Amino_Acid_Change` (values `''`, `NULL`, `NA`) and a classification other than Splice_Site, the row is stored with a generic **"MUTATED"** protein change (1814-1828).
  - **Gene fields:** `Hugo_Symbol` values `NA`, `''`, `Unknown` and `Entrez_Gene_Id` values `NA`, `''`, `0` count as missing (1797-1803).
  - **Positions:** Start/End values `''` or `NA` are allowed with a warning, and quotes are stripped before float parsing (1863-1868, 2365-2403).
- **Where:** validateData.py:1600-2416.
- **Effect:** A `Silent` row for `TP53` in sample S1 produces no mutation row. With `variant_classification_filter: Missense_Mutation`, Silent rows **are** loaded and missense rows are not. A row with empty HGVSp_Short gets protein_change `MUTATED` (exact string **[Java]**, per the validator message).
- **New importer must:** Implement the same filter set and its replace-not-merge override, the Unknown/0 rule, the Mutation_Status exclusions and the MUTATED fallback. Confirm the exact Java strings and conditions in `ImportExtendedMutationData`/`MutationFilter`.
- Severity: high

### 2.2 Gene resolution (all gene-keyed files)
- **What:** `checkGeneIdentification` (validateData.py:747-919) works as follows:
  - Upper-cases the symbol before lookup (773-774).
  - An Entrez ID that is not an integer is a **warning** with "record will not be loaded"; a non-positive one is an error (794-811).
  - If the Entrez ID is known, it wins and a mismatching or unknown symbol is "ignored" with a warning (828-852).
  - If the Entrez ID is unknown, it is a **warning** and the record is not loaded (853-859).
  - With a symbol only: an exact Hugo match is used first, with a warning when it is also another gene's alias (868-887). Next comes a unique alias (897-900). An alias that maps to several genes is a **warning**, with the comment "Loader deals with this" (902-910). An unknown symbol is a **warning** and the record is not loaded (912-917).
  - Symbols starting with a digit get an Excel-conversion warning (775-792).
  - CNA files: in `A|B` only `A` is used (1212-1216).
  - Protein (RPPA) `Composite.Element.REF` is `SYM1 SYM2|antibody`. The space-separated symbols each map to a gene, and an `NA` symbol is ignored (3437-3459).
  - GISTIC `genes_in_region` is comma-split, a trailing comma is dropped, and `|suffix` is stripped (4343-4369).
- **Where:** as above.
- **Effect:** A row `tp53 / (no entrez)` becomes Entrez 7157. A row `FOO / 7157` becomes 7157 and the FOO symbol is discarded. A row `NOTAGENE` is not stored. A row `MAGEA4|ENSG..` in CNA resolves to MAGEA4.
- **New importer must:** Use the same gene and alias tables and the same precedence. For multi-alias symbols the Java behavior is **UNCERTAIN** (the validator only says the loader deals with it); check it in Java.
- Severity: high

### 2.3 Duplicates in matrix (feature-wise) files
- **What:** In CNA, expression, methylation, protein, GSVA and generic assay files, a second line for an already-seen **resolved** feature ID (an Entrez ID, an antibody, or an entity ID) is a **warning** saying the line will be ignored (validateData.py:1064-1074). Generic assay additionally errors on a duplicate `ENTITY_STABLE_ID` through UNIQUE_COLUMNS (4661, 507-550).
- **Effect:** If `TP53` appears on line 5 and an alias of TP53 on line 900, only line 5's values are stored, assuming Java matches the validator's message (**UNCERTAIN until checked in Java**).
- **New importer must:** Dedupe by resolved Entrez with first occurrence winning (to be confirmed).
- Severity: high

### 2.4 Segments, SV, GISTIC, gene panel matrix
- **What:**
  - **SEG:** `chrom` `23`/`24` are accepted as X/Y (3025-3027). `chr1` style values are errors. Positions written like `1e+05` are accepted (3050-3055). `loc.start == loc.end` gets a **warning**: "zero bases wide and will not be loaded" (3104-3109). `reference_genome_id` must be hg19 or hg38; **mm10 is rejected for seg and gistic** even though chromosome sizes for it exist (cbioportal_common.py:967-978).
  - **SV:** Missing `SV_Status` gets a warning and is "assumed SOMATIC" (3232-3234). A missing `NCBI_Build` column is "assumed GRCh37" (3254). In gene, sample and status columns, `''`, `NA`, `Unknown` and `0` are treated as missing (3202-3209). If neither site has a known gene, the record is not loaded (warning, 3285-3289). Duplicates are judged over whichever of 14 identity columns exist (3140-3154, 3306-3315).
  - **GISTIC:** A peak with `peak_start == peak_end` is "not shown" (4312-4321).
  - **Gene panel matrix:** Values `NA`, `WGS`, `WXS` and `WXS/WGS` are accepted without being in the DB (3416). A matrix column for a profile whose meta also has `gene_panel` is an error (3370-3377).
- **Effect:** A blank SV_Status is stored as SOMATIC (Java side **UNCERTAIN**, per the message). A zero-width segment is not stored.
- **New importer must:** Apply the SV status default, the 23/24 → X/Y mapping (check how Java stores it), the zero-width segment drop, and the panel sentinels.
- Severity: med

### 2.5 Clinical
- **What:**
  - Exactly 4 `#` header lines are expected, in the order display_name, description, datatype, priority (2431-2434, 2560-2565). Datatype must be `STRING`, `NUMBER` or `BOOLEAN`, case-sensitive (2607-2616). Priority must be an integer ≥ -1 (2618-2629).
  - With `-r` (relaxed) and missing headers, every attribute defaults to STRING, priority 1, and display_name/description equal to the column name (2655-2663).
  - Column names must be upper case (2668-2673).
  - Some attributes are hard-wired to a level and type. For example, AGE, OS_*, DFS_*, SEX and GENDER must be patient-level, and OTHER_SAMPLE_ID, SAMPLE_TYPE and similar must be sample-level (2438-2537).
  - NUMBER accepts a `>` or `<` prefix (2743-2747). BOOLEAN must be exactly `TRUE` or `FALSE` (2754-2763).
  - `OS_STATUS` must be one of LIVING, DECEASED, 0:LIVING, 1:DECEASED. Any `X_STATUS` that has a matching `X_MONTHS` must look like `0:`/`1:` (2937-2981).
  - An attribute defined at both sample and patient level is an error (2887-2894).
  - A patient with data but no samples gets a **warning**, which probably means it is not loaded (**UNCERTAIN**) (2930-2936).
- **Effect:** `AGE` declared in the sample file is an error, but with `-o` errors still block, so it is not loaded. `>90` in a NUMBER column passes. `true` in a BOOLEAN column is an error.
- **New importer must:** Keep the datatype, priority and display_name from the header rows, apply the relaxed-mode defaults if that mode is supported, and decide how to store `>`/`<` numerics (Java storage **UNCERTAIN**; probably as a string).
- Severity: med

### 2.6 Multiple files of one type: validator vs importer
- **What:** The importer keeps a single slot for gene panel matrix, GSVA scores, GSVA p-values, SV and CNA_long, and **overwrites the slot silently**, so the last meta file in listdir order wins (cbioportalImporter.py:373-394). The validator errors only on multiple gene panel matrix, sample attribute, patient attribute, cancer type and resource files, a repeated SEG datatype, and repeated `stable_id` (validateData.py:4914-4946, 5597-5746). **Two SV or two CNA_long meta files with different stable_ids pass validation, but only one is loaded.** Two SEG files are a validator error, but the importer would load both.
- **Also:** The validator skips `ONCOKB_IMPORT_BACKUP*` meta files (validateData.py:4872), but the importer does not (cbioportalImporter.py:276-283). After the OncoKB CNA step renames `meta_CNA.txt` to `ONCOKB_IMPORT_BACKUP_meta_CNA.txt` (importOncokbDiscreteCNA.py:221-235), the importer sees two discrete-CNA metas with the **same stable_id**. What Java then does is **UNCERTAIN** (probably a failure or a double load).
- **New importer must:** Decide on a deterministic policy (probably reject duplicates) and ignore backup files.
- Severity: med

### 2.7 Validation gaps (data that passes because a check is dead or broken)
- **What:**
  - **`_sequenced` check:** "every MAF sample must be in `_sequenced`" is evaluated in `processCaseListDirectory` (5161-5168), but `mutation_file_sample_ids` is filled only later, when the MAF is validated (5731 runs before 5763). The check never fires during full-study validation.
  - **Generic assay:** `generic_entity_meta_properties` is optional in META_FIELD_MAP (cbioportal_common.py:308), but the validator indexes it unconditionally (validateData.py:4656-4657), so leaving it out raises a KeyError.
  - **GSVA:** `float(value)` is called with no NA handling, so a value of `NA` raises ValueError (4618-4643).
  - **Timeline:** `PATIENT_ID` is never checked against defined patients, and only `START_DATE` is validated, which must be an integer and may be negative (3484-3513).
  - **`-n`:** Every gene, alias, panel, cancer-type and geneset-version check is turned off (5870-5878).
  - **Incremental (`-d`):** Every sample-existence check is skipped because DEFINED_SAMPLE_IDS stays None, and genome-build checks are relaxed (5887-5893, 5770-5780).
  - **Extra columns:** Unknown extra columns in most files are never reported.
- **New importer must:** Not assume legacy-loaded studies satisfy these constraints. Real datahub studies may contain such data, so the importer needs explicit behavior for each case.
- Severity: med

---

## 3. Meta-file parsing and defaults

### 3.1 Two parsers
- **What:**
  - **Python** (`parse_metadata_file`, cbioportal_common.py:850-867) reads UTF-8, skips blank lines, and treats any non-blank line without `:` as an **error** (857-864). That includes `#` comments. It splits on the first `:`, strips the **value only**, and lets the last duplicate key win. A key such as `stable_id ` with a trailing space therefore counts as missing.
  - **Java** (`TrimmedProperties extends Properties` with `load(new FileInputStream(...))`; src/main/java/.../scripts/TrimmedProperties.java, CancerStudyReader.java:31-32, GeneticProfileReader.java:238-239) follows java.util.Properties rules. It decodes the bytes as **ISO-8859-1**, ignores `#`/`!` lines, accepts `=` or `:` or whitespace as the separator, processes backslash escapes and trailing-backslash continuation, and trims values. Case lists use `FileReader`, which means the platform charset (CaseListReader.java:11-13).
- **Effect:** `name: Étude` (UTF-8) in meta_study is stored as `Ã‰tude` by Java. A value containing `\t` or `é` is unescaped by Java but kept literally by Python. `description: a \` followed by another line is joined by Java.
- **New importer must:** Pick one parser explicitly. To match legacy exactly, emulate Properties, including the Latin-1 mojibake, or document that as an intentional fix.
- Severity: high

### 3.2 Required vs optional fields, and defaults
Allowed fields are in META_FIELD_MAP (cbioportal_common.py:94-371). Unrecognized fields only produce a warning (906-918).

| Field | Where optional | Default / behavior | Source |
|---|---|---|---|
| `show_profile_in_analysis_tab` | Required for most profiles; optional for MUTATION_UNCALLED; absent for GSVA_PVALUES | **[Java]** `true` unless the value equals `FALSE`, case-insensitive (GeneticProfileReader.java:269-273). P-VALUE profiles are forced to false (GeneticProfileReader.java:197-199). Python requires the literal `false` for CNA CONTINUOUS/LOG2 (cbioportal_common.py:959-965) | |
| `reference_genome` (meta_study) | optional | Validator assumes hg19 (validateData.py:4983-4985, PortalInstance 303-308). **[Java]** uses `GlobalProperties.getReferenceGenomeName()`, i.e. the portal property `ucsc.build` with a fallback default (CancerStudyReader.java:90-94); the literal default value is not checked here | |
| `reference_genome_id` (seg/gistic) | required | must be hg19 or hg38 | cbioportal_common.py:967-978 |
| `swissprot_identifier` | optional | `name`; only `name` and `accession` are allowed (cbioportal_common.py:980-989, validateData.py:2331). **[Java]** gives the same default (ImportProfileData.java:68-73) | |
| `gene_panel` | optional | Applies one panel to every sample of the profile. A warning recommends the matrix instead (cbioportal_common.py:991-997). It is mutually exclusive with a matrix column (validateData.py:3370-3377). `NA` is allowed (cbioportal_common.py:1003) | |
| `namespaces` | optional (MAF, SV, CNA_long) | Comma-split and trimmed. Each listed namespace must match at least one `<ns>.` column, case-insensitive (validateData.py:1398-1413). `ascn` requires the 8 ASCN columns (1644-1653, 1705-1723) | |
| `variant_classification_filter` | optional | **Replaces** the default filter list (§2.1) | |
| `normal_samples_list` | optional | Comma-split and trimmed; `Matched_Norm_Sample_Barcode` must be in it (validateData.py:2166-2175) | |
| `pivot_threshold_value`, `value_sort_order` | optional (generic assay continuous) | No Python default or validation. **[Java]** applies them only if present (GeneticProfileReader.java:110-116) and **requires** them when `generic_assay_type == TREATMENT_RESPONSE` (106-108, 207-213) | |
| `patient_level` | optional (generic assay) | `false`; true only if the value trimmed and lower-cased is `true` (validateData.py:4681, ImportProfileData.java:89-90) | |
| `generic_entity_meta_properties` | "optional" | Effectively required by the validator (KeyError, §2.7) | |
| `add_global_case_list` | optional | `false`; compared case-insensitively to `true` (cbioportalImporter.py:470) | |
| `case_list_category` | optional | Must be in the valid category list (validateData.py:5096-5116). A repeated category gets a warning ("both loaded") | |
| `pd_annotations_filename` | optional (discrete CNA) | Points to the per-sample driver file (§4) | |
| `source_stable_id` | required for GSVA; optional for expression | Z-score/GSVA linkage checks (validateData.py:5230-5317). **[Java]** creates a `genetic_profile_link` row: `STATISTIC` for P-VALUE/Z-SCORE, `AGGREGATION` for GSVA-SCORE, and any other datatype throws (GeneticProfileReader.java:159-169) | |
| `citation`, `pmid`, `groups`, `tags_file` | optional | Length limits: name 255, description 1024, citation 200, pmid 1024, groups 200, type_of_cancer 63 (cbioportal_common.py:939-957). **[Java]** upper-cases `groups` (CancerStudyReader.java:89) | |

- **New importer must:** Apply exactly these defaults, especially show_profile=true, P-VALUE forced hidden, swissprot=name and patient_level=false.
- Severity: high

### 3.3 Allowed (genetic_alteration_type, datatype, stable_id) triples
- **What:** Profile `stable_id`s are a closed list per type/datatype. Generic assay accepts any ID (`*`) (cbioportal_common.py:738-804). If the combination is not on the list, the meta file is invalid and the importer aborts with RuntimeError. The type and datatype pair is matched exactly and case-sensitively (652-695). `stable_id` must also match INVALID_ID_CHARACTERS and be unique within the study (validateData.py:4914-4934).
- **New importer must:** Validate with the same list. Note that the meta file's stable_id is the profile suffix and not the stored ID; the stored form is `<study>_<stable_id>` per Java (**UNCERTAIN**, not checked here).
- Severity: med

---

## 4. OncoKB and driver annotations

### 4.1 Custom driver columns (input contract)
- **What:** MAF, CNA_long and the discrete-CNA pd file may contain `cbp_driver`, `cbp_driver_annotation`, `cbp_driver_tiers` and `cbp_driver_tiers_annotation`. Each value column needs its annotation column and the reverse (validateData.py:1263-1287).
  - `cbp_driver` must be one of `Putative_Passenger`, `Putative_Driver`, `NA`, `Unknown` or empty. The comparison is **case-sensitive and not trimmed** (1248, 1345-1351).
  - `cbp_driver_tiers` is free text up to 50 characters. Every distinct non-empty value becomes an Oncoprint "Mutation Color" tier, and more than 10 tiers produces a warning (1353-1368).
  - The annotation columns allow up to 80 characters (1370-1376).
  - A tiers annotation without a tiers value is an error (1296-1302).
- **Discrete CNA pd file:** The file named in `pd_annotations_filename` needs `SAMPLE_ID` plus Hugo and/or Entrez columns. Its genes must appear in the CNA matrix (1539-1594).
- **Effect:** A MAF row with `cbp_driver=Putative_Driver` makes the mutation a driver. **[Java]** stores these in `alteration_driver_annotation` (driver_filter, driver_filter_annotation, driver_tiers_filter, driver_tiers_filter_annotation), as the SQL in updateOncokbAnnotations.py:155-203 shows.
- **New importer must:** Store these four values per alteration and sample as given. The Java mapping of `NA`/`Unknown`/empty to stored values is **UNCERTAIN**.
- Severity: high

### 4.2 OncoKB import at study-load time (`metaImport.py -oncokb`)
- **What:** Runs only when the flag is set and validation passed (metaImport.py:176-227). It calls the **public OncoKB API v1** (`https://public.api.oncokb.org/api/v1`, libImportOncokb.py:21) with `tumorType: null` and **no referenceGenome** (importOncokbMutation.py:198-205, importOncokbDiscreteCNA.py:215).
  - **Mutations** (importOncokbMutation.py):
    - Columns `Hugo_Symbol`, `HGVSp_Short`, `Variant_Classification`, `Protein_position` and `Entrez_Gene_Id` are required. A missing Entrez column raises ValueError at line 106. Existing `cbp_driver*` columns abort the run (35, 89-96).
    - `p.` is stripped from HGVSp_Short (124-125). Rows with an empty HGVSp_Short are not annotated (133-134).
    - Protein start and end come from `Protein_position` or are parsed from the change, following Java `ExtendedMutationUtil` (libImportOncokb.py:43-114).
    - The query key is `entrez_proteinChange_variantClassification`, de-duplicated (161-162, 207-208).
    - Only genes on OncoKB's `allCuratedGenes` are sent (libImportOncokb.py:183-204).
    - The MAF is **rewritten in place**: four columns are appended, and the original is kept as `ONCOKB_IMPORT_BACKUP_<file>` (211-246).
  - **Values written** (libImportOncokb.py:117-122, 270-278):
    - `cbp_driver` is `Putative_Driver` if `oncogenic` (lower-cased) is `oncogenic`, `likely oncogenic` or `predicted oncogenic`, and `Putative_Passenger` otherwise. That includes `Unknown`, `Inconclusive` and `Likely Neutral`.
    - `cbp_driver_annotation` is always `Annotation imported from OncoKB.org`.
    - `cbp_driver_tiers` is the **raw OncoKB `oncogenic` string**, for example `Likely Oncogenic` or `Unknown`.
    - `cbp_driver_tiers_annotation` is `Annotation imported from OncoKB.org` when that string is non-empty.
    - Rows that were not annotated (non-curated gene, no HGVSp) get four empty cells.
  - **Discrete CNA** (importOncokbDiscreteCNA.py):
    - Every column other than Hugo/Entrez is treated as a sample, **including an optional `Cytoband` column** (124-127), which the validator allows (validateData.py:1210).
    - Each value is turned into an integer with `int(round(float(v)))` after `0`, `NA`, `nan` and empty are mapped to 0 (52-57, 144). Python's banker's rounding sends **`-1.5` to -2 (DELETION)**; `0.5` goes to 0 and `1.5` to 2. Only values in {-2,-1,1,2} are annotated (147-151). A value such as `NaN` raises ValueError (only TypeError is caught).
    - Duplicate entrez+sample events keep the last one (195).
    - It writes `data_cna_pd_annotations.txt` with columns SAMPLE_ID, Entrez_Gene_Id and the four driver columns, **only for events OncoKB returned** (238-247). It then appends `pd_annotations_filename: data_cna_pd_annotations.txt` to the CNA meta and backs up the original (221-235).
  - **Gene resolution:** Entrez comes from the file when present. Otherwise the Hugo map is used, then aliases (importOncokbMutation.py:137-145). In the CNA script, a symbol that is not in the Hugo map and has no Entrez value **reuses `entrez_gene_ids` from the previous loop iteration** (importOncokbDiscreteCNA.py:164-174), so the event could be annotated against the wrong gene. On the first row this raises UnboundLocalError instead. Several error paths reference undefined names (`logger`, `Color`, `row_counter`, `sys` in lib), so they crash instead of logging.
  - Afterwards the whole study is **re-validated**, and that exit code decides whether it loads (metaImport.py:225-227).
- **Effect:** BRAF V600E becomes `cbp_driver=Putative_Driver` and `cbp_driver_tiers=Oncogenic`. A CNA cell of `-1.5` for CDKN2A gets a DELETION annotation in the pd file. The DB values follow from the annotations that existed on the API on the day of the import.
- **New importer must:** Not call OncoKB implicitly. Legacy results depend on whether `-oncokb` was used and when. To match a legacy DB, read the driver columns that are present (which may have been written by this script). If annotation is reimplemented, copy the driver/passenger mapping, the tiers-equal-raw-string rule and the rounding behavior.
- Severity: high

### 4.3 Post-load OncoKB refresh (updateOncokbAnnotations.py, manual)
- **What:** Reads mutation, CNA and SV events straight from ClickHouse, calls OncoKB **with** `referenceGenome` (GRCh37/GRCh38), and then (updateOncokbAnnotations.py:181-207):
  - for rows that exist, runs `ALTER TABLE alteration_driver_annotation UPDATE driver_filter=...`, which changes **only `driver_filter`** and leaves the annotation and tiers columns stale;
  - for rows that don't exist, inserts `driver_filter=<Putative_*>` and empty strings for the other three columns.
- **Effect:** After a refresh, `driver_tiers_filter` can still say `Likely Oncogenic` while `driver_filter` says `Putative_Passenger`.
- **New importer must:** Not replicate it; just know that legacy DB contents may be mixed.
- Severity: low

### 4.4 When OncoKB is unavailable
- **What:** Without `-oncokb`, OncoKB is never contacted. With the flag, an HTTP 404 calls `sys.exit(1)`; that path crashes with NameError because `sys`/`Color` are not imported in libImportOncokb.py (libImportOncokb.py:222-226). Other HTTP errors raise through `raise_for_status`. A connection error raises a requests exception. In every case metaImport re-raises and **nothing is loaded** (metaImport.py:192-195). There is no fallback that loads without annotations.
- **New importer must:** Treat OncoKB as optional and never block on it.
- Severity: med

---

## 5. NA tokens, IDs, case, whitespace, duplicates

### 5.1 NA / null tokens by file type
| File type | Tokens treated as missing | Case | Source |
|---|---|---|---|
| Clinical (sample/patient) and resources | `[not applicable]`, `[not available]`, `[pending]`, `[discrepancy]`, `[completed]`, `[null]`, `''`, `na` | **case-insensitive**, after strip | validateData.py:2429, 2741; 3690 |
| Expression, continuous/log2 CNA, methylation, protein | `NA` (and blank, since ALLOW_BLANKS) | case-sensitive | 1137, 1193-1201, 3427 |
| Discrete CNA (matrix and long) | `NA`; allowed values are -2, -1.5, -1, 0, 1, 2 | exact strings after strip | 1222, 1434 |
| MAF Hugo / Entrez | Hugo `NA`, `''`, `Unknown`; Entrez `NA`, `''`, `0` | case-sensitive | 1797-1803 |
| MAF amino-acid change | `''`, `NULL`, `NA` | case-sensitive | 1624 |
| MAF SWISSPROT | `''`, `NA`, `[Not Available]` | | 2322 |
| MAF read counts | `''`, `.` | | 2203-2221 |
| SV fields | `''`, `NA`, `Unknown`, `0` | case-sensitive | 3207 |
| Generic assay | `NA`, `''`; binary allows `yes`, `no`, `true`, `false` (lower-case only); continuous allows a `>`/`<` prefix | | 4663, 4721-4845 |
| Gene panel matrix | `NA` (not profiled), plus `WGS`, `WXS`, `WXS/WGS` as non-DB panels | | 3407, 3416 |
| GSVA | none (`NA` crashes the validator) | | 4618-4643 |
| GISTIC | `''` | | 4225 |

- **New importer must:** Use per-type token sets. Do **not** apply clinical's case-insensitive list to matrices. Discrete CNA `-1.5` is a legal stored value.
- Severity: high

### 5.2 Sample/patient IDs
- **What:**
  - Allowed characters are `A-Za-z0-9._()[]',+-:;` (validateData.py:82). Space is not allowed and is checked explicitly in matrix headers, case lists and generic assay files (1121-1126, 5152-5156, 4685-4691).
  - SAMPLE_ID is at most 63 characters (79, 2830-2836).
  - The study ID must be `^[a-z0-9_]+$` (85, 4952-4956).
  - Case list stable_id must start with `<study>_` (5076-5081).
  - **Python only strips clinical cells** (2737, 2821). MAF `Tumor_Sample_Barcode` and matrix header IDs are compared without stripping (1785-1786, 1103), so a MAF ID with a trailing space fails as "not defined".
  - Matching is case-sensitive everywhere.
  - **[Java]** `StableIdUtil.getSampleId` truncates any barcode starting with `TCGA` to `TCGA-XX-XXXX-NN` (src/main/java/.../util/StableIdUtil.java:17-56). The validator does not apply this, which is why a duplicate TCGA sample is only a **warning** ("this line will be ignored assuming truncated barcodes", validateData.py:2838-2848) while any other duplicate sample is an error (2849-2857).
- **Effect:** Clinical `TCGA-A1-A0SD-01A-11R` and `TCGA-A1-A0SD-01B` both become `TCGA-A1-A0SD-01` in the DB, and the second line's attributes are dropped (Java detail **UNCERTAIN**).
- **New importer must:** Implement TCGA truncation, at least for sample IDs everywhere a sample is referenced (to be confirmed in Java which loaders call it), keep matching case-sensitive, and apply the clinical-only stripping.
- Severity: high

### 5.3 Whitespace
- **What:** Meta values are stripped and keys are not (cbioportal_common.py:865-867). Clinical cells are stripped. Matrix values are stripped before checking (1196, 1226). Case list IDs are split on `\t` and each stripped (5128). Blank lines and lines starting with `#` after the header are **errors** (530-537). Quoted fields only produce a warning: "quotation marks might be loaded as part of the value" (688-693).
- **Effect:** `"S1"` in quotes is stored with the quotes (per the warning).
- **New importer must:** Strip consistently with Java, and not dequote unless that is an intended fix.
- Severity: med

### 5.4 Duplicates
- **What:**
  - **Clinical:** A non-TCGA duplicate sample is an error; a TCGA duplicate is a warning and the later line is ignored. A duplicate patient in the patient file is an error (2919-2927).
  - **Matrices:** A duplicate resolved gene is a warning and the later line is ignored (1064-1074).
  - **MAF:** A duplicate key over Entrez, Chromosome, Start, End, Variant_Classification, Tumor_Seq_Allele2, HGVSp_Short and Tumor_Sample_Barcode is an **error**, and only when all 8 columns exist (1764-1781).
  - **CNA_long:** A duplicate sample+gene is an error (1468-1522).
  - **SV:** A duplicate over the identity columns present is an error (3306-3315).
  - **Case lists:** A duplicate sample ID is a warning, and the comment says the importer removes it (5137-5142). A duplicate stable_id is an error.
  - **Cancer type file:** A duplicate type is an error (3637-3641).
  - **Meta files:** A repeated key means the last value wins.
- **New importer must:** Dedupe matrix rows (first wins), case lists and TCGA samples as above; treat the rest as hard errors.
- Severity: med

### 5.5 Case sensitivity summary
- **What:**
  - Case-insensitive: `add_global_case_list` (lower), `patient_level` (lower), show_profile (Java `equalsIgnoreCase("FALSE")`), clinical NA tokens, `Mutation_Status` and `Validation_Status`/`Verification_Status` (lower), namespace prefixes (lower).
  - Gene symbols are upper-cased before lookup.
  - Cancer type IDs and parent IDs are **lower-cased** ("loaded into the database in lowercase", 3559, 3658-3660).
  - **Case-sensitive:** genetic_alteration_type/datatype, profile stable_ids, `cbp_driver` values, clinical datatype and BOOLEAN values, generic assay binary values, Variant_Classification (when matched against the filter list), and all sample/patient IDs.
- **New importer must:** Lower-case cancer type IDs, upper-case symbols for lookup, and keep everything else exact.
- Severity: med

---

## 6. Pointers for the Java audit (not in this scope)
These are places where the Python validator or orchestration says the Java side transforms data:
- `ImportExtendedMutationData` / `MutationFilter`: the variant filter, Unknown/0, Mutation_Status exclusions, "MUTATED".
- Gene resolution in the Java loaders: alias handling and duplicate rows.
- `StableIdUtil`: TCGA truncation.
- `ImportCopyNumberSegmentData`: zero-width segments, 23/24.
- `ImportStructuralVariantData`: SOMATIC default.
- `FractionGenomeAlteredCalculator` and `DaoMutation`: MUTATION_COUNT and FGA.
- `ImportSampleList` / `CaseListReader`: de-duplication.
- `ImportTypesOfCancers` with clobber=false.
- `ref/cbioportal/src/main/resources/db-scripts/clickhouse/populate_derived_tables.sql`.
