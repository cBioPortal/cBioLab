// DSL -> ClickHouse SQL compiler. Server-side only.
export function sq(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }

function mskCte(db, study) {
  return "msk AS (\n  SELECT p.internal_id FROM " + db + ".patient p\n" +
    "  JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "  WHERE cs.cancer_study_identifier = " + sq(study) + "\n)";
}

function priorMedCte(db) {
  return "nopriormed AS (\n  SELECT ce.patient_id AS patient_id FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".clinical_event_data pm ON pm.clinical_event_id = ce.clinical_event_id\n" +
    "    AND pm.key = 'PRIOR_MED_TO_MSK' AND pm.value = 'No prior medications'\n" +
    "  WHERE ce.patient_id IN (SELECT internal_id FROM msk)\n)";
}

const OCCURRENCES = new Set(["ANY", "FIRST", "LAST"]);
const REL_TYPES = new Set(["NONE", "BEFORE", "DURING", "NOT_FOLLOWED_BY"]);
const NUM_OPS = { ">": ">", ">=": ">=", "<": "<", "<=": "<=", "=": "=" };

function asNum(x, name) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error("invalid number for " + name);
  return n;
}

export function validateSelector(sel) {
  if (!sel || typeof sel.eventType !== "string" || !sel.eventType || sel.eventType.length > 200)
    throw new Error("invalid eventType");
  const attrs = (sel.attrs || []).slice(0, 3).filter(a => a && a.key && a.value)
    .map(a => ({ key: String(a.key).slice(0, 200), value: String(a.value).slice(0, 500) }));
  const occurrence = OCCURRENCES.has(sel.occurrence) ? sel.occurrence : "ANY";
  let numeric = null;
  if (sel.numeric && sel.numeric.key && sel.numeric.value !== "" && sel.numeric.value != null) {
    numeric = { key: String(sel.numeric.key).slice(0, 200), op: NUM_OPS[sel.numeric.op] || ">", value: asNum(sel.numeric.value, "numeric value") };
  }
  const minDurationDays = sel.minDurationDays ? asNum(sel.minDurationDays, "minDurationDays") : null;
  return { eventType: sel.eventType, attrs, occurrence, numeric, minDurationDays };
}

function selectorCte(name, sel, db, priorGuard) {
  const joins = [], conds = ["ce.event_type = " + sq(sel.eventType)];
  sel.attrs.forEach((a, i) => {
    joins.push("JOIN " + db + ".clinical_event_data a" + i +
      " ON a" + i + ".clinical_event_id = ce.clinical_event_id AND a" + i + ".key = " +
      sq(a.key) + " AND a" + i + ".value = " + sq(a.value));
  });
  if (sel.numeric) {
    joins.push("JOIN " + db + ".clinical_event_data nx ON nx.clinical_event_id = ce.clinical_event_id AND nx.key = " + sq(sel.numeric.key));
    conds.push("toFloat64OrNull(nx.value) " + sel.numeric.op + " " + sel.numeric.value);
  }
  if (sel.minDurationDays) {
    conds.push("ce.stop_date IS NOT NULL AND ce.stop_date - ce.start_date >= " + sel.minDurationDays);
  }
  conds.push("ce.patient_id IN (SELECT internal_id FROM msk)");
  if (priorGuard) conds.push("ce.patient_id IN (SELECT patient_id FROM nopriormed)");
  let base = "SELECT ce.patient_id, ce.start_date, ce.stop_date\n  FROM " + db + ".clinical_event ce\n  " +
    joins.join("\n  ") + (joins.length ? "\n  " : "") + "WHERE " + conds.join("\n    AND ");
  if (sel.occurrence === "FIRST" || sel.occurrence === "LAST") {
    // never alias an aggregate back to its source column name (ClickHouse alias substitution)
    const agg = sel.occurrence === "FIRST" ? "argMin" : "argMax", mm = sel.occurrence === "FIRST" ? "min" : "max";
    base = "SELECT patient_id, occ_start AS start_date, occ_stop AS stop_date FROM (\n" +
      "  SELECT patient_id, " + mm + "(start_date) AS occ_start, " + agg + "(stop_date, start_date) AS occ_stop\n" +
      "    FROM (" + base + ") GROUP BY patient_id)";
  }
  return name + " AS (\n" + base + "\n)";
}

