"use client";
// The saved-work manager's Gene lists tab: the gene queries the reader named, and the ones applied
// lately, as the gene query dialog keeps them — in this browser (app/_genes/gene-lists.ts), so they
// need no sign-in and do not follow the reader to another one. Used from the gene query dialog;
// removed here.
import { Button } from "../_ui/button";
import { useGeneLists, type GeneList } from "../_genes/gene-lists.ts";

const MODE = { oql: "OQL", genes: "genes" } as const;

function Lists({ items, empty, onRemove }: { items: GeneList[]; empty: string; onRemove: (x: GeneList) => void }) {
  if (!items.length) return <p className="note">{empty}</p>;
  return <>{items.map((x) => (
    <div key={x.at + (x.name ?? "")} className="listrow">
      <div className="listrow-head">
        {x.name && <strong>{x.name}</strong>}
        <span className="meta">{MODE[x.mode]} · {new Date(x.at).toLocaleDateString()}</span>
        <span className="spacer" />
        <Button variant="link" size="inline" onClick={() => onRemove(x)}>remove</Button>
      </div>
      <div className="listrow-body"><code className="text-md whitespace-pre-wrap">{x.text}</code></div>
    </div>
  ))}</>;
}

export function GenesPanel() {
  const lists = useGeneLists();
  return (
    <div className="grid2">
      <div className="card m-0">
        <h2>Saved gene lists <span className="plain">— named in the gene query dialog, kept in this browser</span></h2>
        <Lists items={lists.saved} onRemove={(x) => lists.unsave(x.name!)}
          empty="None yet — in the gene query dialog, “Save list…” keeps a query you will reuse." />
      </div>
      <div className="card m-0">
        <h2>Recent <span className="plain">— the last queries applied here</span></h2>
        <Lists items={lists.recent} onRemove={(x) => lists.forget(x.at)} empty="Queries you apply are kept here, in this browser." />
      </div>
    </div>
  );
}
