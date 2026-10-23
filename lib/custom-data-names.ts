// Custom data names and shapes — browser-safe (no node imports), shared by the engine
// (lib/custom-data.ts) and the Lab page's upload panel.
export type CustomDatatype = "STRING" | "NUMBER";
export type CustomLevel = "patient" | "sample";

export interface CustomColumn { name: string; datatype: CustomDatatype }
/** One uploaded case, already matched to the study at upload time (`/api/custom-data/resolve`). */
export interface CustomRow { study: string; patient: string; sample?: string; values: string[] }
export interface CustomDataset {
  /** slug, part of every attribute name: `custom:<id>/<COLUMN>` */
  id: string;
  name: string;
  level: CustomLevel;
  columns: CustomColumn[];
  rows: CustomRow[];
}

export const CUSTOM_PREFIX = "custom:";

/** A built-in attribute name, or a custom one. Every attribute-name check in the engine uses it. */
export const ATTR_NAME_RE = /^(?:[A-Za-z0-9_]{1,64}|custom:[a-z0-9][a-z0-9-]{0,39}\/[A-Za-z0-9_]{1,64})$/;
/** An attribute name a view setting may hold: ATTR_NAME_RE's two forms, a built-in name also taking "." and "-" (HLA-A1). */
export const VIEW_ATTR_RE = /^(?:[A-Za-z0-9_.-]{1,64}|custom:[a-z0-9][a-z0-9-]{0,39}\/[A-Za-z0-9_]{1,64})$/;

/** A document's mention of an upload: an attribute of it ("custom:<name>/<COLUMN>") or the upload
 *  itself ("custom:<name>", an upload clause's dataset). Group 1 is the upload's name. */
export const CUSTOM_REF_RE = /"custom:([a-z0-9][a-z0-9-]{0,39})[/"]/g;
/** An upload clause's dataset: the upload's name as its attributes carry it */
export const UPLOAD_DATASET_RE = /^custom:([a-z0-9][a-z0-9-]{0,39})$/;

export const LIMITS = {
  datasets: 10,
  columns: 64,
  /** rows × columns over every dataset in one request: 10k patients × 50 fields fits */
  cells: 600_000,
  valueLength: 500,
  nameLength: 120
};

export function customAttr(dataset: string, column: string): string {
  return CUSTOM_PREFIX + dataset + "/" + column;
}
export function isCustomAttr(a: unknown): boolean {
  return typeof a === "string" && a.startsWith(CUSTOM_PREFIX);
}
export function parseCustomAttr(a: string): { dataset: string; column: string } | null {
  if (!ATTR_NAME_RE.test(a) || !a.startsWith(CUSTOM_PREFIX)) return null;
  const [dataset, column] = a.slice(CUSTOM_PREFIX.length).split("/");
  return { dataset, column };
}

/** How an attribute reads to a person: a custom one by its column, long form with its dataset. */
export function attributeLabel(a: string, form: "short" | "long" = "long"): string {
  const p = parseCustomAttr(a);
  if (!p) return a;
  return form === "short" ? p.column : p.column + " (custom: " + p.dataset + ")";
}
