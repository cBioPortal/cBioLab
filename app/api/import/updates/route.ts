// The study-updates page's API (/import/updates), in local mode only, on a database in the new
// schema: example updates to a study (packages/importer/src/lab-edits.ts), reviews (packages/importer/src/lab-review.ts),
// merging a study's partitions, and timing queries on a study.
//
//   GET                       the database's studies (review copies apart)
//   GET ?study=<id>           one study's state: its counts, partitions, review and continuous profiles
//   POST { action, study, … } plan | apply | review-start | review-diff | review-approve | review-reject
//                             | review-undo | merge | time
import { connection } from "next/server";
import { importEnabled, query, sq, type WriteConn } from "@cbiolab/importer/ch-write";
import { importConn } from "../../../../lib/import-conn.ts";
import { applyEdit, continuousProfiles, planEdit, type EditParams } from "@cbiolab/importer/lab-edits";
import { approveReview, diffReview, isReviewId, latestReview, latestVersion, rejectReview, reviewId, startReview, studyExists, undoApproval } from "@cbiolab/importer/lab-review";
import { compactStudy, studyParts } from "@cbiolab/importer/lab-schema";
import { schemaMode } from "@cbiolab/importer/setup";
import { runningJob } from "@cbiolab/importer/jobs";
import { validStudyId } from "@cbiolab/importer/datahub";

const bad = (error: string, status = 400) => Response.json({ error }, { status });

// one change at a time: two edits of a study at once would race on its versions
const g = globalThis as typeof globalThis & { cbiolabUpdateBusy?: { action: string } | null };

export interface StudyCounts { samples: number; patients: number; mutations: number; cnaEvents: number; profiles: number; attributes: number; profileValues: number; clinicalValues: number; version: number }

async function counts(conn: WriteConn, study: string): Promise<StudyCounts> {
  const S = sq(study);
  const c = (t: string) => `(SELECT count() FROM ${t} FINAL WHERE study_id = ${S})`;
  const r = await query<Record<string, number>>(conn, `SELECT ${c("lab_sample")} AS samples, ${c("lab_patient")} AS patients, ${c("lab_mutation")} AS mutations,
    ${c("lab_cna_event")} AS cnaEvents, ${c("lab_profile")} AS profiles, ${c("lab_clinical_attribute")} AS attributes,
    ${c("lab_profile_value")} AS profileValues, ${c("lab_clinical")} AS clinicalValues`);
  const out = Object.fromEntries(Object.entries(r[0] ?? {}).map(([k, v]) => [k, Number(v)])) as unknown as StudyCounts;
  return { ...out, version: await latestVersion(conn, study) };
}

export interface StudyState {
  id: string; name: string; counts: StudyCounts; parts: { table: string; parts: number; rows: number; bytes: number }[];
  review: Awaited<ReturnType<typeof latestReview>>;
  reviewCopy: { counts: StudyCounts; parts: { table: string; parts: number; rows: number; bytes: number }[] } | null;
  continuous: string[];
}

async function state(conn: WriteConn, study: string): Promise<StudyState> {
  const name = (await query<{ n: string }>(conn, `SELECT name AS n FROM lab_study FINAL WHERE study_id = ${sq(study)}`))[0]?.n ?? study;
  const rid = reviewId(study);
  const copy = await studyExists(conn, rid);
  return {
    id: study, name, counts: await counts(conn, study), parts: await studyParts(conn, study), review: await latestReview(conn, study),
    reviewCopy: copy ? { counts: await counts(conn, rid), parts: await studyParts(conn, rid) } : null,
    continuous: await continuousProfiles(conn, study)
  };
}

/** Single-study queries of the kind the app runs, through the views, timed (median of three, round trip). */
const TIMED: [string, (s: string) => string][] = [
  ["One gene's altered samples (TP53)", (s) => `SELECT uniqExact(sample_unique_id) FROM genomic_event_derived WHERE cancer_study_identifier = ${s} AND hugo_gene_symbol = 'TP53'`],
  ["OncoPrint, 10 genes", (s) => `SELECT hugo_gene_symbol, sample_unique_id, groupArray(variant_type) FROM genomic_event_derived WHERE cancer_study_identifier = ${s}
    AND hugo_gene_symbol IN ('TP53', 'KRAS', 'EGFR', 'PIK3CA', 'PTEN', 'APC', 'BRAF', 'CDKN2A', 'ERBB2', 'MYC') GROUP BY 1, 2`],
  ["Mutated genes table", (s) => `SELECT hugo_gene_symbol, uniqExact(sample_unique_id) AS c FROM genomic_event_derived WHERE cancer_study_identifier = ${s}
    AND variant_type = 'mutation' GROUP BY 1 ORDER BY c DESC LIMIT 50`],
  ["Clinical breakdown", (s) => `SELECT attribute_name, attribute_value, count() FROM clinical_data_derived WHERE cancer_study_identifier = ${s}
    AND attribute_name IN ('CANCER_TYPE', 'SAMPLE_TYPE', 'SEX', 'ONCOTREE_CODE') GROUP BY 1, 2`],
  ["Mutation table page", (s) => `SELECT * FROM mutation_derived WHERE studyId = ${s} AND entrezGeneId = 7157 ORDER BY sampleId LIMIT 100`],
  ["Samples in study", (s) => `SELECT count() FROM sample_derived WHERE cancer_study_identifier = ${s}`]
];

