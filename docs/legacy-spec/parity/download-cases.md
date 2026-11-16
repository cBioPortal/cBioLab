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
| Pie, clinical table (categorical) | Summary Data, Full Data, SVG, PDF (ST:231-239, 391-399) | Summary Data |
| Bar (numeric) | Data, SVG, PDF (ST:306-316) | later (a per-case file) |
| Density | Data, SVG, PDF (ST:783-848) | later |
| Survival | Data, SVG, PDF (ST:651-663) | later |
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
