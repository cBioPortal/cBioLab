// Hotspots view: a lollipop of mutation counts per protein position for each gene.
import { geneSymbols } from "../../gene-tracks.ts";
import { lollipopGeneEmpty, buildLollipopGene, fetchProteinInfo, checkHide, checkCodons, checkYMax, pruneCodons } from "../../lollipop.ts";
import type { ViewResult } from "../../types.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit, viewOql } from "../shared.ts";
import { isGrch38 } from "../../mutation-cell-text.ts";
import { studyGenomeSql } from "../../federation-views.ts";
import { hasViewAggregates, isPatientLevel } from "../../federation.ts";
import type { HotspotsView, HotspotGene } from "./types.ts";
import { checkQuery, describeQuery } from "../../table-query.ts";
import { MUTATION_COLUMNS } from "../../mutation-table.ts";
import { lollipopNarrowing } from "../../lollipop.ts";
import { driverSourceText, resolveDrivers, type ResolvedDrivers } from "../../driver-settings.ts";
import { mutationClinicalColumns, mutationDefaults } from "../mutation-defaults.ts";
import type { ClinicalColumn } from "../../mutation-clinical.ts";

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
  { const e = checkYMax(hv.yMax, uniq); if (e) return untimed({ kind: "hotspots", error: e }); }
  const yMax = hv.yMax && Object.keys(hv.yMax).length ? hv.yMax : undefined;
  const codons = pruneCodons(hv.codons && Object.fromEntries(Object.entries(hv.codons).map(([g, ps]) => [g, [...new Set(ps)].sort((a, b) => a - b)])), uniq);
  // the table's clinical-attribute columns, when its query names any (MUT-COL-36): read as the mutations view reads them
  let clinical: ClinicalColumn[] = [];
  if (hv.table !== undefined) {
    if (!hv.table || typeof hv.table !== "object" || !uniq.includes(hv.table.gene)) return untimed({ kind: "hotspots", error: "table names a gene of the view (" + uniq.join(", ") + "), not " + String((hv.table as { gene?: unknown } | null)?.gene ?? "none") });
    const named = [...(hv.table.columns || []), ...Object.keys(hv.table.filters || {})];
    if (named.some((id) => !MUTATION_COLUMNS.some((c) => c.id === id)))
      clinical = await mutationClinicalColumns(c, c.vStudies.filter((st) => isPatientLevel(resolvers[st])));
    const bad = checkQuery(hv.table, [...MUTATION_COLUMNS, ...clinical]);
    if (bad) return untimed({ kind: "hotspots", error: "table: " + bad });
  }
  let narrowing = hv.table ? lollipopNarrowing(hv.table) : null;
  if (narrowing && clinical.length) narrowing = { ...narrowing, clinical };
  let drivers: ResolvedDrivers | undefined;
  if (hv.drivers !== undefined) { try { drivers = resolveDrivers(hv.drivers); } catch (e) { return untimed({ kind: "hotspots", error: (e as Error).message }); } }
  // the table's search reads the columns it shows: with none named, its defaults, which follow its data
  if (narrowing && narrowing.search && !narrowing.columns?.length)
    narrowing = { ...narrowing, columns: await mutationDefaults(c, c.vStudies.filter((st) => isPatientLevel(resolvers[st])), hv.table!.gene, lines.oql, drivers) };
  const cn = vNames[0];
  const studies = cohorts[cn].studies;
  // the table lists only patient-level studies' rows, and only those may be narrowed by its row values
  const unnarrowed = narrowing ? studies.filter((st) => !isPatientLevel(resolvers[st])) : [];
  // the sites' counts and the proteins (length, Pfam domains) are independent, so both at once
  const [reports, proteins] = await Promise.all([
    Promise.all(studies.map((st) => resolvers[st].lollipopCounts(doc.cohorts[cn], uniq, minCount, lines.oql, hv.drivers, narrowing && !unnarrowed.includes(st) ? narrowing : undefined))),
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
  const noGermline = studies.filter((_, i) => reports[i].germlineCohortSamples === undefined);
  // the figure and the text apply the selection (lib/view-svg.ts lollipopSummaryText says what it hides);
  // `hotspots` stays whole, so the app re-filters it without a re-run
  const hr: ViewResult = { kind: "hotspots", cohorts: [cn], hotspots, studies, ...(annotated ? {} : { annotated: false }), ...(grch38 ? { grch38 } : {}), ...(hide.length ? { hide } : {}), ...(codons ? { codons } : {}), ...(yMax ? { yMax } : {}),
    participation: participationFor(studies, false),
    note: (vNames.length > 1 ? "A lollipop draws one cohort: this shows “" + cn + "” only; " +
        vNames.slice(1).map((n) => "“" + n + "”").join(", ") + (vNames.length === 2 ? " is" : " are") + " not drawn. " : "") +
      "Mutations in “" + cn + "” by protein position, as cBioPortal's mutation tab draws them: one stem per codon" +
      " (the stored protein start position), its height the number of distinct patient + protein change pairs there." +
      " Colour is the codon's dominant mutation type, putative drivers before VUS" +
      (!annotated ? (hv.drivers ? " (no driver source is switched on or offered here, so mutations are counted by type alone, as the portal does with annotation off)." : " (no OncoKB pin, so every mutation is coloured as a driver, as the portal does with annotation off).")
        : hv.drivers ? " (driver = any switched-on source of the page's driver settings: " + driverSourceText(resolveDrivers(hv.drivers), "OncoKB, pinned", "a Cancer Hotspot of its kind in the stored Genome Nexus annotation") + ")."
        : " (driver = OncoKB oncogenic, pinned, or a Cancer Hotspot of its kind in the stored Genome Nexus annotation; the portal also counts custom annotations).") +
      " VUS and germline mutations are included, as they are by default on the portal." +
      (noGermline.length ? " " + noGermline.join(", ") + (noGermline.length === 1 ? " reports" : " report") + " no germline counts (older code), so no Germline Mutation Frequency is shown." : "") +
      (narrowing ? " " + narrowing.gene + "'s stems and badges count only the mutations its table keeps, " + describeQuery(narrowing, MUTATION_COLUMNS) +
          ", as the portal's lollipop follows its table's search and filters; its Somatic Mutation Frequency does not." +
          (unnarrowed.length ? " " + unnarrowed.join(", ") + (unnarrowed.length === 1 ? " is" : " are") + " not patient-level here, so " +
            (unnarrowed.length === 1 ? "its" : "their") + " mutations are counted whole: the table's search reads row values, which do not leave " + (unnarrowed.length === 1 ? "it" : "them") + "." : "") : "") +
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
