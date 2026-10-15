// What each endpoint the analysis page calls takes as its body — the ENVELOPE: the route's own
// parameters (which view, which page, which studies, which uploads come along), checked here, by
// the route, and typed for the client (app/lab/api.ts), so a change to one is a type error in the
// other. What the envelope carries — an analysis document's cohorts and views, a cohort
// definition, an oncoprint spec — is checked by the engine, which refuses it with a message naming
// what is wrong and what is available. Here it is checked only for being the right kind of thing
// (an object; a view with a `kind`), and typed as the engine's own type, so a caller passes the
// document it holds as it is.
//
// Unknown fields are kept (parseBody), so an addition to the document needs no change here.
// Browser-safe: the client imports it.
import { z } from "zod";
import type { CohortDef, OncoprintSpec, View } from "./types.ts";

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v);
const object = <T,>(what: string) => z.custom<T>(isObject, what + " must be an object");
const view = z.custom<View>((v) => isObject(v) && typeof (v as { kind?: unknown }).kind === "string",
  "a view must be an object with a `kind`");

const UploadRef = z.object({ as: z.string(), dataset: z.string(), version: z.number().int() });
/** Uploaded data a request carries (built-in examples, as rows) or names (server-stored versions). */
const customData = {
  customData: z.array(object<object>("a dataset")).optional(),
  customRefs: z.array(UploadRef).optional(),
};

/** An analysis document, as far as its envelope goes. */
export const DocEnvelope = z.object({
  dsl: z.string().optional(),
  study: z.string().optional(),
  cohorts: z.record(z.string(), object<CohortDef>("a cohort")).optional(),
  views: z.array(view).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  uploads: z.array(UploadRef).optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

/** POST /api/analysis — the document itself is the body. */
export const AnalysisRequest = DocEnvelope.extend(customData);

/**
 * POST /api/analysis/notebook — the document itself is the body, with `notebookView` naming the
 * view whose method record becomes the notebook. The server re-derives the view's queries from
 * the document; no SQL is accepted.
 */
export const NotebookRequest = DocEnvelope.extend(customData).extend({
  notebookView: z.object({ index: z.number().int().min(0), kind: z.string() }),
});

/** POST /api/explore — facets for one or more studies, under a draft cohort. */
export const ExploreRequest = z.object({
  study: z.string().optional(),
  studies: z.array(z.string()).optional(),
  draft: object<CohortDef>("draft").nullable().optional(),
  geneSearch: z.string().optional(),
  attributes: z.array(z.string()).optional(),
  geneCharts: z.array(z.string()).optional(),
  derived: z.array(z.object({ metric: z.string(), eventType: z.string().optional(), lineGap: z.number().optional() })).optional(),
  ...customData,
});

/** POST /api/oncoprint — the spec itself is the body. */
export const OncoprintRequest = z.object({
  study: z.string().optional(),
  studies: z.array(z.string()).optional(),
  ...customData,
});

/** POST /api/oncoprint/detail — one column of a figure. */
export const OncoprintDetailRequest = z.object({ spec: object<OncoprintSpec>("spec"), column: z.string() });

/** POST /api/oncoprint/patients-of — the patients a selection of sample columns came from. */
export const PatientsOfRequest = z.object({
  study: z.string().optional(),
  samples: z.array(z.string()).min(1, "samples must be a non-empty array of sample ids")
    .max(50000, "selection is larger than the 50,000-id ceiling on an explicit patient list"),
});

/** POST /api/partition — proposed arms for splitting a cohort by an attribute, a gene or OQL queries. */
export const PartitionRequest = z.object({
  doc: DocEnvelope,
  cohort: z.string(),
  attribute: z.string().optional(),
  gene: z.string().optional(),
  oql: z.array(z.string()).optional(),
  name: z.string().optional(),
  maxArms: z.number().optional(),
  minCount: z.number().optional(),
  ...customData,
});

/** POST /api/custom-data/members — a cohort's patients and the rest of each study, for "save as feature". */
export const MembersRequest = z.object({ def: object<CohortDef>("def"), studies: z.array(z.string()), ...customData });

/** POST /api/view-page — one page of a table view, or the values one of its columns takes. */
export const ViewPageRequest = z.object({
  doc: DocEnvelope,
  view: z.number().int().min(0),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(25),
  values: z.string().optional(),
  /** which of the view's tables, for a view that holds several (the alterations view's "mutations", "cna", "sv") */
  table: z.string().max(40).optional(),
  ...customData,
});

/** POST /api/table — a table view's CSV (a form post: the browser saves the file as it streams). */
export const TableRequest = z.object({
  doc: z.union([DocEnvelope, z.string()]),
  view: z.number().int().min(0),
  table: z.string().max(40).optional(),
  ...customData,
});

/** A spec or a document goes out with the fields the envelope does not name. */
type Open<T> = T & Record<string, unknown>;
export type AnalysisBody = z.input<typeof AnalysisRequest>;
export type NotebookBody = z.input<typeof NotebookRequest>;
export type ExploreBody = z.input<typeof ExploreRequest>;
export type OncoprintBody = Open<z.input<typeof OncoprintRequest>>;
export type OncoprintDetailBody = z.input<typeof OncoprintDetailRequest>;
export type PatientsOfBody = z.input<typeof PatientsOfRequest>;
export type PartitionBody = z.input<typeof PartitionRequest>;
export type MembersBody = z.input<typeof MembersRequest>;
export type ViewPageBody = z.input<typeof ViewPageRequest>;
export type TableBody = z.input<typeof TableRequest>;

/**
 * The body, checked against its envelope, with its defaults filled in and every field the
 * envelope does not name kept as sent. A refusal names each field that is wrong.
 */
export function parseBody<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> & Record<string, unknown> {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new Error("request body: " + r.error.issues.map((i) => (i.path.length ? i.path.join(".") + ": " : "") + i.message).join("; "));
  return { ...(raw as object), ...(r.data as object) } as z.output<S> & Record<string, unknown>;
}
