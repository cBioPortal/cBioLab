"use client";
// Filter-pill rendering of a DSL v2 cohort definition — the study-view-filter-style
// visualization of what the JSON says. Read-only by default; pass onRemoveClause to
// get an × on each top-level clause (creator mode).
import { Fragment } from "react";

const KIND_META = {
  alteration: { label: "gene", color: "#CC79A7" },
  oql: { label: "OQL", color: "#CC79A7" },
  clinical: { label: "clinical", color: "#0072B2" },
  event: { label: "timeline", color: "#009E73" },
  patients: { label: "patients", color: "#999999" },
  profiled: { label: "profiled", color: "#56B4E9" },
  caseList: { label: "case list", color: "#999999" },
  genomicData: { label: "data", color: "#CC79A7" },
  genericAssay: { label: "assay", color: "#CC79A7" }
};

function leafKind(leaf) {
  if (leaf.kind) return leaf.kind;
  if (leaf.a && leaf.rel) return "event";
  return "clinical";
}

function selText(s) {
  if (!s) return "?";
  const attrs = (s.attrs || []).map(a => a.value).filter(Boolean).join(" ");
  let base = s.eventType === "Treatment line (derived)"
    ? "line " + (((s.attrs || []).find(a => a.key === "LINE_NO") || {}).value || "n")
    : (attrs ? attrs + " " : "") + String(s.eventType || "").replace("Lab_Test", "lab").toLowerCase();
  if ((s.attrs || []).some(a => a.key === "PROGRESSION" && a.value === "Y")) base = "progression";
  if (s.numeric && s.numeric.key) base += ` ${s.numeric.key}${s.numeric.op}${s.numeric.value}`;
  return (s.occurrence === "FIRST" ? "first " : s.occurrence === "LAST" ? "last " : "") + base;
}

function leafText(leaf) {
  const k = leafKind(leaf);
  if (k === "oql") return leaf.q;
  if (k === "alteration") {
    const t = leaf.types && leaf.types.length && leaf.types.length < 3 ? " " + leaf.types.join("/") : "";
    return leaf.gene + (leaf.driver === "driverOnly" ? " · driver" : "") + t;
  }
  if (k === "clinical") {
    const bits = [];
    if (leaf.values && leaf.values.length) bits.push("∈ {" + leaf.values.join(", ") + "}");
    if (leaf.range) bits.push(Object.entries(leaf.range).map(([a, b]) => ({ gt: ">", gte: "≥", lt: "<", lte: "≤" }[a] || a) + b).join(" "));
    if (leaf.op != null) bits.push(`${leaf.op} ${leaf.value}`);
    return `${leaf.attribute} ${bits.join(" ")}` + (leaf.per === "sample" ? " ·any sample" : "");
  }
  if (k === "profiled") return "profiled: " + leaf.type;
  if (k === "caseList") return leaf.id;
  if (k === "genomicData") return `${leaf.gene} ${leaf.profileType} ` + (leaf.range ? Object.entries(leaf.range).map(([a, b]) => ({ gt: ">", gte: "≥", lt: "<", lte: "≤" }[a] || a) + b).join(" ") : "");
  if (k === "genericAssay") return `${leaf.entity} ` + JSON.stringify(leaf.range || leaf.values);
  if (k === "patients") return `${(leaf.ids || []).length} listed`;
  // event
  const rel = leaf.rel || {};
  let t;
  if (rel.type === "BEFORE") t = `${selText(leaf.a)} → ${selText(leaf.b)} ≤${rel.maxDays}d`;
  else if (rel.type === "DURING") t = `${selText(leaf.b)} during ${selText(leaf.a)}`;
  else if (rel.type === "NOT_FOLLOWED_BY") t = `${selText(leaf.a)} ⇏ ${selText(leaf.b)} ≤${rel.withinDays}d`;
  else t = selText(leaf.a);
  if (leaf.priorGuard) t += " · naïve";
  return t;
}

function Pill({ leaf, negated, onRemove }) {
  const meta = KIND_META[leafKind(leaf)] || KIND_META.clinical;
  return (
    <span className="fpill" style={{ borderLeftColor: meta.color }} title={JSON.stringify(leaf)}>
      <span className="fkind">{meta.label}</span>
      {negated && <span className="fnot">NOT</span>}
      <span>{leafText(leaf)}</span>
      {onRemove && <button className="fx" aria-label="remove clause" onClick={onRemove}>×</button>}
    </span>
  );
}

export function normalizeDef(def) {
  if (!def) return null;
  if (def.a && def.rel && !def.all) return { ...def, all: [{ ...def }] };
  if (def.patients && !def.all) return { all: [{ kind: "patients", ids: def.patients }] };
  return def;
}

export default function CohortPills({ def, onRemoveClause }) {
  const d = normalizeDef(def);
  if (!d || !Array.isArray(d.all) || !d.all.length) return <span className="meta">no clauses</span>;
  return (
    <span className="fpills">
      {d.all.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="fconn">AND</span>}
          {c.any ? (
            <span className="fgroup">
              {c.any.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <span className="fconn">OR</span>}
                  <Pill leaf={l} />
                </Fragment>
              ))}
              {onRemoveClause && <button className="fx" aria-label="remove group" onClick={() => onRemoveClause(i)}>×</button>}
            </span>
          ) : c.not ? (
            <Pill leaf={c.not} negated onRemove={onRemoveClause ? () => onRemoveClause(i) : undefined} />
          ) : (
            <Pill leaf={c} onRemove={onRemoveClause ? () => onRemoveClause(i) : undefined} />
          )}
        </Fragment>
      ))}
    </span>
  );
}
