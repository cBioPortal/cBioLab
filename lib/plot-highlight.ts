// A plot's highlight cohorts: how many, and their colours. Browser-safe, so the page's picker
// and the server's figure agree on both.

/** cohorts one plot may highlight: each takes a colour of its own, and past four they stop being told apart */
export const HIGHLIGHT_CAP = 4;
/** a highlight's colour, by its place in the view's list */
export const HIGHLIGHT_COLORS = ["#D55E00", "#0072B2", "#009E73", "#CC79A7"] as const;
/** the plotted cohort under highlights: a grey lighter than a colour key's "other", so the two never read alike */
export const HIGHLIGHT_BASE = "#adb6bc";
