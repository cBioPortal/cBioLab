# The density chart, case by case

The Study View's "Mutation Count vs Fraction Genome Altered" chart (STS-SC-1…5, STS-STM-15), as
cBioPortal draws it, one row per branch of its code. Each row is an input and what the portal
shows, with the line it comes from. Rows marked ⚠ are deliberate differences: the row says what
the portal does and what cBioLab does instead.

Sources (paths under `~/cbioportal` and `~/cbioportal-frontend/src`):

- **BE** `src/main/java/org/cbioportal/legacy/service/impl/ClinicalDataDensityPlotServiceImpl.java`
- **XY** `src/main/java/org/cbioportal/domain/clinical_data/usecase/GetClinicalDataForXyPlotUseCase.java`
- **ST** `pages/studyView/StudyViewPageStore.ts`
- **SP** `pages/studyView/charts/scatterPlot/StudyViewDensityScatterPlot.tsx`
- **SU** `pages/studyView/StudyViewUtils.tsx`
- **TAB** `pages/studyView/tabs/SummaryTab.tsx`
- **PU** `shared/components/plots/PlotUtils.ts`

Notation: an axis's bin index is `i`, counted from 0. "MC" is MUTATION_COUNT and "FGA" is
FRACTION_GENOME_ALTERED. A bin is reported as `(i, j) n` with its real minimum and maximum
values when they matter.

## What the warehouse holds

Both attributes are always sample-level, typed NUMBER, with no sample holding two rows of
either. Both have a non-zero priority in every study (FGA 20 or 1, MC 30), so the chart is shown
whenever a study has both attributes; 313 studies do.

| Shape | MC rows | FGA rows | Example |
|---|---|---|---|
| integer | 335,429 | 1,066 | "12", FGA "0" |
| decimal | – | 247,383 | "0.0385" |
| exponent | – | 3,597 | acc_tcga_pan_can_atlas_2018 "2.0E-4" |
| empty | 78,380 | 14,110 | "" |

- FGA is never below 0 or above 1. 66 samples have exactly 1 and 11,396 have exactly 0.
- MC is always a whole number; the largest is 27,085 (acbc_mskcc_2015).
- coadread_tcga_pan_can_atlas_2018 has 594 samples with both values and a largest MC of 11,414.

## B. The bins (backend)

| # | Input | Portal | Source |
|---|---|---|---|
| B1 | The default chart | x = FGA, y = MC; a 44 × 38 grid (44 bins on x, 38 on y) | ST:8389-8398 (x FGA, y MC); ST:9923-9926 `ceil(263.282/6)`, `ceil(223.372/6)` |
| B2 | An FGA axis, data 0.2 and 0.4 | The axis runs from 0 to 1 whatever the data, so 0.2 is in bin 8 and 0.4 in bin 17. Bin 8 starts at 8/44 = 0.181818… | ST:9937-9962; BE:88-115, 124-125 |
| B3 | An MC axis, data 5, 10 and 38 | The axis starts at 0 and ends at the largest value (38), so the interval is 1: bins 5, 10, 37 | ST:9945-9949; BE:95-101 |
| B4 | Index rule: FGA 0.06818181818181818 (3/44) and 0.5454545454545454 (24/44) | Bins 2 and 23, not 3 and 24. The index is `(int)((v − start) / ((end − start) / count))`, the interval rounded first | BE:116-119, 134-135 |
| B5 | A value equal to the axis end: FGA 1, or the largest MC | The last bin (FGA 43, MC 37), not one past it | BE:136-140 |
| B6 | Every MC is 0 | Start = end = 0, the interval is 0 and the index NaN, which Java's `(int)` makes 0: every sample in bin 0 of y | BE:116-119, 134-135 |
| B7 | Every MC is 5 | Start 0, end 5: every sample is in bin 37 (the end), none in 0 | BE:95-101, 136-140 |
| B8 | Two samples (FGA 0.19, MC 2) and (FGA 0.2, MC 3), MC axis ending at 76 | One bin (8, 1) with count 2, minX 0.19, maxX 0.2, minY 2, maxY 3 | BE:141-162 |
| B9 | Bins nobody falls in | Not reported | BE:175-179 |
| B10 | A sample whose FGA or MC is empty | Left out of the chart altogether (both axes, the counts and the coefficients) | BE:40-48 (`isCreatable("")` is false) |
| B11 | FGA written "2.0E-4" | Read as 0.0002: bin 0 | BE:45-46, 195-196 |
| B12 | Log Scale on the MC axis, MC 0, 4 and 99 | Each value becomes ln(1 + v): 0, 1.609, 4.605. The axis runs from ln(1 + 0) = 0 to 4.605, so 4 is in bin 13 of 38 (bin 13 starts at 1.5755) and 99 in bin 37 | BE:60-67, 69-82, 102-115, 187-193 |
| B13 | Log Scale asked for on an FGA axis | Ignored by the server; the frontend never offers it | BE:60-67, 183-185; SU:4294-4296 |
| B14 | A selection made on this chart (or any filter on MC or FGA) | The chart is drawn over the whole selection, its own filters included: after a drag it shows only the chosen region | ST:9934 `studyViewFilter: this.filters`; TAB:791-798 |
| B15 | A patient-level attribute on an axis | Copied to every sample of the patient. Never reached here: both attributes are sample-level (see above) | XY:121-150 |

