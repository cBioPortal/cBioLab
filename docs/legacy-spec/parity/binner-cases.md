# Histogram bins: the case table

The rules a numeric chart's bars follow when its menu sets them (Custom Bins, Quartiles, Median
split, Generate bins, Log Scale) and the bins the MSI charts start with. Each row is an input and the
bars the portal draws for it, read from the legacy source, with the line it comes from. The tests
in `test/data-binner-spec.test.ts` are written from this table.

**Sources.** Server: `cbioportal/src/main/java/org/cbioportal/legacy/web/util/` (`DataBinner.java`
"DB", `DataBinHelper.java` "DBH", `LinearDataBinner.java` "LDB") and
`web/parameter/DataBinFilter.java`. Frontend: `cbioportal-frontend/src/pages/studyView/`
(`StudyViewUtils.tsx` "SVU", `StudyViewPageStore.ts` "SVPS", `StudyViewConfig.ts`,
`charts/barChart/CustomBinsModal.tsx` "CBM").

**Notation.** A bar is written `≤e` (values at or below e), `(s, e]`, `>s`, or `v` (one value,
start = end = v), each followed by its count. "1..20" is the integers 1 to 20, one sample each.

**Deviations** (marked ⚠) are rows where cBioLab deliberately differs from the portal; the row says
what the portal does and why we don't.

## The order a chart's bars are decided in (DB:345-430)

| # | Input | Bars | Source |
|---|---|---|---|
| D1 | 1..10 (10 distinct values), any method (median, quartile, custom [5]) | one bar per value: 1:1 … 10:1; the method is ignored | DB:359 (`uniqueValues.size() <= 10` first) |
| D2 | 1..11, median | ≤6:6, >6:5 (11 distinct is past the threshold, so the method applies) | DB:359, DB:376, DB:432 |
| D3 | no numeric values at all, any method | no bars | DB:363 (`!withoutOutliers.isEmpty()`) |
| D4 | 1..20, `bins` absent or null | the default bars (as without settings) | DB:365-381 (no method branch taken) |
| D5 | 1..20, disableLog with box range ≤ 1000 | identical to no settings | DB:385 only reads it on the log branch |

## Median split (DB:376, DB:432-438; DBH:182, DBH:197)

| # | Input | Bars | Source |
|---|---|---|---|
| M1 | 1..20 (n even) | ≤10.5:10, >10.5:10 (median is the mean of the middle two) | DBH:206-208 |
| M2 | 1..21 (n odd) | ≤11:11, >11:10 (median is the middle value, which goes to ≤) | DBH:204, DB:330 (`<=` holds the edge) |
| M3 | 1..10 and 11 × 10 samples (11 distinct, n = 20) | ≤10.5:10, 11:10 — the >10.5 bar holds only the integer 11, so it becomes a value bar | DB:345; DB:216 / DBH:432-468 check the outlier bars too |
| M4 | 1..15 with 10 more samples of 1 (n = 25) | median 3: ≤3:13, >3:12 — repeats weigh in the median | DBH:182 over every sample's value |
| M5 | 1..30 plus "<3" × 2, ">25" × 3 (recorded bounds) | ≤15.5:17, >15.5:18 — the median (15.5, of the 30 numbers) overrides both bounds; ≤15.5 holds the 2 "<3" and 1..15, >15.5 holds 16..30 and the 3 ">25" | DB:436-438 replace the outlier ends; the bound values keep their side's count, DB:495-501 |

## Quartiles (DB:378-380, DB:432-438; DBH:71-91, DBH:173-212)

Q1 is the median of the first ⌊n/2⌋ values, Q3 the median of the values after position ⌊n/2⌋ (one
further when n is odd); equal quartiles are dropped (DBH:83, DBH:87).