async function timeQueries(conn: WriteConn, study: string): Promise<{ query: string; ms: number }[]> {
  const out: { query: string; ms: number }[] = [];
  for (const [label, sql] of TIMED) {
    const ms: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await query(conn, sql(sq(study)));
      ms.push(performance.now() - t0);
    }
    out.push({ query: label, ms: Math.round(ms.sort((a, b) => a - b)[1]) });
  }
  return out;
}

async function guard(): Promise<Response | WriteConn> {
  if (!importEnabled()) return bad("Study updates are only available when cBioLab runs locally (npm run local)", 404);
  const conn = importConn();
  const mode = await schemaMode(conn);
  if (mode !== "new") return bad(`Study updates need a database in the new schema; this one is ${mode} (npm run import -- --schema new)`, 409);
  return conn;
}

export async function GET(req: Request) {
  await connection();
  const conn = await guard();
  if (conn instanceof Response) return conn;
  const study = new URL(req.url).searchParams.get("study");
  try {
    if (!study) {
      const rows = await query<{ id: string; name: string; samples: number }>(conn, `SELECT study_id AS id, name, sample_count AS samples FROM lab_study FINAL ORDER BY study_id`);
      return Response.json({ studies: rows.filter((r) => !isReviewId(r.id)).map((r) => ({ ...r, samples: Number(r.samples) })), busy: g.cbiolabUpdateBusy ?? null });
    }
    if (!validStudyId(study) || !(await studyExists(conn, study))) return bad("No study " + study.slice(0, 80), 404);
    return Response.json({ ...(await state(conn, study)), busy: g.cbiolabUpdateBusy ?? null });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

interface Body { action: string; study: string; target?: "live" | "review"; edit?: EditParams; onConflict?: "skip" | "update"; merge?: boolean; force?: boolean }

export async function POST(req: Request) {
  const conn = await guard();
  if (conn instanceof Response) return conn;
  const body = await req.json() as Body;
  if (!validStudyId(body.study || "") || isReviewId(body.study)) return bad("Name a study (not a review copy)");
  const running = runningJob();
  if (running) return bad("An import is running (" + running.source + "); wait for it to finish", 409);
  if (g.cbiolabUpdateBusy) return bad("Another change is running (" + g.cbiolabUpdateBusy.action + "); wait for it to finish", 409);
  const target = body.target === "review" ? reviewId(body.study) : body.study;
  if (body.target === "review" && !(await studyExists(conn, target))) return bad(body.study + " has no review copy; start a review first", 409);
  g.cbiolabUpdateBusy = { action: body.action + " " + body.study };
  const t0 = Date.now();
  try {
    const out = await (async (): Promise<unknown> => {
      switch (body.action) {
        case "plan": return planEdit(conn, target, body.edit ?? { kind: "samples" });
        case "apply": return applyEdit(conn, target, body.edit ?? { kind: "samples" }, body.onConflict === "update" ? "update" : "skip", body.merge !== false);
        case "review-start": return startReview(conn, body.study);
        case "review-diff": return diffReview(conn, body.study);
        case "review-approve": return approveReview(conn, body.study, !!body.force);
        case "review-reject": return rejectReview(conn, body.study).then(() => ({}));
        case "review-undo": return undoApproval(conn, body.study, !!body.force);
        case "merge": return { merged: await compactStudy(conn, target) };
        case "time": return { timings: await timeQueries(conn, target) };
        default: throw new Error("Unknown action " + body.action);
      }
    })();
    return Response.json({ result: out, seconds: (Date.now() - t0) / 1000 });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 409);
  } finally {
    g.cbiolabUpdateBusy = null;
  }
}
