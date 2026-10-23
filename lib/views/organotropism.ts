// Organotropism view: for each organ a cohort's patients metastasised to and each gene, whether the
// gene's alteration goes with metastasis there within cancer types (Cochran–Mantel–Haenszel), and,
// from dated timeline sites, the cumulative incidence of one site by one gene's status.
import type { ViewResult, OrganotropismView, OrganotropismCell, OrganotropismSite, OrganotropismIncidence, IncidenceCurve } from "../types.ts";
import {
  orgSourcesSql, orgSitesSql, orgOtherValuesSql, orgTopGenesSql, orgCountsSql, orgIncidenceSql,
  type OrgSource, type OrgSourceKind, type EnrichAlteration,
} from "../federation-views.ts";
import { cochranMantelHaenszel, benjaminiHochberg, aalenJohansen, cifAt, grayPermutationTest, Z_975, type CrRecord } from "../stats.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse, plural, ATTR_NAME } from "./shared.ts";

const ORG_MAX_GENES = 20, ORG_MAX_SITES = 30;
const ORG_DEFAULTS = { prefix: "DMETS_DX_", eventType: "Diagnosis", key: "TUMOR_SITE", attribute: "METASTATIC_SITE" };
const WORD: Partial<Record<EnrichAlteration, string>> = { mutation: "mutation", cna: "amplification or deep deletion", amp: "amplification", homdel: "deep deletion", sv: "structural variant" };
const HORIZONS = [12, 24, 60];
/** a study whose share of patients with a site event after their last follow-up passes this has no usable clock */
const CLOCK_TOLERANCE = 0.05;
const MIN_ARM = 10;

