"use client";
// The single-cell review page's steps (app/singlecell/page.tsx): each says what it decides and why
// that matters, shows the evidence, and edits the config through the page's hook.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Download, FileUp, Play, Plus, Save, X } from "lucide-react";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { Textarea } from "../_ui/textarea";
import { Checkbox } from "../_ui/checkbox";
import { OptionSelect } from "../_ui/choice.tsx";
import { CHIP, TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { api } from "../lab/api.ts";
import { ViewFigure } from "../lab/figure.tsx";
import { useCustomDataState } from "../lab/custom-data-panel.tsx";
import { requestLogin, saveToServer } from "../lab/custom-data-client.ts";
import { CELL_EXPLORER_DATASETS } from "../../lib/cell-explorer.ts";
import { colName, datasetTsv, MAX_LABEL_VALUES, type SingleCellConfig, type SingleCellSource } from "../../lib/singlecell/summary.ts";
import type { ObsColumn } from "../../lib/singlecell/zarr.ts";
import type { Crosswalk } from "../../lib/singlecell-server.ts";
import type { SingleCellState } from "./use-singlecell.ts";
import type { ViewResult } from "../../lib/types.ts";

const META = "text-sm text-muted-foreground";
const fmt = (n: number) => n.toLocaleString("en-US");

function download(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One numbered step: what it decides, why that matters (folded), and its controls. */
function Step({ n, title, lead, why, children }: { n: number; title: string; lead: React.ReactNode; why: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-9 rounded-lg border border-border p-6" aria-labelledby={"step-" + n}>
      <h2 id={"step-" + n} className="m-0 flex items-baseline gap-2.5 text-xl font-semibold">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground">{n}</span>{title}
      </h2>
      <p className="mt-2.5 mb-0">{lead}</p>
      <details className="mt-1.5">
        <summary className={cn(META, "cursor-pointer")}>why this matters</summary>
        <div className={cn(META, "mt-1.5 max-w-[46rem]")}>{why}</div>
      </details>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** how much of something matched: a bar and its numbers */
function Coverage({ matched, of, label, extra }: { matched: number; of: number; label: string; extra?: string }) {
  const pct = of ? Math.round((100 * matched) / of) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-2.5 w-48 overflow-hidden rounded-full bg-muted" role="img" aria-label={pct + "% matched"}>
        <div className={cn("h-full", pct >= 80 ? "bg-primary" : pct >= 30 ? "bg-primary/45" : "bg-destructive")} style={{ width: Math.max(pct, matched ? 2 : 0) + "%" }} />
      </div>
      <span><strong>{fmt(matched)}</strong> of {fmt(of)} {label}{extra ? <span className={META}> · {extra}</span> : null}</span>
    </div>
  );
}

// ---- start ------------------------------------------------------------------------------------

/** the dataset–study pairs this deployment already links, as one-click starts */
const KNOWN: { slug: string; study: string; label: string }[] = [
  ...CELL_EXPLORER_DATASETS.map((d) => ({ slug: d.dataset, study: d.study, label: d.label.replace(/ \(.*\)$/, "") })),
  { slug: "htan-vumc-crc-discovery-dis-set-of-human-colorectal-tumor-epithelial", study: "crc_hta11_htan_2021", label: "HTAN Vanderbilt colorectal polyps, epithelial cells (discovery set)" },
];

export function StartPanel({ sc, studies }: { sc: SingleCellState; studies: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [slug, setSlug] = useState("");
  const [study, setStudy] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const list = useMemo(() => (sc.catalog || []).filter((d) => !q.trim() || (d.name + " " + d.slug + " " + (d.collection?.name || "")).toLowerCase().includes(q.trim().toLowerCase())), [sc.catalog, q]);
  const picked = sc.catalog?.find((d) => d.slug === slug);
  const donors = picked?.columns.find((c) => c.name === "donor_id")?.cardinality;
  if (sc.cfg) return (
    <div className="mt-6 flex flex-wrap items-center gap-2.5 rounded-lg bg-muted px-4 py-2.5">
      <span>Reviewing <strong>{sc.cfg.name}</strong> for <code>{sc.cfg.study}</code> · {sc.cfg.sources.length} source{sc.cfg.sources.length === 1 ? "" : "s"}</span>
      <span className="flex-1" />
      <Button variant="outline" size="sm" className={TB} onClick={() => location.reload()}><X />start over</Button>
    </div>
  );
  return (
    <section className="mt-6 rounded-lg border border-border p-6" aria-label="choose a dataset and a study">
      <h2 className="m-0 text-xl font-semibold">Choose a dataset and the study its donors belong to</h2>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className={cn(META, "mr-1")}>already linked:</span>
        {KNOWN.map((k) => (
          <Button key={k.slug} variant="outline" size="sm" className={TB} disabled={!sc.catalog || !!sc.busy}
            onClick={() => sc.start(k.slug, k.study)} title={k.slug + " → " + k.study}>{k.label}</Button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <label className="font-semibold" htmlFor="sc-q">Cell Explorer dataset</label>
          <Input id="sc-q" className="mt-1.5" placeholder={sc.catalog ? "search " + sc.catalog.length + " datasets…" : "loading the catalog…"} value={q} onChange={(e) => setQ(e.target.value)} />
          {sc.catalogErr && <p className="error">The catalog could not be read: {sc.catalogErr}</p>}
          <ul className="mt-1.5 max-h-72 overflow-y-auto rounded-md border border-border" aria-label="datasets">
            {!sc.catalog && !sc.catalogErr && <li className={cn(META, "p-2.5")}><span className="spinner" /> loading the catalog…</li>}
            {sc.catalog && !list.length && <li className={cn(META, "p-2.5")}>no dataset matches “{q}”</li>}
            {list.map((d) => (
              <li key={d.slug}>
                <button type="button" onClick={() => setSlug(d.slug)}
                  className={cn("w-full px-2.5 py-1.5 text-left hover:bg-accent", d.slug === slug && "bg-accent")}>
                  <div>{d.name}</div>
                  <div className={META}>{d.cells != null ? fmt(d.cells) + " cells" : "size unknown"} · {d.columns.find((c) => c.name === "donor_id")?.cardinality ?? "?"} donors · {d.collection?.name || d.slug}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <label className="font-semibold" htmlFor="sc-study">cBioPortal study</label>
          <Input id="sc-study" className="mt-1.5" list="sc-studies" placeholder="study id, e.g. crc_hta11_htan_2021" value={study} onChange={(e) => setStudy(e.target.value.trim())} />
          <datalist id="sc-studies">{studies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</datalist>
          {picked && <p className={cn(META, "mt-2.5")}>
            {picked.name}: {picked.cells != null ? fmt(picked.cells) : "?"} cells from {donors ?? "?"} donors, {picked.columns.length} columns of cell metadata.
            The study's patients are matched against its donors in the next step — every id that matches, and every one that does not, is listed.
          </p>}
          <Button className="mt-4" disabled={!slug || !study || !!sc.busy || !sc.catalog} onClick={() => sc.start(slug, study)}><Play />Match and propose</Button>
          <div className="mt-6">
            <Button variant="link" size="inline" onClick={() => setPaste(paste == null ? "" : null)}><FileUp />or review a config written earlier</Button>
            {paste != null && <div className="mt-2.5 flex flex-col gap-2.5">
              <Textarea aria-label="config JSON" rows={6} className="font-mono text-sm" value={paste} onChange={(e) => setPaste(e.target.value)}
                placeholder='{"study": "…", "sources": [{"zarr": "…"}], …} — e.g. scripts/singlecell/crc_hta11_htan_2021.json' />
              <div className="flex gap-2.5">
                <Input type="file" accept=".json,application/json" aria-label="config file" className="w-auto"
                  onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPaste(await f.text()); }} />
                <Button variant="outline" size="sm" className={TB} disabled={!paste?.trim() || !sc.catalog || !!sc.busy} onClick={() => sc.load(paste!)}>Review it</Button>
              </div>
            </div>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- 1. who is who ---------------------------------------------------------------------------

function MappingSelect({ x, value, onChange, idLabel }: { x: Crosswalk | null; value: string | null; onChange: (v: string | null) => void; idLabel: string }) {
  const opts = [...(x?.candidates || [])];
  if (!opts.some((o) => o.attribute === value)) opts.push({ attribute: value, matched: x?.matched ?? 0 });
  if (!opts.some((o) => o.attribute === null)) opts.push({ attribute: null, matched: 0 });
  return (
    <label className="tbfield">matched as <OptionSelect value={value ?? ""} onValueChange={(v) => onChange(v || null)} ariaLabel={"how " + idLabel + " values are matched"}>
      {opts.map((o) => <option key={o.attribute ?? ""} value={o.attribute ?? ""}>{o.attribute ? "the attribute " + o.attribute : "the " + idLabel + " id itself"} ({o.matched})</option>)}
    </OptionSelect></label>
  );
}

function Unmatched({ x, what }: { x: Crosswalk | null; what: string }) {
  if (!x || !x.unmatched.length) return null;
  return (
    <details className={META}>
      <summary className="cursor-pointer">{fmt(x.values - x.matched)} {what} not matched{x.values - x.matched > x.unmatched.length ? " (the first " + x.unmatched.length + ")" : ""}</summary>
      <p className="mt-1.5 font-mono text-xs break-words">{x.unmatched.join(", ")}</p>
    </details>
  );
}

export function WhoIsWho({ sc, studyName }: { sc: SingleCellState; studyName: string }) {
  const cfg = sc.cfg!, first = sc.sources[0];
  const cats = (first?.entry?.columns || []).filter((c) => c.dtype === "categorical" && !/_ontology_term_id$/.test(c.name));
  const set = (patch: Partial<SingleCellConfig>) => sc.edit({ ...cfg, ...patch }, true);
  return (
    <Step n={1} title="Who is who" lead={<>Every cell names its donor and usually its sample. Here those names are matched to the patients and samples of <strong>{studyName}</strong>.</>}
      why={<>Nothing else works if this is wrong. A donor id that names no patient puts its cells nowhere; a sample matched to the wrong case moves its cells to another
        patient without a trace. The matching tries the study's own ids and every clinical attribute, and picks the one that matches most — check that it is the one
        you expect (often a column such as <code>H5AD_SAMPLE_ID</code> that the study's curators kept for exactly this).</>}>
      <div className="flex flex-col gap-2.5">
        <div className="viewtb"><div className="tbz"><span className="tbl">patient</span>
          <label className="tbfield">column <OptionSelect value={cfg.patient.obs} ariaLabel="patient column" onValueChange={(v) => set({ patient: { obs: v, attribute: null } })}>
            {cats.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.cardinality ?? "?"})</option>)}
          </OptionSelect></label>
          <MappingSelect x={first?.patient ?? null} value={cfg.patient.attribute} idLabel="patient" onChange={(a) => set({ patient: { obs: cfg.patient.obs, attribute: a } })} />
        </div></div>
        {sc.sources.map((s, i) => s.patient && <div key={i} className="flex flex-col gap-1.5">
          {sc.sources.length > 1 && <span className={META}>{cfg.sources[i].prefix}</span>}
          <Coverage matched={s.patient.matched} of={s.patient.values} label="donors are patients of the study" extra={"the study has " + fmt(s.patient.studyCases) + " patients"} />
          <Unmatched x={s.patient} what="donors" />
        </div>)}
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="viewtb"><div className="tbz"><span className="tbl">sample</span>
          <label className="tbfield">column <OptionSelect value={cfg.sample?.obs ?? ""} ariaLabel="sample column"
            onValueChange={(v) => set({ sample: v ? { obs: v, attribute: first?.sampleTried.find((t) => t.obs === v)?.attribute ?? null } : null })}>
            <option value="">none: per patient only</option>
            {cats.filter((c) => c.name !== cfg.patient.obs).map((c) => {
              const t = first?.sampleTried.find((x) => x.obs === c.name);
              return <option key={c.name} value={c.name}>{c.name} ({c.cardinality ?? "?"} values{t ? ", " + t.matched + " matched" : ""})</option>;
            })}
          </OptionSelect></label>
          {cfg.sample && <MappingSelect x={first?.sample ?? null} value={cfg.sample.attribute} idLabel="sample" onChange={(a) => set({ sample: { obs: cfg.sample!.obs, attribute: a } })} />}
        </div></div>
        {cfg.sample ? sc.sources.map((s, i) => s.sample && <div key={i} className="flex flex-col gap-1.5">
          {sc.sources.length > 1 && <span className={META}>{cfg.sources[i].prefix}</span>}
          <Coverage matched={s.sample.matched} of={s.sample.values} label="sample names are samples of the study" extra={"the study has " + fmt(s.sample.studyCases) + " samples"} />
          {s.sample.ambiguous > 0 && <p className="error m-0">{s.sample.ambiguous} names match more than one sample through {s.sample.attribute}; the first is used.</p>}
          <Unmatched x={s.sample} what="sample names" />
          {s.sample.matched < s.sample.values && <p className={cn(META, "m-0")}>A sample the study does not hold (a specimen that was not sequenced in bulk, say) is still counted for its patient; it gets no row of its own.</p>}
        </div>) : <p className={cn(META, "m-0")}>Without a sample column every number is per patient, pooled over all of a patient's samples.</p>}
      </div>
    </Step>
  );
}

// ---- 2. what to summarise ----------------------------------------------------------------------

function useColumn(sc: SingleCellState, src: SingleCellSource, name: string, on: boolean) {
  const [col, setCol] = useState<ObsColumn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    sc.readColumn(src, name).then((c) => { if (live) setCol(c); }).catch((e) => { if (live) setErr(String(e.message || e)); });
    return () => { live = false; };
  }, [on, name, src]); // eslint-disable-line react-hooks/exhaustive-deps -- read once per column of a source
  return { col, err };
}

function ColumnPreview({ sc, src, name }: { sc: SingleCellState; src: SingleCellSource; name: string }) {
  const { col, err } = useColumn(sc, src, name, true);
  if (err) return <p className="error m-0">{err}</p>;
  if (!col) return <p className={cn(META, "m-0")}><span className="spinner" /> reading the column…</p>;
  if (col.kind === "label") {
    const counts = new Map<string, number>(); let none = 0;
    for (const v of col.values) { if (v == null) none++; else counts.set(v, (counts.get(v) || 0) + 1); }
    const top = [...counts].sort((a, b) => b[1] - a[1]);
    const max = top[0]?.[1] || 1, shown = top.slice(0, 12);
    return (
      <div className="flex flex-col gap-1">
        {shown.map(([v, n]) => (
          <div key={v} className="flex items-center gap-2.5 text-sm">
            <span className="w-44 truncate" title={v}>{v}</span>
            <div className="h-2.5 flex-1 rounded-sm bg-muted"><div className="h-full rounded-sm bg-primary" style={{ width: (100 * n / max) + "%" }} /></div>
            <span className="w-24 text-right tabular-nums">{fmt(n)}</span>
          </div>
        ))}
        {(top.length > shown.length || none > 0) && <p className={cn(META, "m-0")}>
          {top.length > shown.length ? (top.length - shown.length) + " more values, " + fmt(top.slice(12).reduce((a, x) => a + x[1], 0)) + " cells" : ""}
          {top.length > shown.length && none ? " · " : ""}{none ? fmt(none) + " cells with no value" : ""}</p>}
      </div>
    );
  }
  const v = Array.from(col.values).filter(Number.isFinite);
  if (!v.length) return <p className={cn(META, "m-0")}>no cell has a number here</p>;
  let lo = Infinity, hi = -Infinity; for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const bins = 24, h = new Array(bins).fill(0);
  for (const x of v) h[Math.min(bins - 1, Math.floor(((x - lo) / (hi - lo || 1)) * bins))]++;
  const top = Math.max(...h);
  return (
    <div>
      <div className="flex h-16 items-end gap-px" role="img" aria-label={"distribution of " + name}>
        {h.map((n, i) => <div key={i} className="flex-1 bg-primary/70" style={{ height: Math.max(1, (100 * n) / top) + "%" }} title={fmt(n) + " cells"} />)}
      </div>
      <div className={cn(META, "flex justify-between")}><span>{lo.toPrecision(3)}</span><span>{fmt(v.length)} cells with a value{col.values.length - v.length ? ", " + fmt(col.values.length - v.length) + " without" : ""}</span><span>{hi.toPrecision(3)}</span></div>
    </div>
  );
}

function ColumnCard({ sc, src, j, use, onUse }: { sc: SingleCellState; src: SingleCellSource; j: SingleCellState["sources"][number]["judged"][number]; use: "label" | "score" | "skip"; onUse: (r: "label" | "score" | "skip") => void }) {
  const [open, setOpen] = useState(false);
  const info = sc.sources.find((s) => s.judged.includes(j))?.entry?.columns.find((c) => c.name === j.name);
  const can: ("label" | "score" | "skip")[] = info?.dtype === "numeric" ? ["score", "skip"] : ["label", "skip"];
  const word = { label: "shares", score: "mean", skip: "not used" };
  return (
    <li className={cn("rounded-md border border-border p-2.5", use !== "skip" && "border-primary/40")}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="ghost" size="sm" className="font-semibold" aria-expanded={open} title={open ? "hide its values" : "show its values"} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn("transition-transform", open && "rotate-90")} />{j.name}
        </Button>
        <span className={META}>{info?.dtype}{info?.cardinality != null ? ", " + info.cardinality + " values" : ""}</span>
        {j.varies === false && <span className="rounded-sm bg-muted px-1.5 text-xs">same in every cell of a sample</span>}
        <span className="flex-1" />
        <div className="flex gap-1" role="group" aria-label={"use of " + j.name}>
          {can.map((r) => <Button key={r} variant="outline" size="xs" className={CHIP} aria-pressed={use === r} onClick={() => onUse(r)}>{word[r]}</Button>)}
        </div>
      </div>
      <p className={cn(META, "m-0 mt-1")}>{j.why}</p>
      {open && <div className="mt-2.5"><ColumnPreview sc={sc} src={src} name={j.name} /></div>}
    </li>
  );
}

export function ColumnsStep({ sc }: { sc: SingleCellState }) {
  const cfg = sc.cfg!;
  const [tab, setTab] = useState(0);
  const [adding, setAdding] = useState("");
  const i = Math.min(tab, cfg.sources.length - 1), src = cfg.sources[i], st = sc.sources[i];
  const collection = st?.entry?.collection?.slug;
  const siblings = (sc.catalog || []).filter((d) => d.collection?.slug && d.collection.slug === collection && !cfg.sources.some((s) => (Array.isArray(s.zarr) ? s.zarr : [s.zarr]).includes(d.url)));
  const setSource = (next: SingleCellSource) => sc.edit({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? next : s)) });
  const roleOf = (name: string): "label" | "score" | "skip" => src.labels.includes(name) ? "label" : src.scores.includes(name) ? "score" : "skip";
  const setRole = (name: string, r: "label" | "score" | "skip") => setSource({ ...src,
    labels: r === "label" ? [...src.labels.filter((x) => x !== name), name] : src.labels.filter((x) => x !== name),
    scores: r === "score" ? [...src.scores.filter((x) => x !== name), name] : src.scores.filter((x) => x !== name) });
  const judged = st?.judged || [];
  const used = judged.filter((j) => roleOf(j.name) !== "skip"), unused = judged.filter((j) => roleOf(j.name) === "skip");
  const [prefix, setPrefix] = useState(src.prefix);
  useEffect(() => setPrefix(src.prefix), [src.prefix]);
  return (
    <Step n={2} title="What to summarise" lead={<>Each kept <strong>label</strong> becomes one column per value — the share of a case's cells with it; each kept <strong>score</strong> one column — its mean over the case's cells.</>}
      why={<>Datasets carry many columns, and most are not worth a column of their own: quality measures, ids, and descriptions of the sample that are the same for every cell
        in it (the site, the treatment) — those are already the study's clinical data. The useful ones are usually the authors' own cell types, states and scores; a
        column's name rarely says which, so open it and look at its values before keeping it.</>}>
      {cfg.sources.length > 1 && <div className="flex flex-wrap gap-1.5" aria-label="sources">
        {cfg.sources.map((s, k) => <Button key={k} variant="outline" size="sm" aria-pressed={k === i} className={CHIP} onClick={() => setTab(k)}>{s.prefix}</Button>)}
      </div>}
      <div className="viewtb"><div className="tbz"><span className="tbl">source</span>
        <span className="tbfield">{st?.entry?.name || (Array.isArray(src.zarr) ? src.zarr.length + " files" : src.zarr)}{Array.isArray(src.zarr) && src.zarr.length > 1 ? " (+" + (src.zarr.length - 1) + " file)" : ""}</span>
        <label className="tbfield" title="starts every column this source writes">prefix <Input className="h-ctl w-24" value={prefix} aria-label="prefix"
          onChange={(e) => setPrefix(e.target.value.toUpperCase())} onBlur={() => { if (prefix !== src.prefix) setSource({ ...src, prefix }); }} /></label>
        {cfg.sources.length > 1 && <Button variant="outline" size="sm" className={TB} onClick={() => { sc.edit({ ...cfg, sources: cfg.sources.filter((_, k) => k !== i) }); setTab(0); }}><X />remove source</Button>}
      </div></div>
      {used.length === 0 && <p className="error m-0">This source keeps no column yet: mark at least one label or score.</p>}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="columns used">
        {used.map((j) => <ColumnCard key={j.name} sc={sc} src={src} j={j} use={roleOf(j.name)} onUse={(r) => setRole(j.name, r)} />)}
      </ul>
      <details>
        <summary className="cursor-pointer">{unused.length} columns not used — open to see why, or to use one</summary>
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0" aria-label="columns not used">
          {unused.map((j) => <ColumnCard key={j.name} sc={sc} src={src} j={j} use="skip" onUse={(r) => setRole(j.name, r)} />)}
        </ul>
      </details>
      {siblings.length > 0 && <div className="viewtb"><div className="tbz"><span className="tbl">more data</span>
        <label className="tbfield">add another dataset of this collection as a source <OptionSelect value={adding} ariaLabel="dataset to add" onValueChange={setAdding}>
          <option value="">choose…</option>{siblings.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
        </OptionSelect></label>
        <Button variant="outline" size="sm" className={TB} disabled={!adding || !!sc.busy} onClick={() => { void sc.addSource(adding); setAdding(""); setTab(cfg.sources.length); }}><Plus />add</Button>
      </div></div>}
    </Step>
  );
}

// ---- 3. which cells ---------------------------------------------------------------------------

function FilterRow({ sc, src, column, keep, onChange, onRemove }: { sc: SingleCellState; src: SingleCellSource; column: string; keep: string[]; onChange: (v: string[]) => void; onRemove: () => void }) {
  const { col } = useColumn(sc, src, column, true);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (col?.kind === "label") for (const v of col.values) if (v != null) m.set(v, (m.get(v) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [col]);
  const kept = counts.filter(([v]) => keep.includes(v)).reduce((a, x) => a + x[1], 0), all = counts.reduce((a, x) => a + x[1], 0);
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center gap-2.5"><strong>{column}</strong><span className={META}>{col ? fmt(kept) + " of " + fmt(all) + " cells kept" : "reading…"}</span>
        <span className="flex-1" /><Button variant="ghost" size="xs" onClick={onRemove}><X />remove filter</Button></div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {counts.map(([v, n]) => (
          <label key={v} className="chk"><Checkbox checked={keep.includes(v)} onCheckedChange={(on) => onChange(on === true ? [...keep, v] : keep.filter((x) => x !== v))} />{v} <span className={META}>{fmt(n)}</span></label>
        ))}
      </div>
    </div>
  );
}

export function CellsStep({ sc }: { sc: SingleCellState }) {
  const cfg = sc.cfg!;
  const [pick, setPick] = useState<Record<number, string>>({});
  return (
    <Step n={3} title="Which cells" lead="By default every cell of a case counts. A filter keeps only the cells whose column takes the values you tick — the tumour cells, say, or one compartment."
      why={<>A share is only as meaningful as its denominator. Pooling a patient's normal and tumour samples gives a number that describes neither; so does mixing cells that
        were sorted into separate tubes before sequencing (in MSK SPECTRUM, immune and non-immune cells were sequenced in about equal numbers whatever the tissue held). When
        one column separates the cells you mean, filter on it — or keep it as a label, so each kind gets its own columns.</>}>
      {cfg.sources.map((src, i) => {
        const entry = sc.sources[i]?.entry;
        const options = (entry?.columns || []).filter((c) => c.dtype === "categorical" && c.cardinality != null && c.cardinality >= 2 && c.cardinality <= MAX_LABEL_VALUES && !(c.name in src.where) && !/_ontology_term_id$/.test(c.name));
        const setWhere = (where: Record<string, string[]>) => sc.edit({ ...cfg, sources: cfg.sources.map((s, k) => (k === i ? { ...s, where } : s)) });
        return (
          <div key={i} className="flex flex-col gap-2.5">
            {cfg.sources.length > 1 && <strong>{src.prefix}</strong>}
            {Object.entries(src.where).map(([c, keep]) => (
              <FilterRow key={c} sc={sc} src={src} column={c} keep={keep} onChange={(v) => setWhere({ ...src.where, [c]: v })}
                onRemove={() => { const w = { ...src.where }; delete w[c]; setWhere(w); }} />
            ))}
            {!Object.keys(src.where).length && <p className={cn(META, "m-0")}>No filter: every cell of a matched case counts.</p>}
            <div className="viewtb"><div className="tbz">
              <label className="tbfield">filter on <OptionSelect value={pick[i] || ""} ariaLabel="column to filter on" onValueChange={(v) => setPick({ ...pick, [i]: v })}>
                <option value="">choose a column…</option>{options.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.cardinality})</option>)}
              </OptionSelect></label>
              <Button variant="outline" size="sm" className={TB} disabled={!pick[i]} onClick={async () => {
                const c = await sc.readColumn(src, pick[i]);
                const vals = c.kind === "label" ? [...new Set(c.values.filter((v): v is string => v != null))] : [];
                setWhere({ ...src.where, [pick[i]]: vals }); setPick({ ...pick, [i]: "" });
              }}><Plus />add filter</Button>
            </div></div>
          </div>
        );
      })}
    </Step>
  );
}

// ---- 4. minimums and names ----------------------------------------------------------------------

function NumberField({ label, value, onCommit, min = 1, title }: { label: string; value: number; onCommit: (v: number) => void; min?: number; title: string }) {
  const [d, setD] = useState(String(value));
  useEffect(() => setD(String(value)), [value]);
  return <label className="tbfield" title={title}>{label} <Input type="number" min={min} className="h-ctl w-24" value={d} aria-label={label}
    onChange={(e) => setD(e.target.value)} onBlur={() => { const n = Math.floor(Number(d)); if (n >= min && n !== value) onCommit(n); else setD(String(value)); }} /></label>;
}
function TextField({ label, value, onCommit, width, title }: { label: string; value: string; onCommit: (v: string) => void; width: string; title: string }) {
  const [d, setD] = useState(value);
  useEffect(() => setD(value), [value]);
  return <label className="tbfield" title={title}>{label} <Input className="h-ctl" style={{ width }} value={d} aria-label={label}
    onChange={(e) => setD(e.target.value)} onBlur={() => { if (d.trim() && d !== value) onCommit(d.trim()); }} /></label>;
}

export function MinimumsStep({ sc }: { sc: SingleCellState }) {
  const cfg = sc.cfg!;
  return (
    <Step n={4} title="Minimums and names" lead="A share needs enough cells under it to mean something; below the minimum the value is left blank rather than guessed."
      why={<>With 8 cells, one cell is 12.5% — a share that moves by chance more than any biology you would look for. The minimum is a trade: higher keeps the numbers
        steady and blanks more cases. Blanks are counted in the preview, so you can see what a change costs. The names are what the lab and its documents will call the data.</>}>
      <div className="viewtb"><div className="tbz"><span className="tbl">minimums</span>
        <NumberField label="cells for a share" value={cfg.minCells} title="a case with fewer cells (after any filter) gets no shares" onCommit={(v) => sc.edit({ ...cfg, minCells: v })} />
        <NumberField label="cells for a mean" value={cfg.minScoreCells} title="a case with fewer cells carrying the score gets no mean" onCommit={(v) => sc.edit({ ...cfg, minScoreCells: v })} />
      </div></div>
      <div className="viewtb"><div className="tbz"><span className="tbl">names</span>
        <TextField label="id" value={cfg.id} width="12rem" title="the datasets are <id>-p and <id>-s; lowercase letters, digits and dashes" onCommit={(v) => sc.edit({ ...cfg, id: v })} />
        <TextField label="name" value={cfg.name} width="28rem" title="how the lab names the data" onCommit={(v) => sc.edit({ ...cfg, name: v })} />
      </div></div>
    </Step>
  );
}

// ---- 5. preview and check -----------------------------------------------------------------------

function DatasetTable({ d }: { d: import("../../lib/custom-data-names.ts").CustomDataset }) {
  const rows = d.rows.slice(0, 12);
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border">
      <table className="text-sm tabular-nums">
        <thead className="sticky top-0 bg-muted"><tr>
          <th className="sticky left-0 bg-muted px-2.5 py-1 text-left">{d.level}</th>
          {d.columns.map((c) => <th key={c.name} className="px-2.5 py-1 text-right font-normal whitespace-nowrap" title={c.name}>{c.name}</th>)}
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.sample || r.patient} className="border-t border-border">
            <td className="sticky left-0 bg-background px-2.5 py-1 font-mono text-xs">{r.sample || r.patient}</td>
            {r.values.map((v, k) => <td key={k} className={cn("px-2.5 py-1 text-right", !v && "text-muted-foreground")} title={v ? undefined : "blank: below the minimum"}>{v || "·"}</td>)}
          </tr>
        ))}</tbody>
      </table>
      {d.rows.length > rows.length && <p className={cn(META, "m-0 px-2.5 py-1")}>and {d.rows.length - rows.length} more rows</p>}
    </div>
  );
}

function CompositionPreview({ sc }: { sc: SingleCellState }) {
  const cfg = sc.cfg!, p = sc.preview!;
  const choices = cfg.sources.flatMap((s, si) => s.labels.map((l) => {
    const pre = s.prefix + "_" + colName(l) + "_";
    return { key: si + ":" + l, label: s.prefix + " · " + l, pre, sample: p.parts[si]?.columns.sample.filter((c) => c.startsWith(pre)) || [], patient: p.parts[si]?.columns.patient.filter((c) => c.startsWith(pre)) || [] };
  })).filter((c) => c.patient.length >= 2 && c.patient.length <= 16);
  const [key, setKey] = useState(choices[0]?.key || "");
  const [level, setLevel] = useState<"patient" | "sample">("patient");
  const [v, setV] = useState<ViewResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const c = choices.find((x) => x.key === key);
  if (!choices.length) return <p className={cn(META, "m-0")}>No kept label has 2 to 16 values, which a composition chart draws.</p>;
  const draw = async () => {
    if (!c) return;
    setWaiting(true); setErr(null); setV(null);
    try {
      // draft ids, so they cannot collide with a dataset the lab already bundles or stores
      const ds = p.datasets.map((d) => ({ ...d, id: ("draft-" + d.id).slice(0, 40) }));
      const want = level === "sample" ? ds.find((d) => d.level === "sample" && c.sample.some((n) => d.columns.some((x) => x.name === n)))
        : ds.find((d) => d.level === "patient" && c.patient.some((n) => d.columns.some((x) => x.name === n)));
      if (!want) throw new Error("the preview has no " + level + "-level data for this label");
      const parts = (level === "sample" ? c.sample : c.patient).filter((n) => want.columns.some((x) => x.name === n));
      const doc = { study: cfg.study, cohorts: { "all patients": { all: [] } },
        views: [{ kind: "composition", cohorts: ["all patients"], ...(level === "sample" ? { unit: "sample" } : {}), attributes: parts.map((n) => "custom:" + want.id + "/" + n) }],
        customData: [want] };
      const j = await (await api.analysis(doc as never)).json();
      if (j.error) throw new Error(j.error);
      if (j.views?.[0]?.error) throw new Error(j.views[0].error);
      setV(j.views[0]);
    } catch (e) { setErr(String((e as Error)?.message || e)); } finally { setWaiting(false); }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="viewtb"><div className="tbz"><span className="tbl">see it</span>
        <label className="tbfield">label <OptionSelect value={key} ariaLabel="label to draw" onValueChange={setKey}>{choices.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</OptionSelect></label>
        <label className="tbfield">per <OptionSelect value={level} ariaLabel="one bar per" onValueChange={(x) => setLevel(x === "sample" ? "sample" : "patient")}>
          <option value="patient">patient</option>{cfg.sample && <option value="sample">sample</option>}</OptionSelect></label>
        <Button variant="outline" size="sm" className={TB} disabled={waiting} onClick={() => void draw()}>{waiting ? <span className="spinner" /> : <Play />}draw as a composition</Button>
      </div></div>
      {err && <p className="error m-0">{err}</p>}
      {v && <ViewFigure v={v} />}
    </div>
  );
}

export function PreviewStep({ sc }: { sc: SingleCellState }) {
  const p = sc.preview, r = sc.reference;
  return (
    <Step n={5} title="Preview and check" lead="Build the numbers from the cells, look at them, and — where the study already holds cell counts — check them against those."
      why={<>The preview runs the same code the command line does, so what you see is what will be saved. The check is the strongest evidence there is: if the study's
        curators already loaded cell counts, the counts behind these shares should equal them, sample by sample. A difference names the samples and how far off they are.</>}>
      <div className="flex flex-wrap gap-2.5">
        <Button disabled={!!sc.busy} onClick={() => sc.build()}><Play />{p ? "build again" : "build the preview"}</Button>
        {p && <Button variant="outline" className={TB} disabled={!!sc.busy} onClick={() => sc.check()}><Check />check against the study's cell counts</Button>}
      </div>
      {p && <>
        <p className="m-0">{p.datasets.map((d) => <span key={d.id} className="mr-4"><strong>{d.id}</strong>: {d.rows.length} {d.level}s × {d.columns.length} columns</span>)}</p>
        <p className={cn(META, "m-0")}>
          {p.cells.map((c) => c.prefix + ": " + fmt(c.read) + " cells read" + (c.kept < c.read ? ", " + fmt(c.kept) + " kept by the filters" : "") + ", " + fmt(c.patient) + " matched a patient" + (sc.cfg!.sample ? ", " + fmt(c.sample) + " a sample" : "")).join(" · ")}
          {" · "}{fmt(p.blanks)} of {fmt(p.values)} values blank (below a minimum)
        </p>
        {p.datasets.map((d) => <DatasetTable key={d.id} d={d} />)}
        {r && (r.checks.length ? (
          <table className="text-sm"><thead><tr className="text-left"><th className="pr-4">study profile</th><th className="pr-4">label</th><th className="pr-4">counts equal</th><th>values matched to its entities</th></tr></thead>
            <tbody>{r.checks.map((c, k) => (
              <tr key={k} className="border-t border-border align-top">
                <td className="py-1 pr-4">{c.profile}</td><td className="py-1 pr-4">{c.source} · {c.label}</td>
                <td className={cn("py-1 pr-4", c.equal === c.pairs ? "text-primary" : "text-destructive")}>{fmt(c.equal)} of {fmt(c.pairs)} over {c.samples} samples{c.equal < c.pairs ? " · off by up to " + fmt(c.maxDiff) + " cells" : ""}</td>
                <td className="py-1">{c.matchedValues.length} of {c.matchedValues.length + c.unmatchedValues.length}{c.unmatchedValues.length ? <span className={META}> (not in it: {c.unmatchedValues.join(", ")})</span> : ""}</td>
              </tr>))}</tbody></table>
        ) : <p className={cn(META, "m-0")}>{r.profiles.length ? "The study's count profiles (" + r.profiles.join(", ") + ") name none of the kept labels' values, so there is nothing to set beside them." : "The study holds no cell-count profile to check against."}</p>)}
        <CompositionPreview sc={sc} />
      </>}
    </Step>
  );
}

// ---- 6. take it away ------------------------------------------------------------------------------

export function UseStep({ sc }: { sc: SingleCellState }) {
  const cfg = sc.cfg!, p = sc.preview;
  const login = useCustomDataState();
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const json = JSON.stringify(cfg, null, 1) + "\n";
  const file = cfg.study + ".json";
  const save = async () => {
    setErr(null); setSaved(null);
    try {
      for (const d of p!.datasets)
        await saveToServer({ ...d, createdAt: new Date().toISOString(), source: { rowsIn: d.rows.length, unmatched: 0, duplicates: 0, multiStudy: 0, studies: [cfg.study] } });
      setSaved(p!.datasets.map((d) => d.id).join(", "));
    } catch (e) { setErr(String((e as Error)?.message || e)); }
  };
  return (
    <Step n={6} title="Take it away" lead="Keep the config — it is the record of every choice above — and the data it builds."
      why={<>The config is small and readable, so it can be reviewed like code and rebuilt when the dataset changes. Saved custom data are yours until you share them
        (the lab's Saved tab); in the lab they appear as <code>custom:{cfg.id}-p/…</code> and <code>custom:{cfg.id}-s/…</code> attributes, for filters, plots and the composition view.</>}>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="outline" className={TB} onClick={() => download(file, json, "application/json")}><Download />config ({file})</Button>
        {p?.datasets.map((d) => <Button key={d.id} variant="outline" className={TB} onClick={() => download(d.id + ".tsv", datasetTsv(d), "text/tab-separated-values")}><Download />{d.id}.tsv</Button>)}
        {p && (login.unlocked
          ? <Button onClick={() => void save()}><Save />save as custom data</Button>
          : <Button variant="outline" className={TB} onClick={requestLogin} title={login.enabled ? "saving needs a sign-in" : "this deployment keeps no custom data: download the TSVs and upload them where you sign in"}>
            <Save />sign in to save</Button>)}
      </div>
      {!p && <p className={cn(META, "m-0")}>Build the preview (step 5) to download or save the data; the config can be downloaded now.</p>}
      {saved && <p className="m-0 text-primary">Saved {saved}. Open the lab and add a view: they are listed with your custom data.</p>}
      {err && <p className="error m-0">{err}</p>}
      <div>
        <p className={cn(META, "m-0")}>The same build from the command line, with the config saved as <code>scripts/singlecell/{file}</code>:</p>
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted p-2.5 text-sm">node --env-file=.env.local scripts/gen-singlecell-summary.ts build scripts/singlecell/{file} --out out/</pre>
      </div>
    </Step>
  );
}
