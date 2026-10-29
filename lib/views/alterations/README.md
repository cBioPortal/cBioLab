# The `alterations` view

cBioPortal's patient-view genomic tables (runner `run.ts`): one patient's Mutations, Copy Number
Alterations and Structural Variants as three table views in one card, each
with its own query under its own spec key (`mutations`, `cna`, `sv`); the top-level query is the patient list's.
Row sources in **`lib/patient-alterations.ts`** (one row per variant / call / event however many of the
patient's samples carry it). Local patient-level participants, and a peer whose rules allow `alterations`
(opt-in patient-level federation, docs/ARCHITECTURE.md): the peer pages each table in its own database.
Its navigator is the timeline's: **`app/lab/patient-nav.tsx`** (‹ prev / next ›, the List/Search dialog,
← / →) serves every view that shows one patient of a cohort at a time, stepping by the result's `position`
(`listPosition()` in `lib/views/rows.ts`).
