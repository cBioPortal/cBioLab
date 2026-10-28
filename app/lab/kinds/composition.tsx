"use client";
// The composition view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the composition view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const parts: string[] = c.v?.composition ? c.v.composition.parts.map((x: { id: string }) => x.id) : spec.attributes || spec.entities || [];
  const names = new Map<string, string>(c.v?.composition ? c.v.composition.parts.map((x: { id: string; name: string }) => [x.id, x.name]) : []);
  const fromProfile = !spec.attributes?.length;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="where the parts come from: every entity of a generic-assay profile, or numeric clinical attributes you list">
          parts <OptionSelect value={fromProfile ? "profile:" + (spec.profileType || "") : "attributes"} disabled={busy}
            onValueChange={(v) => v === "attributes"
              ? patch({ profileType: undefined, entities: undefined, attributes: spec.attributes?.length ? spec.attributes : [], sort: undefined })
              : patch({ profileType: v.slice("profile:".length), attributes: undefined, entities: undefined, unit: undefined, sort: undefined })}>
            {fromProfile && !c.assays.includes(spec.profileType) && <option value={"profile:" + (spec.profileType || "")}>{spec.profileType || "choose…"}</option>}
            {c.assays.map((pr) => <option key={pr} value={"profile:" + pr}>{pr}</option>)}
            <option value="attributes">clinical attributes…</option>
          </OptionSelect>
        </label>
        {!fromProfile && <label className="tbfield" data-tip="the numeric clinical attributes that are the parts, comma-separated (2–16; custom: names work)">
          attributes <DraftInput value={(spec.attributes || []).join(", ")} disabled={busy} width="22rem" placeholder="custom:my-data/A, custom:my-data/B"
            onCommit={(t) => patch({ attributes: t.split(",").map((x) => x.trim()).filter(Boolean), sort: undefined })} />
        </label>}
        {!fromProfile && <label className="tbfield" data-tip="one bar per patient, or per sample">
          per <OptionSelect value={spec.unit === "sample" ? "sample" : "patient"} disabled={busy} onValueChange={(v) => patch({ unit: v === "sample" ? "sample" : undefined })}>
            <option value="patient">patient</option><option value="sample">sample</option>
          </OptionSelect>
        </label>}
      </div>
      <div className="tbz"><span className="tbl">view</span>
        {parts.length > 0 && <label className="tbfield" data-tip="the part the cases are ordered by, highest first">
          sort by <OptionSelect value={spec.sort || parts[0]} disabled={busy} onValueChange={(v) => patch({ sort: v === parts[0] ? undefined : v })}>
            {parts.map((x) => <option key={x} value={x}>{names.get(x) || x}</option>)}
          </OptionSelect>
        </label>}
        <label className="chk" data-tip="divide each case's parts by their sum, so every bar is a whole">
          <Checkbox checked={spec.normalize !== false} disabled={busy} onCheckedChange={(on) => patch({ normalize: on === true ? undefined : false })} /> shares
        </label>
      </div>
    </div>
  );
}

export const compositionUi: KindUi<"composition"> = {
  kind: "composition",
  label: "Composition (cell types, states, signatures as parts of a whole)",
  category: "expression",
  title: "Composition",
  maxCohorts: 8,
  minCohorts: 1,
  why: (k) => !k.assays.length && !k.attrs.some((a) => a.kind === "num") ? "this study has no generic-assay profile and no numeric attribute to draw as parts" : null,
  defaults: (known) => {
    const profile = known.assays.find((p) => /cell_type.*relative|fraction|proportion/i.test(p)) || known.assays.find((p) => /signature/i.test(p) && /contribution/i.test(p)) || known.assays[0];
    return profile ? { kind: "composition", profileType: profile } : { kind: "composition", attributes: [] };
  },
  sub: (spec, v) => {
    const c = v.composition;
    const what = c ? c.sourceName : spec.profileType || (spec.attributes?.length ? spec.attributes.length + " attributes" : "no parts chosen");
    return what + (c ? " · " + c.parts.length + " parts per " + c.unit.replace(/s$/, "") : "") + ((spec.normalize ?? true) ? ", as shares" : ", as recorded") +
      (c ? " · sorted by " + (c.parts.find((x: { id: string }) => x.id === c.sort)?.name || c.sort) : "");
  },
  Controls,
};
