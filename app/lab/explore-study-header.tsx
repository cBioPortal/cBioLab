"use client";
// The Explore page's study header, as cBioPortal's study view writes it
// (docs/legacy-spec/parity/study-header-cases.md): the study's name (or "Combined Study"), its
// description's first line with a PubMed link, and ⊕ for the rest of it or the list of studies.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { Button } from "../_ui/button.tsx";
import { api } from "./api.ts";
import { exploreHref } from "../_home/query-flow.tsx";
import { studyHeaderText, type DescPart, type StudyAbout } from "../../lib/study-view-header.ts";

function Parts({ parts }: { parts: DescPart[] }) {
  return <>{parts.map((p, i) => "href" in p
    ? <a key={i} href={p.href} target="_blank" rel="noreferrer">{p.text}</a>
    : <span key={i}>{p.text}</span>)}</>;
}

type About = { name: string; description: string; pmid: string | null } | null;

/** `studies`: the selected studies' ids and names, as the study list has them */
export function StudyHeader({ studies }: { studies: { id: string; name: string }[] }) {
  const one = studies.length === 1 ? studies[0].id : "";
  // keyed on the study and kept only for it: a switch never shows the previous study's words
  const q = useQuery({
    queryKey: ["study-about", one],
    enabled: !!one,
    queryFn: async ({ signal }) => {
      const j = await (await api.studyAbout(one, { signal })).json();
      if (j.error) throw new Error(j.error);
      return j.about as About;
    },
  });
  // ⊕ opens for this selection only
  const selection = studies.map((s) => s.id).join(",");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === selection;
  if (!studies.length) return null;
  const about = q.data;
  const rows: StudyAbout[] = studies.length === 1
    ? [{ id: studies[0].id, name: about?.name || studies[0].name, description: about?.description || "", pmid: about?.pmid ?? null }]
    : studies.map((s) => ({ id: s.id, name: s.name, description: "", pmid: null }));
  const h = studyHeaderText(rows);
  return (
    <div className="studyheader mt-2" data-study-header>
      <h3 className="flush">{h.title}</h3>
      <p className="note flush">
        {one && q.isPending && <span className="spinner" role="status" data-tip="reading the study's description" />}
        {one && q.isError && <span>The study's description could not be read: {String((q.error as Error)?.message || q.error)}</span>}
        <Parts parts={h.first} />
        {h.pubmed && <a className="ml-1.5" href={h.pubmed} target="_blank" rel="noreferrer">PubMed</a>}
        {h.more && <Button variant="ghost" size="icon-xs" className="ml-1 align-middle" aria-expanded={open}
          aria-label={open ? "show less" : "show more"} data-tip={open ? "show less" : "show more"} onClick={() => setOpenFor(open ? null : selection)}>
          {open ? <Minus /> : <Plus />}</Button>}
      </p>
      {open && h.more && ("lines" in h.more
        ? <p className="note flush whitespace-pre-wrap"><Parts parts={h.more.lines} /></p>
        : <ul className="note flush">{h.more.studies.map((s) => <li key={s.id}>
            <a href={exploreHref([s.id])} target="_blank" rel="noreferrer">{s.name}</a></li>)}</ul>)}
    </div>
  );
}
