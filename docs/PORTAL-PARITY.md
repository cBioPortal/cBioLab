# Portal parity — what cBioLab still lacks from cBioPortal

The working list of gaps between cBioLab and cBioPortal (www.cbioportal.org, the
`cbioportal-frontend` code and the configuration docs on docs.cbioportal.org), from a survey taken
in November 2026. It is ordered by how often a cBioPortal user would hit each gap and by whether
the data is already in the warehouse.

**How to keep it current.**
- A PR that closes an item ticks it (`- [x]`) and adds its PR number, in the same change.
- A PR that closes only part of an item names what it did and leaves the rest as a sub-item, unticked.
- An open PR is noted as `(PR #n open)` until it merges.
- A gap found later is added under its band.
- An item decided against is struck through (`~~…~~`) with the reason, never deleted.

**What parity means here.** Each tab is checked against the legacy code, not only against its numbers:
- every click, hover, tooltip, control, colour and label detail is reproduced;
- or the PR body says which ones are left out and why;
- cBioLab's invariants (CLAUDE.md) win where they conflict with legacy behaviour, and the PR says so.

The legacy behaviour to check against is written up per tab in [`legacy-spec/`](legacy-spec/)
(Results, Study, Patient and Comparison pages; index in [`legacy-spec/README.md`](legacy-spec/README.md)). Each requirement has an ID (`ONC-SO-3`); a parity
PR cites the IDs it covers and the ones it leaves out. The per-ID scorecards of cBioLab against
that spec are in [`legacy-spec/parity/`](legacy-spec/parity/) (audit of 2026-11-11), with the index
in [`legacy-spec/parity/README.md`](legacy-spec/parity/README.md).

A session building parity work follows [`PARITY-BUILD.md`](PARITY-BUILD.md).

Every portal page also has an "Open in cBioPortal" button (`lib/legacy-link.ts`). A new tab adds its
title there. On the Comparison page the button saves the page's groups to cbioportal.org's session
service and opens that comparison (`lib/legacy-comparison.ts`; a new comparison tab adds its title there).

## cBioLab bugs found by the parity audit

Wrong on cBioLab's own terms, whatever the portal does. Each is from a scorecard's bug section.

