"use client";
// The import page's controls: three ways to name a study (drop or choose files, a folder on this
// computer, a datahub id), the running import's progress, its report, and the studies already here.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { ErrorAlert } from "../_ui/error-alert.tsx";
import type { Job } from "../../lib/importer/jobs.ts";
import type { LocalStudy } from "../api/import/route.ts";

interface Picked { file: File; path: string }

/** Every file under a dropped item, with its path inside the drop. */
async function walk(entry: FileSystemEntry, prefix: string, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, path: prefix + entry.name });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries answers in batches until it returns none
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + "/", out);
    }
  }
}

async function postJson(body: unknown): Promise<Job> {
  const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json() as Job & { error?: string };
  if (!res.ok) throw new Error(j.error || "The import could not start");
  return j;
}

export function ImportClient() {
  const [studies, setStudies] = useState<LocalStudy[] | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [studyId, setStudyId] = useState("");
  const [folder, setFolder] = useState("");
  const [datahub, setDatahub] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/import", { cache: "no-store" });
    const j = await res.json() as { running: Job | null; studies: LocalStudy[]; error?: string };
    if (!res.ok) { setError(j.error || "Could not read this instance's studies"); return; }
    setStudies(j.studies);
    if (j.running) setJob((cur) => cur?.id === j.running!.id ? cur : j.running);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // follow the running import until it ends
  const running = job?.state === "running";
  const jobId = job?.id;
  useEffect(() => {
    if (!running || !jobId) return;
    const t = setInterval(() => {
      void (async () => {
        const res = await fetch("/api/import?job=" + jobId, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json() as Job;
        setJob(j);
        if (j.state !== "running") void refresh();
      })();
    }, 700);
    return () => clearInterval(t);
  }, [running, jobId, refresh]);

  const start = async (go: () => Promise<Job>) => {
    setError(null);
    try { setJob(await go()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const out: Picked[] = [];
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => !!x);
    for (const en of entries) await walk(en, "", out);
    setPicked(out.filter((p) => !p.path.split("/").some((s) => s.startsWith("."))));
  };
  const fromInput = (list: FileList | null) => {
    if (!list) return;
    setPicked([...list].filter((f) => !f.name.startsWith(".")).map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
  };

  const upload = () => start(async () => {
    const fd = new FormData();
    for (const p of picked) fd.append("file", p.file, p.file.name);
    fd.set("paths", JSON.stringify(picked.map((p) => p.path)));
    if (studyId.trim()) fd.set("studyId", studyId.trim());
    setUploading(true);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const j = await res.json() as Job & { error?: string };
      if (!res.ok) throw new Error(j.error || "The upload failed");
      setPicked([]);
      return j;
    } finally { setUploading(false); }
  });

  const remove = (id: string) => start(async () => {
    const res = await fetch("/api/import?study=" + encodeURIComponent(id), { method: "DELETE" });
    const j = await res.json() as Job & { error?: string };
    if (!res.ok) throw new Error(j.error || "Could not remove " + id);
    return j;
  });

  const busy = running || uploading;
  const totalMb = picked.reduce((a, p) => a + p.file.size, 0) / 1e6;
  const hasStudyMeta = picked.some((p) => /(^|\/)meta_study\.txt$/.test(p.path));

  return (
    <div className="import-flow">
      {error && <ErrorAlert>{error}</ErrorAlert>}

      <section className="import-sources" aria-label="what to import">
        <div className={"import-drop" + (dragging ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => void onDrop(e)}>
          <h2>Drop a study folder or its files</h2>
          <p className="meta">cBioPortal&apos;s study format: <code>meta_*.txt</code> files, the data files they name and a <code>case_lists</code> folder.
            Files with datahub&apos;s standard names (<code>data_clinical_sample.txt</code>, <code>data_mutations.txt</code>, <code>data_cna.txt</code>, …) import without meta files.</p>
          <div className="import-row">
            <Button variant="outline" size="sm" onClick={() => dirInput.current?.click()} disabled={busy}>Choose a folder…</Button>
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>Choose files…</Button>
            <input ref={dirInput} type="file" hidden multiple aria-label="study folder" onChange={(e) => fromInput(e.target.files)}
              {...{ webkitdirectory: "", directory: "" }} />
            <input ref={fileInput} type="file" hidden multiple aria-label="study files" onChange={(e) => fromInput(e.target.files)} />
          </div>
          {picked.length > 0 && (
            <div className="import-picked">
              <p><b>{picked.length} files</b>, {totalMb.toFixed(1)} MB{hasStudyMeta ? " — with meta_study.txt" : ""}:{" "}
                <span className="meta">{picked.slice(0, 8).map((p) => p.path).join(", ")}{picked.length > 8 ? ", …" : ""}</span></p>
              {!hasStudyMeta && (
                <label className="import-row">Study id
                  <Input value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="my_study (the folder's name if left empty)" className="import-id" />
                </label>
              )}
              <div className="import-row">
                <Button size="sm" onClick={() => void upload()} disabled={busy}>{uploading ? "Uploading…" : "Import these files"}</Button>
                <Button variant="ghost" size="sm" onClick={() => setPicked([])} disabled={busy}>Clear</Button>
              </div>
            </div>
          )}
        </div>

        <div className="import-alt">
          <h2>A folder on this computer</h2>
          <p className="meta">Read in place, nothing is copied: the quickest way for a large study.</p>
          <form className="import-row" onSubmit={(e) => { e.preventDefault(); void start(() => postJson({ folder, studyId: studyId || undefined })); }}>
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="~/data/my_study" aria-label="folder path" className="import-path" />
            <Button size="sm" type="submit" disabled={busy || !folder.trim()}>Import</Button>
          </form>
          <h2>A public study from datahub</h2>
          <p className="meta">Any study id from <a href="https://github.com/cBioPortal/datahub/tree/master/public" target="_blank" rel="noreferrer">cBioPortal&apos;s datahub</a>, e.g. <code>acc_tcga</code> or <code>msk_impact_2017</code>; downloaded once, then imported.</p>
          <form className="import-row" onSubmit={(e) => { e.preventDefault(); void start(() => postJson({ datahub })); }}>
            <Input value={datahub} onChange={(e) => setDatahub(e.target.value)} placeholder="acc_tcga" aria-label="datahub study id" className="import-path" />
            <Button size="sm" type="submit" disabled={busy || !datahub.trim()}>Fetch and import</Button>
          </form>
        </div>
      </section>

      {job && <JobPanel job={job} />}

      <section aria-label="studies in this instance">
        <h2>Studies in this cBioLab</h2>
        {studies === null ? <p className="meta"><span className="spinner" /> reading…</p>
          : studies.length === 0 ? <p className="meta">None yet — import one above.</p>
          : (
            <table className="import-studies">
              <thead><tr><th>Study</th><th>Patients</th><th>Samples</th><th>Imported</th><th /></tr></thead>
              <tbody>
                {studies.map((s) => (
                  <tr key={s.id}>
                    <td><a href={"/lab?tab=explore&study=" + encodeURIComponent(s.id)}>{s.name}</a> <span className="meta mono">{s.id}</span></td>
                    <td className="num">{s.patients.toLocaleString()}</td>
                    <td className="num">{s.samples.toLocaleString()}</td>
                    <td className="meta">{s.importedAt.slice(0, 16)}</td>
                    <td><Button variant="ghost" size="xs" disabled={busy} onClick={() => { if (confirm("Remove " + s.id + " from this cBioLab?")) void remove(s.id); }}>remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}

function JobPanel({ job }: { job: Job }) {
  const last = job.events[job.events.length - 1];
  const r = job.result;
  return (
    <section className="import-job" aria-live="polite" aria-label="import progress">
      <h2>{job.state === "running" ? "Importing " : job.state === "done" ? "Imported " : "Import failed: "}<span className="mono">{job.source}</span></h2>
      {job.state === "running" && <p className="meta"><span className="spinner" /> {last ? last.step + (last.file ? " " + last.file : "") : "starting"}…</p>}
      {job.state === "failed" && <ErrorAlert>{job.error}</ErrorAlert>}
      {job.deleted !== undefined && job.state === "done" && <p>{job.deleted ? "Removed." : "There was no such study."}</p>}
      {r && (
        <>
          <p>
            <b>{r.name}</b> (<span className="mono">{r.studyId}</span>): {r.patients.toLocaleString()} patients, {r.samples.toLocaleString()} samples, in {r.seconds} s.{" "}
            <a href={"/lab?tab=explore&study=" + encodeURIComponent(r.studyId)}>Explore it</a>
          </p>
          <table className="import-report">
            <thead><tr><th>File</th><th>Kind</th><th>Rows stored</th><th>Left out, and why</th></tr></thead>
            <tbody>
              {r.files.map((f) => (
                <tr key={f.file + f.kind}>
                  <td className="mono">{f.file}</td>
                  <td>{f.kind}</td>
                  <td className="num">{f.stored.toLocaleString()} of {f.read.toLocaleString()}</td>
                  <td className="meta">{[...Object.entries(f.skipped).map(([k, v]) => v.toLocaleString() + " " + k), ...f.notes].join("; ") || "—"}</td>
                </tr>
              ))}
              {r.notImported.map((n) => (
                <tr key={"x" + n.file}><td className="mono">{n.file}</td><td>not imported</td><td className="num">—</td><td className="meta">{n.reason}</td></tr>
              ))}
            </tbody>
          </table>
          {r.warnings.length > 0 && <ul className="meta">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </>
      )}
    </section>
  );
}
