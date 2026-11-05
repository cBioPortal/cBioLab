# Legacy Java importer: hidden calculations

Scope: `ref/cbioportal-core/src/main/java/org/mskcc/cbio/portal/**` (scripts, dao, util, model), plus the
external `io.github.cbioportal:maf:1.0.0` jar that the mutation importer depends on
(`MafUtil`, `MafRecord`, `TabDelimitedFileUtil`; no source on disk, so I verified it by disassembling
`~/.m2/repository/io/github/cbioportal/maf/1.0.0/maf-1.0.0.jar` with `javap -c`).
Paths below are relative to `cbioportal-core/src/main/java/org/mskcc/cbio/portal/`.
Read-only review: nothing was modified.

Out of scope here (covered in sibling notes): the Python orchestrator/validator
(`legacy-python-pipeline.md`) and `populate_derived_tables.sql` (`legacy-clickhouse-derived.md`).
Where the Python import order changes a Java result, I note it.

Severity: **high** = visibly changes counts or frequencies, **med** = changes stored values or
edge-case rows, **low** = cosmetic or rare.

---

## Top 15 gotchas most likely to cause parity diffs (ranked)

1. **Default mutation filter drops rows** (Silent, Intron, 3'UTR, 3'Flank, 5'UTR, IGR, 5'Flank except
   TERT; also RNA, Mutation_Status None/LOH/Wildtype, Validation_Status Redacted/Wildtype). Matching
   is a case-insensitive *prefix* match. A `variant_classification_filter` in the meta file replaces
   the whole list with an exact match. See M1 to M3. **high**
2. **"Profiled" samples (`sample_profile`) are derived, not read.** For mutations, a sample counts only
   if it has at least one *accepted* mutation or is listed in `#sequenced_samples`. For tab-delimited
   data, every sample column in the header counts. For SV, only samples with at least one stored SV.
   The gene panel matrix adds to this set and overrides panels. `NA` adds nothing. `WXS`/`WGS` give a
   null panel. Sets every frequency denominator. See P1 to P4. **high**
3. **MUTATION_COUNT is computed** as count distinct (chr, start, end, ref, tumor allele), excluding
   GERMLINE. It covers every sample in sample_profile and is *not restricted to the profile's own
   mutations*. It is recomputed after the gene panel matrix is loaded. See M10. **high**
4. **MAF gene resolution drops rows.** An invalid, negative or unknown Entrez ID drops the row, with no
   Hugo fallback. Entrez 0 or empty falls back to the Hugo symbol or a *non-ambiguous* alias (plus a
   2-entry disambiguation file). `Unknown` with Entrez 0 is dropped as IGR. See G1, G2. **high**
5. **Tab-delimited gene resolution drops or duplicates rows.** It tries Entrez, then Hugo, then any
   alias. An ambiguous alias drops the row (no disambiguation file here). `|` truncates the symbol.
   `///` or `---` drops the row. The first row per Entrez ID wins. miRNA rows are copied to every
   matching miRNA gene. See G3, T2 to T4. **high**
6. **Mutation de-duplication and merge.** Rows with the same (gene, chr, start, end, protein_change,
   tumor_allele, mutation_type), compared case-insensitively, collapse to one per sample. A tie-break
   picks the survivor and the centers are merged. See M7. **high**
7. **CNA events are generated, not read.** `cna_event`/`sample_cna_event` rows are created only for the
   exact strings `"2"` and `"-2"`, with `"-1.5"` remapped to -2. `genetic_alteration` keeps the raw
   `-1.5`. Only runs when `show_profile_in_analysis_tab` is true, and only for single-gene, non-miRNA
   rows. See T5. **high**
8. **Clinical NA-like tokens are dropped.** `""`, `NA`, `Not Available`, `Not Applicable`, `Pending`,
   `Discrepancy`, `Completed` and `null` are matched case-insensitively, after stripping `[`, `]`, `|`
   and mapping space to `_`. No row is stored for them. See C1. **high**
9. **OS_STATUS/DFS_STATUS are rewritten.** `DECEASED` becomes `1:DECEASED`, `LIVING` becomes
   `0:LIVING`, and so on. Only these two attributes are touched, not PFS or DSS. See C2. **high**
10. **FRACTION_GENOME_ALTERED is computed from segments** as the length-weighted fraction with
    \|seg_mean\| >= 0.2, rounded to 4 decimal places with HALF_UP. Segments with start >= end are
    skipped. See S2. **high**
11. **SV rows without an SV_Status are silently dropped.** The same happens to rows whose sample is
    unknown. Duplicate SVs (by an 11-field key) are dropped. Missing numerics become -1. See V1 to V4.
    **high**
12. **Implicit sample and patient creation and filtering.** A `SAMPLE_TYPE` of normal, or a TCGA normal
    barcode, means the sample is never created and its attributes are dropped. TCGA IDs are truncated
    or rewritten. Sample type defaults to `Primary Solid Tumor`. Sample resource files can create
    samples and patients. See C3 to C5, R1. **med-high**
13. **Chromosome normalization.** The MAF `chr` prefix is stripped, X becomes `"23"` and Y becomes
    `"24"`, and `M`/`chrM` rows are dropped. Segment and GISTIC files require 1-24, X or Y. See
    M5, S1, X1. **med**
14. **Protein change and position are derived.** The source order is HGVSp_Short, then
    Amino_Acid_Change, then the literal `"MUTATED"`, with `p.` stripped. Protein start/end are parsed
    from `Protein_position` or regex-derived from the protein change. For insertions with
    `Reference_Allele == "-"`, `End = Start+1` overrides the file. See M4, M6. **med**
15. **Other computed or derived records:** SAMPLE_COUNT, mutation keyword plus
    `mutation_count_by_keyword`, global shared `mutation_event` rows, MutSig rows with q >= 0.1
    dropped, patient-level generic assay values copied to every sample, and gene panels that silently
    fail to import. See C6, M8, M9, X2, A2, P5. **med**

