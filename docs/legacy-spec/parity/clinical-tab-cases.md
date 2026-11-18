# Study View Clinical Data tab: cases

The rules for the Explore page's Clinical Data tab, case by case, from the legacy frontend
(`cbioportal-frontend` at `cd8c6df`). Each row is a test. ⚠ marks a deliberate difference from the
portal, with the reason.

Sources:

| Abbreviation | File |
|---|---|
| CDT | `src/pages/studyView/tabs/ClinicalDataTab.tsx` |
| SVP | `src/pages/studyView/StudyViewPage.tsx` |
| SVU | `src/pages/studyView/StudyViewUtils.tsx` |
| LMT | `src/shared/components/lazyMobXTable/LazyMobXTable.tsx` |
| SER | `src/shared/lib/Serializer.tsx` |
| STU | `packages/cbioportal-frontend-commons/src/lib/StringUtils.ts` |

The table is the clinical `table` view over the selection (the patient-level path,
docs/DATA-BOUNDARY.md), drawn by the shared `DataTable`; the columns, document, cells and file are
built in `lib/study-view-clinical-tab.ts` and `lib/study-view-case-files.ts`.

| # | Case | Rule | Source |
|---|---|---|---|
| CT1 | Tabs | Summary, then Clinical Data, under the filter bar. Clinical Data is not offered when the selection holds no sample. Summary is the default. ⚠ The tab is not in the URL (the portal's path is `/study/clinicalData`) | SVP:747-870; STV-TAB-1 |
| CT2 | Columns | Patient ID, Sample ID, then one column per visible clinical-attribute chart, by priority, highest first, then by display name (`localeCompare`). A chart that is not a clinical attribute (gene, generic assay, density, survival) has no column. When several studies are selected each row also names its study, as the shared table does (⚠ the portal adds "Cancer Study" when its Cancer Studies chart is shown) | CDT:202-280; SVU:2799-2836 |
| CT3 | Missing value | An empty cell shows a grey "—" whose tooltip reads "No data available" | CDT:100-110 |
| CT4 | A link | A value starting `http://` or `https://` is a link opening in a new tab | CDT:111-117; STU:92-95 |
| CT5 | Ids | Patient ID links to the patient's page, Sample ID to the sample's, each in a new tab | CDT:208-240 |
| CT6 | Page | 20 rows a page. The count reads "N results": the rows the search keeps | CDT:331-345 |
| CT7 | Search and sort | Done in the database, over every row; sorting by Patient ID or Sample ID sorts by the id. ⚠ No 500-row cap and no "maximum viewable records" message: every row pages | CDT:143-180, 467-478 |
| CT8 | No column menu or column filters | The columns follow the charts: adding or removing a chart changes them. The table has no column chooser and no per-column filter | CDT:400 (`showColumnVisibility={false}`) |
| CT9 | ⚠ Too many samples | Not applied: the table pages in the database, so no row limit is needed (the portal refuses past 6,500,000 ÷ attributes rows) | CDT:368-390; STV-STM-12 |
| CT10 | Download name | `<study>_clinical_data.tsv`, or `combined_study_clinical_data.tsv` for several studies | CDT:425-428; SPS `clinicalDataDownloadFilename` |
| CT11 | Download header | Patient ID, Sample ID, then (several studies) Cancer Study, then each column's display name, tab-separated | LMT:386-392; CDT:244-252 |
| CT13 | One column per attribute | An attribute charted at both levels (several studies, one recording it per patient and another per sample) is one column, where its first chart in the CT2 order puts it | review of #274 |
| CT12 | Download lines | Every row the search keeps, in the table's sort; a missing value is empty (not NA); each line, the header and the last included, ends in CRLF. ⚠ The portal writes at most 500 rows (its download fetcher's cap, a legacy bug) | LMT:393-430; SER:3-28; CDT:445 |