## S. Pearson and Spearman

| # | Input | Portal | Source |
|---|---|---|---|
| S1 | FGA 0.1, 0.2, 0.3, 0.4, 0.5; MC 1, 3, 2, 5, 40 | Pearson 0.7563, Spearman 0.9000, over every sample in the chart | BE:165-168 |
| S2 | The same, Log Scale on MC | Pearson over ln(1 + MC): 0.8669; Spearman unchanged, 0.9000 | BE:69-82, 165-168 |
| S3 | Ties: MC 1, 2, 2, 3, 3 | Tied values share their average rank: Spearman 0.9487 (Pearson 0.9449) | commons-math `SpearmansCorrelation` (NaturalRanking, ties AVERAGE) |
| S4 | p-value | Two-sided Student t on n − 2 degrees of freedom, t = \|r\|·√((n − 2)/(1 − r²)). r 0.5, n 10 → 0.1411; r 0.9, n 3 → 0.2871; r −0.3317, n 594 → 1.0e-16 | PU:462-482 |
| S5 | \|r\| = 1 | p = 0 | PU:467-469 |
| S6 | n | The sum of the bins' counts | SP:363-365 |
| S7 | n ≤ 2 | No correlation text (the p-value would be null) | SP:504-506 |
| S8 | Text | Four lines per coefficient block: "Pearson:", r to 4 places, "p=" and p to 2 places, then "Spearman:" the same way. A p below 0.005 reads "p=0.00" | SP:497-559 |
| S9 ⚠ | Every bin holds one sample (n > 2) | Portal: no correlation text, because the text is drawn inside the colour legend and there is no legend (C3). cBioLab: the text is shown whenever n > 2 | SP:427-431, 504 |
| S10 ⚠ | An axis with no spread (every MC 0) | Portal: commons-math returns NaN, shown "NaN" and "p=NaN". cBioLab: that coefficient's lines say "–" | BE:167-168; SP:497-502 |

## C. Colours and legend

| # | Input | Portal | Source |
|---|---|---|---|
| C1 | A bin of count c, counts from min to max | Fill `interpolatePlasma(0.75 · (ln c − ln min)/(ln max − ln min))`. Counts 1 and 34: count 1 #0d0887, count 34 #f89540 (plasma 0.75), count 10 #c9447a | SP:315-343 |
| C2 | Every bin has the same count, 5 | min is taken as 1: every bin is plasma(0.75) #f89540; the legend reads 5 and 1 | SP:319-322 |
| C3 | Every bin has count 1 | Every bin plasma(0) #0d0887, and no legend | SP:330-335, 428-431 |
| C4 | Legend | Title "# samples" above a vertical bar from plasma(0) at the bottom to plasma(0.75) at the top; the largest count at the top, the smallest at the bottom, in the browser's number format ("1,234") | SP:432-494, 575-579 |
| C5 | Counts 1 and 2 (max − min < 2) | No middle label; a shorter bar (38 px, else 68) | SP:461-465, 561-562 |
| C6 ⚠ | Middle label, counts 1 to 34 | Portal: `round(exp(0.5·(ln max − ln min)/0.75 + ln min))` = 10, the count whose colour is two-thirds up the bar, printed at its middle. cBioLab: the count at the middle, round(exp((ln max + ln min)/2)) = 6. (Counts 1 to 5: portal 3, cBioLab 2) | SP:339-340, 561-573 |
| C7 | A dot | One circle per non-empty bin, filling its cell: radius 3 px with the bins 6 px apart, drawn from the bin's start | SP:27-36, 390; ST:9919-9922 |

## A. Title, axes and empty state

