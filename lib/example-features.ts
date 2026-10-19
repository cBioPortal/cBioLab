// What a gallery example is about, as the Examples tab shows and filters it. View kinds and the
// features a document's shape decides (spanning studies, running on uploads) are read from the
// document, so they cannot drift from it; `tags` adds only the topics a document cannot state.
// Browser-safe.
import type { DslExample } from "./dsl-reference.ts";

/** derived: the example's cohorts span more than one study */
export const FEDERATION = "federation";
/** derived: the example runs on uploads bundled with the app */
export const CUSTOM_DATA = "custom-data";

export const studiesOf = (ex: DslExample): string[] => [...new Set(Object.values(ex.doc.cohorts || {})
  .flatMap((c: any) => (c && c.studies) || (c && c.study ? [c.study] : []))
  .concat(ex.doc.study ? [ex.doc.study] : []))];

export interface ExampleFeatures {
  /** the view kinds the document draws, in its order */
  views: string[];
  /** derived features, then the example's own tags */
  topics: string[];
}

export function exampleFeatures(ex: DslExample): ExampleFeatures {
  const views = [...new Set((ex.doc.views || []).map(v => String(v.kind)))];
  const derived = [
    ...(studiesOf(ex).length > 1 ? [FEDERATION] : []),
    ...(ex.customData?.length ? [CUSTOM_DATA] : []),
  ];
  return { views, topics: [...new Set([...derived, ...(ex.tags || [])])] };
}

/** lower-cased, with hyphens, underscores and spaces dropped, so "co-expression" finds "coexpression" */
export const foldSearch = (s: string): string => s.toLowerCase().replace(/[-_\s]+/g, "");

/** the text a search reads: title, what it demonstrates, its note, its features and studies */
export function exampleSearchText(ex: DslExample): string {
  const f = exampleFeatures(ex);
  return [ex.title, ex.demonstrates || "", ex.note, ...f.views, ...f.topics, ...studiesOf(ex)].join("\n");
}

/** every word of the query appears somewhere in the example's text (case, hyphens and spaces aside) */
export function matchesSearch(ex: DslExample, query: string): boolean {
  const words = query.split(/\s+/).map(foldSearch).filter(Boolean);
  if (!words.length) return true;
  const hay = foldSearch(exampleSearchText(ex));
  return words.every(w => hay.includes(w));
}
