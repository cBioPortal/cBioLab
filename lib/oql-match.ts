// One alteration against one OQL line, as cBioPortal's Results view decides which data a gene's
// row draws (oqlfilter.ts isDatumWantedByOQLLine and its commands), and the line written back as
// the row's sublabel (parsedOQLAlterationToSourceOQL). Pure and browser-safe; lib/oql.ts compiles
// the same rules to SQL for the cohorts, from the same class table.
import { parseOql, type OqlSpec, type OqlRange } from "./oql-parse.ts";

/**
 * A mutation's class as cBioPortal's OQL sees it — cbioportal-frontend's getMutationSubType and
 * getSimplifiedMutationType (src/shared/lib/oql/AccessorsForOqlFilter.ts), case for case: a
 * protein change of "Promoter" is a promoter mutation whatever its type, a listed type maps to
 * its class, and anything unlisted (5'Flank, Silent, Targeted_Region, ...) is "other". The
 * portal's Fusion has no class; "none" stands for it.
 */
export const PORTAL_TYPE_CLASS: [string, string[]][] = [
  ["missense", ["missense_mutation", "missense", "missense_variant"]],
  ["frameshift", ["frame_shift_ins", "frame_shift_del", "frameshift", "frameshift_deletion", "frameshift_insertion",
    "de_novo_start_outofframe", "frameshift_variant"]],
  ["nonsense", ["nonsense_mutation", "nonsense", "stopgain_snv"]],
  ["splice", ["splice_site", "splice", "splice site", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel",
    "splice_region"]],
  ["nonstart", ["translation_start_site", "start_codon_snp", "start_codon_del"]],
  ["nonstop", ["nonstop_mutation"]],
  ["inframe", ["in_frame_del", "in_frame_ins", "in_frame_deletion", "in_frame_insertion", "indel", "nonframeshift_deletion",
    "nonframeshift", "nonframeshift insertion", "nonframeshift_insertion"]],
];
const CLASS_OF = new Map<string, string>(PORTAL_TYPE_CLASS.flatMap(([cls, types]) => types.map((t) => [t, cls] as [string, string])));

/** a mutation's portal class from its type and protein change */
export function mutationClass(type: string | null | undefined, change: string | null | undefined): string {
  const t = (type || "").toLowerCase();
  if (t === "fusion") return "none";
  if ((change || "").toLowerCase() === "promoter") return "promoter";
  return CLASS_OF.get(t) || "other";
}

/** what an alteration is to OQL: its kind, and for a mutation its type, change and own protein positions */
export interface OqlEvent {
  vt: string; mt?: string | null; mv?: string | null; cna?: string | number | null;
  ps?: number | null; pe?: number | null;
  /** an expression datum's level: vt "exp" (mRNA) or "prot" (protein), one sample's value */
  z?: number | null;
}

/** an EXP / PROT command against a level: "high" or "low" when it is met, null otherwise (oqlfilter 1005-1060) */
function levelOf(s: OqlSpec, ev: OqlEvent): "high" | "low" | null {
  if (ev.vt !== (s.type === "EXP" ? "exp" : "prot") || ev.z == null || !Number.isFinite(ev.z)) return null;
  const z = ev.z, t = s.z!;
  if ((s.op === "<" && z < t) || (s.op === "<=" && z <= t)) return "low";
  if ((s.op === ">" && z > t) || (s.op === ">=" && z >= t)) return "high";
  return null;
}
const isLevel = (ev: OqlEvent): boolean => ev.vt === "exp" || ev.vt === "prot";

/** the portal's RANGE test against the mutation's own [start, end]: a position only when both are known, neither -1, start <= end */
function inRange(r: OqlRange, ps: number | null | undefined, pe: number | null | undefined): boolean {
  if (ps == null || pe == null || ps === -1 || pe === -1 || ps > pe) return false;
  const lo = r.start ?? -Infinity, hi = r.end ?? Infinity;
  return r.contained ? lo <= ps && pe <= hi : lo <= pe && ps <= hi;
}

function specWants(s: OqlSpec, ev: OqlEvent, driver: boolean): boolean {
  if (s.type === "EXP" || s.type === "PROT") return levelOf(s, ev) !== null;
  // an expression level is wanted by an EXP / PROT command alone
  if (isLevel(ev)) return false;
  if (s.driver && !driver) return false;
  switch (s.type) {
    case "ANY": return true;
    case "MUT": {
      if (ev.vt !== "mutation") return false;
      const cls = mutationClass(ev.mt, ev.mv);
      if (cls === "none") return false;
      if (s.cls && (s.cls === "trunc" ? cls === "missense" || cls === "inframe" : cls !== s.cls)) return false;
      if (s.pchange && (!ev.mv || ev.mv.toLowerCase() !== s.pchange.toLowerCase())) return false;
      return !s.range || inRange(s.range, ev.ps, ev.pe);
    }
    case "CNA": {
      if (ev.vt !== "cna") return false;
      const v = Number(ev.cna);
      return s.cna === 2 ? v >= 2 : s.cna === -2 ? v <= -2 : Math.abs(v) >= 2;
    }
    case "SV": return ev.vt === "structural_variant";
    default: return false;
  }
}