- [x] OncoPrint: a clustered sort (`cluster:` key) is silently dropped on any track edit (`pruneSort`, `app/_oncoprint/OncoprintCard.tsx`) ([01-oncoprint](legacy-spec/parity/01-oncoprint.md)) (#187)
- [x] OncoPrint: "Remove track" is offered on a single gene and does nothing (`app/_oncoprint/OncoprintCard.tsx:81`) ([01-oncoprint](legacy-spec/parity/01-oncoprint.md)) (#187)
- [x] Cancer Types Summary says "samples" where the unit is patients: the results text (`lib/views/cancertypes/kind.ts:13-14`) and the card subtitle "% of profiled samples" (`app/lab/kinds/cancertypes.tsx:95`), though the default unit is patients (`run.ts:27`); the caption is right ([02-cancer-types-summary](legacy-spec/parity/02-cancer-types-summary.md)) (#183)
- [x] Cancer Types Summary: `types.ts:6-10` and the DSL summary (`doc.ts:9`) describe "% of samples" for a view that counts patients by default ([02-cancer-types-summary](legacy-spec/parity/02-cancer-types-summary.md)) (#183)
- [x] Cancer Types Summary: Absolute Counts is not "highest first" as the figure says (`figure.ts:22`): bars are always sorted by altered ÷ profiled (`lib/views/cancertypes/run.ts:47`) ([02-cancer-types-summary](legacy-spec/parity/02-cancer-types-summary.md)) (#183)
- [x] Mutual Exclusivity says "patients" where it counts samples: the note (`lib/views/cooccurrence/run.ts:74`), `doc.ts:7`, the method step (`method.ts:20`) and the `/lab` subtitle (`app/lab/kinds/cooccurrence.tsx:13`); `pairCountsSql` counts samples (`lib/federation.ts:396`). Q1 profiled 10,945 = the samples, not the 10,336 patients ([03-mutual-exclusivity](legacy-spec/parity/03-mutual-exclusivity.md)) (#183)
- [x] Mutual Exclusivity, several studies: the figure and `/lab` card draw log₂ of the MH OR (`figure.ts:12`, `cooccurrence.tsx:30`), the results text the pooled log₂ OR (`kind.ts:14`), and the method record describes only the pooled one (`method.ts:31`). Q4 TP53/KRAS: figure 0.055, text 1.049 ([03-mutual-exclusivity](legacy-spec/parity/03-mutual-exclusivity.md)) (#183)
- [x] Mutual Exclusivity: no tendency for a log₂ OR of exactly 0 or ±∞ (`lib/views/cooccurrence/run.ts:48`), so a pair with no association has no label ([03-mutual-exclusivity](legacy-spec/parity/03-mutual-exclusivity.md)) (#183)
- [x] Plots: Spearman ranks ties ordinally (`rankCorr`, `lib/plot.ts:516`), so ρ depends on row order (AGE × FGA −0.05476, true −0.05509); the method record does not say so (invariant 12) ([04-plots](legacy-spec/parity/04-plots.md)) (#183)
  - [ ] The plot view has no method record to say how ties are ranked (invariant 12)
- [x] Plots: the caption and comment call the whiskers "Tukey", "the furthest value inside 1.5 x IQR" (`lib/plot.ts:796`), but they end at the fence itself, where there may be no point (Q1 Shallow deletion: drawn to 178.98, lowest value inside 327.49). The portal's own rule, so the numbers agree; the words don't ([04-plots](legacy-spec/parity/04-plots.md)) (#183)
- [ ] Plots: a box for n = 1 is drawn as a flat box with a whisker ([04-plots](legacy-spec/parity/04-plots.md))
- [ ] Plots: Swap on a box plot with its categories on the vertical axis is not drawn; the sidebar says "Swap to make them agree" instead ([04-plots](legacy-spec/parity/04-plots.md))
- [ ] Mutations: a gene with no mutations (Q2 ERG) has no empty state: it is dropped from the result (`lib/views/hotspots/run.ts:28`), and the card shows only the method caption, `note` being always set (`app/_lollipop/HotspotsBody.tsx:87`) ([05-mutations](legacy-spec/parity/05-mutations.md))
- [ ] Mutations: the germline test is case-sensitive (`status != 'GERMLINE'`, `lib/federation.ts:566`), so a study's "Germline" calls count as somatic ([05-mutations](legacy-spec/parity/05-mutations.md))
- [ ] Mutations: the Ensembl link is always GRCh37 (`app/_lollipop/TranscriptSummary.tsx:25`), wrong for a GRCh38 study ([05-mutations](legacy-spec/parity/05-mutations.md))
- [ ] Mutations: the legend lists "Splice site" under Truncating, while splice stems are drawn orange as Splice (copied from the portal, MUT-LP-5) ([05-mutations](legacy-spec/parity/05-mutations.md))
- [x] CN Segments: `lib/views/segments/README.md` and the caption say rows are in the portal's API order; they are not (CNS-3.5) ([08-cn-segments](legacy-spec/parity/08-cn-segments.md)) (#183)
- [x] CN Segments, several studies: igv rows keyed by bare sample id (`lib/views/segments/igv.ts:18`) merge two studies' samples with the same id ([08-cn-segments](legacy-spec/parity/08-cn-segments.md)) (#183)
- [ ] Comparison, Include mode: a patient in two groups enters two survival curves, and the log-rank is run as if the groups were independent (G2 Male, Female, KRAS: p 0.910, 221 patients counted twice); the caveat says nothing ([20-comparison-core](legacy-spec/parity/20-comparison-core.md))
- [ ] Comparison → Clinical picks its 8 attributes by coverage: near-constant ones (SAMPLE_TYPE, CANCER_TYPE, SOMATIC_STATUS, SAMPLE_COUNT) fill the slots and the q-correction, and the attribute the groups were built from (SEX) is not tested ([20-comparison-core](legacy-spec/parity/20-comparison-core.md))
- [ ] Comparison → Survival: the KM axis ends at the last event (`lib/stats.ts:160-165`), so censored follow-up after it and its at-risk counts are never drawn (G1 OS to ~77 mo, data to 149) ([20-comparison-core](legacy-spec/parity/20-comparison-core.md))
- [ ] Comparison → Survival on a study without OS: the error says "pick one of those" endpoints, and the tab has no control to pick one ([20-comparison-core](legacy-spec/parity/20-comparison-core.md))
- [ ] Comparison → Genomic Alterations: the bar plot of "highest frequency in any group" ranks only the ≤300 most significant rows (`lib/views/enrichment/figure.ts:58`); G2 mutation leaves out MUC16 (12.3 % in Basal) and draws SYNE1 (9.4 %) ([21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
- [ ] Comparison → Protein is offered for five groups, then refuses because one group has no data (`lib/views/diffexpr/run.ts:79,97`), though four groups hold 9,719 genes ([21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
- [ ] Comparison → Genomic Alterations, SV: 41 genes tested by default (`minAltered: 5`), and PUM1 is called significant (q 0.0425); with every altered gene tested it is not (q 0.533). A display threshold changes the q-values (CMM-STM-7) ([21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
- [x] Study View: two bars of one histogram AND to nothing: a second range on the same attribute is pushed as another clause (`app/lab/use-explore-state.ts:471`); AGE (50,60] then (70,75] gives "0 patients match". Derived buckets already OR (`:451-465`) (STS-BAR-5) ([30-study-summary](legacy-spec/parity/30-study-summary.md)) (#188)
- [x] Study View: clicking a selected pie value again re-adds it (`SEX = Female` becomes `SEX ∈ {Female}`); only the pill's × removes it ([30-study-summary](legacy-spec/parity/30-study-summary.md)) (#188)
- [x] Study View: a numeric chart under its own filter collapses (AGE (50,60] redraws AGE as ten one-value bars), so other ranges can't be added (`draftedClinical` skips NUMBER, `lib/explore.ts:268`) ([30-study-summary](legacy-spec/parity/30-study-summary.md)) (#188)
- [x] Study View: the default charts include constant attributes (Cancer Type, Sample Type, Somatic Status, Samples per Patient; DAYS_TO_INITIAL_PATHOLOGIC_DIAGNOSIS, all 0, draws no bars) and leave out Sex, Race and Subtype ([30-study-summary](legacy-spec/parity/30-study-summary.md)) (#188)
- [x] Study View: the filters can't be shared or restored: Copy link drops them and a reload loses them, though the page keeps the rest of its state in the URL (`?study=`, `?drivers=`) ([31-study-view-shell](legacy-spec/parity/31-study-view-shell.md)) (#189)
- [x] Patient: Allele Freq is rounded twice, to 3 decimals (`lib/views/alterations/run.ts:32`), then `toFixed(2)` (`app/lab/alterations-body.tsx:102`): 10/57 = 0.1754 shows "0.17". 5 of 64 rows wrong on TCGA-A6-2671 ([40-patient-summary](legacy-spec/parity/40-patient-summary.md)) (#183)
- [x] Patient: an unknown patient (`?caseId=NOPE`) prints "no patient NOPE in lgg_ucsf_2014", then lays out every tab, each refusing on an empty cohort ([40-patient-summary](legacy-spec/parity/40-patient-summary.md)) (#183)
- [x] Patient: Genomic Evolution is offered to single-sample patients, then refuses (TCGA-A6-2671, msk P-0000004); `app/portal/patient-layout.ts:57` does not check for two samples with allele counts ([40-patient-summary](legacy-spec/parity/40-patient-summary.md), [41-patient-tabs](legacy-spec/parity/41-patient-tabs.md)) (#183)
  - [ ] Also hidden when no mutation has VAF > 0 (PTB-MD-3)

## High — daily-use features, data already loaded

- [x] **Results → Download tab** — the `datafiles` view: per-profile files, altered/unaltered case lists that open as cohorts, the alteration-frequency table (#157)
  - [ ] Tab-delimited and transposed downloads (CSV only today)
  - [ ] A deployment switch to hide every download control (see *Data-governance switches*)
  - [ ] Percent altered as the portal's: an integer from 3 % ("37%"; ours "37.4%"), a frequency bar, the `percentAltered` string in the download (RDL-2.4, RDL-2.5, RDL-STM-2) ([10-results-download](legacy-spec/parity/10-results-download.md))
  - [ ] The gene frequency table's sort, paging, filter and column menu (RDL-2.1, RDL-2.6) ([10-results-download](legacy-spec/parity/10-results-download.md))
  - [ ] The case table: "(Driver)" and the Germline badge in cells ("G12D(Driver)"; ours "G12D"), a Study ID column with links, Altered as 1/0, 20 rows a page (ours 25), the hidden per-alteration columns (`KRAS: MUT`, `KRAS: AMP`) (RDL-3.1, RDL-3.3, RDL-3.4, RDL-3.5) ([10-results-download](legacy-spec/parity/10-results-download.md))
  - [ ] Query and Virtual Study actions on the altered and unaltered lists ("Open as cohort" stands in) (RDL-1.6, RDL-1.7, RDL-1.13) ([10-results-download](legacy-spec/parity/10-results-download.md))
  - [ ] Generic-assay rows for tracks added on the oncoprint; the view's README calls their absence deliberate (RDL-1.10, RDL-STM-6, RDL-MD-4) ([10-results-download](legacy-spec/parity/10-results-download.md))
- [x] **Results → Structural Variants tab** — the `sv` table view (#154)
  - [ ] The Annotation column: our OncoKB store has no structural-variant entries
  - [ ] Default sort Annotation ↓ (TMPRSS2-BRAF first; ours "drivers, then gene 1, gene 2", AFF3-TMPRSS2 first) (SV-TB-4, SV-STM-3) ([06-structural-variants](legacy-spec/parity/06-structural-variants.md))
  - [ ] The "includes 2 duplicate structural variants in patients with multiple samples" suffix (SV-TB-1, SV-MD-7, SV-STM-1) ([06-structural-variants](legacy-spec/parity/06-structural-variants.md))
  - [ ] The experimental-feature alert and the "Beta!" label (SV-1, SV-5) ([06-structural-variants](legacy-spec/parity/06-structural-variants.md))
  - [ ] Site1 / Site2 Exon and Intron columns, from Genome Nexus transcripts (SV-COL-6, SV-COL-10, SV-STM-2) ([06-structural-variants](legacy-spec/parity/06-structural-variants.md))
  - [ ] The gene chip shared with the Mutations tab (`mutations_gene`; ours kept per tab) (SV-4) ([06-structural-variants](legacy-spec/parity/06-structural-variants.md))
  - [ ] Table chrome: a plain column checklist and no header filters (ours a Columns menu with count/find/default and a filter on every header), Show more not a numbered pager, Copy, the download of every row (ours CSV of the kept rows) (SV-TB-2, SV-TB-3, SV-TB-6) ([06-structural-variants](legacy-spec/parity/06-structural-variants.md))
- [x] **Patient → Genomic Evolution** — the `evolution` view: VAF per mutation across samples, line chart, heatmap, table (#153)
  - [ ] Heatmap: samples as the default rows (ours mutations, fixed), the portal's ramp `rgb(241,242,181)`→`rgb(19,80,88)` (ours the oncoprint blue), Cluster, Transpose, the labels toggle, zoom, SVG/PNG/Data download (PTB-HM-1…4, PTB-STM-3) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
  - [ ] Line chart: Group by, Show/Hide Timeline, "Show only selected mutations" (ours: the table's filter decides what is drawn); the portal's axis titles (PTB-LC-1…5) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
  - [ ] Table: Annotation, Allele Freq bars and Cohort columns; the portal's page size (ours 25) (PTB-TB-1) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
  - [ ] The unprofiled-sample alert, here and on Patient → Pathways (ours draws not-profiled cells dashed or NA) (PTB-GE-3, PTB-PW-1, PTB-MD-5) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
- [x] **Patient → Mutational Signatures** — the `signatures` view: contributions per sample, the spectrum with the portal's toolbar, and the COSMIC v3.3 reference under a clicked row (#156)
  - [ ] The patient header's significant-signatures badge (no warehouse study has a p-value profile yet, so it would show nothing today)
  - [ ] The signature table's download (the portal's table exports; ours is client-side `PortalTable` with no CSV)
  - [ ] A browser check: the kind is still `e2ePending`
  - [ ] The signature table unpaged (ours 25 of 65 rows), spectrum % rounded (PTB-MS-7, PTB-STM-6) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
- [x] **Comparison → mRNA, Protein and DNA methylation tabs** — `diffexpr` laid out as the portal's tab: volcano and the clicked gene's box plot per group (a `plot` by cohort), then the gene table with the "High expression/methylation in" filter and "Significant only"; profiles picked as the portal picks them, 2 groups (PR #159)
  - [x] More than 2 groups: 3 to 10 compared by one-way ANOVA (p-values checked against cbioportal.org's), the table a mean and SD per group, no volcano, as the portal's
    - [x] Where there is no volcano, the box plot's place before a gene is clicked is one line saying to click a gene (expression and generic-assay tabs alike); the portal leaves an empty 360px box there
  - [x] Per-probe methylation (generic assay) as in the PanCancer Atlas studies: its own Methylation tab, as the portal's, the `assays` view on the merged profile (the 22,601 probes the 27k and 450k arrays share), each probe by its genes and id
    - [ ] The full 450k profile (~396,000 probes) is refused: one cohort's answer is a row per probe, past what one request holds (it ran the dev server out of memory, past the 60 s limit); the portal compares it
    - [x] Laid out as the portal's generic-assay tab, as every numeric generic-assay tab now is: volcano (two groups), the picked entity's box plot, the table with the portal's columns and tips; tested as the portal tests them (Welch's t for two groups, the classic one-way ANOVA past two, checked against cbioportal.org's)
    - [ ] Categorical generic assays (arm-level copy number) keep our table and the picked entity's mix of values; the portal has a separate categorical tab
      - [ ] NA counted as a category, as the portal does; ours leaves it out, so p differs widely (1q 0.211 vs the portal's 5.9e-15; 7q 0.155 vs 0) (CMM-GC, CMM-STM-6) ([21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
  - [ ] The table lists the 1,500 most significant genes; the portal lists every gene tested (the rest are on the volcano as density, not as points)
  - [ ] The Data Set picker's ⓘ profile description (the catalog carries no description)
  - [ ] Downloads: the volcano's and box plot's SVG/PNG/data buttons, the table's copy and download
  - [ ] A group with no data refuses the whole tab (G5 Protein: "no gene had at least 3 samples with a protein_quantification value in every cohort"); the portal drops that group and tests the other 4 over 9,719 genes (CMM-MD-8, CMM-STM-4; see bugs) ([21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
- [x] **Comparison → Mutations tab** — the two-group lollipop: the `mutcompare` view, the first group above the protein and the second below (codon axis on top, Pfam domains between), the y-axis % / # switch, the gene picker with the portal's "Highest Frequency" genes (ranked as the portal ranks them, by the higher mutated share), each group's Driver/VUS badges, a click on a stem filtering the table, the gene's Fisher line, and the table of protein changes with each group's patients and share, log2 ratio, p, q and "Enriched in" (with its filter and "Significant only"); shown for exactly two groups when the study has mutations (#166)
  - [ ] The Top / Bottom Y-Axis Max sliders
  - [x] Beside the lollipop as the portal has it: each group's badge selector (the Results tab's, shared: Driver/VUS totals, clickable type names, "only"), its middle line on the protein's centre; the transcript and its ids; the Legend toggle and the SVG/PNG download (the last two on the Results tab's lollipop too)
  - [ ] The transcript drop-down offers only the canonical transcript: mutations are annotated on it alone, where the portal re-annotates them on a chosen one, live (Genome Nexus). The plan is a stored per-transcript table instead: [`TRANSCRIPT-ANNOTATION.md`](TRANSCRIPT-ANNOTATION.md)
  - [ ] The driver-settings menu (the sliders button above the badges: OncoKB, hotspots, custom drivers)
  - [ ] Cancer Hotspots as putative drivers: the portal's default counts a hotspot mutation as a driver, cBioLab only OncoKB (e.g. TP53 D208G, D281E in brca_tcga_pan_can_atlas_2018 Basal-like vs Luminal A). Results → Mutations too: TP53 Driver/VUS 325/7 vs the portal's 329/3 ([05-mutations](legacy-spec/parity/05-mutations.md))
  - [ ] The lollipop's tracks (Cancer Hotspots, OncoKB, PTM, exons, topology, PDB); the table's copy and download
  - [ ] The table's Co-occurrence Pattern column (a mini oncoprint of the groups' patients), and the Custom Driver, Custom Driver Tier and MS columns
  - [ ] Each group's badges filter that group alone; ours hide a class in both groups at once
  - [ ] The Fisher line for filtered or selected mutations (ours is for all of the gene's mutations)
  - [ ] A stem's tooltip counts distinct patients and shows the other group's stem at that codon too; ours counts the stem's patient + change pairs, its own group only
  - [ ] The gene picker's searchable dropdown of the 200 ranked genes (ours: a gene field and the ten pills; the result carries the 200)
  - [ ] The ranking honours the page's driver and event-type settings (ours counts every called mutation)
  - [ ] The overlap banner ("Samples (N) that overlap in the selected groups are excluded from sample-level analysis below.")
  - [ ] A browser check: the kind is still `e2ePending`
- [x] **Query-by-gene form controls** — the query dialog's "Select Genomic Profiles" (each kind's profiles as the study offers them, radios where it has several, each one's description on its ⓘ, the mRNA and protein z-score thresholds) and "Select Patient/Case Set" (the study's sample lists with their sizes, filtered as typed; several studies' mutation / copy-number categories; "User-defined Case List" by sample or patient id, refused in the portal's words when an id matches nothing), each changing the Results page's document: the profiles a bare gene's default alterations and the profile EXP / PROT read, the case set a clause every group keeps (#167)
  - [ ] GSVA gene sets: the warehouse holds no GSVA scores (no GENESET_SCORE profile in any study, and the gene-set hierarchy tables are empty), and the importer does not load them
  - [ ] The profile choice decides who is Altered (the header's count, Comparison/Survival, the Download tab's lists); the oncoprint and gene tabs still draw every alteration of the genes, where the portal leaves a deselected type's data out. The parity audit finds they ignore the query's OQL the same way, with no OQL banner: KRAS under `AMP MUT=G12D` is 37.4 % (222/594) on the oncoprint against the portal's 11 % (63/594), and 37.4 % against 10.6 % on Pathways; Cancer Types Summary, Mutual Exclusivity and Mutations likewise ([01-oncoprint](legacy-spec/parity/01-oncoprint.md), [09-pathways](legacy-spec/parity/09-pathways.md))
  - [ ] One of several mutation, structural-variant or copy-number profiles of a study (gbm_tcga_pub's two copy-number profiles) is refused: the engine reads all of them together
  - [x] Several studies follow the portal's rules: mRNA and protein offered only where `CROSS_STUDY_EXPRESSION` lets expression be compared (its `enable_cross_study_expression`; PanCancer Atlas studies by default), the chosen profile read in each study holding it (the oql clause's `ifHeld`); an EXP / PROT typed into the genes refused in its words; the gene × sample limit (`QUERY_PRODUCT_LIMIT`, its `query_product_limit`, 1,000,000) refused in its words in the dialog and on the Results page; and the hg19 / hg38 warning, word for word
    - [ ] The hg19 / hg38 warning is said in the dialog and the Results header; the portal also marks each selected study in the study list
    - [ ] Across studies a mutation, structural-variant or copy-number choice is a data type; the portal groups profiles by their id without the study and offers radios where that gives several
- [x] **"Open in cBioPortal"** on every portal page (#158)
  - [x] The Comparison page: the page's groups saved from the browser as a portal comparison session, then opened (#169, #170)
- [ ] **Results → OncoPrint, the default view** — what a reader sees differ from the portal's before touching a control ([01-oncoprint](legacy-spec/parity/01-oncoprint.md))
  - [x] Gutter % as the portal prints it: an integer, "<1%", "0%"; the header "485 (82%)". We keep both numbers, "driver% / any%" ("37% / 37%"), where the portal prints one (ONC-LY-4, ONC-STM-1, ONC-STM-2) (#192)
  - [x] The Results header's samples line when samples ≠ patients (msk_impact_2017 TP53 KRAS TERT: "6494 (59%) of queried samples") (ONC-RV-1, ONC-STM-2) (#192)
  - [x] Initial zoom fits the altered columns, not every column (the portal's 30 % on Q1, 3 % on Q3) (ONC-ZM-2, ONC-STM-13, ONC-MD-11) (#194)
  - [x] Staircase sort per key, CNA then mutation, drivers before VUS, not profiled last, natural id order; over the portal's own cells our order is its order (Q1 594/594, Q3 10,336/10,336); over our cells Q1 449 of 594 positions agree, the rest from annotation differences (ONC-ST-1, ONC-ST-2) (#193)
  - [x] Sort menu: the Mutation Type, Driver and Ignore VUS toggles (ONC-SO-1, ONC-ST-3) (#195)
    - [ ] "Case list order" (ONC-SO-3): the portal offers it only for a query naming sample ids, which no Results query here can yet
    - [ ] A tie on every sort key: the portal orders the tied columns by natural id in the direction of its first clinical track (SortUtils alphabeticalDefault, PrecomputedComparator); ours, ascending
    - [ ] A text clinical track sorts by the natural order of its values ("x2" before "x10", SortUtils stringClinicalComparator); ours, by category order
  - [x] Tracks › Clinical: display names, Freq %, Select / Deselect all, applied by Update tracks, no cap of 8 (ONC-TR-1, ONC-STM-4) (#196)
    - [ ] A patient-level attribute's Freq in samples, as the portal counts it (ours its patients; msk_impact_2017 OS_MONTHS 73.3 % vs 74.4 %): needs a samples count in Explore's facet query
    - [ ] Mutation spectrum, Profiled-in and Study of origin listed first as rows of the tab
  - [ ] Clinical tracks (ONC-TT-1, ONC-TT-2, ONC-TT-12, ONC-TP-3, ONC-STM-5)
    - [x] Every value its own colour, the portal's list and reserved colours (ONC-TT-1) (#197)
    - [x] A patient's value as the portal's, by the attribute's declared datatype (a NUMBER's mean, MUTATION_COUNT max; otherwise the shared value or "Mixed"); exact tooltip values; a numeric sort by exact value, no value last (ONC-TT-12, ONC-TP-3, ONC-STM-5) (#198)
      - Not as the portal, on purpose:
        - a NUMBER's value is a number only when its whole text is one. The portal's parseFloat reads Gleason "4+3" as 4, "9-10" as 9 and "1801082_2" as 1801082 (85 values in the warehouse). Reading a prefix is a silent approximation (invariant 1).
        - a case with no MUTATION_COUNT shows no value; the portal shows 0 (fillNoDataValue). That is 74,489 patients in 337 studies, many perhaps never sequenced, and not profiled is never wild-type (invariant 7).
        - a BOOLEAN attribute (5 in the warehouse) is shown as its value, or "Mixed"; the portal's fillClinicalTrackDatum has no branch for it and draws nothing.
      - Known: values travel as float32, so two values equal to 7 significant digits tie where the portal's doubles would order them (two `todo` tests).
    - [ ] ONC-TT-2's numeric typing by the attribute's datatype (ours: ≥90 % parse and >10 distinct values); "(average of n values)" zoomed out (ONC-STM-8)
  - [x] The mutation spectrum track (ONC-TT-3, ONC-STM-6) (#199)
    - [ ] Its Freq in Tracks › Clinical (the portal's % of samples sequenced) and Edit Colors
    - [ ] The Tabular download names clinical rows by attribute id (`MUTATION_SPECTRUM (C>A)`, `AGE`); the portal by display name (`Mutation spectrum (C>A)`): with the downloads (ONC-DL-4)
    - Not as the portal, on purpose: a case whose substitutions are all ref = alt (one row in the warehouse) has no spectrum here; the portal keeps six zeros, draws no data, and writes 0 in its TSV
  - [x] Heatmaps: expression blue→black→red, methylation fixed to [0, 1] (white at 0.35), VAF yellow→teal, a patient's value max |x| (ONC-TT-5…7, ONC-TT-12, ONC-STM-7) (#200)
    - [ ] Generic-assay pivot and sort order (ONC-TT-8); VAF's "Not mutated/no VAF data" state; the #e0e0e0 null colour
  - [x] Clustering: average linkage on 1 − Spearman over distinct rank patterns, rows and columns, no-value columns last; exact to 8,000 patterns, a 2,000-pattern sample past that (said so), refused past 50,000 (ONC-SO-4, ONC-TM-5, ONC-STM-9) (#201)
    - [ ] Cluster from the heatmap group header's menu, the Sort menu's disabled indicator (ours: an option of the sort select)
    - Not as the portal, on purpose: the tree is the portal's, but within a merge the two halves may be drawn in the other order (the portal's clusterfck usually lists the later column first, and swaps two genes). Matching it would mean clustering every column rather than each distinct pattern once, which is what lets us cluster past the portal's ~8–10k columns (five `todo` tests)
    - Ours alone: with column groups (Group by), the clustered order applies within each group; the portal's Results oncoprint has no column groups
- [ ] **Results → Mutations tab** — lollipop and table against the portal's ([05-mutations](legacy-spec/parity/05-mutations.md))
  - [ ] Fusions as "A-B Fusion" mutations: Q2 TMPRSS2 4 rows vs 240, 0.8 % vs 41.5 %, Fusion badges 0/0 vs 207/29; ERG shows nothing (the portal 220 fusions) (MUT-0-4, MUT-MD-11, MUT-STM-1, MUT-STM-4, SV-STM-5; [06-structural-variants](legacy-spec/parity/06-structural-variants.md))
  - [ ] Table defaults: Copy # and Allele Freq (T) shown; Mutation Type as the portal's coloured label (ours `Missense_Mutation`); sorted by Annotation ↓ (KRAS: G12C first; ours "drivers, then codon", A11_G12dup first) (MUT-COL-38, MUT-COL-11, MUT-COL-T1, MUT-TB-9, MUT-STM-10)
  - [ ] The Annotation column's icons, cards and header. The OncoKB level by tumour type, hotspots and CIViC are under *Mutation annotation breadth* (MUT-COL-7, MUT-AN-1…6)
  - [ ] Table search and column filters reach the lollipop and badges (search "G12D": table 59 rows, lollipop still 14 stems / 223) (MUT-TB-3, MUT-FM-1, MUT-FM-3, MUT-STM-4)
  - [ ] The Y-Axis Max slider; axis "# patients" (ours "# KRAS Mutations"); top tick at the data, "≥" when capped (142; ours niced to 150) (MUT-LP-2, MUT-LP-6, MUT-STM-17)
  - [ ] Stem tooltip "142 mutated of 594 profiled patients / AA Change: G12D/V/C/A/S/R" (ours a native SVG title); hover highlights the table's rows (MUT-LP-10, MUT-LP-11)
  - [ ] Columns: Gene, Cancer Type, Copy #, ASCN (5), VS, Center, Allele Freq (N), normal reads, Exon, clinical attributes, namespace; the annotation sources are under *Mutation annotation breadth* (MUT-COL-2…37)
  - [ ] Table chrome: Show more (ours a numbered pager and per-page select), a Columns menu with a Clinical tab and Freq, TSV of every row (ours CSV of the filtered rows), Copy, an annotation filter (MUT-TB-2, MUT-TB-4, MUT-TB-5, MUT-TB-7, MUT-TB-8)
  - [ ] Several samples a patient: the "includes N duplicate mutations" suffix, "n samples / m patients" in the banners (MUT-TB-1, MUT-MD-5, MUT-STM-14, MUT-STM-16, MUT-FM-5)
  - [ ] A gene with no mutations: chip greyed, "no mutations", 0 % and 0 badges (MUT-GT-2, MUT-MD-1; see bugs)
- [ ] **Results → Plots tab** ([04-plots](legacy-spec/parity/04-plots.md))
  - [ ] Box-plot quartiles by the portal's rule, sorted[round(p·n)−1] (ours `quantilesExact`, sorted[floor(p·n)]): Q1 Amplification median 2722.74 vs 2668.88, Diploid q1/med/q3 981.83/1220.17/1496.62 vs 978.62/1217.02/1487.07, whiskers moving with them. Several studies: on pooled values (ours a size-weighted approximation; counts exact) (PLT-STM-8, PLT-BX-4, PLT-MD-2)
  - [ ] "Color samples by" the first gene by default: fill by mutation type, stroke by CNA, with a legend, scatters included (ours plain points; colour only on box plots, when chosen) (PLT-CL-1…4, PLT-CL-8, PLT-SC-6)
  - [ ] Discrete × discrete as bars: Bar, Stacked (the portal's default), 100% stacked, Sort By, Horizontal Bars (ours a table only) (PLT-PT-6, PLT-UT-4…6, PLT-BR-1…8, PLT-STM-12)
  - [ ] Correlation text as the portal's: "Spearman: -0.06 (p = 0.185)" then "Pearson: -0.04 (p = 0.359)" in the right gutter, `toFixed(2)` and `toConditionalPrecision(p, 3, 0.01)` (ours "Pearson r = −0.038 (p = 0.36) · Spearman ρ = −0.055 (p = 0.19)" above the plot). Spearman's ties: see bugs (PLT-SC-2, PLT-STM-4…6, PLT-STM-22)
  - [ ] The quick-plot "Examples" pills (Mut# vs Dx, FGA vs Dx, mRNA vs CNA, …) (PLT-QP-1…12, PLT-LY-1)
  - [ ] Mutation axis: VAF, CCF and Clonality groupings; SV Variant Type; the portal's labels "No mutation", "With Structural Variants" (ours "Not mutated", "Structural variant"). Driver vs VUS is under *Driver-annotation settings* (PLT-AX-2, PLT-DT-3…10, PLT-MD-4, PLT-MD-12)
  - [ ] Waterfall / Ordered samples (Treatment Response, mRNA); limit values such as ">8" (ours drops them as non-numeric) (PLT-PT-1, PLT-PT-2, PLT-WF-1…7, PLT-AX-3, PLT-AX-5, PLT-LV-1…4, PLT-MD-8, PLT-MD-9, PLT-STM-19, PLT-STM-20)
  - [ ] Downloads: SVG, PNG, PDF, Data (`plot.txt`) (PLT-DL-1, PLT-DL-2)
  - [ ] Search Case(s) and Search Mutation(s); scatter drag-select with "Selected: N samples" → Study View; legend click to highlight (PLT-UT-1, PLT-UT-2, PLT-UT-8, PLT-SC-5, PLT-HL-1…5)
  - [ ] Log scale as log2(max(v, 0) + 1), on by default for `rna_seq` mRNA, axis "(log2(value + 1))" (ours log10(v + 1), negatives dropped) (PLT-AX-4, PLT-STM-11, PLT-MD-11)
  - [ ] The "Show Regression Line" toggle and the "y = mx + b", R² label (ours always draws the line) (PLT-UT-7, PLT-SC-3, PLT-STM-7)
  - [ ] Category order: boxes alphabetical (Q5 Colon, Mucinous, Rectal; ours by count), mutation types before "No mutation" and "Not profiled", table rows likewise; Filter categories, Sort by Median (PLT-BX-1, PLT-TB-3, PLT-DT-3, PLT-AX-9, PLT-AX-10, PLT-STM-9)
  - [ ] Clinical attributes by display name with their ⓘ description, in the select, axis title and tooltip (ours `MUTATION_COUNT`) (PLT-AX-2, PLT-DT-19)
- [ ] **Results → Cancer Types Summary tab** ([02-cancer-types-summary](legacy-spec/parity/02-cancer-types-summary.md))
  - [ ] Default category as the portal picks it: Cancer Type Detailed for a one-cancer-type study (coadread: 3 bars; ours 1), Study for several studies, labelled by study name (ours `brca_tcga_pan_can_atlas_2018`) (CTS-CT-2, CTS-MD-2, CTS-MD-3, CTS-CH-8)
  - [ ] Filters and sort: small groups hidden with "40 of 58 categories (Cancer Type) are shown based on filtering." and a Min. # Total slider (ours pools them into "18 smaller groups"); Min. % / # Altered; Sort X-Axis alphabetically; count mode sorted by count (see bugs) (CTS-CT-3…5, CTS-CH-1, CTS-SO-2, CTS-SO-3, CTS-STM-6)
  - [ ] Downloads: SVG, PNG, PDF, Data TSV (CTS-DL-1…3, CTS-MD-12)
  - [ ] The bar's popover "Gene altered in 92.77% of 982 patients" with the type table to 2 dp, the study link and "Query this study" (ours an SVG title) (CTS-CH-7, CTS-STM-5, CTS-MD-2)
  - [ ] Stack and legend order (Multiple at the bottom, Mutation on top; ours the reverse); Multiple `#666` (ours `#6e7a83`) (CTS-CH-3, CTS-CH-4)
  - [ ] The profiled strip: "+" and "−" rows for every data type, with hover counts (ours rows only where a group lacks a type) (CTS-CH-5, CTS-CH-6, CTS-MD-8)
  - [ ] The "Show Genomic Alteration Types" toggle (CTS-OC-3)
  - [ ] A gene with no alterations: grey tab label, "There are no alterations in this gene." (CTS-GT-4, CTS-MD-10)
- [ ] **Study View → summary charts** — the Explore page's charts ([30-study-summary](legacy-spec/parity/30-study-summary.md))
  - [x] Default charts as the portal picks them: priorities from its config table, then coverage. Q1 shows 8 of the portal's 17 clinical charts; Sex, Race, Ethnicity, Subtype, T/M stage, Aneuploidy and the DFS/DSS/PFS KM are hidden (STS-LY-7, STS-LY-8, STS-MD-1; see bugs) (#188)
  - [x] Categorical % of every patient, NA its own slice or row (Race White 48.0 % of 594, NA 232; ours 78.7 % of 362) (STS-PIE-9, STS-TBL-1, STS-STM-1, STS-STM-3, STS-MD-9) (#190)
    - [ ] NA selected together with other values of the same chart (an `any` holds leaves only, and NA is a negation)
  - [ ] Numeric bins fixed for the study, and a chart freed of its own filter (Q2 MSI MANTIS 0.01-wide bars; ours 0.02, recomputed on the filtered cohort) (STS-BAR-1, STS-STM-2, STS-STM-8, STS-MD-6; see bugs)
    - [x] A numeric chart freed of its own filter: its bars counted over the rest of the filters (STS-STM-2, STS-MD-6) (#188)
    - [x] Bins fixed for the study rather than recomputed on the filtered cohort (STS-BAR-1, STS-STM-8) (#190)
    - [x] The single scan (per-sample bitmask, `uniqExactIf`) in place of one query per filtered chart (spike), from three filter groups (#190)
    - [ ] The unfiltered bin layout cached per study (spike step 2); one query per filtered click for now
    - Measured ([spike](spikes/explore-filter-parity.md)). Re-running Explore once per filtered chart doubles a click (msk_chord_2024 + genie_public at 4 filters: 3.0 → 6.3 s). Instead:
      - per drafted numeric attribute, its value counts without its own clause, in parallel (≈0 ms added);
      - bin edges from the unfiltered distribution, cached per study set and attribute;
      - then one scan per connection, with each sample's bitmask of the filters it passes, counting every chart with `uniqExactIf`. That is exact (0 mismatches) and CPU-neutral, and estimated 1.5 → ~0.55 s on msk_chord_2024 at 4 filters.
      - Today's click is already 2–5× faster than cbioportal.org's on the same filters.
  - [x] The bar chart's menu: Custom Bins (Quartiles, Median split, Generate bins, Custom bins; an empty box the default bars), Log Scale, Show NA; the default MSI custom bins (MANTIS 468/22/67, MSIsensor 496/10/78). Each reader's own, kept by the browser rather than the URL or a saved cohort (STS-BAR-1, STS-BAR-6…8, STS-HD-5, STS-STM-4, STS-STM-10) (PR #203 open)
    - [ ] Log Scale on a generic-assay or gene chart (ours clinical charts only); custom bins for a peer's studies (a remote peer bins by its defaults)
  - [ ] Gene tables: every gene (ours 500 of 18,275), column sort, "(N profiled samples)" in the title, the OncoKB cancer-gene icon and filter, MutSig / GISTIC q, gene-panel tooltip, a gene click queues a query; SV sorted by # SV (ours Union only, SV by # altered) (STS-GT-2, STS-GT-3, STS-GT-5…9)
  - [ ] Chart kinds: treatment tables, the GA frequency table (arm-level CNA by default), mutation-type counts, variant annotations, X-vs-Y density and violin, gene-specific violin, continuous gene bar (STS-OT-3…6, STS-VI-1…8, STS-GS-4, STS-SC-1)
  - [ ] Pie: for any attribute with few values (ours 9 allowlisted ids, else a list), slice labels, unselected slices greyed, a second click unselects (see bugs), the portal's colours (ours Okabe-Ito) (STS-LY-9, STS-PIE-3, STS-PIE-6…8)
  - [x] Survival: one card with an endpoint picker, kept on purpose in place of a KM tile per endpoint; the numbers match (STS-KM-1) (PR #203 open)
  - [ ] Density: x = FGA, y = mutation count, linear (ours x = log10(MC + 1)); 44×38 bins (ours 48×32); Pearson / Spearman text; Swap Axes and Log menu; a fuller tooltip (ours "n samples") (STS-SC-2…5, STS-STM-15)
  - ~~Chart chrome: drag, resize, ✕ delete, ↶ reset, ⓘ overlay (STS-LY-1…6, STS-HD-2…4)~~ Decided against (2026-11-13): the Explore page keeps its fixed layout.
  - [ ] Downloads: Summary and Full data, SVG, PDF, gene-table TSV (STS-DL-1…3, STS-HD-5)
  - [ ] Empty selection: the "filtered out all the samples" message, other tabs hidden (ours draws the charts and "0 patients match") (STS-LY-11, STS-MD-14, STV-LD-6, STV-MD-6)
  - [ ] Case lists: all of them, counted in samples (ours 10, `LIMIT 10 BY s`, in patients; coad, read, protein_quantification, methylation_hm450 missing) (STS-OT-2)
- [ ] **Study View → filters, actions and tabs** ([31-study-view-shell](legacy-spec/parity/31-study-view-shell.md))
  - [ ] The Clinical Data tab: a table per case of the visible charts' attributes, with search, sort and download (STV-TAB-1, STV-CD-1…9, STV-STM-12)
  - [ ] "Download clinical data" (⤓) for the selection (STV-AB-4, STV-STM-5, STV-HD-2)
  - [x] Filters in the URL: the bookmark, `#filterJson`, `filterAttributeId` / `filterValues` (STV-URL-2, STV-URL-3, STV-BM-1…3, STV-FB-7; see bugs) (#189)
    - [ ] A bookmark icon in the filter bar (STV-FB-7): the header's Copy link carries the filters instead
    - [ ] `sharedGroups`, `sharedCustomData` and the Plots tab's parameters (STV-URL-2): no Groups manager or Plots tab yet
  - [ ] The Groups manager: a group from the selection, its colour, share, Filter by union, compare 2–20 saved groups ("Save as a Cohort" stands in) (STV-GR-1…9, STV-STM-10)
  - [ ] Virtual study: description and its auto-text, static or dynamic, a shareable `/study?id=` (ours "Save as a Cohort": a name, always a definition) (STV-VS-1…6, STV-STM-9, STV-MD-3, STV-MD-4)
  - [ ] Custom Selection by sample or patient ids on the page (Analysis has it, signed-in only) (STV-CS-1…9)
  - [ ] Header: the study's name, description, PubMed link and download (ours id chips) (STV-HD-2, STV-HD-3)
  - [x] Filter pills named by chart ("Diagnosis Age : 50 < x ≤ 55 or 70 < x ≤ 75", "Sex : Female"), a value or range per pill with its ×, interval ends edited in place, "Clear All Filters" (STV-FB-1…5) (PR #191 open)
    - [x] An edited end makes custom bins on the chart (STV-FB-4): its ends join the chart's edges, so the filter is drawn as bars (PR #203 open)
    - [ ] Gene-chart, generic-assay and gene-table pills named by chart and coloured by alteration (STV-FB-3 #5, #9, #13, #14): ours the generic clause pills
    - [ ] Several separate ranges of one chart show as one pill each; the portal merges them into one interval from the first bar's start to the last's end (which reads wider than the filter)
  - [ ] Add chart: the "% samples with data" column, Select all, the X vs Y and Genomic tabs; turning a chart off clears its filter (STV-AC-2, STV-AC-3, STV-AC-7, STV-STM-3)
  - [ ] CN Segments and Plots tabs on the Study View (STV-CN-1…3, STV-PL-1, STV-STM-13)
  - [ ] Per-user layout: Save settings, the restore banner, reset charts (STV-LP-1…6)
- [ ] **Comparison → page, Overlap, Survival and Clinical tabs** ([20-comparison-core](legacy-spec/parity/20-comparison-core.md))
  - [ ] The Clinical tab tests every attribute (coadread 45; ours the 8 best covered, so a Sex comparison does not test SEX), as a table with p, q, type and test, sort, filter, download and a click-through plot (ours a −log₁₀ q bar chart of raw ids) (CMP-CL-2…4, CMP-STM-8; see bugs)
  - [ ] Numeric clinical attributes by Wilcoxon / Kruskal-Wallis (ours report Welch t / Welch ANOVA: G1 Weight 2.80e-7 vs the portal's 3.86e-8, MSI MANTIS 0.0745 vs 0.798; ours computes the rank p, matching, but does not show it) (CMP-STM-7)
  - [ ] Survival: the survival-type table (PFS, DFS, DSS with p and q, the Min. # patients slider) and a way to pick the endpoint on the tab (ours OS only) (CMP-SV-1, CMP-SV-5, CMP-SV-6, CMP-STM-4)
  - [ ] Hazard ratios: the checkbox, control group, HR in the legend, HR matrix (CMP-KM-1, CMP-KM-8, CMP-STM-5)
  - [ ] KM controls: X-Axis Max slider, landmarks, point tooltips, censor "+" marks, SVG/PNG/PDF/Data download; the axis to the last follow-up (G1 OS: the portal 149 mo, ours ~77; see bugs) (CMP-KM-1, CMP-KM-3, CMP-KM-4, CMP-KM-6, CMP-KM-7, CMP-KM-10)
  - [ ] Median with its 95 % CI ("62.79 (56.25 - NA)"; ours "62.8 mo"), p to 3 digits ("0.684"; ours "0.68") (CMP-KM-9, CMP-STM-2, CMP-STM-10)
  - [ ] Log-rank at any group size (ours refuses when a curve has under 10 patients) (CMP-MD-10, CMP-STM-3)
  - [ ] Overlap: Exclude by default, and Include as the portal's partition into "Only …" curves (ours Include by default, a shared patient in several curves; see bugs). The enrichment tabs default to Include too (CMP-PG-3, CMP-SV-4, CMP-MD-2, CMM-MD-6, CMM-TAB-8; [21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
  - [ ] The overlap banner on every tab (the Mutations tab's is listed under it) (CMP-OX, CMP-CL-1, CMP-SV-3)
  - [ ] Exclude for any groups, by the portal's iterative removal of emptied groups (ours refuses groups that differ in more than one condition or lie inside another, `lib/partition-arms.ts:139-140`) (CMP-STM-9, CMP-MD-1)
  - [ ] Group selector: ordinals "(A)", drag to reorder, hover popover with Open in study view, Select all / Deselect all, sample and patient counts, excluded groups struck through (CMP-GS-1…7)
  - [ ] Overlap tab: region selection, "Create Group From Selected Diagram Areas", download, UpSet for samples as well as patients; in Exclude mode the original groups drawn (CMP-OV-1, CMP-OV-4…6)
  - [ ] Several studies: the "Multiple studies" header and description warning (ours one study) (CMP-PG-2, CMP-MD-8)
  - [ ] Tabs as the portal shows them: Mutations for any number of groups, with "We can't show mutations for more than 2 groups…" (ours hidden unless 2), expression tabs past 10 groups, `tabHasBeenShown` (CMM-TAB-3, CMM-TAB-4, CMM-MD-2; [21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
- [ ] **Comparison → Genomic Alterations tab** ([21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
  - [ ] One table, a row per gene altered by any selected type, under the portal's checkbox tree with [Select] (ours three views, mutation, CNA and SV: G2 TP53 154/171 vs ours 153/171; MYC, the portal's #2 row, only in our CNA view) (CMM-AT-1…3, CMM-AL-5, CMM-STM-2)
  - [ ] Every altered gene tested (ours `minAltered: 5`, so BH divides by fewer genes: G2 mutation 3,108 vs 14,780 tested, DYNC2H1 q 0.0503 vs 0.239; CNA 6,512 vs 6,156 significant; G5 mutation 145 vs 336; see bugs) (CMM-STM-7, CMM-AL-4)
  - [ ] Every row (ours ≤300, and the frequency scatter and bar plot are built from those 300; the expression tabs' cap is under them) (CMM-AL-5, CMM-FS, CMM-BP-2, CMM-GN, CMM-EX-5)
  - [ ] Patient-level enrichment: the Sample / Patient select (CMM-AL-4, CMM-MD-5)
  - [ ] Formats: p and q "< 10^-10" (ours "1.1e-82"), altered % to 2 dp (ours 1), group headers "(A) Basal", the volcano's y capped at 10 (ours to 82) (CMM-STM-9, CMM-STM-3, CMM-AL-5, CMM-VO-1)
  - [ ] The Co-occurrence Pattern column (listed for the Mutations tab) (CMM-AL-6, CMM-MU-5)
  - [ ] The bar plot's options and Select genes (ours a fixed 10; see bugs) (CMM-BP-1, CMM-BP-2)
  - [ ] Volcano drag-select and click, as the expression volcanoes have; significant points `#58ACFA` (ours by group) (CMM-VO-3, CMM-VO-5, CMM-FL-3)
- [ ] **Results → Comparison/Survival tab** ([20-comparison-core](legacy-spec/parity/20-comparison-core.md), [21-comparison-molecular](legacy-spec/parity/21-comparison-molecular.md))
  - [ ] The Unaltered group as the portal's, unaltered among samples not wholly unprofiled (ours needs profiling in every type: 312 vs 372; OS p 0.616 vs 0.632); the Unprofiled and per-track groups (CMP-RV-3, CMM-RV-1…4)
  - [ ] The SV, mRNA, Protein and Methylation sub-tabs (ours mutation and CNA); "Add checked genes to query"; query genes left out before q (CMM-RV-1…4, CMM-MD-9)
- [ ] **Patient → Summary and tabs** ([40-patient-summary](legacy-spec/parity/40-patient-summary.md), [41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
  - [ ] Allele Freq per sample as bars, "x variant reads out of y", the VAF header plot, 4 decimals below 0.01 (ours one number, the highest VAF, 2 decimals; see bugs) (PAT-MT-3, PAT-STM-1, PAT-STM-7)
  - [ ] Mutation table: the portal's Mutation Type labels ("FS del"; ours `Frame_Shift_Del`), mRNA Expr., a Samples column only with several samples. Copy # beyond AMP/HOMDEL is under *OQL coverage*, the Annotation under *Mutation annotation breadth* (PAT-MT-2, PAT-MT-5, PAT-STM-4)
  - [ ] Default sort Annotation ↓, 10 rows (ours gene-grouped, driver genes first, 25) (PAT-MT-1, PAT-CNA-3)
  - [ ] "Study is not profiled for …" alerts and the not-profiled marks: grey pills, Gene panel column, panel modal (ours: lgg shows empty CNA and SV tables) (PAT-CNA-2, PAT-SV-2, PAT-NP-1, PAT-GP-2…4)
  - [ ] Tabs: Genomic Evolution second, and only for patients with several samples (see bugs); no Clinical Trials placeholder, which the portal does not have (PAT-TAB, PTB-TAB-2, PTB-TAB-3, PTB-MD-2, PTB-MD-3, PTB-MD-12)
  - [ ] Timeline: drag-zoom, PDF/PNG/SVG/ZIP download, month ticks, tooltips pinned and paged, the sample row's clinical data in its tooltip (PAT-TL-ZM-1, PAT-TL-ZM-3, PAT-TL-ZM-4, PAT-TL-TT-1…4)
  - [ ] OncoKB TMB-H and MSI-H header badges (msk P-0000004: ", TMB-H") (PAT-SH-6, PAT-STM-9)
  - [ ] The Gene header's "profiled in all samples" filter (PAT-MT-6, PAT-STM-15)
  - [ ] Cohort column: "72%" and "<1%" (ours "72.5%"), the green keyword bar and its tooltip, MutSig and GISTIC badges (PAT-STM-2, PAT-STM-3, PAT-CNA-4)
  - [ ] Browser title "Patient: P04" (ours "cbio-lab") (PAT-SH-1)
  - [ ] Cohort navigation: `#navCaseIds=` read (ours opens without the pager), ⊖ exclude, "N patients" opens the Study View (ours a list dialog) (PAT-URL-4, PAT-NAV-3, PAT-NAV-4)
  - [ ] SV table: Breakpoint Type hidden by default, the Status (s/g) column, A–B and B–A merged; the Annotation is under the SV tab item (PAT-SV-1, PAT-SV-3)
  - [ ] Clinical Data tab as Attribute | Value and Attribute × sample, and the Timeline Data tables (ours two wide tables of raw values) (PTB-CD-1…4, PTB-STM-11)

## Medium — annotation depth and per-sample viewers

- [x] **Per-sample CN segments** — the `segments` view on Results → CN Segments and the Patient summary (#161)
  - [ ] Hide the tab when no queried sample has segments
  - [ ] Drag-to-zoom, and the `.seg` download
  - [ ] Every segmented sample drawn (ours 300 of 583 by default, "283 are left out", at most 2,000; the portal up to 20,000 in Whole Genome) (CNS-1.7, CNS-3.1, CNS-MD-3) ([08-cn-segments](legacy-spec/parity/08-cn-segments.md))
  - [ ] Samples in the portal's API order (ours internal-id order: TCGA-3L-AA1B-01, the portal's first, is row 156; see bugs) (CNS-3.5) ([08-cn-segments](legacy-spec/parity/08-cn-segments.md))
  - [ ] Track height min(0.7 × window, n × 10) (ours 600 px past 40 samples) (CNS-3.1) ([08-cn-segments](legacy-spec/parity/08-cn-segments.md))
  - [ ] The segment popup "Sample / Mean CN log2 value / Location" (ours igv.js's; the patient overview has the portal's) (CNS-1.6) ([08-cn-segments](legacy-spec/parity/08-cn-segments.md))
  - [ ] igv chrome: the track named "CNA" (ours "Copy-number segments"), no "Refseq All" label, igv 2.11's navbar (Cursor Guide, Save SVG; ours 3.8's), chromosome select and search disabled on a gene pill (CNS-1.3, CNS-1.4, CNS-MD-1) ([08-cn-segments](legacy-spec/parity/08-cn-segments.md))
- [x] **Pathways → PathwayMapper diagram and ranked pathway table** — the `pathwaymap` view on Results and Patient (#160)
  - [ ] The Comparison page's Pathways tab
  - [ ] Ranking table search and CSV; "add genes to query"
  - [ ] NDEx
  - [ ] The PathwayMapper toolbar: Save PNG/SVG, Perform layout, Edit pathway, Help (PWY-1.3…1.5) ([09-pathways](legacy-spec/parity/09-pathways.md))
  - [ ] Ranking table: column sort, filter, paging, copy; score "3.00" (ours "3"); long names truncated; the ranking options' info texts (PWY-2.1, PWY-2.2, PWY-2.4) ([09-pathways](legacy-spec/parity/09-pathways.md))
  - [ ] Node text "0.0%" and "<0.5%" (ours "0%" and "<0.1%") (PWY-3.2) ([09-pathways](legacy-spec/parity/09-pathways.md))
  - [ ] Patient-level node % (ours sample-level; equal at one sample a patient) and the portal's tie order (WNT, TP53, Cell Cycle; ours WNT, Cell Cycle, TP53); the view's README states both (PWY-3.1, PWY-2.5, PWY-MD-6, PWY-STM-1) ([09-pathways](legacy-spec/parity/09-pathways.md))
  - [ ] Patient → Pathways: a bold Yes/No "Pathway altered" (ours a score), the portal's tie order (so a different pathway is drawn), "rank by" and "weight by altered %" hidden, per-sample mini tracks on nodes (ours coloured by altered %) (PTB-PW-2…4, PTB-STM-10) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
- [ ] **Results → Mutual Exclusivity tab** ([03-mutual-exclusivity](legacy-spec/parity/03-mutual-exclusivity.md))
  - [ ] The portal's table on the tab: Neither, A Not B, B Not A, Both, log₂ OR, p, q, Tendency, with the Mutual exclusivity / Co-occurrence / Significant only checkboxes, search, column picker, copy and `table.tsv` (ours a log₂ OR bar chart, the counts only in its hover title; the table card is only on `/lab`) (MEX-UI-4…6, MEX-TB-1, MEX-TB-2, MEX-TB-4, MEX-TB-6, MEX-STM-8)
  - [ ] Values as the portal prints them: "<0.001", and "<-3" / ">3" for a zero cell (ours "−1.7", q in scientific notation, and Haldane +0.5 makes every log₂ OR finite) (MEX-STM-5, MEX-STM-9)
  - [ ] Profiled as profiled in every selected profile (ours the mutation panel only, `lib/federation.ts:427`: Q5 534–537 samples a pair vs 532; KRAS/TP53 p 0.655 vs 0.721) (MEX-STM-1, MEX-MD-8, MEX-TB-7)
  - [ ] Several studies: pooled Fisher (ours Cochran-Mantel-Haenszel by study, deliberately, `doc.ts:7`: Q4 TP53/KRAS p 2.1e-7 vs ours 0.880, not significant; PIK3CA/APC's tendency flips) (MEX-MD-8, MEX-STM-5…7)
  - [ ] One gene: the tab shown with the portal's message (ours hidden; `?tab=Mutual+Exclusivity` lands on OncoPrint) (MEX-0.3, MEX-ER-1, MEX-MD-1)
  - [ ] No gene cap (ours 12, `COOCCUR_GENE_LIMIT` in `shared.ts:14`; a 13-gene query errors on the tab) (MEX-0.3)
- [ ] **Results → Co-expression tab** ([07-coexpression](legacy-spec/parity/07-coexpression.md))
  - [ ] Every gene listed, N/A rows too (ours the 100 most positive and 100 most negative, "Showing 1–25 of 200"; the portal 20,337 rows), so the correlation filters and search act on all (COE-2.4, COE-2.7, COE-STM-1)
  - [ ] q by BH over the portal's 17,292 non-null genes (ours tests 19,892, q ×1.15: FGD4 1.013e-71 vs 8.808e-72; q < 0.05 11,809 vs 11,701). The portal's ρ is ClickHouse `rankCorr`, ordinal ties (TP53 × NRG3 −0.1760; ours the average-rank −0.2026) (COE-STM-3, COE-STM-5)
  - [ ] Entity pills for the query's genes (ours the first gene and a free-text field) (COE-1.1)
  - [ ] Profile selects by name with "(N samples)", z-score profiles left out (ours raw ids) (COE-1.2…1.4)
  - [ ] Scatter: Show Mutations colouring, Log Scale and Regression toggles, downloads (ours always draws the fit) (COE-3.4…3.6, COE-3.9, COE-MD-8, COE-MD-9)
  - [ ] p and q to 3 significant digits ("8.81e-72"; ours "1e-71") (COE-2.5)
  - [ ] Search: the prefix rule, `-1p` exclusion, its info tip (ours a substring of "gene cytoband"; `-1p` returns 0 rows) (COE-2.8)
  - [ ] The table download (COE-2.9)
  - [ ] The tab for protein-only studies (ours needs an MRNA_EXPRESSION profile) (COE-0.1)
- [ ] **Mutation annotation breadth** — CIViC, functional impact, gnomAD / ClinVar / dbSNP / SIGNAL columns, HGVSg/c, PTM tracks, the PDB 3D structure viewer, a transcript dropdown
  - [x] HGVSg, HGVSc, ClinVar and SIGNAL columns on the mutation table, Genome Nexus read from the offline store (#179)
  - [ ] ClinVar's header sorts descending first, as the portal's does; the HGVSg tooltip's Genome Nexus logo
  - [x] gnomAD, dbSNP and Functional Impact (Mutation Assessor, SIFT, PolyPhen-2, AlphaMissense) columns, read from the offline store (#182)
  - [ ] The Functional Impact column's sectioned filter menu (by predictor and call); its header icons are text labels, not the tools' logos
  - [ ] gnomAD and dbSNP for the ~2% of variants Genome Nexus cannot serve myvariant.info's record of (asking myvariant.info directly would be a second source)
  - [x] The Annotation column's OncoKB call for the sample's tumour type (gene, protein change, mutation type, tumour type, as the portal asks), not the highest level across types, synced offline to `annotation.oncokb_tumor_type` (#202)
  - [ ] Shown once the full sync puts both OncoKB tables at one release (they are read at the same pin; the test studies are at v7.7, the gene-level store at v7.5)
  - [ ] Resistance, diagnostic and prognostic levels, and OncoKB's answer for the card, are stored but not shown (the card is MUT-AN-1)
  - [ ] CIViC
  - [ ] The transcript dropdown, with the lollipop's transcripts and Pfam domains read from the store instead of Genome Nexus live
  - [ ] PTM tracks
  - [ ] The PDB 3D structure panel
- [ ] **OQL coverage** — `GAIN`, `HETLOSS`, `CNA>=` (blocked by data: only high-level ±2 calls are loaded), `_GERMLINE` / `_SOMATIC` (blocked by the parser), per-track OQL inside merged oncoprint groups. Parity audit: on the Results page a merged `[BRAF NRAS]` is refused as "bad gene entry '[BRAF'" ([01-oncoprint](legacy-spec/parity/01-oncoprint.md), [03-mutual-exclusivity](legacy-spec/parity/03-mutual-exclusivity.md))
- [x] **Driver-annotation settings** — the view's `drivers` (OncoKB, the study's `cbp_driver` and `cbp_driver_tiers`, Show only drivers, Show only somatic) in the oncoprint's "mutations" menu, the germline stripe, Driver vs VUS and Driver/VUS mutation types on plots; one setting across the Results page's Oncoprint and Plots tabs (#168)
  - [ ] The other Results tabs following the settings: Cancer Types Summary, Mutual Exclusivity, the Mutations tab's lollipop and table, Comparison/Survival's Altered and Unaltered groups, Download, Pathways, the header's altered count (the portal's apply to every tab but Plots, Co-expression and CN Segments)
  - [ ] The menu as a page-level sliders button beside Modify query (ours sits in the oncoprint's toolbar, where the custom calls it lists are known)
  - [ ] Hotspots as a source: no Cancer Hotspots data is loaded (offered disabled, refused in a document)
  - [ ] "Show only profiled" (`hide_unprofiled_samples`) with its all/any radios, its CaseFilterWarning, and the AlterationFilterWarning, on every Results tab (ONC-MD-3, CTS-MD-7, MEX-MD-6, PLT-MD-5, PLT-CH-3, MUT-MD-13, CNS-0.2) ([01-oncoprint](legacy-spec/parity/01-oncoprint.md), [05-mutations](legacy-spec/parity/05-mutations.md))
  - [ ] OncoKB's germline rule (Pathogenic / Likely Pathogenic for a germline mutation): the store holds one call per alteration
  - [ ] A plot's menu lists no tiers (a plot does not report its data's tiers); the plot tooltip's OncoKB and hotspot icons
- [ ] **Oncoprint export** — PDF and tabular
  - [ ] Open in Oncoprinter; the TSV in the portal's rows per alteration type (CNA, MUTATIONS, …; ours one row per track) (ONC-DL-4, ONC-DL-5) ([01-oncoprint](legacy-spec/parity/01-oncoprint.md))

## Lower — resources, tools and niche features

- [ ] **Files & Links and resource tabs** — pathology reports, slides, imaging; the importer must load resource data first
- [ ] **Patient → Clinical Trials** — needs an outside trial source
  - [ ] The Matched Trials tab (PTB-TM) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
- [ ] **Patient → mRNA** — one patient against a reference cohort (behind a feature flag on the portal)
- [ ] **Patient → Plots (Beta)** — with its reference-cohort select (PTB-PL-1, PTB-PL-2) ([41-patient-tabs](legacy-spec/parity/41-patient-tabs.md))
- [ ] **Quick Search** — the homepage typeahead across studies, genes, patients and samples
- [ ] **Standalone Mutation Mapper** — paste a MAF, get a lollipop
- [ ] **Programmatic access** — data-access tokens and a REST API for raw data
- [ ] **Gated portal features** — Similarity Maps, the NG-CHM heatmap tab, custom tabs from config

## Running cBioLab as an institution's portal (from the configuration docs)

- [ ] **Per-user, per-study access control** — the largest gap for any private instance; today a study is allowed or denied for the whole deployment (`STUDY_DENY`, `STUDY_ALLOW_RESTRICTED`)
- [ ] **Data-governance switches** — an equivalent of `skin.hide_download_controls` and `download_custom_buttons_json`; and "Clear cache" restricted (open to every visitor today)
- [x] **Custom driver annotations** — `cbp_driver` / `cbp_driver_tiers` call drivers on the oncoprint and plots, and show in the oncoprint's tooltip (#168)
  - [ ] The mutation table's Custom Driver and Custom Driver Tier columns
  - [ ] The menu labels from deployment config (`oncoprint.custom_driver_annotation.*.menu_label`); ours are the portal's defaults
- [ ] **Instance defaults** — deployment-level defaults for the oncoprint, clinical tracks, OncoKB/hotspot/VUS, table columns, survival display and query-page gene sets
- [ ] **Branding and homepage curation** — blurb, footer, logos, priority studies, study tags, banners
- [ ] **Authentication options** — SAML, LDAP, Keycloak roles, optional sign-in, data-access tokens (OIDC only today)
- [ ] **Importer formats** — GISTIC 2.0, MutSig, generic-assay files, GSVA scores, resource data, custom-driver CNA/SV files

## Known issues found along the way

- [ ] The `alterations` view numbers a patient's samples without the timeline's collection days, so one sample can be "2" in its tables and "4" in the timeline; its table paging past page 1 may also fail
