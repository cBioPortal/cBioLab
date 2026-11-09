"use client";
// The query dialog's controls above the genes, as cBioPortal's query page has them: "Select Genomic
// Profiles" (MolecularProfileSelector: a checkbox per profile kind, radios where a study has several
// profiles of a kind, a z-score threshold under mRNA and protein, each profile's description on its ⓘ)
// and "Select Patient/Case Set" (CaseSetSelector: the study's sample lists by name with their sizes,
// filtered as typed, each list's description on hover, and "User-defined Case List" with its sample
// or patient ids). The rules are lib/query-options.ts; this draws them and reports the choice.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { api } from "../lab/api.ts";
import { Checkbox } from "../_ui/checkbox";
import { Input } from "../_ui/input";
import { Textarea } from "../_ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "../_ui/popover";
import { InfoButton } from "../_ui/info-button";
import { FIELD } from "../_ui/toolbar.ts";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { crossStudyExpression, expressionAcross } from "../../lib/results-settings.ts";
import { StepHeading } from "../_genes/GeneQueryDialog.tsx";
import { cn } from "../../lib/cn";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";
import {
  selectableProfiles, defaultProfiles, defaultCaseSet, heldKinds, caseSetSampleCount, mixedGenomes, MIXED_GENOME_WARNING, caseSetOptions, profilesProblem, optionsProblem, caseSetProblem, parseCaseIds, studiesWithoutCaseSet,
  EVERY_STUDY, CUSTOM_CASE_SET, DEFAULT_Z, type ProfileKind, type QueryOptions, type QueryOptionsData,
} from "../../lib/query-options.ts";

/** what the panel reports: the options so far, what stops them, and a user-defined list still to be saved */
export interface QueryOptionsStatus {
  options: QueryOptions | null;
  problems: string[];
  pending: boolean;
  /** with "User-defined Case List": the typed ids read as "study:id", saved on submit (QueryGenesDialog) */
  customIds?: { ids: string[]; level: "sample" | "patient" };
  /** said beside the choice, never a reason to refuse it */
  notes: string[];
  /** the kinds the studies hold, and whether expression may be compared across them: what resolveQuery needs to check the genes on submit */
  held: ProfileKind[];
  expression: boolean;
  /** the samples the case set holds (caseSetSampleCount), for the size limit on submit; null when not known */
  samples: number | null;
}

/** mRNA and protein: a profile chosen by id even across studies, where the other kinds are a data type */
const isExpressionKind = (k: ProfileKind) => k === "mrna" || k === "prot";

type Loaded = QueryOptionsData & { unavailable: { study: string; why: string }[] };

/** the query page's choices for these studies, fetched once per selection */
export function useQueryOptionsData(studies: string[]): { data: Loaded | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; data: Loaded | null; error: string | null }>({ key: "", data: null, error: null });
  const key = studies.join(",");
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    api.queryOptions(key.split(","), { signal: ctl.signal }).then((r) => r.json())
      .then((j) => setState({ key, data: j.error ? null : j, error: j.error || null }))
      .catch((e) => { if (!ctl.signal.aborted) setState({ key, data: null, error: String(e?.message || e) }); });
    return () => ctl.abort();
  }, [key]);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null, loading: state.key !== key };
}

/** a section of the form: its label, as the portal's SectionHeader, beside what it holds */
function Section({ n, label, loading, aside, children }: { n: number; label: string; loading?: boolean; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t pt-2.5 first:border-t-0 first:pt-0">
      <StepHeading n={n} label={label} loading={loading} aside={aside} />
      <div className="min-w-0 pl-7">{children}</div>
    </section>
  );
}