| # | Input | Portal | Source |
|---|---|---|---|
| A1 | Title | "<Y name> vs <X name>": "Mutation Count vs Fraction Genome Altered" | SU:4305-4310 |
| A2 | Axis labels | The attribute's name, with " (log)" when that axis is on Log Scale: "Mutation Count (log)" | TAB:824-829 |
| A3 | Axis range | FGA 0 to 1; MC from 0. An end not fixed is the last bin's start plus (largest value − smallest value) / bin count (ST:9965-9970, SP:175-176). With Log Scale the MC axis is in ln(1 + count), and its ticks are those ln values | ST:7308-7330, 9971-9976; SP:130-184 |
| A4 | No sample has both values | "No data to plot." | SP:703-710 |

## T. Tooltip (hover a dot)

| # | Input | Portal | Source |
|---|---|---|---|
| T1 | A bin of 1,234 samples | First line "Number of Samples: 1,234" | SU:691-694 |
| T2 | x line, minX 0.19, maxX 0.2 | "<X name>: 0.19-0.20": both ends to 2 places | SU:675-684, 695-699 |
| T3 | x line, minX 0.2041, maxX 0.2049 | One value when the ends agree to 2 places: "0.20" | SU:678-682 |
| T4 | y line, minY = maxY = 1234 | "<Y name>: 1,234" | SU:649-664, 700-704 |
| T5 | y line, minY 3, maxY 4 | "(3, 4]" | SU:665-668 |
| T6 | y line on Log Scale, minY ln 5, maxY ln 6 | "Mutation Count (log): (1.609, 1.792]" (the browser's number format, 3 places at most) | SU:665-668, 700-704; TAB:830 |
| T7 | After Swap Axes, x is MC: minX 3, maxX 5 | "Mutation Count: 3.00-5.00" (the x rule, whichever attribute is on x) | SU:675-684 |
| T8 | The mouse button is down | No tooltip | SP:720 |

## M. The menu

| # | Input | Portal | Source |
|---|---|---|---|
| M1 | Swap Axes | x and y trade attributes, and their Log Scale settings go with them; the title becomes "Fraction Genome Altered vs Mutation Count" | ST:3132-3152 |
| M2 | Log Scale X / Log Scale Y | Offered only for an axis holding MC, off at first; the FGA axis has none | TAB:800-819; SU:4294-4296 |
| M3 | Download (Data, SVG, PDF) | Left to the Downloads change (STS-DL-1…3) | TAB:843-848 |
| M4 ⚠ | Where the settings are kept | Portal: the page's chart settings (saved with the user's layout when signed in). cBioLab: this browser, beside the bar charts' bin settings | ST:3132-3152 |

## D. Selection (cBioLab's own; kept)

The portal's selection (STS-SC-6) is not part of this change. cBioLab keeps its drag box, now on
the new axes:

| # | Input | cBioLab |
|---|---|---|
| D1 | A box over FGA 0.104 … 0.358 (x) and MC 3.2 … 10.7 (y), no Log Scale | FGA ≥ 0.1 and ≤ 0.36 (rounded to the axis's precision); MC ≥ 4 and ≤ 10 (whole counts inside the box) |
| D2 | A box over MC (log) 1.609 … 2.398 | ln back to counts: exp(v) − 1 = 4 … 10.0, so MC ≥ 4 and ≤ 10 |
| D3 | After Swap Axes, a box with x over MC and y over FGA | The same rule per attribute, whichever axis it is on |

## R. The plot view's axis ends (cBioLab's own)

The chart asks the engine's plot view for its bins, and the view takes the fixed axis ends as
`range` (in the attributes' own units). These rows are cBioLab's rules for it.

| # | Input | cBioLab |
|---|---|---|
| R1 | `range` checked | Absent: none. `{x: {min: 0, max: 1}}` kept as given; an end left out stays out. Refused with the field named: an end that is not a finite number ("range.x.min must be a finite number"), min not below max ("range.x: min must be below max"), an end below 0 on a log axis, an axis other than x or y ("range: no axis z"), an axis that is not `{min, max}` ("range.x: give {min, max}"). A JSON null end counts as left out |
| R2 | One study's scatter, FGA data 0.2 to 0.4, `range` x 0 to 1 | The plot's `extent` is x 0 to 1, and the bins are cut between those ends; without `range` the extent is the data's own (0.2 to 0.4) |
| R3 | A scatter pooled from two sites, both with a sample in cell (8, 1): (0.19, 2) at one, (0.2, 3) at the other | One cell (8, 1) of count 2, minX 0.19, maxX 0.2, minY 2, maxY 3. A site that reports no extremes leaves them to the other. The pooled extent takes the fixed ends |
| R4 | A plot sent to a peer | The `range` travels with the axes, and the peer checks it as in R1 before using it |
