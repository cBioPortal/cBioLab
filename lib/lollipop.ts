// The lollipop, reproduced from cBioPortal's results-page mutation tab (react-mutation-mapper and
// cbioportal-frontend-commons). Each rule below cites the function it copies, so a difference
// from the portal is a bug here rather than a design choice. Pure except fetchProteinInfo.
import type { LollipopReport } from "./federation.ts";
import type { HotspotGene, LollipopPosition, LollipopDomain } from "./types.ts";

// ---- mutation types: getCanonicalMutationType / getProteinImpactTypeFromCanonical ----------

const CANONICAL: Record<string, string> = {
  missense_mutation: "missense", missense: "missense", missense_variant: "missense",
  frame_shift_ins: "frame_shift_ins", frame_shift_del: "frame_shift_del", frameshift: "frameshift",
  frameshift_deletion: "frame_shift_del", frameshift_insertion: "frame_shift_ins",
  de_novo_start_outofframe: "frameshift", frameshift_variant: "frameshift",
  nonsense_mutation: "nonsense", nonsense: "nonsense", stopgain_snv: "nonsense", stop_gained: "nonsense",
  splice_site: "splice_site", splice: "splice_site", "splice site": "splice_site", splicing: "splice_site",
  splice_site_snp: "splice_site", splice_site_del: "splice_site", splice_site_indel: "splice_site",
  splice_region_variant: "splice_site", splice_region: "splice_site",
  translation_start_site: "nonstart", initiator_codon_variant: "nonstart", start_codon_snp: "nonstart", start_codon_del: "nonstart",
  nonstop_mutation: "nonstop", stop_lost: "nonstop",
  inframe_del: "in_frame_del", inframe_deletion: "in_frame_del", in_frame_del: "in_frame_del", in_frame_deletion: "in_frame_del",
  inframe_ins: "in_frame_ins", inframe_insertion: "in_frame_ins", in_frame_ins: "in_frame_ins", in_frame_insertion: "in_frame_ins",
  indel: "in_frame_del", nonframeshift_deletion: "inframe", nonframeshift: "inframe",
  "nonframeshift insertion": "inframe", nonframeshift_insertion: "inframe",
  targeted_region: "other", inframe: "inframe", truncating: "truncating", feature_truncation: "truncating",
  fusion: "fusion", silent: "silent", synonymous_variant: "silent", any: "other", other: "other"
};
export const canonicalType = (mtype: string): string => CANONICAL[String(mtype).toLowerCase()] || "other";

export type ImpactType = "missense" | "truncating" | "inframe" | "splice" | "fusion" | "other";
export function impactType(canonical: string): ImpactType {
  switch (canonical) {
    case "missense": return "missense";
    case "frame_shift_ins": case "frame_shift_del": case "frameshift": case "nonsense":
    case "nonstart": case "nonstop": case "truncating": return "truncating";
    case "splice_site": return "splice";
    case "in_frame_ins": case "in_frame_del": case "inframe": return "inframe";
    case "fusion": return "fusion";
    default: return "other";
  }
}

/** MUTATION_TYPE_PRIORITY — the tie-break when two types have the same count at a codon */
const PRIORITY: Record<string, number> = {
  missense: 1, inframe: 2, truncating: 4, nonsense: 6, nonstop: 7, nonstart: 8, frameshift: 4,
  frame_shift_del: 4, frame_shift_ins: 5, in_frame_ins: 3, in_frame_del: 2, splice_site: 9, fusion: 10, silent: 11, other: 11
};

/** AlterationColors: [putative driver, VUS] per protein impact type */
export const IMPACT_COLORS: Record<ImpactType, { driver: string; vus: string; label: string }> = {
  missense: { driver: "#008000", vus: "#53D400", label: "Missense" },
  truncating: { driver: "#000000", vus: "#708090", label: "Truncating" },
  inframe: { driver: "#993404", vus: "#a68028", label: "Inframe" },
  splice: { driver: "#e5802b", vus: "#f0b87b", label: "Splice" },
  fusion: { driver: "#8B00C9", vus: "#ce92e8", label: "Fusion" },
  other: { driver: "#cf58bc", vus: "#f96ae3", label: "Other" }
};