---

## G. Gene resolution (shared by all importers)

### G1. MAF (mutations): Entrez-first with no fallback when Entrez is bad
- **What**: A non-empty, non-`0` Entrez_Gene_Id that is non-numeric, negative or not in the `gene`
  table drops the row. The importer does *not* fall back to Hugo_Symbol.
- **Where**: `scripts/ImportExtendedMutationData.java:266-292`
- **Effect**: `Hugo_Symbol=TP53, Entrez_Gene_Id=99999999` is skipped entirely, as is
  `Entrez_Gene_Id=abc`.
- **New importer must**: Use Entrez as the authority when it is present and non-zero, and drop the row
  if that Entrez ID is unknown.
- Severity: **high**

### G2. MAF: Hugo/alias fallback, "Unknown", ambiguity
- **What**: When Entrez is empty or `0`, the importer calls `getNonAmbiguousGene(hugo)`. That method
  first tries a numeric string as Entrez, then the Hugo symbol (case-insensitive, via an uppercase
  map), then aliases. If an alias matches more than one gene, it uses the disambiguation file
  (`MLL2→8085`, `CDC2→983`; the key match is case-sensitive). Otherwise it returns null and the row is
  dropped. A Hugo symbol of `Unknown` with Entrez `0` (or no Entrez column) is dropped and counted as
  IGR, whatever the Variant_Classification says.
- **Where**: `scripts/ImportExtendedMutationData.java:295-329`;
  `dao/DaoGeneOptimized.java:212-214, 295-318, 392-419, 63-81`;
  `src/main/resources/gene_symbol_disambiguation.txt`
- **Effect**: `Hugo_Symbol=p53` with Entrez 0 resolves to TP53 if `p53` is a unique alias. An
  ambiguous alias is dropped. `Hugo_Symbol=7157` with Entrez empty is treated as Entrez 7157. An alias
  that resolves silently changes the stored gene (`entrez_gene_id`) to the canonical gene.
- **New importer must**: Use the *same* gene and gene_alias tables (same reference DB release), apply
  Hugo-before-alias precedence, reject ambiguous aliases, and apply the disambiguation file.
- Severity: **high**

### G3. Tab-delimited profiles (CNA, expression, methylation, RPPA, ...)
- **What**: Entrez is used first. A *non-numeric* Entrez drops the line. A numeric Entrez that is not
  found falls back to Hugo. Hugo is looked up via `getGene(symbol, true)`, which tries the exact symbol
  (case-insensitive) and then *all* alias matches. More than one match means "ambiguous" and the line
  is dropped. The disambiguation file is **not** used here, unlike in G2.
- **Where**: `scripts/ImportTabDelimData.java:318-319, 644-662, 612-621`;
  `dao/DaoGeneOptimized.java:225-234`
- **Effect**: `Hugo_Symbol=MLL2` with no Entrez is dropped in CNA but would resolve to 8085 in a MAF.
  `Entrez=12345678, Hugo=EGFR` (unknown Entrez) resolves via EGFR.
- **New importer must**: Implement the per-file-type differences exactly, including no disambiguation
  file for tab-delimited data.
- Severity: **high**

### G4. Discrete-long CNA gene resolution
- **What**: Entrez is used first (non-digit becomes 0, a warning, then Hugo is tried). For Hugo,
  `///`/`---` drops the row and `|` truncates. An ambiguous alias **throws** and aborts the import
  instead of skipping the row.
- **Where**: `scripts/ImportCnaDiscreteLongData.java:252-301`; `util/CnaUtil.java:88-97`
- **New importer must**: Treat this as a hard error, or document the deliberate difference.
- Severity: **low**

### G5. SV, GISTIC, MutSig and gene panels
- SV: Entrez first. An Entrez that is not found is converted to NA, and the importer falls back to
  `getNonAmbiguousGene(hugo)`. The resolved entrez is written back. (`scripts/ImportStructuralVariantData.java:114-151, 185-199`)
- GISTIC: `getNonAmbiguousGene` (with the disambiguation file). miRNA genes are dropped, as are
  duplicate genes within a region. (`util/GisticReader.java:148-181`)
- MutSig: `getNonAmbiguousGene`, and unresolvable rows are dropped. (`util/MutSigReader.java:151-154`)
- Gene panel: numeric means Entrez. Otherwise `getGene(sym, true)`, and **an ambiguous alias takes the
  first match** (in DB load order). (`util/GenePanelUtil.java:76-97`)
- Severity: **med**

---

## M. Mutations (`ImportExtendedMutationData`, `MutationFilter`, `ExtendedMutationUtil`, maf jar)

### M1. Default variant-classification filter (no `variant_classification_filter` in meta)
- **What**: The mutation is rejected when `Variant_Classification`, compared case-insensitively,
  **starts with** Silent, Intron, 3'UTR, 3'Flank, 5'UTR or IGR. `5'Flank` is kept only for Entrez 7015
  (TERT) and is rewritten to protein_change `Promoter`.
- **Where**: `scripts/MutationFilter.java:107-130, 246-251`
- **Effect**: `Silent`, `Intron`, `IGR` and `5'Flank` (non-TERT) rows vanish. `Splice_Region`,
  `Targeted_Region` and `De_novo_Start_*` are **kept**. TERT `5'Flank` is stored as `Promoter`.
- **New importer must**: Replicate the exact list, the prefix semantics and the TERT special case.
- Severity: **high**

### M2. Custom filter from the meta file
- **What**: If the meta file has `variant_classification_filter`, that comma-separated trimmed set
  *replaces* the default list, using an **exact, case-sensitive** `contains`. `5'Flank` is then kept
  for **all** genes and every one is rewritten to `Promoter`.
- **Where**: `util/GeneticProfileReader.java:323-337`; `scripts/MutationFilter.java:97-106`
- **Effect**: `variant_classification_filter=Silent` keeps Intron, IGR and so on. `silent` would not
  filter `Silent`.
