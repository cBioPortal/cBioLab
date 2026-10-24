"use client";
// What saving a new version of an upload would change, against the version it replaces
// (lib/custom-data-diff.ts), shown before the save and confirmed when it loses anything: removed
// cases or columns, changed or cleared values, a changed type. Additions alone need no tick.
import { Download } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { cn } from "../../lib/cn";
import { diffSentences, diffToTsv, typeLabel, type DatasetDiff } from "../../lib/custom-data-diff.ts";
import type { CustomLevel } from "../../lib/custom-data-names.ts";

const fmt = (n: number) => n.toLocaleString("en-US");
const SHOWN = 5;

function Ids({ ids, more }: { ids: string[]; more: number }) {
  return <>{ids.slice(0, SHOWN).map((x, i) => <span key={x}>{i ? ", " : ""}<code>{x}</code></span>)}{more > SHOWN && <> and {fmt(more - SHOWN)} more</>}</>;
}

/** a value as it reads in the table: an empty one says so rather than showing nothing */
function Cell({ v }: { v: string }) {
  return v === "" ? <span className="text-muted-foreground italic">empty</span> : <code>{v}</code>;
}

export function DatasetDiffView({ diff, level, version, name, confirmed, onConfirm }: {
  diff: DatasetDiff; level: CustomLevel; version: number; name: string; confirmed: boolean; onConfirm: (v: boolean) => void;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([diffToTsv(diff)], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = name.replace(/[^\w.-]+/g, "_") + "-changes-from-v" + version + ".tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (diff.same) return (
    <div data-tw className="cd-diff grid gap-1.5 rounded-md border border-border bg-muted/40 p-2.5 text-md">
      <b>No changes from v{version}.</b>
      <span className="meta">The data is identical to the saved version (numbers compared as numbers, rows in any order), so there is nothing to save.</span>
    </div>
  );
  const sentences = diffSentences(diff, level);
  const changedValues = diff.values.reduce((n, v) => n + v.changed + v.filled + v.cleared, 0);
  return (
    <div data-tw className={cn("cd-diff grid gap-2.5 rounded-md border p-2.5 text-md", diff.losesData ? "border-destructive/40" : "border-border")}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <b>Changes from v{version}</b>
        <span className="meta">
          {fmt(diff.cases.before)} → {fmt(diff.cases.after)} {level}s · {fmt(diff.cases.kept)} in both
          {" · "}{fmt(changedValues)} value{changedValues === 1 ? "" : "s"} differ
        </span>
        <Button variant="link" size="inline" className="ml-auto text-md" onClick={download}
          title="every change, one per line: cases, columns, then values with before and after"><Download className="size-3.5" />download every change</Button>
      </div>
      <ul className="cd-diff-list m-0 grid gap-0.5 pl-5">
        {sentences.map((s) => <li key={s}>{s}</li>)}
      </ul>
      {diff.cases.removed.length > 0 && <p className="m-0 text-destructive">
        Removed: <Ids ids={diff.cases.removed} more={diff.cases.removed.length} />.</p>}
      {diff.cases.added.length > 0 && <p className="m-0 meta">
        Added: <Ids ids={diff.cases.added} more={diff.cases.added.length} />.</p>}
      {diff.columns.removed.length > 0 && <p className="m-0 text-destructive">
        Removing {diff.columns.removed.map((c) => c.name).join(", ")} drops {diff.columns.removed.length === 1 ? "that attribute" : "those attributes"}:
        analyses pinned to v{version} keep reading it, but Explore and new analyses use the new version and will not find {diff.columns.removed.length === 1 ? "it" : "them"}.</p>}
      {diff.values.length > 0 && <div className="attrtablewrap" style={{ maxHeight: "30vh" }}>
        <table className="attrtable">
          <thead><tr><th>Column</th><th>Changed</th><th>Cleared</th><th>Filled in</th><th>For example</th></tr></thead>
          <tbody>
            {diff.values.map((v) => (
              <tr key={v.column} style={{ cursor: "default" }}>
                <td><code>{v.column}</code>{diff.columns.retyped.some((r) => r.name === v.column) && <span className="meta"> (now {typeLabel(diff.columns.retyped.find((r) => r.name === v.column)!.to)})</span>}</td>
                <td className={cn("meta", v.changed && "text-destructive")}>{fmt(v.changed)}</td>
                <td className={cn("meta", v.cleared && "text-destructive")}>{fmt(v.cleared)}</td>
                <td className="meta">{fmt(v.filled)}</td>
                <td className="meta">{v.examples.slice(0, 3).map((e, i) => <span key={e.id} className="whitespace-nowrap">{i ? "; " : ""}<code>{e.id}</code> <Cell v={e.from} /> → <Cell v={e.to} /></span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {diff.losesData && <label className="chk flex items-center gap-1.5">
        <Checkbox checked={confirmed} onCheckedChange={(v) => onConfirm(v === true)} aria-label="confirm these changes" />
        <span>I have checked these changes, including what they remove or overwrite.</span>
      </label>}
    </div>
  );
}