/** a flag attribute's suffix as a label: DMETS_DX_CNS_BRAIN → "CNS Brain" */
export const flagLabel = (s: string) => s.split("_").filter(Boolean).map((w) => w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

interface OrgStratumCounts { n: number; withSite: number; altered: number; both: number }

/** One (site, gene) cell from its per-stratum margins: the pooled counts, and the CMH test and
 *  Mantel–Haenszel odds ratio when it has enough patients (`min` altered and `min` with the site). Pure. */
export function orgCell(site: string, gene: string, strata: OrgStratumCounts[], min: number): OrganotropismCell {
  let withSite = 0, withAltered = 0, n = 0, altered = 0;
  const tables = strata.map((s) => {
    withSite += s.withSite; withAltered += s.both; n += s.n; altered += s.altered;
    // a: altered with the site, b: altered without, c: not altered with, d: not altered without
    return { a: s.both, b: s.altered - s.both, c: s.withSite - s.both, d: s.n - s.altered - s.withSite + s.both };
  });
  const cell: OrganotropismCell = { site, gene, withSite, withAltered, without: n - withSite, withoutAltered: altered - withAltered, or: null, log2Or: null, p: null, q: null, strata: 0 };
  if (altered < min || withSite < min || n - withSite < min) return cell;
  const t = cochranMantelHaenszel(tables);
  if (!t.tables) return cell;
  return { ...cell, or: t.oddsRatio, log2Or: t.oddsRatio != null && t.oddsRatio > 0 ? Math.round(Math.log2(t.oddsRatio) * 1e3) / 1e3 : null, p: t.p, strata: t.tables };
}

const SOURCE_WORD: Record<OrgSourceKind, (s: OrgSource) => string> = {
  flags: (s) => "per-organ flags " + s.prefix + "<site> (Yes / No)",
  timeline: (s) => "timeline " + s.eventType + " events' " + s.key,
  sample: (s) => "the biopsy site of a sample, " + s.attribute + ", mapped to organs",
};

export async function runOrganotropism(view: OrganotropismView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames, pin } = ctx;
  const no = (e: string) => refuse("organotropism", ctx, e);
  if (vNames.length !== 1) return no("an organotropism view reads one cohort; this one draws " + vNames.length);
  const asked = view.source == null ? "auto" : String(view.source);
  if (!["auto", "flags", "timeline", "sample"].includes(asked)) return no("source is auto, flags, timeline or sample; got " + JSON.stringify(view.source).slice(0, 30));
  const prefix = view.flagPrefix == null ? ORG_DEFAULTS.prefix : String(view.flagPrefix).trim();
  const attribute = view.siteAttribute == null ? ORG_DEFAULTS.attribute : String(view.siteAttribute).trim();
  if (!ATTR_NAME.test(prefix)) return no("flagPrefix is an attribute-name prefix; got " + JSON.stringify(view.flagPrefix).slice(0, 40));
  if (!ATTR_NAME.test(attribute)) return no("siteAttribute is an attribute name; got " + JSON.stringify(view.siteAttribute).slice(0, 40));
  const eventType = String(view.timeline?.eventType || ORG_DEFAULTS.eventType).trim().slice(0, 120);
  const key = String(view.timeline?.key || ORG_DEFAULTS.key).trim().slice(0, 120);
  const stratifyBy = view.stratifyBy === null ? null : view.stratifyBy == null || view.stratifyBy === "" ? "CANCER_TYPE" : String(view.stratifyBy).trim();
  if (stratifyBy && !ATTR_NAME.test(stratifyBy)) return no("stratifyBy is a clinical attribute name, or null; got " + JSON.stringify(view.stratifyBy).slice(0, 40));
  const alteration = (view.alteration || "mutation") as EnrichAlteration;
  if (!WORD[alteration]) return no("alteration is mutation, cna, amp, homdel or sv; got " + JSON.stringify(view.alteration).slice(0, 30));
  const measure: "any" | "driver" = view.measure === "any" ? "any" : "driver";
  if (measure === "driver" && !pin) return no("no OncoKB annotation pin is available here, so drivers cannot be called; set measure \"any\"");
  const min = view.minPatients == null ? 5 : Math.floor(Number(view.minPatients));
  if (!(min >= 1 && min <= 10000)) return no("minPatients is 1 to 10000");
  const top = view.top == null ? 12 : Math.floor(Number(view.top));
  if (!(top >= 1 && top <= ORG_MAX_GENES)) return no("top is 1 to " + ORG_MAX_GENES + " genes");
  const askedGenes = Array.isArray(view.genes) && view.genes.length ? [...new Set(view.genes.map((g) => String(g).trim().toUpperCase()).filter(Boolean))] : null;
  if (askedGenes) {
    const e = overLimit("an organotropism view", ORG_MAX_GENES, askedGenes.length); if (e) return no(e.replace("at most " + ORG_MAX_GENES, "at most " + ORG_MAX_GENES + " genes"));
    const bad = askedGenes.find((g) => !/^[A-Z0-9_.-]{1,40}$/.test(g)); if (bad) return no("'" + bad.slice(0, 40) + "' is not a gene symbol");
  }
  const n = vNames[0];
  if (!cohorts[n].count) return no("nothing to read: cohort “" + n + "” is empty");
  const { ok, excluded } = answering(ctx);
  if (!Object.keys(ok).length) return no("no participant can answer: " + excluded.map((e) => e.study + " is " + e.reason).join("; "));
  const def = doc.cohorts[n];
  const studies = cohorts[n].studies.filter((s) => ok[s]);

  // which source the cohort carries
  const found = { flag_patients: 0, flags: 0, timeline_patients: 0, sample_patients: 0 };
  for (const st of studies) {
    const [r] = await ok[st].viewAggregate("organotropism:sources", def, (c, s, d) => orgSourcesSql(c, s, d, { prefix, eventType, key, attribute }));
    if (r) for (const k of Object.keys(found) as (keyof typeof found)[]) found[k] += Number(r[k]) || 0;
  }
  const have: Record<OrgSourceKind, number> = { flags: found.flags ? found.flag_patients : 0, timeline: found.timeline_patients, sample: found.sample_patients };
  const kind: OrgSourceKind | undefined = asked === "auto" ? (["flags", "timeline", "sample"] as const).find((k) => have[k] > 0) : asked as OrgSourceKind;
  const listing = plural(have.flags, "patient") + " with " + prefix + "* flags (" + plural(found.flags, "flag") + "), " +
    plural(have.timeline, "patient") + " with " + eventType + " / " + key + " on the timeline, " + plural(have.sample, "patient") + " with " + attribute;
  if (!kind || !have[kind]) return no("“" + n + "” has no metastatic sites from " + (kind ? SOURCE_WORD[kind]({ kind, prefix, eventType, key, attribute }) : "any source") + ": it has " + listing);
  const src: OrgSource = kind === "flags" ? { kind, prefix } : kind === "timeline" ? { kind, eventType, key } : { kind, attribute };

  // the sites
  const siteMap = new Map<string, OrganotropismSite>();
  const otherValues = new Map<string, number>();
  for (const st of studies) {
    const [rows, other] = await Promise.all([
      ok[st].viewAggregate("organotropism:sites", def, (c, s, d) => orgSitesSql(c, s, d, src)),
      kind === "sample" ? ok[st].viewAggregate("organotropism:other", def, (c, s, d) => orgOtherValuesSql(c, s, d, attribute)) : Promise.resolve([])]);
    for (const r of rows) {
      const site = String(r.site);
      const x = siteMap.get(site) || { site, label: kind === "flags" ? flagLabel(site) : String(r.label), evaluable: 0, withSite: 0 };
      x.evaluable += Number(r.evaluable); x.withSite += Number(r.with_site);
      siteMap.set(site, x);
    }
    for (const r of other) otherValues.set(String(r.value), (otherValues.get(String(r.value)) || 0) + Number(r.patients));
  }
  const allSites = [...siteMap.values()].sort((a, b) => b.withSite - a.withSite || a.label.localeCompare(b.label));
  let sites: OrganotropismSite[];
  if (Array.isArray(view.sites) && view.sites.length) {
    const want = view.sites.map((s) => String(s).trim().toLowerCase());
    const missing = want.filter((w) => !allSites.some((s) => s.label.toLowerCase() === w || s.site.toLowerCase() === w));
    if (missing.length) return no("no site " + missing.map((m) => "“" + m + "”").join(", ") + " in “" + n + "”; its sites are " + allSites.map((s) => s.label + " (" + s.withSite + ")").join(", "));
    sites = allSites.filter((s) => want.includes(s.label.toLowerCase()) || want.includes(s.site.toLowerCase()));
  } else sites = allSites.filter((s) => s.withSite >= min);
  { const e = overLimit("an organotropism view", ORG_MAX_SITES, sites.length); if (e) return no(e.replace("at most " + ORG_MAX_SITES, "at most " + ORG_MAX_SITES + " sites") + "; choose them with sites"); }
  if (!sites.length) return no("no site has " + min + " or more patients with a metastasis there in “" + n + "”: " + allSites.map((s) => s.label + " (" + s.withSite + ")").join(", "));

  // the genes
  const driverPin = measure === "driver" ? pin : null;
  let genes: { gene: string; altered?: number }[];
  if (askedGenes) genes = askedGenes.map((gene) => ({ gene }));
  else {
    const tally = new Map<string, number>();
    for (const st of studies) for (const r of await ok[st].viewAggregate("organotropism:top", def, (c, s, d) => orgTopGenesSql(c, s, d, { alteration, driverPin }, top)))
      tally.set(String(r.gene), (tally.get(String(r.gene)) || 0) + Number(r.altered));
    genes = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([gene, altered]) => ({ gene, altered }));
    if (!genes.length) return no("no patient of “" + n + "” has a " + WORD[alteration] + (driverPin ? " called an OncoKB driver" : "") + " on a covering panel");
  }
  const geneList = genes.map((g) => g.gene);

  // the counts, per (site, gene, stratum)
  const strata = new Map<string, OrgStratumCounts[]>();
  const strataSeen = new Set<string>();
  for (const st of studies) {
    const rows = await ok[st].viewAggregate("organotropism:counts", def, (c, s, d) => orgCountsSql(c, s, d, src, { genes: geneList, alteration, driverPin }, stratifyBy));
    for (const r of rows) {
      const k = String(r.site) + "\u0000" + String(r.gene);
      let a = strata.get(k); if (!a) strata.set(k, a = []);
      // strata are kept per study too: a study's cancer types are its own vocabulary
      strataSeen.add(st + "\u0000" + String(r.stratum));
      a.push({ n: Number(r.n), withSite: Number(r.with_site), altered: Number(r.altered), both: Number(r.both) });
    }
  }
  const cells: OrganotropismCell[] = [];
  for (const s of sites) for (const g of geneList) cells.push(orgCell(s.site, g, strata.get(s.site + "\u0000" + g) || [], min));
  const tested = cells.filter((c) => c.p != null);
  benjaminiHochberg(tested.map((c) => c.p!)).forEach((q, i) => { tested[i].q = q; });
  const significant = tested.filter((c) => c.q! < 0.05).length;

  // the cumulative incidence of one site by one gene's status, from dated timeline sites
  let incidence: OrganotropismIncidence | undefined, noIncidence: string | undefined;
  if (kind === "timeline" && view.incidence !== null) {
    const best = [...tested].sort((a, b) => a.p! - b.p! || a.site.localeCompare(b.site))[0];
    const wantSite = view.incidence?.site ? String(view.incidence.site).trim().toLowerCase() : null;
    const site = wantSite ? allSites.find((s) => s.label.toLowerCase() === wantSite || s.site === wantSite) : sites.find((s) => s.site === best?.site);
    const gene = view.incidence?.gene ? String(view.incidence.gene).trim().toUpperCase() : best?.gene;
    if (wantSite && !site) return no("incidence.site “" + wantSite + "” is not a site of “" + n + "”; its sites are " + allSites.map((s) => s.label).join(", "));
    if (gene && !/^[A-Z0-9_.-]{1,40}$/.test(gene)) return no("incidence.gene '" + gene.slice(0, 40) + "' is not a gene symbol");
    if (!site || !gene) noIncidence = "no cell was tested, so there is no site and gene to follow over time";
    else {
      const arms = [gene + " altered", gene + " not altered"];
      const recs: CrRecord[][] = [[], []];
      const curves: IncidenceCurve[] = [];
      let late = 0, records = 0;
      for (const [i, altered] of [true, false].entries()) {
        const ex = { prior: 0, unobserved: 0, noFollowup: 0, noAnchor: 0 };
        for (const st of studies) {
          const rows = await ok[st].viewAggregate("organotropism:incidence:" + (altered ? "altered" : "wildtype"), def,
            (c, s, d) => orgIncidenceSql(c, s, d, src, { genes: [gene], alteration, driverPin }, altered, site.label));
          for (const r of rows) {
            const k = String(r.kind), cnt = Number(r.n);
            if (k === "prior") { ex.prior += cnt; continue; }
            if (k === "unobserved") { ex.unobserved += cnt; continue; }
            if (k === "nofollowup") { ex.noFollowup += cnt; continue; }
            records += cnt;
            if (Number(r.late)) late += cnt;
            const entry = Number(r.entry), t = Number(r.t), cause = Number(r.cause) as 0 | 1 | 2;
            for (let j = 0; j < cnt; j++) recs[i].push(entry > 0 ? { t, cause, entry } : { t, cause });
          }
        }
        const entryKey = (r: CrRecord) => r.entry ?? -Infinity;
        recs[i].sort((x, y) => x.t - y.t || x.cause - y.cause || (entryKey(x) < entryKey(y) ? -1 : entryKey(x) > entryKey(y) ? 1 : 0));
        const c = aalenJohansen(recs[i]);
        curves.push({ cohort: arms[i], n: c.n, events: c.events, competing: c.competing, censored: c.censored, excluded: ex, late: 0,
          points: c.points.map((pt) => ({ t: pt.t, f1: Math.round(pt.f1 * 1e5) / 1e5, f2: Math.round(pt.f2 * 1e5) / 1e5, se1: Math.round(pt.se1 * 1e5) / 1e5, atRisk: pt.atRisk })) });
      }
      if (records && late / records > CLOCK_TOLERANCE)
        noIncidence = plural(late, "patient") + " of " + records.toLocaleString("en-US") + " have their first " + site.label + " event after their last follow-up (OS_MONTHS), so the timeline and OS_MONTHS do not share a clock here and the incidence is not drawn";
      else if (curves.some((c) => c.n < MIN_ARM))
        noIncidence = "fewer than " + MIN_ARM + " patients in a group (" + curves.map((c) => c.cohort + " " + c.n).join(", ") + ") for the incidence of " + site.label;
      else {
        const perms = records > 50000 ? 500 : 2000;
        incidence = { site: site.label, gene, curves, late, records, gray: grayPermutationTest(recs, perms, 1),
          horizons: HORIZONS.map((months) => ({ months, cells: curves.map((c, i) => {
            const at = cifAt(aalenJohansen(recs[i]), months);
            return { cohort: c.cohort, f1: at.f1, lo: Math.max(0, at.f1 - Z_975 * at.se1), hi: Math.min(1, at.f1 + Z_975 * at.se1),
              atRisk: recs[i].filter((r) => (r.entry ?? -Infinity) < months && r.t >= months).length };
          }) })) };
      }
    }
  }

  const word = WORD[alteration]!;
  const multi = ctx.vStudies.length > 1;
  const sourceLabel = SOURCE_WORD[kind](src);
  const nStrata = strataSeen.size;
  const other = [...otherValues].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, patients]) => ({ value, patients }));
  const sourceWords = kind === "flags"
    ? "Sites are the per-organ flags " + prefix + "<site>: a patient has a metastasis to a site when any of their records says Yes, and is evaluable for it when the flag is recorded Yes or No. "
    : kind === "timeline"
      ? "Sites are the values of " + key + " on " + eventType + " timeline events, at any date: a patient with any site recorded is evaluable for every site, and has a site when an event names it. The timeline's tumour sites include the primary tumour's own organ, so the column for the organ a cancer type starts in mostly records primaries. "
      : "Sites are the biopsy sites of the cohort's samples (" + attribute + "), free text mapped to organs by this view's own rules (lib/federation-views.ts ORG_SITE_MAP); values matching no rule are counted as Other" +
        (other.length ? " — here " + other.slice(0, 12).map((o) => "“" + o.value + "” (" + o.patients + ")").join(", ") + (other.length > 12 ? " and " + (other.length - 12) + " more" : "") : "") +
        ". Every cohort patient is evaluable; a site is one a metastasis was sampled from, not every site a patient's cancer reached, so “without” includes patients whose metastases there were never biopsied. ";
  return {
    kind: "organotropism", cohorts: vNames,
    organotropism: { source: kind, sourceLabel, alteration: word, measure, stratifyBy, minPatients: min, patients: cohorts[n].count,
      sites, genes, cells, tested: tested.length, significant,
      ...(kind === "sample" ? { otherValues: other } : {}), ...(incidence ? { incidence } : {}), ...(noIncidence ? { noIncidence } : {}),
      ...(excluded.length ? { excluded } : {}) },
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(multi ? { studies: ctx.vStudies } : {}),
    caveat: sourceWords +
      "Per site and gene, the patients evaluable for the site and profiled for the gene (a " + (alteration === "mutation" ? "mutation" : alteration === "sv" ? "structural-variant" : "copy-number") +
      " panel listing it, or whole-exome; a patient not profiled is in neither group, never wild-type) are split by metastasis there and by a " + word + (driverPin ? " the OncoKB store (" + driverPin + ") calls oncogenic or likely oncogenic" : "") +
      " in the gene called on a covering panel, in any of their samples. " +
      (stratifyBy ? "The 2×2 tables are stratified by " + stratifyBy + " per patient (“Multiple” when samples disagree, a stratum of its own; " + plural(nStrata, "stratum", "strata") + (multi ? ", kept per study" : "") + "), and tested by the Cochran–Mantel–Haenszel test (continuity-corrected) with the Mantel–Haenszel common odds ratio — so a gene is compared with metastasis WITHIN cancer types, and a cancer type that both carries the gene and spreads to the site does not make the association by itself. " : "The 2×2 tables are not stratified (stratifyBy null) — a gene common in a cancer type that often spreads to a site will look associated with it; the Cochran–Mantel–Haenszel test is run on the one table. ") +
      "A cell is tested with at least " + min + " altered patients, " + min + " with the site and " + min + " without; Benjamini–Hochberg q over the " + plural(tested.length, "cell") + " tested. The colour is log2 of the odds ratio. " +
      "A site is only recorded where imaging, biopsy or the source's own abstraction found it, so detection follows practice (who was scanned, how often, which sites are biopsied); patients sequenced from a metastasis are more likely to have that site recorded. Associations are not adjusted for stage, time followed, treatment or tumour mutation burden. " +
      (incidence ? "The lower panel: cumulative incidence of the first " + incidence.site + " event after the timeline's day 0 for patients profiled for " + incidence.gene + ", altered against not, death (OS_STATUS) competing, Aalen–Johansen with delta-method 95% intervals; patients with the site at or before day 0 are excluded rather than counted as free of it (" +
        incidence.curves.map((c) => c.cohort + " " + c.excluded.prior).join(", ") + "), as are those without follow-up. Censoring at OS_MONTHS on the timeline's clock; " + plural(incidence.late, "patient") + " of " + incidence.records.toLocaleString("en-US") +
        " have the event after the last follow-up (refused above " + Math.round(CLOCK_TOLERANCE * 100) + "%). Gray's test by permutation (" + incidence.gray!.permutations + " shuffles, seeded). " : noIncidence ? "No incidence panel: " + noIncidence + ". " : "") +
      (multi ? "Counts are summed across " + ctx.vStudies.length + " studies; overlap is not deduplicated and site vocabularies are not harmonised. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
