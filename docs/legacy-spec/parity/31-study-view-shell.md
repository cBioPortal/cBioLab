# Parity audit — Study View › shell, filters, actions, other tabs (spec `31-study-view-shell.md`)

- **Date:** 2026-11-11; re-scored 2026-11-16; re-measured 2026-11-18
- **cBioLab:** master @ `bc53b944`, `next dev` on `http://127.0.0.1:3109` (2026-11-16: `3ff57c37`; first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org v7.2.3 (Playwright, logged out, 2026-11-11)
- **Study View equivalent in cBioLab: Explore** — `/lab?tab=explore&study=<id[,id…]>` (homepage "Explore selected studies", `app/_home/query-flow.tsx:20`). No `/portal/study` route. Explore is one page: study header, filter bar, and three tabs, Summary (the facet grid), Clinical Data and CN Segments (`app/lab/page.tsx:555-566`, since 2026-11-17). The Study View's other tabs (Plots, Heatmaps, Files & Links, Similarity Maps, resource tabs) do not exist on it; the Analysis tab's `plot` view is the nearest to Plots.
- **Code paths (cBioLab):** `app/lab/page.tsx:506-581`, `app/lab/explore-sections.tsx` (`StudyPicker`, `ExploreBar`, `AddChartDialog`), `app/lab/use-explore-state.ts` (URL, `viewPatients`, `openGroups`, `compareQuantiles`, `addClause`), `app/lab/pills.tsx` (`CohortPills`), `app/lab/dialogs.tsx` (`SaveCohortDialog`), `app/lab/custom-data-*.tsx`, `app/lab/list-cohort.tsx`, `app/portal/query-editor.tsx` (`QueryGenesDialog`), `app/_ui/site-header.tsx` (Copy link), `lib/explore.ts`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 single | `/study/summary?id=coadread_tcga_pan_can_atlas_2018` | `/lab?tab=explore&study=coadread_tcga_pan_can_atlas_2018` |
| Q2 one filter | `…&filterAttributeId=SEX&filterValues=Female` | Add chart › Sex, click "Female" (no URL form exists) |
| Q3 multi | `id=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018` | `study=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018` |
| Q4 empty | `#filterJson={…SEX…Nonexistent}` | draft `SEX ∈ {Nonexistent}` via `POST /api/explore` |

Scripts and screenshots: (local scratch, not committed) (`leg-ui.js` → `out/leg-unf.png`, `out/leg-fem.png`; `lab-ui.js`, `lab-ui2.js` → `out/lab-full.png`, `out/lab-female2.png`; `leg-api*.json`, `lab-all.json`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 18 |
| 🟡 partial | 40 |
| 🔶 different | 10 |
| ❌ missing | 42 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 6 |
| ? | 0 |
| **Total IDs** | **118** |

**Overall: 22.0 %** (✅ 18 + 🐞ok 2 + N/A 6 = 26 of 118). Counting 🟡 as half: 39.0 %. (2026-11-16: 27.1 % / 41.5 %; 2026-11-11: 12.7 % / 23.7 %.)

Re-measurement of 2026-11-18 (master `bc53b944`): every ID judged again from the spec text against the code and the page. 16 verdicts changed: 5 up (URL-5, HD-1, RS-2, LP-3, MD-13), 9 down (FB-2, FB-3b, AB-1, GR-10, CD-5, CD-9, LD-7, MD-14, STM-13; marked ↓ in the note), and 2 relabelled without a change in score (URL-3 ✅ → N/A, as STS-FL-2: legacy deliberately keeps filters out of the URL; CD-2 🐞 ok → N/A, no legacy bug). The counts still match (Q1 594 / 594, Q2 280 / 280 through the portal's own `filterAttributeId=SEX&filterValues=Female` link, Q4 0 with the portal's message). Most drops are cases where the earlier rows called something ✅ but a part of the spec text is missing: the portal's "Selected: … | …" wording, the Clinical Data tab's Show more and Columns menu, CN Segments hidden at 0 samples, and a generic-assay chart losing Compare across studies.

Re-score of 2026-11-16: the rows PRs #191, #203 and #260 had already updated were checked again, and 5 more verdicts changed, all for the better (#188, #189). The filters now live in the URL, Copy link carries them, and a portal `#filterJson` or `filterAttributeId` link opens with its filters. Still missing: the Clinical Data tab, the clinical-data download, the Groups manager, virtual studies, Custom Selection on the page, the study header and per-user layout.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 URL | 5 | 0 | 1 | 2 | 1 | 0 | 1 | `?study=a,b`; filters in the URL (N/A, invariant 9), `#filterJson` and `filterAttributeId` read (#189); tab not in the URL; no sharedGroups |
| §2 Header (HD) | 4 | 1 | 3 | 0 | 0 | 0 | 0 | Study name, description, PubMed, ⊕; unknown ids named, page drawn on the rest; no download icon |
| §3 Filter bar (FB) | 9 | 1 | 4 | 1 | 3 | 0 | 0 | Clinical pills named by chart, intervals edited in place (#191, #203); generic pills "OR"; no Submit, no bookmark icon |
| §4 Action buttons (AB) | 6 | 1 | 2 | 2 | 1 | 0 | 0 | Counts ✅ (not the "Selected:" wording); View patients; Save as a Cohort ≈ VS; clinical download ✅; no ⚙ |
| §5 Custom Selection (CS) | 9 | 0 | 2 | 0 | 7 | 0 | 0 | Not on Explore; an id-list cohort exists in Analysis and Saved (sign-in) |
| §6 Charts menu (AC) | 8 | 0 | 6 | 0 | 2 | 0 | 0 | "Add chart" dialog with Freq and Select all on Clinical; no Genomic or X vs Y tab |
| §7 Groups (GR) | 10 | 0 | 3 | 0 | 6 | 0 | 1 | No Groups menu; chart Compare entry points (not on GA charts across studies) |
| §8 Virtual study (VS) | 6 | 0 | 2 | 1 | 3 | 0 | 0 | "Save as a Cohort": a name, saved to the library as a definition |
| §9 Bookmark (BM) | 3 | 1 | 2 | 0 | 0 | 0 | 0 | Copy link carries the filters; no bookmark modal or short URL |
| §10 Tabs (TAB, CD, CN, PL, RS) | 18 | 6 | 5 | 0 | 5 | 0 | 2 | Summary, Clinical Data, CN Segments; no Columns menu or Show more; no Plots or resource tabs |
| §11 Layout persistence (LP) | 6 | 0 | 1 | 0 | 5 | 0 | 0 | Bin settings kept by the browser; chart picks and layout not saved |
| §12 Loading / empty (LD) | 7 | 2 | 1 | 1 | 1 | 1 | 1 | Skeleton + refusals named; the portal's empty-selection message (#260); no tour |
| §13 Modes (MD) | 14 | 3 | 4 | 2 | 4 | 0 | 1 | Single/multi fine; no VS, manual submit |
| §15 Statistics (STM) | 13 | 3 | 4 | 1 | 4 | 1 | 0 | Selected counts and query hand-off fine; CN Segments hidden at 0 samples; no Add-chart genomic Freq, VS text |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **No Clinical Data tab** (per-case table of the visible charts' attributes, search/sort, download) on Explore; nearest is an Analysis `table` view | TAB-1, CD-1…9, STM-12 | tracked |
| 2 | **No "Download clinical data" (⤓) for the selection** | AB-4, STM-5, HD-2 | tracked |
| 3 | **No filter bookmark / shareable filtered URL**: filters live in the page only; Copy link gives `?tab=explore&study=…`; no `#filterJson`, no `filterAttributeId`/`filterValues` input | URL-2, URL-3, BM-1…3, FB-7 | fixed (#189); bookmark icon and sharedGroups tracked |
| 4 | **No Groups manager** (create group from selection, colour, share, Filter by union, Compare 2–20 saved groups); "Save as a Cohort" + Analysis cohorts stand in | GR-1…9, STM-10 | tracked |
| 5 | **Virtual study** replaced by "Save as a Cohort": name only, no description/auto-text, always dynamic (a definition), no shareable `/study?id=` | VS-1…6, STM-9, MD-3, MD-4 | tracked |
| 6 | **No Custom Selection by sample/patient ids on Explore** (exists as "Add a cohort from a list of ids" in Analysis, signed-in only) | CS-1…9 | tracked |
| 7 | **Header lacks study name, description, PubMed, study download**; shows ids as chips | HD-2, HD-3 | tracked |
| 8 | **Pills are clause text** ("CLINICAL SEX = Female", "AGE > 50 ≤ 60"), not chart-name pills; numeric intervals not editable; one pill per clause, no and/or grouping words | FB-1…4 | fixed (#191, #203); gene and assay pills, merged ranges tracked |
| 9 | **Add chart dialog**: no Freq "% samples with data" column, no Select all (has check all/none), no X vs Y tab, no Genomic tab (gene tables fixed), toggling a chart off does not reset its filter | AC-2, AC-3, AC-7, STM-3 | tracked |
| 10 | **No CN Segments / Plots tabs on Explore** (Results › CN Segments and Analysis `plot` exist elsewhere) | CN-1…3, PL-1, STM-13 | (tracked) Results CN Segments sub-items only |
| 11 | **Empty selection** draws facets with "0 patients match"; no message, no hidden tabs | LD-6, MD-6 | fixed (#260) |
| 12 | **No settings gear / manual submit**; no Alteration Filter menu (only "Alterations: all / OncoKB drivers only") | AB-5, AB-6, FB-6, MD-7 | (tracked) Driver-annotation settings |
| 13 | **Files & Links / resource tabs** | RS-1…4 | (tracked) Files & Links and resource tabs |
| 14 | **No per-user layout persistence** (Save settings, restore banner, reset charts) | LP-1…6 | tracked |
| 15 | **Heatmaps / Similarity Maps tabs** | TAB-1, MD | (tracked) Gated portal features |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 selected | STM-2 | "594 patients \| 594 samples" | "1 study · 594 patients · 594 samples" | ✅ |
| Q2 selected | STM-1, STM-2 | "Selected: 280 patients \| 280 samples" | header "280 patients · 280 samples"; bar "1 filter · 280 patients match" | ✅ |
| Q3 selected | STM-2 | 1,678 / 1,678 | "2 studies · 1,678 patients · 1,678 samples (overlap not deduplicated)" | ✅ |
| Q4 empty (2026-11-18, `filterValues=Nonexistent`) | STM-1, LD-6 | "Selected: 0 patients \| 0 samples", the message | "0 patients · 0 samples", the portal's message, only the Summary tab | ✅ counts and message; CN Segments hidden (STM-13) |
| Q2 pill (2026-11-18, through `filterAttributeId=SEX&filterValues=Female`) | FB-3, FB-4 | "Sex : Female" | "Sex : Female ×" | ✅ |
| Spec AGE 50-60 | STM-1 | 106 samples | 106 | ✅ |
| Add-chart Freq (Mutated Genes, Q1) | STM-3 | 89.9 % (534/594) | no Freq column | ❌ |
| Add-chart Freq multi (legacy bug 190.7 %) | STM-3 | 190.7 % | no Freq column | ❌ (bug therefore absent) |
| Profile "(N samples)" mRNA, Q1 | STM-4 | 592 | not offered (Gene status = mutation/CNA only); Data types card 592 | ❌ |
| VS default description | STM-9 | "594 samples from 1 study: …" | none; default cohort name "explored cohort" / "all of <study>" | ❌ |

---

## 4. Scorecard

### §1 Routing and URL parameters

| ID | verdict | how | note |
|---|---|---|---|
| STV-URL-1 | 🔶 | B | `/lab?tab=explore` (also `analysis`); Explore's own tab as `svtab=clinicalData` \| `cnSegments` (the portal's path names, `lib/study-view-url.ts`), read on load, absent on Summary; no per-tab paths; `/lab?tab=cohorts` redirects to Explore + Saved work |
| STV-URL-2 | 🟡 | BC | `study=a,b` (comma list), `filters=1.…` (the filters, compressed), `#filterJson=` and `filterAttributeId` + `filterValues` read (SEX = Female → 280 patients) (#189); `drivers=1`, `custom=add`, `editCohort=<id>`; no sharedGroups / sharedCustomData / plots_* |
| STV-URL-3 | N/A | BC | ↓ Filters are written to the URL (`filters=1.…`, `app/lab/use-explore-state.ts:527-535`; #189), where legacy writes them only through its bookmark link: N/A per invariant 9 (a link carries what the reader sees), as STS-FL-2 |
| STV-URL-4 | ❌ | C | URL read once on load (`page.tsx:340-346`); in-page study changes write the URL (`use-explore-state.ts:657-664`) |
| STV-URL-5 | 🔶 | C | ↑ View patients and Query carry the cohort definition (a stored set or stored link past the address-bar limit, `use-explore-state.ts:234-242`, LINKS.md): it works, by another mechanism; no localStorage hand-off or "query is too large" alert |

### §2 Header

| ID | verdict | how | note |
|---|---|---|---|
| STV-HD-1 | 🟡 | B | ↑ `study=coadread_tcga_pan_can_atlas_2018,nonexistent_xyz` draws the page on coadread and names the unknown id ("unknown study 'nonexistent_xyz'") above the header, as the portal's danger banner; the wording differs ("Unknown/Unauthorized study: X"). The unknown-attribute banner as the portal's (`explore-sections.tsx:285`) |
| STV-HD-2 | 🟡 | B | The study's name, or "Combined Study", under the Exploring row ([study-header-cases](study-header-cases.md) SH1). No study download icon: the portal's download server list is not readable here (SH9) |
| STV-HD-3 | ✅ | B | Description's first line (its links kept, other HTML dropped), "PubMed", ⊕ for the other lines or the studies' list; brca_tcga_pan_can_atlas_2018's name, description and PubMed ids match the portal's API ([study-header-cases](study-header-cases.md) SH2–SH8). Virtual-study origins: no virtual studies here |
| STV-HD-4 | 🟡 | BC | "Query genes…" opens the gene query dialog (OQL, profiles, case set, product-limit refusal) carrying the filters; not an inline box. A gene table's search icon queues the gene (`explore-sections.tsx:1307`) |

### §3 Filter bar

| ID | verdict | how | note |
|---|---|---|---|
| STV-FB-1 | 🟡 | B | A pill per value or range with its × ✅; cBioLab's own pill style kept on purpose (not the portal's blue); no pending style (no manual mode, STV-FB-6) |
| STV-FB-2 | ✅ | B | Clinical pills "<chart> : a or b", no word between charts; generic OR groups "( a or b )" and two groups of one chart joined by "and" (`joinedByAnd`, `lib/study-view-pills.ts`); a gene-table Union is one OQL clause, its pill text under STV-FB-3 |
| STV-FB-3 | 🟡 | B | Clinical (incl. NA) named by the chart's display name, a pill per value or range; gene-table selections a pill per gene coloured by alteration (`geneTablePills`); gene-chart and mutation-type filters "<chart> : <state> or <state>", each removable (`geneStatesFilter`); GA, case-list, event and derived clauses still the generic pills; no group-filter or treatment pills |
| STV-FB-3a | ❌ | C | No survival-attribute pills (no survival filter) |
| STV-FB-3b | ✅ | C | A density drag's ranges have no pill while their chart is drawn, as legacy; the chart shows them (its box, "selected: …") and resets them; a second drag replaces the first (`densityHeld`, `withDensityDrag`); with the chart not drawn they are ordinary range pills |
| STV-FB-4 | ✅ | B | "50 < x ≤ 60", "a ≤ x ≤ b", "> a", "≤ b", one value; ends edited in place (start > end swaps, start = end and empty refused), and an edit makes custom bins on the chart (#203). Several ranges one pill, the first range's start to the last's end, as the portal (an edit makes it that one interval) |
| STV-FB-5 | ✅ | B | "Clear All Filters" removes every clause (keeps studies) |
| STV-FB-6 | ❌ | C | No manual mode / Submit (filters apply at once) |
| STV-FB-7 | ❌ | B | No bookmark icon; the header's Copy link carries the filters instead |

### §4 Selection summary and action buttons

| ID | verdict | how | note |
|---|---|---|---|
| STV-AB-1 | ✅ | B | Header "594 patients \| 594 samples", "Selected: 41 patients \| 41 samples" while filtered (`portalSelectedInfo`), from the filtered totals, skeleton while counting; "(overlap not deduplicated)" kept on several studies (invariant 3) |
| STV-AB-2 | ✅ | BC | "View patients" opens `/portal/patient` in a new window on the first patient, with the cohort definition for stepping (`use-explore-state.ts`); disabled, saying why, with no study or at 0 matching patients |
| STV-AB-3 | 🔶 | B | "Save as a Cohort" (filter bar, only once filtered) — see §8 |
| STV-AB-4 | ✅ | B | "Download clinical data" beside View patients: `<study>_clinical_data.tsv` / `combined_study_clinical_data.tsv`, through the patient-level table route ([download-cases](download-cases.md) PC2, PC9). Shown always (no `skin_hide_download_controls`) |
| STV-AB-5 | ❌ | B | No ⚙ / autosubmit setting |
| STV-AB-6 | 🔶 | B | "Alterations: all / OncoKB drivers only" select instead of the Alteration Filter menu (tracked: Driver-annotation settings) |

### §5 Custom Selection

| ID | verdict | how | note |
|---|---|---|---|
| STV-CS-1 | ❌ | B | Not on Explore |
| STV-CS-2 | ❌ | C | No "currently selected/unselected" fill |
| STV-CS-3 | 🟡 | C | Analysis › "+ Add cohort › from a list of ids" textarea (`list-cohort.tsx`), sample/patient level |
| STV-CS-4 | 🟡 | C | Splits on whitespace, commas, semicolons (`list-cohort.tsx:23`); reports unmatched, duplicates, multi-study |
| STV-CS-5 | ❌ | C | — |
| STV-CS-6 | ❌ | C | — |
| STV-CS-7 | ❌ | C | Not on Explore (Analysis dialog has its own messages) |
| STV-CS-8 | ❌ | C | Not on Explore; does not clear filters |
| STV-CS-9 | ❌ | C | — |

### §6 Charts menu ("Add chart")

| ID | verdict | how | note |
|---|---|---|---|
| STV-AC-1 | ❌ | B | No Save settings |
| STV-AC-2 | 🟡 | B | Tabs Clinical · Genomic · Gene status · a tab per generic-assay type (#456) · Derived timeline filters · Custom data; the Genomic tab's charts each shown unless unchecked (`genomicChartLines`); Mutation Count and FGA listed in the Clinical tab too (the portal: Genomic only); no X vs Y, Variant Annotations |
| STV-AC-3 | 🟡 | B | Checkbox · Attribute · **Freq** ("% samples with data") · Type · Level, ordered by Freq then name; a 0% row is greyed and cannot be checked; "Select all (N)" / "Deselect all" as the portal shows them; unchecking a chart clears its filter ([add-chart-cases](add-chart-cases.md) AC1–AC8). No info banner |
| STV-AC-4 | ✅ | B | Clinical Freq for brca_tcga_pan_can_atlas_2018: all 60 attributes as the portal's API gives them; filtered to Sex = Male, the 3 the portal greys out. Genomic Freq for coadread: Data Types 100.0 %, CNA Genes 99.7 %, FGA 98.1 %, Mutated Genes / Mutation Count / SV Genes 89.9 %, the portal's list and order |
| STV-AC-5 | 🟡 | B | Gene status: a profile select with profiled samples ("Mutations (534 samples)"), for mutations Mutated vs Wild Type or Mutation Type, one chart per gene and profile (≤6 genes; `geneChartsChanged`); one option per kind (mutations; discrete copy number, its kinds summed across studies), so a selection holding two discrete copy-number profiles cannot pick between them, and one whose discrete profile has another id is not offered copy number; no gene sets or chart-type radios; continuous profiles not offered |
| STV-AC-6 | 🟡 | B | "Custom data" button / tab: upload and manage datasets, charted as facets; sign-in rules differ |
| STV-AC-7 | ✅ | B | The X vs Y tab: two attribute selects (survival but OS_STATUS left out) and the portal's button for each pair (`xVsYButton`); two numeric add a density chart, numeric × categorical a violin table (`ViolinCard`) |
| STV-AC-8 | 🟡 | C | A tab per generic-assay type, named as the portal's (`assayTabLabel`; coadread Arm-level CNA · Genetic Ancestry · Methylation), each a profile select of that type + entity search, one chart per entity (`AssayChartPicker`); no "Frequency Table" row |

### §7 Groups

| ID | verdict | how | note |
|---|---|---|---|
| STV-GR-1 | ❌ | B | No Groups menu |
| STV-GR-2 | ❌ | B | — |
| STV-GR-3 | ❌ | B | — |
| STV-GR-4 | ❌ | B | — |
| STV-GR-5 | 🟡 | BC | Compare from charts opens `/portal/comparison` with ≤20 groups (`COMPARISON_MAX_GROUPS`); no Filter/Share of saved groups |
| STV-GR-6 | 🟡 | B | "Save as a Cohort" names and stores the selection (as a definition) |
| STV-GR-7 | ❌ | B | — |
| STV-GR-8 | ❌ | C | — |
| STV-GR-9 | N/A | C | Legacy itself has no rename here |
| STV-GR-10 | ✅ | B | ↓ Clinical, gene and generic-assay charts' "…" → Compare groups / Analyze groups ✅, across several studies too (Quartiles / Median one study only, as the clinical charts); brca + coadread 8q Gain 694 / Unchanged 658 / Loss 31 |

### §8 Virtual study

| ID | verdict | how | note |
|---|---|---|---|
| STV-VS-1 | 🟡 | C | Name field prefilled "explored cohort" (`dialogs.tsx:51-63`) |
| STV-VS-2 | ❌ | C | No description |
| STV-VS-3 | 🔶 | C | Always a definition (re-evaluated = dynamic); no static sample list option |
| STV-VS-4 | 🟡 | C | Save / Cancel; library save needs sign-in |
| STV-VS-5 | ❌ | C | Payload is the cohort definition, not studies+samples |
| STV-VS-6 | ❌ | C | No `/study?id=` link; saved cohorts open from Saved work |

### §9 Bookmark

| ID | verdict | how | note |
|---|---|---|---|
| STV-BM-1 | ✅ | B | Copy link carries the study and the filters (`filters=1.…`); a portal `#filterJson=` link opens with its filters (AGE (50,60] → 106 patients) (#189) |
| STV-BM-2 | 🟡 | B | Copy link puts the full link on the clipboard; no "Bookmark this filter" modal, no shortened URL |
| STV-BM-3 | 🟡 | C | Filters compressed into `filters=1.…`; long links go through stored links (LINKS.md); no too-long → virtual study fallback |

### §10 Tabs

| ID | verdict | how | note |
|---|---|---|---|
| STV-TAB-1 | 🟡 | B | Explore's Summary · Clinical Data · CN Segments tabs under the filter bar, in the URL (`svtab`) and kept mounted once opened (search, sort, page, locus kept); Clinical Data not offered on an empty selection ([clinical-tab-cases](clinical-tab-cases.md) CT1), CN Segments whenever a selected study holds segments ([study-cn-segments-cases](study-cn-segments-cases.md) CS1). Not yet: Plots |
| STV-CD-1 | ✅ | B | "loading clinical data…" until the first page; later pages and queries cover the rows with "updating…" |
| STV-CD-2 | N/A | C | No row limit: the table pages in the database (`lib/study-view-clinical-tab.ts:28-32`; [clinical-tab-cases](clinical-tab-cases.md) CT9), so the product limit and its message do not apply. Not a legacy bug, so N/A rather than 🐞 ok |
| STV-CD-3 | ✅ | BC | Patient ID and Sample ID (links), then each visible clinical-attribute chart by priority then name ([clinical-tab-cases](clinical-tab-cases.md) CT2, CT5); each header's tooltip name, description and attribute id (`clinicalColumnTip`); several studies: a "Cancer Study" column (first, where the portal has it third) |
| STV-CD-4 | ✅ | BC | Grey "—" (tooltip "No data available"), http(s) values as links ([clinical-tab-cases](clinical-tab-cases.md) CT3, CT4) |
| STV-CD-5 | ✅ | B | "N results" and 20 rows a page ([clinical-tab-cases](clinical-tab-cases.md) CT6) with the portal's previous · Show more · next; the table scrolls within 100vh − 220px |
| STV-CD-6 | ✅ | B | Search and sort in the database over every row; ⚠ no 500-row cap or its message ([clinical-tab-cases](clinical-tab-cases.md) CT7) |
| STV-CD-7 | ✅ | B | Download `<study>_clinical_data.tsv` of the columns shown, every row the search keeps, the portal's table layout (CRLF, empty for missing); ⚠ without the 500-row cap ([clinical-tab-cases](clinical-tab-cases.md) CT10–CT12) |
| STV-CD-8 | ✅ | B | brca_tcga_pan_can_atlas_2018: "1,084 results", Patient ID, Sample ID, Cancer Type Detailed, Mutation Count, Fraction Genome Altered, Diagnosis Age, MSI MANTIS Score, MSIsensor Score, Overall Survival Status, Sex, Ethnicity Category, Race Category, Subtype, Tumor Type, … — the order the spec saw |
| STV-CD-9 | ✅ | C | A Columns menu on the tab: the chart menu's Clinical · Genomic · X vs Y tabs (`columnsMenuTabs`); a column is a chart shown |
| STV-CN-1 | ✅ | B | The portal's info line: "Segmented copy-number data for the selected N samples." ("sample" for one), "No segmented …" once read and empty, and the >20000 refusal with nothing read ([study-cn-segments-cases](study-cn-segments-cases.md) CI1–CI6). brca_tcga_pan_can_atlas_2018: "…for the selected 1084 samples." |
| STV-CN-2 | ❌ | C | No .seg download (tracked under Per-sample CN segments); deferred (#492): it needs a per-case segments file route (sample ids with each segment), which the table route's row sources do not serve today; tracked with Results' CN Segments download (CF3) |
| STV-CN-3 | 🟡 | C | The `segments` view over the selection: igv.js, one segment track, the study's reference genome (CF1). Its gaps are the Results tab's (Per-sample CN segments): 300 rows by default, track height, igv chrome |
| STV-PL-1 | 🟡 | C | No Plots tab; Analysis `plot` view over the explored cohort via Analyze |
| STV-RS-1 | ❌ | C | (tracked) Files & Links |
| STV-RS-2 | N/A | C | ↑ Legacy renders the section `display:none`; nothing visible on either side |
| STV-RS-3 | ❌ | C | (tracked) |
| STV-RS-4 | ❌ | C | (tracked) |

### §11 Layout persistence

| ID | verdict | how | note |
|---|---|---|---|
| STV-LP-1 | ❌ | C | Chart picks are React state (`chartPicks`), lost on reload |
| STV-LP-2 | ❌ | B | — |
| STV-LP-3 | 🟡 | C | ↑ Custom bins, Log Scale and Show NA kept per study set in the browser (`use-explore-state.ts:150-172`); visible charts, layout, chart types and group colours not saved |
| STV-LP-4 | ❌ | C | — |
| STV-LP-5 | ❌ | C | — |
| STV-LP-6 | ❌ | C | — |

### §12 Loading, error and empty states

| ID | verdict | how | note |
|---|---|---|---|
| STV-LD-1 | ✅ | B | Skeleton facet grid and header placeholder while counting |
| STV-LD-2 | 🐞 ok | C | All unknown → the API's named refusal, not the generic error page (legacy bug not copied) |
| STV-LD-3 | 🔶 | C | Some unknown → whole request refused, "Deselect it to continue"; legacy works on the valid ones |
| STV-LD-4 | 🟡 | B | "counting…", "updating…"; no step list |
| STV-LD-5 | N/A | C | Cohorts are definitions; no stored sample list to go stale (sample-list cohorts report unmatched ids when made) |
| STV-LD-6 | ✅ | C | 0 samples: the portal's two-paragraph message, no charts, the filter bar kept ([empty-caselists-cases](empty-caselists-cases.md) EM1–EM5). Legacy "Rendering" spinner bug not present → also 🐞 ok for that clause |
| STV-LD-7 | ❌ | C | ↓ No tour component; the portal's tour is a feature, not a bug, so missing rather than 🐞 ok |

### §13 Modes & conditions

| ID | verdict | how | note |
|---|---|---|---|
| STV-MD-1 | 🟡 | B | Single study: the study's name, first line of the description, PubMed link and ⊕ (`explore-study-header.tsx`) ✅; no study download icon; the query uses the dialog's profiles, not `<study>_all` |
| STV-MD-2 | ✅ | B | Multi: counts summed, "(overlap not deduplicated)" (invariant 3), Studies card, panel-aware freqs; Genomic-freq legacy bug absent |
| STV-MD-3 | ❌ | C | No virtual studies |
| STV-MD-4 | ❌ | C | — |
| STV-MD-5 | 🟡 | B | "N filters · M patients match"; query dialog carries the filters as clauses (not case_ids) |
| STV-MD-6 | ✅ | C | See LD-6 |
| STV-MD-7 | ❌ | C | No manual submit |
| STV-MD-8 | 🔶 | C | Logged out: Explore works; saving cohorts / id lists need sign-in |
| STV-MD-9 | 🔶 | C | Logged in: Saved work (cohorts, analyses), no layout |
| STV-MD-10 | N/A | C | No session service concept |
| STV-MD-11 | ❌ | C | No download-hide switch (tracked: Data-governance switches) |
| STV-MD-12 | ✅ | C | Patients and samples counted separately (`uniqExact` each, `explore.ts:1030`) |
| STV-MD-13 | ✅ | C | The Clinical Data tab with its Columns menu (CD-9); no Custom Selection (out of this lane) |
| STV-MD-14 | 🟡 | C | ↓ The CN Segments tab hides Add chart, as the portal's ✅; no Plots, Files & Links or Similarity Maps tabs, and no Custom Selection to keep |

### §15 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| STV-STM-1 | ✅ | BC | Server-side: clauses ANDed, values ORed, bars of one chart too (#188); one cohort set per study, patient clauses select the patients' samples; counts identical (Q2, Q3) |
| STV-STM-2 | ✅ | B | Samples = distinct sample ids, patients = distinct patients owning a selected sample, per study (594/594, 280/280, 1,678/1,678) |
| STV-STM-3 | 🟡 | B | Clinical: samples with data × 100 ÷ selected samples, a patient attribute counted per selected sample of its patients (AC1; fixture check `check:chart-freq`). Genomic options: no Genomic tab |
| STV-STM-4 | ❌ | B | No profile select with sample counts |
| STV-STM-5 | 🟡 | B | Study ID, Patient ID, Sample ID, then every attribute by display name, NA where missing; checked cell by cell against the portal's API for brca_tcga_pan_can_atlas_2018 (1,084 × 60, no difference). Attributes in priority order and rows by patient id, not the API's order (PC9, PC10) |
| STV-STM-6 | 🟡 | BC | Query hand-off: studies + filters as the Results page's case clauses (`StudyPicker`, `explore-sections.tsx:83-86`); profiles from the dialog |
| STV-STM-7 | 🔶 | C | Custom data is uploaded per dataset (id, value rows) and joined to clinical reads; no "Unselected"/`custom_value` defaulting |
| STV-STM-8 | ❌ | C | Default name "explored cohort" / "all of <study>" (`use-explore-state.ts:172-174`), not built from the filters |
| STV-STM-9 | ❌ | C | No VS description |
| STV-STM-10 | ❌ | C | No group counts |
| STV-STM-11 | ✅ | C | Gene × sample limit 1,000,000 refused in the query dialog in legacy's words (PORTAL-PARITY, ticked) |
| STV-STM-12 | 🐞 ok | C | No row limit (the table pages in the database) and no 500-row download cap (clinical-tab-cases CT7, CT9, CT12) |
| STV-STM-13 | ✅ | BC | Offered when a selected study holds segments (the study list's `seg` flag), at 0 selected samples too ("No segmented copy-number data for the selected 0 samples."), read for at most 20,000 selected samples |

---

## 5. cBioLab bugs (on its own terms)

Fixed since the first audit (#189): the filters can now be shared and restored (Copy link and a reload keep them). The 30-study-summary bugs of 2026-11-11 are fixed too (#188).

Found on 2026-11-18 (master `bc53b944`):
- **The Clinical Data tab cannot change its columns**: Add chart is in the Summary block, hidden on that tab (`app/lab/page.tsx:572, 584`), and the table has no menu of its own (STV-CD-9, STV-MD-13).