/**
 * getColorForProteinImpactType: aggregate raw rows by (canonical type, driver), then prefer a
 * driver over a VUS, then the higher count, then the lower type priority.
 */
export function lollipopColor(types: { mtype: string; driver: boolean; rows: number }[]): { color: string; impact: ImpactType; driver: boolean } {
  const acc = new Map<string, { canonical: string; driver: boolean; count: number }>();
  for (const t of types) {
    const canonical = canonicalType(t.mtype), key = canonical + "_" + t.driver;
    const cur = acc.get(key) || { canonical, driver: t.driver, count: 0 };
    cur.count += t.rows; acc.set(key, cur);
  }
  const best = [...acc.values()].sort((a, b) =>
    (a.driver ? 0 : 1) - (b.driver ? 0 : 1) || b.count - a.count || (PRIORITY[a.canonical] ?? 11) - (PRIORITY[b.canonical] ?? 11))[0];
  const impact = best ? impactType(best.canonical) : "other";
  const driver = best ? best.driver : true;
  return { color: driver ? IMPACT_COLORS[impact].driver : IMPACT_COLORS[impact].vus, impact, driver };
}

// ---- the label: lollipopLabelText, and LollipopMutationPlot's choice of which to label -------

/**
 * The top `size` protein changes by raw count (then alphabetically), their longest common
 * starting substring factored out — "V600E/K" — and " and N more" when there are others.
 */
export function lollipopLabelText(changes: { change: string; rows: number }[], size = 3): string {
  const ordered = [...changes].sort((a, b) => b.rows - a.rows || (a.change < b.change ? -1 : a.change > b.change ? 1 : 0));
  const picked = ordered.slice(0, size > 0 ? size : undefined).map((c) => c.change);
  const sorted = [...picked].sort();
  let start = "";
  if (sorted.length > 1) {
    const a = sorted[0], z = sorted[sorted.length - 1];
    let i = 0; while (i < a.length && a[i] === z[i]) i++;
    start = a.slice(0, i);
  }
  let label = start + picked.map((p) => p.slice(start.length)).join("/");
  if (picked.length < ordered.length) label += " and " + (ordered.length - picked.length) + " more";
  return label;
}

/**
 * maxLabels = 1, maxAllowedTies = 2: the tallest stem is labelled. When MORE than two stems tie
 * for the top, one is picked by preferring a stem inside a domain that has mutations, then the
 * one nearest the midpoint of the mutated range.
 */
export function labelledPosition(positions: LollipopPosition[], domains: LollipopDomain[]): number | null {
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) => b.n - a.n || a.pos - b.pos);
  const top = sorted.filter((p) => p.n === sorted[0].n);
  if (top.length <= 2) return sorted[0].pos;
  const lo = Math.min(...positions.map((p) => p.pos)), hi = Math.max(...positions.map((p) => p.pos)), mid = (lo + hi) / 2;
  const inMutatedDomain = (p: LollipopPosition) => domains.some((d) => p.pos >= d.start && p.pos <= d.end &&
    positions.some((q) => q.pos >= d.start && q.pos <= d.end));
  return [...top].sort((a, b) => Number(inMutatedDomain(b)) - Number(inMutatedDomain(a)) || Math.abs(a.pos - mid) - Math.abs(b.pos - mid))[0].pos;
}

/** PfamUtils: one colour per distinct domain, assigned in start order */
const DOMAIN_COLORS = ["#2dcf00", "#ff5353", "#5b5bff", "#ebd61d", "#ba21e0", "#ff9c42", "#ff7dff", "#b9264f",
  "#baba21", "#c48484", "#1f88a7", "#cafeb8", "#4a9586", "#ceb86c", "#0e180f"];

// ---- the protein: Genome Nexus, as the portal asks it --------------------------------------