export function compileCohort({ db, study, a, b, rel, priorGuard, lineGap: lineGapIn }) {
  const A = "sel_a", B = "sel_b";
  a = validateSelector(a);
  const relType = rel && REL_TYPES.has(rel.type) ? rel.type : "NONE";
  if (relType !== "NONE") b = validateSelector(b);
  const isLine = s => s && s.eventType === LINE_TYPE;
  // shared page-level gap setting; a selector-level GAP attribute still overrides
  const lineGap = (() => {
    for (const s of [a, relType !== "NONE" ? b : null]) {
      if (!isLine(s)) continue;
      const g = (s.attrs || []).find(x => x.key === "GAP");
      if (g) return asNum(g.value, "GAP");
    }
    return lineGapIn != null ? asNum(lineGapIn, "lineGap") : 90;
  })();
  const ctes = [mskCte(db, study)];
  if (priorGuard) ctes.push(priorMedCte(db));
  if (isLine(a) || (relType !== "NONE" && isLine(b)))
    ctes.push(...linesCoreCtes(db, lineGap, !!priorGuard));
  ctes.push(isLine(a) ? lineSelectorCte(A, a) : selectorCte(A, a, db, !!priorGuard));
  let joins = [], wheres = [], maxDays = 0, minDays = 0;
  if (relType !== "NONE") {
    ctes.push(isLine(b) ? lineSelectorCte(B, b) : selectorCte(B, b, db, false));
    if (relType === "BEFORE") {
      minDays = asNum(rel.minDays || 0, "minDays"); maxDays = asNum(rel.maxDays, "maxDays");
      joins.push("JOIN " + B + " ON " + B + ".patient_id = " + A + ".patient_id");
      wheres.push(B + ".start_date > " + A + ".start_date + " + minDays +
        " AND " + B + ".start_date <= " + A + ".start_date + " + maxDays);
    } else if (relType === "DURING") {
      joins.push("JOIN " + B + " ON " + B + ".patient_id = " + A + ".patient_id");
      wheres.push(B + ".start_date >= " + A + ".start_date AND " + B +
        ".start_date <= coalesce(" + A + ".stop_date, " + A + ".start_date)");
    } else if (relType === "NOT_FOLLOWED_BY") {
      const w = asNum(rel.withinDays, "withinDays");
      wheres.push(A + ".patient_id NOT IN (SELECT a2.patient_id FROM " + A + " AS a2 JOIN " + B +
        " ON " + B + ".patient_id = a2.patient_id AND " + B + ".start_date > a2.start_date AND " +
        B + ".start_date <= a2.start_date + " + w + ")");
      if (rel.observed) {
        ctes.push("obs AS (\n  SELECT patient_id, max(start_date) AS max_date FROM " + db + ".clinical_event\n" +
          "  WHERE patient_id IN (SELECT internal_id FROM msk) GROUP BY patient_id\n)");
        joins.push("JOIN obs ON obs.patient_id = " + A + ".patient_id");
        wheres.push("obs.max_date >= " + A + ".start_date + " + w);
      }
    }
  }
  const body = "FROM " + A + (joins.length ? "\n  " + joins.join("\n  ") : "") +
    (wheres.length ? "\nWHERE " + wheres.join("\n  AND ") : "");
  const withBlock = "WITH\n" + ctes.join(",\n") + "\n";
  const countSql = withBlock +
    "SELECT uniqExact(" + A + ".patient_id) AS matched,\n" +
    "       (SELECT uniqExact(patient_id) FROM " + A + ") AS denom\n" + body;
  const patientsSql = withBlock +
    "SELECT DISTINCT p.stable_id AS pid\n" + body.replace("FROM " + A,
      "FROM " + A + "\n  JOIN " + db + ".patient p ON p.internal_id = " + A + ".patient_id") +
    (wheres.length ? "\n" : "\nWHERE 1\n") + "ORDER BY pid LIMIT 24";
  let histSql = null, histBucket = 0;
  if (relType === "BEFORE") {
    histBucket = Math.max(1, Math.round(maxDays / 12));
    histSql = withBlock +
      "SELECT toInt32(intDiv(gap, " + histBucket + ") * " + histBucket + ") AS bucket, count() AS n FROM (\n" +
      "  SELECT " + A + ".patient_id AS patient_id, min(" + B + ".start_date - " + A + ".start_date) AS gap\n" +
      "  FROM " + A + " JOIN " + B + " ON " + B + ".patient_id = " + A + ".patient_id\n" +
      "  WHERE " + B + ".start_date > " + A + ".start_date + " + minDays + "\n" +
      "  GROUP BY patient_id)\n" +
      "WHERE gap <= " + maxDays + " GROUP BY bucket ORDER BY bucket";
  }
  return { countSql, patientsSql, histSql, histBucket };
}

