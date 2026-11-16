# Study View: the empty selection and the Case Lists chart, cases

The rules, case by case, from the legacy frontend (`~/cbioportal-frontend` at `cd8c6df`) and
backend (`~/cbioportal`). Each row is a test. ⚠ marks a deliberate difference from the portal, with
the reason.

Sources:

| Abbreviation | File |
|---|---|
| ST | frontend `src/pages/studyView/tabs/SummaryTab.tsx` |
| SPS | frontend `src/pages/studyView/StudyViewPageStore.ts` |
| PM | backend `src/main/resources/mappers/clickhouse/patient/ClickhousePatientMapper.xml` |
| SU | backend `src/main/java/org/cbioportal/legacy/service/util/StudyViewColumnarServiceUtil.java` |

## The empty selection (EM)

| # | Case | Rule | Source |
|---|---|---|---|
| EM1 | No sample selected | When the filters leave no sample, the charts are not drawn. A box shows two paragraphs: "The filters you have selected have filtered out all the samples in this study; because of this, no data visualizations are shown." and "You can remove filters in the header of this page to widen your search criteria and add samples back to your results." | ST:1199-1216 |
| EM2 | The filters stay | The filter bar, with each filter's ✕ and Clear All Filters, is still shown, so a filter can be removed | ST:1199-1216 (the message names "the header of this page") |
| EM3 | Some samples selected | No message; the charts are drawn | ST:1199 (`length === 0`) |
| EM4 | Still loading | No message until the selection's count is known | ST:1199 (`selectedSamples.isComplete`) |
| EM5 | Legacy bug, not copied | The portal leaves its "Rendering" progress spinner turning below the message | 31-study-view-shell STV-LD-6 |

## Case Lists (CL)

| # | Case | Rule | Source |
|---|---|---|---|
| CL1 | A row | One per kind of case list: the list's stable id less its `<study>_` prefix (`coadread_tcga_pan_can_atlas_2018_cnaseq` → `cnaseq`) | PM:20-32 |
| CL2 | The count | The list's samples among the selected samples. Samples, not patients. Counted as distinct samples; the portal counts rows, which is the same here since no list in the warehouse holds a sample twice | PM:20-32 (`count(sample_id)`), SPS:10884-10905 |
| CL3 | A list with no selected sample | No row | PM:20-32 (the filter is on the joined samples) |
| CL4 | A list with an empty name | Never arises: the warehouse holds none (0 of its lists), and the importer names a list without a name by its id (`packages/importer/src/study.ts:135`). Not filtered | PM:31 (`label != ''`) |
| CL5 | Every list | No cap on the number of rows | PM:20-32 |
| CL6 | Several studies | Lists of the same kind are one row: their counts added, named after one study's list | SU:99-121 |
| CL7 | Columns | Name (the list's name), `#` (the count), Freq: the count ÷ the selected samples, written as `portalFreq` writes it | SPS:10884-10905; MultiSelectionTable `getFrequencyStr` |
| CL8 | Order | By count, highest first. Ties by the kind's id, A to Z (the portal's tie order is a hash map's, so not reproducible) | STS-OT-1 (default sort Freq, descending) |
| CL9 | Picking lists | The checked lists filter as one "any of" clause | SPS `addCaseListsFilter` |
| CL10 | ⚠ Shown by default | The portal charts Case Lists only when the page opens filtered on one. Here it is always shown, below the other charts, so its counts can be read without going through Add chart | STS-OT-2 |