export interface ProteinInfo {
  proteinLength: number; transcriptId: string;
  domains: { accession: string; name: string; start: number; end: number }[];
  /** RefSeq mRNA, versioned Ensembl transcript, CCDS, and the UniProt accession and entry name */
  ids?: { refseq?: string; ensembl?: string; ccds?: string; uniprotAccession?: string; uniprotName?: string };
}
const PROTEIN_CACHE = new Map<string, Promise<ProteinInfo | null>>();
const GN = () => (process.env.GENOME_NEXUS_URL || "https://www.genomenexus.org").replace(/\/+$/, "");

/**
 * The canonical transcript's protein length and Pfam domains, from Genome Nexus with the MSKCC
 * isoform override — the portal's default. Only a gene symbol is sent; no patient data. Null when
 * the service can't be reached, so the view degrades to the observed codon range and says so.
 */
export function fetchProteinInfo(gene: string): Promise<ProteinInfo | null> {
  const key = gene.toUpperCase();
  const hit = PROTEIN_CACHE.get(key);
  if (hit) return hit;
  const p = (async () => {
    const t = await fetch(GN() + "/ensembl/canonical-transcript/hgnc/" + encodeURIComponent(key) + "?isoformOverrideSource=mskcc",
      { signal: AbortSignal.timeout(8000) });
    if (!t.ok) return null;
    const tx = await t.json() as { transcriptId?: string; transcriptIdVersion?: string; refseqMrnaId?: string; ccdsId?: string; uniprotId?: string;
      proteinLength?: number; pfamDomains?: { pfamDomainId: string; pfamDomainStart: number; pfamDomainEnd: number }[] };
    if (!tx.proteinLength) return null;
    const ids = [...new Set((tx.pfamDomains || []).map((d) => d.pfamDomainId))];
    let names = new Map<string, string>();
    if (ids.length) {
      const r = await fetch(GN() + "/pfam/domain", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids), signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (r && r.ok) names = new Map((await r.json() as { pfamAccession: string; name: string }[]).map((d) => [d.pfamAccession, d.name]));
    }
    // the UniProt entry name (RASK_HUMAN), as the portal fetches it: from UniProt, by the
    // Swiss-Prot accession without its isoform suffix
    const accession = (tx.uniprotId || "").replace(/-\d+$/, "");
    let uniprotName: string | undefined;
    if (accession) {
      const u = await fetch("https://rest.uniprot.org/uniprotkb/search?query=accession:" + encodeURIComponent(accession) + "&format=tsv&fields=id",
        { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (u && u.ok) uniprotName = (await u.text()).split("\n")[1]?.trim() || undefined;
    }
    return { proteinLength: tx.proteinLength, transcriptId: tx.transcriptId || "",
      ids: { refseq: tx.refseqMrnaId || undefined, ccds: tx.ccdsId || undefined, uniprotAccession: accession || undefined, uniprotName,
        ensembl: tx.transcriptId ? tx.transcriptId + (tx.transcriptIdVersion ? "." + tx.transcriptIdVersion : "") : undefined },
      domains: (tx.pfamDomains || []).map((d) => ({ accession: d.pfamDomainId, name: names.get(d.pfamDomainId) || d.pfamDomainId,
        start: d.pfamDomainStart, end: d.pfamDomainEnd })) };
  })().catch(() => null);
  // a failure is not remembered: the next view asks again rather than staying degraded
  p.then((v) => { if (!v) PROTEIN_CACHE.delete(key); });
  PROTEIN_CACHE.set(key, p);
  return p;
}

// ---- one gene's lollipop, from every site's report -----------------------------------------

/**
 * Pools the sites' per-codon counts (sums: counts over disjoint patients add; across studies
 * a patient is not deduplicated, as everywhere else) and applies the portal's drawing rules.
 * A codon is drawable when 0 <= pos <= proteinLength + 1 (isInvalidPosition); everything else
 * is counted into `unpositioned` and disclosed, where the portal drops it silently.
 */
export function buildLollipopGene(gene: string, reports: LollipopReport[], protein: ProteinInfo | null): HotspotGene {
  const changes = new Map<string, { pos: number | null; change: string; n: number; rows: number }>();
  const types = new Map<string, { pos: number | null; mtype: string; driver: boolean; rows: number }>();
  let mutated = 0, pairs = 0, somaticSamples = 0, cohortSamples = 0;
  for (const rep of reports) {
    cohortSamples += rep.cohortSamples;
    for (const c of rep.changes) if (c.gene === gene) {
      const k = c.pos + "\u0000" + c.change, cur = changes.get(k);
      if (cur) { cur.n += c.n; cur.rows += c.rows; } else changes.set(k, { pos: c.pos, change: c.change, n: c.n, rows: c.rows });
    }
    for (const t of rep.types) if (t.gene === gene) {
      const k = t.pos + "\u0000" + t.mtype + "\u0000" + t.driver, cur = types.get(k);
      if (cur) cur.rows += t.rows; else types.set(k, { ...t });
    }
    const tot = rep.totals.find((x) => x.gene === gene);
    if (tot) { mutated += tot.patients; pairs += tot.pairs; somaticSamples += tot.somaticSamples; }
  }
  const observedMax = Math.max(0, ...[...changes.values()].map((c) => c.pos ?? 0));
  const proteinLength = protein?.proteinLength || observedMax || 10;
  const drawable = (pos: number | null): pos is number => pos != null && Number.isFinite(pos) && pos >= 0 && pos <= proteinLength + 1;

  const byPos = new Map<number, { change: string; n: number; rows: number }[]>();
  let returned = 0, unpositioned = 0;
  for (const c of changes.values()) {
    returned += c.n;
    if (!drawable(c.pos)) { unpositioned += c.n; continue; }
    (byPos.get(c.pos) ?? byPos.set(c.pos, []).get(c.pos)!).push({ change: c.change, n: c.n, rows: c.rows });
  }
  const positions: LollipopPosition[] = [...byPos.entries()].map(([pos, cs]) => {
    const col = lollipopColor([...types.values()].filter((t) => t.pos === pos));
    return { pos, n: cs.reduce((a, c) => a + c.n, 0), color: col.color, impact: col.impact, driver: col.driver,
      changes: cs.sort((a, b) => b.rows - a.rows || (a.change < b.change ? -1 : 1)) };
  }).sort((a, b) => a.pos - b.pos);

  const seen = new Map<string, string>();
  const domains: LollipopDomain[] = [...(protein?.domains || [])].sort((a, b) => a.start - b.start).map((d) => {
    if (!seen.has(d.accession)) seen.set(d.accession, DOMAIN_COLORS[seen.size % DOMAIN_COLORS.length]);
    return { ...d, color: seen.get(d.accession)! };
  });
  const lp = labelledPosition(positions, domains);
  const at = positions.find((p) => p.pos === lp);
  // the badge tally: every mutation row by impact type and driver status, drawn or not
  const tally: HotspotGene["tally"] = { missense: { driver: 0, vus: 0 }, truncating: { driver: 0, vus: 0 }, inframe: { driver: 0, vus: 0 },
    splice: { driver: 0, vus: 0 }, fusion: { driver: 0, vus: 0 }, other: { driver: 0, vus: 0 } };
  for (const t of types.values()) tally[impactType(canonicalType(t.mtype))][t.driver ? "driver" : "vus"] += t.rows;
  const topChanges = [...changes.values()].sort((a, b) => b.n - a.n).slice(0, 10)
    .map((c) => ({ change: c.change, pos: c.pos, n: c.n, pct: mutated ? Math.round((1000 * c.n) / mutated) / 10 : 0 }));
  return {
    gene, mutated, mutations: pairs, positions, domains, topChanges,
    proteinLength, lengthSource: protein ? "genome-nexus" : "observed", transcript: protein?.transcriptId || undefined,
    // no codon (or one past the protein), and below the suppression floor — never merged, since
    // one is about the data and the other about what a site chose not to disclose
    unpositioned, withheld: Math.max(0, pairs - returned),
    ...(at ? { label: { pos: at.pos, text: lollipopLabelText(at.changes) } } : {}),
    somaticSamples, cohortSamples, tally, ...(protein?.ids ? { ids: protein.ids } : {})
  };
}
