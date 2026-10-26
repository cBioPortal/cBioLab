"use client";
// What saving a new version of an upload would change, against the version it replaces
// (lib/custom-data-diff.ts): the column changes, then every case that changes as a row of the table —
// removed rows struck through, added rows marked, and in kept rows each changed cell as old → new.
// The confirmation and the save belong to the caller, beside its save button.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "../_ui/button";
import { cn } from "../../lib/cn";
import { caseKey, diffToTsv, typeLabel, type DatasetDiff } from "../../lib/custom-data-diff.ts";
import type { CustomDataset } from "../../lib/custom-data-names.ts";

type Side = Pick<CustomDataset, "name" | "level" | "columns" | "rows">;
type Kind = "removed" | "added" | "changed";

const fmt = (n: number) => n.toLocaleString("en-US");
const PAGE = 50;

/** the counts a summary leads with, for a footer or a heading */
export function diffCounts(d: DatasetDiff) {
  const values = d.values.reduce((n, v) => n + v.changed + v.filled + v.cleared, 0);
  const columns = d.columns.added.length + d.columns.removed.length + d.columns.retyped.length;
  return { removed: d.cases.removed.length, added: d.cases.added.length, values, columns, renamed: !!d.name };
}

/** "1 patient removed · 2 values changed · 1 column added", or "" when nothing differs */
export function diffLine(d: DatasetDiff, level: string): string {
  const p = (n: number, w: string) => fmt(n) + " " + w + (n === 1 ? "" : "s");
  return [
    d.cases.removed.length && p(d.cases.removed.length, level) + " removed",
    d.cases.added.length && p(d.cases.added.length, level) + " added",
    diffCounts(d).values && p(diffCounts(d).values, "value") + " changed",
    d.columns.removed.length && p(d.columns.removed.length, "column") + " removed",
    d.columns.added.length && p(d.columns.added.length, "column") + " added",
    d.columns.retyped.length && p(d.columns.retyped.length, "column") + " retyped",
    d.name && "renamed"
  ].filter(Boolean).join(" · ");
}

function Stat({ n, label, tone, active, onClick }: { n: number; label: string; tone: "bad" | "good" | "neutral"; active: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick || !n} aria-pressed={active}
      className={cn("grid min-w-28 justify-items-start rounded-md border px-3 py-1.5 text-left transition-colors enabled:hover:bg-accent disabled:cursor-default",
        active ? "border-primary bg-accent" : "border-border bg-card", !n && "opacity-50")}>
      <span className={cn("text-xl font-semibold tabular-nums", n && tone === "bad" && "text-destructive", n && tone === "good" && "text-ok")}>
        {tone === "bad" && n ? "−" : tone === "good" && n ? "+" : ""}{fmt(n)}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </button>
  );
}

function Old({ v }: { v: string }) {
  return v === "" ? <span className="italic text-muted-foreground">empty</span>
    : <del className="rounded-sm bg-destructive-soft px-1 text-destructive decoration-destructive/60">{v}</del>;
}
function New({ v }: { v: string }) {
  return v === "" ? <span className="italic text-muted-foreground">empty</span>
    : <ins className="rounded-sm bg-ok-soft px-1 text-ok no-underline">{v}</ins>;
}

