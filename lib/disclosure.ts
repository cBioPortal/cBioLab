// Which patient-level data may cross between cbio-lab instances through the federation API — the
// rules each side of the opt-in patient-level federation mode writes in one setting
// (docs/DATA-BOUNDARY.md):
//
//   FEDERATION_DISCLOSE_PATIENTS     on the peer (the data owner): what it will send, for which studies
//   FEDERATION_ACCEPT_PATIENT_LEVEL  on the coordinator: what it accepts from its FEDERATION_PEERS peer, per study
//
// Data crosses only where both allow it. A rule names a study (or `*`, every study) and the kinds of
// patient-level data allowed for it: `genie_public:timeline+alterations`, `*:timeline`,
// `genie_public:*`. A bare study id allows the timeline alone. Rules are separated by commas or
// whitespace. An unknown kind is refused by name, never ignored: a typo must not read as "nothing".

import { setting } from "./settings.ts";

/** The kinds of patient-level data a rule can allow — each one view's needs, and nothing else. */
export const PATIENT_KINDS = ["timeline", "alterations", "plot"] as const;
export type PatientKind = (typeof PATIENT_KINDS)[number];

/** What each kind lets cross, for the setting's error messages and the result captions. */
export const PATIENT_KIND_NAMES: Record<PatientKind, string> = {
  timeline: "patient timelines",
  alterations: "patient alterations",
  plot: "plot cases",
};

/** study (or `*`) -> the kinds allowed for it */
export type DisclosureRules = Map<string, Set<PatientKind>>;

const STUDY = /^(\*|[A-Za-z0-9._-]{1,120})$/;

/** A setting's rules; throws naming the setting on anything it cannot read. */
export function parseRules(raw: string | undefined, setting: string): DisclosureRules {
  const rules: DisclosureRules = new Map();
  for (const entry of (raw || "").split(/[,\s]+/).filter(Boolean)) {
    const i = entry.indexOf(":");
    const study = (i < 0 ? entry : entry.slice(0, i)).trim();
    if (!STUDY.test(study)) throw new Error(setting + ": '" + entry.slice(0, 80) + "' does not name a study (a study id or *)");
    const kinds = i < 0 ? ["timeline"] : entry.slice(i + 1).split("+").map((k) => k.trim()).filter(Boolean);
    if (!kinds.length) throw new Error(setting + ": '" + entry.slice(0, 80) + "' names no kind; use " + PATIENT_KINDS.join(", ") + " or *");
    const set = rules.get(study) || new Set<PatientKind>();
    for (const k of kinds) {
      if (k === "*") PATIENT_KINDS.forEach((x) => set.add(x));
      else if ((PATIENT_KINDS as readonly string[]).includes(k)) set.add(k as PatientKind);
      else throw new Error(setting + ": unknown kind '" + k.slice(0, 40) + "' in '" + entry.slice(0, 80) + "'; the kinds are " + PATIENT_KINDS.join(", ") + " (or * for all)");
    }
    rules.set(study, set);
  }
  return rules;
}

/** The kinds the rules allow for `study`: its own rule and the `*` rule together. */
export function allowedKinds(rules: DisclosureRules, study: string): Set<PatientKind> {
  return new Set([...(rules.get("*") || []), ...(rules.get(study) || [])]);
}

/** The peer's own rules: what this instance sends to callers of its federation API. */
export const disclosedByThisInstance = () => parseRules(setting("FEDERATION_DISCLOSE_PATIENTS"), "FEDERATION_DISCLOSE_PATIENTS");
/** The coordinator's rules: what this instance accepts from the peer serving each study. */
export const acceptedFromPeers = () => parseRules(setting("FEDERATION_ACCEPT_PATIENT_LEVEL"), "FEDERATION_ACCEPT_PATIENT_LEVEL");

/** "patient timelines and patient alterations" */
export const kindsText = (kinds: Iterable<PatientKind>) => {
  const xs = PATIENT_KINDS.filter((k) => [...kinds].includes(k)).map((k) => PATIENT_KIND_NAMES[k]);
  return xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs[0] || "nothing";
};
