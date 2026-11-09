// The query page's controls beside the gene query — cBioPortal's "Select Genomic Profiles" and
// "Select Patient/Case Set" (cbioportal-frontend src/shared/components/query: QueryStore,
// MolecularProfileSelector, DataTypePrioritySelector, CaseSetSelector, CaseSetSelectorUtils) —
// as a Results link carries them and as the page's document asks for them. Pure and browser-safe:
// the query dialog offers the choices, the Results page turns them into cohort clauses, and the
// rules are the portal's, each named where it is ported.
import type { Clause } from "./types.ts";
import type { ProfileInfo } from "./profile-catalog.ts";
import { parseOql, type OqlSpecType } from "./oql-parse.ts";

/** the profile kinds the portal's selector lists, in its order, with its group labels */
export const PROFILE_KINDS = [
  { key: "mut", type: "MUTATION_EXTENDED", label: "Mutation" },
  { key: "sv", type: "STRUCTURAL_VARIANT", label: "Structural Variant" },
  { key: "cna", type: "COPY_NUMBER_ALTERATION", label: "Copy Number" },
  { key: "mrna", type: "MRNA_EXPRESSION", label: "mRNA Expression" },
  { key: "meth", type: "METHYLATION", label: "DNA Methylation" },
  { key: "prot", type: "PROTEIN_LEVEL", label: "Protein/phosphoprotein level" },
] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number]["key"];

/** a Results link's value for "each queried study's profile of this kind" (several studies) */
export const EVERY_STUDY = "*";
/** the portal's "User-defined Case List" (CUSTOM_CASE_LIST_ID) */
export const CUSTOM_CASE_SET = "-1";

/** The multi-study case sets the portal offers (CaseSetSelectorUtils CustomCaseSets), with the sample-list category each resolves to. */
export const MULTI_CASE_SETS = [
  { id: "all", name: "All", description: "All cases in the selected cohorts", category: null },
  { id: "w_mut", name: "Cases with mutations data", description: "All cases with mutations data", category: "all_cases_with_mutation_data" },
  { id: "w_cna", name: "Cases with copy number alterations data", description: "All cases with copy number alterations data", category: "all_cases_with_cna_data" },
  { id: "w_mut_cna", name: "Cases with both mutations and copy number alterations data", description: "All cases with both mutations and copy number alterations data",
    category: "all_cases_with_mutation_and_cna_data" },
] as const;
export const CUSTOM_CASE_SET_OPTION = { id: CUSTOM_CASE_SET, name: "User-defined Case List", description: "Specify your own case list" };

/** What a query asks for besides its genes, as a Results link carries it. */
export interface QueryOptions {
  /**
   * the chosen profile of each kind: its id without the study prefix (one study), or EVERY_STUDY
   * (several studies: each one's profile of that kind). A kind left out is not chosen.
   */
  profiles: Partial<Record<ProfileKind, string>>;
  /** the mRNA and protein z-score thresholds, as typed (the portal keeps them as text, default "2.0") */
  z: string;
  rppaZ: string;
  /** a sample list's id (one study), one of MULTI_CASE_SETS (several), or CUSTOM_CASE_SET */
  caseSet: string;
  /** with CUSTOM_CASE_SET: the ids, saved as a stored id set; `n` how many cases it holds */
  cases?: { set: string; level: "sample" | "patient"; n?: number };
}

export const DEFAULT_Z = "2.0";

/** one study's sample list, as the query options API describes it */
export interface CaseSetInfo { id: string; study: string; name: string; description: string; category: string; samples: number }

/** what the query options API says of the queried studies */
export interface QueryOptionsData {
  /** each study's profiles (the catalog's description and show-in-analysis flag included) */
  profiles: ProfileInfo[];
  /** each study's sample lists */
  caseSets: CaseSetInfo[];
}

// ---- profiles --------------------------------------------------------------------------------

const kindOf = (type: string) => PROFILE_KINDS.find((k) => k.type === type);

/**
 * The profiles the selector offers, by kind: those the study shows in its analysis tab
 * (getFilteredProfiles), one per id (several studies' share a group, as the portal's groupBy on the
 * id without its study does), in the portal's order: its API's, by id.
 */
