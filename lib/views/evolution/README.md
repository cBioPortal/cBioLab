# The `evolution` view

cBioPortal's patient-view **Genomic Evolution** tab (runner `run.ts`, queries `sql.ts`, figure
`figure.ts`): one patient's mutations followed across all of their samples. Ported from
cbioportal-frontend's `PatientViewMutationsTab.tsx`, `timeline/VAFChartUtils.ts` (`computeRenderData`),
`mutation/oncoprint/MutationOncoprintUtils.ts` (`makeMutationHeatmapData`) and `SampleManager.tsx`.

**Each mutation in each sample** has one of five states (`EvolutionStatus`): called with a VAF,
called without allele counts, uncalled with variant reads (the study's `_mutations_uncalled`
profile — the portal draws it with its VAF), not found in a sample sequenced for the gene (VAF 0, as
the portal draws `PROFILED_BUT_NOT_MUTATED`), and not profiled — the sample's mutation panel
(`sample_to_gene_panel_derived`, `MUTATION_EXTENDED`) omits the gene, or the sample has no mutation
panel at all. Not profiled is never 0: the line is dashed across it, the heatmap cell is the
oncoprint's not-profiled glyph.

**What is drawn** is every mutation the mutation table's query (`mutations`) keeps that was called
with a VAF in some sample — so "only show selected mutations" is a filter on the table, held in the
spec. Lines run from the first to the last sample with variant reads, as the portal trims them.
Display settings that change the picture (`chart`, `sequential`, `logScale`, `dataRange`) are in the
spec (invariant 9).

**Samples** are ordered and numbered by `sampleMarks` (`lib/timeline-tracks.ts`, the timeline's
markers) and placed by `sampleDays` — the earliest sample event naming each one; a patient with any
sample lacking a day is drawn in sequence, as the portal forces sequential mode, and the result
says so (`noDay`).

**The patient list** holds only the cohort's patients the view can draw — two or more samples and a
called mutation with allele counts, the portal's condition for showing the tab. A named patient
that fails it is refused with the reason. Only local patient-level participants answer (`need:
"patients"`); no peer serves this view's rows.
