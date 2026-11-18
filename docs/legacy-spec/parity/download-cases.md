# Study View chart downloads: cases

The rules for a Study View chart's ☰ › Download, case by case, from the legacy frontend
(`~/cbioportal-frontend` at `cd8c6df`). Each row is a test. ⚠ marks a deliberate difference
from the portal, with the reason.

Sources:

| Abbreviation | File |
|---|---|
| ST | `src/pages/studyView/tabs/SummaryTab.tsx` |
| SPS | `src/pages/studyView/StudyViewPageStore.ts` |
| SVU | `src/pages/studyView/StudyViewUtils.tsx` |
| CH | `src/pages/studyView/chartHeader/ChartHeader.tsx` |
| DC | `packages/cbioportal-frontend-commons/src/components/downloadControls/DownloadControls.tsx` |

The rows are built in `lib/study-view-download.ts`.

## Which charts offer what

| Chart | Portal's entries, in order | Here |
|---|---|---|
| Pie, clinical table (categorical) | Summary Data, Full Data, SVG, PDF (ST:231-239, 391-399) | Summary Data, Full Data (clinical), SVG, PDF |
| Bar (numeric) | Data, SVG, PDF (ST:306-316) | Data (clinical), SVG, PDF |
| Density | Data, SVG, PDF (ST:783-848) | Data, SVG, PDF |
| Survival | Data, SVG, PDF (ST:651-663) | Data, SVG, PDF |
| Mutated / CNA / SV gene tables | Data (ST:483-626) | with the gene tables' rows (every gene) |
| Data Types, Case Lists | none (ST:635-650) | none |

## Summary Data (SD)

