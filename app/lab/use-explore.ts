"use client";
// Explore's facets: one query per request, keyed by everything that decides the answer (the
// studies, the draft, the attributes asked for, the extra charts, the uploads' versions).
//
// The key does the work the page once did by hand. Identical requests from several triggers at
// once (a ?tab=explore link, the tab button, the catalog resolving) share one fetch. A request the
// reader has moved past is cancelled when its key loses its observer — its ~30 ClickHouse queries
// stop, rather than queueing ahead of the answer being waited for — and an answer can only land
// under the key it was asked for, so a late one never replaces a newer one. Going back to a
// selection already counted is answered from the cache.
//
// While a new answer is on its way, or if it fails, the last one stays on screen; the page's
// "counting" state says it is not current.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CohortDef, DerivedRequest, ExploreResult } from "../../lib/types.ts";
import { api } from "./api.ts";

/** What decides Explore's answer — the query key. */
export interface ExploreRequest {
  studies: string[];
  draft: CohortDef | null;
  /** narrows the server's work to the attributes that will be shown; empty asks for all */
  attributes: string[];
  geneCharts: string[];
  /** the derived facets to compute; the server computes none it is not asked for */
  derived: DerivedRequest[];
  /** the uploads' datasets and versions (customDataKey) — they are part of the answer */
  uploads: string;
}

/** A request asked for, plus whether its answer may define the full attribute vocabulary: only
 *  one that was not narrowed to some attributes can say which ones exist. */
export type ExploreAsk = { req: ExploreRequest; definesVocabulary: boolean };

/** 499 is a request superseded server-side: no body, and a newer request owns the page. */
class Superseded extends Error {}

type FacetKey = { per: string; attribute: string };
const facetKey = (c: FacetKey) => c.per + "|" + c.attribute;

export function useExplore(onError: (message: string) => void) {
  const [ask, setAsk] = useState<ExploreAsk | null>(null);
  const req = ask && ask.req.studies.length ? ask.req : null;

  const q = useQuery({
    queryKey: ["explore", req],
    enabled: !!req,
    queryFn: async ({ signal }) => {
      const r = req!;
      const res = await api.explore({
        studies: r.studies, draft: r.draft,
        ...(r.attributes.length ? { attributes: r.attributes } : {}),
        ...(r.geneCharts.length ? { geneCharts: r.geneCharts } : {}),
        ...(r.derived.length ? { derived: r.derived } : {}),
      }, { signal });
      if (res.status === 499) throw new Superseded();
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      return j as ExploreResult;
    },
  });

  useEffect(() => {
    if (q.error && !(q.error instanceof Superseded)) onError(String(q.error.message || q.error));
  }, [q.error]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Clinical attribute order, pinned from the last answer with NO facet selection applied. The
   * server sorts attributes by priority then by coverage WITHIN the current draft (lib/explore.ts)
   * — so two attributes with similar coverage overall can swap places the moment a selection
   * changes who is being counted, and the whole page reshuffles under the reader even though no
   * number is wrong. This is the reference point that stops that: it only moves when the draft is
   * empty (a real re-scoping — changing studies, or clearing filters), never as a side effect of a
   * click. Keyed by `per|attribute` to match the `data-attr` the DOM uses. Applied whenever the
   * answer shown changes, a cached one included.
   */
  const order = useRef<string[] | null>(null);
  /** the same pinned answer's attributes in that order, with what choosing the default charts reads */
  const vocab = useRef<{ key: string; priority: number; studyCount: number }[]>([]);
  /** facets from the last UNNARROWED answer — the coverage bar is always computed from these */
  const fullAttrs = useRef<{ attribute: string; studyCount: number }[]>([]);
  const arranged = useMemo(() => {
    if (!q.data || !req) return null;
    const j = { ...q.data };
    const noSelection = !req.draft || !Array.isArray(req.draft.all) || !req.draft.all.length;
    if (noSelection) {
      order.current = (j.clinical || []).map(facetKey);
      vocab.current = (j.clinical || []).map((c) => ({ key: facetKey(c), priority: c.priority ?? 0, studyCount: c.studyCount ?? 1 }));
    }
    else if (order.current && j.clinical) {
      const pinned = order.current;
      const rank = (c: FacetKey) => { const i = pinned.indexOf(facetKey(c)); return i === -1 ? pinned.length : i; };
      j.clinical = [...j.clinical].sort((a, b) => rank(a) - rank(b));
    }
    if (ask!.definesVocabulary)
      fullAttrs.current = (j.clinical || []).map((c) => ({ attribute: c.attribute, studyCount: c.studyCount ?? 1 }));
    return j;
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastGood = useRef<ExploreResult | null>(null);
  if (!req) lastGood.current = null;
  else if (arranged) lastGood.current = arranged;

  return {
    /** the facets on screen: the current request's answer, else the last one while it is counted */
    explore: req ? arranged ?? lastGood.current : null,
    /** a request for the current selection is in flight */
    busy: !!req && q.isFetching,
    /** what was last asked for — kept by a caller that wants to come back to it */
    current: ask,
    ask: (req: ExploreRequest, definesVocabulary: boolean) => setAsk({ req, definesVocabulary }),
    /** come back to an earlier request; answered from the cache when it is still held */
    restore: (a: ExploreAsk | null) => setAsk(a),
    /** no studies selected: no facets, and any request in flight is dropped */
    clear: () => setAsk(null),
    fullAttrs,
    vocab,
  };
}
