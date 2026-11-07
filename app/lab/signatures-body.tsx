"use client";
// The signatures view's card: one patient's mutational signatures (cBioPortal's Mutational
// Signatures tab) — its settings (signature type, the spectrum's sample, percent or counts; all in
// the document), the figure (lib/views/signatures/figure.ts, the drawing MCP sends) at the card's
// width, and every signature as the portal's table: a column per profiled sample. The navigator
// steps through the cohort's patients (app/lab/patient-nav.tsx).
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { signaturesSvg } from "../../lib/views/signatures/figure.ts";
import { COUNT_TIP, ROW_CLICK_HINT, SIGNIFICANT_P, YMAX_MAX, YMAX_MIN, countLabel, pctText, typeOption } from "../../lib/views/signatures/data.ts";
import type { SignaturesResult, SignatureRow } from "../../lib/views/signatures/types";
import { PatientNav, PatientsDialog, patientKeys, type PatientKey } from "./patient-nav.tsx";
import { type Col, PortalTable } from "./portal-bodies.tsx";
import { OptionSelect } from "../_ui/choice.tsx";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";
import { Slider } from "../_ui/slider";
import { Info } from "lucide-react";

type Spec = { patient?: PatientKey; version?: string; sample?: string; scale?: "percent" | "count"; signature?: string; ymax?: number } & Record<string, unknown>;

/** The Y-axis Max slider: follows the drag here, and writes the document once the thumb is let go (the portal's onChangeComplete). */
function YMaxSlider({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <span className="tbfield" data-tip={"cuts the spectrum's axis at " + (drag ?? value) + "% of its range; a bar past it stops at the axis"}>
      Y-axis Max:
      <Slider aria-label="Y-axis Max" className="w-[100px]" min={YMAX_MIN} max={YMAX_MAX} step={1} disabled={disabled} value={[drag ?? value]}
        onValueChange={(vs) => setDrag(vs[0])} onValueCommit={(vs) => { setDrag(null); if (vs[0] !== value) onCommit(vs[0]); }} />
    </span>
  );
}

