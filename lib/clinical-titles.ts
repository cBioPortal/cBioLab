// A clinical axis titled by its attribute's display name, as the portal titles it (getAxisLabel,
// PLT-DT-19), resolved onto the axis once so every view that names it — a plot's axes and colour
// key, a forest's exposure, a model's covariates — says the same thing.
import { sq } from "./compiler.ts";
import { clinicalMetaTable } from "./custom-data.ts";
import { aggregateSql, type AggregateSql } from "./sql-kinds.ts";
import type { PlotAxis } from "./plot.ts";

/** the display names a study declares for these attributes: one row per attribute, columns `a` and `name` */
export function clinicalNamesSql(attrs: string[]): (study: string, db: string) => AggregateSql {
  return (study, db) => aggregateSql(
    "SELECT cam.attr_id AS a, any(cam.display_name) AS name\n" +
    "FROM " + clinicalMetaTable(db) + " cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + " AND cam.attr_id IN (" + attrs.map(sq).join(", ") + ")\n" +
    "GROUP BY a");
}

/** what a participant needs to answer the names query */
type Meta = { viewMeta(label: string, build: (study: string, db: string) => AggregateSql): Promise<Record<string, unknown>[]> };

/**
 * The axes with each clinical one, not already labelled, titled by the first non-empty display name
 * any of `studies` declares for its attribute, in that order: a study that does not declare it, or
 * whose participant cannot answer, leaves it to the next. With no name anywhere the axis keeps none,
 * and is titled by its id.
 */
export async function titledAxes<T extends Record<string, PlotAxis | undefined>>(axes: T, resolvers: Record<string, unknown>, studies: string[]): Promise<T> {
  const attrs = [...new Set(Object.values(axes).flatMap((a) => a && a.source === "clinical" && !a.label ? [a.attribute] : []))];
  if (!attrs.length) return axes;
  const build = clinicalNamesSql(attrs);
  const perStudy = await Promise.all(studies.map(async (st) => {
    const r = resolvers[st] as Partial<Meta> | undefined;
    if (!r || typeof r.viewMeta !== "function") return new Map<string, string>();
    try {
      const rows = await r.viewMeta("clinical:names", build);
      return new Map(rows.filter((x) => x.name != null && String(x.name).trim() !== "").map((x) => [String(x.a), String(x.name)]));
    } catch { return new Map<string, string>(); }
  }));
  const nameOf = (attr: string) => perStudy.map((m) => m.get(attr)).find((n) => n != null);
  const out: Record<string, PlotAxis | undefined> = {};
  for (const [k, a] of Object.entries(axes)) {
    const name = a && a.source === "clinical" && !a.label ? nameOf(a.attribute) : undefined;
    out[k] = name ? { ...(a as PlotAxis & { source: "clinical" }), label: name } : a;
  }
  return out as T;
}
