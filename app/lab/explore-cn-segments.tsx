"use client";
// The Explore page's CN Segments tab, as cBioPortal's study view draws it
// (docs/legacy-spec/parity/study-cn-segments-cases.md): the info line, then the `segments` view
// over the selection with that view's own settings. Its rows name samples, so it runs as an
// ordinary analysis request on the patient-level path (docs/DATA-BOUNDARY.md).
import { useEffect, useMemo, useState } from "react";
import { api } from "./api.ts";
import { KindCardBody, KindCardControls } from "./kind-cards";
import { Updating } from "./view-cards.tsx";
import { segmentsUi } from "./kinds/segments.tsx";
import { CN_SEGMENTS_SAMPLE_LIMIT, cnSegmentsDoc, cnSegmentsInfo, cnSegmentsReads, type CnSegmentsSettings } from "../../lib/study-view-cn-segments.ts";
import type { CohortDef, ViewResult } from "../../lib/types.ts";

export interface CnSegmentsTabProps {
  /** the selection: the draft (or every selected study), in the first study's document */
  selection: { def: CohortDef; study: string } | null;
  /** the selected samples */
  selected: number;
  /** shown: a tab kept mounted while another is shown reads nothing, and catches up when shown again */
  active?: boolean;
}

export function CnSegmentsTab({ selection, selected, active = true }: CnSegmentsTabProps) {
  const [settings, setSettings] = useState<CnSegmentsSettings>({});
  const reads = cnSegmentsReads(selected);
  // nothing to read for an empty selection: the info line says so
  const doc = useMemo(() => selection && reads && selected > 0 ? cnSegmentsDoc(selection.def, selection.study, settings) : null, [selection, reads, selected, settings]);
  const docText = doc ? JSON.stringify(doc) : "";
  const [res, setRes] = useState<{ doc: string; v?: ViewResult; error?: string } | null>(null);

  useEffect(() => {
    if (!doc || !active || res?.doc === docText) return;
    const ac = new AbortController();
    api.analysis(doc, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ac.signal.aborted) return;
        const v = j.views?.[0] as ViewResult | undefined;
        setRes(j.error || !v || v.error ? { doc: docText, error: String(j.error || v?.error || "the segments view returned nothing") } : { doc: docText, v });
      })
      .catch((e) => { if (!ac.signal.aborted) setRes({ doc: docText, error: String((e as Error)?.message || e) }); });
    return () => ac.abort();
  }, [docText, active]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!selection) return <div className="card"><p className="note">Select a study first.</p></div>;
  const busy = !!doc && (!res || res.doc !== docText);
  const v = res?.v;
  const segmented = !busy && v?.kind === "segments" && v.segments ? v.segments.segmented : null;
  const spec = doc?.views?.[0] as unknown as Record<string, unknown> | undefined;
  const c = spec ? {
    vi: 0, spec, v: v || {}, busy, updating: busy, attrs: [], profiles: [], assays: [], events: [],
    patch: (p: Record<string, unknown>) => setSettings((s) => {
      const next = { ...s, ...p } as Record<string, unknown>;
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      return next as CnSegmentsSettings;
    }),
  } : null;
  return (
    <section className="card viewcard" aria-busy={busy || undefined}>
      <p className="flush mb-2" data-test="cn-segments-info"
        data-tip={reads ? undefined : "the portal reads segments for at most " + CN_SEGMENTS_SAMPLE_LIMIT + " selected samples"}>
        {cnSegmentsInfo(selected, segmented)}
      </p>
      {c && <KindCardControls c={c} />}
      {c && v && !busy && segmented !== 0 && <p className="meta flush mb-1">{segmentsUi.sub?.(c.spec, v)}</p>}
      {doc && v && !busy && v.note && <p className="note flush mb-1">{v.note}</p>}
      {busy && !v && <p className="waiting" role="status"><span className="spinner" /> Loading copy number segments data…</p>}
      {busy && v && <Updating />}
      {doc && !busy && res?.error && <p className="note">{res.error}</p>}
      {c && v && segmented !== 0 && KindCardBody({ c: { ...c, v } })}
      {v && !busy && segmented !== 0 && v.caveat && <p className="note vfoot">{v.caveat}</p>}
    </section>
  );
}
