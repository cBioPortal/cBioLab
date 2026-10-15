// Composition view: what each case is made of — cell types, cell states, signature contributions —
// as parts of a whole, compared between cohorts.
import type { ViewResult, CompositionView, CompositionCell, CompositionResult } from "../types.ts";
import { compositionMomentsSql, compositionEntitiesSql, assayProfileSql, assayEntityNamesSql } from "../federation-views.ts";
import { welchT, benjaminiHochberg, varianceFromMoments } from "../stats.ts";
import { isPatientLevel } from "../federation.ts";
import { compositionMethod } from "../method.ts";
import {
  COMPOSITION_MAX_PARTS, COMPOSITION_CASES_CAP, COMPOSITION_EPS, compositionCasesSql, partNames, validateSource, type CompositionSource
} from "../composition.ts";
import type { ViewRun } from "./run.ts";
import { overLimit, answering, refuse } from "./shared.ts";
import { PROFILE_NAME } from "./assays.ts";

const MAX_COHORTS = 8;

/** one cohort's sums, added across its studies */
interface Sums { n: number; sx: number[]; sxx: number[]; hx: number; hxx: number; incomplete: number; invalid: number }

/** "A and B are drawn as their means (why)", one clause per reason */
function meanOnly(groups: CompositionResult["groups"]): string {
  const byWhy = new Map<string, string[]>();
  for (const g of groups) if (!g.cases) byWhy.set(g.casesWhy || "", [...(byWhy.get(g.casesWhy || "") || []), g.cohort]);
  return [...byWhy].map(([why, names]) => names.join(", ") + (names.length === 1 ? " is drawn as its mean" : " are drawn as their means") +
    (why ? " (" + why + ")" : "") + ". ").join("");
}

