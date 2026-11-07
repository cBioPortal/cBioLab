# The `signatures` view

cBioPortal's patient-view **Mutational Signatures** tab (runner `run.ts`, queries `sql.ts`, rules
`data.ts`, figure `figure.ts`). Ported from cbioportal-frontend's
`patientView/mutationalSignatures/` (`MutationalSignaturesContainer.tsx`,
`MutationalSignatureBarChartUtils.ts`), `ClinicalInformationMutationalSignatureTable.tsx`,
`PatientViewPageStore.ts` (`mutationalSignatureDataGroupByVersion`, `samplesWithDataAvailable`) and
`shared/lib/GenericAssayUtils/MutationalSignaturesUtils.tsx`.

**Profiles.** A study's signature data are generic-assay profiles named
`mutational_signatures_<contribution|pvalue|counts>_<type>`; the type (the portal's "version": SBS,
DBS, ID, v2, v3) is what follows the last `_` (`signatureFamilies`). The contribution profile is the
table; the p-value profile, paired with it by the last `_` part of the entity id as the portal pairs
them, marks a value significant under 0.05; the counts profile is the spectrum. The type shown first
is the portal's pick among the types the patient has values in (`defaultVersion`: v3 when both v2
and v3, else SBS, else the first).

**Deliberate differences.** A study without a p-value profile marks nothing significant — the
portal reads the missing p-value as 0, which would call every signature significant in its header.
A missing contribution is NA, not 0 as the portal's table fills it. The spectrum's shares are kept
exact rather than rounded to whole percent. The portal's mirrored COSMIC reference profile under the
spectrum, its y-axis slider and the header's significant-signatures badge are not drawn yet.

**The patient list** holds only the cohort's patients with a contribution value (of `version` when
given) — the portal shows the tab only then. A named patient without values, a type the study lacks
and a sample without counts are refused, naming what there is. Only local patient-level
participants answer (`need: "patients"`); no peer serves this view's rows.
