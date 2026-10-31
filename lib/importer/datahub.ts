// Fetching a public study from datahub: the tarball cBioPortal publishes for every study at
// datahub.assets.cbioportal.org, unpacked into the local data folder.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const DATAHUB = "https://datahub.assets.cbioportal.org/";

export function validStudyId(id: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(id) && !id.startsWith(".");
}

/** Downloads and unpacks a datahub study; returns the folder holding its meta files. */
export async function fetchDatahubStudy(dataDir: string, studyId: string, log: (msg: string) => void): Promise<string> {
  if (!validStudyId(studyId)) throw new Error("Not a study id: " + studyId);
  const dlDir = path.join(dataDir, "datahub");
  await mkdir(dlDir, { recursive: true });
  const tgz = path.join(dlDir, studyId + ".tar.gz");
  const res = await fetch(DATAHUB + studyId + ".tar.gz");
  if (res.status === 404 || res.status === 403) throw new Error("datahub has no study " + studyId);
  if (!res.ok || !res.body) throw new Error("Downloading " + studyId + " from datahub failed (HTTP " + res.status + ")");
  const total = Number(res.headers.get("content-length") || 0);
  log("Downloading " + studyId + (total ? " (" + Math.round(total / 1e6) + " MB)" : ""));
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tgz));
  const out = path.join(dataDir, "studies", studyId);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  log("Unpacking " + studyId);
  await run("tar", ["-xzf", tgz, "-C", out, "--no-same-owner"]);
  await rm(tgz, { force: true });
  // the tarball holds one folder named after the study
  const inner = path.join(out, studyId);
  try { if ((await stat(inner)).isDirectory()) return inner; } catch { /* files at the top level */ }
  return out;
}
