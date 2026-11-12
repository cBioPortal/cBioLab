"use client";
// The top of the portal's GeneSummary beside a lollipop: the transcript drop-down and the transcript's
// ids as links (RefSeq | Ensembl, CCDS | UniProt). Mutations are annotated on the canonical
// transcript (Genome Nexus, MSKCC isoform overrides; lib/lollipop.ts), so it is the drop-down's one
// entry and the control says why it offers no other.
import React from "react";
import { ChevronDown } from "lucide-react";
import type { HotspotGene } from "../../lib/views/hotspots/types.ts";

type Ids = NonNullable<HotspotGene["ids"]>;

export function TranscriptSummary({ ids, gene }: { ids: Ids | undefined; gene: string }) {
  const t = ids || {};
  const link = (text: string | undefined, href: string) => text ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : <span>-</span>;
  const shownId = t.refseq || t.ensembl || "";
  return (
    <>
      <span className="lp-transcript" data-tip={"the canonical transcript of " + gene + " (Genome Nexus, MSKCC isoform); mutations are annotated on it only, so no other transcript can be chosen"}>
        <select aria-label={"transcript of " + gene} disabled value={shownId}>
          <option value={shownId}>{shownId || "no transcript"}</option>
        </select>
        <ChevronDown aria-hidden="true" />
      </span>
      <div className="lp-summary">
        <div>{link(t.refseq, "https://www.ncbi.nlm.nih.gov/nuccore/" + (t.refseq || ""))} | {link(t.ensembl, "https://grch37.ensembl.org/homo_sapiens/Transcript/Summary?t=" + (t.ensembl || "").replace(/\.\d+$/, ""))}</div>
        <div>{link(t.ccds, "https://www.ncbi.nlm.nih.gov/CCDS/CcdsBrowse.cgi?REQUEST=CCDS&DATA=" + (t.ccds || ""))} | {link(t.uniprotName || t.uniprotAccession, "https://www.uniprot.org/uniprot/" + (t.uniprotAccession || ""))}</div>
      </div>
    </>
  );
}
