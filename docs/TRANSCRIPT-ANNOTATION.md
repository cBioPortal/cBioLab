# Transcript annotation — a stored table, not a live lookup (proposal)

Not built. This records how cBioLab would offer the lollipop's transcript drop-down
(`docs/PORTAL-PARITY.md`, the Comparison → Mutations items) without annotating mutations live,
so the work can be picked up later. Written November 2026.

## Today

- A mutation row's protein change and position are the study file's, on the canonical
  transcript. The row also keeps its genomic coordinates (`chr`, `start_position`,
  `end_position`, `reference_allele`, `tumor_seq_allele`).
- The lollipop asks Genome Nexus, live, for the gene's canonical transcript (MSKCC isoform
  overrides) and that protein's Pfam domains (`lib/lollipop.ts`, two calls, cached).
- The transcript drop-down (`app/_lollipop/TranscriptSummary.tsx`) lists the canonical transcript
  alone and its tooltip says why.
- cBioPortal fills the drop-down from Genome Nexus and, when another transcript is picked,
  re-annotates every mutation's coordinates on it in the browser, live.

## The goal: no live annotation

cBioLab already does this for OncoKB. `cBioPortal/oncokb-annotation-pipeline` writes
`oncokb_annotation.variant_annotation` (7.06M rows in November 2026, versioned, with a
`sync_run` log). The app only reads it and echoes the version it read (invariant 2). Transcripts
would follow the same pattern.

## What would be stored

1. **Each variant on every protein-coding transcript of its gene**, e.g.
   `transcript_annotation.variant_consequence`. Keyed by variant (`chr`, start, end, ref, alt)
   and transcript, holding the protein change, protein start/end, consequence, and HGVSp. No
   sample or patient ids, so the table is not patient-level data (`docs/DATA-BOUNDARY.md`).
   Sorted by transcript (or gene) first, so one gene on one transcript is a range read, not a
   scan.
2. **The gene's transcripts.** For each: Ensembl id with version, RefSeq, CCDS, UniProt,
   protein length, Pfam domains, and a canonical flag with the MSKCC overrides. This also
   replaces the lollipop's two live Genome Nexus calls.
3. **The version**: the Genome Nexus / VEP release and the Ensembl release that produced the
   two tables. It is echoed in results beside the OncoKB pin.

## The pipeline

- Run Genome Nexus, or VEP with an offline cache (what Genome Nexus wraps), over the
  warehouse's distinct variants. Write the two tables. Later runs annotate only variants not
  yet in the table.
- Do not use the public genomenexus.org for the bulk run. A self-run instance is faster and
  reproducible, and is required for internal data.
- Size, public warehouse (November 2026): 9.22M mutation rows, 9.09M distinct variants, 23,826
  genes. At a few protein-coding transcripts per variant this is tens of millions of rows. The
  first run takes hours; later runs are small.
- Where it lives (a new repo, or beside the OncoKB pipeline) is still to decide.

## In cBioLab

- A `transcript` setting on the lollipop views (`hotspots`, `mutcompare`). It goes in the
  document, because it changes what a reader sees (invariant 9).
- Off the canonical transcript, positions and protein changes come from the stored table and
  the domains from the stored transcript. OncoKB and hotspot calls are off, since they are
  defined on the canonical protein only, so every mutation reads as VUS, as on the portal.
- A study whose variants are not annotated yet (e.g. one just imported locally) is refused in
  words, never silently drawn on the canonical transcript (invariant 1). The local importer can
  later run the same step on import.
- Order of work:
  1. The pipeline and its tables.
  2. The lollipop reads its transcript info from the tables instead of Genome Nexus (nothing
     visible changes).
  3. The drop-down on both lollipop tabs.

Cancer Hotspots, which the portal counts as putative drivers by default, could be loaded the
same way: it is a fixed public list, so it is one small table.

## Internal MSK-IMPACT

Its mutation table is much larger than the public warehouse's. Its size has not been measured
here. To measure it, run:
`SELECT count(), uniqExact(chr, start_position, end_position, reference_allele, tumor_seq_allele) FROM mutation_event`.

- **Cost follows distinct variants, not rows.** A recurrent variant is annotated once. IMPACT
  is a panel of about 500 genes, so the transcript table stays small, each variant has only its
  gene's few transcripts, and distinct variants grow much more slowly than rows.
- **Incremental.** IMPACT grows daily; each sync annotates only its new variants.
- **Runs inside MSK.** Internal variants never go to a public service. MSK's import may already
  run MAFs through Genome Nexus (`genome-nexus-annotation-pipeline`), keeping only the
  canonical transcript; keeping its per-transcript output may be the cheapest start (not
  checked).
- **Panel coverage.** IMPACT baits the canonical transcript's exons. An alternative
  transcript's own exons were not sequenced, so the view must say so for those regions, as it
  does for "not profiled", rather than imply they are wild-type.
- **The boundary.** The variant table carries no ids, so one copy could serve several instances,
  unless an internal-only variant is itself sensitive. That is a decision for the data owners.