export function SignaturesBody({ v, spec, vi, updating, docJson, patch, fixed }: {
  v: { signatures: SignaturesResult; caveat?: string } & Record<string, unknown>; spec: Spec; vi: number; updating: boolean; docJson?: () => string; patch: (p: Record<string, unknown>) => void;
  /** one patient only (the Patient page): no navigator through the cohort's others */
  fixed?: boolean;
}) {
  const s = v.signatures;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [listOpen, setListOpen] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(420, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const p = s.patient;
  const svg = useMemo(() => signaturesSvg(v as never, { width, spectrumHead: false }), [v, width]);
  const go = (to: PatientKey | null | undefined) => { if (to && !updating) patch({ patient: to, sample: undefined, signature: undefined, ymax: undefined }); };
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.id;
  const scale = spec.scale || "percent";
  const sp = s.spectrum;
  const chosen = s.reference ? s.signatures.find((r) => r.name === s.reference!.signature) ?? null : null;
  const canPick = (r: SignatureRow) => !!sp && s.referenced.includes(r.name);
  const cols = useMemo((): Col<SignatureRow>[] => [
    { key: "name", label: "Mutational signature", value: (r) => r.name,
      render: (r) => <span data-tip={(r.description || "no description recorded") + (sp && !s.referenced.includes(r.name) ? " — no COSMIC reference profile to draw under the spectrum" : "")}>
        {r.url ? <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.name}</a> : r.name}</span> },
    ...s.profiled.map((id, i): Col<SignatureRow> => ({ key: "s" + i, label: id, num: true, value: (r) => r.values[i].value,
      title: p?.samples.find((x) => x.id === id)?.type || undefined,
      render: (r) => { const x = r.values[i]; const sig = x.p != null && x.p < SIGNIFICANT_P;
        return <span data-tip={x.p != null ? "p = " + x.p.toPrecision(2) + (sig ? ", significant" : "") : undefined} className={sig ? "font-semibold" : undefined}>{pctText(x.value)}</span>; } })),
  ], [s.profiled, p, sp, s.referenced]);

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- arrow-key shortcuts for the patient buttons PatientNav already provides
    <div className="tl-view" tabIndex={-1} onKeyDown={patientKeys(s.position, go)}>
      {!fixed && <PatientNav shown={p ? p.id : null} position={s.position} total={s.total} updating={updating} go={go} what="draw it"
        openList={() => setListOpen(true)} first={() => patch({ patient: undefined, sample: undefined })} />}
      {p && s.version ? (
        <div className="tl-head">
          <span className="tl-who mono">{p.id}</span>
          <span className="meta">{p.study}</span>
          <div className="viewtb tl-settings">
            <div className="tbz">
              <label className="tbfield">
                Mutational Signature Type: <OptionSelect value={s.version} disabled={updating || s.versions.length < 2}
                  onValueChange={(x) => patch({ version: x, sample: undefined, signature: undefined, ymax: undefined })}>
                  {s.versions.map((x) => <option key={x} value={x}>{typeOption(x)}</option>)}
                </OptionSelect>
              </label>
              {sp && s.counted.length > 1 && (
                <label className="tbfield">
                  Sample: <OptionSelect value={sp.sample} disabled={updating} onValueChange={(x) => patch({ sample: x === s.counted[0] ? undefined : x })}>
                    {s.counted.map((x) => <option key={x} value={x}>{x}</option>)}
                  </OptionSelect>
                </label>)}
            </div>
            {sp && (
              <div className="tbz">
                <Button type="button" variant={scale === "percent" ? "default" : "outline"} size="sm" className={TB} aria-pressed={scale === "percent"} disabled={updating}
                  data-tip="Y-axis by percent" onClick={() => { if (scale !== "percent") patch({ scale: undefined, ymax: undefined }); }}>%</Button>
                <Button type="button" variant={scale === "count" ? "default" : "outline"} size="sm" className={TB} aria-pressed={scale === "count"} disabled={updating}
                  data-tip="Y-axis by absolute count" onClick={() => { if (scale !== "count") patch({ scale: "count", ymax: undefined }); }}>#</Button>
              </div>)}
            {sp && <div className="tbz"><YMaxSlider value={s.ymax} disabled={updating} onCommit={(x) => patch({ ymax: x === YMAX_MAX ? undefined : x })} /></div>}
          </div>
        </div>
      ) : <p className="meta">No patient to draw: no patient of the cohort has mutational-signature values.</p>}
      {p && sp && s.version && (
        <p className="my-2 text-sm"><strong>Sample:</strong> {sp.sample} | <strong>{countLabel(s.version)} count:</strong> {sp.total}
          <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground align-middle" aria-label="about this count" data-tip={COUNT_TIP}><Info /></Button></p>)}
      {p && s.notProfiled.length > 0 && <p className="note">{s.notProfiled.join(", ")} {s.notProfiled.length === 1 ? "is" : "are"} not profiled for mutational signatures.</p>}
      <div ref={box} className={"tl-fig" + (updating ? " stale" : "")}>
        {p && svg && <div dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
      {p && s.signatures.length > 0 && (
        <section className="alt-table" aria-label="Mutational signatures">
          {sp && <p className="meta">{ROW_CLICK_HINT}</p>}
          <PortalTable rows={s.signatures} cols={cols} selected={chosen} onSelect={(r) => { if (!updating && canPick(r) && r !== chosen) patch({ signature: r.name }); }} initialSort={s.profiled.length ? { key: "s0", desc: true } : { key: "name" }} search={(r) => r.name + " " + r.description}
            filters={[{ label: "above 0 in some sample", test: (r) => r.values.some((x) => (x.value ?? 0) > 0) },
              ...(s.profiles?.pvalue ? [{ label: "significant only (p < " + SIGNIFICANT_P + ")", test: (r: SignatureRow) => r.values.some((x) => x.p != null && x.p < SIGNIFICANT_P) }] : [])]}
            note={s.profiles?.contribution + (s.profiles?.pvalue ? "; bold: p < " + SIGNIFICANT_P + " in " + s.profiles.pvalue : "; no p-values recorded")} />
        </section>
      )}
      {listOpen && (
        <PatientsDialog title={"Patients of " + (s.lists[0]?.cohort ?? "the cohort") + " with mutational signatures"} onClose={() => setListOpen(false)}>
          {(close) => (
            <DataTable t={s} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit="patients"
              title="choose a patient" onQuery={(q) => patch({ ...q })}
              onRow={(row) => { if (!isSel(row)) patch({ patient: { study: row.study, id: row.patient }, sample: undefined }); close(); }} selected={isSel}
              cell={(id, x) => id === "patient" ? <span className="mono">{x}</span> : undefined} />
          )}
        </PatientsDialog>
      )}
    </div>
  );
}