export async function runComposition(view: CompositionView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  const no = (e: string) => refuse("composition", ctx, e);
  if (!vNames.length) return no("a composition view draws one or more cohorts; this one draws none");
  { const e = overLimit("a composition view", MAX_COHORTS, vNames.length); if (e) return no(e.replace("at most " + MAX_COHORTS, "at most " + MAX_COHORTS + " cohorts")); }
  const hasProfile = view.profileType != null && view.profileType !== "";
  const hasAttrs = Array.isArray(view.attributes) && view.attributes.length > 0;
  if (hasProfile === hasAttrs)
    return no(hasProfile ? "name the parts one way: profileType (a generic-assay profile) or attributes (clinical attributes), not both"
      : "name the parts: profileType (a generic-assay profile, e.g. cell_type_relative_counts) or attributes (2–" + COMPOSITION_MAX_PARTS + " numeric clinical attributes)");
  const normalize = view.normalize !== false;
  const { ok, excluded } = answering(ctx);

  // ---- the parts, and which studies can answer for them
  let src: CompositionSource, holders: string[], sourceName: string, names: Map<string, string> | undefined;
  if (hasProfile) {
    const pt = String(view.profileType);
    if (!PROFILE_NAME.test(pt)) return no("profileType names a generic-assay profile, e.g. cell_type_relative_counts");
    const inventory = await Promise.all(Object.keys(ok).map(async (st) => ({ st, ga: (await ctx.studyProfiles(st)).gaProfiles })));
    holders = inventory.filter((x) => x.ga.includes(pt)).map((x) => x.st);
    for (const x of inventory) if (!x.ga.includes(pt)) excluded.push({ study: x.st, reason: "has no " + pt + " profile" });
    if (!holders.length) {
      const avail = [...new Set(inventory.flatMap((x) => x.ga))].sort();
      return no("no study here has a generic-assay profile “" + pt + "” — " + (avail.length ? "available: " + avail.join(", ") : "these studies have no generic-assay profiles"));
    }
    const metas = await Promise.all(holders.map(async (st) => (await ok[st].viewMeta("composition:profile", (s, d) => assayProfileSql(s, d, pt)))[0] || {}));
    if (metas.some((m) => /^(CATEGORICAL|BINARY)$/i.test(String(m.datatype))))
      return no("“" + pt + "” is categorical; a composition's parts are numbers");
    const levels = new Set(metas.map((m) => Number(m.patient_level) === 1));
    if (levels.size > 1) return no("“" + pt + "” is per patient in some of these studies and per sample in others; draw one kind at a time");
    const all = [...new Set((await Promise.all(holders.map((st) => ok[st].viewMeta("composition:entities", (s, d) => compositionEntitiesSql(s, d, pt)))))
      .flat().map((r) => String(r.entity)))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const chosen = view.entities?.length ? view.entities.map(String) : all;
    const unknown = chosen.filter((e) => !all.includes(e));
    if (unknown.length) return no("“" + pt + "” has no entit" + (unknown.length === 1 ? "y " : "ies ") + unknown.map((e) => JSON.stringify(e)).join(", ") + " — it has " + all.join(", "));
    if (chosen.length > COMPOSITION_MAX_PARTS)
      return no("“" + pt + "” has " + chosen.length + " entities; a composition view draws at most " + COMPOSITION_MAX_PARTS +
        " parts — choose them with `entities` (it has " + all.join(", ") + ")");
    names = new Map<string, string>();
    for (const st of holders) for (const r of await ok[st].viewMeta("composition:names", (s, d) => assayEntityNamesSql(s, d, pt)))
      if (!names.has(String(r.entity))) names.set(String(r.entity), String(r.name));
    src = { kind: "genericAssay", profileType: pt, parts: chosen, unit: [...levels][0] ? "patient" : "sample", normalize };
    sourceName = String(metas[0].name || pt);
  } else {
    src = { kind: "clinical", parts: view.attributes!.map(String), unit: view.unit === "sample" ? "sample" : "patient", normalize };
    holders = Object.keys(ok);
    sourceName = "clinical attributes";
  }
  try { validateSource(src); } catch (e) { return no((e as Error).message); }
  const sortId = view.sort == null || view.sort === "" ? src.parts[0] : String(view.sort);
  const sortIndex = src.parts.indexOf(sortId);
  if (sortIndex < 0) return no("sort names no part: " + JSON.stringify(sortId) + " — the parts are " + src.parts.join(", "));
  const k = src.parts.length;
  const unit: "samples" | "patients" = src.unit === "patient" ? "patients" : "samples";

  // ---- per cohort: sums from every study, and the bars where the cases may be shown
  const perSite: { cohort: string; study: string; n: number }[] = [];
  const sums = new Map<string, Sums>(vNames.map((n) => [n, { n: 0, sx: Array(k).fill(0), sxx: Array(k).fill(0), hx: 0, hxx: 0, incomplete: 0, invalid: 0 }]));
  const bars = new Map<string, { cases?: number[][]; why?: string }>();
  await Promise.all(vNames.map(async (name) => {
    const sites = cohorts[name].studies.filter((st) => holders.includes(st));
    const def = doc.cohorts[name], acc = sums.get(name)!;
    await Promise.all(sites.map(async (st) => {
      const r = (await ok[st].viewAggregate("composition:moments:" + name, def, (c, s, d) => compositionMomentsSql(c, s, d, src)))[0] || {};
      const n = Number(r.n || 0);
      acc.n += n; acc.hx += Number(r.hx || 0); acc.hxx += Number(r.hxx || 0);
      acc.incomplete += Number(r.incomplete || 0); acc.invalid += Number(r.invalid || 0);
      if (n) {
        const sx = (r.sx as unknown as number[]).map(Number), sxx = (r.sxx as unknown as number[]).map(Number);
        for (let j = 0; j < k; j++) { acc.sx[j] += sx[j]; acc.sxx[j] += sxx[j]; }
      }
      perSite.push({ cohort: name, study: st, n });
    }));
    const closed = sites.filter((st) => !isPatientLevel(ctx.resolvers[st]));
    if (closed.length) { bars.set(name, { why: closed.join(", ") + " may not show individual cases" }); return; }
    if (acc.n > COMPOSITION_CASES_CAP) { bars.set(name, { why: "more than " + COMPOSITION_CASES_CAP.toLocaleString("en-US") + " " + unit + ", too many to draw one bar each" }); return; }
    const rows = (await Promise.all(sites.map((st) => {
      const r = ctx.resolvers[st];
      return isPatientLevel(r) ? r.viewRows("composition:cases:" + name, def, (c, s, d) => compositionCasesSql(src, s, d, c, sortIndex)) : Promise.resolve([]);
    }))).flat();
    const cases = rows.map((x) => (x.ps as unknown as number[]).map(Number));
    // each study's rows come sorted; a cohort over several studies is sorted again as one
    cases.sort((a, b) => b[sortIndex] - a[sortIndex]);
    bars.set(name, { cases });
  }));
  perSite.sort((a, b) => vNames.indexOf(a.cohort) - vNames.indexOf(b.cohort) || a.study.localeCompare(b.study));

  const total = [...sums.values()].reduce((a, s) => a + s.n, 0);
  if (!total) {
    const inc = [...sums.values()].reduce((a, s) => a + s.incomplete + s.invalid, 0);
    return no("no " + unit.replace(/s$/, "") + " in these cohorts has a value for every part" +
      (inc ? " (" + inc.toLocaleString("en-US") + " have some of them, or a part below zero)" : "") + " — the parts are " + src.parts.join(", "));
  }

  // ---- each cohort's means, and each (cohort, part) against the view's other cohorts pooled
  const cells: CompositionCell[] = [];
  const two = vNames.length === 2;
  for (const name of vNames) {
    const s = sums.get(name)!;
    for (let j = 0; j < k; j++) {
      const mean = s.n ? s.sx[j] / s.n : 0, v = varianceFromMoments(s.n, s.sx[j], s.sxx[j]);
      const cell: CompositionCell = { cohort: name, part: src.parts[j], n: s.n, mean, sd: s.n >= 2 ? Math.sqrt(v) : null };
      if (vNames.length >= 2) {
        const rest = vNames.filter((x) => x !== name).map((x) => sums.get(x)!);
        const rn = rest.reduce((a, r) => a + r.n, 0), rsx = rest.reduce((a, r) => a + r.sx[j], 0), rsxx = rest.reduce((a, r) => a + r.sxx[j], 0);
        const rmean = rn ? rsx / rn : 0, rv = varianceFromMoments(rn, rsx, rsxx);
        cell.log2 = Math.log2((mean + COMPOSITION_EPS) / (rmean + COMPOSITION_EPS));
        if (s.n >= 2 && rn >= 2 && v + rv > 0) cell.p = welchT(s.n, mean, v, rn, rmean, rv).p;
      }
      cells.push(cell);
    }
  }
  // with two cohorts each part's two cells are one comparison, so it is corrected for once
  const testedCells = cells.filter((c) => c.p != null && (!two || c.cohort === vNames[0]));
  benjaminiHochberg(testedCells.map((c) => c.p!)).forEach((q, i) => { testedCells[i].q = q; });
  if (two) for (const c of cells) if (c.cohort === vNames[1]) {
    const twin = cells.find((x) => x.cohort === vNames[0] && x.part === c.part);
    if (twin?.q != null) c.q = twin.q;
  }
  const significant = testedCells.filter((c) => c.q! < 0.05).length;

  const result: CompositionResult = {
    source: src.kind, sourceName, unit, normalize, sort: sortId,
    parts: src.parts.map((id, j) => ({ id, name: partNames(src.parts, names)[j] })),
    groups: vNames.map((name) => {
      const s = sums.get(name)!, b = bars.get(name) || {};
      const hv = varianceFromMoments(s.n, s.hx, s.hxx);
      return { cohort: name, n: s.n, incomplete: s.incomplete, invalid: s.invalid,
        entropy: s.n ? { mean: s.hx / s.n, sd: s.n >= 2 ? Math.sqrt(hv) : null } : null,
        ...(b.cases ? { cases: b.cases } : { casesWhy: b.why || "no " + unit + " to draw" }) };
    }),
    cells, tested: testedCells.length, significant, ...(excluded.length ? { excluded } : {})
  };
  const left = result.groups.reduce((a, g) => a + g.incomplete + g.invalid, 0);
  return {
    kind: "composition", cohorts: vNames, composition: result,
    method: compositionMethod({ source: src, sourceName, cohorts: vNames, perSite, unit, normalize, eps: COMPOSITION_EPS,
      sums: vNames.map((name) => ({ cohort: name, ...sums.get(name)! })), cells, two }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Each " + unit.replace(/s$/, "") + "'s " + k + " parts (" + (src.kind === "genericAssay" ? "entities of “" + sourceName + "”" : "clinical attributes") + ")" +
      (normalize ? ", divided by their sum so every bar is a whole" : ", as recorded") + "; cases ordered by " + result.parts[sortIndex].name + ", highest first. " +
      (left ? left.toLocaleString("en-US") + " " + unit + " left out: some parts missing, a part below zero, or none above zero. " : "") +
      (vNames.length >= 2
        ? "Each cohort is compared with the view's other cohorts pooled, part by part: log2 of the ratio of means (each + " + COMPOSITION_EPS +
          "), Welch's t from the cohorts' n, mean and variance, Benjamini–Hochberg across the " + testedCells.length + " comparisons. " +
          "Parts of a whole are not independent — one part's rise is the others' fall — and a case in two cohorts counts in both. "
        : "") +
      "Entropy is Shannon's (natural log) over each case's shares. " +
      meanOnly(result.groups) +
      (holders.length > 1 ? "Sums are added across " + holders.length + " studies; overlap is not deduplicated and no batch correction is made. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
