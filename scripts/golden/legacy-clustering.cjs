// Faithful port of cbioportal-frontend (cd8c6df) packages/oncoprintjs/src/js/workers/clustering-worker.ts,
// run on legacy's own tayden-clusterfck 0.7.0 and jstat 1.9.6. Only the worker's message plumbing is dropped.
// test/oncoprint-cluster.test.ts records its answers in test/fixtures/golden/legacy-clustering.json:
//   CBIOPORTAL_FRONTEND=~/cbioportal-frontend RECORD_LEGACY=1 node --test test/oncoprint-cluster.test.ts
const path = require("node:path");
const NM = path.join(process.env.CBIOPORTAL_FRONTEND || path.join(require("node:os").homedir(), "cbioportal-frontend"), "node_modules") + "/";
const clusterfck = require(NM + "tayden-clusterfck");
const jStat = require(NM + "jstat");

function isAllNaNs(values) {
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (!isNaN(val) && val != null && val != 0.0) return false;
  }
  return true;
}
function preRankedSpearmanDist(item1, item2) {
  if (item1.isAllNaNs && item2.isAllNaNs) return 0;
  else if (item1.isAllNaNs || item2.isAllNaNs) return 3;
  const ranks1 = item1.preProcessedValueList, ranks2 = item2.preProcessedValueList;
  let r = jStat.corrcoeff(ranks1, ranks2);
  if (isNaN(r)) r = -2;
  return 1 - r;
}
function _prepareForDistanceFunction(inputItems) {
  const allNaN = [], notAllNaN = [];
  for (let i = 0; i < inputItems.length; i++) {
    const inputItem = inputItems[i];
    inputItem.isAllNaNs = isAllNaNs(inputItem.orderedValueList);
    if (inputItem.isAllNaNs) { allNaN.push(inputItem); continue; } else notAllNaN.push(inputItem);
    inputItem.preProcessedValueList = jStat.rank(inputItem.orderedValueList);
  }
  return { notAllNaN, allNaN };
}
function getRefList(caseItem) { const r = []; for (const k in caseItem) r.push(k); return r; }
function hclusterCases(casesAndEntitites) {
  let refEntityList = null; const inputItems = [];
  for (const caseId in casesAndEntitites) {
    const caseObj = casesAndEntitites[caseId];
    const inputItem = { caseId, orderedValueList: [] };
    if (refEntityList == null) refEntityList = getRefList(caseObj);
    for (let j = 0; j < refEntityList.length; j++) inputItem.orderedValueList.push(caseObj[refEntityList[j]]);
    inputItems.push(inputItem);
  }
  if (refEntityList.length == 1) {
    inputItems.sort(function (i1, i2) {
      let val1 = i1.orderedValueList[0], val2 = i2.orderedValueList[0];
      val1 = val1 == null || isNaN(val1) ? Number.MAX_VALUE : val1;
      val2 = val2 == null || isNaN(val2) ? Number.MAX_VALUE : val2;
      if (val1 > val2) return 1; else if (val1 < val2) return -1;
      return 0;
    });
    return inputItems;
  }
  const p = _prepareForDistanceFunction(inputItems);
  const clusters = clusterfck.hcluster(p.notAllNaN, preRankedSpearmanDist);
  lastTree = clusters.tree;
  return clusters.clusters(1)[0].concat(p.allNaN);
}
let lastTree = null;
/** the leaf sets of a clusterfck tree's internal nodes, by a key function on its leaf values */
function nodesOf(tree, key) {
  const out = [];
  const walk = (t) => { if (!t) return []; if (t.size === 1) return [key(t.value)]; const l = walk(t.left).concat(walk(t.right)); out.push(l); return l; };
  walk(tree);
  return out;
}
function hclusterGeneticEntities(casesAndEntitites) {
  let refEntityList = null; const inputItems = [], refCaseIdList = [];
  for (const caseId in casesAndEntitites) {
    if (refEntityList == null) refEntityList = getRefList(casesAndEntitites[caseId]);
    refCaseIdList.push(caseId);
  }
  for (let i = 0; i < refEntityList.length; i++) {
    const entityId = refEntityList[i];
    const inputItem = { entityId, orderedValueList: [] };
    for (let j = 0; j < refCaseIdList.length; j++) inputItem.orderedValueList.push(casesAndEntitites[refCaseIdList[j]][entityId]);
    inputItems.push(inputItem);
  }
  const p = _prepareForDistanceFunction(inputItems);
  const clusters = clusterfck.hcluster(p.notAllNaN, preRankedSpearmanDist);
  return clusters.clusters(1)[0].concat(p.allNaN);
}

/**
 * cols: one array per column (case), one value per gene; NaN, null or undefined for no value.
 * Builds casesAndEntities as oncoprintmodel.clusterTrackGroup does: case ids are strings (insertion
 * order), entity ids are integer track ids (so enumerate ascending = input order).
 * missing: how a missing value reaches the worker ("null" as the portal's profile_data, or "NaN").
 */
function legacyCluster(cols, missing = "null") {
  const cae = {};
  cols.forEach((c, i) => {
    const o = {};
    c.forEach((v, g) => { o[g] = v == null || Number.isNaN(v) ? (missing === "null" ? null : NaN) : v; });
    cae["c" + i] = o;
  });
  const order = hclusterCases(cae).map((it) => Number(it.caseId.slice(1)));
  const nodes = cols[0].length > 1 ? nodesOf(lastTree, (it) => Number(it.caseId.slice(1))) : [];
  const rows = hclusterGeneticEntities(cae).map((it) => Number(it.entityId));
  return { order, rows, nodes };
}
/** legacy's own average linkage (tayden-clusterfck hcluster, default linkage) over n items with the given distance */
function legacyAverageLinkage(n, dist) {
  const items = Array.from({ length: n }, (_, i) => i);
  const c = clusterfck.hcluster(items, dist);
  return { order: c.clusters(1)[0], nodes: nodesOf(c.tree, (v) => v) };
}
/** legacy's distance between two columns (fractional ranks, then 1 - corrcoeff, 3 when NaN) */
function legacyDistance(a, b) {
  const p = _prepareForDistanceFunction([{ orderedValueList: a }, { orderedValueList: b }]);
  const [x, y] = [p.notAllNaN.concat(p.allNaN)].flat();
  return preRankedSpearmanDist(x.isAllNaNs !== undefined ? x : x, y);
}
/** UPGMA over every column in float64 with legacy's distance: true when some merge's best distance is tied (within eps) with another pair */
function hasTie(cols, eps = 1e-9) {
  const nul = cols.map((c) => c.map((v) => (Number.isNaN(v) ? null : v)));
  const d = (a, b) => legacyDistance(nul[a], nul[b]);
  let cl = cols.map((_, i) => [i]);
  const cd = (x, y) => { let s = 0; for (const i of x) for (const j of y) s += d(i, j); return s / (x.length * y.length); };
  while (cl.length > 1) {
    const all = [];
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) all.push([cd(cl[i], cl[j]), i, j]);
    all.sort((a, b) => a[0] - b[0]);
    if (all.length > 1 && all[0][0] > eps && all[1][0] - all[0][0] < eps) return true;
    const [, i, j] = all[0];
    cl = [...cl.filter((_, k) => k !== i && k !== j), [...cl[i], ...cl[j]]];
  }
  return false;
}
module.exports = { legacyCluster, legacyAverageLinkage, legacyDistance, hasTie };
