// Clinical sample and patient files (notes/legacy-java-importer.md §C): the `#` header lines name,
// describe, type and rank each attribute; values the legacy importer treats as missing are not
// stored; OS_STATUS/DFS_STATUS get their 1:/0: prefix; samples of normal tissue are not created.
import path from "node:path";
import { Inserter, insertAll } from "./ch-write.ts";
import { ImportContext, skip, sampleId, tcgaPatient, isNormalBarcode, TCGA_SAMPLE_TYPES } from "./context.ts";
import { openTable, type DataFile } from "./study.ts";

const MISSING = new Set(["NOT_APPLICABLE", "NOT_AVAILABLE", "PENDING", "DISCREPANCY", "COMPLETED", "NULL", "MISSING", "NA"]);

/** `MissingAttributeValues.has`: blank, or one of the tokens once brackets and `|` are removed. */
export function isMissing(v: string): boolean {
  if (!v.trim()) return true;
  return MISSING.has(v.replace(/[[\]|]/g, "").replace(/ /g, "_").toUpperCase());
}

const SURVIVAL_EVENT = new Set(["DECEASED", "RECURRED_PROGRESSED", "RECURRED", "PROGRESSED"]);
const SURVIVAL_CENSORED = new Set(["LIVING", "DISEASEFREE"]);

/** OS_STATUS / DFS_STATUS values get the `1:`/`0:` prefix the survival code reads. */
export function survivalValue(attr: string, v: string): string {
  if (attr !== "OS_STATUS" && attr !== "DFS_STATUS") return v;
  const key = v.toUpperCase().replace(/\//g, "_");
  if (SURVIVAL_EVENT.has(key)) return "1:" + v;
  if (SURVIVAL_CENSORED.has(key)) return "0:" + v;
  return v;
}

const NORMAL_TYPES = new Set(["BLOOD_DERIVED_NORMAL", "SOLID_TISSUES_NORMAL"]);
const SAMPLE_TYPE_NAMES: Record<string, string> = {
  PRIMARY_SOLID_TUMOR: "Primary Solid Tumor", RECURRENT_SOLID_TUMOR: "Recurrent Solid Tumor",
  PRIMARY_BLOOD_TUMOR: "Primary Blood Tumor", RECURRENT_BLOOD_TUMOR: "Recurrent Blood Tumor", METASTATIC: "Metastatic"
};

interface AttrMeta { id: string; display: string; description: string; datatype: string; priority: string }

/** Attribute metadata from the four `#` lines; without them every column is a STRING named as its id. */
function attributeMeta(comments: string[], header: string[]): AttrMeta[] {
  const rows = comments.map((c) => c.replace(/^#+/, "").split("\t"));
  const at = (r: number, i: number, dflt: string) => (rows[r]?.[i] ?? "").trim() || dflt;
  return header.map((h, i) => ({
    id: h.trim().toUpperCase(),
    display: at(0, i, h),
    description: at(1, i, h),
    datatype: at(2, i, "STRING"),
    priority: at(3, i, "1")
  }));
}

/** First definition of an attribute in the study wins. */
async function storeMeta(ctx: ImportContext, attrs: AttrMeta[], patientLevel: boolean, seen: Set<string>): Promise<void> {
  const rows = attrs.filter((a) => a.id !== "PATIENT_ID" && a.id !== "SAMPLE_ID" && !seen.has(a.id)).map((a) => {
    seen.add(a.id);
    return { attr_id: a.id, display_name: a.display, description: a.description, datatype: a.datatype,
      patient_attribute: patientLevel ? 1 : 0, priority: a.priority, cancer_study_id: ctx.cancerStudyId };
  });
  await insertAll(ctx.conn, "clinical_attribute_meta", rows);
}

export async function importClinicalSamples(ctx: ImportContext, f: DataFile, seen: Set<string>): Promise<void> {
  const r = ctx.report(path.basename(f.file), "clinical (sample)");
  const t = await openTable(f.file);
  const attrs = attributeMeta(t.comments, t.header);
  const col = (id: string) => attrs.findIndex((a) => a.id === id);
  const iSample = col("SAMPLE_ID"), iPatient = col("PATIENT_ID"), iType = col("SAMPLE_TYPE");
  if (iSample < 0) throw new Error(path.basename(f.file) + " has no SAMPLE_ID column");
  await storeMeta(ctx, attrs, false, seen);
  const ins = new Inserter(ctx.conn, "clinical_sample");
  const done = new Set<string>();
  for await (const row of t.rows) {
    r.read++;
    const raw = (row[iSample] ?? "").trim();
    if (!raw) { skip(r, "no sample id"); continue; }
    const typeKey = iType >= 0 ? (row[iType] ?? "").trim().toUpperCase().replace(/ /g, "_") : "";
    if (isNormalBarcode(raw) || NORMAL_TYPES.has(typeKey)) { skip(r, "normal-tissue sample (not stored)"); continue; }
    const sid = sampleId(raw);
    if (done.has(sid)) { skip(r, "duplicate sample (first row kept)"); continue; }
    done.add(sid);
    const pid = tcgaPatient(raw) || (iPatient >= 0 ? (row[iPatient] ?? "").trim() : "") || sid;
    const patient = ctx.patient(pid);
    if (!ctx.samples.has(sid)) ctx.samples.set(sid, { id: ctx.id("sample"), patient });
    const sample = ctx.samples.get(sid)!;
    const tcgaType = raw.startsWith("TCGA") ? TCGA_SAMPLE_TYPES[/^TCGA-\w\w-\w\w\w\w-(\d\d)/.exec(sid)?.[1] ?? ""] : undefined;
    ctx.sampleTypes.set(sample.id, tcgaType ?? SAMPLE_TYPE_NAMES[typeKey] ?? "Primary Solid Tumor");
    for (let i = 0; i < attrs.length; i++) {
      if (i === iSample || i === iPatient) continue;
      const v = (row[i] ?? "").trim();
      if (isMissing(v)) continue;
      await ins.add({ internal_id: sample.id, attr_id: attrs[i].id, attr_value: v });
    }
    r.stored++;
  }
  await ins.flush();
}

export async function importClinicalPatients(ctx: ImportContext, f: DataFile, seen: Set<string>): Promise<void> {
  const r = ctx.report(path.basename(f.file), "clinical (patient)");
  const t = await openTable(f.file);
  const attrs = attributeMeta(t.comments, t.header);
  const iPatient = attrs.findIndex((a) => a.id === "PATIENT_ID");
  if (iPatient < 0) throw new Error(path.basename(f.file) + " has no PATIENT_ID column");
  await storeMeta(ctx, attrs, true, seen);
  const ins = new Inserter(ctx.conn, "clinical_patient");
  const done = new Set<string>();
  for await (const row of t.rows) {
    r.read++;
    const pid = (row[iPatient] ?? "").trim();
    if (!pid) { skip(r, "no patient id"); continue; }
    if (done.has(pid)) { skip(r, "duplicate patient (first row kept)"); continue; }
    done.add(pid);
    if (!ctx.patients.has(pid)) r.notes.push("patient " + pid + " has no samples");
    const patient = ctx.patient(pid);
    for (let i = 0; i < attrs.length; i++) {
      if (i === iPatient) continue;
      const v = (row[i] ?? "").trim();
      if (isMissing(v)) continue;
      await ins.add({ internal_id: patient, attr_id: attrs[i].id, attr_value: survivalValue(attrs[i].id, v) });
    }
    r.stored++;
  }
  await ins.flush();
  if (r.notes.length > 5) r.notes.splice(5, r.notes.length - 5, "… and " + (r.notes.length - 5) + " more patients without samples");
}
