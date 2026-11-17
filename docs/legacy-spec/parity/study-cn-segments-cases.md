# Study View › CN Segments tab — case table

The Explore page's CN Segments tab, as cBioPortal's study view draws it (STV-CN-1…3). Legacy source:
`src/pages/studyView/tabs/CNSegments.tsx` (CNS), `StudyViewPage.tsx` (SVP), `StudyViewPageStore.ts`
(SVPS) and `shared/lib/IGVUtils.ts` (IGVU), at cbioportal-frontend cd8c6df.

The tab draws the existing `segments` view (docs/dsl.md; the Results tab's CN Segments) over the
selection: its rows, colours, limits and controls are that view's, and its open gaps are tracked
under "Per-sample CN segments" in PORTAL-PARITY.md, not here.

## When the tab is offered (CS)

| # | Case | Rule | Source |
|---|---|---|---|
| CS1 | Shown | The tab is offered when a selected study holds any copy-number segment, whatever the filters select | SVP:799-808 (`hasCNSegmentData` over every sample of the studies, `projection: META`) |
| CS2 | Hidden | No selected study holds a segment: no tab | SVP:803-807 |
| CS3 | Peer studies | A study served by a federation peer carries no segment flag, so it alone never offers the tab | study list caps |

## The info line (CI)

| # | Case | Rule | Source |
|---|---|---|---|
| CI1 | With data | "Segmented copy-number data for the selected N samples." N the selected samples, written as a plain number (no separators) | CNS:126-142 |
| CI2 | One sample | "sample" when N is 1 | CNS:136-139 |
| CI3 | No data | "No segmented copy-number data for the selected N samples." once the segments are read and none of the selected samples has any | CNS:116-122, 130-132 |
| CI4 | While reading | "Segmented …" until the segments are read (the portal says "Segmented" while it waits) | CNS:116-122 (`isComplete` false) |
| CI5 | Too many | More than 20,000 selected samples: "Too many samples (>20000) for copy number segmentation view, make a selection on Summary tab first." and nothing is read | CNS:36-38, 80-86, 126-128 |
| CI6 | Exactly 20,000 | 20,000 selected samples are drawn (the limit is "more than") | CNS:84 (`<=`) |

## The figure (CF)

| # | Case | Rule | Source |
|---|---|---|---|
| CF1 | What is drawn | The `segments` view over one cohort, the selection, on the whole genome | CNS:179-195 |
| CF2 | No data | Nothing drawn under CI3 | CNS:171-176 (opacity 0) |
| CF3 | ⚠ Download | The portal's `<prefix>segments.seg` button is not built here: tracked with the Results tab's CN Segments download (STV-CN-2) | CNS:150-160 |
