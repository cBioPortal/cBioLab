// The engine's endpoints, as the pages call them. Each takes the body its route accepts — the
// envelope types in lib/api-schemas.ts, which the route parses with — so a change to either side
// is a type error on the other; and each attaches the uploaded datasets its body uses
// (withCustomData), so a caller passes what it means and nothing is added out of sight.
//
// They return the Response, as fetch does: a caller still decides how to read it (JSON, the
// binary contract, a file) and what an error status means for it.
import type {
  AnalysisBody, NotebookBody, ExploreBody, OncoprintBody, OncoprintDetailBody, PatientsOfBody, PartitionBody, ViewPageBody, TableBody, CellExplorerBody, LockBody,
} from "../../lib/api-schemas.ts";
import { withCustomData, type UploadBinding } from "./custom-data-client.ts";
import type { ArtifactKind } from "../../lib/artifacts.ts";
import type { Sharing } from "../../lib/access.ts";

interface Opts { signal?: AbortSignal }

function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}
const send = (method: "PATCH" | "PUT", path: string, body: unknown): Promise<Response> =>
  fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  /** The document's cohorts and views. `query`: "?oncoprint=spec" (the page draws its own figures, the oncoprint included), "?figures=svg". */
  analysis: async (doc: AnalysisBody, opts: Opts & { query?: string } = {}) =>
    post("/api/analysis" + (opts.query || ""), await withCustomData(doc), opts.signal),

  /** One view's Python script, which the page's analysis requests leave out: the body is the one-view document the page sent for it. */
  methodScript: async (doc: AnalysisBody, opts: Opts = {}) =>
    post("/api/analysis/method", await withCustomData(doc), opts.signal),

  /** One view's method record as a Jupyter notebook (the .ipynb); the body is the document plus `notebookView`. */
  methodNotebook: async (body: NotebookBody, opts: Opts = {}) =>
    post("/api/analysis/notebook", await withCustomData(body), opts.signal),

  /** Facets of the selected studies under a draft cohort; every upload with rows in them comes along. */
  explore: async (body: ExploreBody, opts: Opts = {}) =>
    post("/api/explore", await withCustomData(body, { explore: true }), opts.signal),

  /**
   * An oncoprint's contract (or its picture: `query` "?format=svg…"). A spec carries no pins of its
   * own, so `pins` are the document's; `endpoint` is the local-tables route, which reads no uploads.
   */
  oncoprint: async (spec: OncoprintBody, opts: Opts & { query?: string; pins?: UploadBinding[]; endpoint?: string } = {}) => {
    const path = opts.endpoint || "/api/oncoprint";
    const body = path === "/api/oncoprint" ? await withCustomData(spec, { pins: opts.pins }) : spec;
    return post(path + (opts.query || ""), body, opts.signal);
  },

  /** What one column of an oncoprint carries. */
  oncoprintDetail: (body: OncoprintDetailBody, opts: Opts = {}) => post("/api/oncoprint/detail", body, opts.signal),

  /** The patients a selection of sample columns came from. */
  patientsOf: (body: PatientsOfBody, opts: Opts = {}) => post("/api/oncoprint/patients-of", body, opts.signal),

  /** Proposed arms for splitting a cohort. */
  /** A cohort's cells as a Cell Explorer link (mode "link"), or a pasted Cell Explorer link or donor ids as a cohort (mode "import"). */
  cellExplorer: async (body: CellExplorerBody, opts: Opts = {}) =>
    post("/api/cell-explorer", body.mode === "link" ? await withCustomData(body) : body, opts.signal),
  partition: async (body: PartitionBody, opts: Opts = {}) =>
    post("/api/partition", await withCustomData(body), opts.signal),

  /** Lock cohorts of the document: those named, or every one. Answers each cohort's lock (lib/cohort-lock-server.ts). */
  lock: async (body: LockBody, opts: Opts = {}) =>
    post("/api/lock", await withCustomData(body), opts.signal),

  /** One page of a table view, or the values one of its columns takes. */
  viewPage: async (body: ViewPageBody, opts: Opts = {}) =>
    post("/api/view-page", await withCustomData(body), opts.signal),

  /** The table download's payload: it is a form post, so the browser can save the file as it streams. */
  tablePayload: async (body: TableBody): Promise<string> => JSON.stringify(await withCustomData(body)),

  /** Every study this deployment can reach, with its counts and capabilities. */
  studies: (opts: Opts = {}) => fetch("/api/studies", { signal: opts.signal }),

  /** One study's timeline vocabulary and declared survival endpoints. */
  catalog: (study: string, opts: Opts = {}) => fetch("/api/catalog?study=" + encodeURIComponent(study), { signal: opts.signal }),

  /** Saved cohorts and analyses (lib/artifacts.ts): everything the signed-in reader may see, by kind. */
  artifacts: {
    list: (kind: ArtifactKind, opts: Opts = {}) => fetch("/api/artifacts?kind=" + kind, { signal: opts.signal }),
    create: (body: { kind: ArtifactKind; name: string; definition: unknown }) => post("/api/artifacts", body),
    /** `version`: the one the change was made from — a stale one is refused (409) */
    update: (id: string, body: { name: string; definition: unknown; version?: number }) => send("PATCH", "/api/artifacts/" + id, body),
    remove: (id: string) => fetch("/api/artifacts/" + id, { method: "DELETE" }),
    /** who it is shared with (its owner only); answers { artifact, warnings } */
    share: (id: string, sharing: Sharing) => send("PUT", "/api/artifacts/" + id + "/sharing", sharing),
  },

  /** Stored id sets (lib/id-set-store.ts): cohorts given as long lists of ids, kept on the server and named by id. */
  idSets: {
    list: (opts: Opts = {}) => fetch("/api/id-sets", { signal: opts.signal }),
    /** match `ids` ("<study>:<id>" or bare, looked up in every study given) and save the matches; answers what did not match */
    create: (body: { name: string; level: "sample" | "patient"; studies: string[]; ids: string[] }) => post("/api/id-sets", body),
    remove: (id: string) => fetch("/api/id-sets/" + id, { method: "DELETE" }),
    /** who it is shared with (its owner only) */
    share: (id: string, sharing: Sharing) => send("PUT", "/api/id-sets/" + id + "/sharing", sharing),
  },

  /** Groups (lib/groups.ts): the reader's, and managing one. */
  groups: {
    list: (opts: Opts = {}) => fetch("/api/groups", { signal: opts.signal }),
    get: (id: string, opts: Opts = {}) => fetch("/api/groups/" + id, { signal: opts.signal }),
    create: (body: { name: string; description?: string }) => post("/api/groups", body),
    update: (id: string, body: { name?: string; description?: string }) => send("PATCH", "/api/groups/" + id, body),
    remove: (id: string) => fetch("/api/groups/" + id, { method: "DELETE" }),
    addMember: (id: string, body: { email: string; role?: "admin" | "member" }) => post("/api/groups/" + id + "/members", body),
    setRole: (id: string, userId: string, role: "admin" | "member") => send("PATCH", "/api/groups/" + id + "/members/" + userId, { role }),
    removeMember: (id: string, userId: string) => fetch("/api/groups/" + id + "/members/" + userId, { method: "DELETE" }),
  },
};
