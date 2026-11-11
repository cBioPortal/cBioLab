# Legacy cBioPortal parity spec

These files describe how the legacy cBioPortal behaves, one file per page or tab. They are written for an agent or reviewer who checks cBioLab for parity and fills the gaps.

**Sources**
- cbioportal.org, checked 2026-11-10.
- `cBioPortal/cbioportal-frontend@cd8c6df` (2026-08-21).
- The `cBioPortal/cbioportal` backend, for statistics computed on the server.

**Conventions**
- Every requirement has an ID: a file prefix such as `ONC-`, `PLT-` or `STS-` plus a number.
- Defaults are written `[default]`. `URL:` gives the query param that persists a state. *(local)* means the state is held only in memory and lost on reload.
- Tags say where a line comes from:

  | Tag | Meaning |
  |---|---|
  | none | confirmed in both the browser and the code |
  | `[C]` | from the code only (mostly hover tooltips, which don't render headless, and logged-in features) |
  | `[B]` | from the browser only |
  | `[B-new]` | on cbioportal.org but newer than the code snapshot |

- Each file ends with **Statistics & methods** (`<PREFIX>-STM-n`). For every number the page shows, it gives the numerator, the denominator, which cases are included, the test and its correction, and the rounding, with file:line citations.
- A line marked **legacy bug** describes behaviour that is wrong in legacy. Note it, but don't reproduce it.
- A component used on several pages is specified once, in its owner file. Other files list only how their copy differs.

## Index

| File | Page / tab | Prefix | Owns shared spec for |
|---|---|---|---|
| [01-oncoprint](01-oncoprint.md) | Results › OncoPrint; Results header and settings menu (§0) | `ONC-`, `RV-` | Results header, driver/filter settings menu |
| [02-cancer-types-summary](02-cancer-types-summary.md) | Results › Cancer Types Summary | `CTS-` | |
| [03-mutual-exclusivity](03-mutual-exclusivity.md) | Results › Mutual Exclusivity | `MEX-` | |
| [04-plots](04-plots.md) | Results › Plots | `PLT-` | box, scatter, waterfall, bar and table plots |
| [05-mutations](05-mutations.md) | Results › Mutations | `MUT-` | mutation table, lollipop / mutation mapper, annotation columns |
| [06-structural-variants](06-structural-variants.md) | Results › Structural Variants | `SV-` | |
| [07-coexpression](07-coexpression.md) | Results › Co-expression | `COE-` | |
| [08-cn-segments](08-cn-segments.md) | Results › CN Segments (IGV) | `CNS-` | |
| [09-pathways](09-pathways.md) | Results › Pathways | `PWY-` | |
| [10-results-download](10-results-download.md) | Results › Download | `RDL-` | |
| [20-comparison-core](20-comparison-core.md) | Group Comparison shell, Overlap, Survival, Clinical; Results › Comparison/Survival | `CMP-` | Kaplan-Meier chart and its statistics |
| [21-comparison-molecular](21-comparison-molecular.md) | Group Comparison › Genomic Alterations, Mutations, mRNA, Protein, Methylation, Generic assay | `CMM-` | enrichment table, volcano plot |
| [30-study-summary](30-study-summary.md) | Study View › Summary charts | `STS-` | Study View chart types |
| [31-study-view-shell](31-study-view-shell.md) | Study View shell, filters, actions, other tabs | `STV-` | |
| [40-patient-summary](40-patient-summary.md) | Patient View shell + Summary | `PAT-` | |
| [41-patient-tabs](41-patient-tabs.md) | Patient View › other tabs | `PTB-` | |

**Audit results.** Scorecards for cBioLab against every file (2026-11-11) are in [`parity/`](parity/README.md).

## How to use it for a parity check

1. Open the file for the cBioLab page you are checking.
2. Go through its IDs. For each one, mark it matching, missing, different (and why), or legacy bug not reproduced.
3. Check numbers against the **Statistics & methods** section, not just against what the UI shows.
4. A parity PR cites the IDs it covers and the ones it leaves out (see [`../PORTAL-PARITY.md`](../PORTAL-PARITY.md)).
