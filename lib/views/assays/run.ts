// Assays view: every entity of one generic-assay profile, compared between cohorts
import type { ViewResult } from "../../types.ts";
import { assayProfileSql, assayEntityNamesSql } from "../../federation-views.ts";
import { chiSquareTest, benjaminiHochberg, welchT, welchAnovaTest, varianceFromMoments } from "../../stats.ts";
import type { ViewRun } from "../run.ts";
import { overLimit, answering, refuse, niceCeil, PROFILE_NAME, askEachSite } from "../shared.ts";
import type { AssaysView, AssaysEntity, AssaysResult } from "./types.ts";
import { assayMomentsSql, assayValueCountsSql } from "./sql.ts";
import { assaysMethod } from "./method.ts";

const ASSAY_ROWS = 300;
/** past this many entities a profile is refused rather than compared: the per-cohort answer
 *  carries a row per entity, and a probe-level profile has hundreds of thousands */
const ASSAY_MAX_ENTITIES = 20000;
/** values a categorical assay uses for "not called"; counted apart, never a category */
const MISSING_VALUES = new Set(["", "NA", "N/A", "NaN", "nan", "null", "NULL"]);

export async function runAssays(view: AssaysView, ctx: ViewRun): Promise<ViewResult> {
  const { doc, cohorts, vNames } = ctx;
  if (vNames.length < 2) return refuse("assays", ctx, "an assays view compares two or more cohorts; this one draws " + vNames.length);
  { const e = overLimit("an assays view", 6, vNames.length); if (e) return refuse("assays", ctx, e.replace("at most 6", "at most 6 cohorts")); }
  const pt = String(view.profileType || "");
  if (!PROFILE_NAME.test(pt)) return refuse("assays", ctx, "profileType names a generic-assay profile, e.g. mutational_signatures_contribution_v2");
  const minN = view.minN == null ? 3 : Math.floor(Number(view.minN));
  if (!(minN >= 2 && minN <= 10000)) return refuse("assays", ctx, "minN is 2 to 10000");
  const label = view.label == null ? 12 : Math.floor(Number(view.label));
  if (!(label >= 0 && label <= 40)) return refuse("assays", ctx, "label is 0 to 40 entities");
  const empty = vNames.filter((n) => !cohorts[n].count);
  if (empty.length) return refuse("assays", ctx, "nothing to compare: cohort " + empty.map((n) => "“" + n + "”").join(" and ") + (empty.length === 1 ? " is" : " are") + " empty");

  const { ok, excluded } = answering(ctx);
  const inventory = await Promise.all(Object.keys(ok).map(async (st) => ({ st, ga: (await ctx.studyProfiles(st)).gaProfiles })));
  const holders = inventory.filter((x) => x.ga.includes(pt)).map((x) => x.st);
  for (const x of inventory) if (!x.ga.includes(pt)) excluded.push({ study: x.st, reason: "has no " + pt + " profile" });
  if (!holders.length) {
    const avail = [...new Set(inventory.flatMap((x) => x.ga))].sort();
    return refuse("assays", ctx, "no study here has a generic-assay profile “" + pt + "” — " + (avail.length ? "available: " + avail.join(", ") : "these studies have no generic-assay profiles"));
  }
  const metas = await Promise.all(holders.map(async (st) => ({ st, m: (await ok[st].viewMeta("assays:profile", (s, d) => assayProfileSql(s, d, pt)))[0] || {} })));
  const assayType = String(metas[0].m.generic_assay_type || "");
  if (metas.some((x) => String(x.m.generic_assay_type || "") === "METHYLATION"))
    return refuse("assays", ctx, "“" + pt + "” is per-probe methylation: hundreds of thousands of probes per study, more than this view compares (at most " +
      ASSAY_MAX_ENTITIES.toLocaleString("en-US") + " entities) — compare chosen probes with a plot view, or split cohorts on one with a genericAssay clause");
  const categorical = (dt: unknown) => /^(CATEGORICAL|BINARY)$/i.test(String(dt));
  const kinds = new Set(metas.map((x) => categorical(x.m.datatype)));
  if (kinds.size > 1) return refuse("assays", ctx, "“" + pt + "” is categorical in " + metas.filter((x) => categorical(x.m.datatype)).map((x) => x.st).join(", ") +
    " and numeric in " + metas.filter((x) => !categorical(x.m.datatype)).map((x) => x.st).join(", ") + "; compare one kind at a time");
  const isCat = categorical(metas[0].m.datatype);
  const patientLevel = metas.every((x) => Number(x.m.patient_level) === 1);
  const unit: "samples" | "patients" = patientLevel ? "patients" : "samples";

  // numeric: n, Σx, Σx² per (cohort, entity); categorical: count per (cohort, entity, value)
  const mom = new Map<string, { n: number; sx: number; sxx: number }>();
  const counts = new Map<string, Map<string, number>>();
  const entities = new Set<string>();
  const names = new Map<string, string>();
  let missing = 0;
  const perSite: { cohort: string; study: string; rows: number }[] = [];
  const holding = Object.fromEntries(holders.map((st) => [st, ok[st]]));
  const [nameRows, answers] = await Promise.all([
    Promise.all(holders.map((st) => ok[st].viewMeta("assays:names", (s, d) => assayEntityNamesSql(s, d, pt)))),
    askEachSite(ctx, holding, (n, _st, r) => isCat
      ? r.viewAggregate("assays:values:" + n, doc.cohorts[n], (c, s, d) => assayValueCountsSql(c, s, d, pt))
      : r.viewAggregate("assays:moments:" + n, doc.cohorts[n], (c, s, d) => assayMomentsSql(c, s, d, pt)))
  ]);
  // the first study (in the view's order) to name an entity names it
  for (const rows of nameRows) for (const r of rows) if (!names.has(String(r.entity))) names.set(String(r.entity), String(r.name));
  for (const { cohort: n, study: st, answer: rows } of answers) {
    if (isCat) {
      for (const r of rows) {
        const v = String(r.value ?? "").trim(), c = Number(r.n);
        if (MISSING_VALUES.has(v)) { missing += c; continue; }
        const k = n + "\t" + r.entity;
        entities.add(String(r.entity));
        const m = counts.get(k) || new Map<string, number>();
        m.set(v, (m.get(v) || 0) + c); counts.set(k, m);
      }
    } else {
      for (const r of rows) {
        const k = n + "\t" + r.entity, cur = mom.get(k) || { n: 0, sx: 0, sxx: 0 };
        cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx); mom.set(k, cur);
        missing += Number(r.other);
        entities.add(String(r.entity));
      }
    }
    perSite.push({ cohort: n, study: st, rows: rows.length });
  }
  if (!entities.size) return refuse("assays", ctx, "none of these cohorts' " + unit + " has a value in “" + pt + "”");
  if (entities.size > ASSAY_MAX_ENTITIES) return refuse("assays", ctx, "“" + pt + "” has " + entities.size.toLocaleString("en-US") + " entities with values here; an assays view compares at most " + ASSAY_MAX_ENTITIES.toLocaleString("en-US"));

  const two = vNames.length === 2;
  const tested: AssaysEntity[] = [];
  let untested = 0;
  const valueTotals = new Map<string, number>();
  for (const e of [...entities].sort()) {
    const name = names.get(e) || e;
    if (isCat) {
      const per = vNames.map((n) => counts.get(n + "\t" + e) || new Map<string, number>());
      const vals = [...new Set(per.flatMap((m) => [...m.keys()]))].sort();
      for (const m of per) for (const [v, c] of m) valueTotals.set(v, (valueTotals.get(v) || 0) + c);
      const cells = vNames.map((n, i) => ({ cohort: n, n: [...per[i].values()].reduce((a, b) => a + b, 0), values: Object.fromEntries(vals.map((v) => [v, per[i].get(v) || 0])) }));
      if (vals.length < 2 || cells.some((c) => c.n < minN)) { untested++; continue; }
      const table = per.map((m) => vals.map((v) => m.get(v) || 0));
      const x = chiSquareTest(table);
      // the cell furthest above what independence expects says where the difference is
      const total = cells.reduce((a, c) => a + c.n, 0);
      let best = { r: -Infinity, cohort: vNames[0], value: vals[0] };
      vals.forEach((v, j) => {
        const col = table.reduce((a, row) => a + row[j], 0);
        cells.forEach((c, i) => { const exp = c.n * col / total; const r = exp > 0 ? (table[i][j] - exp) / Math.sqrt(exp) : 0; if (r > best.r) best = { r, cohort: c.cohort, value: v }; });
      });
      tested.push({ entity: e, name, cells, statistic: x.chi2, p: x.p, q: 1, higherIn: best.cohort, value: best.value });
    } else {
      const cells = vNames.map((n) => {
        const m = mom.get(n + "\t" + e) || { n: 0, sx: 0, sxx: 0 };
        const mean = m.n ? m.sx / m.n : null, v = varianceFromMoments(m.n, m.sx, m.sxx);
        return { cohort: n, n: m.n, mean, sd: m.n >= 2 ? Math.sqrt(v) : null, v };
      });
      const flat = cells.every((c) => c.v <= 1e-12 * (1 + (c.mean || 0) ** 2));
      if (cells.some((c) => c.n < minN) || flat) { untested++; continue; }
      let statistic: number, p: number;
      if (two) { const w = welchT(cells[0].n, cells[0].mean!, cells[0].v, cells[1].n, cells[1].mean!, cells[1].v); statistic = w.t; p = w.p; }
      else { const w = welchAnovaTest(cells.map((c) => ({ n: c.n, mean: c.mean!, variance: c.v }))); statistic = w.f; p = w.p; }
      const means = cells.map((c) => c.mean!);
      tested.push({ entity: e, name, cells: cells.map(({ v, ...c }) => { void v; return c; }),
        ...(two ? { diff: means[0] - means[1] } : {}), statistic, p, q: 1, higherIn: vNames[means.indexOf(Math.max(...means))] });
    }
  }
  if (!tested.length) return refuse("assays", ctx, "no entity of “" + pt + "” had at least " + minN + " " + unit + " with a value in every cohort" + (isCat ? " and two different values" : " and any spread"));
  benjaminiHochberg(tested.map((g) => g.p)).forEach((q, i) => { tested[i].q = q; });
  tested.sort((a, b) => a.p - b.p || a.entity.localeCompare(b.entity));
  const rows = tested.slice(0, ASSAY_ROWS);
  // only what is significant is named on the figure
  const labels = rows.filter((g) => g.q < 0.05).slice(0, label).map((g) => g.entity);
  let grid: AssaysResult["grid"];
  if (two && !isCat) {
    const lp = (p: number) => -Math.log10(Math.max(1e-300, p));
    const xMax = niceCeil(Math.max(1e-9, ...tested.map((g) => Math.abs(g.diff!))));
    const yMax = niceCeil(Math.max(1, ...tested.map((g) => lp(g.p))));
    const nx = 80, ny = 50, cellMap = new Map<string, number>();
    for (const g of tested.slice(ASSAY_ROWS)) {
      const bx = Math.min(nx - 1, Math.max(0, Math.floor((g.diff! + xMax) / (2 * xMax) * nx)));
      const by = Math.min(ny - 1, Math.floor(lp(g.p) / yMax * ny));
      cellMap.set(bx + "," + by, (cellMap.get(bx + "," + by) || 0) + 1);
    }
    grid = { xMax, yMax, nx, ny, cells: [...cellMap].map(([k, c]) => { const [x, y] = k.split(",").map(Number); return [x, y, c] as [number, number, number]; }) };
  }
  const significant = tested.filter((g) => g.q < 0.05).length;
  const test = isCat ? "Pearson chi-squared test (cohort × value)" : two ? "Welch's t-test" : "Welch's ANOVA";
  const values = isCat ? [...valueTotals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v) : undefined;
  const profileName = String(metas[0].m.name || pt);
  const multi = holders.length > 1;
  return {
    kind: "assays", cohorts: vNames,
    assays: { profileType: pt, profileName, assayType, datatype: isCat ? "categorical" : "numeric", unit, groups: vNames, tested: tested.length, untested, significant, minN, test,
      ...(values ? { values } : {}), missing, rows, ...(grid ? { grid } : {}), labels, ...(excluded.length ? { excluded } : {}) },
    method: assaysMethod({ profileType: pt, categorical: isCat, unit, cohorts: vNames, minN, test, perSite, tested: tested.length, untested, missing,
      moments: isCat ? [] : [...mom].map(([k, m]) => { const [cohort, entity] = k.split("\t"); return { cohort, entity, ...m }; }),
      counts: isCat ? [...counts].flatMap(([k, m]) => { const [cohort, entity] = k.split("\t"); return [...m].map(([value, n]) => ({ cohort, entity, value, n })); }) : [],
      results: rows.map((g) => ({ entity: g.entity, p: g.p, q: g.q })) }),
    participation: ctx.participationFor(ctx.vStudies, false),
    ...(ctx.vStudies.length > 1 ? { studies: ctx.vStudies } : {}),
    caveat: "Every entity of “" + profileName + "” (" + pt + ") compared across the cohorts, one value per " + unit.replace(/s$/, "") + " as the study recorded it" +
      (unit === "samples" ? ", from each cohort's own samples" : ", from the patients owning each cohort's samples") + ". " +
      (isCat
        ? "Values NA or blank mean not called and are left out (" + missing.toLocaleString("en-US") + " of them), not treated as a category. Each entity is tested with a " + test + " on its counts, no continuity correction; the χ² approximation is thin where a value is rare. "
        : "Values that are not numbers (a limit such as \">8\", or NA) are left out (" + missing.toLocaleString("en-US") + " of them). Each entity is tested with " + test +
          " from each cohort's n, mean and variance; with thousands of " + unit + " a tiny difference is significant, so read the means too. ") +
      tested.length.toLocaleString("en-US") + " entities tested; q is Benjamini–Hochberg across all of them. " +
      untested.toLocaleString("en-US") + " were not tested: fewer than " + minN + " " + unit + " with a value in some cohort" + (isCat ? ", or a single value throughout" : ", or no spread") + ". " +
      (multi ? "Counts and moments are summed across " + holders.length + " studies; overlap is not deduplicated and no batch correction is made. " : "") +
      (excluded.length ? "Left out: " + excluded.map((e) => e.study + " (" + e.reason + ")").join(", ") + "." : "")
  };
}