- **New importer must**: Read this meta key and honour its semantics.
- Severity: **high**

### M3. Status-based drops
- **What**: The row is dropped if `Validation_Status` equalsIgnoreCase `Wildtype`, or
  `Mutation_Status` starts with (case-insensitive) `None`, `LOH` or `Wildtype`, or `Validation_Status`
  starts with `Redacted`. `Germline` is **kept** (but excluded from MUTATION_COUNT, M10). Rows where
  the mutation type equals `RNA` are dropped.
- **Where**: `scripts/ImportExtendedMutationData.java:192-200, 239-245`;
  `scripts/MutationFilter.java:77-94`
- **Effect**: `Mutation_Status=LOH` gives no row. `Mutation_Status=Nonesuch` is also dropped (prefix
  `None`).
- Severity: **high**

### M4. Protein change derivation
- **What**: protein_change = `HGVSp_Short` (trimmed). If that is null, empty, `NULL`, `NA` or
  `[Not Available]`, the importer uses `Amino_Acid_Change` (trimmed). If that is also invalid, it
  stores the literal `"MUTATED"`. A leading `p.` is then stripped.
- **Where**: `util/ExtendedMutationUtil.java:36-72, 111-117`
- **Effect**: `HGVSp_Short=p.G12D` becomes `G12D`. If both columns are blank, the result is
  `MUTATED`. That value is part of the de-dup key (M7) and the keyword (M9).
- Severity: **med**

### M5. Chromosome normalization (MAF)
- **What**: `chr = normalizeChr(Chromosome.toUpperCase())`. Accepted values are `1..24`,
  `CHR1..CHR24`, `X/CHRX→"23"`, `Y/CHRY→"24"`, `NA`, and `MT`. Anything else returns null and the
  **row is dropped**.
- **Where**: `scripts/ImportExtendedMutationData.java:202-208`;
  `dao/DaoGeneOptimized.java:322-342`
- **Effect**: `chr7` is stored as `7`. `X` is stored as `23`. `M`, `chrM`, `GL000220.1` and `1_random`
  are dropped. An empty Chromosome becomes `"NA"` (see M11) and is **kept**.
- **New importer must**: Store `23`/`24` (not X/Y) in mutation chr for parity, and drop the same
  contigs.
- Severity: **med**

### M6. Positions, alleles, counts and other derived fields
- **Start/End**: parsed with `Long.parseLong`. A failure gives `Long.MIN_VALUE`, which is then clamped:
  a negative value becomes `0`. (`ImportExtendedMutationData.java:210-214`; maf jar
  `TabDelimitedFileUtil.getPartLong`)
- **Insertion end fix**: if `Reference_Allele == "-"` (exact match), then `End_Position = Start_Position + 1`,
  overriding the file value (maf jar `MafUtil.fixEndPointForInsertion`). **med**
- **Tumor allele**: the single `tumor_seq_allele` comes from
  `MafUtil.resolveTumorSeqAllele(ref, t1, t2)`. If t1 is empty, NA or equal to ref, it uses t2. If t2
  is empty, NA or equal to ref, it uses t1. If both differ and one is `-` while the other is
  nucleotides, it uses the non-`-` one. Otherwise it uses t1. If both are empty or NA, the result is
  `""`. (`model/ExtendedMutation.java:526-531`; maf jar) **med**
- **Protein position**: `Protein_position` like `"12/189"` or `"12-13/189"` is parsed with
  `Double.parseDouble` and then truncated. If it is missing, the start and end are regex-derived from
  protein_change (for example, `G12D` gives 12/12, `E746_A750del` gives 746/750, and an `fs` gives
  start=end). If nothing parses, the value is `-1`. (`util/ExtendedMutationUtil.java:74-109, 278-371`) **med**
- **Read counts**: `t_alt_count` is used first, then `TVarCov`, then
  `round(tumor_depth * tumor_vaf)` (where a vaf with `%` is divided by 100). `t_ref_count` is used
  first, then `TTotCov - TVarCov`, then `depth - round(depth*vaf)`. The same applies to normal counts.
  An unparseable value becomes null. Counts are parsed via Double, so `"12.7"` gives 12.
  (`util/ExtendedMutationUtil.java:154-214`) **med**
- **mutation_type**: `Variant_Classification` is used if it is "acceptable". Otherwise the importer
  falls back to the `ONCOTATOR_VARIANT_CLASSIFICATION` column if present and non-NA, which can rescue a
  Silent row. (`ImportExtendedMutationData.java:229-237`; `ExtendedMutationUtil.java:119-152`) **low**
- **canonical_transcript** is always `true`. **ASCN** `clonal` is uppercased, and unknown values become
  `NA` (`model/AlleleSpecificCopyNumber.java:147-155`). **low**

### M7. De-duplication and merge of duplicate mutation rows
- **What**: Mutations are keyed by MutationEvent (entrez, chr, start, end, protein_change,
  tumor_seq_allele, mutation_type, compared case-insensitively) plus profile and sample. **The
  reference allele is not part of the key.** On a collision, the survivor is the first row unless the
  second row has a TCGA blood-normal barcode (`TCGA-..-....-10*`), else Validation_Status
  Valid/VALIDATED, else Mutation_Status Germline (Germline beats Somatic beats other). Centers are
  merged into a sorted `;`-joined set, with `NA` removed when other centers exist.
- **Where**: `model/ExtendedMutation.java:218-262, 836-866`;
  `scripts/ImportExtendedMutationData.java:417-423, 511-546`
- **Effect**: Two MAF rows with the same variant from two centers become 1 row with
  `center="BI;WUSTL"`. A Somatic row and a Germline row collapse to one Germline row, which is then
  excluded from MUTATION_COUNT.
- **New importer must**: Replicate the key, the tie-break and the center merge. Note that ASCN records
  are appended per *input* row, even for merged duplicates (`:424-428`).
- Severity: **high**

