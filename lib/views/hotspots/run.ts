// Hotspots view: a lollipop of mutation counts per protein position for each gene.
import { geneSymbols } from "../../gene-tracks.ts";
import { lollipopGeneEmpty, buildLollipopGene, fetchProteinInfo, checkHide, checkCodons, pruneCodons } from "../../lollipop.ts";
import type { ViewResult } from "../../types.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit, viewOql } from "../shared.ts";
import { isGrch38 } from "../../mutation-cell-text.ts";
import { studyGenomeSql } from "../../federation-views.ts";
import { hasViewAggregates } from "../../federation.ts";
import type { HotspotsView, HotspotGene } from "./types.ts";

export async function runHotspots(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  const hv = view as HotspotsView;
  const uniq = geneSymbols(hv.genes);
  if (!uniq.length) return untimed({ kind: "hotspots", error: "hotspots view needs genes" });
  { const e = overLimit("a hotspots view", 12, uniq.length); if (e) return untimed({ kind: "hotspots", error: e.replace("at most 12", "at most 12 genes") }); }
  const lines = viewOql(hv);
  if ("error" in lines) return untimed({ kind: "hotspots", error: lines.error });
  const minCount = Math.max(1, Math.min(1000, Math.floor(Number(hv.minCount) || 1)));
  { const e = checkHide(hv.hide); if (e) return untimed({ kind: "hotspots", error: e }); }
  const hide = [...new Set(hv.hide || [])];
  { const e = checkCodons(hv.codons, uniq); if (e) return untimed({ kind: "hotspots", error: e }); }
  const codons = pruneCodons(hv.codons && Object.fromEntries(Object.entries(hv.codons).map(([g, ps]) => [g, [...new Set(ps)].sort((a, b) => a - b)])), uniq);
  const cn = vNames[0];
  const studies = cohorts[cn].studies;
  // the sites' counts and the proteins (length, Pfam domains) are independent, so both at once
  const [reports, proteins] = await Promise.all([
    Promise.all(studies.map((st) => resolvers[st].lollipopCounts(doc.cohorts[cn], uniq, minCount, lines.oql))),
    Promise.all(uniq.map((g) => fetchProteinInfo(g)))
  ]);
  // every queried gene, an empty one included: the portal keeps its tab and draws its plot empty
  const hotspots: HotspotGene[] = uniq.map((gene, i) => buildLollipopGene(gene, reports, proteins[i]));
  // the transcript links go to GRCh38 Ensembl only when every study is on it, as the portal decides
  // (a remote peer that serves no metadata reads as GRCh37, the default)
  const grch38 = isGrch38(await Promise.all(studies.map(async (st) => {
    const r = resolvers[st];
    return hasViewAggregates(r) ? String((await r.viewMeta("genome:build", studyGenomeSql))[0]?.build || "") : "";
  })));
  const f = (n: number) => n.toLocaleString("en-US");
  const empty = hotspots.filter(lollipopGeneEmpty).map((h) => h.gene);
  const unpositioned = hotspots.reduce((n, h) => n + h.unpositioned, 0);
  const withheld = hotspots.reduce((n, h) => n + h.withheld, 0);
  const observed = hotspots.filter((h) => h.lengthSource === "observed").map((h) => h.gene);
  const annotated = reports.every((r) => r.annotated);
  // the figure and the text apply the selection (lib/view-svg.ts lollipopSummaryText says what it hides);
  // `hotspots` stays whole, so the app re-filters it without a re-run
  const hr: ViewResult = { kind: "hotspots", cohorts: [cn], hotspots, studies, ...(grch38 ? { grch38 } : {}), ...(hide.length ? { hide } : {}), ...(codons ? { codons } : {}),
    participation: participationFor(studies, false),
    note: (vNames.length > 1 ? "A lollipop draws one cohort: this shows “" + cn + "” only; " +
        vNames.slice(1).map((n) => "“" + n + "”").join(", ") + (vNames.length === 2 ? " is" : " are") + " not drawn. " : "") +
      "Mutations in “" + cn + "” by protein position, as cBioPortal's mutation tab draws them: one stem per codon" +
      " (the stored protein start position), its height the number of distinct patient + protein change pairs there." +
      " Colour is the codon's dominant mutation type, putative drivers before VUS" +
      (annotated ? " (driver = OncoKB oncogenic, pinned, or a Cancer Hotspot of its kind in the stored Genome Nexus annotation; the portal also counts custom annotations)." : " (no OncoKB pin, so every mutation is coloured as a driver, as the portal does with annotation off).") +
      " VUS and germline mutations are included, as they are by default on the portal." +
      (empty.length ? " " + empty.join(", ") + (empty.length === 1 ? " has" : " have") + " no mutations in “" + cn + "”: " + (empty.length === 1 ? "its plot is" : "their plots are") +
        " drawn empty, with no somatic mutation frequency, as the portal draws a gene with none." : "") +
      " Structural variants are counted as the portal's Mutations tab counts them: in the Fusion badge of each queried partner, and in the somatic frequency of their site 1 gene only; they have no codon, so no stem, and the mutation table lists them." +
      (unpositioned ? " " + f(unpositioned) + " mutation" + (unpositioned === 1 ? " has" : "s have") + " no protein position (or one past the protein) and " +
        (unpositioned === 1 ? "is" : "are") + " not drawn; the portal drops these without saying so." : "") +
      (observed.length ? " Genome Nexus could not be reached for " + observed.join(", ") + ", so the axis runs to the highest codon seen and no domains are drawn." : "") +
      (minCount > 1
        ? " A suppression floor of " + minCount + " patients per change was applied BY EACH SITE before returning anything" +
          (withheld ? ", withholding " + f(withheld) + " mutation" + (withheld === 1 ? "" : "s") : "") + "."
        : " NOTE: with no suppression floor set (minCount), a change carried by a single patient is reported —" +
          " the most disclosive aggregate this system produces. Set minCount to have each site withhold rare changes at source.") +
      (studies.length > 1 ? " Counts sum across studies; a patient enrolled in more than one is not deduplicated." : "") };
  return hr;
}
