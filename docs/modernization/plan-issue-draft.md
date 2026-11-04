# Plan: reimplement the cBioPortal UI on cBioLab

Follows the structure of Anthropic's guide
[How to prepare for AI-driven code modernization projects](https://claude.com/resources/articles/how-to-prepare-for-ai-driven-code-modernization-projects).

## 1. Target

Two tracks that share one certificate:

- **Transform:** reproduce the current cbioportal-frontend screens (Study View, Results View,
  Patient View, Group Comparison, static pages) on cBioLab's Analysis document and view kinds,
  with behavior held fixed. Oracle: the live portal (cbioportal.org and its public API).
- **Reimagine:** behaviors cBioLab deliberately changes (panel-aware denominators, loud
  rejection, aggregate-only federation, document as the single state, provenance on every result).

Every difference between the new UI and the portal is entered in a **deviation register** and
classified as: portal bug (fixed), intentional cBioLab change (with rationale), or not yet built.

## 2. Certificate (machine-checkable)

- No unclassified differences between cBioLab and the portal on the slice's characterization
  suite (counts, tables, URLs, statistical results).
- Existing portal-parity checks stay green (`docs/verification/portal-parity.json`).
- Legacy and current portal URLs resolve to the equivalent cBioLab view.
- Boundary, methods, docs and e2e gates (`scripts/gate.sh`) pass.
- Performance no worse than the budget set per slice in `docs/PERFORMANCE.md`.

## 3. Promotion policy

To be agreed. Proposal: full human review for anything that changes a displayed number, the
boundary, or a deviation-register entry; sampled review for mechanical UI ports whose
characterization suite passes.

## 4. Prerequisites

- [ ] Decide scope: UI only, or also the Java REST backend
- [ ] Name subject-matter reviewers who sign off on deviations
- [ ] Decide coexistence vs. replacement during the transition
- [ ] Replay or capture tooling for portal traffic (cbioportal_qc) available to the workflow
- [ ] Token-cost budget for the pilot

## 5. Steps

1. **Inventory** (wide, shallow) of every page area: `docs/modernization/inventory/`
   - [ ] Study View
   - [ ] Results View
   - [ ] Patient View
   - [ ] Group Comparison
   - [ ] Routes, static pages, URL contract, e2e coverage index
2. **Gap matrix**: each inventory row mapped to a cBioLab view kind, with a decision
   (port / change deliberately / drop)
3. **Pick the pilot slice** (proposed: Study View)
4. **Characterization suite and deviation register** for the pilot slice
5. **Generate the pilot implementation**, land it through the promotion policy, measure token cost
6. **Review the workflow**, fix the workflow rather than individual changes, then scale to the
   next slice

## Open questions

See the "Open questions" section of each inventory file.
