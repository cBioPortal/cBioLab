# Domain terms

What the words in this codebase mean, for a reader who knows software but not cancer genomics or
cBioPortal. Each entry says where the rule behind it is kept; where a term carries a trap (a
shortcut that gives a plausible wrong number), the trap is named.

## Data

- **Study** — one dataset as cBioPortal imports it (`msk_chord_2024`, `nsclc_public_genie_bpc`): its
  patients, their samples, clinical attributes, molecular profiles and timeline. Every query is per
  study (invariant 3); a cross-study answer is assembled from per-study answers.
- **Patient / sample** — a patient has one or more samples (a primary tumour, a metastasis, a blood
  draw). Clinical attributes are recorded at either level (`type = 'patient'` or `'sample'`). A
  view counts in one unit and says which. Ids are study-local, so across studies they are qualified
  `"<study>:<id>"`.
- **Clinical attribute** — a column of clinical data (`SEX`, `AGE`, `OS_MONTHS`, `CANCER_TYPE`),
  numeric or categorical. Vocabularies are each study's own and are not harmonised across studies;
  a view over several says so.
- **Survival endpoint** — a pair `<X>_MONTHS` / `<X>_STATUS` (overall survival is `OS_*`). A study
  with no such pair cannot fit survival or Cox (`noSurvivalWhy` in `app/lab/use-view-options.ts`).
  A patient enters a survival analysis only with both a status and a months value (neither a missing
  marker such as `NA` or `[Not Available]`) and months at least 0, as on cBioPortal: months with no
  status is left out, never censored. The event is a status coded 1 (`1:DECEASED`, or a bare `1`).
  One rule for every view: `lib/survival-sql.ts` (queries in `lib/survival-queries.ts`). Every view
  that reads an endpoint names, per cohort, the patients it leaves out for want of a status or a time,
  and warns when they reach a tenth of the cohort (`reportsLeftOut`, `lib/views/index.ts`).
- **Molecular profile** — one kind of measurement for a study: mutations, copy number (CNA),
  structural variants (SV), mRNA expression (and its z-scores), protein, methylation, or a
  **generic assay** (mutational signatures, arm-level copy number, cell-type fractions: any per-case
  value for a named entity).
- **Copy number (CNA)** — called per gene as −2 (deep deletion), −1, 0, 1, 2 (amplification). This
  warehouse stores only ±2, the high-level calls: `AMP`, `HOMDEL`.
- **Timeline event** — a dated clinical record (treatment, diagnosis, lab test, sequencing, status),
  in days from the patient's anchor date, with attributes. Event types and attribute keys are folded
  case-insensitively in exactly one place, `lib/event-names.ts`.
- **Treatment line** — successive systemic therapies grouped by a gap rule; defined once, in
  `lib/treatment-lines.ts`.
- **Custom data** — a researcher's upload, named `custom:<dataset>/<COLUMN>` and usable wherever a
  clinical attribute is (`lib/custom-data.ts`).

## Calls and denominators

- **Gene panel** — a targeted sequencing assay that covers a fixed list of genes; whole-exome covers
  all of them. Studies mix panels, and a panel's gene list changes between versions.
- **Profiled / not profiled** — a sample is profiled for a gene only if its panel covers that gene.
  **Not profiled is never wild-type.** A frequency is `altered ÷ samples profiled for that gene`;
  dividing by all samples does not error, it reports every gene as rarer than it is. The rule and
  its checks: `docs/PERFORMANCE.md` §1, `test/denominator.test.ts`, `npm run check:denominators`.
- **Off-panel call** — a call in a gene the sample's panel does not cover
  (`genomic_event_derived.off_panel`). It counts on neither side of a frequency, as on cBioPortal.
- **Uncalled mutation** — a variant called in one of a patient's samples and looked up in the
  others, where the reads support it below the caller's thresholds (`mutation_status` UNCALLED). It
  is not an alteration: it matches no OQL, oncoprint cell or plot axis, and tables leave it out.