### M8. `mutation_event` is global and shared across studies
- **What**: All existing events in the DB (from **any** study) are loaded. A new mutation that matches
  an existing event key reuses that event, along with its stored ref allele, strand, variant_type,
  ncbi_build, dbSNP, refseq, codon change, uniprot, protein positions and keyword. Fields from the
  current file that are not in the key are discarded. Within a file, the first row creates the event.
- **Where**: `scripts/ImportExtendedMutationData.java:113-118, 408-415`;
  `dao/DaoMutation.java:114-141`
- **Effect**: Study B's `Reference_Allele`, `RefSeq` or `Protein_position` for KRAS G12D can show study
  A's values. Load order changes stored values.
- **New importer must**: Decide whether events are per-study (this diverges from legacy) or a global
  first-writer-wins table. A per-study design needs a parity allow-list for these columns.
- Severity: **med**

### M9. Mutation keyword and `mutation_count_by_keyword`
- **What**: `keyword = HUGO + " " + guessOncotatorMutationKeyword(protein_change, mutation_type)` is
  computed from case-sensitive type names. For example, Nonsense, Splice_Site, Frame_Shift_*, Nonstop
  and Translation_Start_Site give `truncating`, and `Missense_Mutation G12D` gives `G12 missense`. A
  null result is stored as `\N`. Per profile, the importer counts distinct samples per
  (keyword, entrez) and per entrez into `mutation_count_by_keyword`.
- **Where**: `dao/DaoMutation.java:117, 139, 201-275`; `util/MutationKeywordUtils.java` (whole file)
- **New importer must**: Port `MutationKeywordUtils` verbatim if any API uses `keyword` or
  `mutation_count_by_keyword` (for example, hotspot or "recurrence" counts).
- Severity: **med**

### M10. MUTATION_COUNT clinical attribute (computed)
- **What**: After each MUTATION_EXTENDED import, and again after the gene panel matrix import, the
  importer runs SQL that, for every `sample_profile` row of the profile, computes
  `count(DISTINCT chr, start, end, reference_allele, tumor_seq_allele)` from `mutation JOIN
  mutation_event`. It excludes `UPPER(mutation_status)='GERMLINE'`. The join is on **sample_id only**
  (not genetic_profile_id). The result is written as sample attribute `MUTATION_COUNT`, and the meta
  row is created as NUMBER, sample-level, priority `30`.
- **Where**: `dao/DaoMutation.java:143-199`;
  `scripts/ImportExtendedMutationData.java:481-483`;
  `scripts/ImportGenePanelProfileMap.java:172-182`
- **Effect**:
  - Two genes at the same locus count as 1, because the distinct is on coordinates and allele, not
    gene.
  - Mutations from another mutation-type profile for the same sample (for example a
    MUTATION_UNCALLED profile) **are also counted**, depending on load order. The gene panel matrix
    recompute runs last, so it sees them.
  - Samples in sample_profile with no mutations (for example, from `#sequenced_samples` or the matrix)
    get a row, most likely `"0"`. *Uncertain*: this relies on ClickHouse's LEFT JOIN over
    `Nullable(...)` columns producing NULLs and on multi-argument `count(DISTINCT ...)` skipping
    NULL tuples. Confirm against a legacy DB.
- **New importer must**: Compute this exactly, including the cross-profile join and the zero rows.
- Severity: **high**

### M11. Empty MAF cells become the literal string "NA"
- **What**: Most string columns go through `getPartString`, which returns `"NA"` for an empty or
  missing column with no trim. Hugo and Entrez use `getPartStringAllowEmpty`, which trims. cbp_driver
  and cbp_driver_tiers map `NA` to `""`.
- **Where**: maf jar `TabDelimitedFileUtil.getPartString` / `MafUtil.parseRecord`
- **Effect**: An empty `Center`, `Strand`, `Mutation_Status`, `Validation_Status`, `Chromosome` or
  `Reference_Allele` is stored as `NA`, not NULL or `''`.
- Severity: **med**

### M12. Unknown and normal samples in the MAF
- **What**: A tumor barcode that is not in the DB **throws** (import aborts), unless it is a TCGA
  normal barcode (`-10..-19`, only `10`/`11` recognized), which is skipped silently. The barcode is
  first normalized by `StableIdUtil.getSampleId` (C4).
- **Where**: `scripts/ImportExtendedMutationData.java:172-186`
- Severity: **low**

### M13. Driver annotations
- **What**: An `alteration_driver_annotation` row is written only if `cbp_driver` or `cbp_driver_tiers`
  is non-empty and not `na` (case-insensitive).
- **Where**: `dao/DaoMutation.java:61-77` (the same logic applies to CNA in
  `dao/DaoCnaEvent.java:43-62` and to SV in `dao/DaoStructuralVariant.java:114-130`)
- Severity: **low**

---

## T. Tab-delimited profiles (`ImportTabDelimData`, `GeneticAlterationImporter`)

### T1. Values are stored raw (trimmed) and comma-joined
- **What**: Each value is `trim()`ed and stored as a string. There is **no** NA normalization or
  numeric coercion. A value containing `,` throws. Normal-sample columns are removed from both the
  header and the values.
- **Where**: `scripts/ImportTabDelimData.java:286-290`;
  `dao/DaoGeneticAlteration.java:76-93`
- **Effect**: `"NA"`, `""`, `"-1.5"` and `"2.0"` are stored verbatim.
- Severity: **low** (but do not "clean" values)

### T2. Duplicate genes: the first row wins
- **What**: A per-file set of entrez IDs (or entity IDs) is kept. A later row resolving to the same
  gene is skipped, even if it arrives via an alias.
- **Where**: `scripts/GeneticAlterationImporter.java:41-62, 72-83`
- **Effect**: Two `EGFR` rows means only the first is stored. An alias row mapping to an
  already-imported gene is skipped.
- Severity: **high**

### T3. Skipped gene symbols
- **What**: A Hugo symbol containing `///` or `---` drops the line, **even if Entrez is valid**. A
  symbol containing `|` uses the text before the first `|`. Empty Hugo and empty Entrez drops the line.