| # | Input | Bars | Source |
|---|---|---|---|
| Q1 | 1..20 | ≤5.5:5, (5.5, 10.5]:5, (10.5, 15.5]:5, >15.5:5 | DBH:173-200 |
| Q2 | 1..21 | Q1 = median(1..10) = 5.5, Q2 = 11, Q3 = median(12..21) = 16.5: ≤5.5:5, (5.5, 11]:6, (11, 16.5]:5, >16.5:5 | DBH:193 (odd n skips the middle) |
| Q3 | 1..10 and 20 × 30 samples (n = 40) | Q1 = 15, Q2 = Q3 = 20 → edges [15, 20]: ≤15:10, then the one bar (15, 20] holds only 20 and becomes the one-value bar 20:30 | DBH:87 drops Q3; DB:216 / DBH:432-468 make a bar of one integer value a value bar |
| Q4 | 1..4, 5 × 50 samples, 6..12 (12 distinct, n = 61) | Q1 = Q2 = Q3 = 5 → no bars between quartiles → falls back to the median split: ≤5:54, >5:7 | DB:432-438 (`QUARTILE && dataBins.size() == 0`) |
| Q5 | 1..10 and 11 × 40 samples (n = 50; 11 is also the maximum) | Q1 = Q2 = Q3 = 11 → median fallback: ≤11:50 only (the >11 bar is empty). Without the fallback the lower bar would end at the box range's low end (1), since DBH:156-163 drop the maximum when Q1 = Q3 = max | DB:432-438 |

## Custom bins (DB:365-368, DB:439-446, DB:576-602; LDB:64-80)

| # | Input | Bars | Source |
|---|---|---|---|
| C1 | 1..20, edges [5, 10, 15] | ≤5:5, (5, 10]:5, (10, 15]:5, >15:5 | LDB:72-80, DB:456-486 |
| C2 | 1..20, edges [10] (one edge) | ≤10:10, >10:10 | DB:441-446 |
| C3 | 1..20, edges [15, 5, 10] (typed out of order) | as C1: the box sorts what is typed before it is sent | CBM:82 `_.sortBy` |
| C4 | 1..20, edges [10, 20] (an edge on the maximum) | ≤10:10, (10, 20]:10 — no `>20` bar, it is empty | DB:207 adds the upper bar only when it holds something |
| C5 | 1..20, edges [-10, -5] (all below the data) | >-5:20 — the empty (-10, -5] is trimmed | DB:212, DBH:270-299 |
| C6 | 1..20, edges [100, 200] (all above the data) | ≤100:20 | DBH:270-299 trims the trailing empty bar |
| C7 | 1..20, edges [2.5, 7.5, 12.5] | ≤2.5:2, (2.5, 7.5]:5, (7.5, 12.5]:5, >12.5:8 | non-integer edges are kept as typed |
| C8 | 1..30 plus "<3" × 2 and ">25" × 3, edges [1, 5, 10, 28] | edges outside the recorded bounds are replaced by the bounds → [3, 5, 10, 25]: ≤3:5 (2 "<3" + 1, 2, 3), (3, 5]:2, (5, 10]:5, (10, 25]:15, >25:8 (3 ">25" + 26..30) | DB:576-602 (`adjustCustomBins`), DB:495-501 |
| C9 | as C8, edges [1] | the edge below the "<3" bound becomes 3, a single edge: ≤3:5, >3:30 (the ">25" values go to >3) | DB:576-602 then DB:441-446 |
| C10 | "1".."11" plus "2.0E-4", edges [5] | "2.0E-4" is the number 0.0002: ≤5:6, >5:6 | DB:306-311 (`NumberUtils.isCreatable`) |
| C11 ⚠ | 1..20, edges [5, 5, 10] (an edge typed twice) | cBioLab: as [5, 10]: ≤5:5, (5, 10]:5, >10:10. The portal sends the repeat (CBM:82 sorts, does not de-duplicate) and draws a bar `5:1` as well, so the value 5 is counted twice and the bars add to 21 of 20 samples (`calcRange` of (5, 5] is [5, 5], DBH:322) | — |

## Generate bins (DB:369-375; DBH:485-521)

Edges start at min + ((anchor − min) mod size) and step by size while below the maximum.