- **Driver / VUS** — whether OncoKB annotates an alteration as oncogenic (a driver) or of unknown
  significance. Annotations come from a version-pinned OncoKB store, and the pin is echoed in every
  result, so a driver count is reproducible.
- **OQL** — cBioPortal's Onco Query Language for alterations (`TP53: MUT`, `KRAS: MUT=G12D`,
  `EGFR: AMP`, `DRIVER`). `lib/oql.ts` implements an honest subset and rejects the rest by name.

## The document

- **Analysis document** — `{study, cohorts, views}`: everything a result depends on, so a link to it
  reproduces the result (invariant 9). Older documents are upgraded in one place,
  `lib/doc-version.ts`.
- **Cohort** — a set of samples, as on cBioPortal, defined by clauses (`lib/cohort2.ts`):
  `{all:[...]}`, `{any:[...]}`, `{not:...}` over leaves (OQL, clinical values, timeline events, id
  lists, profiled-for, …) — intersection, union and complement over the study's samples. A
  sample-level leaf (a sample attribute, an alteration, a sample list) selects the samples that match;
  a patient-level one (a patient attribute, an event, a patient list) every sample of the patients
  that match. A clinical attribute is matched at the level its study records it, so one clause can be
  sample-level in one study and patient-level in another. The cohort's **patients** are the owners of
  its samples. A table keyed by sample joins on the cohort's samples (`inCohortSamples`), one keyed by
  patient on its patients (`inCohortPatients`) — the one rule, so a patient's other samples never
  reach a sample count or a gene frequency. A cohort can `extends` another.
- **Split / arm** — a cohort divided into disjoint child cohorts that add up to it (arms, decided
  first match wins). A patient whose arm cannot be decided (not profiled, no value recorded) goes
  to a named "Not profiled" / "No … recorded" child, never to wild-type or Other
  (`lib/cohort-partitions.ts`).
- **Held-out half** — the `split` leaf: a salted hash of the patient id divides any cohort into a
  discovery and a validation half, the same way every time (salt pinned in `test/cohort.test.ts`).
- **View** — one analysis drawn over named cohorts (survival curves, an oncoprint, a table); each
  kind is `lib/views/<kind>/`.
- **Anchor** — a timeline event a view measures time from ("first treatment"), instead of the
  study's own baseline.
- **Left truncation / delayed entry** — a patient only becomes observable some time after the
  baseline (at sequencing, say). Counting them at risk from the baseline makes survival look better
  than it is; the survival view corrects with delayed entry when anchored and discloses it otherwise.
- **Stored id set / lock** — a long id list kept server-side and named by id (`lib/id-set-store.ts`);
  locking a cohort freezes what its definition selects now into one (`lib/cohort-lock-server.ts`).
- **Method record** — each view's statement of how its numbers were computed, with a Python script
  that recomputes them (invariant 12, `lib/method.ts`).

## Who holds the data

- **Participant / instance** — a database the app reads: the primary warehouse, a secondary one, or
  a federation **peer** (another deployment answering through its federation API).
- **Patient-level / aggregate-only** — a patient-level participant may return patient ids to an
  entitled caller; an aggregate-only one returns counts and sums, never ids. The guarantee is a
  missing method, not a flag (invariant 10, `docs/DATA-BOUNDARY.md`). A view is drawn over every
  patient of its cohorts or not at all (`lib/view-coverage.ts`).
- **Federation** — answering across participants: each answers its own part in its own database,
  and the analysis layer combines additive parts (counts, sums, moments). Overlap between studies
  is not deduplicated, and a view over several says so.

## Outside names

- **cBioPortal** — the open-source cancer genomics portal this project rebuilds around one document
  (https://www.cbioportal.org); `check:portal` compares counts against its public API.
- **AACR GENIE** — a large multi-institution panel-sequencing consortium; its public release has no
  survival data.
- **MSK-CHORD** — a Memorial Sloan Kettering study with rich timelines (treatments, diagnoses, labs).
