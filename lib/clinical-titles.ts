// A clinical axis titled by its attribute's display name, as the portal titles it (getAxisLabel,
// PLT-DT-19), for the views that name an axis outside a participant's plot answer: a pooled plot's
// colour key, a forest's exposure and strata, a model's covariates. A participant's own plot answer
// titles its axes itself (lib/federation.ts clinicalMeta), so a remote peer's plot is named too.
import { clinicalMetaSql, displayTitle } from "./federation.ts";
import type { AggregateSql } from "./sql-kinds.ts";
import type { PlotAxis } from "./plot.ts";

/** what a participant needs to answer the names query */
type Meta = { viewMeta(label: string, build: (study: string, db: string) => AggregateSql): Promise<Record<string, unknown>[]> };

/**
 * The axes with each clinical one, not already labelled, titled by the first non-empty display name
 * any of `studies` declares for its attribute, in that order: the studies are asked one at a time
 * until every attribute has a name, and one that does not declare it, or whose participant cannot
 * answer, leaves it to the next. With no name anywhere the axis keeps none, and is titled by its id.
 */
export async function titledAxes<T extends Record<string, PlotAxis | undefined>>(axes: T, resolvers: Record<string, unknown>, studies: string[]): Promise<T> {
  const attrs = [...new Set(Object.values(axes).flatMap((a) => a && a.source === "clinical" && !a.label ? [a.attribute] : []))];
  if (!attrs.length) return axes;
  const names = new Map<string, string>();
  for (const st of studies) {
    const want = attrs.filter((a) => !names.has(a));
    if (!want.length) break;
    const r = resolvers[st] as Partial<Meta> | undefined;
    if (!r || typeof r.viewMeta !== "function") continue;
    try {
      for (const row of await r.viewMeta("clinical:names", (s, db) => clinicalMetaSql(want, s, db))) {
        const n = displayTitle(row.name);
        if (n && !names.has(String(row.a))) names.set(String(row.a), n);
      }
    } catch { /* this participant cannot answer; the next study may */ }
  }
  const out: Record<string, PlotAxis | undefined> = {};
  for (const [k, a] of Object.entries(axes))
    out[k] = a && a.source === "clinical" && !a.label && names.has(a.attribute) ? { ...a, label: names.get(a.attribute)! } : a;
  return out as T;
}
