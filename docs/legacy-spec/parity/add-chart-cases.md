# Study View Add chart (Clinical tab): cases

The Explore page's Add chart ▸ Clinical list, as the portal's `AddChartByType` draws it
(`cbioportal-frontend` at `cd8c6df`). Each row is a test. ⚠ marks a deliberate difference.

Sources: ACB = `src/pages/studyView/addChartButton/AddChartButton.tsx`, ACBT =
`src/pages/studyView/addChartButton/addChartByType/AddChartByType.tsx`, FHT =
`src/pages/studyView/table/FixedHeaderTable.tsx`, SVU = `src/pages/studyView/StudyViewUtils.tsx`, SPS =
`src/pages/studyView/StudyViewPageStore.ts`. Rules in `lib/study-view-add-chart.ts`; the count in
`lib/explore.ts` (`samples` on each clinical facet).

| # | Case | Rule | Source |
|---|---|---|---|
| AC1 | Freq | `samples with data × 100 ÷ selected samples`. A sample attribute counts the selected samples with a value; a patient attribute counts every selected sample whose patient has a value (so a patient with two selected samples counts twice). Several studies: both sums run over every study. No selected sample → `NA` | ACB:197; SPS `dataWithCount`; backend `getClinicalAttributeCountsBySampleIds`; STV-STM-3 |
| AC2 | Freq text | As `portalFreq` (the portal's `getFrequencyStr`): 0 → `0%`, from 99.9 up to but not including 100 → `99.9%`, from 0.1 → one decimal, below → `<0.1%`, not a number → `NA`. Not capped at 100 | ACBT:211-212; SVU:1982-1997 |
| AC3 | Header | A "Freq" column after the name, its tooltip "% samples with data" | ACB:340-345; ACBT:187-195 |
| AC4 | Order | Freq, highest first; ties by name (`localeCompare`) | ACBT:85-87 |
| AC5 | Disabled | A row whose Freq is 0 is greyed and cannot be checked | ACBT:66-76, 142-152 |
| AC6 | Select all | "Select all (N)", N the rows the search keeps (disabled ones too); it checks the rows the search keeps that are not disabled. Hidden when the number checked equals the number of rows in the whole list | FHT:264-266, 369-380; ACBT:315-320 |
| AC7 | Deselect all | Unchecks every row the search keeps; hidden when none is checked | FHT:270-273, 369-380 |
| AC8 | Unchecking clears the filter | Unchecking a chart removes it and its filter: every top-level clause of the selection whose clinical clauses all name that attribute (a value pick, a range, its NA filter) is removed | STV-AC-3 ("unchecked → chart removed and its filter reset") |
