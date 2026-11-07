// Signatures view: the cohort's patients with mutational-signature values, and one patient's
// signatures (cBioPortal's Mutational Signatures tab) — each signature's contribution in each sample,
// its significance where the study records p-values, and one sample's mutational spectrum where the
// study has the counts profile. Row sources in ./sql.ts, the rules in ./data.ts, the figure ./figure.ts.
import type { ViewResult } from "../../types.ts";
import type { PatientLevelCapable, Resolver } from "../../federation.ts";
import type { TablePart } from "../../mutation-table.ts";
import { checkQuery, describeQuery, shownColumns, type TableQuery } from "../../table-query.ts";
import { PATIENT_ID } from "../../patient-timeline.ts";
import { patientSamplesSource } from "../../patient-alterations.ts";
import { sampleMarks } from "../../timeline-tracks.ts";
import type { ViewRun } from "../run.ts";
import { TABLE_ROWS_MAX, listPosition, rowHolders, runRows, tableTail, viewQuery, type Rows } from "../rows.ts";
import { plural, refuse } from "../shared.ts";
import { SIGNATURE_PATIENT_COLUMNS, SIGNATURE_PATIENT_DEFAULT_COLUMNS, signaturePatientsSource, signatureValuesSource, type SignaturePart } from "./sql.ts";
import { SIGNIFICANT_P, defaultVersion, pairsOf, signatureFamilies, signatureRows, spectrumOf, spectrumUnit, versionLabel, YMAX_MAX, YMAX_MIN, type SignatureFamily } from "./data.ts";
import type { SignaturesView, SignaturesResult } from "./types.ts";
import { signaturesMethod } from "./method.ts";
import { REFERENCE_SOURCE, referenceProfile, referenced } from "./reference.ts";

const VERSION = /^[A-Za-z0-9.]{1,20}$/;
const SAMPLE_ID = /^[A-Za-z0-9._-]{1,120}$/;