- **Where**: `scripts/ImportTabDelimData.java:531-551, 654-658`
- Severity: **med**

### T4. miRNA rows are copied to every matching gene
- **What**: If any gene matched by the symbol (as Hugo or as an alias) is of type miRNA, the row is
  stored once **per miRNA gene**, and non-miRNA matches are ignored. A real Hugo symbol that is also an
  alias of a miRNA gene goes down this path.
- **Where**: `scripts/ImportTabDelimData.java:567-601`
- **Effect**: `hsa-mir-100` produces rows for both `MIR-100/100` and `MIR-100/100*`.
- Severity: **med**

### T5. CNA events are generated from the discrete matrix
- **What**: For profiles with `COPY_NUMBER_ALTERATION` and `show_profile_in_analysis_tab` true (the
  default is **true** when absent), each value that is exactly `"2"` or `"-2"` produces a
  sample_cna_event row, creating a global `cna_event` (entrez, alteration) row if needed. `"-1.5"` is
  remapped to -2 for the event only. `genetic_alteration` has already been written with `-1.5`.
  `1`, `-1`, `0`, `2.0` and `-2.0` produce no events. Events are only created when exactly one
  non-miRNA gene was stored. pd_annotations (cbp_driver*) are attached from an optional
  `pd_annotations_filename`.
- **Where**: `scripts/ImportTabDelimData.java:161-163, 604-611, 664-693`;
  `util/CnaUtil.java:44-66`; `dao/DaoCnaEvent.java:24-82`;
  `util/GeneticProfileReader.java:269-273`
- **Effect**: In a discrete CNA file with value `-1.5`, the API shows -1.5 in molecular data but -2
  (HOMDEL) in CNA events. A log2 CNA meta *without* `show_profile_in_analysis_tab: false` would be
  treated as discrete.
- **New importer must**: Generate the events with exact string matching and the -1.5 remap.
- Severity: **high**

### T6. Discrete long-format CNA
- **What**: Value is parsed as `Integer.valueOf`, with `-1.5` remapped to `-2`, so `genetic_alteration`
  stores `-2`, unlike the wide format. A blank or `NA` value **throws**. Gene/sample cells absent from
  the file are stored as `""`. A duplicate (gene, sample) pair keeps the first. Sample order follows
  Guava `HashBasedTable` column order, not file order. After import, the profile datatype is rewritten
  from `DISCRETE_LONG` to `DISCRETE`.
- **Where**: `scripts/ImportCnaDiscreteLongData.java:120, 138-140, 187-193, 214-229`;
  `util/CnaUtil.java:103-111`
- Severity: **med**

### T7. RPPA (`Composite.Element.Ref` as the first column)
- **What**: `"GENE1 GENE2|antibody_id"` is split on spaces. Each gene goes through
  `getNonAmbiguousGene`, and `NA` genes are ignored. The row is stored for **every** gene. A duplicate
  antibody ID drops the row. If the antibody ID matches `p[STY]\d+(_[STY]\d+)*`, the row is mapped to
  phospho pseudo-genes `<SYMBOL>_<residue>` (for example `AKT1_pS473`). These are **created in the
  global gene table** if missing, with type phosphoprotein and 3 aliases.
- **Where**: `scripts/ImportTabDelimData.java:613-614, 627-642, 740-815`
- Severity: **med**

### T8. Sample column detection
- **What**: The sample columns start at the first header that is not one of `Gene Symbol`,
  `Hugo_Symbol`, `Entrez_Gene_Id`, `Locus ID`, `Cytoband`, `Composite.Element.Ref`, `geneset_id`,
  `entity_stable_id` (case-insensitive) or a `generic_entity_meta_properties` name, and that is after
  the last ID column. Any other annotation column is treated as a sample, which fails with "Unknown
  sample".
- **Where**: `scripts/ImportTabDelimData.java:849-889`
- Severity: **low**

### T9. `genetic_profile_samples` order and `sample_profile`
- **What**: The ordered sample list is the header order minus normals. All of these samples go into
  `sample_profile` with the meta `gene_panel` (or null), whether or not they have any non-NA value.
- **Where**: `scripts/ImportTabDelimData.java:217-231, 342`
- Severity: **high** (denominators; see P1)

---

## C. Clinical (`ImportClinicalData`, `SurvivalAttributeUtil`, `DaoPatient`)

### C1. NA-like tokens: the attribute row is not stored
- **What**: `MissingAttributeValues.has(v)`. A blank value is missing. Otherwise the importer removes
  all `[`, `]` **and `|`** characters, replaces spaces with `_`, uppercases, and checks for enum
  names: NOT_APPLICABLE, NOT_AVAILABLE, PENDING, DISCREPANCY, COMPLETED, NULL, MISSING, NA.
- **Where**: `scripts/ImportClinicalData.java:55-88, 387-391`
- **Effect**: `NA`, `na`, `[Not Available]`, `not applicable`, `Completed`, `NULL`, `N|A`, `Missing`
  and `[Pending]` produce no clinical row. `N/A`, `Unknown` and `.` are **stored**.
- **New importer must**: Use the identical token set and normalization. Note that these values are
  never stored as NA strings.
- Severity: **high**

### C2. Survival status prefixing
- **What**: For **patient** attributes `OS_STATUS` and `DFS_STATUS` only, values in
  {DECEASED, RECURRED/PROGRESSED, RECURRED, PROGRESSED} (case-insensitive, with `/` mapped to `_`) get
  the prefix `1:`, and {LIVING, DISEASEFREE} get the prefix `0:`. The original casing is kept. Values
  already in `0:LIVING` form are unchanged.
- **Where**: `scripts/ImportClinicalData.java:572-579`;
  `util/SurvivalAttributeUtil.java:8-90` (prefixing at :80-86)