export function selectableProfiles(catalog: ProfileInfo[]): { kind: (typeof PROFILE_KINDS)[number]; profiles: ProfileInfo[] }[] {
  const shown = catalog.filter((p) => p.analysis !== false && kindOf(p.type));
  return PROFILE_KINDS.map((kind) => {
    const seen = new Map<string, ProfileInfo>();
    for (const p of shown.filter((p) => p.type === kind.type).sort((a, b) => a.order - b.order || (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0))) if (!seen.has(p.profile)) seen.set(p.profile, p);
    return { kind, profiles: [...seen.values()] };
  }).filter((g) => g.profiles.length);
}

/**
 * The selection the portal starts from: the first mutation, structural-variant and copy-number
 * profile (selectedProfileIdSet's defaults), or, when a study has none of those, its first
 * selectable profile (getFallbackSelectableProfileSuffix). Several studies: each kind any of them holds.
 */
export function defaultProfiles(catalog: ProfileInfo[], studies: number): QueryOptions["profiles"] {
  const groups = selectableProfiles(catalog);
  const out: QueryOptions["profiles"] = {};
  for (const g of groups) if (g.kind.key === "mut" || g.kind.key === "sv" || g.kind.key === "cna") out[g.kind.key] = studies > 1 ? EVERY_STUDY : g.profiles[0].profile;
  // several studies offer no mRNA or protein choice (resolveQuery), so none is a fallback there
  if (!Object.keys(out).length && groups.length && studies === 1) out[groups[0].kind.key] = groups[0].profiles[0].profile;
  return out;
}

/** a fresh set of options: the portal's default profiles and thresholds; `caseSet` as given */
export function defaultOptions(catalog: ProfileInfo[], studies: number, caseSet: string): QueryOptions {
  return { profiles: defaultProfiles(catalog, studies), z: DEFAULT_Z, rppaZ: DEFAULT_Z, caseSet };
}

const SPEC_KIND: Record<OqlSpecType, ProfileKind[]> = { MUT: ["mut"], SV: ["sv"], CNA: ["cna"], EXP: ["mrna"], PROT: ["prot"], ANY: [] };

/** the kinds a query's OQL names alterations of (getAlterationTypesInOql), bare genes aside */
export function kindsInQuery(entries: string[]): Set<ProfileKind> {
  const out = new Set<ProfileKind>();
  for (const entry of entries) {
    let parsed;
    try { parsed = parseOql(entry); } catch { continue; }
    for (const e of parsed) for (const s of e.specs) for (const k of SPEC_KIND[s.type]) out.add(k);
  }
  return out;
}

/**
 * The kinds that decide a bare gene's alterations, as the portal arrives at them: the chosen ones;
 * for one study, also every kind the query names explicitly (currentQueryParams adds that kind's
 * default profile to the link), and structural variants whenever mutations are chosen (the Results
 * page's selectedMolecularProfiles adds the study's structural-variant profile to a mutation one).
 * `held` is the kinds the studies have a profile of.
 */
export function effectiveKinds(o: QueryOptions, entries: string[], studies: number, held: Set<ProfileKind>): Set<ProfileKind> {
  const out = new Set((Object.keys(o.profiles) as ProfileKind[]).filter((k) => o.profiles[k]));
  if (studies === 1) {
    for (const k of kindsInQuery(entries)) if (held.has(k)) out.add(k);
    if (out.has("mut") && held.has("sv")) out.add("sv");
  }
  return out;
}

/**
 * The alterations a bare gene stands for (buildDefaultOQLProfile): MUT for mutations, FUSION for
 * structural variants, AMP HOMDEL for copy number, EXP>=z EXP<=-z for mRNA, PROT>=z PROT<=-z for
 * protein; DNA methylation adds none. In the portal's order of profile kinds.
 */
export function defaultOql(kinds: Set<ProfileKind>, z: number, rppaZ: number): string {
  const parts: string[] = [];
  if (kinds.has("mut")) parts.push("MUT");
  if (kinds.has("sv")) parts.push("FUSION");
  if (kinds.has("cna")) parts.push("AMP", "HOMDEL");
  if (kinds.has("mrna")) parts.push("EXP>=" + z, "EXP<=-" + z);
  if (kinds.has("prot")) parts.push("PROT>=" + rppaZ, "PROT<=-" + rppaZ);
  return parts.join(" ");
}

