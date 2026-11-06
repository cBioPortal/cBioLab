// Fetching a public study from datahub (lib/importer/datahub.ts): the tarball datahub publishes for
// a study, downloaded and unpacked into the local data folder, and the folder holding its meta files
// returned. fetch is stubbed with a tarball built here, so nothing leaves the machine.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchDatahubStudy, validStudyId } from "../lib/importer/datahub.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

/** a .tar.gz of `files` (path -> text), as bytes */
function tarball(files: Record<string, string>): Blob {
  const src = tmp("datahub-src-");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    writeFileSync(path.join(src, name), text);
  }
  const out = path.join(tmp("datahub-tgz-"), "x.tar.gz");
  execFileSync("tar", ["-czf", out, "-C", src, ...Object.keys(files).map((f) => f.split("/")[0]).filter((v, i, a) => a.indexOf(v) === i)]);
  return new Blob([new Uint8Array(readFileSync(out))]);
}

/** fetch answering every request with `res`, recording the URLs asked for */
function stubFetch(res: () => Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return res();
  }) as typeof fetch;
  return urls;
}

test("a study id is letters, digits, _ . and -, and does not start with a dot", () => {
  for (const id of ["acc_tcga", "msk_impact_2017", "brca_tcga_pan_can_atlas_2018", "a.b-c"]) assert.equal(validStudyId(id), true, id);
  for (const id of ["", "..", ".hidden", "a/b", "../etc", "a b", "a;rm", "é"]) assert.equal(validStudyId(id), false, id);
});

test("a bad id is refused before anything is downloaded", async () => {
  const urls = stubFetch(() => new Response("x"));
  await assert.rejects(fetchDatahubStudy(tmp("dh-"), "../x", () => {}), /Not a study id: \.\.\/x/);
  assert.deepEqual(urls, []);
});

test("downloads the study's tarball and returns the folder named after the study inside it", async () => {
  const tgz = tarball({ "acc_tcga/meta_study.txt": "cancer_study_identifier: acc_tcga\n", "acc_tcga/data_clinical_patient.txt": "#x\n" });
  const urls = stubFetch(() => new Response(tgz, { headers: { "content-length": String(3_000_000) } }));
  const dir = tmp("dh-");
  const logs: string[] = [];
  const folder = await fetchDatahubStudy(dir, "acc_tcga", (m) => logs.push(m));
  assert.deepEqual(urls, ["https://datahub.assets.cbioportal.org/acc_tcga.tar.gz"]);
  assert.equal(folder, path.join(dir, "studies", "acc_tcga", "acc_tcga"));
  assert.equal(readFileSync(path.join(folder, "meta_study.txt"), "utf8"), "cancer_study_identifier: acc_tcga\n");
  assert.deepEqual(logs, ["Downloading acc_tcga (3 MB)", "Unpacking acc_tcga"]);
  assert.deepEqual(readdirSync(path.join(dir, "datahub")), [], "the tarball is removed once unpacked");
});

test("a tarball with its files at the top level returns the study folder itself", async () => {
  const tgz = tarball({ "meta_study.txt": "cancer_study_identifier: flat\n" });
  stubFetch(() => new Response(tgz));
  const dir = tmp("dh-");
  const logs: string[] = [];
  const folder = await fetchDatahubStudy(dir, "flat", (m) => logs.push(m));
  assert.equal(folder, path.join(dir, "studies", "flat"));
  assert.ok(existsSync(path.join(folder, "meta_study.txt")));
  assert.equal(logs[0], "Downloading flat", "no size when the server gives none");
});

test("a second fetch of a study replaces what the first unpacked", async () => {
  const dir = tmp("dh-");
  stubFetch(() => new Response(tarball({ "s/old.txt": "old" })));
  await fetchDatahubStudy(dir, "s", () => {});
  stubFetch(() => new Response(tarball({ "s/new.txt": "new" })));
  const folder = await fetchDatahubStudy(dir, "s", () => {});
  assert.deepEqual(readdirSync(folder), ["new.txt"]);
});

test("a study datahub does not have is named as such; any other failure gives its HTTP status", async () => {
  for (const status of [404, 403]) {
    stubFetch(() => new Response("no", { status }));
    await assert.rejects(fetchDatahubStudy(tmp("dh-"), "nope", () => {}), /datahub has no study nope/);
  }
  stubFetch(() => new Response("down", { status: 503 }));
  await assert.rejects(fetchDatahubStudy(tmp("dh-"), "acc_tcga", () => {}), /Downloading acc_tcga from datahub failed \(HTTP 503\)/);
  stubFetch(() => new Response(null, { status: 200 }));
  await assert.rejects(fetchDatahubStudy(tmp("dh-"), "acc_tcga", () => {}), /failed \(HTTP 200\)/, "an answer with no body is a failure too");
});