- **Effect**: `DECEASED` becomes `1:DECEASED`, `Living` becomes `0:Living`, `DiseaseFree` becomes
  `0:DiseaseFree`. `PFS_STATUS=Progressed` stays `Progressed`.
- Severity: **high**

### C3. Attribute metadata normalization
- **What**: Attribute IDs are trimmed and uppercased. Datatype is validated case-insensitively against
  STRING, NUMBER and BOOLEAN but stored **as written**. Priority is stored as a string. Leading `#`
  characters are stripped from header lines. PATIENT_ID and SAMPLE_ID get no meta row. If an
  attribute already exists for the study (for example, defined earlier in another file), the first
  definition wins. Without a 4/5-line metadata header, every column defaults to display/description
  `MISSING`, datatype STRING, priority `1` and type **SAMPLE**. In a patient file, that means the
  values are dropped, because no sample ID is present. *Edge case, inferred from code.*
- **Where**: `scripts/ImportClinicalData.java:177-260`
- Severity: **med**

### C4. TCGA ID rewriting (`StableIdUtil`)
- **What**: For IDs starting with `TCGA`: `Tumor` becomes `01`, `Normal` becomes `11`. The sample ID
  is truncated to `TCGA-XX-XXXX-NN`. If there are fewer than 4 `-` parts, `-01` is appended (so
  `TCGAFOO` becomes `TCGAFOO-01`). The patient ID of a TCGA sample is derived from the barcode,
  overriding the PATIENT_ID column for linkage. Duplicate TCGA samples in the clinical file use the
  first row with a warning. Duplicate non-TCGA samples throw.
- **Where**: `util/StableIdUtil.java:36-72`;
  `scripts/ImportClinicalData.java:321-341, 530-547`
- Severity: **med** (TCGA studies only)

### C5. Implicit sample and patient creation; normal samples
- **What**:
  - Patients are created on first sight from any sample or patient row. A patient-file patient with
    no sample is created with a warning.
  - A sample is **not created** if its ID is a TCGA normal barcode, or if
    `SAMPLE_TYPE` (uppercased, spaces to `_`) is `BLOOD_DERIVED_NORMAL` or `SOLID_TISSUES_NORMAL`.
    All its attributes are dropped, but its patient is still created.
  - `sample.type` is set from the TCGA code or the SAMPLE_TYPE enum, defaulting to
    `Primary Solid Tumor`, and is stored as the display string.
- **Where**: `scripts/ImportClinicalData.java:351-367, 459-528`; `model/Sample.java:73-84`;
  `dao/DaoSample.java:122-127`
- **Effect**: `SAMPLE_TYPE=Primary` gives type `Primary Solid Tumor`. `SAMPLE_TYPE=Solid Tissues Normal`
  means the sample is absent from the study, so it is missing from `_all`, SAMPLE_COUNT, and so on.
- Severity: **high** (sample counts)

### C6. SAMPLE_COUNT (computed patient attribute)
- **What**: After a SAMPLE or MIXED clinical import, the importer inserts `SAMPLE_COUNT = count(*)`
  of samples per patient into `clinical_patient`, with meta STRING, patient-level, priority `1`.
  Patients with zero samples get no row. The count covers samples existing at that moment. (Python
  loads the sample file first, so samples created later from resource files are not counted.)
- **Where**: `scripts/ImportClinicalData.java:171-174`; `dao/DaoPatient.java:165-191`
- Severity: **med**

### C7. Values are not type-coerced
- **What**: NUMBER and BOOLEAN attributes are stored as the trimmed raw string, with no parsing or
  rounding.
- **Where**: `scripts/ImportClinicalData.java:568-585`
- **Effect**: `45.0` stays `45.0`. `>89` is stored.
- Severity: **low** (do not normalize)

### C8. MIXED/relaxed duplicate handling
- **What**: A duplicate patient or sample attribute pair in the same import throws, unless relaxed
  mode (`-r`) is on, in which case the **first** value is kept.
- **Where**: `scripts/ImportClinicalData.java:393-425`
- Severity: **low**

---

## S. Copy-number segments and FGA

### S1. Segment parsing
- **What**: The chromosome must be digits <= 24, `X` or `Y`. `chr1` **throws**. The chrom is stored
  **as written** (`X` stays `X`, `23` stays `23`). Start and end are parsed as Double and truncated to
  long. num_probes uses `BigDecimal.intValue` (truncates). A row with `start >= end` is **skipped**.
  An unknown TCGA normal sample is skipped. Any other unknown sample throws. seg_mean is written via
  `Double.toString`.
- **Where**: `scripts/ImportCopyNumberSegmentData.java:54-90`;
  `scripts/ValidationUtils.java:30-40`
- Severity: **med**

### S2. FRACTION_GENOME_ALTERED (computed)
- **What**: Per sample, FGA = sum(length where |seg_mean| >= 0.2) / sum(length), with
  `length = end - start` (no +1) over all accepted segments, including X and Y. The result is
  `BigDecimal` with 4 decimal places, `HALF_UP`, written with `toPlainString`. Samples with total
  length 0 get no row. Meta: NUMBER, sample-level, priority `20`.
- **Where**: `util/FractionGenomeAlteredCalculator.java:15-50`;
  `dao/DaoCopyNumberSegment.java:53-77`;
  `scripts/ImportCopyNumberSegmentData.java:90, 128-129`
- **Effect**: Segments of 100 kb at mean 0.25 and 900 kb at mean 0.1 give `"0.1000"`.
- **New importer must**: Compute this identically, including the cutoff `>=`, the exclusion of
  skipped segments, and the string format.
- Severity: **high**

### S3. `copy_number_seg_file` reference genome
- **What**: A `reference_genome_id` mismatch with the study only logs a message. The value is stored
  if it is a valid enum member, otherwise the import throws.
- **Where**: `scripts/ImportCopyNumberSegmentData.java:151-197`
- Severity: **low**

---

## V. Structural variants / fusions

