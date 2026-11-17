"use client";
// The Explore page's study header, as cBioPortal's study view writes it
// (docs/legacy-spec/parity/study-header-cases.md): the study's name (or "Combined Study"), its
// description's first line with a PubMed link, and ⊕ for the rest of it or the list of studies.
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../_ui/button.tsx";
import { useStudyCatalog } from "./use-catalogs.ts";
import { studyHeaderText, type DescPart, type StudyAbout } from "../../lib/study-view-header.ts";

function Parts({ parts }: { parts: DescPart[] }) {
  return <>{parts.map((p, i) => "href" in p
    ? <a key={i} href={p.href} target="_blank" rel="noreferrer">{p.text}</a>
    : <span key={i}>{p.text}</span>)}</>;
}

/** `studies`: the selected studies' ids and names, as the study list has them */
export function StudyHeader({ studies }: { studies: { id: string; name: string }[] }) {
  const one = studies.length === 1 ? studies[0].id : "";
  const { cat: held } = useStudyCatalog(one, !!one);
  // the catalog keeps the previous study's while the next one loads; only this study's is read
  const cat = held?.study === one ? held : null;
  const [open, setOpen] = useState(false);
  if (!studies.length) return null;
  const loading = !!one && !cat;
  const about: StudyAbout[] = studies.length === 1
    ? [{ id: studies[0].id, name: cat?.about?.name || studies[0].name, description: cat?.about?.description || "", pmid: cat?.about?.pmid ?? null }]
    : studies.map((s) => ({ id: s.id, name: s.name, description: "", pmid: null }));
  const h = studyHeaderText(about);
  return (
    <div className="studyheader mt-2" data-study-header>
      <h3 className="flush">{h.title}</h3>
      <p className="note flush">
        {loading && <span className="spinner" role="status" data-tip="reading the study's description" />}
        <Parts parts={h.first} />
        {h.pubmed && <a className="ml-1.5" href={h.pubmed} target="_blank" rel="noreferrer">PubMed</a>}
        {h.more && <Button variant="ghost" size="icon-xs" className="ml-1 align-middle" aria-expanded={open}
          aria-label={open ? "show less" : "show more"} data-tip={open ? "show less" : "show more"} onClick={() => setOpen(!open)}>
          {open ? <Minus /> : <Plus />}</Button>}
      </p>
      {open && h.more && ("lines" in h.more
        ? <p className="note flush whitespace-pre-wrap"><Parts parts={h.more.lines} /></p>
        : <ul className="note flush">{h.more.studies.map((s) => <li key={s.id}>
            <a href={"/lab?" + new URLSearchParams({ tab: "explore", study: s.id }).toString()} target="_blank" rel="noreferrer">{s.name}</a></li>)}</ul>)}
    </div>
  );
}
