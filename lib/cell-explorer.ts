// cBioPortal Cell Explorer (cell-explorer.cbioportal.org): the single-cell datasets a study's
// patients can be opened in, and the links both ways — a cohort's patients as a filter on the
// dataset's donor column, and a Cell Explorer link (or a list of donor ids) back into a cohort.
//
// Browser-safe: the page builds and reads links with it; lib/cell-explorer-server.ts maps
// patients to donors.

export const CELL_EXPLORER_BASE = "https://cell-explorer.cbioportal.org";

/** a link names its donors in the URL, so a cohort past this many is refused rather than cut */
export const CELL_EXPLORER_MAX_DONORS = 500;

export interface CellExplorerDataset {
  /** the cBioPortal study whose patients are the dataset's donors */
  study: string;
  /** Cell Explorer's dataset slug (its /api/datasets) */
  dataset: string;
  label: string;
  /** the dataset's obs column holding the donor */
  obsColumn: string;
  /** the patient attribute whose value is the donor id; null when the donor id is the patient id */
  patientAttribute: string | null;
  /** how the dataset opens: what the cells are coloured by */
  view: { colorBy: "category"; category: string; showCategoryLabels?: boolean };
}

export const CELL_EXPLORER_DATASETS: CellExplorerDataset[] = [
  { study: "msk_spectrum_tme_2022", dataset: "spectrum", label: "MSK SPECTRUM scRNA-seq (927,205 cells, 41 patients)",
    obsColumn: "donor_id", patientAttribute: "PATIENT_DISPLAY_NAME",
    view: { colorBy: "category", category: "author_cell_type", showCategoryLabels: true } },
  { study: "crc_hta8_htan_2024", dataset: "crc-metastasis-epithelial", label: "HTAN MSK colorectal metastasis, epithelial cells (47,107 cells, 29 patients)",
    obsColumn: "donor_id", patientAttribute: null,
    view: { colorBy: "category", category: "Author Cell Type", showCategoryLabels: true } },
  { study: "crc_hta11_htan_2021", dataset: "htan-vumc-crc-val-and-dis-datasets-non-epithelial", label: "HTAN Vanderbilt colorectal polyps, immune and stromal cells (10,696 cells, 59 donors)",
    obsColumn: "donor_id", patientAttribute: null,
    view: { colorBy: "category", category: "Cell_Type", showCategoryLabels: true } },
];

export function cellExplorerFor(study: string | null | undefined): CellExplorerDataset | null {
  return CELL_EXPLORER_DATASETS.find((d) => d.study === study) || null;
}

/** A link that opens the dataset showing these donors' cells and dimming the rest. */
export function cellExplorerUrl(d: CellExplorerDataset, donors: string[]): string {
  if (!donors.length) throw new Error("no donors to show");
  if (donors.length > CELL_EXPLORER_MAX_DONORS)
    throw new Error("a Cell Explorer link names at most " + CELL_EXPLORER_MAX_DONORS + " donors; this cohort has " + donors.length);
  const config = { dataset: d.dataset, ...d.view, filter: { obsColumn: d.obsColumn, ids: donors } };
  return CELL_EXPLORER_BASE + "/view?config=" + encodeURIComponent(JSON.stringify(config));
}

/**
 * The donors a reader pasted: a Cell Explorer link whose filter names donors of this dataset, or
 * ids separated by commas, spaces or new lines. Throws, naming why, when the text is a link
 * that names none — a different dataset, or a filter on another column.
 */
export function donorsFromInput(d: CellExplorerDataset, text: string): { donors: string[]; from: "link" | "list" } {
  const t = String(text || "").trim();
  if (!t) throw new Error("paste a Cell Explorer link or a list of donor ids");
  if (/^https?:\/\//i.test(t)) {
    let u: URL;
    try { u = new URL(t); } catch { throw new Error("that link cannot be read"); }
    const raw = u.searchParams.get("config");
    const slug = raw ? null : u.searchParams.get("dataset");
    if (slug != null) throw new Error("that link opens the whole “" + slug + "” dataset; it names no donors — filter it by " + d.obsColumn + " in Cell Explorer, or paste the donor ids");
    if (!raw) throw new Error("that link has no Cell Explorer view in it (no ?config=)");
    let cfg: { dataset?: string; filter?: { obsColumn?: string; ids?: unknown[] } };
    try { cfg = JSON.parse(raw); } catch { throw new Error("that link's view cannot be read"); }
    if (cfg.dataset && cfg.dataset !== d.dataset) throw new Error("that link is for the “" + cfg.dataset + "” dataset, not “" + d.dataset + "”");
    if (!cfg.filter || !Array.isArray(cfg.filter.ids) || !cfg.filter.ids.length) throw new Error("that link shows every cell; it names no donors");
    if (cfg.filter.obsColumn !== d.obsColumn)
      throw new Error("that link filters on " + JSON.stringify(cfg.filter.obsColumn) + "; only a filter on " + d.obsColumn + " names patients");
    return { donors: [...new Set(cfg.filter.ids.map(String))], from: "link" };
  }
  return { donors: [...new Set(t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))], from: "list" };
}
