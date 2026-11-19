// The lollipop, reproduced from cBioPortal's results-page mutation tab (react-mutation-mapper and
// cbioportal-frontend-commons). Each rule below cites the function it copies, so a difference
// from the portal is a bug here rather than a design choice. Pure except fetchProteinInfo.
import type { LollipopReport } from "./federation.ts";
import type { HotspotGene, LollipopPosition, LollipopDomain } from "./views/hotspots/types.ts";
import type { ColumnFilter, TableQuery } from "./table-query.ts";

// ---- mutation types: getCanonicalMutationType / getProteinImpactTypeFromCanonical ----------

export const CANONICAL: Record<string, string> = {
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

export const IMPACT_TYPES: readonly ImpactType[] = ["missense", "truncating", "inframe", "splice", "fusion", "other"];

/**
 * A mutation type column's protein impact class in SQL, the same mapping canonicalType and
 * impactType make in the browser (generated from CANONICAL, so the two cannot drift): what a
 * site returns per change so the lollipop can be filtered by class, and the mutation table's
 * alteration column.
 */
export function impactSql(col: string): string {
  const by = new Map<ImpactType, string[]>();
  for (const [raw, canonical] of Object.entries(CANONICAL)) {
    const k = impactType(canonical);
    if (k !== "other") (by.get(k) ?? by.set(k, []).get(k)!).push(raw);
  }
  const quote = (x: string) => "'" + x.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  return "multiIf(" + IMPACT_TYPES.filter((k) => k !== "other" && by.has(k))
    .map((k) => "lowerUTF8(" + col + ") IN (" + by.get(k)!.map(quote).join(", ") + "), '" + k + "'").join(", ") + ", 'other')";
}

/** A cell of the Driver/VUS × impact class grid, the unit a lollipop's selection hides: "missense.vus". */
export type AlterationCell = `${ImpactType}.${"driver" | "vus"}`;
export const ALTERATION_CELLS: readonly AlterationCell[] = IMPACT_TYPES.flatMap((k) => [k + ".driver", k + ".vus"] as AlterationCell[]);
export const cellOf = (impact: string, driver: boolean): AlterationCell => ((IMPACT_TYPES as readonly string[]).includes(impact) ? impact : "other") + (driver ? ".driver" : ".vus") as AlterationCell;
/** "Missense · Driver" — how the mutation table's alteration column spells a cell */
export const cellLabel = (c: AlterationCell): string => IMPACT_COLORS[c.split(".")[0] as ImpactType].label + (c.endsWith(".driver") ? " · Driver" : " · VUS");

/** What is wrong with a selection's `hide` list, or null. */
export function checkHide(hide: unknown): string | null {
  if (hide == null) return null;
  if (!Array.isArray(hide) || hide.some((h) => typeof h !== "string")) return "hide is a list of cells like \"missense.vus\"";
  const bad = hide.filter((h) => !(ALTERATION_CELLS as readonly string[]).includes(h));
  return bad.length ? "unknown cell " + bad.join(", ") + " in hide — cells are <class>.driver or <class>.vus, classes " + IMPACT_TYPES.join(", ") : null;
}

/** A selection of codons on each gene's lollipop: `{"KRAS": [12, 13]}` — the stems a click picks. */
export type CodonSelection = Record<string, number[]>;

/** What is wrong with a view's `codons` selection, given the genes it draws, or null. */
export function checkCodons(codons: unknown, genes: readonly string[]): string | null {
  if (codons == null) return null;
  const shape = "codons is an object from gene to a list of protein positions, like {\"KRAS\": [12, 13]}";
  if (typeof codons !== "object" || Array.isArray(codons)) return shape;
  for (const [g, ps] of Object.entries(codons as Record<string, unknown>)) {
    if (!genes.includes(g)) return "codons." + g + ": not a gene of this view — its genes are " + genes.join(", ");
    if (!Array.isArray(ps) || ps.some((p) => typeof p !== "number" || !Number.isInteger(p) || p < 0)) return "codons." + g + ": " + shape;
    if (ps.length > 500) return "codons." + g + ": at most 500 positions";
  }
  return null;
}

/**
 * The selection after a click on a stem, as the portal's mutation mapper makes it
 * (react-mutation-mapper FilterUtils.updatePositionSelectionFilters): a plain click selects that
 * codon alone, or clears the selection when it was already selected; with shift held it is added
 * to or taken out of what is selected. Sorted, so the same selection is always spelled the same.
 */
export function clickCodon(selected: readonly number[], pos: number, multi: boolean): number[] {
  const on = selected.includes(pos);
  const next = multi ? selected.filter((p) => p !== pos) : [];
  if (!on) next.push(pos);
  return [...new Set(next)].sort((a, b) => a - b);
}

/** The lollipop's y-axis title, as the portal's results page words it (a stem counts patients). */
export const LOLLIPOP_Y_TITLE = "# patients";

/** A tick on the lollipop's axes; only the ticks the portal labels carry a label. */
export interface LollipopTick { pos: number; label?: string }

/**
 * The portal's tick step for an axis over [0, range]: the first candidate that gives fewer than
 * maxTickCount − 1 steps, else the first power of ten from 10 up that does.
 */
export function lollipopTickInterval(candidates: number[], range: number, maxTickCount: number): number {
  const c = candidates.find((x) => range / x < maxTickCount - 1);
  if (c != null) return c;
  let step = 10;
  while (range / step > maxTickCount - 1) step *= 10;
  return step;
}

/** every multiple of `step` strictly inside (0, max), labelled where `labelled` says */
function between(step: number, max: number, labelled: (t: number) => boolean): LollipopTick[] {
  const out: LollipopTick[] = [];
  for (let t = step; t < max; t += step) out.push(labelled(t) ? { pos: t, label: String(t) } : { pos: t });
  return out;
}

/**
 * The x axis over a protein of `length` codons: "0", "<length>aa", and the steps between, every other
 * one labelled except one within two thirds of a step of the end.
 */
export function lollipopXTicks(length: number): LollipopTick[] {
  const step = lollipopTickInterval([50, 100, 200, 250, 500, 1000, 2500, 5000, 10000, 25000], length, 16);
  return [{ pos: 0, label: "0" }, ...between(step, length, (t) => length - t > (2 * step) / 3 && t % (2 * step) === 0), { pos: length, label: length + "aa" }];
}

/** The y axis up to `max`: "0" and the maximum (">= " before it when a stem is taller), the steps between unlabelled. */
export function lollipopYTicks(max: number, capped: boolean): LollipopTick[] {
  const step = lollipopTickInterval([1, 2, 5, 10, 20, 50, 100, 200, 500], max, 10);
  return [{ pos: 0, label: "0" }, ...between(step, max, () => false), { pos: max, label: (capped ? ">= " : "") + max }];
}

/** The selection with only the genes given kept and empty lists dropped; undefined when nothing is left. */
/** a gene's y-axis maximum as the portal sets it by default: the tallest stem, at least 5 (MUT-STM-17) */
export const defaultYMax = (g: Pick<HotspotGene, "positions">): number => Math.max(5, ...g.positions.map((q) => q.n));

/**
 * The Y-Axis Max control's next setting for a typed or slid value: rounded, at least 1 (the portal clamps
 * below 1), and undefined — no setting — when it is the default; NaN leaves it unchanged (null).
 */
export function nextYMax(input: number, def: number): number | undefined | null {
  if (!Number.isFinite(input)) return null;
  const v = Math.max(1, Math.round(input));
  return v === def ? undefined : v;
}

/**
 * The view's `yMax` (each gene's y-axis maximum, the portal's Y-Axis Max) refused when malformed: an
 * object from a gene of the view to a whole number of at least 1 (the control clamps what is typed to that).
 */
export function checkYMax(yMax: unknown, genes: readonly string[]): string | null {
  if (yMax == null) return null;
  const shape = "yMax is an object from gene to the y axis's maximum, like {\"KRAS\": 100}";
  if (typeof yMax !== "object" || Array.isArray(yMax)) return shape;
  for (const [g, v] of Object.entries(yMax as Record<string, unknown>)) {
    if (!genes.includes(g)) return "yMax." + g + ": not a gene of this view — its genes are " + genes.join(", ");
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return "yMax." + g + ": a whole number of at least 1 — " + shape;
  }
  return null;
}

/** the view's y-axis maxima kept for the genes it draws; undefined when none is left */
export function pruneYMax(yMax: Record<string, number> | undefined, genes: readonly string[]): Record<string, number> | undefined {
  const kept = Object.entries(yMax || {}).filter(([g]) => genes.includes(g));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

export function pruneCodons(codons: CodonSelection | undefined, genes: readonly string[]): CodonSelection | undefined {
  const kept = Object.entries(codons || {}).filter(([g, ps]) => genes.includes(g) && ps.length);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * A gene's lollipop with the hidden cells left out — what the grid beside it selects. Each change
 * goes in or out whole by its class and driver status; stems, heights, colours and the label are
 * recomputed from what remains. The tally stays whole: it is the grid's own counts. A change a site
 * returned without a class (a peer on older code) cannot be judged, so it stays drawn and is counted.
 */
export function filterHotspotGene(g: HotspotGene, hide: readonly string[]): { gene: HotspotGene; shown: number; total: number; unclassed: number } {
  const total = g.positions.reduce((n, p) => n + p.n, 0);
  if (!hide.length) return { gene: g, shown: total, total, unclassed: 0 };
  const hidden = new Set(hide);
  let unclassed = 0;
  const positions: LollipopPosition[] = [];
  for (const p of g.positions) {
    const changes = p.changes.filter((c) => {
      if (!c.impact) { unclassed += c.n; return true; }
      return !hidden.has(cellOf(c.impact, !!c.driver));
    });
    if (!changes.length) continue;
    const types = (p.types || []).filter((t) => !hidden.has(cellOf(impactType(canonicalType(t.mtype)), t.driver)));
    const col = types.length ? lollipopColor(types) : { color: p.color, impact: p.impact as ImpactType, driver: p.driver };
    positions.push({ ...p, n: changes.reduce((a, c) => a + c.n, 0), changes, types, color: col.color, impact: col.impact, driver: col.driver });
  }
  const lp = labelledPosition(positions, g.domains);
  const at = positions.find((q) => q.pos === lp);
  const { label: _old, ...rest } = g;
  void _old;
  return {
    gene: { ...rest, positions, ...(at ? { label: { pos: at.pos, text: lollipopLabelText(at.changes) } } : {}) },
    shown: positions.reduce((n, p) => n + p.n, 0), total, unclassed,
  };
}

/** MUTATION_TYPE_PRIORITY — the tie-break when two types have the same count at a codon */
const PRIORITY: Record<string, number> = {
  missense: 1, inframe: 2, truncating: 4, nonsense: 6, nonstop: 7, nonstart: 8, frameshift: 4,
  frame_shift_del: 4, frame_shift_ins: 5, in_frame_ins: 3, in_frame_del: 2, splice_site: 9, fusion: 10, silent: 11, other: 11
};

/** AlterationColors: [putative driver, VUS] per protein impact type */
/**
 * The Legend panel's colour codes (LegendColorCodes), as data: a putative-driver and an
 * unknown-significance line per type when drivers are annotated, one line per type otherwise,
 * Fusion once. Splice is its own entry: the portal's legend lists "Splice site" under Truncating
 * while its stems, badges and table draw splice sites as Splice, so the legend follows the drawing.
 */
export function lollipopLegend(o: { drivers: boolean; fusions: boolean }): { label: string; color: string; items: string[] }[] {
  const WHAT: Partial<Record<ImpactType, string[]>> = {
    truncating: ["Nonsense", "Nonstop", "Frameshift deletion", "Frameshift insertion"],
    inframe: ["Inframe deletion", "Inframe insertion"],
    other: ["All other types of mutations"],
  };
  const order: ImpactType[] = ["missense", "truncating", "inframe", "splice", "fusion", "other"];
  return order.filter((k) => o.fusions || k !== "fusion").flatMap((k) => {
    const c = IMPACT_COLORS[k], items = WHAT[k] || [], name = c.label + " Mutations";
    if (k === "fusion" || !o.drivers) return [{ label: name, color: c.driver, items }];
    return [{ label: name + " (putative driver)", color: c.driver, items }, { label: name + " (unknown significance)", color: c.vus, items }];
  });
}

/** A gene the cohort has no mutation and no fusion in: the portal still draws its tab, its plot empty. */
export const lollipopGeneEmpty = (g: HotspotGene): boolean =>
  g.mutated === 0 && Object.values(g.tally).every((t) => t.driver + t.vus === 0);

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
 * A stem's tooltip as the portal's results page writes it (LollipopMutationPlot lollipopTooltip with
 * LollipopTooltipCountInfo): "N mutated of M profiled patients", M the queried patients whatever their
 * profiling, then "AA Change: " and every change at the codon. With no patient count, "N mutations".
 */
export function lollipopStemTip(q: Pick<LollipopPosition, "n" | "changes">, cohortPatients?: number): string {
  const count = cohortPatients != null ? q.n + " mutated of " + cohortPatients + " profiled patients" : q.n + " mutation" + (q.n === 1 ? "" : "s");
  return count + "\nAA Change: " + lollipopLabelText(q.changes, 0);
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
  void p.then((v) => { if (!v) PROTEIN_CACHE.delete(key); });
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
  const changes = new Map<string, { pos: number | null; change: string; n: number; rows: number; impact?: string; driver: boolean }>();
  const types = new Map<string, { pos: number | null; mtype: string; driver: boolean; rows: number }>();
  let mutated = 0, pairs = 0, somaticSamples = 0, cohortSamples = 0;
  // the germline rate's parts: a site on older code reports neither, which leaves them unknown, not 0
  let germlineSamples: number | undefined = 0, germlineCohortSamples: number | undefined = 0;
  let cohortPatients: number | undefined = 0;
  for (const rep of reports) {
    cohortSamples += rep.cohortSamples;
    germlineCohortSamples = germlineCohortSamples === undefined || rep.germlineCohortSamples === undefined ? undefined : germlineCohortSamples + rep.germlineCohortSamples;
    cohortPatients = cohortPatients != null && rep.cohortPatients != null ? cohortPatients + rep.cohortPatients : undefined;
    for (const c of rep.changes) if (c.gene === gene) {
      const k = c.pos + "\u0000" + c.change, cur = changes.get(k);
      // a class from one site is kept; a site that sent none (older code) leaves it undefined
      if (cur) { cur.n += c.n; cur.rows += c.rows; cur.driver ||= c.driver; if (!cur.impact) cur.impact = c.impact; }
      else changes.set(k, { pos: c.pos, change: c.change, n: c.n, rows: c.rows, driver: c.driver, ...(c.impact ? { impact: c.impact } : {}) });
    }
    for (const t of rep.types) if (t.gene === gene) {
      const k = t.pos + "\u0000" + t.mtype + "\u0000" + t.driver, cur = types.get(k);
      if (cur) cur.rows += t.rows; else types.set(k, { ...t });
    }
    const tot = rep.totals.find((x) => x.gene === gene);
    if (tot) { mutated += tot.patients; pairs += tot.pairs; somaticSamples += tot.somaticSamples; }
    // a site with no total for the gene has none of its mutations; one whose total lacks the count is on older code
    if (tot) germlineSamples = germlineSamples === undefined || tot.germlineSamples === undefined ? undefined : germlineSamples + tot.germlineSamples;
    else if (rep.germlineCohortSamples === undefined) germlineSamples = undefined;
  }
  const observedMax = Math.max(0, ...[...changes.values()].map((c) => c.pos ?? 0));
  const proteinLength = protein?.proteinLength || observedMax || 10;
  const drawable = (pos: number | null): pos is number => pos != null && Number.isFinite(pos) && pos >= 0 && pos <= proteinLength + 1;

  const byPos = new Map<number, { change: string; n: number; rows: number; impact?: string; driver: boolean }[]>();
  let returned = 0, unpositioned = 0;
  for (const c of changes.values()) {
    returned += c.n;
    if (!drawable(c.pos)) { unpositioned += c.n; continue; }
    (byPos.get(c.pos) ?? byPos.set(c.pos, []).get(c.pos)!).push({ change: c.change, n: c.n, rows: c.rows, driver: c.driver, ...(c.impact ? { impact: c.impact } : {}) });
  }
  const positions: LollipopPosition[] = [...byPos.entries()].map(([pos, cs]) => {
    const here = [...types.values()].filter((t) => t.pos === pos).map((t) => ({ mtype: t.mtype, driver: t.driver, rows: t.rows }));
    const col = lollipopColor(here);
    return { pos, n: cs.reduce((a, c) => a + c.n, 0), color: col.color, impact: col.impact, driver: col.driver,
      changes: cs.sort((a, b) => b.rows - a.rows || (a.change < b.change ? -1 : 1)), types: here };
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
  // ties broken by codon then change, so which tied change makes the ten never follows row order
  const topChanges = [...changes.values()].sort((a, b) => b.n - a.n || (a.pos ?? Infinity) - (b.pos ?? Infinity) || (a.change < b.change ? -1 : a.change > b.change ? 1 : 0)).slice(0, 10)
    .map((c) => ({ change: c.change, pos: c.pos, n: c.n, pct: mutated ? Math.round((1000 * c.n) / mutated) / 10 : 0 }));
  return {
    gene, mutated, mutations: pairs, positions, domains, topChanges,
    proteinLength, lengthSource: protein ? "genome-nexus" : "observed", transcript: protein?.transcriptId || undefined,
    // no codon (or one past the protein), and below the suppression floor — never merged, since
    // one is about the data and the other about what a site chose not to disclose
    unpositioned, withheld: Math.max(0, pairs - returned),
    ...(at ? { label: { pos: at.pos, text: lollipopLabelText(at.changes) } } : {}),
    somaticSamples, cohortSamples, ...(cohortPatients != null ? { cohortPatients } : {}), tally, ...(germlineSamples !== undefined && germlineCohortSamples !== undefined ? { germlineSamples, germlineCohortSamples } : {}), ...(protein?.ids ? { ids: protein.ids } : {})
  };
}

/** the mutation table's filters that are the lollipop's own selection — its grid's cells and its stems — and so never narrow it */
export const LOLLIPOP_OWN_FILTERS: ReadonlySet<string> = new Set(["alteration", "proteinPos"]);
/**
 * The part of the mutation table's query that narrows the lollipop and badges (the portal's filtered
 * data): its search and its column filters other than LOLLIPOP_OWN_FILTERS; null when nothing does.
 */
export function lollipopNarrowing<Q extends TableQuery>(q: Q): Q | null {
  const filters = Object.fromEntries(Object.entries(q.filters || {}).filter(([id]) => !LOLLIPOP_OWN_FILTERS.has(id)));
  const search = (q.search || "").trim();
  if (!search && !Object.keys(filters).length) return null;
  const out = { ...q } as Q;
  delete out.filters; delete out.search; delete out.sort;
  return { ...out, ...(search ? { search } : {}), ...(Object.keys(filters).length ? { filters } : {}) };
}

/** the Somatic / Germline badges beside a gene's mutation frequencies: which statuses the tab keeps (MUT-HD-3, MUT-FM-2) */
export interface StatusSelection { somatic: boolean; germline: boolean }

/** the mutation table's column the badges filter: the call's mutation status */
export const STATUS_COLUMN = "status";

/**
 * The badges' selection read from the table's filter on the status column: none is both, an `equals`
 * on one status is that one alone, an empty value list is neither. A filter set some other way (the
 * column's own menu) reads as both, since the badges then filter nothing of their own.
 */
export function statusSelection(f: ColumnFilter | undefined): StatusSelection {
  if (f && "op" in f && f.op === "equals") {
    const v = f.value.toLowerCase();
    if (v === "somatic" || v === "germline") return { somatic: v === "somatic", germline: v === "germline" };
  }
  if (f && "values" in f && Array.isArray(f.values) && f.values.length === 0) return { somatic: false, germline: false };
  return { somatic: true, germline: true };
}

/**
 * The filter for a selection, as the portal's mutation status filter keeps rows (react-mutation-mapper
 * onFilterOptionSelect, FilterUtils): both selected is no filter; one keeps the rows whose status,
 * lower-cased, is that one (a blank status is neither); none keeps no row.
 */
export function statusFilter(sel: StatusSelection): ColumnFilter | undefined {
  if (sel.somatic && sel.germline) return undefined;
  if (sel.somatic || sel.germline) return { op: "equals", value: sel.somatic ? "somatic" : "germline" };
  return { values: [] };
}

/** the lollipop's `table` with its status filter set to `f` (removed when undefined); undefined when nothing is left of it */
export function withStatusFilter<T extends Pick<TableQuery, "search" | "filters" | "columns"> & { gene: string }>(table: T | undefined, gene: string, f: ColumnFilter | undefined): T | undefined {
  const base = table && table.gene === gene ? table : ({ gene } as T);
  const filters: Record<string, ColumnFilter> = { ...(base.filters || {}) };
  if (f) filters[STATUS_COLUMN] = f; else delete filters[STATUS_COLUMN];
  const next = { ...base } as T;
  if (Object.keys(filters).length) next.filters = filters; else delete next.filters;
  return next.search || next.filters ? next : undefined;
}

/** the portal shows a germline rate, and with it the Somatic / Germline badges, only when some sample has a germline mutation (MutationRateSummary) */
export function hasGermlineRate(g: Pick<HotspotGene, "germlineSamples" | "germlineCohortSamples">): boolean {
  return (g.germlineSamples ?? 0) > 0 && (g.germlineCohortSamples ?? 0) > 0;
}

/** the lollipop's table query, kept only while the view still draws its gene (a gene removed takes its search and filters, the badges' included, with it) */
export function pruneLollipopTable<T extends { gene: string }>(table: T | undefined, genes: string[]): T | undefined {
  return table && genes.includes(table.gene) ? table : undefined;
}
