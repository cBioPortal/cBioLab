# Parity audit — Results › CN Segments (spec `08-cn-segments.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright + `/api/copy-number-segments/fetch` from the page, same day)
- **Code paths (cBioLab):** `lib/views/segments/{run,sql,igv,types}.ts`, `lib/views/segments/README.md`, `app/lab/segments-igv.tsx` (igv.js **3.8.10**; legacy 2.11.2), `app/lab/kinds/segments.tsx`, `app/portal/results-layout.ts:165-181` (`cnSegmentsTab`, locus chooser), `lib/views/genome/` (extra view under the tab)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 | `/results/cnSegments?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS TP53` + API fetch (chr 12 and whole genome) for all 594 samples | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20NRAS%20BRAF%20TP53%20APC` › CN Segments; `POST /api/analysis` `{kind:"segments", gene:"KRAS"}` |

Scripts and output: (local scratch, not committed) (`legother.js seg`, `labui.js`, `out/lab-seg.png`, `out/lab-seg-wg.png`, `out/leg-seg.png`, `out/leg-seg.json`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 6 |
| 🟡 partial | 9 |
| 🔶 different | 4 |
| ❌ missing | 5 |
| 🐞 ok | 3 |
| 🐞 copied | 0 |
| N/A | 1 |
| ? | 1 |
| **Total IDs** | **29** |

**Overall: 34.5 %** (✅ 6 + 🐞ok 3 + N/A 1 = 10 of 29). Counting 🟡 as half: 50.0 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | ? | One line |
|---|---|---|---|---|---|---|---|---|---|
| §0 Visibility (0.x) | 3 | 0 | 2 | 0 | 1 | 0 | 0 | 0 | Tab always shown, even with no segments |
| §1 Controls (1.x) | 7 | 1 | 4 | 1 | 1 | 0 | 0 | 0 | Pills ✅ (Whole genome last); igv 3.8 navbar; no .seg download; row cap instead of the 20,000 rule |
| §2 Data (2.x) | 4 | 2 | 1 | 0 | 0 | 1 | 0 | 0 | Same samples (583 with segments), identical segment means |
| §3 Rendering (3.x) | 5 | 1 | 0 | 2 | 0 | 1 | 0 | 1 | 300 of 583 rows drawn by default; fixed 600 px; sample order differs |
| §4 Modes (MD) | 8 | 1 | 2 | 1 | 2 | 1 | 1 | 0 | Mixed builds refused (loud); multi-study id collision still merges rows in IGV |
| §6 Statistics (STM) | 2 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | Values identical; no segment file |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Row limit**: 300 of 583 segmented samples drawn by default ("ROW LIMIT … 283 are left out"; max 2,000); legacy draws every sample (up to 20,000 in Whole Genome) | 1.7, 3.1, MD-3 | not tracked |
| 2 | **Sample order differs**: internal-id order (TCGA-AF-2687-01 first; TCGA-3L-AA1B-01 at row 156) vs legacy API order (TCGA-3L-AA1B-01, -4N-A93T-01, …); README claims they are the same | 3.5 | not tracked |
| 3 | **No `.seg` download** | 1.2, STM-1, MD-8 | (tracked) "Drag-to-zoom, and the `.seg` download" |
| 4 | **Tab shown when no queried sample has segments** (view refuses inside the tab) | 0.1, MD-4 | (tracked) "Hide the tab when no queried sample has segments" |
| 5 | **Track height fixed 600 px** (FILL) beyond 40 samples; ≤40 expanded rows; legacy min(0.7 × window, n × 10) | 3.1 | not tracked |
| 6 | **Segment popup**: igv.js default, not "Sample / Mean CN log2 value / Location" (the patient overview has the portal's popup) | 1.6 | not tracked |
| 7 | Track named "Copy-number segments" (legacy "CNA"); extra "Refseq All" label; igv 3.8 navbar (Crosshairs, ROI, Sample Info, Save Image) vs 2.11 (Cursor Guide, Save SVG) | 1.3, 1.4 | not tracked |
| 8 | Chromosome select and search stay enabled on a gene pill (legacy disables them) | 1.3, MD-1 | not tracked |
| 9 | Extra "Genome-wide copy number" frequency view under the tab (not in legacy) | — | n/a (addition) |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Queried samples | 2.1 | 594 | 594 (`cohortSamples`) | ✅ |
| Samples with segments | 2.1 | 583 (chr 12 and whole genome) | 583 (`segmented`) | ✅ |
| Rows drawn (KRAS pill) | 3.1 | 583 | 300 (rows default), 283 left out | 🔶 |
| Segments, whole genome | STM-1 | 82,579 for 583 samples | 46,835 for the 300 drawn | — (row limit) |
| TCGA-3L-AA1B-01 segment over KRAS | STM-2 | chr12:889,902-105,791,604, 0.1127 | same, 0.1127 | ✅ |
| TCGA-4T-AA8H-01 | STM-2 | 889,902-29,334,049, 0.2075 | same | ✅ |
| TCGA-5M-AAT4-01 | STM-2 | 21,668,305-25,633,455, −0.0494 | same | ✅ |
| TCGA-5M-AATE-01 | STM-2 | 889,902-70,753,522, −0.1155 | same | ✅ |
| TCGA-5M-AAT6-01 | STM-2 | 889,902-133,161,346, 0.0003 | same | ✅ |
| KRAS locus | 1.3 | `chr12:25,357,179-25,404,870` | `chr12:25,357,180-25,404,863` | 🟡 (±7 bp; refGene span + 1 kb vs igv's own search) |
| Whole-genome locus | MD-2 | `all` | `all` | ✅ |

Data version: identical segment starts, ends and means for every sample compared.

---

## 4. Scorecard

### §0 Visibility and chrome

| ID | verdict | how | note |
|---|---|---|---|
| CNS-0.1 | 🟡 | BC | Label "CN Segments" ✅, multi-study allowed ✅; always laid out (`results-layout.ts` `cnSegmentsTab`), not hidden without segments (tracked) |
| CNS-0.2 | ❌ | C | No CaseFilterWarning (no Show-only-profiled setting exists) |
| CNS-0.3 | 🟡 | B | "loading the genome browser…" + updating cover; no two-step progress list |

### §1 Controls

| ID | verdict | how | note |
|---|---|---|---|
| CNS-1.1 | 🟡 | B | "locus" chips: KRAS NRAS BRAF TP53 APC, then "Whole genome" (legacy first); default first gene ✅; kept in the document |
| CNS-1.2 | ❌ | B | No download (tracked) |
| CNS-1.3 | 🟡 | B | IGV navbar: hg19, chr select, locus box, "47 kb", Crosshairs, Center Line, Track Labels, Sample Names, Save Image (PNG/SVG), zoom ✅; igv 3.8 set (ROI, Sample Info, Overlay/Select Tracks extra); chr select and search **enabled** on a gene pill |
| CNS-1.4 | 🟡 | B | Ideogram, ruler, "Refseq All", seg track "Copy-number segments" (not "CNA"); FILL when > 40 samples, EXPANDED otherwise (`segments-igv.tsx:26`) |
| CNS-1.5 | ✅ | C | igv's own track gear menu and seg-track "Sort by value" |
| CNS-1.6 | 🟡 | C | Results tab passes no `popupData` (`igv.ts:15-23`), so igv's default seg popup; headless click produced no popup to read |
| CNS-1.7 | 🔶 | C | No 20,000 rule; instead every view draws ≤ `rows` (300, max 2,000) and names the rest; > 250,000 segments refused |

### §2 Data

| ID | verdict | how | note |
|---|---|---|---|
| CNS-2.1 | ✅ | BC | Queried samples (594), 583 with segments, as legacy |
| CNS-2.2 | 🟡 | C | One query per view (whole-genome segments of the drawn samples, `segmentRows`), not per chromosome; same data |
| CNS-2.3 | ✅ | BC | chr normalized (23/24/chr prefix), start (0-based for igv), end, mean (4 dp) ✅ |
| CNS-2.4 | 🐞 ok | C | Each study's own build; mixed hg19/hg38 refused by name (`run.ts:160`) instead of drawing on the first study's genome |

### §3 Rendering

| ID | verdict | how | note |
|---|---|---|---|
| CNS-3.1 | 🔶 | BC | FILL height fixed 600 px past 40 samples; ≤ 40: 13 px (≤ 10: 24 px) rows; plus the 300-row cap |
| CNS-3.2 | ✅ | C | ±0.1 white, linear to red/blue at ±1.5 (`segmentColor`, igv default) |
| CNS-3.3 | 🐞 ok | C | `isLog: true` always (`segments-igv.tsx:25`), so all-positive sets are not miscoloured |
| CNS-3.4 | ? | — | Sub-pixel bar scaling depends on igv 3.8's SegTrack; not checked |
| CNS-3.5 | 🔶 | BC | Internal-id order (`ORDER BY sid`): TCGA-AF-2687-01 first, TCGA-3L-AA1B-01 at row 156; legacy API order starts TCGA-3L-AA1B-01; igv sort by value ✅; extra "order: most gained/lost first" |

### §4 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| CNS-MD-1 | 🟡 | B | Locus = gene ✅; chr select and search not disabled |
| CNS-MD-2 | ✅ | B | Whole genome: locus `all`, search enabled |
| CNS-MD-3 | 🔶 | C | No 20,000 refusal; row cap applies to every locus (see 1.7) |
| CNS-MD-4 | ❌ | C | Tab not hidden; the view refuses "no sample of this cohort has copy-number segments … the portal hides its CN Segments tab" (tracked) |
| CNS-MD-5 | N/A | C | No Show-only-profiled setting (RV-2) |
| CNS-MD-6 | 🟡 | C | One track; per-study build, mixed builds refused; rows keyed by study + id server-side, but igv features use the bare sample id (`igv.ts:18`), so same-id samples of two studies still merge into one IGV row (legacy bug copied in the drawing) |
| CNS-MD-7 | 🐞 ok | C | Gene with no refGene span → refusal naming it (`run.ts:168`), no endless spinner |
| CNS-MD-8 | ❌ | C | No download, so no switch (tracked: Data-governance switches) |

§5 Persistence (no IDs): the locus chip, row cap and order are in the document (invariant 9); igv zoom/pan/display mode are browser state, as legacy.

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| CNS-STM-1 | ❌ | C | No `.seg` file (tracked) |
| CNS-STM-2 | ✅ | BC | Raw segment means identical (5 samples checked); colour per 3.2; the extra `score` (bases-weighted mean over the region) is used only for the gained/lost order |

---

## 5. cBioLab bugs

- `lib/views/segments/README.md` and the caption say rows are in "the order `/api/copy-number-segments/fetch` returns them" / "as the portal lists them"; the portal's API order differs (CNS-3.5).
- Multi-study: igv rows keyed by bare sample id (`igv.ts:18`) merge two studies' samples with the same id, though the server keeps them apart.
