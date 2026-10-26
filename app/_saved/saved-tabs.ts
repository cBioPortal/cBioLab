// The saved-work manager's tabs, in order: the ids pages open it on (useSaved().open, ?saved=, /saved?tab=).
export const SAVED_TABS = [["cohorts", "Cohorts"], ["analyses", "Analyses"], ["data", "Custom data"], ["groups", "Groups"], ["genes", "Gene lists"]] as const;
export type SavedTab = typeof SAVED_TABS[number][0];
export const isSavedTab = (x: unknown): x is SavedTab => SAVED_TABS.some(([t]) => t === x);
