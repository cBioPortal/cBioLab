// The MCP-App oncoprint view: a self-contained HTML document rendered by the
// host (Claude) in a sandboxed iframe per the MCP Apps extension (SEP-1865).
// It speaks the ui/* JSON-RPC bridge over postMessage, renders the oncoprint
// render-contract from the tool's structuredContent on a canvas (same cell
// semantics as the web renderers: bitmask genes, NOT_PROFILED, numeric heat),
// and calls render_oncoprint_app back through the host to re-sort.
// Zero network access — works under the extension's restrictive default CSP.

export const ONCOPRINT_APP_HTML = String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --ink:#1f2933; --muted:#5b6b76; --line:#d7dde2; --bg:#ffffff; }
  html.dark { --ink:#e7edf2; --muted:#93a4b0; --line:#3a444d; --bg:#161b20; }
  html, body { margin:0; padding:0; background:var(--bg); color:var(--ink);
    font:12px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  #bar { display:flex; gap:10px; align-items:center; padding:6px 8px; flex-wrap:wrap; }
  #bar .muted { color:var(--muted); }
  select { font-size:12px; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:4px; }
  #cv { width:100%; display:block; cursor:crosshair; }
  #legend { display:flex; flex-wrap:wrap; gap:4px 14px; padding:4px 8px 8px; color:var(--muted); }
  #legend .sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
  #tip { position:fixed; display:none; pointer-events:none; background:var(--bg); color:var(--ink);
    border:1px solid var(--line); border-radius:5px; padding:4px 8px; font-size:11px; max-width:260px; z-index:9; }
  #err { color:#c0392b; padding:8px; display:none; }
</style>
</head>
<body>
<div id="bar">
  <strong id="title">Oncoprint</strong><span class="muted" id="sub">waiting for data…</span>
  <span style="flex:1"></span>
  <span class="muted">sort</span><select id="sortSel"></select>
</div>
<canvas id="cv"></canvas>
<div id="legend"></div>
<div id="err"></div>
<div id="tip"></div>
<script>
(function () {
  "use strict";
  // ---- MCP Apps bridge -----------------------------------------------------
  var idc = 1, pending = {}, lastArgs = null, contract = null, theme = "light";
  function rpc(method, params) {
    return new Promise(function (res, rej) {
      var id = idc++; pending[id] = { res: res, rej: rej };
      parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
    });
  }
  function notify(method, params) {
    parent.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*");
  }
  window.addEventListener("message", function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id];
      if (m.error) p.rej(m.error); else p.res(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-input") {
      if (m.params && m.params.arguments) lastArgs = m.params.arguments;
    } else if (m.method === "ui/notifications/tool-result") {
      var sc = m.params && m.params.structuredContent;
      if (sc && sc.contract) { if (sc.args) lastArgs = sc.args; setContract(sc.contract); }
      else if (m.params && m.params.content && m.params.content[0]) showErr(m.params.content[0].text);
    } else if (m.method === "ui/notifications/host-context-changed") {
      if (m.params && m.params.hostContext && m.params.hostContext.theme) setTheme(m.params.hostContext.theme);
    }
  });
  rpc("ui/initialize", {
    protocolVersion: "2026-01-26",
    clientInfo: { name: "cohort-lab-oncoprint", version: "1.0.0" },
    capabilities: {},
    appCapabilities: { availableDisplayModes: ["inline"] }
  }).then(function (r) {
    if (r && r.hostContext && r.hostContext.theme) setTheme(r.hostContext.theme);
    notify("ui/notifications/initialized");
  }).catch(function () {});

  function setTheme(t) { theme = t; document.documentElement.className = t === "dark" ? "dark" : ""; if (contract) render(); }
  function showErr(t) { var e = document.getElementById("err"); e.textContent = t; e.style.display = "block"; }

  // ---- contract rendering (same cell semantics as the web renderers) -------
  var BITS = { MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16, SV: 32, AMP: 64, HOMDEL: 128, DRIVER: 256 };
  var CAT = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"];
  function pal() {
    var dark = theme === "dark";
    return {
      unaltered: dark ? "#2a333b" : "#e8ecee", np: dark ? "#20262c" : "#f4f6f7",
      np2: dark ? "#2c353d" : "#dfe4e7",
      amp: "#e41a1c", homdel: dark ? "#5b8fd4" : "#2166ac", sv: dark ? "#b45ecf" : "#8e24aa",
      missense: dark ? "#4caf50" : "#2e7d32", truncating: dark ? "#e7edf2" : "#111111",
      inframe: dark ? "#d4a017" : "#b8860b", splice: "#ff8c00", otherMut: "#9467bd",
      derived: "#0f86a1", ink: dark ? "#e7edf2" : "#1f2933", muted: dark ? "#93a4b0" : "#5b6b76"
    };
  }
  function heat(v) {
    var t = Math.max(0, Math.min(1, v / 255));
    function mix(a, b) { return Math.round(a + (b - a) * t); }
    return "rgb(" + mix(222, 8) + "," + mix(235, 72) + "," + mix(247, 135) + ")";
  }
  function mutColor(code, P) {
    if (code & BITS.MISSENSE) return P.missense;
    if (code & BITS.TRUNCATING) return P.truncating;
    if (code & BITS.INFRAME) return P.inframe;
    if (code & BITS.SPLICE) return P.splice;
    if (code & BITS.OTHER_MUT) return P.otherMut;
    return null;
  }
  var HEADER = 20, ROW_H = 18, GAP = 3, GUTTER = 150, GROUP_GAP = 8;
  var geom = null;

  function buckets(cells, from, count, pxW, colW, numeric) {
    var out = [], i, c;
    if (colW >= 1) {
      for (i = 0; i < count; i++) out.push({ x0: i * colW, w: colW, code: cells[from + i], i0: from + i, n: 1 });
      return out;
    }
    var nb = Math.max(1, Math.floor(pxW));
    for (var b = 0; b < nb; b++) {
      var i0 = Math.floor(b * count / nb), i1 = Math.max(i0 + 1, Math.floor((b + 1) * count / nb));
      var code = -1, saw = false, sum = 0, nn = 0;
      for (i = i0; i < i1; i++) {
        c = cells[from + i];
        if (c === -1) continue;
        saw = true;
        if (numeric) { sum += c; nn++; } else code = (code === -1 ? 0 : code) | (c > 0 ? c : 0);
      }
      if (numeric && nn) code = Math.round(sum / nn);
      out.push({ x0: b * pxW / nb, w: pxW / nb, code: saw ? code : -1, i0: from + i0, n: i1 - i0 });
    }
    return out;
  }

  function render() {
    var P = pal(), cv = document.getElementById("cv"), ctx = cv.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var cssW = cv.clientWidth || document.body.clientWidth || 640;
    var nT = contract.tracks.length;
    var cssH = HEADER + nT * (ROW_H + GAP);
    cv.width = cssW * dpr; cv.height = cssH * dpr; cv.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = "11px -apple-system, Segoe UI, Helvetica, sans-serif";
    var n = contract.bucketed ? contract.bucketSizes.length : contract.columns.length;
    var plotW = cssW - GUTTER - (contract.groups.length - 1) * GROUP_GAP - 4;
    var colW = plotW / n;
    var groupX = [], gx = GUTTER;
    contract.groups.forEach(function (g) { groupX.push(gx); gx += g.count * colW + GROUP_GAP; });
    ctx.fillStyle = P.muted;
    contract.groups.forEach(function (g, gi) {
      var label = g.name + " (" + (g.patients != null ? g.patients : g.count).toLocaleString("en-US") + ")";
      ctx.fillText(label, groupX[gi], 12, Math.max(60, g.count * colW));
    });
    contract.tracks.forEach(function (t, ti) {
      var y = HEADER + ti * (ROW_H + GAP);
      ctx.fillStyle = P.ink;
      ctx.fillText(t.label.length > 16 ? t.label.slice(0, 15) + "…" : t.label, 4, y + 13, GUTTER - 50);
      if (t.freqPct != null) {
        ctx.fillStyle = P.muted; ctx.textAlign = "right";
        ctx.fillText(t.driverPct != null ? t.driverPct + "/" + t.freqPct + "%" : t.freqPct + "%", GUTTER - 8, y + 13);
        ctx.textAlign = "left";
      }
      contract.groups.forEach(function (g, gi) {
        var x0 = groupX[gi], pxW = g.count * colW;
        buckets(t.cells, g.start, g.count, pxW, colW, !!t.numeric).forEach(function (b) {
          var x = x0 + b.x0, w = Math.max(b.w, 0.5);
          if (t.kind === "gene") {
            if (b.code === -1) {
              ctx.fillStyle = P.np; ctx.fillRect(x, y, w, ROW_H);
              ctx.fillStyle = P.np2; ctx.fillRect(x, y + ROW_H * 0.4, w, ROW_H * 0.2);
            } else {
              var vus = b.code > 0 && !(b.code & BITS.DRIVER);
              ctx.fillStyle = P.unaltered; ctx.fillRect(x, y, w, ROW_H);
              if (vus) ctx.globalAlpha = 0.4;
              if ((b.code & BITS.AMP) || (b.code & BITS.HOMDEL)) {
                ctx.fillStyle = (b.code & BITS.AMP) ? P.amp : P.homdel; ctx.fillRect(x, y, w, ROW_H);
              }
              if (b.code & BITS.SV) { ctx.fillStyle = P.sv; ctx.fillRect(x, y + ROW_H * 0.15, w, ROW_H * 0.7); }
              var mc = mutColor(b.code, P);
              if (mc) { ctx.fillStyle = mc; ctx.fillRect(x, y + ROW_H * 0.3, w, ROW_H * 0.4); }
              ctx.globalAlpha = 1;
            }
          } else if (t.kind === "derivedEvent") {
            ctx.fillStyle = b.code > 0 ? P.derived : P.unaltered; ctx.fillRect(x, y, w, ROW_H);
          } else if (t.numeric) {
            ctx.fillStyle = b.code === -1 ? P.np : heat(b.code); ctx.fillRect(x, y, w, ROW_H);
          } else {
            ctx.fillStyle = b.code === -1 ? P.np : CAT[b.code % CAT.length]; ctx.fillRect(x, y, w, ROW_H);
          }
        });
      });
    });
    geom = { colW: colW, groupX: groupX, cssW: cssW };
    renderChrome();
  }

  function renderChrome() {
    var title = document.getElementById("title"), sub = document.getElementById("sub");
    title.textContent = "Oncoprint — " + contract.study;
    sub.textContent = contract.stats.nColumns.toLocaleString("en-US") + " patients · " +
      (contract.conventions && contract.conventions.annotation || "") +
      (contract.bucketed ? " · columns bucketed for display" : "");
    var sel = document.getElementById("sortSel");
    var cur = (contract.conventions && contract.conventions.sort && contract.conventions.sort[0]) || "genomic";
    sel.innerHTML = "";
    function opt(v, label) { var o = document.createElement("option"); o.value = v; o.textContent = label; if (v === cur) o.selected = true; sel.appendChild(o); }
    opt("genomic", "genomic (staircase)");
    contract.tracks.forEach(function (t) {
      if (t.kind !== "clinical" && t.kind !== "derivedEvent") return;
      if (t.label.indexOf("(no data)") >= 0) return;
      opt(t.label, t.label + " ↑"); opt("-" + t.label, t.label + " ↓");
    });
    var lg = document.getElementById("legend"), P = pal();
    lg.innerHTML = "";
    function chip(color, label) {
      var s = document.createElement("span");
      var sw = document.createElement("span"); sw.className = "sw"; sw.style.background = color;
      s.appendChild(sw); s.appendChild(document.createTextNode(label)); lg.appendChild(s);
    }
    chip(P.amp, "Amp"); chip(P.homdel, "DeepDel"); chip(P.sv, "SV"); chip(P.missense, "Missense");
    chip(P.truncating, "Truncating"); chip(P.inframe, "In-frame"); chip(P.splice, "Splice");
    var note = document.createElement("span");
    note.textContent = "solid = putative driver, faded = VUS; striped/pale = not profiled; % = driver/any";
    lg.appendChild(note);
    contract.tracks.forEach(function (t) {
      if (t.kind !== "clinical") return;
      if (t.numeric) {
        var s = document.createElement("span");
        var sw = document.createElement("span"); sw.className = "sw";
        sw.style.width = "44px"; sw.style.background = "linear-gradient(90deg, rgb(222,235,247), rgb(8,72,135))";
        s.appendChild(document.createTextNode(t.label + ": ")); s.appendChild(sw);
        s.appendChild(document.createTextNode(" " + t.min + " → " + t.max));
        lg.appendChild(s);
      } else if (t.categories && t.categories.length) {
        var s2 = document.createElement("span");
        s2.appendChild(document.createTextNode(t.label + ": "));
        t.categories.slice(0, 6).forEach(function (c, i) {
          var sw2 = document.createElement("span"); sw2.className = "sw"; sw2.style.background = CAT[i % CAT.length];
          s2.appendChild(sw2); s2.appendChild(document.createTextNode(c + " "));
        });
        if (t.categories.length > 6) s2.appendChild(document.createTextNode("+" + (t.categories.length - 6)));
        lg.appendChild(s2);
      }
    });
  }

  function setContract(c) { contract = c; render(); }

  // ---- interactions --------------------------------------------------------
  document.getElementById("sortSel").addEventListener("change", function (e) {
    if (!lastArgs) return;
    var v = e.target.value;
    var args = JSON.parse(JSON.stringify(lastArgs));
    if (v === "genomic") delete args.sort; else args.sort = [v];
    document.getElementById("sub").textContent = "re-sorting…";
    rpc("tools/call", { name: "render_oncoprint_app", arguments: args }).then(function (r) {
      var sc = r && r.structuredContent;
      if (sc && sc.contract) { lastArgs = sc.args || args; setContract(sc.contract); }
      else if (r && r.content && r.content[0]) showErr(r.content[0].text);
    }).catch(function (err) { showErr("re-sort failed: " + (err && err.message || JSON.stringify(err))); });
  });

  function locate(ev) {
    if (!contract || !geom) return null;
    var r = document.getElementById("cv").getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    var ti = Math.floor((y - HEADER) / (ROW_H + GAP));
    if (ti < 0 || ti >= contract.tracks.length) return null;
    for (var gi = 0; gi < contract.groups.length; gi++) {
      var g = contract.groups[gi], x0 = geom.groupX[gi], w = g.count * geom.colW;
      if (x >= x0 && x < x0 + w) return { ti: ti, ci: g.start + Math.min(g.count - 1, Math.floor((x - x0) / geom.colW)), gi: gi };
    }
    return null;
  }
  function decode(code) {
    if (code === -1) return "not profiled";
    if (code === 0) return "no alteration";
    var parts = [];
    if (code & BITS.MISSENSE) parts.push("missense");
    if (code & BITS.TRUNCATING) parts.push("truncating");
    if (code & BITS.INFRAME) parts.push("in-frame");
    if (code & BITS.SPLICE) parts.push("splice");
    if (code & BITS.OTHER_MUT) parts.push("other mut");
    if (code & BITS.SV) parts.push("SV");
    if (code & BITS.AMP) parts.push("amp");
    if (code & BITS.HOMDEL) parts.push("deep del");
    parts.push((code & BITS.DRIVER) ? "driver" : "VUS");
    return parts.join(" + ");
  }
  var cvEl = document.getElementById("cv"), tip = document.getElementById("tip");
  cvEl.addEventListener("mousemove", function (ev) {
    var h = locate(ev);
    if (!h) { tip.style.display = "none"; return; }
    var t = contract.tracks[h.ti], code = t.cells[h.ci];
    var val;
    if (t.kind === "gene") val = decode(code);
    else if (t.kind === "derivedEvent") val = code > 0 ? "yes" : "no";
    else if (t.numeric) val = code === -1 ? "n/a" : "≈" + Math.round((t.min + (code / 255) * (t.max - t.min)) * 10) / 10;
    else val = code === -1 ? "n/a" : (t.categories && t.categories[code]) || "Other";
    var who = contract.bucketed ? "≈" + contract.bucketSizes[h.ci] + " patients (bucketed)" : contract.columns[h.ci];
    tip.innerHTML = "";
    var l1 = document.createElement("div"); l1.style.fontFamily = "monospace"; l1.textContent = who;
    var l2 = document.createElement("div"); l2.textContent = contract.groups[h.gi].name;
    var l3 = document.createElement("div"); l3.textContent = t.label + ": " + val;
    tip.appendChild(l1); tip.appendChild(l2); tip.appendChild(l3);
    tip.style.left = Math.min(ev.clientX + 12, (geom.cssW || 600) - 200) + "px";
    tip.style.top = (ev.clientY + 14) + "px";
    tip.style.display = "block";
  });
  cvEl.addEventListener("mouseleave", function () { tip.style.display = "none"; });
  cvEl.addEventListener("click", function (ev) {
    var h = locate(ev);
    if (!h || contract.bucketed) return;
    if (contract.studies && contract.studies.length === 1)
      rpc("ui/open-link", { url: "https://www.cbioportal.org/patient?studyId=" + contract.studies[0] + "&caseId=" + contract.columns[h.ci] }).catch(function () {});
  });
  window.addEventListener("resize", function () { if (contract) render(); });
})();
</script>
</body>
</html>`;
