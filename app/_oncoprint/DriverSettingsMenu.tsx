"use client";
// The driver-annotation settings, as cBioPortal's Results page offers them in its sliders menu
// (shared/alterationFiltering/SettingsMenu + driverAnnotations/DriverAnnotationControls): which
// sources call an alteration a putative driver ("Annotate Data"), and what is left out because of
// that call or because a mutation is germline ("Filter Data"). The settings are the view's
// `drivers` (lib/driver-settings.ts); a change re-runs the view, since it changes the numbers.
import { SlidersHorizontal } from "lucide-react";
import { Checkbox } from "../_ui/checkbox";
import { GearMenu } from "../_ui/gear-menu.tsx";
import { InfoButton, InfoLine } from "../_ui/info-button.tsx";
import { Separator } from "../_ui/separator";
import { compactDrivers, forData, resolveDrivers, type DriverSettings } from "../../lib/driver-settings.ts";

/** what the drawn data carries of the study's own calls, as the contract reports it */
interface CustomDriverReport { binary: boolean; tiers: string[] }

const Tip = ({ text, label }: { text: string; label: string }) => <InfoButton aria-label={label} data-tip={text} className="text-sm" />;

export function DriverSettingsMenu({ drivers, report, busy, onChange, filters = true, scope, menuId = "onco-drivers" }: {
  /** the view's settings as the document holds them */
  drivers: DriverSettings | undefined;
  /** the custom calls and tiers in the data, which decide whether those sources are offered (null: not known yet) */
  report: CustomDriverReport | null;
  busy: boolean;
  /** the next settings, only what differs from the defaults (undefined when nothing does) */
  onChange: (next: DriverSettings | undefined) => void;
  /** offer "Filter Data" — a plot draws every mutation, as the portal's Plots tab does */
  filters?: boolean;
  /** where the settings apply, said in the header's tip */
  scope: string;
  menuId?: string;
}) {
  let s: ReturnType<typeof resolveDrivers>;
  try { s = resolveDrivers(drivers); } catch { s = resolveDrivers(undefined); }
  // "every tier" is a source only where the data has a tier, as the engine reads it
  if (report) s = forData(s, report.tiers.length > 0);
  const set = (patch: DriverSettings) => onChange(compactDrivers({ oncokb: s.oncokb, custom: s.custom, tiers: s.tiers ?? undefined,
    hideVus: s.hideVus, hideGermline: s.hideGermline, ...patch }));
  const tiers = report?.tiers || [];
  // a tier counts unless the settings name the tiers and leave it out
  const tierOn = (t: string) => s.tiers === null || s.tiers.includes(t);
  const toggleTier = (t: string, on: boolean) => {
    const now = tiers.filter(tierOn);
    const next = on ? [...new Set([...now, t])] : now.filter((x) => x !== t);
    // every tier the data has, ticked, is the default: write nothing
    set({ tiers: next.length === tiers.length ? undefined : next });
  };
  const changed = Number(!s.oncokb) + Number(!s.custom) + Number(s.tiers !== null) + Number(s.hideVus) + Number(s.hideGermline);
  return (
    <GearMenu menuId={menuId} title="driver annotation: which sources call a putative driver, and whether VUS or germline mutations are left out — a change re-runs the view"
      ariaLabel="driver annotation settings" className="driversbtn" wide contentClassName="w-[300px] min-w-[300px] px-2.5 py-2"
      label={<><SlidersHorizontal />mutations{changed ? " (" + changed + ")" : ""}</>}>
      <div data-test="GlobalSettingsDropdown" className="flex flex-col gap-1">
        <InfoLine className="font-semibold">Annotate Data
          <Tip label="about Annotate Data" text={"This section defines which sources are considered to annotate driver variants in your data. Putative driver vs VUS settings apply to " + scope + "."} /></InfoLine>
        <InfoLine className="mt-1 text-sm text-muted-foreground">Driver annotations:
          <Tip label="about driver annotations" text="Annotate drivers from these sources" /></InfoLine>
        <div className="ml-5 flex flex-col gap-0.5">
          <label className="chk" data-test="annotateOncoKb"><Checkbox checked={s.oncokb} disabled={busy}
            onCheckedChange={(c) => set({ oncokb: c === true })} /> OncoKB
            <Tip label="about OncoKB" text="Oncogenicity from OncoKB™, the version-pinned store this instance reads (Oncogenic, Likely Oncogenic, Resistance)" /></label>
          <label className="chk text-muted-foreground" data-test="annotateHotspots"
            data-tip="Cancer Hotspots is not loaded in this warehouse, so no mutation can be called a hotspot">
            <Checkbox checked={false} disabled /> Hotspots (not loaded here)</label>
          {report?.binary && <label className="chk" data-test="annotateCustomBinary"><Checkbox checked={s.custom} disabled={busy}
            onCheckedChange={(c) => set({ custom: c === true })} /> Custom Driver
            <Tip label="about custom driver" text="Use driver annotations from source data (the study's cbp_driver column: Putative_Driver counts)" /></label>}
        </div>
        {tiers.length > 0 && <div data-test="annotateCustomTiers">
          <InfoLine className="mt-1 text-sm text-muted-foreground">Custom Driver Tiers:
            <Tip label="about custom driver tiers" text="Consider these annotation tiers as driver" /></InfoLine>
          <div className="ml-5 flex flex-col gap-0.5">
            {tiers.map((t) => <label key={t} className="chk"><Checkbox checked={tierOn(t)} disabled={busy}
              onCheckedChange={(c) => toggleTier(t, c === true)} /> {t}</label>)}
          </div>
        </div>}
        {report === null && <span className="meta ml-5">custom driver calls are listed once the figure has drawn</span>}
        {filters && <>
          <Separator className="my-1.5" />
          <InfoLine className="font-semibold">Filter Data</InfoLine>
          <label className="chk" data-test="HideVUS"
            data-tip={s.annotated ? undefined : "no driver source is on, so nothing is told apart as a driver: tick a source above first"}>
            <Checkbox checked={s.hideVus} disabled={busy || !s.annotated} onCheckedChange={(c) => set({ hideVus: c === true })} /> Show only drivers
            <Tip label="about show only drivers" text="Exclude VUS: Drivers are defined through the options above. The hidden alterations leave the percentages too." /></label>
          <label className="chk" data-test="HideGermline"><Checkbox checked={s.hideGermline} disabled={busy}
            onCheckedChange={(c) => set({ hideGermline: c === true })} /> Show only somatic
            <Tip label="about show only somatic" text="Exclude germline mutations (those whose mutation status says germline). The hidden mutations leave the percentages too." /></label>
        </>}
      </div>
    </GearMenu>
  );
}
