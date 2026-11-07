# pathwaymap — cBioPortal's Pathways tab (PathwayMapper)

One pathway of PathwayMapper's library drawn as a diagram (genes, families, complexes and processes
as nodes; activation, inhibition, induction, repression and binding as edges), each gene node
carrying the cohort's altered %, beside the library's pathways ranked for the query genes. It is
the portal's Results › Pathways tab, and the diagram half of its Patient › Pathways tab.

## Where the pathways come from — and their licence

`library-data.ts` is PathwayMapper's `pathways.json`, verbatim (only wrapped as a TypeScript
module, so no JSON import is needed): `packages/pathway-mapper/src/data/pathways.json` of
<https://github.com/iVis-at-Bilkent/pathway-mapper> at commit `f0590781c473b5afb1c1ceac027195b8ba00dfbd`,
byte-identical to the copy in the `pathway-mapper@2.3.0` npm package that cBioPortal's frontend
depends on (`"pathway-mapper": "^2.3.0"`). The file's sha256 is in the module's header.

- **Attribution.** PathwayMapper is by i-Vis at Bilkent University (Bahceci, Dogrusoz et al.,
  *PathwayMapper: a collaborative visual web editor for cancer pathways and genomic data*,
  Bioinformatics 2017). Its 55 pathways are the ten TCGA PanCanAtlas oncogenic signalling pathways
  (Sanchez-Vega et al., Cell 2018) and 45 pathways from TCGA marker papers.
- **Licence.** The repository's `LICENSE.md` is the Apache License 2.0 since commit `2d46a95d`
  (2026-10-10, "Change license from AGPL to Apache 2.0"), and its root `package.json` says
  `Apache-2.0` since `f0590781`. The npm release 2.3.0 — and, at that commit, the sub-package's own
  `packages/pathway-mapper/package.json` — still declares `AGPL-3.0-only`. This copy is taken from
  the repository at `f0590781`, under the Apache License 2.0. A reviewer may want the maintainers to
  confirm that the relicence covers the data file as well as the code.
- Nothing of PathwayMapper's code is used: no cytoscape, no runtime dependency. The diagram is
  drawn from the file's own node positions and sizes with `lib/chart/` (`figure.ts`).

## What is taken from the portal, and where this differs

Read from `cbioportal-frontend` (`src/pages/resultsView/pathwayMapper/`,
`src/shared/lib/pathwayMapper/`, `src/pages/patientView/pathwayMapper/`,
`src/pages/groupComparison/pathwayMapper/`) and `pathway-mapper@2.3.0`
(`react-pathway-mapper.tsx`, `Ranking.tsx`, `SaveLoadUtility.parseGraph`,
`GenomicDataOverlayManager.ts`, `GraphStyleSheet.tsx`).

- **Parsing** follows `parseGraph`: a node without its own size is 150 × 52 (a process as wide as
  its name); positions are centres; a compound's box is its children's extent, padded by type.
- **Gene nodes** are the nodes of type GENE, once each by name. Only they carry a frequency, as in
  PathwayMapper's overlay (`node[type="GENE"]`) — so RB1, a FAMILY node in "Cell Cycle", has none
  there. Names spelled like symbols that cBioPortal's gene table does not know (AKT, PI3K, WNT,
  FAM123B, …; `NOT_GENES` in `library.ts`) are drawn without data, as the portal draws genes its
  `fetchGenes` check rejects.
- **Ranking** (`rank.ts`) is `getBestPathways`: count = query genes among the gene nodes;
  percent = 100 × count ÷ gene nodes; "weight by altered %" replaces each match by its altered %
  (rounded to 2 decimals, as PathwayMapper's `toFixed(2)`); percent weighted is
  count × Σ% ÷ gene nodes — the code's formula; its help text describes Σ% ÷ gene nodes. The list
  is the ten PanCanAtlas pathways unless `pancanOnly: false` (PathwayMapper's "TCGA PanCancer Atlas
  pathways only", on by default). The default pathway is the ranking's first, as there.
- **Ties.** PathwayMapper orders equal scores by where its max-heap leaves them; here they are
  ordered by the matched genes' summed % and then by name, so a link always opens on the same
  pathway. The scores themselves, and the first pathway, are the same.
- **A gene no sample was profiled for** adds 0 to a weighted score, where PathwayMapper adds −101
  (its stand-in for NaN), and is drawn N/P, never 0%.
- **Frequencies** are `altered ÷ samples profiled for that gene` (any of the mutation, copy-number
  and structural-variant panels covering it), counted by the shared `geneCounts` query, so every
  participant answers, a remote peer included. The portal's Results tab counts patients
  (`sampleMode = false`); this counts samples, as cBioPortal's gene tables and the `compare` view
  do. Alteration is every mutation, amplification, deep deletion and structural variant: the query's
  OQL decides who is Altered on the Results page, but here, as on its other gene tabs, every
  alteration of a gene counts. The portal applies a query gene's OQL to that gene's node.
- **Colours** are PathwayMapper's scale (white to red on log(1 + %), reaching four fifths of the
  way at 100%), kept in `lib/oncoprint-style.ts` as `ramps.frequency` / `frequencyColor`.
- **Patient page.** The portal colours the patient's genes by alteration type; here a patient is a
  cohort of one, so a node reads 100% (altered in every sample), 0% or a share of the samples, and
  the ranking matches the patient's altered library genes (a view without `genes`).
- **Not built:** the Comparison page's Pathways tab (its genes are the top ten by alteration
  frequency, ranked by the enriched group's %); PathwayMapper's editing, layout and "add genes to
  query" actions; a search box over the ranking.

## Spec and the page

`pathway`, `rank`, `byFrequency` and `pancanOnly` change what the reader sees, so they are in the
view (invariant 9); they are applied in the browser from the one result, which carries every
library gene's counts (`dataPart` in `app/_oncoprint/view-display.ts` leaves them out of the
re-run key), so choosing a pathway re-runs nothing. A setting the library cannot honour is refused
by name, with the counts kept, so the page draws as soon as the document names one it can.
