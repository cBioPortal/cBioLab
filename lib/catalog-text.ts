// Compact study-vocabulary text for LLM tool results (chat get_catalog).
import { resolveStudy, studyProfiles } from "./analysis.ts";
import { buildExplore } from "./explore.ts";

export async function catalogText(study?: string): Promise<string> {
  const s = await resolveStudy(study);
  const { profiles, gaProfiles } = await studyProfiles(s);
  const ex = await buildExplore({ study: s, draft: null, oncokbPin: null, profiles, gaProfiles });
  const lines: string[] = [`Catalog for ${s}:`];
  lines.push("Clinical attributes (name [patient|sample level]: values with patient counts, or numeric range):");
  for (const a of ex.clinical.slice(0, 40)) {
    if (a.kind === "num") lines.push(`- ${a.attribute} [${a.per}]: numeric, min ${a.min} median ${a.median} max ${a.max} (${a.patients} pts)`);
    else lines.push(`- ${a.attribute} [${a.per}]: ` + a.values.map(v => `${v.v} (${v.n})`).join(", "));
  }
  if (ex.events.length) lines.push("Timeline event types: " + ex.events.map(e => `${e.type} (${e.n} pts)`).join(", "));
  lines.push("Most-altered genes: " + ex.genes.slice(0, 12).map(g => `${g.gene} (${g.n})`).join(", "));
  if (ex.caseLists.length) lines.push("Case lists: " + ex.caseLists.map(c => `${c.id} (${c.n})`).join(", "));
  lines.push("Molecular profiles (for genomicData/OQL EXP/PROT): " + (profiles.join(", ") || "none") +
    (gaProfiles.length ? " | generic assay: " + gaProfiles.join(", ") : ""));
  return lines.join("\n").slice(0, 6000);
}