export function QueryOptionsPanel({ studies, filtered, initial, exploreHref, onChange }: {
  studies: string[];
  /** the studies are narrowed by Explore's filters: the case set starts at all of them */
  filtered: boolean;
  /** what a Results page asked for, when modifying it */
  initial: QueryOptions | null;
  /** the selection's Explore, the portal's "enhanced Study View" link */
  exploreHref: string;
  onChange: (s: QueryOptionsStatus) => void;
}) {
  const { data, error, loading } = useQueryOptionsData(studies);
  const several = studies.length > 1;
  // across studies mRNA and protein are offered only where the deployment lets expression be compared (MolecularProfileSelector's allowExpressionCrossStudy)
  const expression = expressionAcross(studies, crossStudyExpression(usePublicEnv()));
  const groups = useMemo(() => (data ? selectableProfiles(data.profiles).filter((g) => expression || !isExpressionKind(g.kind.key)) : []), [data, expression]);
  // the choice: the page's own when modifying, else the portal's defaults once the profiles are known
  const [profiles, setProfiles] = useState<QueryOptions["profiles"] | null>(initial ? initial.profiles : null);
  const [z, setZ] = useState(initial?.z || DEFAULT_Z);
  const [rppaZ, setRppaZ] = useState(initial?.rppaZ || DEFAULT_Z);
  // the case set the reader picked; until then it follows the profiles (the portal's defaultSelectedSampleListId)
  const [picked, setPicked] = useState<string | null>(initial?.caseSet || null);
  const [level, setLevel] = useState<"sample" | "patient">(initial?.cases?.level || "sample");
  const [idsText, setIdsText] = useState("");
  const [idsLoading, setIdsLoading] = useState(!!initial?.cases);
  useEffect(() => { if (data && profiles === null) setProfiles(defaultProfiles(data.profiles, studies.length)); }, [data, profiles, studies.length]);
  // modifying a page with a user-defined list: its ids, read back from the stored set
  useEffect(() => {
    if (!initial?.cases) return;
    let live = true;
    fetch("/api/id-sets/" + encodeURIComponent(initial.cases.set) + "?ids=1").then((r) => (r.ok ? r.text() : Promise.reject(new Error("could not read the case list (" + r.status + ")"))))
      .then((t) => { if (live) setIdsText(studies.length === 1 ? t.split("\n").map((l) => l.replace(studies[0] + ":", "")).join("\n").trim() : t.trim()); })
      .catch(() => {}).finally(() => { if (live) setIdsLoading(false); });
    return () => { live = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- read once, for the page being modified

  const lists = useMemo(() => data?.caseSets || [], [data]);
  const options = useMemo(() => caseSetOptions(studies, lists), [studies, lists]);
  const fallback = several || filtered ? (several ? "all" : studies[0] + "_all") : defaultCaseSet(studies[0], profiles || {}, lists);
  const caseSet = picked && (picked === CUSTOM_CASE_SET || options.some((o) => o.id === picked)) ? picked : fallback;
  const parsed = useMemo(() => (caseSet === CUSTOM_CASE_SET ? parseCaseIds(idsText, studies, level) : null), [caseSet, idsText, studies, level]);

  const status = useMemo((): QueryOptionsStatus => {
    if (!data || !profiles) return { options: null, problems: error ? ["could not read the studies' profiles and case sets: " + error] : [], pending: !error, notes: [], held: [], expression, samples: null };
    const o: QueryOptions = { profiles, z, rppaZ, caseSet };
    const problems = [profilesProblem(o), optionsProblem(o, data.profiles, studies.length)];
    if (caseSet === CUSTOM_CASE_SET) {
      if (parsed && "error" in parsed) problems.push(parsed.error);
      else if (!parsed?.ids.length) problems.push("Please enter at least one ID in your custom case set.");
    } else problems.push(caseSetProblem(o, studies));
    const without = several ? studiesWithoutCaseSet(caseSet, studies, lists) : [];
    const notes = [
      mixedGenomes(data.builds, studies) ? MIXED_GENOME_WARNING : null,
      without.length ? "the case set leaves out " + without.join(", ") + ", which " + (without.length === 1 ? "has" : "have") + " no such sample list" : null,
      ...data.unavailable.map((u) => u.why),
    ].filter(Boolean) as string[];
    return { options: o, problems: problems.filter(Boolean) as string[], pending: idsLoading, notes, held: [...heldKinds(data.profiles)], expression,
      samples: caseSetSampleCount(o, studies, lists, parsed && "ids" in parsed ? Math.max(1, parsed.ids.length) : undefined),
      ...(parsed && "ids" in parsed && parsed.ids.length ? { customIds: { ids: parsed.ids, level } } : {}) };
  }, [data, error, profiles, z, rppaZ, caseSet, parsed, level, several, studies, lists, idsLoading, expression]);
  const sent = useRef("");
  useEffect(() => { const k = JSON.stringify(status); if (k !== sent.current) { sent.current = k; onChange(status); } }, [status, onChange]);

  const choose = (kind: ProfileKind, profile: string | null) =>
    setProfiles((p) => { const next = { ...(p || {}) }; if (profile) next[kind] = profile; else delete next[kind]; return next; });

  return (
    <div className="flex flex-col gap-2.5 [&_label]:m-0" data-test="queryOptions">
      <Section n={1} label="Select Genomic Profiles:" loading={loading}>
        <div className="flex flex-col gap-0.5" data-test="molecularProfileSelector">
          {error && <p className="m-0 text-sm text-destructive">could not read the studies&apos; profiles: {error}</p>}
          {data && !groups.length && <strong className="text-md">No studies selected</strong>}
          {groups.map(({ kind, profiles: ps }) => {
            const value = profiles?.[kind.key];
            const on = !!value;
            if (several && !isExpressionKind(kind.key)) {
              // across studies the choice is a data type: each study's profile of that kind
              const names = [...new Set(ps.map((p) => p.name))];
              return (
                <label key={kind.key} className="flex min-h-6 items-center gap-2 text-md leading-tight">
                  <Checkbox checked={on} onCheckedChange={(c) => choose(kind.key, c === true ? EVERY_STUDY : null)} data-test={kind.type} aria-label={kind.label} />
                  <span>{names.length === 1 && kind.key !== "sv" ? names[0] : kind.label}</span>
                  <InfoButton aria-label={"about " + kind.label}
                    data-tip={"each selected study's " + kind.label.toLowerCase() + " profile:\n" + ps.map((p) => p.name + (p.description ? " — " + p.description : "")).join("\n")} />
                </label>
              );
            }
            const one = ps.length === 1;
            return (
              <div key={kind.key} className="flex flex-col gap-0.5">
                {one ? (
                  <ProfileToggle profile={ps[0]} label={kind.key === "sv" ? kind.label : ps[0].name} checked={on} kind={kind.type}
                    onChange={(c) => choose(kind.key, c ? ps[0].profile : null)} />
                ) : (
                  <>
                    <label className="flex min-h-6 items-center gap-2 text-md leading-tight font-semibold">
                      <Checkbox checked={on} onCheckedChange={(c) => choose(kind.key, c === true ? ps[0].profile : null)} data-test={kind.type} aria-label={kind.label} />
                      <span>{kind.label}. Select one of the profiles below:</span>
                    </label>
                    <div className="ml-6 flex flex-col gap-0.5" role="radiogroup" aria-label={kind.label + " profile"}>
                      {ps.map((p) => <ProfileToggle key={p.profile} profile={p} label={p.name} checked={value === p.profile} kind={kind.type} radio
                        onChange={(c) => { if (c) choose(kind.key, p.profile); }} />)}
                    </div>
                  </>
                )}
                {on && (kind.key === "mrna" || kind.key === "prot") && (
                  <label className="ml-6 flex items-center gap-1.5 text-md">
                    Enter a z-score threshold ±
                    <Input value={kind.key === "mrna" ? z : rppaZ} onChange={(e) => (kind.key === "mrna" ? setZ : setRppaZ)(e.target.value)}
                      aria-label={kind.key === "mrna" ? "mRNA z-score threshold" : "protein z-score threshold"} className={cn(FIELD, "h-7 w-16 tabular-nums")} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </Section>
      <Section n={2} label="Select Patient/Case Set:" loading={loading}
        aside={<a href={exploreHref} target="_blank" rel="noreferrer" className="text-sm">To build your own case set, try out our enhanced Study View.</a>}>
        <div className="flex flex-col gap-1.5" data-test="CaseSetSelector">
          <CaseSetPicker options={options} value={caseSet} onChange={setPicked} loading={loading} />
          {caseSet === CUSTOM_CASE_SET && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-4 text-md" role="radiogroup" aria-label="case ids are">
                {(["sample", "patient"] as const).map((l) => (
                  <label key={l} className="flex items-center gap-1.5">
                    <input type="radio" name="case-ids-mode" checked={level === l} onChange={() => setLevel(l)} />
                    {l === "sample" ? "By sample ID" : "By patient ID"}
                  </label>
                ))}
              </div>
              <span className="text-md">Enter case IDs below:</span>
              <Textarea value={idsText} onChange={(e) => setIdsText(e.target.value)} rows={6} spellCheck={false} aria-label="Enter case IDs"
                data-test="CustomCaseSetInput" placeholder={idsLoading ? "reading the page's case list…" : studies.length === 1 ? "TCGA-A1-A0SB-01\nTCGA-A1-A0SD-01" : studies[0] + ":<id>"}
                className="min-h-28 bg-card font-mono text-md md:text-md" />
              <span className="text-sm text-muted-foreground">
                Separated by spaces or new lines{studies.length === 1 ? "; " + studies[0] + ":<id> also works" : ", each as <study>:<id>"}.
                {parsed && "ids" in parsed && parsed.ids.length > 0 && " " + parsed.ids.length + " " + level + (parsed.ids.length === 1 ? "" : "s") + " — each is checked against the studies when you submit."}
              </span>
            </div>
          )}
        </div>
      </Section>
      {status.notes.map((n) => <p key={n} className="m-0 text-sm text-muted-foreground">{n}</p>)}
    </div>
  );
}

/** one profile's checkbox or radio, its name, and its description on the ⓘ (the portal's ProfileToggle) */
function ProfileToggle({ profile, label, checked, kind, radio, onChange }: { profile: ProfileInfo; label: string; checked: boolean; kind: string; radio?: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex min-h-6 items-center gap-2 text-md leading-tight">
      {radio
        ? <input type="radio" checked={checked} onChange={(e) => onChange(e.target.checked)} data-test={kind} aria-label={label} />
        : <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} data-test={kind} aria-label={label} />}
      <span>{label}</span>
      <InfoButton aria-label={"about " + label} data-tip={profile.description || "the study gives no description of this profile"} />
    </label>
  );
}

/** the case set dropdown: each option its name and size, its description on hover, filtered by name as typed (the portal's react-select) */
function CaseSetPicker({ options, value, onChange, loading }: {
  options: { id: string; label: string; name: string; description: string }[]; value: string; onChange: (id: string) => void; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.id === value);
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={loading && !options.length} aria-label="case set" data-test="caseSetSelector" data-tip={current?.description}
          className="flex h-8 w-full max-w-xl items-center justify-between gap-2 rounded-md border bg-card px-2.5 text-left text-md disabled:opacity-60">
          <span className="truncate">{current ? current.label : loading ? "loading case sets…" : value}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-xl p-1">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="type to filter case sets…" aria-label="filter case sets" className={cn(FIELD, "mb-1 h-8")}
          onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { e.preventDefault(); onChange(shown[0].id); setOpen(false); } }} />
        <div role="listbox" aria-label="case sets" className="max-h-72 overflow-y-auto">
          {!shown.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">no case set matches “{q}”</div>}
          {shown.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === value} data-tip={o.description}
              onClick={() => { onChange(o.id); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-md hover:bg-accent">
              <span className="min-w-0 flex-1">{o.label}</span>
              {o.id === value && <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
