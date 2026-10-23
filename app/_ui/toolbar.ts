// Class names shared by the lab's toolbars, so a control looks the same in every view.

/** a button in a view toolbar, at the toolbar's control height (pair with variant "outline", size "sm") */
export const TB = "h-ctl gap-1 px-2 text-md font-normal shadow-none";

/** an option among several: an outline chip, filled while pressed (pair with variant "outline", size "xs") */
export const CHIP = "rounded-pill px-2.5 text-sm font-normal aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground";

/** a text or number field in a view toolbar */
export const FIELD = "h-ctl bg-card text-md md:text-md";

/** a page's own sections (the lab's Explore / Saved / Analysis, a portal page's tabs): a line tab one step larger than LINE_TAB */
export const PAGE_TAB = "h-auto flex-none rounded-none px-3.5 pt-2 pb-1.5 text-base leading-normal after:bottom-[-1px] data-[state=active]:text-accent-foreground dark:data-[state=active]:text-accent-foreground data-[state=active]:after:bg-primary";

/** a row of page tabs underlined by a rule (TabsList variant "line"), and one of its tabs */
export const LINE_TABS = "w-full flex-wrap justify-start gap-1.5 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto";
export const LINE_TAB = "h-auto flex-none rounded-none px-3 pt-1.5 pb-1.5 text-md after:bottom-[-1px] data-[state=active]:text-accent-foreground dark:data-[state=active]:text-accent-foreground data-[state=active]:after:bg-primary";

/** a body's own selector (a gene, a group) over what it shows: segmented tabs that wrap */
export const SEG_TABS = "h-auto max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto";
export const SEG_TAB = "h-7 flex-none px-2.5 text-sm font-medium " +
  // the selected one is a filled chip, in both schemes: a raised white chip on grey was too quiet to read.
  // One weight for every state, so a chip keeps its width and the row does not shift when the choice moves.
  "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:hover:text-primary-foreground " +
  "dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground";
