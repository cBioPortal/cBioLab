# Parity audit — Study View › shell, filters, actions, other tabs (spec `31-study-view-shell.md`)

- **Date:** 2026-11-11; re-scored 2026-11-16
- **cBioLab:** master @ `3ff57c37`, `next dev` on `http://127.0.0.1:3000` (first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org v7.2.3 (Playwright, logged out, 2026-11-11)
- **Study View equivalent in cBioLab: Explore** — `/lab?tab=explore&study=<id[,id…]>` (homepage "Explore selected studies", `app/_home/query-flow.tsx:20`). No `/portal/study` route. Explore is a single page: study picker + filter bar + facet grid. **None of the Study View's other tabs exist on it** (Clinical Data, CN Segments, Plots, Heatmaps, Files & Links, Similarity Maps, resource tabs). Their nearest equivalents live elsewhere and are noted per ID: the Analysis tab's `table`, `plot` and `segments` views; Results › CN Segments.
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
| ✅ match | 14 |
| 🟡 partial | 26 |
| 🔶 different | 11 |
| ❌ missing | 59 |
| 🐞 ok | 4 |
| 🐞 copied | 0 |
| N/A | 4 |
| ? | 0 |
| **Total IDs** | **118** |

**Overall: 18.6 %** (✅ 14 + 🐞ok 4 + N/A 4 = 22 of 118). Counting 🟡 as half: 29.7 %. (2026-11-11: 12.7 % / 23.7 %.)

Re-score of 2026-11-16: the rows PRs #191, #203 and #260 had already updated were checked again, and 5 more verdicts changed, all for the better (#188, #189). The filters now live in the URL, Copy link carries them, and a portal `#filterJson` or `filterAttributeId` link opens with its filters. Still missing: the Clinical Data tab, the clinical-data download, the Groups manager, virtual studies, Custom Selection on the page, the study header and per-user layout.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 URL | 5 | 1 | 1 | 1 | 2 | 0 | 0 | `?study=a,b`; filters in the URL, `#filterJson` and `filterAttributeId` read (#189); no sharedGroups |
| §2 Header (HD) | 4 | 0 | 1 | 2 | 1 | 0 | 0 | "Exploring — N studies · P patients · S samples" + id chips; no name, description, PubMed |
| §3 Filter bar (FB) | 9 | 2 | 4 | 0 | 3 | 0 | 0 | Pills named by chart, intervals edited in place (#191, #203); no Submit, no bookmark icon |
| §4 Action buttons (AB) | 6 | 1 | 1 | 2 | 2 | 0 | 0 | Counts ✅; View patients ✅; Save as a Cohort ≈ VS; no download, no ⚙ |
| §5 Custom Selection (CS) | 9 | 0 | 2 | 0 | 7 | 0 | 0 | Not on Explore; an id-list cohort exists in Analysis (sign-in) |
| §6 Charts menu (AC) | 8 | 0 | 4 | 1 | 3 | 0 | 0 | "Add chart" dialog: Clinical / Gene status / Generic assays / Derived / Custom data; no Freq column, no X vs Y |
| §7 Groups (GR) | 10 | 1 | 2 | 0 | 6 | 0 | 1 | No Groups menu; chart Compare entry points ✅ |
| §8 Virtual study (VS) | 6 | 0 | 2 | 1 | 3 | 0 | 0 | "Save as a Cohort": a name, saved to the library as a definition |
| §9 Bookmark (BM) | 3 | 1 | 2 | 0 | 0 | 0 | 0 | Copy link carries the filters; no bookmark modal or short URL |
| §10 Tabs (TAB, CD, CN, PL, RS) | 18 | 0 | 2 | 0 | 15 | 0 | 1 | No tabs on Explore |
| §11 Layout persistence (LP) | 6 | 0 | 0 | 0 | 6 | 0 | 0 | Chart picks are browser state only |
| §12 Loading / empty (LD) | 7 | 2 | 1 | 1 | 0 | 2 | 1 | Skeleton + refusals named; the portal's empty-selection message (#260) |
| §13 Modes (MD) | 14 | 3 | 2 | 2 | 5 | 1 | 1 | Single/multi fine; no VS, manual submit, tabs |
| §15 Statistics (STM) | 13 | 3 | 2 | 1 | 6 | 1 | 0 | Selected counts (bars of a chart OR) and query hand-off fine; no download, Add-chart Freq, VS text |

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
| Q4 empty | STM-1 | "Selected: 0 patients \| 0 samples" | draftCount 0, totals 0 / 0 | ✅ counts; no message (LD-6) |
| Q2 pill | FB-4 | "Sex : Female" | "CLINICAL SEX = Female ×" | 🔶 |
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
| STV-URL-1 | 🔶 | B | `/lab?tab=explore` (also `analysis`); no per-tab paths; `/lab?tab=cohorts` redirects to Explore + Saved work |
| STV-URL-2 | 🟡 | BC | `study=a,b` (comma list), `filters=1.…` (the filters, compressed), `#filterJson=` and `filterAttributeId` + `filterValues` read (SEX = Female → 280 patients) (#189); `drivers=1`, `custom=add`, `editCohort=<id>`; no sharedGroups / sharedCustomData / plots_* |
| STV-URL-3 | ✅ | BC | The filters live in the URL (`filters=1.…`) as the user filters, so a reload or a copied link keeps them (#189); the portal only through its bookmark link |
| STV-URL-4 | ❌ | C | URL read once on load (`page.tsx:340-346`); in-page study changes write the URL (`use-explore-state.ts:657-664`) |
| STV-URL-5 | ❌ | C | No localStorage hand-off; links carry the cohort definition (stored set / stored link past the address-bar limit, LINKS.md) — different mechanism, no "query is too large" alert |

### §2 Header

| ID | verdict | how | note |
|---|---|---|---|
| STV-HD-1 | 🔶 | C | Unknown study → loud refusal from `/api/explore` ("Explore cannot reach … Deselect it"), whole request, not a per-id banner (invariant 1) |
| STV-HD-2 | 🟡 | B | The study's name, or "Combined Study", under the Exploring row ([study-header-cases](study-header-cases.md) SH1). No study download icon: the portal's download server list is not readable here (SH9) |
| STV-HD-3 | ✅ | B | Description's first line (its links kept, other HTML dropped), "PubMed", ⊕ for the other lines or the studies' list; brca_tcga_pan_can_atlas_2018's name, description and PubMed ids match the portal's API ([study-header-cases](study-header-cases.md) SH2–SH8). Virtual-study origins: no virtual studies here |
| STV-HD-4 | 🟡 | BC | "Query genes…" button opens the gene query dialog (OQL, profiles, case set, product-limit refusal) carrying the filters; not an inline box, no gene-symbol click-to-queue |

### §3 Filter bar

| ID | verdict | how | note |
|---|---|---|---|
| STV-FB-1 | 🟡 | B | A pill per value or range with its × ✅; cBioLab's own pill style kept on purpose (not the portal's blue); no pending style (no manual mode, STV-FB-6) |
| STV-FB-2 | ✅ | B | "<chart> : a or b"; no word between charts, as the portal |
| STV-FB-3 | 🟡 | B | Clinical (incl. NA) named by the chart's display name, a pill per value or range; gene, GA, case-list, event and derived clauses still the generic pills; no group-filter or treatment pills |
| STV-FB-3a | ❌ | C | No survival-attribute pills (no survival filter) |
| STV-FB-3b | 🟡 | C | Density drag → two visible range pills (legacy: chart-only) |
| STV-FB-4 | 🟡 | B | "50 < x ≤ 60", "a ≤ x ≤ b", "> a", "≤ b", one value; ends edited in place (start > end swaps, start = end and empty refused), and an edit makes custom bins on the chart (#203). Separate ranges are separate pills (portal: one merged interval) |
| STV-FB-5 | ✅ | B | "Clear All Filters" removes every clause (keeps studies) |
| STV-FB-6 | ❌ | C | No manual mode / Submit (filters apply at once) |
| STV-FB-7 | ❌ | B | No bookmark icon; the header's Copy link carries the filters instead |

### §4 Selection summary and action buttons

| ID | verdict | how | note |
|---|---|---|---|
| STV-AB-1 | ✅ | B | Header counts patients and samples, `toLocaleString`; skeleton while counting; filter bar "N patients match" |
| STV-AB-2 | 🟡 | BC | "View patients" opens `/portal/patient` on the first patient with the cohort definition for stepping (`use-explore-state.ts:189-197`); same tab, not a new window; disabled reason shown |
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
| STV-AC-2 | 🟡 | B | Tabs Clinical · Gene status · Generic assays · Derived timeline filters · Custom data; no Genomic, X vs Y, Variant Annotations, per-GA-type tabs |
| STV-AC-3 | 🟡 | B | Checkbox · Attribute · **Freq** ("% samples with data") · Type · Level, ordered by Freq then name; a 0% row is greyed and cannot be checked; "Select all (N)" / "Deselect all" as the portal shows them; unchecking a chart clears its filter ([add-chart-cases](add-chart-cases.md) AC1–AC8). No info banner |
| STV-AC-4 | 🟡 | B | Clinical Freq for brca_tcga_pan_can_atlas_2018: all 60 attributes as the portal's API gives them; filtered to Sex = Male, the 3 the portal greys out. No Genomic tab yet |
| STV-AC-5 | 🟡 | B | Gene status: type a gene → mutation + CNA charts (≤6 genes); no profile select, gene sets, chart-type radios |
| STV-AC-6 | 🟡 | B | "Custom data" button / tab: upload and manage datasets, charted as facets; sign-in rules differ |
| STV-AC-7 | ❌ | B | No X vs Y |
| STV-AC-8 | 🟡 | C | Generic assays tab: profile select + entity search, one chart per entity (`AssayChartPicker`) |

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
| STV-GR-10 | ✅ | B | Every chart's "…" → Compare groups / Analyze groups, values → groups |

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
| STV-TAB-1 | 🟡 | B | Explore's Summary · Clinical Data tabs under the filter bar; Clinical Data not offered on an empty selection ([clinical-tab-cases](clinical-tab-cases.md) CT1). Not yet: CN Segments, Plots; the tab is not in the URL |
| STV-CD-1 | ✅ | B | "loading clinical data…" until the first page; later pages and queries cover the rows with "updating…" |
| STV-CD-2 | 🐞 ok | C | ⚠ No row limit: the table pages in the database ([clinical-tab-cases](clinical-tab-cases.md) CT9) |
| STV-CD-3 | 🟡 | BC | Patient ID and Sample ID (links), then each visible clinical-attribute chart by priority then name ([clinical-tab-cases](clinical-tab-cases.md) CT2, CT5). Several studies: the shared table's study column, not "Cancer Study". No header tooltip with description and id yet |
| STV-CD-4 | ✅ | BC | Grey "—" (tooltip "No data available"), http(s) values as links ([clinical-tab-cases](clinical-tab-cases.md) CT3, CT4) |
| STV-CD-5 | ✅ | B | "N results", 20 rows a page, the shared pager ([clinical-tab-cases](clinical-tab-cases.md) CT6) |
| STV-CD-6 | ✅ | B | Search and sort in the database over every row; ⚠ no 500-row cap or its message ([clinical-tab-cases](clinical-tab-cases.md) CT7) |
| STV-CD-7 | ✅ | B | Download `<study>_clinical_data.tsv` of the columns shown, every row the search keeps, the portal's table layout (CRLF, empty for missing); ⚠ without the 500-row cap ([clinical-tab-cases](clinical-tab-cases.md) CT10–CT12) |
| STV-CD-8 | ✅ | B | brca_tcga_pan_can_atlas_2018: "1,084 results", Patient ID, Sample ID, Cancer Type Detailed, Mutation Count, Fraction Genome Altered, Diagnosis Age, MSI MANTIS Score, MSIsensor Score, Overall Survival Status, Sex, Ethnicity Category, Race Category, Subtype, Tumor Type, … — the order the spec saw |
| STV-CD-9 | 🟡 | C | The columns follow the charts (Add chart changes both); no column menu or filters of the table's own ([clinical-tab-cases](clinical-tab-cases.md) CT8). The Add chart dialog is not reachable from this tab |
| STV-CN-1 | ❌ | B | No CN Segments on Explore (Results › CN Segments exists) |
| STV-CN-2 | ❌ | C | No .seg download (tracked under Per-sample CN segments) |
| STV-CN-3 | ❌ | C | — |
| STV-PL-1 | 🟡 | C | No Plots tab; Analysis `plot` view over the explored cohort via Analyze |
| STV-RS-1 | ❌ | C | (tracked) Files & Links |
| STV-RS-2 | 🟡 | C | Legacy hides it too (display:none); nothing to show |
| STV-RS-3 | ❌ | C | (tracked) |
| STV-RS-4 | ❌ | C | (tracked) |

### §11 Layout persistence

| ID | verdict | how | note |
|---|---|---|---|
| STV-LP-1 | ❌ | C | Chart picks are React state (`chartPicks`), lost on reload |
| STV-LP-2 | ❌ | B | — |
| STV-LP-3 | ❌ | C | — |
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
| STV-LD-7 | 🐞 ok | C | No tour component |

### §13 Modes & conditions

| ID | verdict | how | note |
|---|---|---|---|
| STV-MD-1 | 🟡 | B | Single study: chips, counts; no title/description/PubMed/download |
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
| STV-MD-13 | ❌ | C | No Clinical Data tab |
| STV-MD-14 | 🐞 ok | C | n/a tabs; nothing inconsistent to copy |

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
| STV-STM-13 | 🟡 | C | Not on Explore; Results › CN Segments has its own availability rule (tracked: hide the tab when no sample has segments) |

---

## 5. cBioLab bugs (on its own terms)

- Explore's filters cannot be shared or restored: Copy link drops the draft, and a reload loses it, although the page otherwise keeps its state in the URL (`?study=`, `?drivers=`). A cohort survives only via Save as a Cohort / Analyze.
- See also 30-study-summary §5 (bars of one histogram AND to 0; selected pie value cannot be unselected from the chart; numeric facet collapses under its own filter; constant attributes charted by default).