const SYSTEMIC = ["Chemo", "Immuno", "Targeted", "Hormone", "Biologic", "Investigational"];
export const LINE_TYPE = "Treatment line (derived)";

function linesCoreCtes(db, gap, priorGuard) {
  return [
    "tx AS (\n  SELECT ce.clinical_event_id AS eid, ce.patient_id, ce.start_date,\n" +
    "         coalesce(ce.stop_date, ce.start_date) AS stop_date, st.value AS subtype\n" +
    "  FROM " + db + ".clinical_event ce\n" +
    "  JOIN " + db + ".clinical_event_data st ON st.clinical_event_id = ce.clinical_event_id\n" +
    "    AND st.key = 'SUBTYPE' AND st.value IN (" + SYSTEMIC.map(sq).join(",") + ")\n" +
    "  WHERE ce.event_type = 'Treatment' AND ce.patient_id IN (SELECT internal_id FROM msk)" +
    (priorGuard ? "\n    AND ce.patient_id IN (SELECT patient_id FROM nopriormed)" : "") + "\n)",
    // toNullable: over an empty frame, max() on a non-nullable column returns 0 (not NULL),
    // which corrupts first-row detection because day offsets are often <= 0
    "flagged AS (\n  SELECT *, max(toNullable(stop_date)) OVER (PARTITION BY patient_id\n" +
    "    ORDER BY start_date, stop_date, eid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pms\n  FROM tx\n)",
    "numbered AS (\n  SELECT *, sum(if(pms IS NULL OR start_date > pms + " + gap + ", 1, 0)) OVER (\n" +
    "    PARTITION BY patient_id ORDER BY start_date, stop_date, eid ROWS UNBOUNDED PRECEDING) AS line_no\n  FROM flagged\n)",
    "line_events AS (\n  SELECT patient_id, line_no, ls AS start_date, lst AS stop_date, combo FROM (\n" +
    "    SELECT patient_id, line_no, min(start_date) AS ls, max(stop_date) AS lst,\n" +
    "           arrayStringConcat(arraySort(groupUniqArray(subtype)), '+') AS combo\n" +
    "    FROM numbered GROUP BY patient_id, line_no)\n)"
  ];
}

function lineSelectorCte(name, sel) {
  const conds = ["1"];
  sel.attrs.forEach(a => {
    if (a.key === "LINE_NO") conds.push("line_no = " + asNum(a.value, "LINE_NO"));
    else if (a.key === "COMPOSITION") conds.push("combo = " + sq(a.value));
    else if (a.key === "GAP") { /* consumed by compileCohort */ }
    else throw new Error("'" + LINE_TYPE + "' supports attributes LINE_NO, COMPOSITION, GAP");
  });
  if (sel.numeric) {
    if (sel.numeric.key !== "LINE_NO") throw new Error("numeric predicate on '" + LINE_TYPE + "' supports only LINE_NO");
    conds.push("line_no " + sel.numeric.op + " " + sel.numeric.value);
  }
  if (sel.minDurationDays) conds.push("stop_date - start_date >= " + sel.minDurationDays);
  let base = "SELECT patient_id, start_date, stop_date FROM line_events\n  WHERE " + conds.join(" AND ");
  if (sel.occurrence === "FIRST" || sel.occurrence === "LAST") {
    const agg = sel.occurrence === "FIRST" ? "argMin" : "argMax", mm = sel.occurrence === "FIRST" ? "min" : "max";
    base = "SELECT patient_id, occ_start AS start_date, occ_stop AS stop_date FROM (\n" +
      "  SELECT patient_id, " + mm + "(start_date) AS occ_start, " + agg + "(stop_date, start_date) AS occ_stop\n" +
      "    FROM (" + base + ") GROUP BY patient_id)";
  }
  return name + " AS (\n" + base + "\n)";
}

