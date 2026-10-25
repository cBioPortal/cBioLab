// A profile axis resolved against the studies it is drawn over: the study's own description of the
// profile (lib/profile-catalog.ts) decides what the axis is, and the engine then runs the form that
// reading calls for. A profile a study lacks, or one two pooled studies describe differently, is
// refused by name rather than read as something it is not.
import type { PlotAxis } from "./plot.ts";
import { profileUse, plottableProfiles, type ProfileInfo } from "./profile-catalog.ts";

/** each study the axis is drawn over, with its profiles as it describes them */
export type StudyCatalog = { study: string; catalog: ProfileInfo[] };

export function resolveProfileAxis(a: PlotAxis, which: string, studies: StudyCatalog[]): PlotAxis {
  if (!a || a.source !== "profile") return a;
  const found = studies.map((s) => ({ study: s.study, catalog: s.catalog, info: s.catalog.find((p) => p.profile === a.profile) }));
  const missing = found.filter((f) => !f.info);
  if (missing.length) {
    const offer = plottableProfiles(missing[0].catalog).map((p) => p.profile);
    throw new Error(which + " axis: " + missing.map((m) => m.study).join(", ") + " has no profile '" + a.profile + "'" +
      (offer.length ? "; it has " + offer.slice(0, 12).join(", ") + (offer.length > 12 ? " and " + (offer.length - 12) + " more" : "") : "; it has none a plot axis can read"));
  }
  const uses = [...new Set(found.map((f) => profileUse(f.info!)))];
  if (uses.length > 1)
    throw new Error(which + " axis: the profile '" + a.profile + "' is described differently by " + found.map((f) => f.study + " (" + f.info!.type + ", " + f.info!.datatype + ")").join(" and ") +
      ", so one axis cannot read it across them");
  const info = found[0].info!, use = uses[0];
  if (!use) throw new Error(which + " axis: '" + a.profile + "' (" + info.type + ", " + info.datatype + ") is not a profile a plot axis reads");
  if (a.by != null && use !== "mutation") throw new Error(which + " axis: only a mutation profile groups by mutation type or mutated; '" + a.profile + "' is " + info.name);
  if (a.log && use !== "number" && use !== "assayNumber") throw new Error(which + " axis: a log scale applies to numbers; '" + a.profile + "' is " + info.name);
  if (use === "assayNumber" || use === "assayCategory") {
    if (a.entity == null) throw new Error(which + " axis: '" + a.profile + "' is a generic assay (" + info.name + "); name the entity it reads (a signature, an arm, a probe), not a gene");
    const levels = new Set(found.map((f) => !!f.info!.patientLevel));
    if (levels.size > 1) throw new Error(which + " axis: '" + a.profile + "' is measured per patient in " + found.filter((f) => f.info!.patientLevel).map((f) => f.study).join(", ") +
      " and per sample in " + found.filter((f) => !f.info!.patientLevel).map((f) => f.study).join(", ") + ", so one axis cannot read it across them");
    return { source: "assay", profileType: a.profile, entity: String(a.entity), ...(use === "assayCategory" ? { categorical: true } : {}),
      ...(info.patientLevel ? { patientLevel: true } : {}), ...(a.log ? { log: true } : {}), label: a.entity + ": " + info.name };
  }
  if (a.entity != null) throw new Error(which + " axis: only a generic-assay profile reads an entity; '" + a.profile + "' is " + info.name + ", which reads a gene");
  const gene = String(a.gene).toUpperCase();
  const label = gene + ": " + info.name;
  if (use === "mutation") return { source: "alteration", gene, by: a.by || "mutationType" };
  if (use === "sv") return { source: "alteration", gene, by: "sv" };
  if (use === "discrete") return { source: "molecular", profileType: a.profile, gene, discrete: true, label };
  return { source: "molecular", profileType: a.profile, gene, ...(a.log ? { log: true } : {}), label };
}

/** every axis of a view resolved; `null` axes (an unset colour) pass through */
export function resolveAxes<T extends Record<string, PlotAxis | undefined>>(axes: T, studies: StudyCatalog[]): T {
  const out: Record<string, PlotAxis | undefined> = {};
  for (const [k, a] of Object.entries(axes)) out[k] = a ? resolveProfileAxis(a, k, studies) : a;
  return out as T;
}