/**
 * An expression datum's subtype under a line: every command that meets it sets it, so the last one
 * wins (oqlfilter 568-577, 1042-1044); null when none does.
 */
export function oqlLevel(specs: readonly OqlSpec[] | null | undefined, ev: OqlEvent): "high" | "low" | null {
  let level: "high" | "low" | null = null;
  for (const s of specs || []) if (s.type === "EXP" || s.type === "PROT") level = levelOf(s, ev) ?? level;
  return level;
}

/**
 * Does a row whose OQL line is `specs` draw this alteration? No line (or a bare gene's) draws
 * every one. Otherwise the alteration is drawn when some command of the line wants it — OR between
 * commands, AND within one (its class, change, range and DRIVER). `driver` is the alteration's
 * driver call under the page's driver settings, the portal's putativeDriver.
 */
export function eventWanted(specs: readonly OqlSpec[] | null | undefined, ev: OqlEvent, driver: boolean): boolean {
  if (!specs || !specs.length) return !isLevel(ev);
  return specs.some((s) => specWants(s, ev, driver));
}

/** a line with something to filter: not empty, and not a bare gene's "any alteration" */
export const hasOql = (specs: readonly OqlSpec[] | null | undefined): boolean =>
  !!specs && specs.some((s) => s.type !== "ANY" || !!s.driver);

const range = (r: OqlRange): string => "(" + (r.start ?? "") + "-" + (r.end ?? "") + (r.contained ? "*" : "") + ")";
/** one command as the portal writes it back */
export function specText(s: OqlSpec): string {
  const drv = s.driver ? "_DRIVER" : "";
  switch (s.type) {
    case "ANY": return s.driver ? "DRIVER" : "";
    case "MUT": {
      const head = s.pchange ? "MUT=" + s.pchange : s.cls ? "MUT=" + s.cls.toUpperCase() : "MUT";
      return head + (s.range ? "_" + range(s.range) : "") + drv;
    }
    case "CNA": return (s.cna === 2 ? "AMP" : s.cna === -2 ? "HOMDEL" : "CNA") + drv;
    case "SV": return "FUSION" + drv;
    default: return s.type + (s.op || "") + (s.z ?? "");
  }
}

/**
 * A query line's track name, as the portal names a Mutual Exclusivity track
 * (getSingleGeneResultKey): its gene for a bare line, else the line written back ("KRAS: AMP").
 */
export function oqlTrackName(line: string): string {
  const entries = parseOql(line);
  if (entries.length !== 1) throw new Error("'" + line.slice(0, 40) + "' names " + entries.length + " genes; give each its own line");
  return entries[0].gene + oqlSublabel(entries[0].specs);
}

/**
 * The line a row without OQL is drawn by, as its sublabel (": AMP HOMDEL MUT FUSION"): the
 * portal's buildDefaultOQLProfile (ResultsViewPageStore 333-363) over the selected profiles in
 * their order, each type's commands once, in the order its first profile comes. `profiles` are
 * the selected profiles in that order; `exp` / `prot` the z-score thresholds of the mRNA and
 * protein rules.
 */
export function defaultOqlSublabel(profiles: readonly { type: string }[], exp = 2, prot = 2): string {
  const COMMANDS: Record<string, string[]> = {
    MUTATION_EXTENDED: ["MUT"],
    COPY_NUMBER_ALTERATION: ["AMP", "HOMDEL"],
    MRNA_EXPRESSION: ["EXP>=" + exp, "EXP<=-" + exp],
    PROTEIN_LEVEL: ["PROT>=" + prot, "PROT<=-" + prot],
    STRUCTURAL_VARIANT: ["FUSION"],
  };
  const out: string[] = [];
  for (const p of profiles) for (const c of COMMANDS[p.type] || []) if (!out.includes(c)) out.push(c);
  return out.length ? ": " + out.join(" ") : "";
}

/** the row's sublabel: its line written back less the gene (": AMP MUT=G12D"), "" with no OQL */
export function oqlSublabel(specs: readonly OqlSpec[] | null | undefined): string {
  if (!hasOql(specs)) return "";
  const parts = specs!.map(specText).filter(Boolean);
  return parts.length ? ": " + parts.join(" ") : "";
}

/**
 * Does the query narrow mutations? cBioPortal's doesQueryContainMutationOQL (oqlfilter.ts
 * 260-290): a MUT command with a class, change or range, or with DRIVER; or a standalone DRIVER.
 * A bare gene, a plain MUT, AMP / HOMDEL / FUSION (even with _DRIVER) and EXP / PROT do not.
 */
export function oqlHasMutationOql(lines: string[]): boolean {
  return lines.some((l) => parseOql(l).some((e) => e.specs.some((x) =>
    (x.type === "MUT" && !!(x.cls || x.pchange || x.range || x.driver)) || (x.type === "ANY" && !!x.driver))));
}