export function compileLines(db, study, gapDays, priorGuard) {
  const gap = asNum(gapDays, "gap");
  if (gap < 1 || gap > 3650) throw new Error("gap out of range");
  const ctes = [mskCte(db, study)];
  if (priorGuard) ctes.push(priorMedCte(db));
  ctes.push(...linesCoreCtes(db, gap, priorGuard).slice(0, 3));
  const withBlock = "WITH\n" + ctes.join(",\n") + "\n";
  const histSql = withBlock +
    "SELECT toUInt32(least(n_lines, 8)) AS bucket, count() AS n FROM (\n" +
    "  SELECT patient_id, max(line_no) AS n_lines FROM numbered GROUP BY patient_id)\n" +
    "GROUP BY bucket ORDER BY bucket";
  const transSql = withBlock + ",\nlines AS (\n" +
    "  SELECT patient_id, line_no, arrayStringConcat(arraySort(groupUniqArray(subtype)), '+') AS combo\n" +
    "  FROM numbered GROUP BY patient_id, line_no\n)\n" +
    "SELECT l1.combo AS line1, l2.combo AS line2, count() AS n\n" +
    "FROM (SELECT * FROM lines WHERE line_no = 1) l1\n" +
    "JOIN (SELECT * FROM lines WHERE line_no = 2) l2 ON l2.patient_id = l1.patient_id\n" +
    "GROUP BY line1, line2 ORDER BY n DESC LIMIT 12";
  return { histSql, transSql };
}

export function lineCatalogSqls(db, study, gap = 90) {
  const withBlock = "WITH\n" + [mskCte(db, study), ...linesCoreCtes(db, gap, false)].join(",\n") + "\n";
  return {
    stats: withBlock + "SELECT uniqExact(patient_id) AS n_pat, count() AS n_ev FROM line_events",
    combos: withBlock + "SELECT combo, count() AS n FROM line_events GROUP BY combo ORDER BY n DESC LIMIT 25"
  };
}

export function catalogSqls(db, study) {
  const withBlock = "WITH\n" + mskCte(db, study) + "\n";
  return {
    studyCheck: "SELECT count() AS n FROM " + db + ".cancer_study WHERE cancer_study_identifier = " + sq(study),
    types: withBlock +
      "SELECT ce.event_type AS t, uniqExact(ce.patient_id) AS n_pat, count() AS n_ev\n" +
      "FROM " + db + ".clinical_event ce WHERE ce.patient_id IN (SELECT internal_id FROM msk)\n" +
      "GROUP BY t ORDER BY n_pat DESC",
    values: withBlock +
      "SELECT ce.event_type AS t, d.key AS k, d.value AS v, uniqExact(ce.patient_id) AS n\n" +
      "FROM " + db + ".clinical_event ce\n" +
      "JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
      "WHERE ce.patient_id IN (SELECT internal_id FROM msk)\n" +
      "GROUP BY t, k, v HAVING n >= 10 ORDER BY n DESC LIMIT 25 BY t, k",
    keys: withBlock +
      "SELECT ce.event_type AS t, d.key AS k, uniqExact(d.value) AS nv\n" +
      "FROM " + db + ".clinical_event ce\n" +
      "JOIN " + db + ".clinical_event_data d ON d.clinical_event_id = ce.clinical_event_id\n" +
      "WHERE ce.patient_id IN (SELECT internal_id FROM msk)\n" +
      "GROUP BY t, k ORDER BY t, k"
  };
}