| # | Case | Rule | Source |
|---|---|---|---|
| SD1 | Menu | "Download" is the chart menu's last item, a submenu listing the entries in the order above | CH:274-281, 610-677 |
| SD2 | File name | The chart's name with each space and each tab replaced by `_`, then `.summary.txt`. Other characters are kept (`TP53: Mutations` → `TP53:_Mutations.summary.txt`) | CH:102-103; DC:175-183 |
| SD3 | Header | `Category`, `Number of samples`, `Percentage of samples`, tab-separated. Say `patients` instead of `samples` for a patient-level chart (lower case) | SPS:10417-10422 |
| SD4 | A row | One per category: the value, its count, its percentage. The value is written as stored, not as shown | SPS:10424-10431 |
| SD5 | Percentage | `count ÷ (sum of every category's count) × 100`, NA's count included in the sum, written as `portalFreq` writes it | SVU:2468-2483, 1982-1997 |
| SD6 | Percentage strings | Below 0 or not a number → `NA`; 0 → `0%`; from 99.9 up to but not including 100 → `99.9%`; from 0.1 → one decimal and `%` (100 → `100.0%`); otherwise → `<0.1%` | SVU:1982-1997 |
| SD7 | Order | By count, highest first. A value that reads `na` once trimmed and lower-cased goes last whatever its count. Ties keep the order the counts arrived in | SVU:2471, 2781-2792 |
| SD8 | NA | The cases with no value are a category of their own, `NA`, when there are any | SPS:5594-5684 (the backend counts NA) |
| SD9 | No categories | Header only. The file is still saved | DC:191-193 (only `''` is not saved) |
| SD10 | Layout | Lines end in LF, with no line ending after the last. No quoting or escaping. Counts are plain integers, with no thousands separators. UTF-8, no BOM | SVU:2468-2483 |
| SD11 | Several studies | One row per category, counts added across studies; no study column | SPS:5594-5684 |
| SD12 | A chart under its own filter | The counts the chart shows: freed of its own filter, counted over the rest | SPS:5594-5684 (the count leaves the chart's own filter out) |
| SD13 | ⚠ Values cut | The page holds a categorical chart's 200 most frequent values. When a chart has more, Summary Data is offered but disabled, and says how many it holds of how many. A file that silently left values out would read as complete. The portal has no cap | cBioLab (`FACET_VALUE_LIMIT`, `lib/explore.ts`) |
| SD14 | ⚠ Gene-state charts | Category is the state as the chart names it (`Mutated`, `Not mutated`, `Not profiled`, …). The portal writes its backend codes here (`MUTATED`, `NOT_PROFILED`, `-2`), while its Full Data and screen use names | SPS:10424-10431 vs SVU:2050-2061 |
| SD15 | ⚠ Values cut across studies | Each study sends its 200 most frequent values. When their union holds more than 200, the merged chart keeps the 200 most frequent, and its count of values (`distinct`) is at least the union's size. The cut therefore shows, both in "showing N of M values" and in SD13, even when no single study had more than 200 | cBioLab (`mergeExplore`, `lib/explore.ts`) |
| SD16 | ⚠ Generic-assay values cut | A categorical generic-assay chart keeps its 30 most frequent values and reports how many it has, so SD13 applies to it too | cBioLab (`ASSAY_VALUE_LIMIT`, `lib/explore.ts`) |

## SVG and PDF (FG)

Further source: PC = `src/pages/studyView/charts/pieChart/PieChart.tsx`, CC =
`src/pages/studyView/charts/ChartContainer.tsx`, BC = `src/pages/studyView/charts/barChart/BarChart.tsx`.
The figures are built in `lib/study-view-figures.ts`.

| # | Case | Rule | Source |
|---|---|---|---|
| FG1 | Entries | Pie and table charts: Summary Data, then SVG, then PDF (Full Data comes with the per-case files). Bar, density and survival charts: SVG, PDF (their Data with the per-case files). Gene tables, Data Types, Case Lists: no SVG or PDF | ST:231-239, 306-316, 391-399, 651-663, 783-848 |
| FG2 | File names | The chart's name with each space and tab as `_`, then `.svg` or `.pdf` | CH:102-103; DC:153-173 |
| FG3 | An SVG file | A standalone SVG document (`xmlns`, `width`, `height` and `viewBox` set), its text in the figure's own font, no stylesheet needed to read it | DC:114-130 (`excludeCss`, saveSvgAsPng) |
| FG4 | A PDF file | The same figure as vectors, on one page the figure's size, landscape when wider than tall | svgToPdfDownload.ts:19-56 |
| FG5 | Pie | The pie, then its legend below: the chart's title, then one entry per slice, "<value>: <count> (<share>)", the value as stored and the share as `portalFreq` writes it, in the slices' order, each with its slice's colour. The wider of pie and legend sets the width; the narrower is centred | PC:130-136, 265-299; SVU:1285-1332 |
| FG6 | A table chart | Saved as the pie of its values (FG5), not as the list | CC:445-449, 652-685 |
| FG7 | Bar | The bars as this page draws them: the same bins, each bar's height its count over the tallest with at least 2% of the plot (so a bar of 1 stays visible), every bar in the one colour, the NA bar among them when Show NA is on, otherwise the page's "NA <count>" note beside them; the tick labels the card shows. No legend | BC:88-90, 347-366 (the portal's heights are strictly in proportion and its note reads "NA: <count>") |
| FG8 | Density | The plot as drawn, with its colour legend ("# samples", its top, middle and bottom counts) and, when shown, the Pearson and Spearman lines, inside the one SVG | CC:1523-1536; StudyViewDensityScatterPlot.tsx:102-110 |
| FG9 | Survival | The KM figure as drawn, with its legend | SurvivalChart.tsx:249-254 |
| FG10 | ⚠ Selection colouring | The figure is the chart as this page draws it. The portal greys a pie's unselected slices in its saved figure; this page doesn't grey them on screen (the pie work is on hold), so neither does the file | PC:144-174 |
| FG11 | Text room | A saved pie's legend is sized for a fallback font (18% wider than IBM Plex Sans measures), so a viewer without Plex (DejaVu Sans, Arial) doesn't cut a long value off at the right edge | cBioLab (`FALLBACK`, `lib/study-view-figures.ts`) |
| FG12 | ⚠ PDF font | The PDF's text is IBM Plex Sans, embedded. Only its regular weight is embedded, so a bold title prints regular (the portal's PDF uses its page font) | cBioLab (`pdfFonts`, `app/lab/chart-files.ts`) |
| FG13 | Number at risk | Under the KM figure, a count that would touch the one before it (the first is pulled in at the plot's left edge) is left out, as the thinned ticks are | cBioLab (`riskTable`, `lib/views/survival/figure.ts`) |

## Per-case files (PC)

Further source: CC as above; DCN = `packages/cbioportal-frontend-commons/src/components/downloadControls/DownloadControls.tsx`
(same file as DC). The file's rows come from the clinical `table` view through `POST /api/table` with a
`format` (the patient-level path, docs/DATA-BOUNDARY.md); the doc, header and lines are built in
`lib/study-view-case-files.ts`.

| # | Case | Rule | Source |
|---|---|---|---|
| PC1 | Entries | A clinical pie or list chart: Summary Data, Full Data, SVG, PDF. A clinical bar chart, the density chart and the survival chart: Data, SVG, PDF. The header's "Download clinical data" button beside View patients. Gene-state and generic-assay charts: not yet (their values are not clinical rows) | ST:231-239, 306-316, 391-399, 651-663, 783-848; STV-AB-4 |
| PC2 | File names | Full Data: the chart's name (spaces and tabs as `_`) then `.full.txt`. Data: the name then `.txt`. Clinical data: `<study>_clinical_data.tsv` for one study, `combined_study_clinical_data.tsv` for several | DCN:175-183 (`buildFileName`; Data's click passes no type); STV-AB-4 |
| PC3 | Layout | Tab-separated, lines end in LF, no line ending after the last, no quoting, UTF-8. A missing value is `NA`. ⚠ A tab or line break inside a value is written as a space (the portal writes it as is, which splits the row) | SPS:10498-10531, 11396-11424 |
| PC4 | Full Data header | `Study ID`, `Patient ID`, then `Sample ID` for a sample attribute (not for a patient attribute), then the chart's attribute's display name | SPS:10498-10507 |
| PC5 | Full Data rows | One per selected case that has a value for the attribute: per sample for a sample attribute, per patient (once, however many of its samples are selected) for a patient attribute. A case with no value is left out (the portal's rows are the recorded values `fetchClinicalData` returns): every recorded value, a NUMBER attribute's `>89` or `high` included. Fixture: KI67_INDEX lists 6 samples (10, 20, 30, >90, high, high) | SPS:10476-10496, 10511-10527 |
| PC6 | Bar Data | A clinical bar chart's Data is its Full Data (PC4, PC5) under PC2's Data name | ST:325-326; SPS:10533-10544 (no type → full) |
| PC7 | Density Data | `Cancer Study`, `Patient ID`, `Sample ID`, the x attribute's display name, the y attribute's, x and y as the chart draws them (swapped after Swap Axes). One row per selected sample with both values recorded, whatever they are (`getSampleToClinicalData`, not the plot's points); a sample missing either is left out | SVU:746-780, 4999-5015 |
| PC8 | Survival Data | `Study ID`, `Patient ID`, `<PREFIX>_STATUS`, `<PREFIX>_MONTHS`: the attributes' ids, not their names. One row per selected patient, `NA` where a value is missing | SVU:5017-5080; SPS:10366-10369 |
| PC9 | Clinical data | `Study ID`, `Patient ID`, `Sample ID`, then every clinical attribute the studies record, sample and patient, by display name (an attribute in several studies once). One row per selected sample, carrying its patient's values; `NA` where missing. ⚠ Attributes in priority order (the portal: as its API lists them); at most 200 of them (`TABLE_COLUMNS_MAX`; the widest study records 170) | SPS:11339-11424; STV-STM-5 |
| PC10 | ⚠ Row order | By patient id, then sample id, as the clinical table orders them (the portal: the order its API returns the selected cases) | cBioLab (`clinicalRowSource`) |
| PC11 | Several studies | One file; each row names its own study | SPS:10511-10527 |
| PC12 | ⚠ Studies that may not list patients | They contribute no rows, as on the Clinical Data tab; the page says which were left out and why. The portal has no such studies | cBioLab (docs/DATA-BOUNDARY.md) |
| PC13 | No case selected | The header alone (the portal saves nothing for an empty clinical-data download) | SPS:11340-11342 |
| PC14 | A download cut short | The page says it failed and saves nothing, rather than a file that reads as whole: the route ends a file it could not finish with a `# DOWNLOAD INCOMPLETE` line, and says how many line breaks a whole file holds (`caseFileLineBreaks`: the rows in the chart layout, whose lines each start with one; the rows plus the header's in the table layout, where every line ends with one), so a file cut off in transit is caught too | cBioLab (`/api/table`) |
| PC15 | Attributes past the table's limit | A clinical-data file (every attribute) holds at most 200 (the table's limit); the page says how many of how many it holds. A file of named columns (a chart's Full Data or Data, the Clinical Data tab's) says nothing of it, whatever the study holds | cBioLab (TABLE_COLUMNS_MAX); review of #311 |