| # | Input | Bars | Source |
|---|---|---|---|
| G1 | 1..20, size 5, anchor 0 | edges 5, 10, 15: ≤5:5, (5, 10]:5, (10, 15]:5, >15:5 | DBH:506-518 |
| G2 | 1..20, size 5, anchor 3 | edges 3, 8, 13, 18: ≤3:3, (3, 8]:5, (8, 13]:5, (13, 18]:5, >18:2 | DBH:506-518 |
| G3 | 1..20, size 5, anchor 103 (above the data) | as G2: the anchor sets only where the steps fall | DBH:507-511 (remainder corrected to a modulo) |
| G4 | 1..20, size 5, anchor -7 (below the data) | as G2 (−7 ≡ 3 mod 5) | DBH:509-511 |
| G5 | 1..20, size 10, anchor 0 (one edge, 10) | one edge makes no bar, and unlike Custom a single generated edge is not a split: the lower bar ends at the box range's low end and holds only the value 1, so it is drawn as the value bar 1:1, and nothing else is drawn | DB:369-375 (no single-edge rule, DB:441 is CUSTOM only), DB:456-463 |
| G6 | 1..20, size 100 (no edge below the maximum) | 1:1, as G5 | DBH:515 never adds an edge |
| G7 | 1..20, size 2.5, anchor 0 | edges 2.5, 5, …, 17.5: ≤2.5:2, then (2.5, 5]:3, (5, 7.5]:2, (7.5, 10]:3, (10, 12.5]:2, (12.5, 15]:3, (15, 17.5]:2, >17.5:3 | DBH:515-518 |

## Log scale (DB:381-389)

| # | Input | Bars | Source |
|---|---|---|---|
| L1 | values whose box range exceeds 1000 (e.g. 0, 100, 200, … 3000), no settings | log bars (edges on powers of ten in half steps) | DB:381-389 |
| L2 | as L1, disableLog | linear bars: every interior bar the same width | DB:386 then DB:403-430 |
| L3 | as L1, disableLog and a method (median) | the method decides; disableLog changes nothing | DB:365-380 come first |

## Bars laid out once, counted again (STATIC: DB:48-60, DB:76-117)

| # | Input | Bars | Source |
|---|---|---|---|
| S1 | median over 1..20, then counted over the selection 1..5 | ≤10.5:5, >10.5:0 — a bar the selection empties stays, at 0 | DB:85-114 (counts reset, nothing trimmed) |
| S2 | custom [5, 10, 15] over 1..20, counted over 12, 13, ">25" | ≤5:0, (5, 10]:0, (10, 15]:2, >15:1 (a recorded ">25" goes to the upper bar) | DB:99-103 (`range.encloses`) |

## Words and NA in a numeric chart (DB:220-228, DB:255-281, DBH:340-344)

| # | Input | Bars | Source |
|---|---|---|---|
| W1 | 1..20 plus "Unknown" × 2, "unknown" × 1, median | ≤10.5:10, >10.5:10, then Unknown:3 (one bar, case aside, first spelling) | DB:264-281 |
| W2 ⚠ | 1..20 plus "NA", "nan", "N/A", custom [10] | cBioLab: ≤10:10, >10:10 — no NA spelling is a word bar; the chart's NA count is kept apart and drawn by Show NA. The portal's binner adds one bar "NA" holding every spelling (DB:225-227, `calcNaDataBin`), and its frontend hides it until Show NA | DB:260 (`!isNA`) |
| W3 | "9-10" (a range written as text) with 1..20, median | "9-10" is a word bar | not `isCreatable`, DB:260 |

## Spellings of one value (warehouse: 165 NUMBER charts hold a value spelled two ways, e.g. hdcn_msk_2025 CVR_TMB_SCORE "1" and "1.0")

