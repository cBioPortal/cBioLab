"use client";
// The signatures view's card: one patient's mutational signatures (cBioPortal's Mutational
// Signatures tab) — its settings (signature type, the spectrum's sample, percent or counts; all in
// the document), the figure (lib/views/signatures/figure.ts, the drawing MCP sends) at the card's
// width, and every signature as the portal's table: a column per profiled sample. The navigator
// steps through the cohort's patients (app/lab/patient-nav.tsx).
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, specQuery } from "../_table/DataTable.tsx";
import { signaturesSvg } from "../../lib/views/signatures/figure.ts";
import { SIGNIFICANT_P, pctText, versionLabel } from "../../lib/views/signatures/data.ts";
import type { SignaturesResult, SignatureRow } from "../../lib/views/signatures/types";
import { PatientNav, PatientsDialog, patientKeys, type PatientKey } from "./patient-nav.tsx";
import { type Col, PortalTable } from "./portal-bodies.tsx";
import { OptionSelect } from "../_ui/choice.tsx";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";

type Spec = { patient?: PatientKey; version?: string; sample?: string; scale?: "percent" | "count" } & Record<string, unknown>;

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
  const svg = useMemo(() => signaturesSvg(v as never, { width }), [v, width]);
  const go = (to: PatientKey | null | undefined) => { if (to && !updating) patch({ patient: to, sample: undefined }); };
  const isSel = (row: { study: string; patient: string }) => p != null && row.study === p.study && row.patient === p.id;
  const scale = spec.scale || "percent";
  const noScaleWhy = s.spectrum ? null : s.noSpectrum || "no spectrum is drawn";
  const cols = useMemo((): Col<SignatureRow>[] => [
    { key: "name", label: "Mutational signature", value: (r) => r.name,
      render: (r) => <span data-tip={r.description || "no description recorded"}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</span> },
    ...s.profiled.map((id, i): Col<SignatureRow> => ({ key: "s" + i, label: id, num: true, value: (r) => r.values[i].value,
      title: p?.samples.find((x) => x.id === id)?.type || undefined,
      render: (r) => { const x = r.values[i]; const sig = x.p != null && x.p < SIGNIFICANT_P;
        return <span data-tip={x.p != null ? "p = " + x.p.toPrecision(2) + (sig ? ", significant" : "") : undefined} className={sig ? "font-semibold" : undefined}>{pctText(x.value)}</span>; } })),
  ], [s.profiled, p]);

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
              <label className="tbfield" data-tip="the signature type: the study's mutational_signatures_contribution_<type> profile">
                type <OptionSelect value={s.version} disabled={updating || s.versions.length < 2} onValueChange={(x) => patch({ version: x, sample: undefined })}>
                  {s.versions.map((x) => <option key={x} value={x}>{versionLabel(x)}</option>)}
                </OptionSelect>
              </label>
              {s.spectrum && s.counted.length > 1 && (
                <label className="tbfield" data-tip="the sample whose mutational spectrum is drawn">
                  spectrum of <OptionSelect value={s.spectrum.sample} disabled={updating} onValueChange={(x) => patch({ sample: x === s.counted[0] ? undefined : x })}>
                    {s.counted.map((x) => <option key={x} value={x}>{x}</option>)}
                  </OptionSelect>
                </label>)}
            </div>
            <div className="tbz">
              <Button type="button" variant={scale === "percent" ? "default" : "outline"} size="sm" className={TB} aria-pressed={scale === "percent"} disabled={updating || !!noScaleWhy}
                data-tip={noScaleWhy || "each channel as its share of the sample's mutations"} onClick={() => patch({ scale: undefined })}>%</Button>
              <Button type="button" variant={scale === "count" ? "default" : "outline"} size="sm" className={TB} aria-pressed={scale === "count"} disabled={updating || !!noScaleWhy}
                data-tip={noScaleWhy || "each channel as its count of mutations"} onClick={() => patch({ scale: "count" })}>#</Button>
            </div>
          </div>
        </div>
      ) : <p className="meta">No patient to draw: no patient of the cohort has mutational-signature values.</p>}
      {p && s.notProfiled.length > 0 && <p className="note">{s.notProfiled.join(", ")} {s.notProfiled.length === 1 ? "is" : "are"} not profiled for mutational signatures.</p>}
      <div ref={box} className={"tl-fig" + (updating ? " stale" : "")}>
        {p && svg && <div dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
      {p && s.signatures.length > 0 && (
        <section className="alt-table" aria-label="Mutational signatures">
          <PortalTable rows={s.signatures} cols={cols} initialSort={s.profiled.length ? { key: "s0", desc: true } : { key: "name" }} search={(r) => r.name + " " + r.description}
            filters={[{ label: "above 0 in some sample", test: (r) => r.values.some((x) => (x.value ?? 0) > 0), on: true },
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
