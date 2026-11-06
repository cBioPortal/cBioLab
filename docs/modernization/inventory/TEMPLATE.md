# Inventory template (one file per page area)

Each inventory file starts with a 5-line summary (area, source paths, file/line counts, how many
features listed, how many with e2e coverage) and then one table row per feature. A "feature" is
anything a user can see or do: a tab, a chart, a table and its columns, a filter, a dialog, a
download, a URL parameter.

| Column | Meaning |
|---|---|
| ID | `<AREA>-<NNN>`, stable, never reused (SV-, RV-, PV-, GC-, SP-, XC-) |
| Feature | short name, as the user would say it |
| Where | the component / store file(s) in `cbioportal-frontend/src/...` (path, no line numbers) |
| Data | backend endpoints it calls (from `packages/cbioportal-ts-api-client`) and URL parameters it reads or writes |
| Behavior | 1-3 sentences: what it shows/does, including any non-obvious rule (denominators, filters, defaults, sorting, limits) |
| E2E | Playwright spec(s) in `end-to-end-test-playwright/tests/` that exercise it, or `none` |
| cBioLab | nearest view kind in `cBioLab/lib/views/<kind>` / route, or `none`, or `?` if unsure |
| Notes | quirks, suspected bugs, feature flags, things a spec reader would miss |

Rules: describe only what you verified in code or specs; mark guesses with `?`. Never invent
endpoints. Keep Behavior factual, not evaluative. End the file with "Open questions".
