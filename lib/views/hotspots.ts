// Hotspots view: a lollipop of mutation counts per protein position for each gene.
import { geneSymbols } from "../gene-tracks.ts";
import { buildLollipopGene, fetchProteinInfo, checkHide } from "../lollipop.ts";
import { viewToSvg } from "../view-svg.ts";
import type { ViewResult, HotspotsView, HotspotGene } from "../types.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";
import { overLimit } from "./shared.ts";

export async function runHotspots(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor, pin } = c;
  const hv = view as HotspotsView;
  const uniq = geneSymbols(hv.genes);
  if (!uniq.length) return untimed({ kind: "hotspots", error: "hotspots view needs genes" });
  { const e = overLimit("a hotspots view", 12, uniq.length); if (e) return untimed({ kind: "hotspots", error: e.replace("at most 12", "at most 12 genes") }); }
  const minCount = Math.max(1, Math.min(1000, Math.floor(Number(hv.minCount) || 1)));
  { const e = checkHide(hv.hide); if (e) return untimed({ kind: "hotspots", error: e }); }
  const hide = [...new Set(hv.hide || [])];
  const cn = vNames[0];
  const studies = cohorts[cn].studies;
  // the sites' counts and the proteins (length, Pfam domains) are independent, so both at once
  const [reports, proteins] = await Promise.all([
    Promise.all(studies.map((st) => resolvers[st].lollipopCounts(doc.cohorts[cn], uniq, minCount))),
    Promise.all(uniq.map((g) => fetchProteinInfo(g)))
  ]);
  const hotspots: HotspotGene[] = uniq.map((gene, i) => buildLollipopGene(gene, reports, proteins[i]))
    .filter((h) => h.mutated > 0);
  const f = (n: number) => n.toLocaleString("en-US");
  const unpositioned = hotspots.reduce((n, h) => n + h.unpositioned, 0);
  const withheld = hotspots.reduce((n, h) => n + h.withheld, 0);
  const observed = hotspots.filter((h) => h.lengthSource === "observed").map((h) => h.gene);
  const annotated = reports.every((r) => r.annotated);
  // the figure and the text apply the selection (lib/view-svg.ts lollipopSummaryText says what it hides);
  // `hotspots` stays whole, so the app re-filters it without a re-run
  const hr: ViewResult = { kind: "hotspots", cohorts: [cn], hotspots, studies, ...(hide.length ? { hide } : {}),
    participation: participationFor(studies, false),
    note: "Mutations in “" + cn + "” by protein position, as cBioPortal's mutation tab draws them: one stem per codon" +
      " (the stored protein start position), its height the number of distinct patient + protein change pairs there." +
      " Colour is the codon's dominant mutation type, putative drivers before VUS" +
      (annotated ? " (driver = OncoKB oncogenic, pinned; the portal also counts hotspots and custom annotations)." : " (no OncoKB pin, so every mutation is coloured as a driver, as the portal does with annotation off).") +
      " VUS and germline mutations are included, as they are by default on the portal." +
      (unpositioned ? " " + f(unpositioned) + " mutation" + (unpositioned === 1 ? " has" : "s have") + " no protein position (or one past the protein) and " +
        (unpositioned === 1 ? "is" : "are") + " not drawn; the portal drops these without saying so." : "") +
      (observed.length ? " Genome Nexus could not be reached for " + observed.join(", ") + ", so the axis runs to the highest codon seen and no domains are drawn." : "") +
      (minCount > 1
        ? " A suppression floor of " + minCount + " patients per change was applied BY EACH SITE before returning anything" +
          (withheld ? ", withholding " + f(withheld) + " mutation" + (withheld === 1 ? "" : "s") : "") + "."
        : " NOTE: with no suppression floor set (minCount), a change carried by a single patient is reported —" +
          " the most disclosive aggregate this system produces. Set minCount to have each site withhold rare changes at source.") +
      (studies.length > 1 ? " Counts sum across studies; a patient enrolled in more than one is not deduplicated." : "") };
  hr.svg = viewToSvg(hr, { width: 960 }) || undefined;
  return hr;
}
