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

**The spectrum chart** is the portal's (`MutationalSignatureBarChart.tsx`,
`MutationalSignaturesContainer.tsx`): a coloured band per class above the bars (ID: a box per class
and sub-class, C/T or 2/3/4/5+, and the axis titles under the labels), each channel's bar in its
class's colour (`STYLE.signatures` in `lib/oncoprint-style.ts`, the portal's `colorMap`), the
channels' labels read upward with SBS's mutated base in its class's colour, the portal's y-axis
title, a fixed axis (0–100%, or the counts rounded up to tens), and the Y-axis Max slider (`ymax`)
cutting the axis by the portal's rule (`percentAxisMax`, `countAxisMax`, `referenceAxisMax`), its
top tick written `>=`. Clicking a table row (`signature`) mirrors that signature's COSMIC
reference profile under the spectrum, on its own percent axis ("COSMIC Reference / SBS5 (%)").
None is drawn until a row is clicked; a new type resets the signature and the slider, % / # resets
the slider, a new sample keeps the signature — all as the portal. The header line ("Sample: … |
Single Base Substitution (SBS) count: … ⓘ"), its tip, the type selector's "Mutational Signature
SBS" options, the toggle's tips and the line above the table are the portal's words. The portal
shows the sample there as plain text, without the patient page's numbered sample marker, and so
does this view.

**The COSMIC reference profiles** (`cosmic-reference.ts`) are the `"v3.3"` → `"GRCh37"` part of
cbioportal-frontend's `src/pages/patientView/mutationalSignatures/cosmic_reference.json` (commit
`ecd89f26`, sha256 in the module's header) — the only part its chart reads — written as one
channel → frequency object per signature; names and numbers are unchanged (a unit test checks that
every profile sums to 1). The profiles are COSMIC's: *COSMIC Mutational Signatures v3.3*, Wellcome
Sanger Institute (https://cancer.sanger.ac.uk/signatures), from Alexandrov et al., *The repertoire
of mutational signatures in human cancer*, Nature 578, 94–101 (2020).

- **Licence — needs a reviewer's decision.** cbioportal-frontend is Apache-2.0 and ships the file
  with no attribution or licence of its own. COSMIC's signature download page needs no login but
  says use of the data is subject to the COSMIC Terms and Conditions, and COSMIC licenses its data
  separately for non-commercial use and (through QIAGEN) commercial use. Nothing found grants the
  signatures under an open licence, so redistributing this copy rests on the same footing as
  cBioPortal's own; someone should confirm that is acceptable before this merges.

**Deliberate differences.** A study without a p-value profile marks nothing significant — the
portal reads the missing p-value as 0, which would call every signature significant in its header.
A missing contribution is NA, not 0 as the portal's table fills it. Where this chart differs from
the portal's:

- *Shares are exact*, not rounded to whole percent (the portal draws 0.4% as 0).
- *ID labels are COSMIC's*: a deletion's count from 1 (the stored 0 is drawn 1, 5 is 6+), an
  insertion's from 0 (5 is 5+). The portal adds the 1 to insertions instead, which mislabels both.
- *Hover tips say more*: a bar names its channel, count, total and share (the portal's shows only
  the label, "ACA"); a reference bar names the signature, channel, percent to two places and the
  source (the portal's: "ACAA 1%").
- *The slider runs 1–100* (the portal's 0–100; at 0 its reference axis has no height).
- *A signature with no reference profile cannot be chosen* — its row says so — and a spec naming
  one is refused. The portal throws on it (a v2/v3 type, or a name COSMIC v3.3 lacks, e.g. SBS10).
- Flanking bases are the theme's ink rather than literal black; bars are a share of the channel's
  width rather than 7px on a fixed 1500px chart; the figure keeps its own title for MCP and
  exports; the toolbar sits in the card's header; the portal's SVG/PNG/PDF buttons are the card's
  own export.
- The table lists every signature, as the portal's, with an "above 0 in some sample" filter to
  tick; its rows show the description as a tip and link the name rather than the portal's per-row
  ⓘ popover. The header's significant-signatures badge is not drawn.

**The patient list** holds only the cohort's patients with a contribution value (of `version` when
given) — the portal shows the tab only then. A named patient without values, a type the study lacks
and a sample without counts are refused, naming what there is. Only local patient-level
participants answer (`need: "patients"`); no peer serves this view's rows.
