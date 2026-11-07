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

Every portal page also has an "Open in cBioPortal" button (`lib/legacy-link.ts`). A new tab adds its
title there.

## High — daily-use features, data already loaded

- [x] **Results → Download tab** — the `datafiles` view: per-profile files, altered/unaltered case lists that open as cohorts, the alteration-frequency table (#157)
  - [ ] Tab-delimited and transposed downloads (CSV only today)
  - [ ] A deployment switch to hide every download control (see *Data-governance switches*)
- [x] **Results → Structural Variants tab** — the `sv` table view (#154)
  - [ ] The Annotation column: our OncoKB store has no structural-variant entries
- [x] **Patient → Genomic Evolution** — the `evolution` view: VAF per mutation across samples, line chart, heatmap, table (#153)
- [x] **Patient → Mutational Signatures** — the `signatures` view: contributions per sample, the spectrum with the portal's toolbar, and the COSMIC v3.3 reference under a clicked row (#156)
  - [ ] The patient header's significant-signatures badge (no warehouse study has a p-value profile yet, so it would show nothing today)
  - [ ] The signature table's download (the portal's table exports; ours is client-side `PortalTable` with no CSV)
  - [ ] A browser check: the kind is still `e2ePending`
- [x] **Comparison → mRNA, Protein and DNA methylation tabs** — `diffexpr` laid out as the portal's tab: volcano and the clicked gene's box plot per group (a `plot` by cohort), then the gene table with the "High expression/methylation in" filter and "Significant only"; profiles picked as the portal picks them, 2 groups (PR #159)
  - [ ] More than 2 groups (ANOVA), for mRNA, Protein and Methylation
  - [ ] Per-probe methylation (generic assay) as in the PanCancer Atlas studies
  - [ ] The table lists the 1,500 most significant genes; the portal lists every gene tested (the rest are on the volcano as density, not as points)
  - [ ] The Data Set picker's ⓘ profile description (the catalog carries no description)
  - [ ] Downloads: the volcano's and box plot's SVG/PNG/data buttons, the table's copy and download
- [ ] **Comparison → Mutations tab** — the two-group lollipop
- [ ] **Query-by-gene form controls** — genomic-profile choice with z-score thresholds, case-set selector, user-defined case lists, GSVA gene sets
- [x] **"Open in cBioPortal"** on every portal page (#158)
  - [ ] The Comparison page, which needs a session created on the portal first

## Medium — annotation depth and per-sample viewers

- [ ] **Per-sample CN segments** — the `segments` view on Results → CN Segments and the Patient summary (PR #161 open)
  - [ ] Hide the tab when no queried sample has segments
  - [ ] Drag-to-zoom, and the `.seg` download
- [x] **Pathways → PathwayMapper diagram and ranked pathway table** — the `pathwaymap` view on Results and Patient (#160)
  - [ ] The Comparison page's Pathways tab
  - [ ] Ranking table search and CSV; "add genes to query"
  - [ ] NDEx
- [ ] **Mutation annotation breadth** — CIViC, functional impact, gnomAD / ClinVar / dbSNP / SIGNAL columns, HGVSg/c, PTM tracks, the PDB 3D structure viewer, a transcript dropdown
- [ ] **OQL coverage** — `GAIN`, `HETLOSS`, `CNA>=` (blocked by data: only high-level ±2 calls are loaded), `_GERMLINE` / `_SOMATIC` (blocked by the parser), per-track OQL inside merged oncoprint groups
- [ ] **Driver-annotation settings** — custom driver and tier annotations, germline/somatic filtering and colouring, driver/VUS colouring on plots (refused today as "not supported yet")
- [ ] **Oncoprint export** — PDF and tabular

## Lower — resources, tools and niche features

- [ ] **Files & Links and resource tabs** — pathology reports, slides, imaging; the importer must load resource data first
- [ ] **Patient → Clinical Trials** — needs an outside trial source
- [ ] **Patient → mRNA** — one patient against a reference cohort (behind a feature flag on the portal)
- [ ] **Quick Search** — the homepage typeahead across studies, genes, patients and samples
- [ ] **Standalone Mutation Mapper** — paste a MAF, get a lollipop
- [ ] **Programmatic access** — data-access tokens and a REST API for raw data
- [ ] **Gated portal features** — Similarity Maps, the NG-CHM heatmap tab, custom tabs from config

## Running cBioLab as an institution's portal (from the configuration docs)

- [ ] **Per-user, per-study access control** — the largest gap for any private instance; today a study is allowed or denied for the whole deployment (`STUDY_DENY`, `STUDY_ALLOW_RESTRICTED`)
- [ ] **Data-governance switches** — an equivalent of `skin.hide_download_controls` and `download_custom_buttons_json`; and "Clear cache" restricted (open to every visitor today)
- [ ] **Custom driver annotations** — `cbp_driver` / `cbp_driver_tiers` are imported but nothing uses them
- [ ] **Instance defaults** — deployment-level defaults for the oncoprint, clinical tracks, OncoKB/hotspot/VUS, table columns, survival display and query-page gene sets
- [ ] **Branding and homepage curation** — blurb, footer, logos, priority studies, study tags, banners
- [ ] **Authentication options** — SAML, LDAP, Keycloak roles, optional sign-in, data-access tokens (OIDC only today)
- [ ] **Importer formats** — GISTIC 2.0, MutSig, generic-assay files, GSVA scores, resource data, custom-driver CNA/SV files

## Known issues found along the way

- [ ] The `alterations` view numbers a patient's samples without the timeline's collection days, so one sample can be "2" in its tables and "4" in the timeline; its table paging past page 1 may also fail
