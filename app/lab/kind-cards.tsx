"use client";
// The shared card, for the view kinds that do not draw a card of their own (app/lab/kinds/<kind>.tsx
// without a `Card`). The page draws every one of them the same way — ViewHead, then this kind's
// controls, then the figure or the kind's own body — so all that differs per kind is its description:
// its title, whether it takes a gene list, how many cohorts it draws, its subtitle, settings and body.
import React from "react";
import { kindUi } from "./kinds/index.ts";
import type { AddPage, KindCardCtx, Known } from "./kinds/kind-ui.ts";
import { placement } from "./kinds/parts.tsx";
import type { CardProps } from "./view-cards.tsx";
import { ViewHead } from "./view-chrome.tsx";
import { ViewFigure } from "./figure.tsx";
import { Button } from "../_ui/button";

/** whether a kind is drawn by the shared card */
export const hasKindCard = (k: unknown): boolean => { const ui = kindUi(k); return !!ui && !ui.Card; };

/**
 * Views that show their own waiting state (the table views: their search, filters and headers stay
 * usable while the rows are covered), so the page must not cover the card with its own.
 */
export const drawsOwnWaiting = (k: unknown): boolean => !!kindUi(k)?.drawsOwnWaiting;

/** The result as the figure draws it: settings applied in the browser (dataPart) read from the document, not the last run. */
export function figureView(spec: any, v: any): any {
  const f = kindUi(v?.kind)?.figureView;
  return f ? f(spec, v) : v;
}

/** A one-line subtitle for the card header. */
export function kindSub(kind: string, spec: any, v: any): React.ReactNode {
  const sub = kindUi(kind)?.sub;
  return sub ? sub(spec, v) : null;
}

/** This kind's settings row, or nothing when it has none. */
export function KindCardControls({ c }: { c: KindCardCtx }) {
  const Controls = kindUi(c.spec.kind)?.Controls;
  return Controls ? <Controls c={c} /> : null;
}

/** A body of the kind's own in place of the server figure, or null to draw the figure. */
export function KindCardBody({ c }: { c: KindCardCtx }): React.ReactNode | null {
  const body = kindUi(c.spec.kind)?.body;
  return body ? body(c) ?? null : null;
}

/** One view on the shared card: its header, its settings, then its body or its figure. */
export function KindCard({ ctx, v, vi }: CardProps) {
  const { assayOptions, busy, catalogAttrs, cohortChoice, doc, docView, menuOpenRef, openGenes, patchView, pendingKeys, profileOptions, viewEvents, viewIds } = ctx;
  const ui = kindUi(v.kind);
  return <>
    {ui && !ui.Card && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title={ui.title}
        sub={kindSub(v.kind, docView(vi), v)}
        cohorts={cohortChoice(vi, docView(vi), ui.maxCohorts)} cohortInSub={ui.cohortInHeader}
        {...placement(ctx, vi)}
        actions={ui.genes
          ? <Button variant="link" size="inline" className="genesbtn text-md" disabled={busy} data-tip="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</Button>
          : undefined} />
      {(() => {
        const mc = { vi, spec: docView(vi), v, busy, updating: busy || pendingKeys.has(viewIds[vi]), patch: (p: Record<string, unknown>) => patchView(vi, p),
          attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), catalog: ctx.profileCatalog(), events: viewEvents(), docJson: () => JSON.stringify(doc) };
        const body = KindCardBody({ c: mc });
        return <>
          <KindCardControls c={mc} />
          {v.note && <p className="note">{v.note}</p>}
          {body || <ViewFigure v={figureView(docView(vi), v)} error={v.error} />}
          {body && v.caveat && <p className="note vfoot">{v.caveat}</p>}
        </>;
      })()}
    </>}
  </>;
}

/** The view a fresh "add view" click starts from, built from what the study is known to have. */
export function defaultView(kind: string, known: Known, page: AddPage): Record<string, unknown> {
  const defaults = kindUi(kind)?.defaults;
  return defaults ? defaults(known, page) : { kind };
}