/** a z-score threshold as typed, read as the portal reads it into its OQL; null when it is not a number at or above 0 */
export function readThreshold(text: string): number | null {
  const t = String(text ?? "").trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** what the options make of the query: the entries as the document asks for them, the EXP / PROT profiles, and anything that stops them */
export interface ResolvedQuery {
  /** each entry with a bare gene given the default alterations (unchanged when the defaults are "any alteration") */
  entries: string[];
  /** the profiles EXP and PROT read (one study), for the oql clause's exp / prot */
  exp?: string;
  prot?: string;
  /** why the options cannot be used, in the portal's words where it has them */
  error?: string;
}

/**
 * The query the options ask for. A bare gene's default is "any alteration" (the engine's ANY:
 * mutations, structural variants, high-level copy number) when the effective kinds are every one
 * of those the studies hold and nothing else; otherwise the entry is written out with
 * defaultOql's alterations. The mRNA and protein choices are one study's (the portal offers them
 * only for one); several studies' are refused.
 */
export function resolveQuery(o: QueryOptions | null, entries: string[], studies: number, held: Set<ProfileKind>): ResolvedQuery {
  if (!o) return { entries };
  const chosen = (Object.keys(o.profiles) as ProfileKind[]).filter((k) => o.profiles[k]);
  // a link that names no profile asks for the defaults: any alteration (the dialog itself refuses an empty choice)
  if (!chosen.length) return { entries };
  const several = chosen.filter((k) => o.profiles[k] === EVERY_STUDY);
  if (studies === 1 && several.length) return { entries, error: "a profile choice of \"each study's\" is for several studies; this query has one" };
  if (studies > 1) {
    const one = chosen.filter((k) => o.profiles[k] !== EVERY_STUDY);
    if (one.length) return { entries, error: "a query across several studies chooses data types, not one study's profiles (" + one.map((k) => o.profiles[k]).join(", ") + ")" };
    const bad = chosen.filter((k) => k === "mrna" || k === "prot");
    if (bad.length) return { entries, error: "a query across several studies does not filter by " + bad.map(kindLabel).join(" or ") + " (cBioPortal refuses EXP and PROT across studies too)" };
  }
  const z = readThreshold(o.z), rppaZ = readThreshold(o.rppaZ);
  if (o.profiles.mrna && z == null) return { entries, error: "the mRNA z-score threshold must be a number of 0 or more; it is \"" + o.z + "\"" };
  if (o.profiles.prot && rppaZ == null) return { entries, error: "the protein z-score threshold must be a number of 0 or more; it is \"" + o.rppaZ + "\"" };
  const kinds = effectiveKinds(o, entries, studies, held);
  const any = ["mut", "sv", "cna"].filter((k) => held.has(k as ProfileKind));
  const isAny = [...kinds].every((k) => k === "mut" || k === "sv" || k === "cna" || k === "meth") && any.every((k) => kinds.has(k as ProfileKind));
  const out: ResolvedQuery = { entries, ...(o.profiles.mrna && studies === 1 ? { exp: o.profiles.mrna } : {}), ...(o.profiles.prot && studies === 1 ? { prot: o.profiles.prot } : {}) };
  if (isAny) return out;
  const def = defaultOql(kinds, z ?? 2, rppaZ ?? 2);
  const bare = entries.filter(isBare);
  if (!def && bare.length) return { entries, error: "the selected profiles (" + chosen.map(kindLabel).join(", ") + ") give " + bare.join(", ") + " no alterations to look for; choose mutation, structural variant, copy number, mRNA or protein, or write the alterations into the query" };
  return { ...out, entries: entries.map((e) => (isBare(e) ? e.replace(/:\s*$/, "").trim() + ": " + def : e)) };
}

/** an entry that names a gene and no alterations ("TP53", or "TP53:"), which the defaults fill */
const isBare = (e: string) => !/:\s*\S/.test(e);

/** a kind's name in a sentence */
export const kindLabel = (k: ProfileKind): string => ({ mut: "mutations", sv: "structural variants", cna: "copy number", mrna: "mRNA expression", meth: "DNA methylation", prot: "protein level" })[k];

/** the kinds the studies hold a selectable profile of */
export function heldKinds(catalog: ProfileInfo[]): Set<ProfileKind> {
  return new Set(selectableProfiles(catalog).map((g) => g.kind.key));
}

// ---- case sets -------------------------------------------------------------------------------

/**
 * The case set the portal starts from for one study and a profile selection
 * (defaultSelectedSampleListId): mutation and copy number → _cnaseq (or _cna_seq), mutation alone
 * → _sequenced, copy number alone → _cna, one mRNA profile alone → its list (_mrna, _rna_seq_mrna,
 * _rna_seq_v2_mrna), mutation or copy number with mRNA → _3way_complete (or _complete), protein
 * alone → _rppa; anything else, or a list the study lacks, → _all.
 */
export function defaultCaseSet(study: string, profiles: QueryOptions["profiles"], lists: CaseSetInfo[]): string {
  const has = (id: string) => lists.some((l) => l.id === id);
  const { mut, cna, mrna, prot } = profiles;
  let id = study + "_all";
  if (mut && cna && !mrna && !prot) id = study + "_cnaseq";
  else if (mut && !cna && !mrna && !prot) id = study + "_sequenced";
  else if (!mut && cna && !mrna && !prot) id = study + "_cna";
  else if (!mut && !cna && mrna && !prot) {
    if (mrna === "mrna_median_Zscores") id = study + "_mrna";
    else if (mrna === "rna_seq_mrna_median_Zscores") id = study + "_rna_seq_mrna";
    else if (mrna === "rna_seq_v2_mrna_median_Zscores") id = study + "_rna_seq_v2_mrna";
  } else if ((mut || cna) && mrna && !prot) id = study + "_3way_complete";
  else if (!mut && !cna && !mrna && prot) id = study + "_rppa";
  if (!has(id)) {
    if (id === study + "_cnaseq") id = study + "_cna_seq";
    else if (id === study + "_3way_complete") id = study + "_complete";
  }
  return has(id) ? id : study + "_all";
}

/**
 * The case sets offered: one study's lists by name (the portal sorts them so), then "User-defined
 * Case List"; several studies' MULTI_CASE_SETS that hold any sample, each with its count
 * (getFilteredCustomCaseSets), then "User-defined Case List".
 */
export function caseSetOptions(studies: string[], lists: CaseSetInfo[]): { id: string; label: string; name: string; description: string }[] {
  if (studies.length === 1) {
    const own = lists.filter((l) => l.study === studies[0]).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return [...own.map((l) => ({ id: l.id, label: l.name + " (" + l.samples + ")", name: l.name, description: l.description })),
      { id: CUSTOM_CASE_SET, label: CUSTOM_CASE_SET_OPTION.name, name: CUSTOM_CASE_SET_OPTION.name, description: CUSTOM_CASE_SET_OPTION.description }];
  }
  const out = [];
  for (const c of MULTI_CASE_SETS) {
    const n = multiCaseSetCount(c.id, studies, lists);
    if (n > 0) out.push({ id: c.id, label: c.name + " (" + n + ")", name: c.name, description: c.description });
  }
  return [...out, { id: CUSTOM_CASE_SET, label: CUSTOM_CASE_SET_OPTION.name, name: CUSTOM_CASE_SET_OPTION.name, description: CUSTOM_CASE_SET_OPTION.description }];
}

/** a study's list of a category: the first by id, as the engine's caseList category clause takes it */
function listOfCategory(study: string, category: string | null, lists: CaseSetInfo[]): CaseSetInfo | undefined {
  const own = lists.filter((l) => l.study === study).sort((a, b) => (a.id < b.id ? -1 : 1));
  return category ? own.find((l) => l.category === category) : own.find((l) => l.id === study + "_all") || own.find((l) => l.category === "all_cases_in_study");
}

/** the samples a multi-study case set holds: each study's list of its category, added (categorizedSamplesCount) */
export function multiCaseSetCount(id: string, studies: string[], lists: CaseSetInfo[]): number {
  const c = MULTI_CASE_SETS.find((x) => x.id === id);
  if (!c) return 0;
  return studies.reduce((n, s) => n + (listOfCategory(s, c.category, lists)?.samples || 0), 0);
}

/** the studies a multi-study case set leaves out entirely, having no list of its category */
export function studiesWithoutCaseSet(id: string, studies: string[], lists: CaseSetInfo[]): string[] {
  const c = MULTI_CASE_SETS.find((x) => x.id === id);
  if (!c || !c.category) return [];
  return studies.filter((s) => !listOfCategory(s, c.category, lists));
}

/** the clause a case set adds to every cohort of the page, or none ("All", or one study's whole list) */
export function caseSetClause(o: QueryOptions | null, studies: string[]): Clause | null {
  if (!o) return null;
  if (o.caseSet === CUSTOM_CASE_SET) {
    if (!o.cases) return null;
    return { kind: o.cases.level === "patient" ? "patientList" : "sampleList", set: o.cases.set, label: "User-defined Case List", ...(o.cases.n != null ? { n: o.cases.n } : {}) } as Clause;
  }
  if (studies.length > 1) {
    const c = MULTI_CASE_SETS.find((x) => x.id === o.caseSet);
    return c?.category ? ({ kind: "caseList", category: c.category } as Clause) : null;
  }
  if (o.caseSet === studies[0] + "_all") return null;
  return { kind: "caseList", id: o.caseSet } as Clause;
}

/** why the profile choice cannot be submitted (the portal's submitError), or null */
export function profilesProblem(o: QueryOptions): string | null {
  return Object.values(o.profiles).some(Boolean) ? null : "Please select one or more molecular profiles.";
}

/**
 * Why the choice asks for what cBioLab cannot honour yet, or null: a z-score threshold that is not
 * a number, or one of several mutation, structural-variant or copy-number profiles of one study —
 * the engine reads every such profile's calls together (gbm_tcga_pub's two copy-number profiles),
 * where the portal reads the chosen one alone.
 */
export function optionsProblem(o: QueryOptions, catalog: ProfileInfo[], studies: number): string | null {
  if (o.profiles.mrna && readThreshold(o.z) == null) return "the mRNA z-score threshold must be a number of 0 or more; it is \"" + o.z + "\"";
  if (o.profiles.prot && readThreshold(o.rppaZ) == null) return "the protein z-score threshold must be a number of 0 or more; it is \"" + o.rppaZ + "\"";
  if (studies !== 1) return null;
  for (const g of selectableProfiles(catalog)) {
    if (g.profiles.length < 2 || !o.profiles[g.kind.key] || !(["mut", "sv", "cna"] as ProfileKind[]).includes(g.kind.key)) continue;
    return "this study has " + g.profiles.length + " " + kindLabel(g.kind.key) + " profiles (" + g.profiles.map((p) => p.name).join("; ") + "), and cBioLab reads the calls of all of them together: it cannot query one alone yet. Untick " + g.kind.label + ", or write its alterations into the query knowing both profiles' calls count";
  }
  return null;
}

/** why a case set cannot be used, or null when it can */
export function caseSetProblem(o: QueryOptions | null, studies: string[]): string | null {
  if (!o) return null;
  if (o.caseSet === CUSTOM_CASE_SET) return o.cases ? null : "Please enter at least one ID in your custom case set.";
  if (studies.length > 1) return MULTI_CASE_SETS.some((x) => x.id === o.caseSet) ? null : "a query across several studies takes one of " + MULTI_CASE_SETS.map((c) => c.id).join(", ") + " or a user-defined case list, not " + o.caseSet;
  return o.caseSet.startsWith(studies[0] + "_") ? null : "case set " + o.caseSet + " is not one of " + studies[0] + "'s";
}

/**
 * The ids typed into "User-defined Case List", read as the portal reads them (invokeCustomCaseSetLater):
 * split on white space; "study:id", whose study must be selected, or a bare id when one study is.
 * Returns each as "study:id", or the portal's error for the first that cannot be read.
 */
export function parseCaseIds(text: string, studies: string[], level: "sample" | "patient"): { ids: string[] } | { error: string } {
  const tokens = String(text || "").trim().split(/\s+/g).filter(Boolean);
  const ids: string[] = [];
  for (const t of tokens) {
    const parts = t.split(":");
    if (parts.length === 1) {
      if (studies.length !== 1) return { error: "No study specified for " + level + " id: " + t + ", and more than one study selected for query." };
      ids.push(studies[0] + ":" + t);
    } else if (parts.length === 2) {
      if (!studies.includes(parts[0])) return { error: "Study " + parts[0] + " is not selected." };
      ids.push(parts[0] + ":" + parts[1]);
    } else return { error: "Input error for entity: " + t + "." };
  }
  return { ids: [...new Set(ids)] };
}

// ---- the link --------------------------------------------------------------------------------

const ID = /^[A-Za-z0-9._-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the options as a Results link's parameters: one per chosen profile kind, z, rppa_z, case_set, and cases / case_level / cases_n for a user-defined list */
export function writeOptions(p: URLSearchParams, o: QueryOptions | null | undefined): void {
  if (!o) return;
  for (const k of PROFILE_KINDS) if (o.profiles[k.key]) p.set(k.key, o.profiles[k.key]!);
  if (o.profiles.mrna) p.set("z", o.z);
  if (o.profiles.prot) p.set("rppa_z", o.rppaZ);
  p.set("case_set", o.caseSet);
  if (o.caseSet === CUSTOM_CASE_SET && o.cases) {
    p.set("cases", o.cases.set);
    p.set("case_level", o.cases.level);
    if (o.cases.n != null) p.set("cases_n", String(o.cases.n));
  }
}

/** a Results link's options read back: null when it carries none (a link from before the query page had them); `error` names what cannot be read */
export function readOptions(q: URLSearchParams): { options: QueryOptions | null; error?: string } {
  const caseSet = q.get("case_set");
  const kinds = PROFILE_KINDS.filter((k) => q.has(k.key));
  if (!caseSet && !kinds.length) return { options: null };
  const bad = kinds.filter((k) => { const v = q.get(k.key)!; return v !== EVERY_STUDY && !ID.test(v); });
  if (bad.length) return { options: null, error: "not a profile id: " + bad.map((k) => q.get(k.key)).join(", ") };
  if (caseSet != null && caseSet !== CUSTOM_CASE_SET && !ID.test(caseSet)) return { options: null, error: "not a case set id: " + caseSet };
  const o: QueryOptions = {
    profiles: Object.fromEntries(kinds.map((k) => [k.key, q.get(k.key)!])),
    z: q.get("z") ?? DEFAULT_Z, rppaZ: q.get("rppa_z") ?? DEFAULT_Z,
    caseSet: caseSet ?? "",
  };
  if (caseSet === CUSTOM_CASE_SET) {
    const set = q.get("cases") || "";
    if (!UUID.test(set)) return { options: null, error: "a user-defined case list's link names its stored id set in cases=; this one does not" };
    const n = Number(q.get("cases_n"));
    o.cases = { set, level: q.get("case_level") === "patient" ? "patient" : "sample", ...(Number.isInteger(n) && n >= 0 && q.has("cases_n") ? { n } : {}) };
  }
  return { options: o };
}

/** the options with a link's missing pieces filled from the studies: the default profiles when none are named, the case set when none is */
export function completeOptions(o: QueryOptions, catalog: ProfileInfo[], studies: string[]): QueryOptions {
  const named = Object.values(o.profiles).some(Boolean);
  return {
    ...o,
    profiles: named ? o.profiles : defaultProfiles(catalog, studies.length),
    caseSet: o.caseSet || (studies.length === 1 ? studies[0] + "_all" : "all"),
  };
}

// ---- the Results page ------------------------------------------------------------------------

/** what a Results page makes of its link's options: the query its groups ask for, the clause they keep, and the header's words */
export interface ChosenQuery {
  /** the studies' profiles and case sets are still being read */
  waiting: boolean;
  error?: string;
  entries: string[];
  exp?: string;
  prot?: string;
  /** the case set as a clause every group keeps, or null */
  clause: Clause | null;
  /** the header's case set and profiles, in words */
  summary: { caseSet: string; profiles: string } | null;
  /** said under the header: what the choice leaves out */
  notes: string[];
}

/** a link's options read against what the studies hold (the query options API's answer); null options: the query as typed, every case */
export function chosenQuery(o: QueryOptions | null, data: (QueryOptionsData & { unavailable?: { study: string; why: string }[] }) | null, studies: string[], typed: string[]): ChosenQuery {
  const none: ChosenQuery = { waiting: false, entries: typed, clause: null, summary: null, notes: [] };
  if (!o) return none;
  if (!data) return { ...none, waiting: true };
  const full = completeOptions(o, data.profiles, studies);
  const problem = caseSetProblem(full, studies) || optionsProblem(full, data.profiles, studies.length);
  if (problem) return { ...none, error: problem };
  const r = resolveQuery(full, typed, studies.length, heldKinds(data.profiles));
  if (r.error) return { ...none, error: r.error };
  const groups = selectableProfiles(data.profiles);
  const named = PROFILE_KINDS.filter((k) => full.profiles[k.key]).map((k) => {
    const v = full.profiles[k.key]!;
    const p = groups.find((g) => g.kind.key === k.key)?.profiles.find((x) => x.profile === v);
    const name = v === EVERY_STUDY ? k.label : p?.name || v;
    return name + (k.key === "mrna" ? " (z-score threshold ±" + full.z + ")" : k.key === "prot" ? " (z-score threshold ±" + full.rppaZ + ")" : "");
  });
  const option = caseSetOptions(studies, data.caseSets).find((c) => c.id === full.caseSet);
  const caseSet = full.caseSet === CUSTOM_CASE_SET
    ? "User-defined Case List" + (full.cases?.n != null ? " (" + full.cases.n + " " + (full.cases.level === "patient" ? "patient" : "sample") + (full.cases.n === 1 ? "" : "s") + ")" : "")
    : option ? option.label : full.caseSet;
  const without = studies.length > 1 ? studiesWithoutCaseSet(full.caseSet, studies, data.caseSets) : [];
  return {
    waiting: false, entries: r.entries, exp: r.exp, prot: r.prot,
    clause: caseSetClause(full, studies),
    summary: { caseSet, profiles: named.join(", ") },
    notes: [
      without.length ? "The case set leaves out " + without.join(", ") + ", which " + (without.length === 1 ? "has" : "have") + " no sample list of its kind." : null,
      r.entries.some((e, i) => e !== typed[i]) ? "With these profiles a gene without alterations of its own stands for " + r.entries.find((e, i) => e !== typed[i])!.split(":")[1].trim() + "." : null,
      ...(data.unavailable || []).map((u) => u.why),
    ].filter(Boolean) as string[],
  };
}

/**
 * The options as cBioPortal's own Results link says them (currentQueryParams): profileFilter — the
 * chosen profiles' ids, plus, for one study, the first profile of each kind the query names
 * explicitly, as the portal adds them; several studies' every profile of a chosen kind, which the
 * portal resolves per study — the thresholds, and case_set_id. A user-defined list is stored on this
 * deployment, which the portal cannot read: refused, with the reason.
 */
export function legacyQueryParams(o: QueryOptions | null, data: QueryOptionsData | null, studies: string[], typed: string[]): { params: [string, string][] } | { why: string } | null {
  if (!o) return null;
  if (!data) return { why: "waiting for the studies' profiles and case sets, which this page's link names" };
  const full = completeOptions(o, data.profiles, studies);
  if (full.caseSet === CUSTOM_CASE_SET) return { why: "this page's user-defined case list is stored on this deployment, and cBioPortal's Results link cannot name it" };
  const groups = selectableProfiles(data.profiles);
  const ids = new Set<string>();
  for (const k of PROFILE_KINDS) {
    const v = full.profiles[k.key];
    const g = groups.find((x) => x.kind.key === k.key);
    if (v === EVERY_STUDY) for (const p of g?.profiles || []) ids.add(p.profile);
    else if (v) ids.add(v);
    else if (studies.length === 1 && g && kindsInQuery(typed).has(k.key)) ids.add(g.profiles[0].profile);
  }
  const params: [string, string][] = [["profileFilter", [...ids].join(",")], ["case_set_id", full.caseSet]];
  if (full.profiles.mrna) params.push(["Z_SCORE_THRESHOLD", full.z]);
  if (full.profiles.prot) params.push(["RPPA_SCORE_THRESHOLD", full.rppaZ]);
  return { params };
}