export function DatasetDiffView({ diff, before, after, version }: { diff: DatasetDiff; before: Side; after: Side; version: number }) {
  const [only, setOnly] = useState<Kind | null>(null);
  const [shown, setShown] = useState(PAGE);
  const level = after.level;
  const c = diffCounts(diff);

  const removedCols = new Set(diff.columns.removed.map((x) => x.name));
  const addedCols = new Set(diff.columns.added.map((x) => x.name));
  const retyped = new Map(diff.columns.retyped.map((x) => [x.name, x]));
  const cols = [...after.columns.map((x) => x.name), ...diff.columns.removed.map((x) => x.name)];

  const rows = useMemo(() => {
    const oldBy = new Map(before.rows.map((r) => [caseKey(before.level, r), r]));
    const newBy = new Map(after.rows.map((r) => [caseKey(after.level, r), r]));
    const oldIdx = new Map(before.columns.map((x, i) => [x.name, i]));
    const newIdx = new Map(after.columns.map((x, i) => [x.name, i]));
    const changes = new Map<string, Set<string>>();
    for (const ch of diff.all) (changes.get(ch.id) ?? changes.set(ch.id, new Set()).get(ch.id)!).add(ch.column);
    const read = (r: CustomDataset["rows"][number] | undefined, idx: Map<string, number>, col: string) => {
      const i = idx.get(col);
      return r && i !== undefined ? r.values[i] ?? "" : "";
    };
    const out: { key: string; kind: Kind; cells: { from: string; to: string; changed: boolean }[] }[] = [];
    const push = (key: string, kind: Kind) => {
      const o = oldBy.get(key), n = newBy.get(key), ch = changes.get(key);
      out.push({ key, kind, cells: cols.map((col) => ({ from: read(o, oldIdx, col), to: read(n, newIdx, col), changed: !!ch?.has(col) })) });
    };
    for (const k of diff.cases.removed) push(k, "removed");
    for (const k of changes.keys()) push(k, "changed");
    for (const k of diff.cases.added) push(k, "added");
    return out;
  }, [before, after, diff, cols.join("\t")]); // eslint-disable-line react-hooks/exhaustive-deps -- cols is derived from after and diff

  const valuesIn = (col: string, side: Side) => {
    const i = side.columns.findIndex((x) => x.name === col);
    return side.rows.reduce((n, r) => n + (r.values[i] ? 1 : 0), 0);
  };
  const list = only ? rows.filter((r) => r.kind === only) : rows;
  const toggle = (k: Kind) => { setOnly((o) => o === k ? null : k); setShown(PAGE); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([diffToTsv(diff)], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = after.name.replace(/[^\w.-]+/g, "_") + "-changes-from-v" + version + ".tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (diff.same) return (
    <div data-tw className="cd-diff grid place-items-center gap-1 rounded-md border border-dashed border-border p-9 text-center">
      <b>No changes from v{version}</b>
      <span className="text-sm text-muted-foreground">Numbers are compared as numbers and rows in any order, so this is the saved data as it stands.</span>
    </div>
  );

  return (
    <div data-tw className="cd-diff grid min-h-0 gap-4">
      <div className="flex flex-wrap items-stretch gap-2.5">
        {c.removed > 0 && <Stat n={c.removed} label={level + "s removed"} tone="bad" active={only === "removed"} onClick={() => toggle("removed")} />}
        <Stat n={rows.filter((r) => r.kind === "changed").length} label={level + "s with changed values"} tone="neutral" active={only === "changed"} onClick={() => toggle("changed")} />
        <Stat n={c.added} label={level + "s added"} tone="good" active={only === "added"} onClick={() => toggle("added")} />
        <div className="ml-auto grid content-end justify-items-end gap-1 text-sm text-muted-foreground">
          <span>{fmt(diff.cases.before)} → {fmt(diff.cases.after)} {level}s · {fmt(c.values)} value{c.values === 1 ? "" : "s"} differ</span>
          <Button variant="link" size="inline" className="text-sm" onClick={download}
            title="every change, one per line: cases, columns, then values with before and after"><Download className="size-3.5" />download every change (.tsv)</Button>
        </div>
      </div>

      {(c.columns > 0 || diff.name) && <ul className="cd-diff-cols m-0 grid list-none gap-1 p-0 text-md">
        {diff.name && <li>Renamed <Old v={diff.name.from} /> → <New v={diff.name.to} /></li>}
        {diff.columns.removed.map((x) => <li key={x.name} className="text-destructive">
          <b>Column removed:</b> <code>{x.name}</code> and its {fmt(valuesIn(x.name, before))} value{valuesIn(x.name, before) === 1 ? "" : "s"}. Analyses pinned to v{version} keep reading it; Explore and new analyses will not find it.</li>)}
        {diff.columns.added.map((x) => <li key={x.name}>
          <b className="text-ok">Column added:</b> <code>{x.name}</code>, {typeLabel(x.datatype)}, {fmt(valuesIn(x.name, after))} of {fmt(after.rows.length)} {level}s have a value.</li>)}
        {diff.columns.retyped.map((x) => <li key={x.name}>
          <b>Type changes:</b> <code>{x.name}</code> {typeLabel(x.from)} → {typeLabel(x.to)}: its charts and filters change{x.to === "STRING" ? " from ranges to categories" : " from categories to ranges"}.</li>)}
      </ul>}

      {rows.length > 0 && <div className="cd-diff-rows min-h-0 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-md">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="w-8 border-b border-border px-2 py-1.5" aria-label="change" />
              <th className="border-b border-border px-2 py-1.5 text-left font-semibold">{level === "sample" ? "SAMPLE_ID" : "PATIENT_ID"}</th>
              {cols.map((col) => <th key={col} className={cn("border-b border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap",
                removedCols.has(col) && "text-destructive line-through", addedCols.has(col) && "text-ok")}>
                {addedCols.has(col) && "+ "}{col}
                {retyped.has(col) && <span className="ml-1 text-sm font-normal text-muted-foreground">→ {typeLabel(retyped.get(col)!.to)}</span>}
              </th>)}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((r) => (
              <tr key={r.key} className={cn("cd-diff-row border-b border-border/60 last:border-0",
                r.kind === "removed" && "bg-destructive/5", r.kind === "added" && "bg-ok-soft/50")} data-kind={r.kind}>
                <td className={cn("px-2 py-1 text-center font-mono font-semibold", r.kind === "removed" ? "text-destructive" : r.kind === "added" ? "text-ok" : "text-mark")}
                  title={r.kind === "removed" ? "removed" : r.kind === "added" ? "added" : "values changed"}>
                  {r.kind === "removed" ? "−" : r.kind === "added" ? "+" : "~"}</td>
                <td className={cn("px-2 py-1 font-mono whitespace-nowrap", r.kind === "removed" && "text-destructive line-through")}>{r.key}</td>
                {r.cells.map((cell, i) => {
                  const col = cols[i];
                  return <td key={col} className="px-2 py-1 whitespace-nowrap">
                    {r.kind === "removed" ? <span className="text-muted-foreground line-through">{cell.from}</span>
                      : r.kind === "added" ? cell.to
                      : cell.changed ? <span className="inline-flex items-center gap-1"><Old v={cell.from} /><span className="text-muted-foreground">→</span><New v={cell.to} /></span>
                      : removedCols.has(col) ? <span className="text-muted-foreground line-through">{cell.from}</span>
                      : addedCols.has(col) ? cell.to
                      : <span className="text-muted-foreground">{cell.to}</span>}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > shown && <div className="flex items-center gap-2.5 border-t border-border bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground">
          Showing {fmt(shown)} of {fmt(list.length)} changed {level}s.
          <Button variant="link" size="inline" className="text-sm" onClick={() => setShown((n) => n + PAGE * 4)}>show more</Button>
          <Button variant="link" size="inline" className="text-sm" onClick={() => setShown(list.length)}>show all</Button>
        </div>}
      </div>}
      {!rows.length && <p className="m-0 text-sm text-muted-foreground">No {level} is added, removed or has a value changed: only the columns above change.</p>}
    </div>
  );
}
