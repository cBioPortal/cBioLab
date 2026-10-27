// The import page's API, in local mode only (`npm run local`; lib/importer/ch-write.ts).
//
//   GET                  this instance's studies and the import running now, if any
//   GET ?job=<id>        one import's progress and result
//   POST (multipart)     files: `file` parts with a `paths` JSON list of their paths in the folder,
//                        and an optional `studyId` for a folder without meta_study.txt
//   POST (JSON)          { datahub: "<study id>" } or { folder: "<path on this computer>", studyId? }
//   DELETE ?study=<id>   removes an imported study
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { importEnabled, localConn, query } from "../../../lib/importer/ch-write.ts";
import { validStudyId } from "../../../lib/importer/datahub.ts";
import { dataDir, job, runningJob, startJob } from "../../../lib/importer/jobs.ts";

const notLocal = () => Response.json({ error: "Importing is only available when cBioLab runs locally (npm run local)" }, { status: 404 });
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export interface LocalStudy { id: string; name: string; patients: number; samples: number; importedAt: string }

async function localStudies(): Promise<LocalStudy[]> {
  const rows = await query<{ id: string; name: string; patients: number; samples: number; at: string }>(localConn(),
    "SELECT cs.cancer_study_identifier AS id, cs.name AS name, toString(cs.import_date) AS at,\n" +
    "  (SELECT count() FROM patient p WHERE p.cancer_study_id = cs.cancer_study_id) AS patients,\n" +
    "  cs.sample_count AS samples\n" +
    "FROM cancer_study cs ORDER BY cs.import_date DESC");
  return rows.map((r) => ({ id: r.id, name: r.name, patients: Number(r.patients), samples: Number(r.samples), importedAt: r.at }));
}

export async function GET(req: Request) {
  await connection();
  if (!importEnabled()) return notLocal();
  const id = new URL(req.url).searchParams.get("job");
  if (id) {
    const j = job(id);
    return j ? Response.json(j) : bad("No such import", 404);
  }
  return Response.json({ running: runningJob(), studies: await localStudies() });
}

/** A path inside the upload folder, or null for one that would leave it. */
function safeRelative(p: string): string | null {
  const parts = p.replace(/\\/g, "/").split("/").filter((x) => x && x !== ".");
  if (!parts.length || parts.some((x) => x === "..")) return null;
  return parts.join("/");
}

export async function POST(req: Request) {
  if (!importEnabled()) return notLocal();
  const type = req.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const body = await req.json() as { datahub?: string; folder?: string; studyId?: string };
      if (body.datahub) {
        const id = body.datahub.trim();
        if (!validStudyId(id)) return bad("Not a study id: " + id.slice(0, 80));
        return Response.json(startJob("datahub:" + id, ["datahub:" + id]));
      }
      if (body.folder) {
        const dir = path.resolve(body.folder.trim().replace(/^~(?=$|\/)/, process.env.HOME || "~"));
        if (!(await stat(dir).catch(() => null))?.isDirectory()) return bad("No folder at " + dir);
        const args = [dir];
        if (body.studyId?.trim()) { if (!validStudyId(body.studyId.trim())) return bad("Not a study id"); args.push("--id", body.studyId.trim()); }
        return Response.json(startJob(dir, args));
      }
      return bad("Say what to import: datahub or folder");
    }
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    const paths = JSON.parse(String(form.get("paths") || "[]")) as string[];
    if (!files.length) return bad("No files were sent");
    let rel = files.map((f, i) => safeRelative(paths[i] || f.name));
    if (rel.some((r) => r === null)) return bad("A file path leaves the study folder");
    // a dropped folder arrives as "<folder>/<file>": the folder's own name is the study's default id
    const tops = new Set(rel.map((r) => r!.split("/")[0]));
    let folderName = "";
    if (tops.size === 1 && rel.every((r) => r!.includes("/"))) { folderName = [...tops][0]; rel = rel.map((r) => r!.slice(folderName.length + 1)); }
    const studyId = String(form.get("studyId") || "").trim() || folderName.replace(/[^A-Za-z0-9_.-]/g, "_") || "my_study";
    if (!validStudyId(studyId)) return bad("Not a study id: " + studyId.slice(0, 80));
    const dir = path.join(dataDir(), "uploads", randomUUID());
    for (let i = 0; i < files.length; i++) {
      const target = path.join(dir, rel[i]!);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await files[i].arrayBuffer()));
    }
    return Response.json(startJob((folderName || files.length + " files") + " (uploaded)", [dir, "--id", studyId]));
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 409);
  }
}

export async function DELETE(req: Request) {
  if (!importEnabled()) return notLocal();
  const id = new URL(req.url).searchParams.get("study") || "";
  if (!validStudyId(id)) return bad("Not a study id");
  try { return Response.json(startJob("delete " + id, ["--delete", id])); }
  catch (e) { return bad(e instanceof Error ? e.message : String(e), 409); }
}