| # | Input | Bars | Source |
|---|---|---|---|
| V1 ⚠ | "1" × 2, "1.0" × 3, 2..9 | cBioLab: one value, 9 distinct values, one bar per value: 1:5, 2:1 … 9:1. The portal counts distinct values with `LinkedHashSet<BigDecimal>` (DB:357), where 1 and 1.0 are unequal, so it counts 10, and draws two bars for one value | — |
| V2 | "1" … "20" with "5.0" in place of "5", median | same bars as M1: a value compares by its number | DB:94, Guava `Range.contains` uses `compareTo` |

## The chart menu (frontend)

| # | Input | Output | Source |
|---|---|---|---|
| F1 | bars (0,1], (1,3], (3,10], (10,31] | Log Scale offered (log-looking) | SVU:1564-1575, 1466-1478, 2016-2021 |
| F2 | bars (50, 100] | not log-looking: log10(50) = 1.7 | SVU:2018 (2 digits at ≥ 50), SVU:1475 |
| F3 | bars (10, 32] | log-looking: log10(32) rounds to 1.5 at one digit | SVU:2018 |
| F4 | bars (0.1, 1] | not log-looking (an edge strictly between −1 and 1, other than 0) | SVU:1473 |
| F5 | bars 1:…, 10:… (every interval bar one value) | not log-looking | SVU:1574, SVU:1488-1494 |
| F6 | bars ≤10, (10, 100], >100 | log-looking: outlier bars are left out | SVU:1374-1378 |
| F7 | no bars / undefined | not log-looking | SVU:1565, SVU:1469 |
| F8 | not log-looking bars, but Log Scale switched off | Log Scale still offered, so it can be switched back on | SVPS:4638-4648 (`disableLogScale \|\| isLogScaleByDataBins`) |
| F9 | Custom box start: bars ≤35, (35,40], (40,45], (45,50], >50, Unknown | "35, 40, 45, 50" — every numeric edge once, in order, words left out | SVPS `getCurrentBins`, SVU:4116-4131, CBM:54 |
| F10 ⚠ | Custom box start: bars ≤0, (0, 10], (10, 20] | cBioLab "0, 10, 20". The portal leaves 0 out (SVU:4121 `next.start !== 0`), so pressing Update unchanged moves the first edge to 10 | — |
| F11 | box "60, 40, 80.5" | edges [40, 60, 80.5] | CBM:82-86 |
| F12 | box empty or blanks only | the default bars (bins null) | SVPS:4761-4766 deletes `customBins`; DB:365 then takes no branch |
| F13 ⚠ | box "40, , 60" | cBioLab: [40, 60]. The portal reads the blank between the commas as 0 (`Number(" ".trim())`, CBM:85) | — |
| F14 | box "40, x, 60" | refused, naming "x" | SVU:2707-2714 (`isNaN`) |
| F15 | box "1e3" | 1000 | `Number("1e3")`, CBM:85 |
| F16 ⚠ | box "Infinity" or "0x10" | refused. The portal takes them (`Number`), then the server cannot read Infinity as a decimal | — |
| F17 ⚠ | Generate, size 0 or negative | refused. The portal sends it; size 0 divides by zero on the server (DBH:507) | — |
| F18 | Generate, anchor empty | anchor 0 | CBM:248-260 (`Number("")` is 0) |
| F19 | MSI_SCORE / MSI_SENSOR_SCORE / MSI_SCORE_MANTIS with no setting | custom edges [4, 10] / [4, 10] / [0.4, 0.6] | StudyViewConfig.ts:126-130, SVPS:6888-6891; default `binMethod` is CUSTOM (DataBinFilter.java:25) |
| F20 | MSI_SCORE with `bins: null` (reset) | the default bars | cBioLab: reset is a setting of its own |
| F21 | MSI_SCORE with disableLog only | the initial edges, with disableLog | the initial edges apply until bins are set |
| F22 | an attribute not in the initial list, no setting | no bins setting | StudyViewConfig.ts:126 |
| F23 ⚠ | box "1e400" | refused: past the largest number. The portal reads it as Infinity | `Number("1e400")` |
| F24 ⚠ | Generate, size "0x10" or anchor "Infinity" | refused, as F16 | — |
