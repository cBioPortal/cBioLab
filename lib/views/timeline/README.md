# The `timeline` view

cBioPortal's patient-view Timeline (runner `run.ts`): one patient's clinical events as tracks, with its cohort's patients (a table view) to pick from. **`lib/timeline-tracks.ts`** is
the track model, ported from cbioportal-frontend's `cbioportal-clinical-timeline` package and
`patientView/timeline/timeline_helpers.tsx`: the portal's track order and `trackStructures`
nesting, lone-"Other" absorption, line charts for all-numeric lab results, numbered sample
markers, the year axis with empty runs cut. **`lib/timeline-svg.ts`** draws it, browser-safe:
the lab card (`app/lab/timeline-body.tsx`) and the MCP figure are the same drawing. The queries
(`lib/patient-timeline.ts`) name a patient, so they run only through
`PatientLevelResolver.patientTimeline`/`rowsPage`/`rowsRank`. The view reads one cohort; its
navigator (cohort, the patient list — a `<dialog>` holding the `DataTable` — and ‹ prev / next ›) steps by the result's `position` — the drawn patient's place
in the list's order (`rankSql`) and its neighbours — setting `patient`. The chosen `patient`, folded `collapsed`
tracks and `expandGaps` are in the spec; the last two are drawn in the browser (`dataPart`).
