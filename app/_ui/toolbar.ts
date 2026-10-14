// Class names shared by the lab's toolbars, so a control looks the same in every view.

/** a button in a view toolbar, at the toolbar's control height (pair with variant "outline", size "sm") */
export const TB = "h-ctl gap-1 px-2 text-md font-normal shadow-none";

/** an option among several: an outline chip, filled while pressed (pair with variant "outline", size "xs") */
export const CHIP = "rounded-pill px-2.5 text-sm font-normal aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground";

/** a text or number field in a view toolbar */
export const FIELD = "h-ctl bg-card text-md md:text-md";

/** a row of page tabs underlined by a rule (TabsList variant "line"), and one of its tabs */
export const LINE_TABS = "w-full flex-wrap justify-start gap-1.5 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto";
export const LINE_TAB = "h-auto flex-none rounded-none px-3 pt-1.5 pb-1.5 text-md after:bottom-[-1px] data-[state=active]:text-accent-foreground data-[state=active]:after:bg-primary";

/** a body's own selector (a gene, a group) over what it shows: segmented tabs that wrap */
export const SEG_TABS = "h-auto max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto";
export const SEG_TAB = "h-7 flex-none px-2.5 text-sm font-normal data-[state=active]:font-semibold";
