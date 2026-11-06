# Legacy importer audit — consolidated

> Kept in the repo as the spec the importer tests (`test/importer-*.test.ts`) are written from.

Read-only audit of `ref/cbioportal-core` (Java importer, Python pipeline) and `ref/cbioportal`
(ClickHouse derived-table SQL), 2026-10-27. Detail, with file:line for every item:

- `legacy-java-importer.md` — per data type; the authoritative source on what is stored
- `legacy-python-pipeline.md` — orchestration, meta defaults, OncoKB, validation vs load
- `legacy-clickhouse-derived.md` — every derived table, column by column

## Design rule that falls out of it

The canonical layer stores the files losslessly; **every legacy transform is a named, tested rule
in the derived layer**, never in the importer. Then the round-trip test stays meaningful, and
each rule can be replicated, fixed or dropped independently.

## A. Replicate (users depend on these semantics)

1. Mutation filter: drop Silent/Intron/3'UTR/3'Flank/5'UTR/IGR/RNA (case-insensitive prefix),
   keep 5'Flank only for TERT (as Promoter); drop status None/LOH/Wildtype/Redacted;
   meta `variant_classification_filter` replaces the list (exact match).
2. Profiled samples: mutations = samples with >=1 accepted mutation or `#sequenced_samples` or
   `_sequenced` case list; CNA/expression = every header sample; SV = samples with a stored SV;
   gene panel matrix overrides; `WXS`/`WGS`/no panel = whole genome.
3. CNA events only for exact "2"/"-2" (and "-1.5" → -2 event; raw keeps -1.5); only discrete
   profiles shown in the analysis tab.
4. Gene resolution (MAF and matrix rules differ — see Java notes §genes); depends on the global
   gene/alias/reference_genome_gene tables → these become a **versioned reference input**.
5. Mutation de-dup on gene/chr/start/end/protein/allele/type.
6. Protein change fallback HGVSp_Short → Amino_Acid_Change → "MUTATED"; insertion end = start+1.
7. Clinical NA tokens not stored; OS_STATUS/DFS_STATUS get "1:"/"0:" prefix.
8. Computed attributes: MUTATION_COUNT, FRACTION_GENOME_ALTERED (|seg_mean| >= 0.2, 4 dp),
   SAMPLE_COUNT.
9. Driver annotation: `cbp_driver*` columns written into the files by the OncoKB step; absent
   unless run → our annotation stage must reproduce the four columns.
10. SV rows: once per distinct partner gene; dropped when neither side has a known gene.
11. Only `<study>_all` is generated (if `add_global_case_list`); others come from files.

## B. Legacy bugs — do NOT replicate; record as allowlisted parity diffs

- `sample_derived.sequenced` joins on bare sample id across studies (cross-study leak).
- MUTATION_COUNT joins on sample only → counts other mutation profiles of the same sample;
  possible 0 rows for profiled samples with none.
- 'WES' panel = every gene in the global gene table; `off_panel` matched by symbol not Entrez.
- Mutation events shared across studies (first study wins).
- Meta files read as Latin-1 by Java (garbles non-ASCII); only the last of duplicate
  SV/CNA_long/panel-matrix/GSVA meta files loads; OncoKB backup meta files get picked up.
- Inconsistent missing-value encodings per derived table ('' vs NULL vs 0; 'NA' kept in
  generic assay, dropped in genetic_alteration_derived).

## C. Checked against the public ClickHouse DB (2026-10-27)

- **MUTATION_COUNT for sequenced samples with no mutations is inconsistent.** Of 52,791 such
  samples, 6,101 have `"0"` (44 studies, all-or-nothing per study) and 46,690 have no row
  (222 studies); 2 studies are mixed. Import dates overlap, so it's not simply old vs new loader.
  The current `DaoMutation.createMutationCountClinicalData` LEFT JOIN writes `0`. → New importer
  writes 0 everywhere; allowlist the missing-row diff.
- **The cross-profile MUTATION_COUNT join doesn't happen in practice:** no study has >1
  MUTATION_EXTENDED profile; the one MUTATION_UNCALLED study (glioma_msk_2018) has stored counts
  matching extended-only for all 89 samples (58 would differ if uncalled were counted).
  → Count the extended profile only.
- **Patient-level generic assay first-column drop never triggers:** the only patient-level
  profile (pog570_bcgsc_2020 immune signatures) has a NAME column. Handle correctly; no parity impact.
- **Headerless clinical files:** of 904 datahub `data_clinical*` files fetched (17 more are LFS
  objects the media endpoint wouldn't serve), only `blca_msk_tcga_2020/data_clinical_supp_hypoxia.txt`
  lacks the `#` header, and it has no meta file. Yet the DB has its three attributes with proper
  display names ("Buffa Hypoxia Score", NUMBER, patient). So the public DB was loaded with
  something not visible in datahub master (an older meta file, or attribute metadata from
  elsewhere). No `MISSING` display names exist anywhere in the DB.