### V1. Rows without an SV_Status are dropped
- **What**: A missing or empty `SV_Status` becomes `"NA"`, then null. The required-fields check
  rejects a null status, so the **row is silently skipped**. (The code comment says "use the DB
  default", but that is never reached.)
- **Where**: `util/StructuralVariantUtil.java:124-127, 181-190`;
  `scripts/ImportStructuralVariantData.java:82-92`
- **Effect**: An SV file without an `SV_Status` column imports **zero** rows.
- Severity: **high**

### V2. Unknown sample: silent skip
- **What**: Unlike mutations and CNA, an unknown sample is just a warning and the row is skipped.
- **Where**: `scripts/ImportStructuralVariantData.java:94-102`
- Severity: **med**

### V3. Gene requirement and resolution
- **What**: At least one of the 4 gene fields must be present, and at least one site gene must
  resolve, otherwise the row is dropped. Entrez is used first, then the non-ambiguous Hugo/alias.
  Unknown Entrez is nulled. The resolved entrez is written back. A site whose gene does not resolve
  is stored with a NULL entrez.
- **Where**: `scripts/ImportStructuralVariantData.java:109-151, 185-199`
- Severity: **med**

### V4. In-file de-dup and numeric defaults
- **What**: The de-dup key is sample + site1(entrez, chr, pos, region_number, transcript) +
  site2(same) + event_info. Later duplicates are dropped. Integer fields (positions, region numbers,
  read counts, length) that are missing, empty or NA become **-1**, not NULL. Empty strings become
  `"NA"`. Only samples with at least one stored SV go into sample_profile.
- **Where**: `scripts/ImportStructuralVariantData.java:153-170, 179, 201-214`;
  `util/StructuralVariantUtil.java:62-104`; maf jar `getPartInt`/`getPartString`
- Severity: **med**

---

## P. Gene panels, sample-to-panel mapping, profiled samples

### P1. Who counts as "profiled" (sample_profile rows)
- **Mutations**: only samples with at least one **accepted** mutation (`internalSampleIds` is filled
  after the filter), plus every ID in `#sequenced_samples:` header lines (an unknown ID there throws).
  A sample whose only mutations were filtered (for example, all Silent) is **not profiled** unless it
  appears in the header or the matrix. (`scripts/ImportExtendedMutationData.java:404-441, 567-595`)
- **Tab-delimited**: all non-normal header samples. (`scripts/ImportTabDelimData.java:342`)
- **Long CNA**: the samples present in the file. (`scripts/ImportCnaDiscreteLongData.java:120-124`)
- **SV**: only samples with at least one stored SV. (`scripts/ImportStructuralVariantData.java:170, 179`)
- **Patient-level generic assay**: all samples of each listed patient. (`scripts/ImportGenericAssayPatientLevelData.java:122-137`)
- Panel = the meta file `gene_panel` (resolved to an internal ID; unknown throws) or **NULL**.
- Severity: **high**

### P2. Gene panel matrix overrides and adds
- **What**: For each matrix cell, `NA` (exact, case-sensitive) is **skipped**: no row is added, but an
  existing data-derived row is kept. `WXS`, `WGS` and `WXS/WGS` give panel NULL. Any other value is
  looked up as a panel stable ID (unknown throws). Rows are upserted into the ReplacingMergeTree
  `sample_profile` keyed on (sample_id, genetic_profile_id), so the matrix **overrides** the panel and
  **adds** samples that have no data. The column profile IDs get the study prefix if they don't start
  with the study ID. A sample ID missing from the DB causes an NPE.
- **Where**: `scripts/ImportGenePanelProfileMap.java:101-170, 197-211`;
  `dao/DaoSampleProfile.java` (upsert)
- **Effect**: A sample with no mutations but `mutations=IMPACT468` in the matrix is profiled on
  IMPACT468 and gets `MUTATION_COUNT=0` (M10).
- Severity: **high**

### P3. Default when a sample has no panel entry
- **What**: There is no matrix row and no meta `gene_panel`, so `panel_id IS NULL`, which downstream
  means "whole exome/genome".
- **Where**: `dao/DaoSampleProfile.java` (`panelId != null ? ... : null`)
- Severity: **high**

### P4. Python import order matters (cross-ref)
- **What**: The matrix is imported after all profiles, and MUTATION_COUNT is recomputed then. Case
  lists and `_all` come last.
- **Where**: `scripts/importer/cbioportalImporter.py:400-471` (Python, read for context only)
- Severity: **med**

### P5. Gene panel definition import
- **What**: Gene panels are **global** (not per study). A panel whose stable ID is already used by any
  `sample_profile` is not re-imported (warning only), so the old gene list is kept. If any gene in
  `gene_list` is unresolved or duplicated (final set size != list size), the panel is **not imported**
  (warning only), and the later matrix import throws. An ambiguous alias takes the first match.
- **Where**: `scripts/ImportGenePanel.java:64-92`; `util/GenePanelUtil.java:52-97`
- Severity: **med**

---

## L. Case lists

### L1. Case list file import
- **What**: `case_list_ids` is split on **tabs only**. Each ID goes through `StableIdUtil.getSampleId`.
  An unknown sample ID is **silently dropped**, unless it matches a **patient** ID, in which case *all
  of that patient's samples* are added. Duplicates are removed (first occurrence order kept). An empty
  `case_list_category` becomes `other`. An existing stable ID throws. The case list stable ID is **not**
  study-prefixed (unlike profiles).
- **Where**: `scripts/ImportSampleList.java:32-99`; `util/CaseListReader.java:12-32`
- **Effect**: A case list containing `P-001` (a patient) expands to `P-001-T01, P-001-T02`.
- Severity: **med**

### L2. Auto-generated lists
- **What**: Java only generates `<study>_all` (name and description "All cases in study", category
  `other`), containing *all samples in the DB for the study* at the end of the import. That includes
  samples created implicitly (C5, R1). An existing `_all` is kept. `_sequenced`, `_cna` and `_cnaseq`
  are **not** generated in Java: only validated in Python, so they must come from files.
- **Where**: `scripts/AddCaseList.java:32-92`;
  `scripts/importer/cbioportalImporter.py:470-471`
- Severity: **med**

---

## A. Generic assay

### A1. Entities are global; properties are first-writer-wins
- **What**: Entities are keyed globally by `ENTITY_STABLE_ID`. If the entity already exists from any
  study, its properties are **not updated** unless `--update-info`. A duplicate stable ID within a new
  file creates 2 entities, because the map isn't refreshed. A later `toMap` over all entities would
  then throw on the duplicate key.
- **Where**: `scripts/ImportGenericAssayEntity.java:151-202`;
  `scripts/GenericAssayMetaUtils.java:12-21`
- Severity: **med**

### A2. Patient-level data is copied to samples
- **What**: Each patient's value is copied to **every** sample of that patient. Patients with zero
  samples contribute nothing, and unknown patients throw. The patient columns start at the first
  non-feature header **with index >= 2**, so a file with only `ENTITY_STABLE_ID` and no NAME or other
  property column **silently loses its first patient column**. *Inferred from code; check real files.*
- **Where**: `scripts/ImportGenericAssayPatientLevelData.java:122-137, 205-216, 276-306`
- Severity: **med**

### A3. Sample-level data
- Goes through `ImportTabDelimData` (T1, T2, T8): values are stored raw, the first entity row wins, and
  an unknown entity row is skipped with a warning (`scripts/ImportTabDelimData.java:717-730`).
- Severity: **low**

---

## X. GISTIC, MutSig, timeline, resources, study

### X1. GISTIC
- **What**: chromosome `X` becomes 23 and `Y` becomes 24, stored as an int. Anything above 24 or
  non-numeric throws. `amp == 1` gives true, and anything else gives false. q_value is a float.
  `genes_in_region` has `[` and `]` removed, is split on `,` (no trim), and takes the text before `|`.
  Unknown or ambiguous genes are dropped, as are miRNA genes and duplicate genes. A region with no
  remaining genes is **dropped**.
- **Where**: `util/GisticReader.java:127-191`; `scripts/ValidationUtils.java:30-40`
- Severity: **med**

### X2. MutSig
- **What**: Rows with **q >= 0.1 are dropped**. `<` is stripped from p and q. If there is no `rank`
  column, rank is the file line counter, incremented *before* the q filter, so ranks have gaps.
  `N`/`Nnon` and `n`/`nnon` are accepted as column aliases. Unresolved genes are dropped.
- **Where**: `util/MutSigReader.java:56-155`
- Severity: **med**

### X3. Timeline
- **What**:
  - Each line is `trim()`ed, then split on tab without -1, so trailing empty fields vanish.
  - A line with more fields than the header is skipped.
  - An unknown patient is **silently skipped**. Patients are not created, and there is no TCGA ID
    rewriting.
  - START_DATE and STOP_DATE are parsed with `Long.valueOf`, so a decimal throws. An empty STOP_DATE
    becomes NULL.
  - Event attributes with empty values are **not stored**. `NA` is stored. Keys are the header names
    as written.
- **Where**: `scripts/ImportTimelineData.java:55-90`
- Severity: **med**

### X4. Resources
- **What**: Sample resource rows can **create patients and samples** (with the same SAMPLE_TYPE and
  normal rules as C5). A resource with RESOURCE_ID or URL in the NA-like set (`util/MissingValues.java`,
  same rules as C1) is skipped. Optional DISPLAY_NAME and METADATA values that are NA-like become NULL.
- **Where**: `scripts/ImportResourceData.java:195-345, 384-390`
- Severity: **med** (implicit samples feed `_all`)

### X5. Study, profile and cancer-type metadata
- `type_of_cancer` is **lowercased**. `groups` is uppercased and split on `;`. A missing
  `reference_genome` defaults to `hg19` (from portal.properties `ucsc.build`). `study_access` defaults
  to public. (`util/CancerStudyReader.java:78-93`)
- The profile `stable_id` gets the prefix `<study>_` if missing. A missing profile_name or
  description defaults to the alteration type. Tabs in the description become spaces. A missing
  datatype becomes `""`. GSVA P-VALUE profiles get `show_profile_in_analysis_tab=false`. Z-SCORE and
  GSVA profiles create `genetic_profile_link` rows. (`util/GeneticProfileReader.java:82-306`)
- Cancer-type IDs and parent IDs are lowercased, and short_name keeps the original case.
  (`scripts/ImportTypesOfCancers.java:60-77`)
- Severity: **low**

### X6. Bulk-loader escaping
- **What**: Any field whose value is exactly `\N` is written as NULL. Tabs and newlines are escaped.
- **Where**: `dao/ClickHouseBulkLoader.java` (`escapeTsvValue`)
- Severity: **low**

---

## Reference-genome and coordinate summary

- MAF `NCBI_Build` mismatch with the study genome only logs a warning, and the value is stored as
  given (`ImportExtendedMutationData.java:168-170`).
- Mutation chr: chr prefix stripped, X→23, Y→24, `M`/`chrM` and other contigs dropped (M5). Start/end
  NA becomes 0, and insertion end = start+1 (M6).
- Segment chr: stored raw, but must be 1-24, X or Y (`chr` prefix throws) (S1). GISTIC chr is an int
  with X=23 and Y=24 (X1). SV chromosomes are stored raw, with no normalization (V4).
- No liftover or coordinate conversion anywhere in the Java importer.

## Uncertain / to confirm against a legacy DB
- M10: whether samples with zero mutations get MUTATION_COUNT `0` (ClickHouse LEFT JOIN with
  Nullable columns, and multi-argument count-distinct NULL handling), and how often real studies
  hit the cross-profile join.
- A2: whether any datahub patient-level generic assay file lacks a property column (which triggers the
  dropped first patient column).
- C3: the no-metadata-header clinical path (legacy format) is inferred from code, not observed.
