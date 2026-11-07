# The `sv` view

cBioPortal's Results View **Structural Variants** tab as a table view (runner `run.ts`): every
structural variant in the cohort's samples with one of `genes` as gene 1 **or** gene 2, one row per
call, with the portal's columns. The row source is **`lib/sv-table.ts`** (beside the mutation table:
its rows name samples, so it is not an aggregate builder and runs only through
`PatientLevelResolver.rows*`); `lib/table-query.ts` does search, filters, sort, pages and the CSV.

What it took from the portal (`src/pages/resultsView/structuralVariant/`, the shared
`StructuralVariantTable`, `ResultsViewPageStore.structuralVariants`):

- **Which calls.** The study's structural-variant profile, the queried samples, matched by Entrez id
  on either partner (`fetchStructuralVariantsUsingPOST`'s `entrezGeneIds`). A call between two
  queried genes is one row here; the portal's per-gene sub-tabs list it under each gene, which the
  Results page reproduces by showing one gene at a time (`genes: [g]`, the tab's gene chips).
- **One row per call.** Not merged across a patient's samples (the portal says "includes N duplicate
  structural variants in patients with multiple samples"; so does this table, a row each).
- **Columns and defaults.** The portal's names and order; shown by default Sample ID, Cancer Type
  Detailed, Gene 1, Gene 2, Annotation, Connection Type, Event Info, Variant Class. Left out: the two
  Exon/Intron columns (computed from Genome Nexus transcripts) and Center (not stored). Values are as
  stored, the portal's `NA` and `-1` included.
- **Gene 1 / gene 2** are site 1 / site 2 as the study recorded them, never reordered (the Study View
  gene-pair table's orientation semantics).
- **The tab is shown** only when the queried patients carry at least one call
  (`hide: structuralVariants.result.length === 0`). The Results page asks this as a third cohort
  (`svCheckCohort`, OQL `<gene>: FUSION` per gene) on the header's existing count request, not as a
  request of its own; until it answers the page is laid out `partial`.

Where it differs:

- **Annotation.** The portal annotates each call by its gene pair through OncoKB's
  structural-variant endpoint. This app reads the version-pinned store, which keys structural
  variants by gene with alteration `Fusion` (the same entry the OQL `DRIVER` join reads); the column
  shows the stronger of the two partners' calls, and the caveat says so. (At the time of writing the
  public store holds no `SV` rows, so the column is blank there.)
- **Panel-aware counts.** The portal shows none. `sql.ts`'s `svProfiledSql` counts, per gene, the
  cohort's samples, those whose structural-variant panel lists the gene (or is whole-exome), those
  with a call, and of those the profiled — a panel that omits a gene still reports a fusion through
  its partner (EML4 on MSK-IMPACT), which the caveat names.