export async function runSignatures(view: SignaturesView, ctx: ViewRun): Promise<ViewResult> {
  const { vNames } = ctx;
  const no = (msg: string) => refuse("signatures", ctx, msg);
  if (vNames.length !== 1) return no("a signatures view steps through one cohort's patients; this one draws " + vNames.length + " — name one in cohorts");
  const show = view.rows == null ? 25 : Math.floor(Number(view.rows));
  if (!(show >= 1 && show <= TABLE_ROWS_MAX)) return no("rows (the page size of the patient list) is 1 to " + TABLE_ROWS_MAX);
  if (view.patient != null && (typeof view.patient !== "object" || typeof view.patient.study !== "string" || typeof view.patient.id !== "string" || !PATIENT_ID.test(view.patient.id)))
    return no("patient is {study, id}: a study of the view's cohort and a patient id in it, e.g. {\"study\": \"pancan_pcawg_2020\", \"id\": \"DO51954\"}");
  if (view.version != null && (typeof view.version !== "string" || !VERSION.test(view.version))) return no("version is a signature type, e.g. \"SBS\", \"DBS\", \"ID\" or \"v2\"");
  if (view.sample != null && (typeof view.sample !== "string" || !SAMPLE_ID.test(view.sample))) return no("sample is one of the patient's sample ids");
  if (view.scale != null && view.scale !== "percent" && view.scale !== "count") return no("scale is \"percent\" (each channel's share of the sample's mutations, the default) or \"count\"");
  if (view.signature != null && (typeof view.signature !== "string" || !view.signature.trim() || view.signature.length > 200)) return no("signature is the name of one of the table's signatures, e.g. \"SBS5\"");
  if (view.ymax != null && !(Number.isInteger(view.ymax) && view.ymax >= YMAX_MIN && view.ymax <= YMAX_MAX)) return no("ymax is the Y-axis Max slider: a whole percent from " + YMAX_MIN + " to " + YMAX_MAX + " (100, the default, draws the whole axis)");
  if (view.samples != null && view.samples !== "patient" && view.samples !== "cohort")
    return no("samples is \"patient\" (every sample of the patient, the default) or \"cohort\" (only the cohort's samples)");
  if (ctx.table != null) return no("a signatures view pages only its patient list: no table may be named");
  const scope = view.samples || "patient";
  const scale = view.scale || "percent";
  const ymax = view.ymax ?? YMAX_MAX;
  const q = viewQuery(view);
  { const bad = checkQuery(q, SIGNATURE_PATIENT_COLUMNS); if (bad) return no(bad); }

  // who may answer: a local patient-level participant (no peer serves this view's rows)
  const { holders, excluded } = rowHolders(ctx);
  if (!holders.length) return no("no study here may disclose a patient's mutational signatures (" + excluded.map((e) => e.study + ": " + e.reason).join("; ") + ")");
  if (view.patient && !ctx.vStudies.includes(view.patient.study))
    return no("patient " + view.patient.id + " is named in " + view.patient.study + ", which this view's cohort does not span (" + ctx.vStudies.join(", ") + ")");
  if (view.patient && !holders.includes(view.patient.study))
    return no(view.patient.study + " is " + excluded.find((e) => e.study === view.patient!.study)!.reason + ", so its patients' signatures cannot be shown");

  // each study's signature profiles, by type
  const fams = new Map<string, SignatureFamily[]>();
  const gaOf = new Map<string, string[]>();
  for (const st of holders) {
    const ga = (await ctx.studyProfiles(st)).gaProfiles;
    gaOf.set(st, ga);
    fams.set(st, signatureFamilies(ga).filter((f) => f.contribution));
  }
  const held = [...new Set([...fams.values()].flatMap((fs) => fs.map((f) => f.version)))].sort();
  if (!held.length) {
    const ga = [...new Set([...gaOf.values()].flat())].sort();
    return no("no study of this cohort has a mutational-signature profile (mutational_signatures_contribution_<type>) — " +
      (ga.length ? "its generic-assay profiles: " + ga.join(", ") : "it has no generic-assay profiles"));
  }
  if (view.version && !held.includes(view.version))
    return no("no study of this cohort has " + view.version + " signatures (mutational_signatures_contribution_" + view.version + "); signature types here: " + held.join(", "));

  const defaults = SIGNATURE_PATIENT_DEFAULT_COLUMNS;
  const shown = shownColumns(q, SIGNATURE_PATIENT_COLUMNS, defaults);
  const partsOf = (parts: TablePart[]): SignaturePart[] => parts.map((p) => ({ ...p,
    profiles: (fams.get(p.study) || []).filter((f) => !view.version || f.version === view.version).map((f) => f.contribution!) }));
  const listRows = (size: number, opts: { values?: boolean; locate?: { study: string; patient: string } } = {}) =>
    runRows(ctx, "signatures", holders, q, defaults, shown, size, (parts) => (db) => signaturePatientsSource(partsOf(parts), db, scope),
      opts.values && ctx.values ? { column: ctx.values, numeric: !!SIGNATURE_PATIENT_COLUMNS.find((c) => c.id === ctx.values)?.numeric } : undefined, undefined, opts.locate);
  const listColumns = SIGNATURE_PATIENT_COLUMNS.map((c) => ({ id: c.id, name: c.name, numeric: c.numeric }));
  const n = (x: unknown) => x == null || x === "" ? null : Number(x);
  const listOf = (r: Rows) => ({ columns: listColumns, shown, defaults, query: q, pageSize: show, offset: r.offset, lists: r.lists, total: r.total, all: r.all,
    rows: r.rows.map((x) => ({ cohort: String(x.cohort ?? ""), study: String(x.study ?? ""), patient: String(x.patient ?? ""), sample: "",
      values: listColumns.map((c) => c.numeric ? n(x[c.id]) : String(x[c.id] ?? "")) })),
    ...(r.groups > 1 ? { instances: r.groups } : {}), ...(excluded.length ? { excluded } : {}), ...(r.values ? { values: r.values } : {}) });
  const bare = { versions: [], version: null, profiles: null, profiled: [], notProfiled: [], signatures: [], spectrum: null, counted: [], scale, ymax, referenced: [], reference: null };
  const typeWords = view.version ? view.version + " signature values" : "mutational-signature values";

  try {
    const r = await listRows(show, { values: true, locate: view.patient && !ctx.page && !ctx.values ? { study: view.patient.study, patient: view.patient.id } : undefined });
    if (ctx.page || ctx.values) return { kind: "signatures", cohorts: vNames, signatures: { ...listOf(r), patient: null, ...bare }, participation: ctx.participationFor(ctx.vStudies, true) };

    const want = view.patient ? { study: view.patient.study, id: view.patient.id } : r.rows[0] ? { study: String(r.rows[0].study), id: String(r.rows[0].patient) } : null;
    if (!want) {
      if (r.all > 0) return no("the patient list's query keeps none of the " + plural(r.all, "patient") + " with " + typeWords + " (" + describeQuery(q, listColumns) + ")");
      const everyone = await runRows(ctx, "signatures:everyone", holders, {}, defaults, shown, 1, (parts) => (db) => signaturePatientsSource(partsOf(parts), db, scope, false));
      return no("none of this cohort's " + plural(everyone.total, "patient") + " has " + typeWords + " in " + held.map((v) => "mutational_signatures_contribution_" + v).join(", "));
    }
    const fam = fams.get(want.study) || [];
    if (!fam.length) return no(want.study + " has no mutational-signature profile; studies of this cohort with one: " + holders.filter((st) => fams.get(st)?.length).join(", "));
    if (view.patient && !r.position) {
      // the named patient: one the list's query leaves out is drawn if it has values; else the reason it cannot be
      const res = ctx.resolvers[want.study] as unknown as PatientLevelCapable & Resolver;
      const member: TableQuery = { filters: { patient: { op: "equals", value: want.id } } };
      const parts = partsOf(vNames.filter((cn) => ctx.cohorts[cn].studies.includes(want.study)).map((cn) => ({ cohort: cn, study: want.study, cohortSql: res.cohortSql(ctx.doc.cohorts[cn]) })));
      const row = (await res.rowsPage("signatures:member", (db) => signaturePatientsSource(parts, db, scope, false), member, defaults, 1, 0)).rows[0];
      if (!row) return no(want.id + " is not a patient of this cohort in " + want.study);
      if (!(Number(row.profiled) > 0)) return no(want.id + " has no " + typeWords + " in " + want.study + " (" + plural(Number(row.samples), "sample") + ", none profiled" +
        (scope === "cohort" ? " among the cohort's" : "") + "); signature types " + want.study + " holds: " + fam.map((f) => f.version).join(", "));
    }

    // the patient's samples in order (the numbered markers), and their values in every signature profile of the study
    const [smp, vals] = await Promise.all([
      runRows({ ...ctx, page: undefined, values: undefined }, "signatures:samples", [want.study], {}, ["sid"], ["sid", "type"], TABLE_ROWS_MAX,
        (parts: TablePart[]) => (db) => patientSamplesSource(parts[0], want.id, db, scope)),
      runRows({ ...ctx, page: undefined, values: undefined }, "signatures:values", [want.study], {}, ["profile", "entity"], ["profile", "entity"], TABLE_ROWS_MAX,
        (parts: TablePart[]) => (db) => signatureValuesSource(parts[0], want.id, db, fam.flatMap((f) => [f.contribution, f.pvalue, f.counts].filter((x): x is string => !!x)), scope)),
    ]);
    if (vals.total > vals.rows.length) return no(want.id + "'s signature profiles hold " + vals.total.toLocaleString("en-US") + " entities; this view reads at most " + TABLE_ROWS_MAX.toLocaleString("en-US"));
    const samples0 = smp.rows.map((x) => ({ id: String(x.sid), type: String(x.type ?? "") }));
    const marks = sampleMarks(samples0, []);
    const samples = [...marks.values()].map((m) => ({ id: m.id, type: samples0.find((s) => s.id === m.id)?.type || "", label: m.label }));
    const order = samples.map((s) => s.id);
    const byProfile = new Map<string, { entity: string; name: string; description: string; url: string; vals: Map<string, number | null> }[]>();
    for (const x of vals.rows) {
      const k = String(x.profile);
      if (!byProfile.has(k)) byProfile.set(k, []);
      byProfile.get(k)!.push({ entity: String(x.entity), name: String(x.name ?? ""), description: String(x.description ?? ""), url: String(x.url ?? ""), vals: pairsOf(x.vals) });
    }
    const valued = (pt: string | null) => new Set((pt ? byProfile.get(pt) || [] : []).flatMap((e) => [...e.vals].filter(([, v]) => v != null).map(([s]) => s)));
    const versions = fam.filter((f) => valued(f.contribution).size > 0).map((f) => f.version);
    if (!versions.length) return no(want.id + " has no mutational-signature values in " + want.study + "; signature types it holds: " + fam.map((f) => f.version).join(", "));
    if (view.version && !fam.some((f) => f.version === view.version))
      return no(want.study + " has no " + view.version + " signatures (mutational_signatures_contribution_" + view.version + "); it has " + fam.map((f) => f.version).join(", "));
    if (view.version && !versions.includes(view.version)) return no(want.id + " has no " + view.version + " signature values; " + want.id + " has values for " + versions.join(", "));
    const version = view.version || defaultVersion(versions)!;
    const f = fam.find((x) => x.version === version)!;
    const has = valued(f.contribution);
    const profiled = order.filter((s) => has.has(s));
    const notProfiled = order.filter((s) => !has.has(s));
    const signatures = signatureRows(byProfile.get(f.contribution!) || [], f.pvalue ? byProfile.get(f.pvalue) || [] : [], profiled);
    // the spectrum: the sample named, else the first (in sample order) with counts
    const counted = f.counts ? order.filter((s) => valued(f.counts).has(s)) : [];
    if (view.sample && !order.includes(view.sample)) return no("sample " + view.sample + " is not one of " + want.id + "'s samples" + (scope === "cohort" ? " in the cohort" : "") + " (" + order.join(", ") + ")");
    if (view.sample && f.counts && !counted.includes(view.sample)) return no(view.sample + " has no " + version + " mutation counts; samples with counts: " + (counted.join(", ") || "none"));
    const spectrumSample = f.counts ? (view.sample || counted[0] || null) : null;
    const spectrum = spectrumSample ? { sample: spectrumSample, ...spectrumOf(byProfile.get(f.counts!) || [], spectrumSample) } : null;
    const noSpectrum = !f.counts ? want.study + " has no " + version + " counts profile (mutational_signatures_" + "counts_" + version + "), so no mutational spectrum is drawn"
      : !spectrum ? "none of " + want.id + "'s samples has " + version + " mutation counts" : undefined;

    // the COSMIC reference profile drawn under the spectrum: the signature named, when the spectrum is drawn
    const withReference = spectrum ? referenced(version, signatures.map((r) => r.name)) : [];
    let reference: SignaturesResult["reference"] = null;
    if (view.signature != null) {
      if (!signatures.some((r) => r.name === view.signature))
        return no("signature " + view.signature + " is not one of " + want.id + "'s " + version + " signatures (" + signatures.map((r) => r.name).join(", ") + ")");
      if (!spectrum) return no("signature draws its COSMIC reference profile under the sample's spectrum, and there is none: " + noSpectrum);
      const ref = referenceProfile(version, view.signature, spectrum.channels.map((c) => c.label));
      if (typeof ref === "string") return no(ref + "; signatures here with a reference profile: " + (withReference.join(", ") || "none"));
      reference = { signature: view.signature, key: ref.key, source: REFERENCE_SOURCE, values: ref.values };
    }

    const position = await listPosition(r, !!view.patient, (first) => listRows(1, { locate: first }));
    const list = listOf(r);
    const sortName = q.sort ? listColumns.find((c) => c.id === q.sort!.column)?.name || q.sort.column : null;
    const significant = signatures.reduce((a, s) => a + s.values.filter((v) => v.p != null && v.p < SIGNIFICANT_P).length, 0);
    const result: SignaturesResult = { ...list, patient: { ...want, samples }, position, versions, version,
      profiles: { contribution: f.contribution!, pvalue: f.pvalue, counts: f.counts }, profiled, notProfiled, signatures,
      spectrum, ...(noSpectrum ? { noSpectrum } : {}), counted, scale, ymax, referenced: withReference, reference };
    return {
      kind: "signatures", cohorts: vNames,
      signatures: result,
      method: signaturesMethod({ cohorts: vNames, queryText: describeQuery(q, listColumns), sortName, desc: !!q.sort?.desc, shown: list.rows.length, lists: r.lists, excluded, instances: r.groups,
        patient: want, version, profiles: result.profiles!, profiled, signatures: signatures.length, spectrum, reference }),
      participation: ctx.participationFor(ctx.vStudies, true),
      ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
      caveat: want.id + ": " + versionLabel(version) + " from " + f.contribution + ", " + plural(profiled.length, "sample") + " profiled" +
        (notProfiled.length ? " (" + notProfiled.join(", ") + (notProfiled.length === 1 ? " is" : " are") + " not profiled for mutational signatures)" : "") + ". " +
        (versions.length > 1 ? "The patient also has " + versions.filter((x) => x !== version).join(", ") + " signatures. " : "") +
        "A contribution is the share of the sample's mutations the study's signature fitting assigned to the signature, as stored; a missing value is NA, not 0. " +
        (f.pvalue ? "Significant (p < " + SIGNIFICANT_P + " in " + f.pvalue + "): " + plural(significant, "signature–sample value") + ". "
          : "This study records no p-value profile for " + version + " (mutational_signatures_pvalue_" + version + "), so no signature is marked significant. ") +
        (spectrum ? spectrum.sample + "'s spectrum: " + spectrum.total.toLocaleString("en-US") + " " + spectrumUnit(version) + " counted in " + spectrum.channels.length + " channels, drawn " +
          (scale === "percent" ? "as each channel's share of them" : "as counts") + "; the counts may include silent and non-coding mutations not shown elsewhere. " +
          (ymax < YMAX_MAX ? "The axis is cut at the Y-axis Max (" + ymax + "); a bar past it stops at the axis. " : "") +
          (reference ? "Under it, " + reference.key + "'s reference profile from " + REFERENCE_SOURCE + ", in percent of the signature's mutations. " : "") : noSpectrum + ". ") +
        "The patient list holds the cohort's patients with " + typeWords + ": " + tableTail(r, q, listColumns, "patient", "with the most profiled samples first, then by patient id", excluded, false),
    };
  } catch (e) { return no((e as Error).message); }
}
