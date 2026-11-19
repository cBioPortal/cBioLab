// The portal's "Show more" pager (PaginationControls with showMoreButton, as the Mutations table uses it,
// itemsPerPageOptions [25, 50, 100]): browser-safe rules the table component and the tests share.

/** the Mutations table's page sizes on the portal (MutationTable paginationProps) */
export const SHOW_MORE_SIZES: readonly number[] = [25, 50, 100];

/** the largest page one request may ask for (/api/view-page's limit); prev / next reach the rows past it */
export const PAGE_ROWS_MAX = 1000;

/**
 * Show more: the next listed size, past the last one that size added again (25 → 50 → 100 → 200 → 300 …)
 * (handleShowMore), at most PAGE_ROWS_MAX, where the portal's grows on
 */
export function showMoreSize(size: number, sizes: readonly number[] = SHOW_MORE_SIZES): number {
  const i = sizes.indexOf(size);
  return Math.min(PAGE_ROWS_MAX, i > -1 && i < sizes.length - 1 ? sizes[i + 1] : size + sizes[sizes.length - 1]);
}

/** Show more is disabled once a page holds every row, or is as large as a page may be */
export const showMoreDisabled = (size: number, total: number): boolean => !total || size >= total || size >= PAGE_ROWS_MAX;

/** Reset (back to the first size) is offered once the page is larger than it */
export const resetOffered = (size: number, sizes: readonly number[] = SHOW_MORE_SIZES): boolean => size > sizes[0];

/**
 * the pager is hidden when the first size holds every row (hidePaginationIfOnePage), and the page shown does
 * too: a view asking fewer rows a page than that keeps its pager, so every row can be reached
 */
export const pagerHidden = (total: number, size: number, sizes: readonly number[] = SHOW_MORE_SIZES): boolean => sizes[0] >= total && size >= total;

/** the header's page part, "(page x of y)", only with more than one page (LazyMobXTable) */
export function pageOfText(page: number, pages: number): string {
  return pages > 1 ? "(page " + (page + 1).toLocaleString("en-US") + " of " + pages.toLocaleString("en-US") + ")" : "";
}
